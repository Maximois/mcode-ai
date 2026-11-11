// Versionado SemVer y changelog local (cero tokens).
// - Sube la versión de package.json / manifest.json cambiando SOLO el valor de "version"
//   (conserva formato, orden y saltos de línea) y comprueba el resultado antes de guardarlo.
// - Prepara una sección de CHANGELOG.md a partir de los commits de git (convención "tipo: texto").
const fs = require('fs')
const path = require('path')
const { execFile } = require('child_process')

const MANIFESTS = ['package.json', 'manifest.json']
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
const LEVELS = new Set(['patch', 'minor', 'major'])

function parseVersion(v) {
  const m = String(v || '').match(SEMVER_RE)
  return m ? { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] || '' } : null
}

function bump(version, level) {
  const p = parseVersion(version)
  if (!p) throw new Error(`La versión "${version}" no es SemVer (esperado X.Y.Z)`)
  if (!LEVELS.has(level)) throw new Error('Nivel inválido (patch, minor o major)')
  if (level === 'major') return `${p.major + 1}.0.0`
  if (level === 'minor') return `${p.major}.${p.minor + 1}.0`
  // patch: si es una prerelease (1.2.3-beta.1) el patch "libera" la versión base
  return p.pre ? `${p.major}.${p.minor}.${p.patch}` : `${p.major}.${p.minor}.${p.patch + 1}`
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}

function info(root) {
  const files = []
  for (const name of MANIFESTS) {
    const full = path.join(root, name)
    if (!fs.existsSync(full)) continue
    const j = readJson(full)
    if (!j || typeof j.version !== 'string') continue
    const valid = !!parseVersion(j.version)
    files.push({
      file: name, version: j.version, valid,
      next: valid ? { patch: bump(j.version, 'patch'), minor: bump(j.version, 'minor'), major: bump(j.version, 'major') } : null,
    })
  }
  return { ok: true, files }
}

function sameExceptVersion(a, b) {
  const x = { ...a }, y = { ...b }
  delete x.version; delete y.version
  return JSON.stringify(x) === JSON.stringify(y)
}

// Cambia la versión en todos los manifiestos con versión válida. Si alguno falla la
// comprobación, no se escribe NINGUNO (todo o nada).
function applyBump(root, level) {
  const plans = []
  for (const name of MANIFESTS) {
    const full = path.join(root, name)
    if (!fs.existsSync(full)) continue
    const text = fs.readFileSync(full, 'utf8')
    const before = readJson(full)
    if (!before || typeof before.version !== 'string') continue
    const next = bump(before.version, level)
    // Primer "version": "..." del archivo; luego se verifica que el resultado sea el esperado
    const re = /("version"\s*:\s*")[^"\\]*(")/
    if (!re.test(text)) throw new Error(`No se encontró la clave "version" en ${name}`)
    const out = text.replace(re, `$1${next}$2`)
    let after
    try { after = JSON.parse(out.replace(/^\uFEFF/, '')) } catch { throw new Error(`El resultado en ${name} no es JSON válido; no se modificó nada`) }
    if (after.version !== next || !sameExceptVersion(before, after)) {
      throw new Error(`${name}: el cambio no se pudo aplicar de forma segura (la clave "version" principal no es la primera); no se modificó nada`)
    }
    plans.push({ name, full, out, from: before.version, to: next })
  }
  if (!plans.length) throw new Error('No hay package.json ni manifest.json con versión')
  for (const p of plans) fs.writeFileSync(p.full, p.out, 'utf8')
  return { ok: true, changed: plans.map(p => ({ file: p.name, from: p.from, to: p.to })) }
}

// ── Changelog desde git ─────────────────────────────────────────────────────
function git(root, args) {
  return new Promise((resolve) => {
    execFile('git', ['-C', root, ...args], { timeout: 15000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      resolve(err ? { ok: false, error: err.message } : { ok: true, out: stdout })
    })
  })
}

const SECTIONS = [
  ['feat', '✨ Added'], ['fix', '🐛 Fixed'], ['refactor', '🎨 Changed'], ['perf', '🎨 Changed'],
  ['docs', '📚 Docs'], ['chore', '🔧 Chore'], ['other', '📝 Otros'],
]
const SECTION_OF = Object.fromEntries(SECTIONS.map(([k, v]) => [k, v]))

function classify(subject) {
  const m = subject.match(/^(feat|fix|refactor|perf|docs|chore|test|build|ci|style)(\([^)]*\))?!?:\s*(.+)$/i)
  if (!m) return { type: 'other', text: subject }
  let t = m[1].toLowerCase()
  if (['test', 'build', 'ci', 'style'].includes(t)) t = 'chore'
  const scope = m[2] ? m[2].slice(1, -1) : ''
  return { type: t, text: (scope ? `**${scope}:** ` : '') + m[3] }
}

