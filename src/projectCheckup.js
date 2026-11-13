// Autopiloto fase 4: rutinas mecánicas y sugerencias — lógica PURA (sin red ni DOM). Decide qué entradas faltan en
// .gitignore, qué formateador hay y arma el chequeo del proyecto. Se prueba en scripts/test-project-checkup.mjs.
import { LOCAL_TAG } from './localAssistant.js'

// Nombres que se comprueban con exists() (readDir oculta dotfiles y carpetas como node_modules/dist)
export const PROBE_NAMES = [
  'package.json', 'requirements.txt', 'pyproject.toml', 'node_modules', 'dist', 'build', 'out', 'dist-electron',
  '.env', '.env.local', '__pycache__', '.venv', 'venv', '.vscode', '.idea',
]

const norm = (r) => String(r || '').trim().replace(/^\*\*\//, '').replace(/^\//, '').replace(/\/$/, '')
const escapeRe = (s) => s.replace(/[.+^${}()|[\]\\]/g, '\\$&')
function globToRe(p) { return new RegExp('^' + escapeRe(p).replace(/\*/g, '.*').replace(/\?/g, '.') + '$') }

// ¿alguna regla del .gitignore ya cubre `rule`? (igualdad ignorando "/" y "**/" o un comodín que lo abarque)
export function isCovered(rule, rules) {
  const target = norm(rule)
  if (!target) return true
  for (const raw of rules || []) {
    const r = String(raw || '').trim()
    if (!r || r.startsWith('#') || r.startsWith('!')) continue
    const n = norm(r)
    if (n === target) return true
    if (n.includes('*') || n.includes('?')) { try { if (globToRe(n).test(target)) return true } catch { /* regla rara: se ignora */ } }
  }
  return false
}

// present: array/Set de nombres de PROBE_NAMES que existen · rules: reglas actuales del .gitignore
export function recommendGitignore({ rules = [], present = [], pkg = null } = {}) {
  const has = (n) => (present instanceof Set ? present.has(n) : present.includes(n))
  const out = []
  const add = (rule, why) => { if (!isCovered(rule, rules) && !out.some(o => o.rule === rule)) out.push({ rule, why }) }
  if (pkg || has('node_modules')) add('node_modules/', 'dependencias (se regeneran con npm install)')
  for (const d of ['dist', 'build', 'out', 'dist-electron']) if (has(d)) add(d + '/', 'salida de build (se regenera)')
  if (has('.env')) add('.env', 'puede contener claves y tokens')
  if (has('.env.local')) add('.env.local', 'puede contener claves y tokens')
  if (has('requirements.txt') || has('pyproject.toml') || has('__pycache__')) {
    add('__pycache__/', 'caché de Python'); add('*.pyc', 'bytecode de Python')
  }
  if (has('.venv')) add('.venv/', 'entorno virtual de Python')
  if (has('venv')) add('venv/', 'entorno virtual de Python')
  if (has('.vscode')) add('.vscode/', 'configuración local del editor')
  if (has('.idea')) add('.idea/', 'configuración local del editor')
  return out
}

// Formateador del proyecto: su script "format" o, si no, prettier ya instalado. Nunca descarga nada.
export function detectFormatter(pkg) {
  const scripts = pkg?.scripts || {}
  if (typeof scripts.format === 'string' && scripts.format.trim()) return { command: 'npm run format', via: 'script "format"' }
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) }
  if (deps.prettier) return { command: 'npx --no-install prettier --write .', via: 'prettier' }
  return null
}

