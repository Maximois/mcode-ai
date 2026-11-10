// Escáner local de secretos hardcodeados (cero tokens). Nunca devuelve el secreto completo:
// solo una versión enmascarada, para que el panel no filtre credenciales por la UI/logs.
const fs = require('fs')
const path = require('path')

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'build', 'out', '.venv', 'venv', '__pycache__', '.cache', '.vite', 'coverage'])
const SKIP_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.7z', '.rar', '.exe', '.dll', '.node', '.db', '.sqlite', '.vsix', '.asar', '.woff', '.woff2', '.ttf', '.mp3', '.mp4', '.wasm', '.lock'])
const MAX_FILE_BYTES = 1024 * 1024
const MAX_FINDINGS = 500

const RULES = [
  { id: 'private-key',   label: 'Clave privada',            re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { id: 'aws-access',    label: 'AWS Access Key',           re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: 'github-token',  label: 'Token de GitHub',          re: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{30,}\b/ },
  { id: 'google-api',    label: 'API key de Google/Gemini', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: 'groq-key',      label: 'API key de Groq',          re: /\bgsk_[A-Za-z0-9]{30,}\b/ },
  { id: 'openai-style',  label: 'API key tipo sk-',         re: /\bsk-(?:proj-|or-v1-|ant-)?[A-Za-z0-9_-]{32,}\b/ },
  { id: 'slack-token',   label: 'Token de Slack',           re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { id: 'jwt',           label: 'JWT',                      re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { id: 'generic-assign', label: 'Credencial asignada',
    re: /\b(?:api[_-]?key|secret|token|passwd|password|auth)[\w-]*\s*[:=]\s*["']([A-Za-z0-9_\-\/+=.]{16,})["']/i,
    group: 1 },
]

function mask(s) {
  if (s.length <= 8) return '****'
  return s.slice(0, 4) + '…' + s.slice(-2) + ` (${s.length} car.)`
}

function looksLikePlaceholder(v) {
  return /^(?:x+|\*+|your[_-]?|<.*>|\$\{.*\}|process\.env|example|changeme|placeholder|todo)/i.test(v) || /^(.)\1{7,}$/.test(v)
}

function scanText(text, relPath) {
  const out = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (line.length > 2000) continue
    for (const rule of RULES) {
      const m = line.match(rule.re)
      if (!m) continue
      const value = rule.group ? m[rule.group] : m[0]
      if (rule.group && looksLikePlaceholder(value)) continue
      out.push({ file: relPath, line: i + 1, rule: rule.id, label: rule.label, preview: mask(value) })
      break
    }
  }
  return out
}

function scanDir(root) {
  const findings = []
  let scanned = 0
  let truncated = false
  const stack = [root]
  while (stack.length) {
    const dir = stack.pop()
    let entries
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { continue }
    for (const e of entries) {
      if (findings.length >= MAX_FINDINGS) { truncated = true; break }
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full)
        continue
      }
      if (!e.isFile()) continue
      if (SKIP_EXT.has(path.extname(e.name).toLowerCase())) continue
      let st
      try { st = fs.statSync(full) } catch { continue }
      if (st.size > MAX_FILE_BYTES) continue
      let text
      try { text = fs.readFileSync(full, 'utf8') } catch { continue }
      if (text.includes('\u0000')) continue // binario
      scanned++
      findings.push(...scanText(text, path.relative(root, full).replace(/\\/g, '/')))
    }
    if (truncated) break
  }
  return { ok: true, scanned, truncated, findings }
}

module.exports = { scanDir, scanText }
