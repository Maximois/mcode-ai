// Indexador local de código (cero tokens): lista clases, funciones, métodos y exports de un archivo.
// Basado en expresiones regulares línea a línea: rápido y sin dependencias, pero aproximado.
const fs = require('fs')
const path = require('path')

const MAX_BYTES = 1024 * 1024
const JS_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'])
const NOT_METHODS = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'do', 'try', 'with', 'await', 'typeof', 'new', 'super'])

function indentOf(line) { return line.match(/^[ \t]*/)[0].replace(/\t/g, '  ').length }

function indexJs(text) {
  const symbols = []
  const lines = text.split(/\r?\n/)
  let cls = null // { name, indent }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    if (!t || t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) continue
    const ind = indentOf(line)
    if (cls && ind <= cls.indent && !t.startsWith('}')) cls = null
    if (cls && ind <= cls.indent && t.startsWith('}')) { cls = null; continue }
    const n = i + 1
    let m

    if ((m = line.match(/^\s*(export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/))) {
      symbols.push({ kind: 'class', name: m[2], line: n, exported: !!m[1] })
      cls = { name: m[2], indent: ind }
      continue
    }
    if ((m = line.match(/^\s*(export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/))) {
      symbols.push({ kind: 'function', name: m[2], line: n, exported: !!m[1] })
      continue
    }
    if ((m = line.match(/^\s*(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*(?::[^=]+)?=>|[A-Za-z_$][\w$]*\s*=>)/))) {
      symbols.push({ kind: 'function', name: m[2], line: n, exported: !!m[1] })
      continue
    }
    if (cls && ind > cls.indent && (m = line.match(/^\s*(?:(?:public|private|protected|static|async|get|set|readonly)\s+)*([A-Za-z_$#][\w$]*)\s*\([^)]*\)\s*(?::[^{]+)?\{/)) && !NOT_METHODS.has(m[1])) {
      symbols.push({ kind: 'method', name: `${cls.name}.${m[1]}`, line: n, exported: false })
      continue
    }
    if (/^\s*export\s+default\b/.test(line)) { symbols.push({ kind: 'export', name: 'default', line: n, exported: true }); continue }
    if (/^\s*module\.exports\s*=/.test(line)) { symbols.push({ kind: 'export', name: 'module.exports', line: n, exported: true }); continue }
    if ((m = line.match(/^\s*exports\.([A-Za-z_$][\w$]*)\s*=/))) { symbols.push({ kind: 'export', name: m[1], line: n, exported: true }); continue }
  }
  return symbols
}

function indexPython(text) {
  const symbols = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    let m
    if ((m = lines[i].match(/^(\s*)class\s+(\w+)/))) symbols.push({ kind: 'class', name: m[2], line: i + 1, exported: m[1].length === 0 })
    else if ((m = lines[i].match(/^(\s*)(?:async\s+)?def\s+(\w+)/))) symbols.push({ kind: m[1].length ? 'method' : 'function', name: m[2], line: i + 1, exported: m[1].length === 0 && !m[2].startsWith('_') })
  }
  return symbols
}

function indexFile(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const isPy = ext === '.py'
  if (!isPy && !JS_EXT.has(ext)) return { ok: true, supported: false, symbols: [] }
  let st
  try { st = fs.statSync(filePath) } catch (e) { return { ok: false, error: e.message } }
  if (!st.isFile() || st.size > MAX_BYTES) return { ok: true, supported: false, symbols: [] }
  const text = fs.readFileSync(filePath, 'utf8')
  return { ok: true, supported: true, language: isPy ? 'python' : 'javascript', lines: text.split('\n').length, symbols: isPy ? indexPython(text) : indexJs(text) }
}

module.exports = { indexFile, indexJs, indexPython }
