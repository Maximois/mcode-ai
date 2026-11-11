// Recolector de basura local (cero tokens): busca y borra clutter REGENERABLE del proyecto.
// Seguridad:
//  - Solo categorías conocidas; la lista a borrar se RECALCULA aquí al aplicar (no se confía en rutas del cliente).
//  - Nunca entra en .git ni en node_modules (salvo node_modules/.cache de la raíz).
//  - No sigue enlaces simbólicos: un symlink se omite y jamás se borra lo que apunta.
//  - Cada ruta se revalida dentro del proyecto justo antes de borrarla.
const fs = require('fs')
const path = require('path')

const OLD_LOG_DAYS = 7
const MAX_ENTRIES = 20000   // tope de recorrido (máquinas con poca RAM)
const MAX_ITEMS = 2000

const CATEGORIES = {
  os:    { label: 'Archivos del sistema (.DS_Store, Thumbs.db, desktop.ini)', defaultOn: true },
  tmp:   { label: 'Temporales y de editor (*.tmp, *.swp, *~, *.orig)', defaultOn: true },
  cache: { label: 'Cachés regenerables (.vite, .parcel-cache, node_modules/.cache, __pycache__)', defaultOn: true },
  logs:  { label: `Logs de más de ${OLD_LOG_DAYS} días (*.log)`, defaultOn: false },
}

const OS_FILES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini'])
const CACHE_DIRS = new Set(['.vite', '.parcel-cache', '__pycache__', '.pytest_cache', '.mypy_cache'])
const SKIP_DIRS = new Set(['.git', 'node_modules'])

function isTmp(name) {
  const n = name.toLowerCase()
  return /\.(tmp|swp|swo|orig)$/.test(n) || n.endsWith('~') || /^\.#/.test(n)
}

function dirSize(dir, budget) {
  let total = 0
  const stack = [dir]
  while (stack.length && budget.left > 0) {
    const d = stack.pop()
    let entries
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (--budget.left <= 0) break
      const full = path.join(d, e.name)
      try {
        if (e.isSymbolicLink()) continue
        if (e.isDirectory()) stack.push(full)
        else total += fs.lstatSync(full).size
      } catch { /* ilegible: se ignora */ }
    }
  }
  return total
}

function scan(root, cats) {
  const want = new Set((cats || []).filter(c => CATEGORIES[c]))
  const items = []
  const budget = { left: MAX_ENTRIES }
  let truncated = false
  const now = Date.now()

  const add = (cat, full, isDir, size) => {
    if (items.length >= MAX_ITEMS) { truncated = true; return }
    items.push({ cat, rel: path.relative(root, full).replace(/\\/g, '/'), isDir, size })
  }

  // Caché de node_modules de la raíz (sin recorrer el resto de node_modules)
  if (want.has('cache')) {
    const nmCache = path.join(root, 'node_modules', '.cache')
    try {
      const st = fs.lstatSync(nmCache)
      if (st.isDirectory() && !st.isSymbolicLink()) add('cache', nmCache, true, dirSize(nmCache, budget))
    } catch { /* no existe */ }
  }

  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (--budget.left <= 0) { truncated = true; break }
      if (e.isSymbolicLink()) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue
        if (want.has('cache') && CACHE_DIRS.has(e.name)) { add('cache', full, true, dirSize(full, budget)); continue }
        stack.push(full)
        continue
      }
      if (!e.isFile()) continue
      const lower = e.name.toLowerCase()
      let st
      if (want.has('os') && OS_FILES.has(lower)) { try { st = fs.lstatSync(full) } catch { continue } add('os', full, false, st.size); continue }
      if (want.has('tmp') && isTmp(e.name)) { try { st = fs.lstatSync(full) } catch { continue } add('tmp', full, false, st.size); continue }
      if (want.has('logs') && lower.endsWith('.log')) {
        try { st = fs.lstatSync(full) } catch { continue }
        if (now - st.mtimeMs > OLD_LOG_DAYS * 86400000) add('logs', full, false, st.size)
      }
    }
    if (budget.left <= 0) break
  }

  const byCat = {}
  for (const c of Object.keys(CATEGORIES)) byCat[c] = { count: 0, bytes: 0 }
  for (const it of items) { byCat[it.cat].count++; byCat[it.cat].bytes += it.size }
  return { items, byCat, truncated }
}

function scanProject(root, cats) {
  const wanted = cats && cats.length ? cats : Object.keys(CATEGORIES)
  const r = scan(root, wanted)
  return {
    ok: true,
    categories: Object.fromEntries(Object.entries(CATEGORIES).map(([k, v]) => [k, { ...v, ...r.byCat[k] }])),
    sample: r.items.slice(0, 40),
    total: r.items.length,
    totalBytes: r.items.reduce((s, i) => s + i.size, 0),
    truncated: r.truncated,
  }
}

function applyClean(root, cats) {
  const wanted = (cats || []).filter(c => CATEGORIES[c])
  if (!wanted.length) return { ok: false, error: 'Elegí al menos una categoría' }
  const rootResolved = path.resolve(root)
  const { items, truncated } = scan(root, wanted)
  let deleted = 0, freed = 0
  const failed = []
  for (const it of items) {
    const full = path.resolve(rootResolved, it.rel)
    if (full === rootResolved || !full.startsWith(rootResolved + path.sep)) { failed.push(it.rel); continue }
    try {
      const st = fs.lstatSync(full)
      if (st.isSymbolicLink()) continue
      if (st.isDirectory()) fs.rmSync(full, { recursive: true, force: true })
      else fs.unlinkSync(full)
      deleted++; freed += it.size
    } catch (e) { failed.push(it.rel) }
  }
  return { ok: true, deleted, freed, failed: failed.slice(0, 10), failedCount: failed.length, truncated }
}

module.exports = { scanProject, applyClean, CATEGORIES }
