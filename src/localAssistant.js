// Asistente local (autopiloto fase 3): reconoce pedidos OBVIOS y de una sola acción para resolverlos sin IA.
// Lógica PURA (sin red ni DOM): reconocimiento por reglas y formateo de respuestas. Se prueba en scripts/test-local-assistant.mjs.
//
// Principio de seguridad: el reconocimiento es deliberadamente ESTRECHO. El mensaje completo tiene que ser el comando
// (con cortesías opcionales); si trae cualquier cosa más ("... y arreglá el que falle", "... en ai.js"), NO se intercepta
// y va a la IA. Equivocarse hacia la IA solo cuesta tokens; equivocarse hacia el asistente local le quita el pedido al usuario.

export const INTENT_LABELS = {
  tests: 'Correr las verificaciones del proyecto (verify, o test y lint)',
  status: 'Ver qué cambió (git: rama, cambios sin commitear)',
  errors: 'Listar los errores de validación actuales',
  secrets: 'Buscar secretos (claves, tokens) en el proyecto',
  snapshot: 'Crear un snapshot (punto de restauración)',
  undo: 'Deshacer el último cambio aplicado por el editor',
  junk: 'Ver qué basura regenerable hay (solo muestra, no borra)',
  help: 'Mostrar esta ayuda',
}

