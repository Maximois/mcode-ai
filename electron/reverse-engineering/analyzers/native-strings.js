const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

function stringsAvailable() {
  try {
    const r = spawnSync('strings', ['--version'], {
      encoding: 'utf8',
      timeout: 4000,
      windowsHide: true,
    })
    return !r.error && r.status === 0
  } catch {
    return false
  }
}

function fileBrief(fullPath) {
  try {
    const r = spawnSync('file', ['-b', fullPath], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 8192,
      windowsHide: true,
    })
    if (r.error?.code === 'ENOENT') return null
    const t = String(r.stdout || '').trim()
    return t || null
  } catch {
    return null
  }
}

/**
 * Muestreo strings(1) + file(1) sobre binarios ya inventariados (sin ejecutarlos).
 */
function previewBinaryStrings(rootDir, binaryEntries, { maxFiles = 3, maxLines = 36, minLen = 8 } = {}) {
  if (!binaryEntries?.length) return { skipped: true, reason: 'no_binaries' }
  const toolStrings = stringsAvailable()
  const sorted = [...binaryEntries].sort((a, b) => b.bytes - a.bytes).slice(0, maxFiles)
  const samples = []

  for (const ent of sorted) {
    const full = path.join(rootDir, ent.path.replace(/\//g, path.sep))
    if (!fs.existsSync(full)) continue

    const row = {
      path: ent.path,
      ext: ent.ext,
      bytes: ent.bytes,
      fileType: fileBrief(full),
      stringsLines: null,
    }

    if (toolStrings) {
      try {
        const r = spawnSync('strings', ['-n', String(minLen), full], {
          encoding: 'utf8',
          timeout: 20000,
          maxBuffer: 512 * 1024,
          windowsHide: true,
        })
        if (!r.error && r.stdout) {
          row.stringsLines = String(r.stdout)
            .split(/\r?\n/)
            .filter(Boolean)
            .slice(0, maxLines)
            .join('\n')
        }
      } catch {}
    }
    samples.push(row)
  }

  if (samples.length === 0) {
    return { skipped: true, reason: 'no_matching_files', stringsAvailable: toolStrings, samples: [] }
  }

  return {
    skipped: false,
    stringsAvailable: toolStrings,
    samples,
  }
}

module.exports = { previewBinaryStrings, stringsAvailable }
