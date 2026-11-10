// Validador local de sintaxis (cero tokens, sin llamar a ninguna API).
// Soporta: .json, .yml/.yaml (chequeo ligero), .js/.mjs/.cjs (node --check).
const fs = require('fs')
const path = require('path')
const { spawn } = require('child_process')

const MAX_BYTES = 2 * 1024 * 1024 // no validar archivos gigantes

function lineColFromPos(text, pos) {
  const before = text.slice(0, pos)
  const lines = before.split('\n')
  return { line: lines.length, col: lines[lines.length - 1].length + 1 }
}

function validateJson(text) {
  try {
    JSON.parse(text)
    return []
  } catch (e) {
    const msg = String(e.message || e)
    let line = 1, col = 1
    const lc = msg.match(/line (\d+) column (\d+)/)
    const pos = msg.match(/position (\d+)/)
    if (lc) { line = Number(lc[1]); col = Number(lc[2]) }
    else if (pos) ({ line, col } = lineColFromPos(text, Number(pos[1])))
    return [{ line, col, message: msg.replace(/\s*\(line \d+ column \d+\)/, '') }]
  }
}

// Chequeo ligero de YAML: tabs de indentación, comillas sin cerrar, corchetes
// de flujo sin cerrar y claves duplicadas al mismo nivel. NO reemplaza a un parser completo.
function validateYaml(text) {
  const errors = []
  const lines = text.split(/\r?\n/)
  const keysByIndent = new Map() // indent -> Set(keys) del bloque actual
  let inBlockScalar = false
  let blockIndent = 0

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const n = i + 1
    if (/^\s*#/.test(raw) || raw.trim() === '') continue
    if (raw.trim() === '---' || raw.trim() === '...') { keysByIndent.clear(); inBlockScalar = false; continue }

    const indent = raw.match(/^ */)[0].length

    if (inBlockScalar) {
      if (indent > blockIndent) continue
      inBlockScalar = false
    }

    if (/^\s*\t/.test(raw)) {
      errors.push({ line: n, col: 1, message: 'Tabulador en la indentación (YAML solo admite espacios)' })
      continue
    }

    const m = raw.match(/^(\s*)(?:-\s+)?("[^"]*"|'[^']*'|[^\s:#'"][^:#]*?)\s*:(?:\s+(.*))?$/)
    if (m) {
      const key = m[2].trim()
      let value = (m[3] || '').replace(/\s+#.*$/, '').trim()
      // limpiar claves de niveles más profundos
      for (const k of [...keysByIndent.keys()]) if (k > indent) keysByIndent.delete(k)
      const set = keysByIndent.get(indent) || new Set()
      if (!raw.trimStart().startsWith('- ')) {
        if (set.has(key)) errors.push({ line: n, col: indent + 1, message: `Clave duplicada: "${key}"` })
        set.add(key)
        keysByIndent.set(indent, set)
      }
      if (/^[|>][+-]?\d*$/.test(value)) { inBlockScalar = true; blockIndent = indent; continue }
      if (value) {
        const q = value[0]
        if ((q === '"' || q === "'") && !(value.length > 1 && value.endsWith(q))) {
          errors.push({ line: n, col: raw.indexOf(value) + 1, message: `Comilla ${q} sin cerrar` })
        } else if (q === '[' || q === '{') {
          const open = (value.match(/[\[{]/g) || []).length
          const close = (value.match(/[\]}]/g) || []).length
          if (open !== close) errors.push({ line: n, col: raw.indexOf(value) + 1, message: 'Corchete/llave sin cerrar en una sola línea' })
        }
      }
    }
  }
  return errors
}

function validateJsSyntax(filePath) {
  return new Promise((resolve) => {
    // process.execPath + ELECTRON_RUN_AS_NODE funciona tanto en dev como empaquetado
    const child = spawn(process.execPath, ['--check', filePath], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true,
    })
    let stderr = ''
    const timer = setTimeout(() => { try { child.kill() } catch {} }, 8000)
    child.stderr.on('data', d => { stderr += d.toString() })
    child.on('error', () => { clearTimeout(timer); resolve([]) })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) return resolve([])
      // Formato: "<archivo>:<línea>\n<código>\n   ^^^\n\nSyntaxError: <mensaje>"
      const lineM = stderr.match(/:(\d+)\r?\n/)
      const msgM = stderr.match(/(SyntaxError:[^\r\n]*)/)
      resolve([{
        line: lineM ? Number(lineM[1]) : 1,
        col: 1,
        message: (msgM ? msgM[1] : stderr.trim().split('\n').pop()) || 'Error de sintaxis',
      }])
    })
  })
}

const SUPPORTED = new Set(['.json', '.yml', '.yaml', '.js', '.mjs', '.cjs'])

function isSupported(filePath) {
  return SUPPORTED.has(path.extname(filePath).toLowerCase())
}

/**
 * Valida un archivo en disco. Devuelve { ok, supported, kind, errors:[{line,col,message}] }.
 */
async function validateFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  if (!SUPPORTED.has(ext)) return { ok: true, supported: false, kind: ext.slice(1), errors: [] }
  let stat
  try { stat = fs.statSync(filePath) } catch (e) {
    // Archivo borrado/renombrado: no es un error de sintaxis
    if (e && e.code === 'ENOENT') return { ok: true, supported: false, kind: ext.slice(1), errors: [] }
    return { ok: false, supported: true, kind: ext.slice(1), errors: [{ line: 1, col: 1, message: e.message }] }
  }
  if (!stat.isFile() || stat.size > MAX_BYTES) return { ok: true, supported: false, kind: ext.slice(1), errors: [] }

  let errors = []
  if (ext === '.json') errors = validateJson(fs.readFileSync(filePath, 'utf8').replace(/^﻿/, ''))
  else if (ext === '.yml' || ext === '.yaml') errors = validateYaml(fs.readFileSync(filePath, 'utf8'))
  else errors = await validateJsSyntax(filePath)

  return { ok: errors.length === 0, supported: true, kind: ext.slice(1), errors }
}

module.exports = { validateFile, validateJson, validateYaml, isSupported }
