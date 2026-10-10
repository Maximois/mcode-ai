const fs = require('fs')
const path = require('path')
const { SKIP_DIRS } = require('../constants')

const TEXT_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue', 'svelte', 'css', 'scss', 'less', 'html', 'json', 'md'])

/**
 * Archivos más grandes y conteo por extensión (pistas de optimización / bundle).
 */
function analyzeHotspots(rootDir, { maxDepth = 8, maxFilesScanned = 2500, topN = 18 } = {}) {
  const byExt = {}
  const files = []
  let scanned = 0

  function walk(dir, depth) {
    if (depth > maxDepth || scanned >= maxFilesScanned) return
    let entries
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (scanned >= maxFilesScanned) break
      if (e.name.startsWith('.')) continue
      const low = e.name.toLowerCase()
      if (SKIP_DIRS.has(low)) continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        walk(full, depth + 1)
        continue
      }
      scanned++
      const ext = e.name.includes('.') ? e.name.split('.').pop().toLowerCase() : ''
      byExt[ext || '_none'] = (byExt[ext || '_none'] || 0) + 1
      if (!TEXT_EXT.has(ext)) continue
      try {
        const st = fs.statSync(full)
        if (st.size > 512 * 1024 * 1024) continue
        const rel = path.relative(rootDir, full).replace(/\\/g, '/')
        files.push({ path: rel, bytes: st.size, ext })
      } catch {}
    }
  }

  walk(rootDir, 0)
  files.sort((a, b) => b.bytes - a.bytes)
  const largest = files.slice(0, topN)
  const extSummary = Object.entries(byExt)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 14)
    .map(([ext, count]) => ({ ext: ext === '_none' ? '(sin ext)' : `.${ext}`, count }))

  return {
    scannedFiles: scanned,
    largestTextFiles: largest,
    extensionCounts: extSummary,
  }
}

module.exports = { analyzeHotspots }
