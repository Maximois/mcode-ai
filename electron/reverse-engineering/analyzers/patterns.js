const fs = require('fs')
const path = require('path')
const { SKIP_DIRS } = require('../constants')

const CODE_EXT = new Set(['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'vue'])

const RULES = [
  { id: 'eval', severity: 'error', re: /\beval\s*\(/g, label: 'eval()' },
  { id: 'new_function', severity: 'warn', re: /new\s+Function\s*\(/g, label: 'new Function()' },
  { id: 'innerhtml', severity: 'warn', re: /\.innerHTML\s*=/g, label: '.innerHTML =' },
  { id: 'ts_ignore', severity: 'info', re: /@ts-ignore|@ts-expect-error/g, label: '@ts-ignore / expect-error' },
  { id: 'eslint_disable', severity: 'info', re: /eslint-disable/g, label: 'eslint-disable' },
  { id: 'fixme', severity: 'info', re: /\b(FIXME|XXX|HACK)\b/gi, label: 'FIXME / HACK' },
  { id: 'todo', severity: 'info', re: /\bTODO\b/g, label: 'TODO' },
  { id: 'console_log', severity: 'info', re: /\bconsole\.(log|debug|info)\s*\(/g, label: 'console.log/debug/info' },
  { id: 'debugger', severity: 'warn', re: /\bdebugger\s*;/g, label: 'debugger;' },
]

const MAX_FILE = 400 * 1024
const MAX_FILES = 120

/**
 * Señales estáticas útiles para IA, revisión y hardening (no sustituye un linter).
 */
function analyzePatterns(rootDir, { maxDepth = 7 } = {}) {
  const totals = Object.fromEntries(RULES.map(r => [r.id, { count: 0, files: [] }]))
  let filesRead = 0

  function walk(dir, depth) {
    if (depth > maxDepth || filesRead >= MAX_FILES) return
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
      if (st.size > MAX_FILE) continue
      let text
      try {
        text = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      filesRead++
      const rel = path.relative(rootDir, full).replace(/\\/g, '/')
      for (const rule of RULES) {
        const matches = text.match(rule.re)
        if (!matches || matches.length === 0) continue
        const t = totals[rule.id]
        t.count += matches.length
        if (t.files.length < 8) t.files.push({ path: rel, hits: matches.length })
      }
    }
  }

  walk(rootDir, 0)

  const signals = []
  for (const rule of RULES) {
    const t = totals[rule.id]
    if (t.count === 0) continue
    signals.push({
      id: rule.id,
      severity: rule.severity,
      label: rule.label,
      count: t.count,
      sampleFiles: t.files.slice(0, 5),
    })
  }
  signals.sort((a, b) => {
    const rank = { error: 0, warn: 1, info: 2 }
    return rank[a.severity] - rank[b.severity] || b.count - a.count
  })

  return { filesScanned: filesRead, signals }
}

module.exports = { analyzePatterns }
