// Optimizador de CSS local (cero tokens, cero dependencias).
// Genera `archivo.min.css` junto a cada `archivo.css`; JAMÁS modifica el original.
// Minificación conservadora: quita comentarios y espacios sobrantes, y el último ";" antes de "}".
// No toca strings, url(...), comentarios /*! ... */ ni los espacios alrededor de : > + - ~ ( )
// (importantes para calc(), selectores y media queries). Cada resultado se verifica antes de aceptarlo.
const fs = require('fs')
const path = require('path')

const MARKER = '/*! min: M Code AI */'
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'build', 'out', '.venv', 'venv', '__pycache__', '.cache', '.vite', 'coverage'])
const MAX_FILE_BYTES = 1024 * 1024
const MAX_FILES = 500

const CUSTOM_RE = /--[^\s:;{}()]*\s*:/y

function minify(css) {
  const src = String(css).replace(/^﻿/, '')
  let out = ''
  let protectedSemi = -1 // posición de un ";" que no debe quitarse (valor de variable "solo espacio")
  let pending = false // hubo espacio/comentario entre el último token y el siguiente
  let i = 0
  const n = src.length

  const emit = (str) => {
    if (pending && out) {
      const last = out[out.length - 1], first = str[0]
      const dropped = '{};,'.includes(last) || '{};,'.includes(first)
      // "--x: ;" (valor vacío significativo): no quitar el espacio entre ":" y ";"/"}"
      const keep = last === ':' && (first === ';' || first === '}')
      if (!dropped || keep) out += ' '
    }
    pending = false
    out += str
  }

  while (i < n) {
    const c = src[i]
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2)
      if (end === -1) throw new Error('Comentario sin cerrar')
      if (src[i + 2] === '!') emit(src.slice(i, end + 2)) // comentarios de licencia: se conservan
      else pending = true
      i = end + 2
      continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++
        else if (src[j] === '\n') throw new Error('String sin cerrar')
        j++
      }
      if (j >= n) throw new Error('String sin cerrar')
      emit(src.slice(i, j + 1))
      i = j + 1
      continue
    }
    if ((c === 'u' || c === 'U') && /^url\(/i.test(src.slice(i, i + 4))) {
      let k = i + 4
      while (k < n && /\s/.test(src[k])) k++
      if (src[k] !== '"' && src[k] !== "'") {
        const close = src.indexOf(')', k)
        if (close === -1) throw new Error('url( sin cerrar')
        emit('url(' + src.slice(k, close).trim() + ')')
        i = close + 1
        continue
      }
      // url("...") con comillas: se procesa normal (el string se protege solo)
    }
    // Propiedad personalizada (--x: valor): su valor es una secuencia de tokens que el JavaScript de la
    // página puede leer tal cual, así que se copia SIN tocar los espacios internos (solo se recortan los extremos).
    if (c === '-' && src[i + 1] === '-' && (out.endsWith('{') || out.endsWith(';'))) {
      CUSTOM_RE.lastIndex = i
      const m = CUSTOM_RE.exec(src)
      if (m) {
        let j = i + m[0].length, depth = 0
        while (j < n) {
          const ch = src[j]
          if (ch === '"' || ch === "'") {
            j++
            while (j < n && src[j] !== ch) { if (src[j] === '\\') j++; j++ }
            if (j >= n) throw new Error('String sin cerrar')
          } else if (ch === '/' && src[j + 1] === '*') {
            const end = src.indexOf('*/', j + 2)
            if (end === -1) throw new Error('Comentario sin cerrar')
            j = end + 1
          } else if (ch === '(' || ch === '[' || ch === '{') depth++
          else if (ch === '}' && depth === 0) break
          else if (ch === ')' || ch === ']' || ch === '}') depth--
          else if (ch === ';' && depth === 0) break
          j++
        }
        const value = src.slice(i + m[0].length, j).trim()
        emit(m[0].replace(/\s+:$/, ':'))
        if (value === '') { out += ' '; protectedSemi = out.length } // valor "solo espacio": significativo, se conserva con su ";"
        else out += value
        i = j
        continue
      }
    }
    if (/\s/.test(c)) { pending = true; i++; continue }
    if (c === ';' && out.endsWith(';')) { i++; continue }      // ";;" = declaración vacía: sobra
    if (c === '}' && out.endsWith(';') && out.length - 1 !== protectedSemi) out = out.slice(0, -1) // último ";" innecesario
    emit(c)
    i++
  }
  return out.trim()
}