async function collectCommits(root) {
  const inside = await git(root, ['rev-parse', '--is-inside-work-tree'])
  if (!inside.ok) throw new Error('La carpeta no es un repositorio git (o git no está instalado)')
  const tag = await git(root, ['describe', '--tags', '--abbrev=0'])
  const since = tag.ok ? tag.out.trim() : ''
  const range = since ? [`${since}..HEAD`] : ['-n', '60']
  const log = await git(root, ['log', ...range, '--no-merges', '--pretty=format:%s'])
  if (!log.ok) throw new Error('No se pudo leer el historial de git')
  const subjects = log.out.split('\n').map(s => s.trim()).filter(Boolean)
    .filter(s => !/^checkpoint:/i.test(s)) // los checkpoints de AGENTS.md no son cambios de usuario
  return { since, subjects }
}

function buildSection(version, subjects, dateStr) {
  const groups = new Map()
  for (const s of subjects) {
    const { type, text } = classify(s)
    const title = SECTION_OF[type] || SECTION_OF.other
    if (!groups.has(title)) groups.set(title, [])
    if (!groups.get(title).includes(text)) groups.get(title).push(text)
  }
  const L = [`## [${version}] - ${dateStr}`]
  for (const [, title] of SECTIONS) {
    const items = groups.get(title)
    if (!items || !items.length) continue
    groups.delete(title) // las secciones repetidas (Changed) se escriben una vez
    L.push('', `### ${title}`, ...items.map(t => `- ${t}`))
  }
  return L.join('\n') + '\n'
}

function localDate() {
  const d = new Date()
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * mode 'preview' no escribe. mode 'write' inserta la sección bajo el encabezado de CHANGELOG.md
 * (la crea si no existe) y no repite una versión que ya figure.
 */
async function changelog(root, version, mode) {
  const v = String(version || '').trim()
  if (!parseVersion(v)) throw new Error('Indicá una versión válida (X.Y.Z)')
  const { since, subjects } = await collectCommits(root)
  if (!subjects.length) throw new Error('No hay commits nuevos para el changelog')
  const section = buildSection(v, subjects, localDate())
  if (mode !== 'write') return { ok: true, markdown: section, count: subjects.length, since }

  const file = path.join(root, 'CHANGELOG.md')
  let text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '# Changelog\n\nTodos los cambios notables a este proyecto se documentan en este archivo.\n'
  const eol = text.includes('\r\n') ? '\r\n' : '\n'   // respetar los saltos de línea del archivo
  const block = section.replace(/\n/g, eol)
  if (new RegExp('^## \\[' + v.replace(/[.+]/g, '\\$&') + '\\]', 'm').test(text)) throw new Error(`CHANGELOG.md ya tiene una sección para ${v}`)
  const firstEntry = text.search(/^## /m)
  const merged = firstEntry === -1
    ? text.replace(/\s*$/, '') + eol + eol + block
    : text.slice(0, firstEntry) + block + eol + text.slice(firstEntry)
  fs.writeFileSync(file, merged, 'utf8')
  return { ok: true, markdown: section, count: subjects.length, since, written: 'CHANGELOG.md' }
}

module.exports = { info, applyBump, changelog, bump, parseVersion, classify, buildSection }
