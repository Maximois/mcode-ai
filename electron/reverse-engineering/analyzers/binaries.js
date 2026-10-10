const fs = require('fs')
const path = require('path')
const { SKIP_DIRS } = require('../constants')

const BINARY_EXT = new Set([
  'exe', 'dll', 'node', 'wasm', 'so', 'dylib', 'bin',
])

/**
 * Inventario de binarios / nativos en el repo (sin ejecutarlos). Base para reversing futuro.
 */
function analyzeBinaries(rootDir, { maxDepth = 6, maxList = 45, maxFilesScanned = 4000 } = {}) {
  const items = []
  let scanned = 0

  function walk(dir, depth) {
    if (depth > maxDepth || scanned >= maxFilesScanned || items.length >= maxList) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (scanned >= maxFilesScanned || items.length >= maxList) break
      if (e.name.startsWith('.')) continue
      if (SKIP_DIRS.has(e.name.toLowerCase())) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      scanned++
      const ext = e.name.includes('.') ? e.name.split('.').pop().toLowerCase() : ''
      if (!BINARY_EXT.has(ext)) continue
      try {
        const st = fs.statSync(full)
        const rel = path.relative(rootDir, full).replace(/\\/g, '/')
        items.push({ path: rel, bytes: st.size, ext })
      } catch {}
    }
  }

  walk(rootDir, 0)
  items.sort((a, b) => b.bytes - a.bytes)
  const nodeAddons = items.filter(i => i.ext === 'node')
  return {
    scannedFiles: scanned,
    binaries: items,
    nodeAddonCount: nodeAddons.length,
    hasWasm: items.some(i => i.ext === 'wasm'),
  }
}

module.exports = { analyzeBinaries }
