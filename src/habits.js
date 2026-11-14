// Autopiloto fase 5: aprende de tu uso, sin IA. Lógica PURA (sin red ni DOM); el almacenamiento (localStorage) lo hace App.
//
// Qué se guarda: SOLO contadores de comandos que parecen verificaciones (test, lint, typecheck…) que escribiste a mano en
// la terminal del editor, por proyecto (identificado con un hash, no con la ruta). Cualquier otro comando se descarta en
// el acto: no se guarda su texto ni sus argumentos. Nunca se guardan contenidos de archivos ni mensajes del chat.
// Cuando un comando se repite, el asistente PROPONE sumarlo a la verificación automática; solo se agrega si lo aceptás.

export const THRESHOLD = 3     // repeticiones para sugerir
export const MAX_CMDS = 30     // comandos distintos recordados por proyecto
export const MAX_ACCEPTED = 5  // verificaciones extra por proyecto
export const MAX_DISMISSED = 30
const MAX_LEN = 120
const MAX_PROJECTS = 50

export const normalizeCommand = (c) => String(c ?? '').replace(/\s+/g, ' ').trim()

// Solo comandos de verificación conocidos y de una sola línea: nada de cadenas, redirecciones, modo watch ni que escriban archivos
const ARGS = '(?:\\s+[\\w@./\\\\=:,*{}-]+)*'
const ALLOW = [
  new RegExp('^(?:npm|pnpm|yarn)(?:\\s+run)?\\s+(?:test|lint|typecheck|type-check|check|verify)(?::[\\w-]+)?' + ARGS + '$'),
  new RegExp('^(?:npx\\s+(?:--no-install\\s+)?)?tsc\\s+--noemit(?:\\s+-p\\s+[\\w./\\\\-]+)?$'),
  new RegExp('^(?:npx\\s+(?:--no-install\\s+)?)?eslint' + ARGS + '$'),
  new RegExp('^(?:python3?|py)\\s+-m\\s+(?:pytest|unittest|mypy|flake8|pylint|ruff\\s+check)' + ARGS + '$'),
  new RegExp('^(?:pytest|mypy|flake8|pylint|ruff\\s+check)' + ARGS + '$'),
  new RegExp('^(?:cargo\\s+(?:test|check|clippy)|go\\s+(?:test|vet))' + ARGS + '$'),
]
const DENY = /(?:^|\s)(?:--fix|--write|--force|--watch|--watchall|--update|--update-snapshot|-w|-u|-fix)(?:\s|=|$)|\b(?:watch|serve|dev|start|rm|del|sudo)\b|fix|write|format|watch|update|publish|deploy|clean|reset|migrate/i

