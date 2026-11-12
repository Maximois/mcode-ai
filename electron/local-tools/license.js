// Inyector de encabezados de copyright/licencia (cero tokens). Idempotente: no toca archivos
// que ya tienen "Copyright" o "SPDX-License-Identifier" en las primeras líneas.
const fs = require('fs')
const path = require('path')

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'build', 'out', '.venv', 'venv', '__pycache__', '.cache', '.vite', 'coverage'])
const BLOCK_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.css', '.scss'])
const HASH_EXT = new Set(['.py'])
const MAX_FILES = 2000
const MAX_BYTES = 1024 * 1024
const LICENSES = new Set(['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'GPL-3.0-only', 'Proprietary'])

function headerText({ holder, year, license }) {
  const lines = [`Copyright (c) ${year} ${holder}`]
  lines.push(license === 'Proprietary' ? 'Todos los derechos reservados.' : `SPDX-License-Identifier: ${license}`)
  return lines
}

function buildHeader(ext, opts, eol) {
  const lines = headerText(opts)
  if (HASH_EXT.has(ext)) return lines.map(l => '# ' + l).join(eol) + eol
  return ['/**', ...lines.map(l => ' * ' + l), ' */'].join(eol) + eol
}

function hasHeader(text) {
  return /copyright|spdx-license-identifier/i.test(text.slice(0, 600))
}

function insertHeader(text, ext, opts) {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const header = buildHeader(ext, opts, eol)
  const lines = text.split(/\r?\n/)
  // Preservar shebang y declaración de encoding de Python en las primeras líneas
  let keep = 0
  if (lines[0] && lines[0].startsWith('#!')) keep = 1
  if (HASH_EXT.has(ext) && lines[keep] && /coding[:=]/.test(lines[keep])) keep++
  const head = lines.slice(0, keep).join(eol)
  const rest = lines.slice(keep).join(eol)
  return (head ? head + eol : '') + header + (rest.startsWith(eol) ? '' : eol) + rest
}

function normalizeOpts(o) {
  const holder = String(o.holder || '').replace(/[\r\n*/]/g, ' ').trim().slice(0, 80)
  if (!holder) throw new Error('Falta el titular del copyright')
  const license = LICENSES.has(o.license) ? o.license : 'MIT'
  const year = /^\d{4}(-\d{4})?$/.test(String(o.year || '')) ? String(o.year) : String(new Date().getFullYear())
  return { holder, license, year }
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
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) stack.push(full); continue }
      const ext = path.extname(e.name).toLowerCase()
      if (e.isFile() && (BLOCK_EXT.has(ext) || HASH_EXT.has(ext))) out.push(full)
    }
  }
  return out
}

function planLicense(root, rawOpts) {
  const opts = normalizeOpts(rawOpts)
  const targets = []
  let skipped = 0
  for (const f of walk(root)) {
    try {
      const st = fs.statSync(f)
      if (st.size > MAX_BYTES) { skipped++; continue }
      if (hasHeader(fs.readFileSync(f, 'utf8'))) { skipped++; continue }
      targets.push(f)
    } catch { skipped++ }
  }
  return { opts, targets, skipped }
}

function previewLicense(root, rawOpts) {
  const { opts, targets, skipped } = planLicense(root, rawOpts)
  return { ok: true, count: targets.length, skipped, sample: targets.slice(0, 8).map(f => path.relative(root, f).replace(/\\/g, '/')), example: buildHeader('.js', opts, '\n') }
}

function applyLicense(root, rawOpts) {
  const { opts, targets } = planLicense(root, rawOpts)
  let written = 0
  for (const f of targets) {
    const ext = path.extname(f).toLowerCase()
    fs.writeFileSync(f, insertHeader(fs.readFileSync(f, 'utf8'), ext, opts), 'utf8')
    written++
  }
  return { ok: true, written }
}

module.exports = { previewLicense, applyLicense, LICENSES: [...LICENSES] }
