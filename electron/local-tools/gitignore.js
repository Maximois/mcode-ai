// Gestor visual de .gitignore: lee/escribe reglas sin que el usuario edite el texto a mano.
// Conserva comentarios y líneas en blanco; solo agrega o quita reglas puntuales.
const fs = require('fs')
const path = require('path')

const PRESETS = {
  node:     ['node_modules/', 'npm-debug.log', 'yarn-error.log', 'package-lock.json'],
  build:    ['dist/', 'dist-electron/', 'build/', 'out/'],
  secrets:  ['.env', '.env.*', '*.pem', '*.key', 'secrets.*'],
  binarios: ['*.exe', '*.msi', '*.dll', '*.node', '*.vsix', '*.zip', '*.db', '*.sqlite'],
  os:       ['.DS_Store', 'Thumbs.db', '*.log'],
  editores: ['.vscode/', '.idea/', '*.swp'],
}

function filePathFor(root) { return path.join(root, '.gitignore') }

function readRules(root) {
  const p = filePathFor(root)
  if (!fs.existsSync(p)) return { ok: true, exists: false, rules: [], presets: PRESETS }
  const text = fs.readFileSync(p, 'utf8')
  const rules = text.split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'))
  return { ok: true, exists: true, rules, presets: PRESETS }
}

function sanitizeRule(rule) {
  const r = String(rule || '').trim()
  if (!r || r.includes('\n') || r.includes('\r')) return null
  return r
}

function addRules(root, rules) {
  const p = filePathFor(root)
  const existing = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : ''
  const have = new Set(existing.split(/\r?\n/).map(l => l.trim()))
  const toAdd = [...new Set((rules || []).map(sanitizeRule).filter(Boolean))].filter(r => !have.has(r))
  if (!toAdd.length) return { ok: true, added: [] }
  const eol = existing.includes('\r\n') ? '\r\n' : '\n'
  const sep = existing && !existing.endsWith('\n') ? eol : ''
  fs.writeFileSync(p, existing + sep + toAdd.join(eol) + eol, 'utf8')
  return { ok: true, added: toAdd }
}

function removeRule(root, rule) {
  const p = filePathFor(root)
  if (!fs.existsSync(p)) return { ok: true, removed: false }
  const target = sanitizeRule(rule)
  if (!target) return { ok: false, error: 'Regla inválida' }
  const text = fs.readFileSync(p, 'utf8')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  const next = lines.filter(l => l.trim() !== target)
  if (next.length === lines.length) return { ok: true, removed: false }
  fs.writeFileSync(p, next.join(eol), 'utf8')
  return { ok: true, removed: true }
}

module.exports = { readRules, addRules, removeRule, PRESETS }
