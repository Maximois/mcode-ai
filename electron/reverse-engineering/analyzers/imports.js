const fs = require('fs')
const path = require('path')
const { SKIP_DIRS } = require('../constants')

const CODE_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs'])
const MAX_FILES = 100
const MAX_DEPTH = 8
const MAX_FILE_BYTES = 350 * 1024

// import ... from 'x' | import 'x' | require('x') | require("x")
const RE_IMPORT_FROM = /import\s+[^'"]*?\s+from\s+['"]([^'"]+)['"]/g
const RE_IMPORT_SIDE = /import\s+['"]([^'"]+)['"]/g
const RE_REQUIRE = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g
const RE_DYNAMIC_IMPORT = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g

function extractImports(text) {
  const relatives = []
  const packages = []
  const add = (spec) => {
    if (!spec) return
    if (spec.startsWith('.') || spec.startsWith('/')) relatives.push(spec)
    else packages.push(spec)
  }
  let m
  while ((m = RE_IMPORT_FROM.exec(text)) !== null) add(m[1])
  RE_IMPORT_FROM.lastIndex = 0
  while ((m = RE_IMPORT_SIDE.exec(text)) !== null) add(m[1])
  RE_IMPORT_SIDE.lastIndex = 0
  while ((m = RE_REQUIRE.exec(text)) !== null) add(m[1])
  RE_REQUIRE.lastIndex = 0
  while ((m = RE_DYNAMIC_IMPORT.exec(text)) !== null) add(m[1])
  RE_DYNAMIC_IMPORT.lastIndex = 0
  return { relatives, packages }
}

/**
 * Grafo liviano por regex (sin AST): hubs de imports y paquetes más referenciados.
 */
function analyzeImports(rootDir) {
  const perFile = []
  const pkgFreq = new Map()
  let filesRead = 0

  function walk(dir, depth) {
    if (depth > MAX_DEPTH || filesRead >= MAX_FILES) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (filesRead >= MAX_FILES) break
      if (e.name.startsWith('.')) continue
      if (SKIP_DIRS.has(e.name.toLowerCase())) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      const ext = e.name.includes('.') ? e.name.split('.').pop().toLowerCase() : ''
      if (!CODE_EXT.has(ext)) continue
      let st
      try {
        st = fs.statSync(full)
      } catch {
        continue
      }
      if (st.size > MAX_FILE_BYTES) continue
      let text
      try {
        text = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      filesRead++
      const rel = path.relative(rootDir, full).replace(/\\/g, '/')
      const { relatives, packages } = extractImports(text)
      const degree = relatives.length + packages.length
      for (const p of packages) {
        const base = p.split('/').slice(0, p.startsWith('@') ? 2 : 1).join('/')
        pkgFreq.set(base, (pkgFreq.get(base) || 0) + 1)
      }
      if (degree > 0) {
        perFile.push({
          path: rel,
          degree,
          relativeCount: relatives.length,
          packageCount: packages.length,
          sampleRel: relatives.slice(0, 4),
          samplePkg: packages.slice(0, 6),
        })
      }
    }
  }

  walk(rootDir, 0)
  perFile.sort((a, b) => b.degree - a.degree)
  const hubFiles = perFile.slice(0, 12)
  const topPackages = [...pkgFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([name, count]) => ({ name, count }))

  /** Pares débiles A↔B mismo directorio (heurística, no ciclo real completo) */
  const pairHints = []
  const topPaths = new Set(hubFiles.map(h => h.path))
  for (const a of hubFiles.slice(0, 8)) {
    for (const r of a.sampleRel || []) {
      if (!r.startsWith('.')) continue
      const dir = path.posix.dirname(a.path)
      const target = path.posix.normalize(path.posix.join(dir, r))
      const candidates = [`${target}.js`, `${target}.jsx`, `${target}.ts`, `${target}.tsx`, `${target}/index.js`]
      for (const c of candidates) {
        if (topPaths.has(c)) {
          pairHints.push({ from: a.path, to: c, via: r })
          break
        }
      }
    }
  }

  return {
    filesScanned: filesRead,
    hubFiles,
    topPackages,
    couplingHints: pairHints.slice(0, 10),
  }
}

module.exports = { analyzeImports }