export function normalizeText(t) {
  return String(t || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[¿?¡!.,;:"'`()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LEAD = /^(?:(?:por favor|porfa|hola|dale|che|ok|oka|bueno|bien|ahora|podes|puedes|podrias|quiero que|necesito que|quisiera que|me|decime)\s+)+/
const TAIL = /(?:\s+(?:por favor|porfa|gracias|ahora|ya|nomas))+$/

// Los verbos van sin acento (se normaliza antes): "corré" -> "corre", "ejecutá" -> "ejecuta"
const V_RUN = '(?:corre|correr|corra|ejecuta|ejecutar|lanza|lanzar|pasa|pasar|hace|hacer|run)'
const OBJ_TESTS = '(?:(?:los|las|el|todos los|todas las)\\s+)?(?:tests?|pruebas|verify|verificacion|lint|checks?)(?:\\s+del proyecto)?'

const RULES = [
  ['tests', new RegExp(`^${V_RUN}\\s+${OBJ_TESTS}$`)],
  ['tests', /^(?:verifica|verificar|verificame)(?:\s+(?:el\s+)?(?:proyecto|todo))?$/],
  ['tests', /^(?:npm test|npm run verify|npm run lint|verify)$/],
  ['status', /^(?:que cambio|que cambios hay|que se cambio|que hay de nuevo|que modifique|que cambie|que hay sin commitear|estado del proyecto|estado de git|git status|cambios pendientes|cambios sin commitear|(?:mostrame |ver )?(?:los )?cambios pendientes)$/],
  ['errors', /^(?:que errores hay|hay errores|que errores tiene el proyecto|errores actuales|(?:mostrame|ver|lista|listame|listar)\s+(?:los\s+)?errores)$/],
  ['secrets', /^(?:busca|buscar|escanea|escanear|revisa|revisar|hay|detecta|detectar)\s+(?:los |las |algun |alguna |posibles )?(?:secretos|claves|tokens|credenciales|api keys?)(?:\s+(?:en el proyecto|filtrad[oa]s))?$/],
  ['snapshot', /^(?:hace|hacer|crea|crear|guarda|guardar|genera|generar|toma|tomar|saca|sacar)\s+(?:un |una )?(?:snapshot|backup|respaldo|punto de restauracion|punto de control|copia de seguridad)(?:\s+(?:ahora|del proyecto))?$/],
  ['undo', /^(?:deshace|deshacer|reverti|revierte|revertir|volve atras|vuelve atras|undo)(?:\s+(?:el |lo )?(?:ultimo |ultima )?(?:cambio|parche|edicion|modificacion))?$/],
  ['junk', /^(?:que basura hay|hay basura|busca basura|buscar basura|que se puede limpiar|que archivos basura hay)$/],
  ['help', /^(?:ayuda|ayuda del asistente|comandos|comandos locales|asistente local|que podes hacer sin ia|que sabes hacer sin ia)$/],
]

export function matchIntent(text) {
  const raw = String(text || '')
  if (!raw.trim() || raw.length > 120 || /\n/.test(raw.trim()) || raw.includes('```')) return null
  let t = normalizeText(raw)
  if (!t || t.split(' ').length > 9) return null
  let prev
  do { prev = t; t = t.replace(LEAD, '').replace(TAIL, '').trim() } while (t !== prev)
  if (!t) return null
  for (const [intent, re] of RULES) if (re.test(t)) return intent
  return null
}

// ── Formateo de respuestas (todo texto plano/markdown corto) ──
const clean = (t, n) => String(t ?? '').replace(/[`\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n)
const relPath = (p, rootDir) => {
  const s = String(p || '').replace(/\\/g, '/')
  const r = String(rootDir || '').replace(/\\/g, '/').replace(/\/+$/, '')
  return r && s.toLowerCase().startsWith(r.toLowerCase() + '/') ? s.slice(r.length + 1) : s
}
export const LOCAL_TAG = '⚙ *Asistente local (sin IA)*'

export function helpText() {
  const ex = {
    tests: '"corré los tests"', status: '"qué cambió"', errors: '"qué errores hay"', secrets: '"buscá secretos"',
    snapshot: '"hacé un snapshot"', undo: '"deshacé el último cambio"', junk: '"qué basura hay"', help: '"ayuda"',
  }
  return `${LOCAL_TAG}\nPuedo resolver sin IA (y sin gastar tokens) estos pedidos cuando el mensaje es solo eso:\n` +
    Object.entries(INTENT_LABELS).map(([k, v]) => `- ${v} — ${ex[k]}`).join('\n') +
    '\nSi el mensaje trae algo más (por ejemplo "corré los tests y arreglá lo que falle"), se lo paso a la IA.'
}

export function formatGitStatus(git) {
  if (!git || !git.ok) return `${LOCAL_TAG}\nNo pude leer git: esta carpeta no es un repositorio o git no está disponible.`
  const lines = [`${LOCAL_TAG}`, `**Rama:** ${clean(git.branch, 60)}${git.last ? ` · último commit: ${clean(git.last, 90)}` : ''}`]
  if (!git.total) lines.push('Árbol de trabajo limpio: no hay cambios sin commitear.')
  else {
    lines.push(`**Cambios sin commitear (${git.total}):**`)
    for (const l of (git.status || []).slice(0, 25)) lines.push(`- \`${clean(String(l).slice(0, 2).trim() || '?', 3)}\` ${clean(String(l).slice(3), 120)}`)
    if (git.total > 25) lines.push(`- … y ${git.total - 25} más`)
    if (git.shortstat) lines.push(`Diff vs HEAD: ${clean(git.shortstat, 120)}`)
  }
  return lines.join('\n')
}

export function formatErrors(problems, rootDir) {
  const files = Object.values(problems || {}).filter(v => v && v.errors?.length)
  if (!files.length) return `${LOCAL_TAG}\n✔ No hay errores de validación (JSON, YAML, JS) en los archivos revisados.`
  const out = [`${LOCAL_TAG}`, `**${files.length} archivo${files.length > 1 ? 's' : ''} con errores:**`]
  for (const f of files.slice(0, 15)) {
    out.push(`- \`${relPath(f.path, rootDir)}\``)
    for (const e of f.errors.slice(0, 3)) out.push(`    línea ${e.line ?? '?'}: ${clean(e.message, 140)}`)
    if (f.errors.length > 3) out.push(`    … +${f.errors.length - 3} más`)
  }
  if (files.length > 15) out.push(`- … y ${files.length - 15} archivos más`)
  return out.join('\n')
}

export function formatSecrets(res) {
  if (!res || res.ok === false) return `${LOCAL_TAG}\n✗ No se pudo escanear: ${clean(res?.error || 'error desconocido', 200)}`
  const f = res.findings || []
  if (!f.length) return `${LOCAL_TAG}\n✔ No encontré secretos en ${res.scanned ?? '?'} archivos revisados.`
  const out = [`${LOCAL_TAG}`, `**⚠ ${f.length}${res.truncated ? '+' : ''} posible${f.length > 1 ? 's' : ''} secreto${f.length > 1 ? 's' : ''}** (valores enmascarados; ${res.scanned ?? '?'} archivos revisados):`]
  for (const x of f.slice(0, 15)) out.push(`- \`${clean(x.file, 120)}:${x.line}\` — ${clean(x.label, 60)} (${clean(x.preview, 40)})`)
  if (f.length > 15) out.push(`- … y ${f.length - 15} más`)
  out.push('Sacalos del código, ponelos en un `.env` y agregá `.env` al `.gitignore` (Herramientas locales → Secretos).')
  return out.join('\n')
}

export function formatSnapshot(res) {
  if (!res || res.ok === false) return `${LOCAL_TAG}\n✗ No se pudo crear el snapshot: ${clean(res?.error || 'error desconocido', 200)}`
  return `${LOCAL_TAG}\n🛟 Snapshot **${clean(res.id, 80)}** creado (${res.files} archivos${res.truncated ? ', recortado por tamaño' : ''}). Se restaura desde Herramientas locales → Rollbacks.`
}

const fmtBytes = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`
export function formatJunk(res) {
  if (!res || res.ok === false) return `${LOCAL_TAG}\n✗ No se pudo revisar: ${clean(res?.error || 'error desconocido', 200)}`
  if (!res.total) return `${LOCAL_TAG}\n✔ No hay basura regenerable en el proyecto.`
  const rows = Object.values(res.categories || {}).filter(c => c.count > 0).map(c => `- ${clean(c.label, 90)}: ${c.count} (${fmtBytes(c.bytes || 0)})`)
  return `${LOCAL_TAG}\n**${res.total} elemento${res.total > 1 ? 's' : ''} regenerable${res.total > 1 ? 's' : ''}, ${fmtBytes(res.totalBytes || 0)}${res.truncated ? ' (recorrido parcial)' : ''}:**\n${rows.join('\n')}\nNo borré nada: para limpiar, usá Herramientas locales → Mantenimiento (ahí elegís categorías).`
}

export function formatUndo(entry) {
  if (!entry) return `${LOCAL_TAG}\nNo hay cambios para deshacer (el historial de deshacer se guarda mientras la app está abierta).`
  return `${LOCAL_TAG}\n↩ Restauré \`${clean(entry.filePath, 140)}\` al estado anterior a: ${clean(entry.actionDesc, 100)}.`
}
