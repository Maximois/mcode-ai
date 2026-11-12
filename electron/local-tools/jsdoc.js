// Autodocumentador JSDoc local (cero tokens): inserta bloques /** */ esqueleto sobre funciones
// JS/TS sin documentar. La descripción sale del nombre; una IA ligera puede pulirla después.
const fs = require('fs')
const path = require('path')

const JS_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])
const MAX_BYTES = 1024 * 1024

const FN_RE = /^(\s*)(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/
const ARROW_RE = /^(\s*)(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\s*\(([^)]*)\)|\(([^)]*)\)\s*(?::[^=]+)?=>|([A-Za-z_$][\w$]*)\s*=>)/

function humanize(name) {
  const s = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_$]+/g, ' ').trim().toLowerCase()
  return s ? s[0].toUpperCase() + s.slice(1) + '.' : 'Descripción.'
}

function splitParams(src) {
  const out = []
  let depth = 0, cur = ''
  for (const ch of src) {
    if ('([{<'.includes(ch)) depth++
    else if (')]}>'.includes(ch)) depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out.map(s => s.trim()).filter(Boolean)
}

function paramDoc(p, idx) {
  let m
  if (p.startsWith('...')) return ` * @param {...*} ${p.slice(3).split(/[:=]/)[0].trim() || 'args'}`
  if (p.startsWith('{') || p.startsWith('[')) return ` * @param {Object} ${idx === 0 ? 'options' : 'arg' + idx}`
  const hasDefault = p.includes('=')
  const namePart = p.split('=')[0]
  m = namePart.match(/^([A-Za-z_$][\w$]*)\??\s*(?::\s*(.+))?$/)
  const name = m ? m[1] : 'arg' + idx
  const type = m && m[2] ? m[2].trim() : '*'
  const optional = hasDefault || /\?\s*(?::|$)/.test(namePart)
  return ` * @param {${type}} ${optional ? `[${name}]` : name}`
}

function indentOf(line) { return line.match(/^[ \t]*/)[0] }

function hasReturn(lines, i, indent, arrowExpr) {
  if (arrowExpr) return true
  for (let j = i + 1; j < Math.min(lines.length, i + 200); j++) {
    const l = lines[j]
    if (!l.trim()) continue
    if (indentOf(l).length <= indent.length && /^\s*}/.test(l)) return false
    if (/\breturn\s+[^;\s]/.test(l)) return true
  }
  return false
}

// Código de la función que empieza en la línea i: se corta cuando se cierran sus llaves
// (aproximado: no distingue llaves dentro de strings) o a las 20 líneas.
function sliceFunction(lines, i) {
  let depth = 0, seen = false
  const out = []
  for (let j = i; j < Math.min(lines.length, i + 20); j++) {
    out.push(lines[j])
    for (const ch of lines[j]) {
      if (ch === '{') { depth++; seen = true } else if (ch === '}') depth--
    }
    if (!seen && j === i && !/[({,]\s*$/.test(lines[j].trimEnd())) break // arrow de una expresión
    if (seen && depth <= 0) break
  }
  return out.join('\n')
}

function isDocumented(lines, i) {
  for (let j = i - 1; j >= 0; j--) {
    const t = lines[j].trim()
    if (!t) return false
    if (t.startsWith('@') || t.startsWith('//')) continue
    return t.endsWith('*/')
  }
  return false
}

function buildPlan(text) {
  const lines = text.split(/\r?\n/)
  const plan = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
    let m, name, params = '', arrowExpr = false, indent
    if ((m = line.match(FN_RE))) { indent = m[1]; name = m[2]; params = m[3] }
    else if ((m = line.match(ARROW_RE))) {
      indent = m[1]; name = m[2]
      params = m[3] ?? m[4] ?? m[5] ?? ''
      arrowExpr = /=>\s*[^{\s]/.test(line.slice(line.indexOf('=>')))
    } else continue
    if (isDocumented(lines, i)) continue
    const paramLines = splitParams(params).map(paramDoc)
    const body = [`${indent}/**`, `${indent} * ${humanize(name)}`]
    if (paramLines.length) body.push(`${indent} *`, ...paramLines.map(l => indent + l))
    if (/\breturn\s+[^;\s}]/.test(line) || hasReturn(lines, i, indent, arrowExpr)) body.push(`${indent} * @returns {*}`)
    body.push(`${indent} */`)
    plan.push({ line: i + 1, name, block: body.join('\n'), _lines: body, _indent: indent, source: sliceFunction(lines, i) })
  }
  return { lines, plan }
}

function loadJs(filePath) {
  if (!JS_EXT.has(path.extname(filePath).toLowerCase())) return { error: 'Solo se documentan archivos JS/TS' }
  const st = fs.statSync(filePath)
  if (!st.isFile() || st.size > MAX_BYTES) return { error: 'Archivo no válido o demasiado grande' }
  return { text: fs.readFileSync(filePath, 'utf8') }
}

function previewJsdoc(filePath) {
  const r = loadJs(filePath)
  if (r.error) return { ok: false, error: r.error }
  const { plan } = buildPlan(r.text)
  return { ok: true, count: plan.length, items: plan.slice(0, 50).map(({ line, name, block }) => ({ line, name, block })) }
}

// Funciones sin documentar con su código, para que el redactor local escriba la descripción.
function itemsForWriter(filePath) {
  const r = loadJs(filePath)
  if (r.error) return { ok: false, error: r.error }
  const { plan } = buildPlan(r.text)
  return { ok: true, items: plan.map(({ name, source }) => ({ name, source })) }
}

function safeDescription(s) {
  return String(s || '').split('\n')[0].replace(/\*\//g, '').replace(/\/\*/g, '').trim().slice(0, 120)
}

// Inserta de abajo hacia arriba para no desplazar las líneas pendientes.
// descs (opcional): { nombreFuncion: 'descripción' } reemplaza la descripción generada del nombre.
function applyJsdoc(filePath, descs) {
  const r = loadJs(filePath)
  if (r.error) return { ok: false, error: r.error }
  const eol = r.text.includes('\r\n') ? '\r\n' : '\n'
  const { lines, plan } = buildPlan(r.text)
  if (!plan.length) return { ok: true, inserted: 0 }
  if (descs && typeof descs === 'object') {
    for (const item of plan) {
      const d = safeDescription(Object.prototype.hasOwnProperty.call(descs, item.name) ? descs[item.name] : '')
      if (d) item._lines[1] = `${item._indent} * ${d}`
    }
  }
  for (const item of [...plan].reverse()) lines.splice(item.line - 1, 0, ...item._lines)
  fs.writeFileSync(filePath, lines.join(eol), 'utf8')
  return { ok: true, inserted: plan.length }
}

module.exports = { previewJsdoc, applyJsdoc, buildPlan, itemsForWriter }