export function isCheckLike(cmd) {
  // Los saltos de línea se rechazan ANTES de normalizar (normalizar los convertiría en espacios y dejaría pasar "npm test\nwhoami")
  if (typeof cmd !== 'string' || /[\r\n]/.test(cmd)) return false
  const c = normalizeCommand(cmd)
  if (!c || c.length > MAX_LEN) return false
  if (/[&|;<>`$()]/.test(c)) return false
  const low = c.toLowerCase()
  if (DENY.test(low)) return false
  return ALLOW.some(re => re.test(low))
}

// Identificador del proyecto: hash corto (djb2) de la ruta normalizada, para no guardar la ruta
export function projectKey(rootDir) {
  const s = String(rootDir || '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0
  return 'p' + h.toString(16)
}

export const emptyState = () => ({ v: 1, projects: {} })
const emptyProj = () => ({ cmds: {}, accepted: [], dismissed: [] })
const clone = (st) => JSON.parse(JSON.stringify(st))
const getProj = (st, key) => { st.projects[key] = st.projects[key] || emptyProj(); return st.projects[key] }
const lowerKey = (c) => normalizeCommand(c).toLowerCase()

// Lee lo guardado con desconfianza: cualquier cosa fuera de forma se descarta
export function loadState(raw) {
  let data
  try { data = typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return emptyState() }
  if (!data || data.v !== 1 || typeof data.projects !== 'object' || !data.projects) return emptyState()
  const out = emptyState()
  for (const [key, p] of Object.entries(data.projects).slice(0, MAX_PROJECTS)) {
    if (!/^p[0-9a-f]{1,8}$/.test(key) || !p || typeof p !== 'object') continue
    const np = emptyProj()
    for (const [k, v] of Object.entries(p.cmds && typeof p.cmds === 'object' ? p.cmds : {}).slice(0, MAX_CMDS)) {
      if (v && isCheckLike(v.cmd) && Number.isFinite(v.n) && v.n > 0) np.cmds[lowerKey(v.cmd)] = { cmd: normalizeCommand(v.cmd), n: Math.min(Math.floor(v.n), 9999), last: Number(v.last) || 0 }
    }
    np.accepted = (Array.isArray(p.accepted) ? p.accepted : []).filter(isCheckLike).map(normalizeCommand).slice(0, MAX_ACCEPTED)
    np.dismissed = (Array.isArray(p.dismissed) ? p.dismissed : []).filter(isCheckLike).map(normalizeCommand).slice(0, MAX_DISMISSED)
    out.projects[key] = np
  }
  return out
}

export function recordCommand(state, key, cmd, now = Date.now()) {
  if (!isCheckLike(cmd)) return { state, recorded: false }
  const st = clone(state)
  const p = getProj(st, key)
  const norm = normalizeCommand(cmd), k = norm.toLowerCase()
  p.cmds[k] = { cmd: norm, n: Math.min((p.cmds[k]?.n || 0) + 1, 9999), last: now }
  const keys = Object.keys(p.cmds)
  if (keys.length > MAX_CMDS) {
    keys.sort((a, b) => p.cmds[a].last - p.cmds[b].last)
    for (const old of keys.slice(0, keys.length - MAX_CMDS)) delete p.cmds[old]
  }
  return { state: st, recorded: true }
}

// base: comandos que la cadena ya corre (verify/test/lint) para no sugerir lo que ya se hace solo
export function suggestionFor(state, key, { base = [], threshold = THRESHOLD } = {}) {
  const p = state.projects[key]
  if (!p) return null
  const skip = new Set([...base, ...p.accepted, ...p.dismissed].map(lowerKey))
  const cands = Object.entries(p.cmds).filter(([k, v]) => v.n >= threshold && !skip.has(k)).map(([, v]) => v)
  cands.sort((a, b) => b.n - a.n || b.last - a.last)
  return cands[0] ? { cmd: cands[0].cmd, n: cands[0].n } : null
}

export function acceptCommand(state, key, cmd) {
  if (!isCheckLike(cmd)) return { state, ok: false }
  const st = clone(state), p = getProj(st, key), norm = normalizeCommand(cmd)
  if (p.accepted.some(c => lowerKey(c) === norm.toLowerCase())) return { state, ok: true, already: true }
  if (p.accepted.length >= MAX_ACCEPTED) return { state, ok: false, full: true }
  p.accepted.push(norm)
  p.dismissed = p.dismissed.filter(c => lowerKey(c) !== norm.toLowerCase())
  return { state: st, ok: true }
}

export function dismissCommand(state, key, cmd) {
  if (!isCheckLike(cmd)) return state
  const st = clone(state), p = getProj(st, key), norm = normalizeCommand(cmd)
  if (!p.dismissed.some(c => lowerKey(c) === norm.toLowerCase())) p.dismissed.push(norm)
  if (p.dismissed.length > MAX_DISMISSED) p.dismissed = p.dismissed.slice(-MAX_DISMISSED)
  return st
}

// Verificaciones extra aceptadas (se revalidan al leerlas: lo guardado nunca se ejecuta sin pasar por isCheckLike)
export const acceptedChecks = (state, key) => (state.projects[key]?.accepted || []).filter(isCheckLike)

export function forgetProject(state, key) {
  const st = clone(state)
  delete st.projects[key]
  return st
}

export const hasData = (state, key) => {
  const p = state.projects[key]
  return !!p && (Object.keys(p.cmds).length > 0 || p.accepted.length > 0 || p.dismissed.length > 0)
}

// ── Texto para el chat ──
const TAG = '⚙ *Asistente local (sin IA)*'
export function formatSuggestion(sug) {
  return `💡 **Sugerencia del autopiloto**: ejecutaste \`${sug.cmd}\` ${sug.n} veces a mano. ¿Lo agrego a la verificación automática que corre tras aplicar cambios? Decí **"agregá lo sugerido"** o **"ignorá la sugerencia"**.`
}
export function describeHabits(state, key) {
  const p = state.projects[key]
  if (!p || !hasData(state, key)) return `${TAG}\nTodavía no aprendí nada de este proyecto. Solo cuento los comandos de verificación (test, lint, typecheck…) que escribís a mano en la terminal del editor.`
  const lines = [TAG, '**Lo que sé de este proyecto** (solo contadores, nada de contenidos):']
  const cmds = Object.values(p.cmds).sort((a, b) => b.n - a.n).slice(0, 10)
  if (cmds.length) lines.push(...cmds.map(c => `- \`${c.cmd}\`: ${c.n} ${c.n > 1 ? 'veces' : 'vez'}`))
  lines.push(p.accepted.length ? `**Verificaciones extra activas:** ${p.accepted.map(c => '`' + c + '`').join(', ')}` : 'No hay verificaciones extra activas.')
  if (p.dismissed.length) lines.push(`Sugerencias ignoradas: ${p.dismissed.map(c => '`' + c + '`').join(', ')}`)
  lines.push('Decí **"olvidá mis hábitos"** para borrar todo esto (y quitar las verificaciones extra).')
  return lines.join('\n')
}

// ── Respuestas del asistente a aceptar / ignorar / olvidar ──
export const NO_PENDING = `${TAG}\nNo hay ninguna sugerencia pendiente. Te aviso cuando repitas a mano un comando de verificación.`
export function formatAccept(res, cmd) {
  if (res.full) return `${TAG}\nYa hay ${MAX_ACCEPTED} verificaciones extra (el máximo). Decí **"olvidá mis hábitos"** para empezar de cero.`
  if (!res.ok) return `${TAG}\nNo agregué \`${normalizeCommand(cmd).slice(0, 80)}\`: no es un comando de verificación conocido.`
  if (res.already) return `${TAG}\n\`${cmd}\` ya estaba en la verificación automática.`
  return `${TAG}\n✔ Agregué \`${cmd}\` a la verificación automática: ahora corre después de verify/test/lint cada vez que se aplican cambios de código. Se quita con **"olvidá mis hábitos"**.`
}
export const formatDismiss = (cmd) => `${TAG}\nListo, no vuelvo a sugerir \`${cmd}\`.`
export const formatForget = () => `${TAG}\nBorré todo lo aprendido de este proyecto y quité las verificaciones extra.`
