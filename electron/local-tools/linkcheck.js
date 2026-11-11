// Verificador local de enlaces/rutas relativas (cero tokens): recorre src="", href="", url(...)
// en HTML, CSS, JSX/TSX y Vue, y marca los que apuntan a archivos que no existen.
// Es aproximado (regex línea a línea): ignora URLs externas, data:, anclas y rutas dinámicas.
const fs = require('fs')
const path = require('path')

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'build', 'out', '.venv', 'venv', '__pycache__', '.cache', '.vite', 'coverage'])
const EXT = new Set(['.html', '.htm', '.css', '.jsx', '.tsx', '.vue'])
const MAX_FILE_BYTES = 1024 * 1024
const MAX_FILES = 3000
const MAX_FINDINGS = 300

const ATTR_RE = /\b(?:src|href|poster|data-src)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const SRCSET_RE = /\bsrcset\s*=\s*(?:"([^"]*)"|'([^']*)')/gi
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]+))\s*\)/gi

function skipRef(ref) {
  const r = ref.trim()
  return !r ||
    r.startsWith('#') ||
    /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(r) ||      // http:, https:, data:, mailto:, tel:, javascript:, //cdn...
    /[{}$]|<%|%>/.test(r) ||                          // plantillas / rutas dinámicas
    /^\s*\+|\+\s*$/.test(r)                           // concatenaciones sueltas
}

function candidates(root, fileDir, ref) {
  const clean = ref.split('#')[0].split('?')[0]
  let decoded = clean
  try { decoded = decodeURIComponent(clean) } catch { /* se deja tal cual */ }
  if (!decoded) return null
  if (decoded.startsWith('/')) {
    // Raíz del sitio: en proyectos Vite puede ser la raíz o public/
    return [path.join(root, decoded), path.join(root, 'public', decoded)]
  }
  return [path.resolve(fileDir, decoded)]
}

// En Windows el sistema de archivos ignora mayúsculas, pero en Linux/servidores no:
// avisamos si el nombre real difiere del escrito.
function caseMismatch(full) {
  try {
    const real = fs.realpathSync.native(full)
    const a = real.split(/[\\/]/).slice(-3).join('/')
    const b = full.split(/[\\/]/).slice(-3).join('/')
    return a !== b && a.toLowerCase() === b.toLowerCase() ? a : null
  } catch { return null }
}

function checkRef(root, fileDir, ref) {
  if (skipRef(ref)) return null
  const cands = candidates(root, fileDir, ref)
  if (!cands) return null
  for (const c of cands) {
    if (c !== root && !c.startsWith(root + path.sep)) continue // fuera del proyecto: no se evalúa
    if (fs.existsSync(c)) {
      const real = caseMismatch(c)
      return real ? { kind: 'case', detail: `existe como "${path.basename(real)}" (distinto uso de mayúsculas)` } : null
    }
  }
  // Rutas absolutas que salen del proyecto no se consideran rotas: no podemos saberlo
  const inside = cands.some(c => c === root || c.startsWith(root + path.sep))
  return inside ? { kind: 'missing', detail: 'no existe' } : null
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
      if (e.isFile() && EXT.has(path.extname(e.name).toLowerCase())) out.push(full)
    }
  }
  return out
}

function scanLinks(rootIn) {
  const root = path.resolve(rootIn)
  const findings = []
  let checked = 0, scanned = 0, truncated = false
  for (const file of walk(root)) {
    let text
    try {
      if (fs.statSync(file).size > MAX_FILE_BYTES) continue
      text = fs.readFileSync(file, 'utf8')
    } catch { continue }
    scanned++
    const fileDir = path.dirname(file)
    const lines = text.split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (line.length > 3000) continue
      const refs = []
      for (const re of [ATTR_RE, CSS_URL_RE]) {
        re.lastIndex = 0
        let m
        while ((m = re.exec(line))) refs.push(m[1] ?? m[2] ?? m[3] ?? '')
      }
      SRCSET_RE.lastIndex = 0
      let sm
      while ((sm = SRCSET_RE.exec(line))) {
        for (const part of (sm[1] ?? sm[2] ?? '').split(',')) refs.push(part.trim().split(/\s+/)[0])
      }
      for (const ref of refs) {
        const problem = checkRef(root, fileDir, ref)
        checked++
        if (!problem) continue
        if (findings.length >= MAX_FINDINGS) { truncated = true; break }
        findings.push({ file: path.relative(root, file).replace(/\\/g, '/'), line: i + 1, ref: ref.slice(0, 120), ...problem })
      }
      if (truncated) break
    }
    if (truncated) break
  }
  return { ok: true, scanned, checked, findings, truncated }
}

module.exports = { scanLinks }