const bytes = (b) => b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`

// Chequeo de solo lectura: lista lo que se puede resolver con un pedido corto al asistente local
export function buildCheckup({ recs = [], gitignoreExists = true, secrets = null, junk = null, pkg = null, formatter = null, git = null } = {}) {
  const items = []
  if (recs.length) {
    items.push(`${gitignoreExists ? '' : 'No hay `.gitignore`. '}Faltan ${recs.length} entrada${recs.length > 1 ? 's' : ''} en \`.gitignore\`: ${recs.map(r => '`' + r.rule + '`').join(', ')} → decí **"arreglá el gitignore"**.`)
  }
  if (secrets && secrets.ok !== false && (secrets.findings || []).length) {
    items.push(`Hay ${secrets.findings.length}${secrets.truncated ? '+' : ''} posible${secrets.findings.length > 1 ? 's' : ''} secreto${secrets.findings.length > 1 ? 's' : ''} en el código → decí **"buscá secretos"** para ver dónde.`)
  }
  if (junk && junk.ok !== false && junk.total > 0) {
    items.push(`Hay ${junk.total} elemento${junk.total > 1 ? 's' : ''} de basura regenerable (${bytes(junk.totalBytes || 0)}) → **"qué basura hay"**, y se limpia en Herramientas locales → Mantenimiento.`)
  }
  if (pkg) {
    const s = pkg.scripts || {}
    const hasCheck = (typeof s.verify === 'string' && s.verify.trim()) || (typeof s.test === 'string' && s.test.trim() && !/no test specified/i.test(s.test)) || (typeof s.lint === 'string' && s.lint.trim())
    if (!hasCheck) items.push('El `package.json` no define `verify`, `test` ni `lint`: el autopiloto no tiene qué correr tras aplicar cambios.')
  }
  if (formatter) items.push(`Hay formateador (${formatter.via}) → **"formateá el proyecto"** (hace un snapshot antes).`)
  if (git && git.ok && git.total > 20) items.push(`Hay ${git.total} cambios sin commitear: conviene un commit o un **"hacé un snapshot"**.`)
  if (git && git.ok === false) items.push('Esta carpeta no es un repositorio git (o git no está disponible): no hay historial al que volver.')
  if (!items.length) return `${LOCAL_TAG}\n✔ Sin sugerencias: no encontré nada mecánico para mejorar.`
  return `${LOCAL_TAG}\n**Chequeo del proyecto (${items.length}):**\n` + items.map(i => `- ${i}`).join('\n')
}

export function formatGitignoreResult(recs, res) {
  if (!recs.length) return `${LOCAL_TAG}\n✔ El \`.gitignore\` ya cubre todo lo que corresponde: no agregué nada.`
  if (!res || res.ok === false) return `${LOCAL_TAG}\n✗ No pude escribir el \`.gitignore\`: ${String(res?.error || 'error desconocido').slice(0, 200)}`
  const lines = (res.added || []).map(r => { const w = recs.find(x => x.rule === r)?.why; return `- \`${r}\`${w ? ` — ${w}` : ''}` })
  if (!lines.length) return `${LOCAL_TAG}\n✔ El \`.gitignore\` ya tenía esas reglas: no cambié nada.`
  return `${LOCAL_TAG}\n📝 Agregué ${lines.length} regla${lines.length > 1 ? 's' : ''} al \`.gitignore\` (solo se agregan líneas, no se tocó lo que había):\n${lines.join('\n')}\nSe pueden quitar desde Herramientas locales → .gitignore.`
}

// r: {formatter, snapshot:{ok,id,error}, ran:boolean, ok, timedOut, summary:[], git:{ok,total,shortstat}}
export function formatFormatResult(r) {
  if (!r.formatter) return `${LOCAL_TAG}\nEste proyecto no tiene formateador: no hay script \`format\` ni \`prettier\` instalado. No instalo nada por mi cuenta.`
  if (r.snapshot && r.snapshot.ok === false) return `${LOCAL_TAG}\n✗ No formateé nada: no pude crear el snapshot previo (${String(r.snapshot.error || 'error desconocido').slice(0, 160)}) y no quiero tocar archivos sin poder volver atrás.`
  const head = `${LOCAL_TAG}\nFormateador: \`${r.formatter.command}\` (${r.formatter.via}).${r.snapshot?.id ? ` Snapshot previo: **${String(r.snapshot.id).slice(0, 80)}**.` : ''}`
  if (r.timedOut) return `${head}\n✗ Se agotó el tiempo de espera; puede haber quedado a medias: restaurá el snapshot desde Herramientas locales → Rollbacks si hace falta.`
  if (!r.ok) return `${head}\n✗ Falló:\n${(r.summary || []).slice(0, 8).map(l => '    ' + l).join('\n') || '    (sin salida)'}`
  const g = r.git && r.git.ok ? (r.git.total ? ` Ahora hay ${r.git.total} archivo${r.git.total > 1 ? 's' : ''} con cambios sin commitear${r.git.shortstat ? ` (${String(r.git.shortstat).slice(0, 100)})` : ''}: revisalos con **"qué cambió"**. Los archivos abiertos en el editor pueden haber quedado desactualizados: cerralos y reabrilos antes de seguir editando.` : ' No cambió ningún archivo.') : ''
  return `${head}\n✔ Listo.${g}`
}
