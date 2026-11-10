// Rollbacks locales incrementales: snapshots comprimidos (zip) del proyecto, guardados FUERA
// del proyecto (carpeta de datos de la app). Restaurar crea antes un snapshot de seguridad.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const AdmZip = require('adm-zip')

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'build', 'out', '.venv', 'venv', '__pycache__', '.cache', '.vite', 'coverage'])
const MAX_FILE_BYTES = 5 * 1024 * 1024
const MAX_TOTAL_BYTES = 150 * 1024 * 1024 // tope por snapshot (máquina de 8 GB)
const KEEP_DEFAULT = 15

function projectDir(baseDir, root) {
  const id = crypto.createHash('sha1').update(path.resolve(root).toLowerCase()).digest('hex').slice(0, 12)
  return path.join(baseDir, 'snapshots', id)
}

function collectFiles(root) {
  const files = []
  let total = 0
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(full); continue }
      if (!e.isFile()) continue
      let st
      try { st = fs.statSync(full) } catch { continue }
      if (st.size > MAX_FILE_BYTES) continue
      total += st.size
      if (total > MAX_TOTAL_BYTES) return { files, truncated: true }
      files.push(full)
    }
  }
  return { files, truncated: false }
}

function safeLabel(s) {
  return String(s || '').replace(/[^\w\- áéíóúñÁÉÍÓÚÑ.]/g, '').trim().slice(0, 60)
}

function listSnapshots(baseDir, root) {
  const dir = projectDir(baseDir, root)
  if (!fs.existsSync(dir)) return { ok: true, snapshots: [] }
  const snapshots = fs.readdirSync(dir)
    .filter(f => f.endsWith('.zip'))
    .map(f => {
      const st = fs.statSync(path.join(dir, f))
      const m = f.match(/^(\d+)(?:__(.*))?\.zip$/)
      return { id: f.replace(/\.zip$/, ''), ts: m ? Number(m[1]) : st.mtimeMs, label: m && m[2] ? m[2] : '', size: st.size }
    })
    .sort((a, b) => b.ts - a.ts)
  return { ok: true, snapshots }
}

function prune(baseDir, root, keep) {
  const { snapshots } = listSnapshots(baseDir, root)
  const dir = projectDir(baseDir, root)
  for (const s of snapshots.slice(keep)) { try { fs.unlinkSync(path.join(dir, s.id + '.zip')) } catch {} }
}

function createSnapshot(baseDir, root, label, keep = KEEP_DEFAULT) {
  if (!root || !fs.existsSync(root)) return { ok: false, error: 'Carpeta de proyecto no encontrada' }
  const { files, truncated } = collectFiles(root)
  if (!files.length) return { ok: false, error: 'No hay archivos para respaldar' }
  const zip = new AdmZip()
  for (const f of files) {
    const rel = path.relative(root, f)
    const zipDir = path.dirname(rel) === '.' ? '' : path.dirname(rel).replace(/\\/g, '/')
    zip.addLocalFile(f, zipDir)
  }
  const dir = projectDir(baseDir, root)
  fs.mkdirSync(dir, { recursive: true })
  const lbl = safeLabel(label)
  const id = `${Date.now()}${lbl ? '__' + lbl : ''}`
  zip.writeZip(path.join(dir, id + '.zip'))
  prune(baseDir, root, keep)
  return { ok: true, id, files: files.length, truncated }
}

function restoreSnapshot(baseDir, root, id) {
  if (!/^[\w\- áéíóúñÁÉÍÓÚÑ.]+$/.test(String(id || ''))) return { ok: false, error: 'ID de snapshot inválido' }
  const file = path.join(projectDir(baseDir, root), id + '.zip')
  if (!fs.existsSync(file)) return { ok: false, error: 'Snapshot no encontrado' }

  // Red de seguridad: respaldo del estado actual antes de pisar nada
  const safety = createSnapshot(baseDir, root, 'antes-de-restaurar')
  if (!safety.ok) return { ok: false, error: 'No se pudo crear el respaldo de seguridad: ' + safety.error }

  const zip = new AdmZip(file)
  const rootResolved = path.resolve(root)
  let restored = 0
  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue
    const dest = path.resolve(rootResolved, entry.entryName)
    // anti zip-slip: el destino debe quedar dentro del proyecto
    if (dest !== rootResolved && !dest.startsWith(rootResolved + path.sep)) continue
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, entry.getData())
    restored++
  }
  return { ok: true, restored, safetyId: safety.id }
}

function deleteSnapshot(baseDir, root, id) {
  if (!/^[\w\- áéíóúñÁÉÍÓÚÑ.]+$/.test(String(id || ''))) return { ok: false, error: 'ID de snapshot inválido' }
  const file = path.join(projectDir(baseDir, root), id + '.zip')
  try { fs.unlinkSync(file); return { ok: true } } catch (e) { return { ok: false, error: e.message } }
}

module.exports = { createSnapshot, listSnapshots, restoreSnapshot, deleteSnapshot }