// Huella estructural para verificar que no se perdió ni se inventó nada importante.
function inspect(css) {
  const strings = []
  let braces = 0, parens = 0, i = 0
  const n = css.length
  const counts = { open: 0, close: 0 }
  while (i < n) {
    const c = css[i]
    if (c === '/' && css[i + 1] === '*') { const e = css.indexOf('*/', i + 2); i = e === -1 ? n : e + 2; continue }
    if (c === '"' || c === "'") {
      let j = i + 1
      while (j < n && css[j] !== c) { if (css[j] === '\\') j++; j++ }
      strings.push(css.slice(i, j + 1)); i = j + 1; continue
    }
    if (c === '{') { braces++; counts.open++ } else if (c === '}') { braces--; counts.close++ }
    else if (c === '(') parens++
    else if (c === ')') parens--
    i++
  }
  return { strings, braces, parens, counts, urls: (css.match(/url\(/gi) || []).length }
}

function verify(original, minified) {
  const a = inspect(original), b = inspect(minified)
  if (a.braces !== 0 || a.parens !== 0) return 'El CSS original tiene llaves o paréntesis sin balancear'
  if (JSON.stringify(a.strings) !== JSON.stringify(b.strings)) return 'Los textos entre comillas no coinciden'
  if (a.counts.open !== b.counts.open || a.counts.close !== b.counts.close) return 'Cambió la cantidad de llaves'
  if (a.urls !== b.urls) return 'Cambió la cantidad de url()'
  if (b.braces !== 0 || b.parens !== 0) return 'El resultado quedó desbalanceado'
  if (minify(minified) !== minified) return 'El resultado no es estable (se minificó distinto al repetir)'
  return ''
}

function walk(root) {
  const out = []
  const stack = [root]
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(full); continue }
      const lower = e.name.toLowerCase()
      if (e.isFile() && lower.endsWith('.css') && !lower.endsWith('.min.css')) out.push(full)
    }
  }
  return out
}

function planFile(root, file) {
  const rel = path.relative(root, file).replace(/\\/g, '/')
  const target = file.slice(0, -4) + '.min.css'
  const base = { rel, target: rel.slice(0, -4) + '.min.css' }
  let text
  try {
    const st = fs.statSync(file)
    if (st.size > MAX_FILE_BYTES) return { ...base, status: 'skip', reason: 'Archivo demasiado grande (>1 MB)', before: st.size, after: st.size }
    text = fs.readFileSync(file, 'utf8')
  } catch (e) { return { ...base, status: 'error', reason: e.message, before: 0, after: 0 } }

  const before = Buffer.byteLength(text)
  let min
  try { min = minify(text) } catch (e) { return { ...base, status: 'error', reason: e.message, before, after: before } }
  const problem = verify(text.replace(/^﻿/, ''), min)
  if (problem) return { ...base, status: 'error', reason: problem, before, after: before }

  const output = MARKER + '\n' + min + '\n'
  const after = Buffer.byteLength(output)
  if (after >= before) return { ...base, status: 'nosavings', reason: 'No reduce el tamaño', before, after }

  if (fs.existsSync(target)) {
    let head = ''
    try { head = fs.readFileSync(target, 'utf8').slice(0, MARKER.length) } catch { /* ilegible */ }
    // Solo se pisa un .min.css generado por esta herramienta; uno ajeno (p. ej. de una librería) se respeta
    if (head !== MARKER) return { ...base, status: 'exists', reason: 'Ya existe un .min.css que no generó esta herramienta', before, after }
  }
  return { ...base, status: 'ok', before, after, _output: output, _target: target }
}

function scanCss(rootIn) {
  const root = path.resolve(rootIn)
  const files = walk(root).map(f => planFile(root, f))
  const ok = files.filter(f => f.status === 'ok')
  return {
    ok: true,
    files: files.map(({ _output, _target, ...pub }) => pub).sort((a, b) => (b.before - b.after) - (a.before - a.after)),
    eligible: ok.length,
    savedBytes: ok.reduce((s, f) => s + (f.before - f.after), 0),
    truncated: files.length >= MAX_FILES,
  }
}

function applyCss(rootIn) {
  const root = path.resolve(rootIn)
  let written = 0, saved = 0
  const failed = []
  // Se recalcula todo aquí: no se confía en rutas que vengan de la interfaz.
  for (const f of walk(root).map(x => planFile(root, x))) {
    if (f.status !== 'ok') continue
    const target = path.resolve(f._target)
    if (!target.startsWith(root + path.sep)) { failed.push(f.rel); continue }
    try { fs.writeFileSync(target, f._output, 'utf8'); written++; saved += f.before - f.after } catch { failed.push(f.rel) }
  }
  return { ok: true, written, saved, failedCount: failed.length, failed: failed.slice(0, 10) }
}

module.exports = { scanCss, applyCss, minify, verify, MARKER }
