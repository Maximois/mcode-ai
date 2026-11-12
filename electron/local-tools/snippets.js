// Biblioteca dinámica de snippets (cero tokens por defecto).
// Integrados: electron/local-tools/snippets/*.snippet. Propios: <userData>/local-tools/snippets/*.snippet
// Formato: cabecera entre "---" (clave: valor) y después el código con marcadores {{param}}.
//   params: nombre=defecto|Etiqueta; otro=defecto|Etiqueta
const fs = require('fs')
const os = require('os')
const path = require('path')
const { validateFile } = require('./validator')

const BUILTIN_DIR = path.join(__dirname, 'snippets')
const ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/
// Valores de parámetros: sin comillas, backticks, $, ;, &, |, llaves ni saltos de línea.
const PARAM_RE = /^[A-Za-z0-9 _.\-\/\\:@%#]{0,80}$/

function parseSnippet(text, custom) {
  const m = text.replace(/^﻿/, '').match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!m) return null
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  if (!ID_RE.test(meta.id || '') || !meta.title || !meta.language) return null
  const params = (meta.params || '').split(';').map(s => s.trim()).filter(Boolean).map(s => {
    const [def, label] = s.split('|')
    const eq = def.indexOf('=')
    return { name: def.slice(0, eq).trim(), default: def.slice(eq + 1).trim(), label: (label || def.slice(0, eq)).trim() }
  }).filter(p => /^\w+$/.test(p.name))
  return {
    id: custom ? 'custom-' + meta.id : meta.id,
    category: meta.category || 'Otros',
    title: meta.title,
    language: meta.language,
    description: meta.description || '',
    deps: (meta.deps || '').split(',').map(s => s.trim()).filter(Boolean),
    validate: meta.validate === 'js',
    params,
    code: m[2].replace(/\s+$/, '') + '\n',
    custom: !!custom,
  }
}

function loadDir(dir, custom) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.snippet')) continue
    try {
      const s = parseSnippet(fs.readFileSync(path.join(dir, f), 'utf8'), custom)
      if (s) out.push(s)
    } catch { /* snippet ilegible: se ignora */ }
  }
  return out
}

function loadAll(baseDir) {
  return [...loadDir(BUILTIN_DIR, false), ...loadDir(path.join(baseDir, 'snippets'), true)]
}

function listSnippets(baseDir) {
  const all = loadAll(baseDir)
  return {
    ok: true,
    customDir: path.join(baseDir, 'snippets'),
    snippets: all.map(({ code, ...rest }) => rest),
  }
}

function render(snippet, values = {}) {
  const used = {}
  for (const p of snippet.params) {
    const v = values[p.name] === undefined || values[p.name] === '' ? p.default : String(values[p.name])
    if (!PARAM_RE.test(v)) throw new Error(`Valor no permitido en "${p.label}" (sin comillas, $, ; & | ni llaves)`)
    used[p.name] = v
  }
  return snippet.code.replace(/\{\{(\w+)\}\}/g, (all, k) => (k in used ? used[k] : all))
}

// Valida sintaxis JS de un texto escribiéndolo en un archivo temporal (se borra siempre).
async function validateJsText(code) {
  const tmp = path.join(os.tmpdir(), `mcode_snip_${process.pid}_${Date.now()}.js`)
  try {
    fs.writeFileSync(tmp, code, 'utf8')
    return await validateFile(tmp)
  } finally {
    try { fs.unlinkSync(tmp) } catch {}
  }
}

function findSnippet(baseDir, id) {
  const s = loadAll(baseDir).find(x => x.id === id)
  if (!s) throw new Error('Snippet no encontrado')
  return s
}

async function renderSnippet(baseDir, id, values) {
  const s = findSnippet(baseDir, id)
  const code = render(s, values)
  let valid = true, validationError = ''
  if (s.validate) {
    const v = await validateJsText(code)
    valid = v.ok
    validationError = v.errors?.[0]?.message || ''
  }
  return { ok: true, code, language: s.language, deps: s.deps, valid, validationError }
}

module.exports = { listSnippets, renderSnippet, findSnippet, render, validateJsText, parseSnippet }
