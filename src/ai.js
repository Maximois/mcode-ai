// ════════════════════════════════════════════════════════════════════════════
//  ai.js  —  Motor IA completo para MCodeAI Pre
//  Providers: Ollama · Groq · Gemini · OpenRouter · Zen · Cerebras · Mistral · Together
// ════════════════════════════════════════════════════════════════════════════

// ── Tool calling (text-based, any provider) ───────────────────────────────────
const _toolNames = '(?:run|readFile|searchProject|listDir|glob|grep|searchWeb|fetchURL|git|createPlan|updatePlan|listPlans|undo|tree|review|rename|createComponent|changelog|learn|remember|experience|timeline|screenshot)'

export const TOOL_RE = new RegExp('\\[(?:TOOL|TOC):\\s*' + _toolNames + '(?:\\s+([^\\]]*))?\\]', 'gi')

// Normaliza formatos alternativos a [TOOL: ...]
export function normalizeTools(text) {
  return text
    // READ:ruta → [TOOL: readFile ruta]
    .replace(/(?:^|\n)\s*(?:READ|readFile)\s*:\s*(.+?)(?=\n|$)/gim, (m, args) => '\n[TOOL: readFile ' + String(args || '').trim() + ']')
    // grep("patron") → [TOOL: grep patron]
    .replace(/(?:^|\n)\s*grep\s*\(\s*["'](.+?)["'](?:\s*,\s*["'](.+?)["'])?\s*\)/gim, (m, query) => '\n[TOOL: grep ' + String(query || '').trim() + ']')
    // glob("**/*.js") → [TOOL: glob **/*.js]
    .replace(/(?:^|\n)\s*glob\s*\(\s*["'](.+?)["']\s*\)/gim, (m, pattern) => '\n[TOOL: glob ' + String(pattern || '').trim() + ']')
    // searchProject("texto") → [TOOL: searchProject texto]
    .replace(/(?:^|\n)\s*searchProject\s*\(\s*["'](.+?)["']\s*\)/gim, (m, query) => '\n[TOOL: searchProject ' + String(query || '').trim() + ']')
    // listDir("ruta") → [TOOL: listDir ruta]
    .replace(/(?:^|\n)\s*listDir\s*\(\s*["'](.+?)["']\s*\)/gim, (m, path) => '\n[TOOL: listDir ' + String(path || '').trim() + ']')
    // tree("ruta") → [TOOL: tree ruta]
    .replace(/(?:^|\n)\s*tree\s*\(\s*["'](.+?)["']\s*\)/gim, (m, path) => '\n[TOOL: tree ' + String(path || '').trim() + ']')
    // toolname: args (ej: "readFile:Cargo.toml" o "run: cargo check")
    .replace(new RegExp('(?:^|\\n)\\s*(' + _toolNames + ')\\s*:\\s*(.+?)(?=\\n|$)', 'gim'), (m, cmd, args) => '\n[TOOL: ' + cmd + ' ' + String(args || '').trim() + ']')
    // TOOL: cmd args (texto suelto sin [corchetes], con/sin backticks)
    .replace(new RegExp('`*TOOL:\\s*(' + _toolNames.slice(4, -1) + ')\\s+([^\\n`]+)`*', 'gi'), (m, cmd, args) => '[TOOL: ' + cmd + ' ' + String(args || '').trim() + ']')
    // TOC: cmd args (texto suelto, typo "TOC")
    .replace(new RegExp('`*TOC:\\s*(' + _toolNames.slice(4, -1) + ')\\s+([^\\n`]+)`*', 'gi'), (m, cmd, args) => '[TOOL: ' + cmd + ' ' + String(args || '').trim() + ']')
    // [TOC: cmd args] → [TOOL: cmd args]
    .replace(new RegExp('\\[TOC:\\s*(' + _toolNames.slice(4, -1) + ')\\s+([^\\]]+)\\]', 'gi'), (m, cmd, args) => '[TOOL: ' + cmd + ' ' + String(args || '').trim() + ']')
}

// ── Native function calling schemas (OpenAI-compatible providers) ──────────
export const TOOL_SCHEMAS = [
  { type: 'function', function: { name: 'readFile', description: 'Lee un archivo del proyecto. Usá ruta relativa al proyecto o absoluta. Opcional: rango de líneas con formato path:inicio-fin', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Ruta del archivo. Ej: src/main.js o src/main.js:10-30' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'searchProject', description: 'Busca texto en el contenido de todos los archivos del proyecto', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Texto a buscar' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'listDir', description: 'Lista el contenido de un directorio del proyecto', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Ruta del directorio' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'glob', description: 'Busca archivos por patrón glob recursivamente', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Patrón glob. Ej: **/*.js, src/**/*.ts' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'grep', description: 'Busca texto con regex en todos los archivos del proyecto', parameters: { type: 'object', properties: { pattern: { type: 'string', description: 'Texto o patrón regex a buscar. Usá /patron/ para regex' } }, required: ['pattern'] } } },
  { type: 'function', function: { name: 'searchWeb', description: 'Busca información en la web (documentación, errores, APIs, etc.)', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Términos de búsqueda' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'fetchURL', description: 'Lee el contenido de una página web o URL', parameters: { type: 'object', properties: { url: { type: 'string', description: 'URL completa' } }, required: ['url'] } } },
  { type: 'function', function: { name: 'git', description: 'Ejecuta un comando de git en el proyecto. No uses RUN para git', parameters: { type: 'object', properties: { args: { type: 'string', description: 'Comando git completo. Ej: status, diff, log --oneline -5' } }, required: ['args'] } } },
  { type: 'function', function: { name: 'createPlan', description: 'Crea un plan con pasos para tareas complejas', parameters: { type: 'object', properties: { title: { type: 'string', description: 'Título del plan' }, steps: { type: 'string', description: 'Pasos separados por |. Ej: 1. Crear hook | 2. Migrar componente | 3. Testear' } }, required: ['title', 'steps'] } } },
  { type: 'function', function: { name: 'updatePlan', description: 'Actualiza el estado de un paso del plan', parameters: { type: 'object', properties: { step: { type: 'string', description: 'Número de paso y estado. Ej: 1 completed, 2 in_progress' } }, required: ['step'] } } },
  { type: 'function', function: { name: 'listPlans', description: 'Lista todos los planes activos', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'undo', description: 'Deshace cambios aplicados a archivos. Opcional: cantidad de cambios a deshacer', parameters: { type: 'object', properties: { count: { type: 'string', description: 'Cantidad de cambios a deshacer. Vacío = 1' } } } } },
  { type: 'function', function: { name: 'tree', description: 'Muestra la estructura del proyecto como árbol', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Ruta base (opcional, default: raíz)' }, depth: { type: 'string', description: 'Profundidad (opcional, default: 3)' } } } } },
  { type: 'function', function: { name: 'review', description: 'Revisa un archivo completo buscando bugs, seguridad, performance y estilo', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Ruta del archivo a revisar' } }, required: ['path'] } } },
  { type: 'function', function: { name: 'rename', description: 'Renombra una función/variable en todos los archivos del proyecto', parameters: { type: 'object', properties: { from: { type: 'string', description: 'Nombre original' }, to: { type: 'string', description: 'Nuevo nombre' } }, required: ['from', 'to'] } } },
  { type: 'function', function: { name: 'createComponent', description: 'Crea un componente React con estructura base', parameters: { type: 'object', properties: { name: { type: 'string', description: 'Nombre del componente (PascalCase)' } }, required: ['name'] } } },
  { type: 'function', function: { name: 'changelog', description: 'Genera un changelog desde el historial de git', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'learn', description: 'Guarda una corrección o solución en la base de conocimiento para no repetir errores', parameters: { type: 'object', properties: { type: { type: 'string', description: 'Tipo: correction o solution' }, tags: { type: 'string', description: 'Tags separados por coma. Ej: react,import' }, context: { type: 'string', description: 'Descripción del error/contexto' }, solution: { type: 'string', description: 'Solución aplicada' }, code: { type: 'string', description: 'Código de ejemplo (opcional)' } }, required: ['type', 'tags', 'context', 'solution'] } } },
  { type: 'function', function: { name: 'remember', description: 'Busca experiencias previas relevantes guardadas en la base de conocimiento', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Términos de búsqueda. Ej: import error react' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'experience', description: 'Muestra estadísticas o limpia la base de experiencias', parameters: { type: 'object', properties: { action: { type: 'string', description: 'stats o clear' } }, required: ['action'] } } },
  { type: 'function', function: { name: 'timeline', description: 'Muestra cambios y aprendizajes cerca de un momento específico. Usalo para diagnosticar qué cambió entre que algo funcionaba y dejó de funcionar', parameters: { type: 'object', properties: { time: { type: 'string', description: 'Referencia temporal. Ej: "21:00", "hace 1 hora", "ayer", "2025-01-15"' }, window: { type: 'string', description: 'Ventana en minutos (opcional, default: 30)' } }, required: ['time'] } } },
  { type: 'function', function: { name: 'screenshot', description: 'Captura la página activa del navegador integrado y la envía para análisis visual. Usalo para diagnosticar errores visuales, layout o problemas gráficos', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'run', description: 'Ejecuta un comando shell (terminal) en el directorio del proyecto. Usalo para compilar, correr scripts, instalar paquetes, iniciar servidores de desarrollo, etc. Incluye el comando completo como string', parameters: { type: 'object', properties: { command: { type: 'string', description: 'Comando shell completo. Ej: cargo check, npm install, git status' }, cwd: { type: 'string', description: 'Directorio de trabajo (opcional, default: raíz del proyecto)' } }, required: ['command'] } } },
]

// ── Plan/Task management ─────────────────────────────────────────────────────
const _plans = []
let _planIdCounter = 0
const PLANS_KEY = 'mcap_plans_v1'

function loadPlans() {
  if (_plans.length > 0) return
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(PLANS_KEY) : null
    if (raw) { _plans.push(...JSON.parse(raw)); _planIdCounter = Math.max(..._plans.map(p => p.id), 0) + 1 }
  } catch {}
}

function savePlans() {
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(PLANS_KEY, JSON.stringify(_plans.slice(-20)))
  } catch {}
}

function getNextPlanId() { return ++_planIdCounter }

function formatPlan(plan) {
  const total = plan.steps.length
  const done = plan.steps.filter(s => s.status === 'completed').length
  const bar = '█'.repeat(Math.round(done / total * 10)) + '░'.repeat(10 - Math.round(done / total * 10))
  let out = `📋 **${plan.title}**  ${bar}  ${done}/${total}\n`
  out += `_Creado: ${plan.createdAt}_\n\n`
  plan.steps.forEach((s, i) => {
    const icon = s.status === 'completed' ? '✅' : s.status === 'in_progress' ? '🔄' : '⬜'
    out += `${icon} **Paso ${i + 1}:** ${s.desc}\n`
  })
  return out
}

// ── Undo history ──────────────────────────────────────────────────────────────
export const undoHistory = []
const MAX_UNDO = 50

export function pushUndo(filePath, originalContent, actionDesc) {
  undoHistory.unshift({ id: Date.now(), timestamp: new Date().toISOString(), filePath, originalContent, actionDesc })
  if (undoHistory.length > MAX_UNDO) undoHistory.length = MAX_UNDO
}

// ── Experience Database (memory for corrections & solutions) ────────────────
const EXP_KEY = 'mcap_experience_v1'
let _expCache = null

function loadExp() {
  if (_expCache) return _expCache
  try {
    const raw = typeof window !== 'undefined' ? window.localStorage?.getItem(EXP_KEY) : null
    _expCache = raw ? JSON.parse(raw) : []
  } catch { _expCache = [] }
  return _expCache
}

function saveExp() {
  try {
    if (typeof window !== 'undefined') window.localStorage?.setItem(EXP_KEY, JSON.stringify(_expCache))
  } catch {}
}

export function addExperience({ type, tags, context, solution, code, file, project }) {
  const db = loadExp()
  db.unshift({
    id: Date.now(),
    type: type || 'solution',
    tags: (tags || []).map(t => t.toLowerCase().trim()).filter(Boolean),
    context: (context || '').slice(0, 500),
    solution: (solution || '').slice(0, 2000),
    code: (code || '').slice(0, 2000),
    file: file || '',
    project: project || '',
    timestamp: new Date().toISOString(),
    count: 0,
  })
  if (db.length > 200) db.length = 200
  _expCache = db
  saveExp()
}

export function searchExperience(query, limit = 5) {
  const db = loadExp()
  const q = (query || '').toString().toLowerCase()
  if (!q || !q.trim()) return db.slice(0, limit)
  const scores = db.map(e => {
    let score = 0
    if (e.tags.some(t => q.includes(t) || t.includes(q))) score += 5
    if (e.context.toLowerCase().includes(q)) score += 3
    if (e.solution.toLowerCase().includes(q)) score += 2
    if (e.file.toLowerCase().includes(q)) score += 1
    return { entry: e, score }
  })
  scores.sort((a, b) => b.score - a.score)
  return scores.slice(0, limit).map(s => { s.entry.count++; return s.entry })
}

export function getExperienceStats() {
  const db = loadExp()
  const byType = {}
  for (const e of db) { byType[e.type] = (byType[e.type] || 0) + 1 }
  return { total: db.length, byType }
}

export function getTimeline(timeQuery = '', windowMin = 30) {
  const now = new Date()
  let targetTime = now
  const timeStr = (timeQuery || '').toString().trim()
  let q = timeStr.replace(/^["']|["']$/g, '')

  if (/^\d{1,2}:\d{2}$/.test(q)) {
    const [h, m] = q.split(':').map(Number)
    targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
    if (targetTime > now) targetTime.setDate(targetTime.getDate() - 1)
  } else if (/^hace\s+(\d+)\s+(minuto|min|hora|h)s?/.test(q)) {
    const pm = q.match(/^hace\s+(\d+)\s+(minuto|min|hora|h)/i)
    const amount = parseInt(pm[1])
    const unit = pm[2].toLowerCase()
    targetTime = new Date(now.getTime() - amount * (unit.startsWith('h') ? 3600000 : 60000))
  } else if (/^ayer/.test(q)) {
    targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0)
  } else if (/^\d{4}-\d{2}-\d{2}/.test(q)) {
    targetTime = new Date(q)
  }

  const startWindow = new Date(targetTime.getTime() - windowMin * 60000)
  const endWindow = new Date(targetTime.getTime() + windowMin * 60000)

  const db = loadExp()
  const events = []

  for (const e of db) {
    const t = new Date(e.timestamp).getTime()
    if (t >= startWindow.getTime() && t <= endWindow.getTime()) {
      events.push({ time: new Date(e.timestamp), type: 'experience', desc: `[${e.type}] ${e.context.slice(0, 120)}`, detail: e.solution.slice(0, 200), tags: e.tags || [] })
    }
  }
  for (const e of undoHistory) {
    const t = new Date(e.timestamp).getTime()
    if (t >= startWindow.getTime() && t <= endWindow.getTime()) {
      events.push({ time: new Date(e.timestamp), type: 'change', desc: e.actionDesc, detail: e.filePath })
    }
  }

  events.sort((a, b) => a.time - b.time)
  return { events, startWindow, endWindow, targetTime }
}

async function readFileFromDisk(filePath) {
  try {
    if (typeof window !== 'undefined' && window.api?.readFile) {
      const r = await window.api.readFile(filePath)
      if (r.ok) {
        const lines = r.content.split('\n')
        return lines.map((l, i) => `${i + 1}: ${l}`).join('\n')
      }
      return `[Error: ${r.error}]`
    }
    return '[No disponible fuera de Electron]'
  } catch (e) {
    return `[Error: ${e.message}]`
  }
}

async function listDirFromDisk(dirPath) {
  try {
    if (typeof window !== 'undefined' && window.api?.readDir) {
      const entries = await window.api.readDir(dirPath)
      if (!entries || entries.length === 0) return '[Directorio vacío o inaccesible]'
      return entries.map(e =>
        `${e.isDir ? '📁' : '📄'} ${e.name}${e.isDir ? '/' : ''}`
      ).join('\n')
    }
    return '[No disponible fuera de Electron]'
  } catch (e) {
    return `[Error: ${e.message}]`
  }
}

// ── Screenshot handler (set by BrowserTab for webview capture) ──────
let _screenshotHandler = null
export function setScreenshotHandler(fn) { _screenshotHandler = fn }
export async function takeScreenshot() {
  if (!_screenshotHandler) return { ok: false, error: 'No hay navegador activo' }
  return _screenshotHandler()
}

/** Convierte argumentos JSON de function-calling (OpenAI) al texto que espera executeToolCall */
function nativeJsonArgsToText(toolName, args) {
  const raw = typeof args === 'string' ? args : (JSON.stringify(args ?? '') || '')
  const t = (typeof raw === 'string' ? raw : String(raw || '')).trim()
  if (!t.startsWith('{')) return t
  try {
    const j = JSON.parse(t)
    const tn = toolName.toLowerCase()
    if (tn === 'readfile') return String(j.path || j.file || '').trim() || t
    if (tn === 'searchproject') return String(j.query || '').trim() || t
    if (tn === 'listdir') return (j.path != null ? String(j.path) : '.').trim() || t
    if (tn === 'glob') return String(j.pattern || '').trim() || t
    if (tn === 'grep') return String(j.pattern || j.query || '').trim() || t
    if (tn === 'searchweb') return String(j.query || '').trim() || t
    if (tn === 'fetchurl') return String(j.url || '').trim() || t
    if (tn === 'git') return String(j.args || j.command || '').trim() || t
    if (tn === 'createplan') {
      const title = String(j.title || '').trim()
      const steps = typeof j.steps === 'string' ? j.steps : Array.isArray(j.steps) ? j.steps.join(' | ') : ''
      if (title && steps) return `${title}|${steps}`
      return t
    }
    if (tn === 'updateplan') {
      if (j.step != null && String(j.step).trim()) return String(j.step).trim()
      const idx = j.stepIndex != null ? String(j.stepIndex) : ''
      const st = j.status != null ? String(j.status) : ''
      const joined = String(`${idx} ${st}`).trim()
      return joined || t
    }
    if (tn === 'listplans') return ''
    if (tn === 'undo') return j.count != null ? String(j.count) : ''
    if (tn === 'tree') {
      const p = j.path != null ? String(j.path) : ''
      const d = j.depth != null ? ` depth=${j.depth}` : ''
      return (p + d).trim() || t
    }
    if (tn === 'review') return (j.path || '').trim() || t
    if (tn === 'rename') return `${j.from || ''} ${j.to || ''}`.trim() || t
    if (tn === 'createcomponent') return (j.name || '').trim() || t
    if (tn === 'learn') {
      const parts = []
      if (j.type) parts.push(`type="${j.type}"`)
      if (j.tags) parts.push(`tags="${j.tags}"`)
      if (j.context) parts.push(`context="${String(j.context).replace(/"/g, "'")}"`)
      if (j.solution) parts.push(`solution="${String(j.solution).replace(/"/g, "'")}"`)
      if (j.code) parts.push(`code="${String(j.code).replace(/"/g, "'")}"`)
      if (j.file) parts.push(`file="${j.file}"`)
      return parts.join(' ') || t
    }
    if (tn === 'remember') return (j.query || '').trim() || t
    if (tn === 'experience') return (j.action || '').trim() || t
    if (tn === 'timeline') {
      let s = (j.time || '').trim()
      if (j.window) s += ` window=${j.window}`
      return s || t
    }
  } catch {
    return t
  }
  return t
}

export async function executeToolCall(toolName, args, { projectFiles, rootDir }) {
  try {
    args = nativeJsonArgsToText(toolName, args)
    // Garantizar que args es string
    args = String(args || '').trim()
    if (!args) args = ''
    
    switch (toolName.toLowerCase()) {
    case 'readfile': {
      let filePath = args
      let startLine = null, endLine = null
      // Soporte para [TOOL: readFile path:10-30] — rango de líneas
      const rangeMatch = filePath.match(/^(.*?):(\d+)-(\d+)$/)
      if (rangeMatch) {
        filePath = rangeMatch[1].trim()
        startLine = parseInt(rangeMatch[2])
        endLine = parseInt(rangeMatch[3])
      }
      // Resolver ruta relativa contra rootDir (si no es absoluta)
      const isAbsolute = /^[/\\]|[a-zA-Z]:[/\\]/.test(filePath)
      if (rootDir && !isAbsolute) {
        filePath = rootDir.replace(/\\/g, '/').replace(/\/$/, '') + '/' + filePath
      }
      // Primero intentar leer del disco (siempre es la versión más reciente)
      const fromDisk = await readFileFromDisk(filePath)
      if (fromDisk && !fromDisk.startsWith('[Error:') && !fromDisk.startsWith('[No disponible')) {
        if (startLine !== null && endLine !== null) {
          const allLines = fromDisk.split('\n')
          const sliced = allLines.slice(startLine - 1, endLine)
          return sliced.join('\n') + `\n\n[Mostrando líneas ${startLine}-${endLine} de ${allLines.length}]`
        }
        return fromDisk
      }
      // Fallback: buscar en projectFiles (stale pero mejor que nada)
      if (projectFiles) {
        const exact = projectFiles[filePath]
        if (exact) {
          if (exact === '[archivo muy grande, omitido]') return `[Archivo "${filePath}" muy grande, omitido]`
          const lines = exact.split('\n')
          if (startLine !== null && endLine !== null) {
            const sliced = lines.slice(startLine - 1, endLine)
            return sliced.map((l, i) => `${startLine + i}: ${l}`).join('\n') + `\n\n[Mostrando líneas ${startLine}-${endLine} de ${lines.length}]`
          }
          return lines.map((l, i) => `${i + 1}: ${l}`).join('\n')
        }
        // Coincidencia por nombre de archivo (sin ruta)
        const byName = Object.keys(projectFiles).find(k =>
          k.replace(/\\/g, '/').split('/').pop() === filePath.split('/').pop().split('\\').pop()
        )
        if (byName) {
          const resolved = rootDir ? rootDir.replace(/\\/g, '/').replace(/\/$/, '') + '/' + byName : byName
          const fromDiskByName = await readFileFromDisk(resolved)
          if (fromDiskByName && !fromDiskByName.startsWith('[Error:') && !fromDiskByName.startsWith('[No disponible')) {
            if (startLine !== null && endLine !== null) {
              const allLines = fromDiskByName.split('\n')
              const sliced = allLines.slice(startLine - 1, endLine)
              return sliced.join('\n') + `\n\n[Mostrando líneas ${startLine}-${endLine} de ${allLines.length}]`
            }
            return fromDiskByName
          }
          const content = projectFiles[byName]
          if (content === '[archivo muy grande, omitido]') return `[Archivo "${byName}" muy grande, omitido]`
          const lines = content.split('\n')
          if (startLine !== null && endLine !== null) {
            const sliced = lines.slice(startLine - 1, endLine)
            return sliced.map((l, i) => `${startLine + i}: ${l}`).join('\n') + `\n\n[Mostrando líneas ${startLine}-${endLine} de ${lines.length}]`
          }
          return lines.map((l, i) => `${i + 1}: ${l}`).join('\n')
        }
      }
      return await readFileFromDisk(filePath)
    }
    case 'searchproject': {
      if (!projectFiles) return '[Sin proyecto cargado]'
      const query = String(args || '').trim().toLowerCase()
      const results = []
      for (const [rel, content] of Object.entries(projectFiles)) {
        if (!content || content === '[archivo muy grande, omitido]') continue
        const lower = content.toLowerCase()
        if (lower.includes(query)) {
          const lines = content.split('\n')
          const matchLines = []
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(query)) {
              matchLines.push({ line: i + 1, text: lines[i].trim() })
            }
          }
          results.push({ file: rel, matches: matchLines.slice(0, 10) })
        }
      }
      if (results.length === 0) return `[Sin resultados para "${String(args || '').trim()}"]`
      return results.slice(0, 10).map(r =>
        `=== ${r.file} ===\n` + r.matches.map(m => `  ${m.line}: ${m.text}`).join('\n')
      ).join('\n\n')
    }
    case 'listdir': {
      const dirPath = String(args || '').trim()
      return await listDirFromDisk(dirPath)
    }
    case 'glob': {
      const pattern = String(args || '').trim()
      const dir = rootDir || '.'
      if (typeof window !== 'undefined' && window.api?.toolGlob) {
        const r = await window.api.toolGlob(dir, pattern)
        if (r && r.length > 0) {
          return r.map(e => `${e.isDir ? '📁' : '📄'} ${e.path}`).join('\n')
        }
        return `[Sin resultados para "${pattern}"]`
      }
      return '[No disponible fuera de Electron]'
    }
    case 'grep': {
      const query = String(args || '').trim()
      const dir = rootDir || '.'
      if (typeof window !== 'undefined' && window.api?.toolGrep) {
        const r = await window.api.toolGrep(dir, query)
        if (r && r.length > 0) {
          return r.map(g => `=== ${g.file} ===\n` + g.matches.map(m => `  ${m.line}: ${m.text}`).join('\n')).join('\n\n')
        }
        return `[Sin resultados para "${query}"]`
      }
      return '[No disponible fuera de Electron]'
    }
    case 'searchweb': {
      const query = String(args || '').trim()
      const result = await searchWeb(query, 5)
      if (result.ok && result.results.length > 0) {
        return result.results.map((r, i) =>
          `Resultado ${i + 1}: ${r.title}\n  URL: ${r.url}\n  ${r.snippet || ''}`
        ).join('\n\n')
      }
      return `[Sin resultados web para "${query}"]`
    }
    case 'fetchurl': {
      const url = String(args || '').trim()
      if (typeof window !== 'undefined' && window.api?.fetchURL) {
        const r = await window.api.fetchURL(url)
        if (r.ok) {
          const text = r.text.slice(0, 20000)
          return `URL: ${r.url}\n\n${text}`
        }
        return `[Error fetching ${url}: ${r.error}]`
      }
      return '[No disponible fuera de Electron]'
    }
    case 'git': {
      const dir = rootDir || '.'
      const cmd = String(args || '').trim()
      if (typeof window !== 'undefined' && window.api?.runCommand) {
        const r = await window.api.runCommand({ command: `git ${cmd}`, cwd: dir })
        let out = ''
        if (r.out) out += r.out
        if (r.err) out += '\n' + r.err
        if (!String(out || '').trim()) out = '(sin salida)'
        return String(out || '').trim()
      }
      return '[No disponible fuera de Electron]'
    }
    case 'createplan': {
      loadPlans()
      const parts = (args || '').split('|').map(s => String(s || '').trim()).filter(Boolean)
      if (parts.length < 2) return '[Uso: [TOOL: createPlan título | paso 1 | paso 2 | ...]]'
      const title = parts[0]
      const steps = parts.slice(1).map(desc => ({ desc, status: 'pending' }))
      const plan = { id: getNextPlanId(), title, steps, createdAt: new Date().toLocaleString() }
      _plans.push(plan)
      savePlans()
      return `✅ Plan creado: **${title}**\n\n${formatPlan(plan)}`
    }
    case 'updateplan': {
      loadPlans()
      const parts = args.split(/\s+/)
      if (parts.length < 2) return '[Uso: [TOOL: updatePlan stepIndex status] — ej: updatePlan 2 completed]'
      const stepIdx = parseInt(parts[0]) - 1
      const status = parts.slice(1).join(' ').toLowerCase()
      if (!['pending', 'in_progress', 'completed'].includes(status)) return '[Status inválido. Usá: pending, in_progress, o completed]'
      const active = _plans[_plans.length - 1]
      if (!active) return '[No hay planes activos]'
      if (stepIdx < 0 || stepIdx >= active.steps.length) return `[Paso ${parts[0]} fuera de rango (1-${active.steps.length})]`
      active.steps[stepIdx].status = status
      savePlans()
      return `✅ Plan actualizado\n\n${formatPlan(active)}`
    }
    case 'listplans': {
      loadPlans()
      if (_plans.length === 0) return '[No hay planes creados. Usá [TOOL: createPlan título | paso 1 | paso 2] para crear uno.]'
      return _plans.map((p, i) => {
        const done = p.steps.filter(s => s.status === 'completed').length
        return `**${i + 1}.** ${p.title} — ${done}/${p.steps.length} completado`
      }).join('\n')
    }
    case 'undo': {
      if (undoHistory.length === 0) return '[No hay cambios para deshacer]'
      const count = Math.min(parseInt(String(args || '').trim()) || 1, undoHistory.length)
      const results = []
      for (let i = 0; i < count; i++) {
        const entry = undoHistory[i]
        if (entry && typeof window !== 'undefined' && window.api?.writeFile) {
          await window.api.writeFile({ p: entry.filePath, content: entry.originalContent })
          results.push(`↩ Restaurado: ${entry.filePath} (${entry.actionDesc})`)
        }
      }
      undoHistory.splice(0, count)
      return results.length > 0 ? results.join('\n') : '[No se pudo deshacer]'
    }
    case 'tree': {
      const dir = (String(args || '').trim() || rootDir || '.').split(/\s+/)[0]
      let maxDepth = 3
      const depthMatch = String(args || '').trim().match(/depth=(\d+)/i)
      if (depthMatch) maxDepth = parseInt(depthMatch[1])
      if (typeof window !== 'undefined' && window.api?.readDir) {
        const lines = ['📁 ' + dir]
        async function walk(dirPath, depth) {
          if (depth > maxDepth) return
          const entries = await window.api.readDir(dirPath).catch(() => [])
          for (const e of entries) {
            const prefix = '  '.repeat(depth) + (e.isDir ? '📁' : '📄')
            lines.push(prefix + ' ' + e.name)
            if (e.isDir) await walk(e.path, depth + 1)
          }
        }
        await walk(dir, 1)
        return lines.join('\n')
      }
      return '[No disponible fuera de Electron]'
    }
    case 'review': {
      const filePath = String(args || '').trim()
      const content = await readFileFromDisk(filePath)
      if (!content || content.startsWith('[Error') || content.startsWith('[No disponible'))
        return `[No se pudo leer "${filePath}"]`
      return `📋 **Review: ${filePath}**\n\n` + content + '\n\n---\n_Revisá el código arriba. Identificá: bugs, seguridad, performance, estilo, mejores prácticas._'
    }
    case 'rename': {
      const parts = args.split(/\s+/)
      if (parts.length < 2) return '[Uso: [TOOL: rename oldName newName] — renombra en todos los archivos del proyecto]'
      const [oldName, newName] = parts
      if (typeof window !== 'undefined' && window.api?.toolGrep) {
        const matches = await window.api.toolGrep(rootDir || '.', oldName)
        if (!matches || matches.length === 0) return `[Sin ocurrencias de "${oldName}" en el proyecto]`
        const results = []
        for (const m of matches) {
          const fp = rootDir ? rootDir.replace(/\\/g, '/').replace(/\/$/, '') + '/' + m.file : m.file
          const r = await window.api.readFile(fp)
          if (r.ok) {
            const replaced = r.content.replace(new RegExp(oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), newName)
            await window.api.writeFile({ p: fp, content: replaced })
            results.push(`✏ ${m.file} — ${m.matches.length} reemplazo(s)`)
          }
        }
        return results.length > 0
          ? `✅ Renombrado "${oldName}" → "${newName}"\n` + results.join('\n')
          : '[No se pudo renombrar]'
      }
      return '[No disponible fuera de Electron]'
    }
    case 'createcomponent': {
      const name = String(args || '').trim().replace(/\s+/g, '')
      if (!name) return '[Uso: [TOOL: createComponent Button] — crea un componente con estructura y estilos]'
      const ext = (rootDir && rootDir.match(/react|next|vue/i)) ? 'jsx' : 'jsx'
      const comp = `import React from 'react'\n\nfunction ${name}({ children, ...props }) {\n  return (\n    <div className="${name.toLowerCase()}" {...props}>\n      {children}\n    </div>\n  )\n}\n\nexport default ${name}\n`
      const dir = rootDir || '.'
      const fp = dir.replace(/\\/g, '/').replace(/\/$/, '') + `/src/components/${name}/${name}.${ext}`
      await window.api?.writeFile({ p: fp, content: comp })
      return `✅ Componente creado: ${fp}\n\n\`\`\`${ext}\n${comp}\`\`\``
    }
    case 'changelog': {
      const dir = rootDir || '.'
      if (typeof window !== 'undefined' && window.api?.runCommand) {
        const r = await window.api.runCommand({ command: 'git log --oneline --date=short --format="%ad %h %s" -50', cwd: dir })
        if (r.out) return `📋 **Changelog**\n\n` + String(r.out || '').trim()
        if (r.err) return `[Error: ${r.err}]`
        return '[No hay commits o no es un repositorio git]'
      }
      return '[No disponible fuera de Electron]'
    }
    case 'learn': {
      // [TOOL: learn type="correction" tags="react,import" context="..." solution="..." code="..." file="..."]
      const fields = {}
      args.replace(/(\w+)="([^"]*)"/g, (_, k, v) => { fields[k] = v; return '' })
      const type = fields.type || 'solution'
      const tags = (fields.tags || '').split(',').map(t => t.trim()).filter(Boolean)
      const context = fields.context || String(args || '').replace(/\w+="[^"]*"/g, '').trim()
      const solution = fields.solution || ''
      const code = fields.code || ''
      const file = fields.file || ''
      const project = rootDir || ''
      addExperience({ type, tags, context, solution, code, file, project })
      const db = loadExp()
      return `✅ Experiencia guardada (${db.length} total). Tipo: ${type}${tags.length ? ', tags: ' + tags.join(', ') : ''}`
    }
    case 'remember': {
      const query = String(args || '').trim()
      const results = searchExperience(query, 5)
      if (results.length === 0) return `[Sin experiencias previas para "${query}"]`
      saveExp() // persist updated counts
      return results.map((e, i) =>
        `**${i + 1}.** [${e.type}] ${e.context.slice(0, 100)}\n` +
        `   Tags: ${e.tags.join(', ') || '—'}\n` +
        `   Solución: ${e.solution.slice(0, 300)}\n` +
        (e.file ? `   Archivo: ${e.file}\n` : '') +
        (e.code ? `   Código:\n   \`\`\`\n   ${e.code.slice(0, 500)}\n   \`\`\`\n` : '') +
        `   _${new Date(e.timestamp).toLocaleDateString()} · usado ${e.count} veces_`
      ).join('\n\n')
    }
    case 'experience': {
      const action = String(args || '').trim().toLowerCase()
      if (action === 'stats' || action === '') {
        const stats = getExperienceStats()
        const db = loadExp()
        let out = `📊 **Experiencia Database**\n\nTotal: ${stats.total} entradas\n\n`
        for (const [type, count] of Object.entries(stats.byType)) {
          out += `- ${type}: ${count}\n`
        }
        if (db.length > 0) {
          out += `\n**Más usadas:**\n`
          const sorted = [...db].sort((a, b) => b.count - a.count).slice(0, 3)
          sorted.forEach(e => out += `- [${e.count}x] ${e.context.slice(0, 80)}\n`)
        }
        return out
      }
      if (action === 'clear') {
        _expCache = []
        saveExp()
        return '🧹 Experiencia database limpiada'
      }
      return '[Uso: [TOOL: experience stats] o [TOOL: experience clear]]'
    }
    case 'timeline': {
      // [TOOL: timeline "21:00" window=30]
      // [TOOL: timeline "hace 1 hora"]
      // [TOOL: timeline "2024-01-15"]
      const now = new Date()
      let targetTime = now
      let windowMin = 30
      let query = String(args || '').trim()

      // Parse window=N parameter
      const wm = query.match(/window=(\d+)/i)
      if (wm) { windowMin = parseInt(wm[1]); query = String(query || '').replace(/window=\d+/i, '').trim() }

      // Parse time queries
      query = String(query || '').replace(/^["']|["']$/g, '').trim()
      if (/^\d{1,2}:\d{2}$/.test(query)) {
        const [h, m] = query.split(':').map(Number)
        targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m)
        if (targetTime > now) targetTime.setDate(targetTime.getDate() - 1)
      } else if (/^hace\s+(\d+)\s+(minuto|min|hora|h)s?/.test(query)) {
        const pm = query.match(/^hace\s+(\d+)\s+(minuto|min|hora|h)/i)
        const amount = parseInt(pm[1])
        const unit = pm[2].toLowerCase()
        targetTime = new Date(now.getTime() - amount * (unit.startsWith('h') ? 3600000 : 60000))
      } else if (/^ayer/.test(query)) {
        targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 12, 0)
      } else if (/^\d{4}-\d{2}-\d{2}/.test(query)) {
        targetTime = new Date(query)
      }

      const startWindow = new Date(targetTime.getTime() - windowMin * 60000)
      const endWindow = new Date(targetTime.getTime() + windowMin * 60000)

      // Collect: experience DB entries in window
      const db = loadExp()
      const expInWindow = db.filter(e => {
        const t = new Date(e.timestamp).getTime()
        return t >= startWindow.getTime() && t <= endWindow.getTime()
      })

      // Collect: undo history entries in window
      const undoInWindow = undoHistory.filter(e => {
        const t = new Date(e.timestamp).getTime()
        return t >= startWindow.getTime() && t <= endWindow.getTime()
      })

      // Build timeline
      const timeline = []
      expInWindow.forEach(e => timeline.push({
        time: new Date(e.timestamp), type: 'experience',
        desc: `[${e.type}] ${e.context.slice(0, 120)}`,
        detail: e.solution.slice(0, 200)
      }))
      undoInWindow.forEach(e => timeline.push({
        time: new Date(e.timestamp), type: 'change',
        desc: e.actionDesc,
        detail: e.filePath
      }))

      timeline.sort((a, b) => a.time - b.time)

      if (timeline.length === 0) {
        return `[Sin eventos cerca de las ${targetTime.toLocaleString()} (ventana: ±${windowMin}min)]`
      }

      const fmt = (d) => d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
      let out = `📋 **Timeline** cerca de ${targetTime.toLocaleString('es-AR')}\n`
      out += `_Ventana: ${fmt(startWindow)} → ${fmt(endWindow)} (${windowMin}min)_\n\n`
      timeline.forEach((e, i) => {
        const icon = e.type === 'experience' ? '🧠' : '✏'
        out += `${icon} **${fmt(e.time)}** — ${e.desc}\n`
        if (e.detail) out += `   ${e.detail}\n`
      })
      out += `\n_${timeline.length} evento(s) encontrados_`
      return out
    }
    case 'run': {
      // [TOOL: run cargo check] or native { command: "cargo check" }
      const dir = rootDir || '.'
      if (typeof window !== 'undefined' && window.api?.runCommand) {
        const r = await window.api.runCommand({ command: args, cwd: dir })
        let out = ''
        if (r.out) out += r.out
        if (r.err) out += '\n⚠ ' + r.err
        if (!String(out || '').trim()) out = '(sin salida)'
        if (r.code !== 0) out += '\n❌ Exit code: ' + r.code
        return String(out || '').trim()
      }
      return '[run no disponible fuera de Electron]'
    }
    case 'screenshot': {
      // [TOOL: screenshot] or native tool call with screenshot
      const result = await takeScreenshot()
      if (!result.ok) return `[Error: ${result.error}]`
      return {
        _image: { base64: result.dataUrl, name: `captura-${Date.now()}.png` },
        text: `📸 Captura realizada (${result.width}x${result.height}, ${result.size} bytes). La imagen se incluyó para análisis visual.`,
      }
    }
    default:
      return `[Herramienta desconocida: ${toolName}]`
  }
  } catch (err) {
    console.error('[executeToolCall] Error en herramienta', toolName, ':', err.message)
    return `[Error en herramienta "${toolName}": ${err.message}]`
  }
}

// ── Providers ────────────────────────────────────────────────────────────────

export const PROVIDERS = {
  ollama: {
    name: 'Ollama', label: 'Local · sin límite', color: '#4ec9b0',
    defaultModel: 'llama3.2:3b',
    models: [
      'llama3.2:3b','llama3.2:1b','deepseek-coder:1.3b','qwen2.5-coder:1.5b',
      'gemma2:2b','phi3:mini','codellama','mistral','deepseek-r1:7b',
    ],
    modelSizes: {
      'llama3.2:1b':'700MB','llama3.2:3b':'2GB','deepseek-coder:1.3b':'800MB',
      'qwen2.5-coder:1.5b':'1GB','gemma2:2b':'1.6GB','phi3:mini':'2.3GB',
      'codellama':'4GB','mistral':'4GB','deepseek-r1:7b':'4.7GB',
    },
    requiresKey: false,
  },

  groq: {
    name: 'Groq', label: 'Gratis · muy rápido', color: '#c586c0',
    defaultModel: 'llama-3.1-8b-instant',
    models: [
      'llama-3.1-8b-instant',       // orquestador + tareas rápidas
      'llama-3.3-70b-versatile',    // análisis profundo
      'llama-3.2-3b-preview',       // ultra rápido
      'deepseek-r1-distill-llama-70b', // razonamiento
      'mixtral-8x7b-32768',
      'gemma2-9b-it',
      'qwen-qwq-32b',
    ],
    requiresKey: true, keyUrl: 'https://console.groq.com/keys',
    baseUrl: 'https://api.groq.com/openai/v1',
    ctxK: 128,
  },

  gemini: {
    name: 'Gemini', label: 'Gratis · 1M contexto', color: '#569cd6',
    defaultModel: 'gemini-2.5-flash',
    models: [
      'gemini-2.5-flash',        // recomendado — rápido, gratis, 1M ctx
      'gemini-2.5-flash-lite',   // más barato/rápido
      'gemini-2.5-pro',          // más potente, 1M ctx
      'gemini-3.1-flash-lite',   // más nuevo, muy eficiente
      'gemini-3.1-pro',          // última generación flagship
    ],
    requiresKey: true, keyUrl: 'https://aistudio.google.com/app/apikey',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    ctxK: 1000,
  },

  openrouter: {
    name: 'OpenRouter', label: 'Modelos gratis dinámicos', color: '#ce9178',
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    models: ['meta-llama/llama-3.1-8b-instruct:free'],
    requiresKey: true, keyUrl: 'https://openrouter.ai/keys',
    baseUrl: 'https://openrouter.ai/api/v1',
    ctxK: 128,
  },

  // OpenCode Zen — gateway curado de modelos, pay-as-you-go + modelos -free
  zen: {
    name: 'Zen', label: 'Pay-as-you-go · modelos top', color: '#98c379',
    defaultModel: 'big-pickle',
    models: [
      // ── Gratis (sin créditos) ────────────────────────────
      'nemotron-3-super-free',     // NVIDIA Nemotron — gratis
      'minimax-m2.5-free',         // MiniMax M2.5 — gratis
      'hy3-preview-free',          // Hunyuan 3 preview — gratis
      'ling-2.6-flash-free',       // Ling 2.6 Flash — gratis
      'trinity-large-preview-free',// Trinity Large — gratis
      // ── Requieren créditos ────────────────────────────────
      'big-pickle',                // modelo top de Zen
      'gpt-5-nano',                // GPT-5 Nano
      'gpt-5',                     // GPT-5
      'minimax-m2.7',              // MiniMax M2.7
      'kimi-k2.5',                 // Kimi K2.5
      'qwen3.5-plus',              // Qwen 3.5 Plus
      'gemini-3-flash',            // Gemini 3 Flash
      'claude-3-5-haiku',          // Claude Haiku
    ],
    requiresKey: true,
    keyUrl: 'https://opencode.ai/zen',
    baseUrl: 'https://opencode.ai/zen/v1',
    ctxK: 128,
    note: 'opencode.ai/zen — registrate, cargá créditos, copiá la API key. Modelos con sufijo -free no requieren créditos.',
  },

  // Cerebras — inferencia ultra rápida (~2000 tok/s)
  cerebras: {
    name: 'Cerebras', label: 'Gratis · 2000 tok/s', color: '#e06c75',
    defaultModel: 'gpt-oss-120b',
    models: [
      'gpt-oss-120b',                // OpenAI GPT OSS — 120B, ~3000 tok/s
      'llama3.1-8b',                 // Llama 3.1 8B — ~2200 tok/s
      'zai-glm-4.7',                 // Z.ai GLM 4.7 — 355B (preview)
      'qwen-3-235b-a22b-instruct-2507', // Qwen 3 235B (preview, deprecado May 27)
    ],
    requiresKey: true, keyUrl: 'https://cloud.cerebras.ai',
    baseUrl: 'https://api.cerebras.ai/v1',
    ctxK: 128,
  },

  // Mistral — La Plateforme, tier gratis generoso
  mistral: {
    name: 'Mistral', label: 'Gratis · 2 RPM · EU data', color: '#d19a66',
    defaultModel: 'mistral-small-latest',
    models: [
      'mistral-small-latest',  // free tier con rate limit
      'open-mistral-7b',       // open, gratis
      'open-mixtral-8x7b',     // open, gratis  
      'mistral-nemo-latest',   // 128K ctx, gratis
      // codestral-latest: $0.30/1M tokens — NO gratis
    ],
    requiresKey: true, keyUrl: 'https://console.mistral.ai/api-keys/',
    baseUrl: 'https://api.mistral.ai/v1',
    ctxK: 128,
  },

  // Together — OpenAI-compatible route for Together.ai
  together: {
    name: 'Together', label: 'OpenAI compatible', color: '#7f5af0',
    defaultModel: 'gpt-4o-mini',
    models: [
      'gpt-4o-mini',
      'gpt-4o',
      'gpt-4o-mini-vision',
    ],
    requiresKey: true,
    keyUrl: 'https://together.xyz',
    baseUrl: 'https://api.together.xyz/openai',
    ctxK: 128,
  },

  // SambaNova — Llama 3.1 405B gratis, 30 RPM sin tarjeta
  sambanova: {
    name: 'SambaNova', label: 'Gratis · 30 RPM · sin tarjeta', color: '#ff6b6b',
    defaultModel: 'Meta-Llama-3.3-70B-Instruct',
    models: [
      'Meta-Llama-3.3-70B-Instruct',
      'Meta-Llama-3.1-405B-Instruct',
      'Meta-Llama-3.1-8B-Instruct',
      'DeepSeek-R1',
      'DeepSeek-V3-0324',
      'Qwen2.5-Coder-32B-Instruct',
    ],
    requiresKey: true, keyUrl: 'https://cloud.sambanova.ai/apis',
    baseUrl: 'https://api.sambanova.ai/v1',
    ctxK: 128,
  },

  // Fireworks AI — 10 RPM gratis sin tarjeta
  fireworks: {
    name: 'Fireworks', label: 'Gratis · 10 RPM · sin tarjeta', color: '#ffa94d',
    defaultModel: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
    models: [
      'accounts/fireworks/models/llama-v3p1-8b-instruct',
      'accounts/fireworks/models/llama-v3p1-70b-instruct',
      'accounts/fireworks/models/deepseek-r1',
      'accounts/fireworks/models/qwen2p5-coder-32b-instruct',
      'accounts/fireworks/models/mixtral-8x7b-instruct',
    ],
    requiresKey: true, keyUrl: 'https://fireworks.ai/api-keys',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    ctxK: 131,
  },

  // DeepSeek — 5M tokens gratis al registrarse, muy barato después
  deepseek: {
    name: 'DeepSeek', label: 'Gratis 5M tokens · muy barato', color: '#4dabf7',
    defaultModel: 'deepseek-chat',
    models: [
      'deepseek-chat',       // DeepSeek-V3 (mejor relación precio/calidad)
      'deepseek-reasoner',   // DeepSeek-R1 (razonamiento)
    ],
    requiresKey: true, keyUrl: 'https://platform.deepseek.com/api_keys',
    baseUrl: 'https://api.deepseek.com/v1',
    ctxK: 64,
  },

  // NVIDIA NIM — 1000 req/mes gratis, modelos grandes
  nvidia: {
    name: 'NVIDIA NIM', label: 'Gratis · 1000 req/mes', color: '#76b900',
    defaultModel: 'meta/llama-3.1-405b-instruct',
    models: [
      'meta/llama-3.1-405b-instruct',
      'meta/llama-3.3-70b-instruct',
      'deepseek-ai/deepseek-r1',
      'qwen/qwen2.5-coder-32b-instruct',
      'mistralai/mistral-7b-instruct-v0.3',
    ],
    requiresKey: true, keyUrl: 'https://build.nvidia.com',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    ctxK: 128,
  },

  auto: {
    name: 'Orquestado', label: 'Auto · router inteligente', color: '#ffcc00',
    defaultModel: 'auto',
    models: ['auto'],
    requiresKey: false,
  },
}

// ── Clasificación de complejidad → modelo OpenRouter ──────────────────────────

const OR_MODEL_BY_COMPLEXITY = {
  simple:   'meta-llama/llama-3.2-3b-instruct:free',
  balanced: 'meta-llama/llama-3.1-8b-instruct:free',
  deep:     'mistralai/mistral-7b-instruct:free',
  instruct: 'mistralai/mistral-7b-instruct:free',
  vision:   'meta-llama/llama-3.2-11b-vision-instruct:free',
}

// Modelos Zen curados (se actualizan con fetchZenModels)
const ZEN_CURATED = [
  'claude-3-5-haiku',
  'gpt-4o-mini',
  'gemini-flash-1.5',
  'llama-3.1-8b-instruct',
  'mistral-7b-instruct',
]

// ── Cache de modelos dinámicos ────────────────────────────────────────────────

let _freeModelsCache = null, _freeModelsCacheAt = 0
let _zenModelsCache  = null, _zenModelsCacheAt  = 0

const CURATED_FREE = [
  'google/gemma-2-9b-it:free',
  'google/gemma-2-2b-it:free',
  'meta-llama/llama-3.1-8b-instruct:free',
  'meta-llama/llama-3.2-3b-instruct:free',
  'mistralai/mistral-7b-instruct:free',
  'microsoft/phi-3-mini-128k-instruct:free',
  'nousresearch/hermes-3-llama-3.1-8b:free',
]

export function removeFailedModel(modelId, cache = 'or') {
  const c = cache === 'zen' ? _zenModelsCache : _freeModelsCache
  if (!c) return
  const idx = c.indexOf(modelId)
  if (idx !== -1) c.splice(idx, 1)
}

// OpenRouter: obtiene todos los modelos gratuitos (prompt=0, completion=0)
export async function fetchFreeModels(force = false) {
  const now = Date.now()
  if (!force && _freeModelsCache && now - _freeModelsCacheAt < 300_000) return _freeModelsCache
  try {
    const d = await doFetch('https://openrouter.ai/api/v1/models')
    const dynamic = (d.data || [])
      .filter(m => { const p = m.pricing || {}; return String(p.prompt) === '0' && String(p.completion) === '0' })
      .map(m => m.id)
      .filter(id => !CURATED_FREE.includes(id) && typeof id === 'string' && id.trim().length > 0)
    _freeModelsCache = [...CURATED_FREE, ...dynamic]
    _freeModelsCacheAt = now
  } catch {
    _freeModelsCache = _freeModelsCache || [...CURATED_FREE]
    _freeModelsCacheAt = now
  }
  return _freeModelsCache
}

// Zen (opencode.ai): obtiene modelos disponibles, separa free de pagos
export async function fetchZenModels(force = false) {
  const now = Date.now()
  if (!force && _zenModelsCache && now - _zenModelsCacheAt < 300_000) return _zenModelsCache
  try {
    const d = await doFetch('https://opencode.ai/zen/v1/models')
    const all = (d.data || d.models || []).map(m => m.id || m).filter(Boolean)
    // Free models first (no credits needed), then paid
    const free = all.filter(id => id.endsWith('-free'))
    const paid = all.filter(id => !id.endsWith('-free'))
    _zenModelsCache = [...free, ...paid]
    _zenModelsCacheAt = now
  } catch {
    _zenModelsCache = _zenModelsCache || [...ZEN_CURATED]
    _zenModelsCacheAt = now
  }
  return _zenModelsCache
}

// Returns only the free Zen models (no credits needed)
export async function fetchZenFreeModels() {
  const all = await fetchZenModels()
  return all.filter(id => id.endsWith('-free'))
}

// ── Health checks ─────────────────────────────────────────────────────────────

export async function checkOllamaStatus() {
  try {
    const d = await doFetch('http://localhost:11434/api/tags')
    return { running: true, models: (d.models || []).map(m => m.name) }
  } catch { return { running: false, models: [] } }
}

export async function checkZenStatus() {
  try {
    const models = await fetchZenModels()
    return { running: models.length > 0, models }
  } catch { return { running: false, models: [] } }
}

// Ping genérico OpenAI-compatible: retorna { ok, latencyMs, error? }
export async function pingProvider(provider, apiKey) {
  const pInfo = PROVIDERS[provider]
  if (!pInfo?.baseUrl) return { ok: false, error: 'Sin baseUrl' }
  const t0 = Date.now()
  try {
    const hdrs = apiKey ? { Authorization: 'Bearer ' + apiKey } : {}
    await doFetch(pInfo.baseUrl + '/models', { method:'GET', headers: hdrs })
    return { ok: true, latencyMs: Date.now() - t0 }
  } catch (e) {
    return { ok: false, latencyMs: Date.now() - t0, error: e.message }
  }
}

// ── Validar modelo en proveedor ──────────────────────────────────────────────

export async function validateModel(provider, model, apiKey) {
  const pInfo = PROVIDERS[provider]
  if (!pInfo) return { valid: false, error: 'Proveedor desconocido' }
  if (!pInfo.models.includes(model)) return { valid: false, error: 'Modelo no en lista local' }

  // Para proveedores que requieren key, intentar ping básico
  if (pInfo.requiresKey && apiKey) {
    try {
      const hdrs = { Authorization: 'Bearer ' + apiKey }
      const res = await doFetch(pInfo.baseUrl + '/models', { method:'GET', headers: hdrs })
      const data = res
      if (data && Array.isArray(data.data || data)) {
        const availableModels = (data.data || data).map(m => m.id || m)
        if (!availableModels.includes(model)) {
          return { valid: false, error: `Modelo '${model}' no disponible en ${pInfo.name}` }
        }
      }
    } catch (e) {
      return { valid: false, error: `Error validando modelo: ${e.message}` }
    }
  }

  return { valid: true }
}

// ── Búsqueda web ──────────────────────────────────────────────────────────────

export async function searchWeb(query, maxResults = 5) {
  if (!query || typeof query !== 'string') return { ok: false, error: 'Query vacío' }
  
  try {
    // Usar DuckDuckGo API pública (sin requerimientos de key)
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_redirect=1`
    const data = await doFetch(url)
    
    const results = []
    
    // Resultados relacionados
    if (data.RelatedTopics && Array.isArray(data.RelatedTopics)) {
      data.RelatedTopics.slice(0, maxResults).forEach(topic => {
        if (topic.Text && topic.FirstURL) {
          results.push({
            title: topic.Text.slice(0, 100),
            url: topic.FirstURL,
            source: 'DuckDuckGo'
          })
        }
      })
    }
    
    // Resultado instantáneo si existe
    if (data.AbstractText && results.length < maxResults) {
      results.unshift({
        title: data.Heading || query,
        snippet: data.AbstractText,
        url: data.AbstractURL,
        source: 'DuckDuckGo Instant'
      })
    }
    
    return {
      ok: true,
      query,
      results: results.slice(0, maxResults),
      timestamp: new Date().toISOString()
    }
  } catch (e) {
    return { ok: false, error: `Búsqueda fallida: ${e.message}` }
  }
}

// ── Retry con backoff exponencial ─────────────────────────────────────────────

async function withRetry(fn, { maxRetries = 2, baseDelayMs = 800, signal } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error('Cancelado')
    try { return await fn() } catch (e) {
      lastErr = e
      const msg = String(e.message)
      const isRateLimit   = /429|rate.?limit|too.?many/i.test(msg)
      const isCreditLimit = /402|credit.?limit|add.?credit|billing/i.test(msg)
      // Never retry on credit/auth errors — fail fast with clear message
      if (isCreditLimit) throw new Error('⚠ Créditos agotados en este proveedor.\nCargá créditos o cambiá a otro proveedor.\n\nDetalle: ' + msg.slice(0, 120))
      if (!isRateLimit || attempt === maxRetries) throw e
      const delay = baseDelayMs * Math.pow(2, attempt) + Math.random() * 300
      await new Promise(res => setTimeout(res, delay))
    }
  }
  throw lastErr
}

// ── Estimación de tokens (aprox 4 chars/token) ───────────────────────────────

export function estimateTokens(text) {
  return Math.ceil((text || '').length / 4)
}

/** Recorta texto para acercarse a un techo de tokens (~4 chars/token). */
export function truncateTextByTokens(text, maxTokens) {
  const t = text || ''
  const maxChars = Math.max(0, Math.floor(maxTokens * 4) - 64)
  if (t.length <= maxChars) return t
  return `${t.slice(0, maxChars)}\n… [truncado por límite de contexto]`
}

/**
 * Bloque de contexto para la IA: destripe + HTML/texto de página en vivo.
 */
export function formatWebPageIntelBlock(intel, maxTokensTotal = 12000) {
  if (!intel || typeof intel !== 'object') return ''
  const md = intel.destripeMarkdown || ''
  const snap = intel.snapshot
  const hasSnap = snap && (snap.html || snap.text)
  if (!String(md).trim() && !hasSnap) return ''

  const fe = `${String.fromCharCode(96).repeat(3)}`
  const maxMd = Math.floor(maxTokensTotal * 0.34)
  const maxSnap = Math.floor(maxTokensTotal * 0.66)

  const parts = []
  parts.push('## [Contexto de página web — referencia para recrear UI o comportamiento]')
  parts.push('Usá este material como fuente técnica para explicar cómo reproducir layouts, componentes, estilos o integraciones (HTML/CSS/JS, librerías deducibles, URLs de API/CDN/streaming del destripe). Si hay manifiestos HLS/DASH y el usuario busca **simplificar el acceso** (ej. adultos mayores) sobre contenido **público y permitido por el emisor**, proponé reproductores mínimos y UX accesible sin eludir DRM ni restricciones. Si el DOM está minificado o es salida de framework, proponé una versión estructurada equivalente sin inventar endpoints privados.')
  if (intel.surfaceSource) parts.push(`**Origen de la captura DOM:** ${intel.surfaceSource}`)
  parts.push('')
  const urlLine = (snap && snap.url) || intel.destripeUrl || ''
  if (urlLine) parts.push(`**URL:** ${urlLine}`)
  if (snap?.title) parts.push(`**Título:** ${snap.title}`)
  parts.push('')

  if (String(md).trim()) {
    parts.push('### Inventario destripe (scripts, estilos, multimedia, red)')
    parts.push(truncateTextByTokens(md, maxMd))
    parts.push('')
  }

  if (hasSnap) {
    parts.push('### Captura en vivo (DOM)')
    if (snap.text) {
      parts.push('**Texto visible**')
      parts.push(`${fe}\n${truncateTextByTokens(snap.text, Math.floor(maxSnap * 0.22))}\n${fe}`)
      parts.push('')
    }
    if (snap.html) {
      parts.push('**HTML (document.documentElement.outerHTML)**')
      parts.push(`${fe}\n${truncateTextByTokens(snap.html, Math.floor(maxSnap * 0.78))}\n${fe}`)
      if (snap.htmlTruncated || snap.textTruncated) {
        parts.push('_Parte del HTML/texto fue truncada por tamaño._')
      }
    }
  }

  let joined = parts.join('\n')
  if (estimateTokens(joined) > maxTokensTotal) joined = truncateTextByTokens(joined, maxTokensTotal)
  return joined
}

export function estimateMessagesTokens(messages) {
  return messages.reduce((s, m) => s + estimateTokens(m.content || '') + 4, 0)
}

// ── IPC Proxy (Electron) — bypasses CORS ─────────────────────────────────────
// In Electron, all HTTP goes through main process (Node.js, no CORS).
// Falls back to native fetch when running in browser/dev outside Electron.

let _reqId = 0
function nextId() { return 'r' + (++_reqId) + '_' + Date.now() }

function ipcStream(url, headers, body, signal, onChunk, parseLine) {
  return new Promise((resolve, reject) => {
    const id  = nextId()
    let full  = '', buf = ''
    let done  = false

    const cleanup = window.api.aiStream(id, url, headers, body, (msg) => {
      if (done) return
      if (signal?.aborted) { done = true; cleanup?.(); reject(new Error('Cancelado')); return }

      if (msg.error) {
        done = true; cleanup?.()
        reject(new Error(msg.error))
        return
      }
      if (msg.chunk) {
        buf += msg.chunk
        const lines = buf.split('\n'); buf = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try { const c = parseLine(line); if (c) { full += c; onChunk?.(c, full) } } catch {}
        }
      }
      if (msg.done) {
        if (buf.trim()) {
          try { const c = parseLine(buf); if (c) { full += c; onChunk?.(c, full) } } catch {}
          buf = ''
        }
        done = true; cleanup?.(); resolve(full)
      }
    })

    signal?.addEventListener('abort', () => {
      if (!done) { done = true; cleanup?.(); reject(new Error('Cancelado')) }
    })
  })
}

async function nativeFetchStream(url, headers, body, signal, onChunk, parseLine) {
  const r = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const t = await r.text().catch(() => '')
    throw new Error(r.status + ': ' + t.slice(0, 300))
  }
  const reader = r.body.getReader()
  const dec    = new TextDecoder()
  let full = '', buf = ''
  try {
    while (true) {
      if (signal?.aborted) { reader.cancel(); break }
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n'); buf = lines.pop() || ''
      for (const line of lines) {
        if (!line.trim()) continue
        try { const c = parseLine(line); if (c) { full += c; onChunk?.(c, full) } } catch {}
      }
    }
    if (buf.trim()) {
      try { const c = parseLine(buf); if (c) { full += c; onChunk?.(c, full) } } catch {}
      buf = ''
    }
  } finally { try { reader.releaseLock() } catch {} }
  return full
}

// Unified: uses IPC in Electron, native fetch otherwise
async function doStream(url, headers, body, signal, onChunk, parseLine) {
  if (typeof window !== 'undefined' && window.api?.aiStream) {
    return ipcStream(url, headers, body, signal, onChunk, parseLine)
  }
  return nativeFetchStream(url, headers, body, signal, onChunk, parseLine)
}

// Non-streaming fetch (model lists, health checks)
async function doFetch(url, opts = {}) {
  if (typeof window !== 'undefined' && window.api?.aiFetch) {
    const r = await window.api.aiFetch(url, opts)
    if (!r.ok) throw new Error(r.status + ': ' + (r.text || '').slice(0, 200))
    return JSON.parse(r.text)
  }
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(5000) })
  if (!r.ok) throw new Error('HTTP ' + r.status)
  return r.json()
}

// ── Callers por proveedor ─────────────────────────────────────────────────────

async function callOllama({ model, messages, signal, onChunk, ollamaUrl = 'http://localhost:11434' }) {
  const url  = ollamaUrl + '/api/chat'
  const body = { model, messages, stream: true }
  return doStream(url, {}, body, signal, onChunk,
    l => { try { return JSON.parse(l).message?.content || '' } catch { return '' } })
}

async function callOpenAI({ baseUrl, apiKey, model, messages, signal, onChunk, extra = {}, tools, onToolCalls, onMetadata, reasoningContent }) {
  const url  = baseUrl + '/chat/completions'
  const hdrs = { ...(apiKey ? { Authorization: 'Bearer ' + apiKey } : {}), ...extra }
  const body = { model, messages, stream: true, ...(reasoningContent ? { reasoning_content: reasoningContent } : {}) }
  if (tools?.length) body.tools = tools

  let toolCallsAccum = {}
  let finishReason = null

  const parseLine = l => {
    if (l === 'data: [DONE]' || !l.startsWith('data: ')) return ''
    try {
      const parsed = JSON.parse(l.slice(6))
      const choice = parsed.choices?.[0]
      if (!choice) return ''
      if (choice.finish_reason) finishReason = choice.finish_reason
      const delta = choice.delta
      if (!delta) return ''
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index
          if (!toolCallsAccum[idx]) toolCallsAccum[idx] = { id: tc.id || '', name: '', arguments: '' }
          if (tc.id) toolCallsAccum[idx].id = tc.id
          if (tc.function?.name) toolCallsAccum[idx].name += tc.function.name
          if (tc.function?.arguments) toolCallsAccum[idx].arguments += tc.function.arguments
        }
      }
      if (delta.reasoning_content) {
        onMetadata?.({ reasoning_content: delta.reasoning_content })
      }
      return delta.content || ''
    } catch { return '' }
  }

  const text = await doStream(url, hdrs, body, signal, onChunk, parseLine)

  const tcs = Object.values(toolCallsAccum)
  if (tcs.length > 0 && finishReason === 'tool_calls') {
    onToolCalls?.(tcs.map(tc => ({ ...tc, arguments: (() => { try { return JSON.parse(tc.arguments) } catch { return tc.arguments } })() })))
  }
  return text
}

async function callGemini({ apiKey, model, messages, signal, onChunk, imageBase64 }) {
  // Concatenar TODOS los system messages en uno solo (Gemini solo acepta 1 systemInstruction)
  const allSys = messages.filter(m => m.role === 'system').map(m => m.content).filter(Boolean)
  const sys    = allSys.length ? allSys.join('\n\n') : null
  let   contents

  if (imageBase64) {
    contents = buildGeminiVisionContents(messages, imageBase64)
  } else {
    contents = messages
      .filter(m => m.role !== 'system')
      .map(m => {
        const text = typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '')
        return { role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text }] }
      })
  }

  const url  = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?key=${apiKey}&alt=sse`
  const body = {
    contents,
    ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
    generationConfig: { maxOutputTokens: 8192 },
  }
  return doStream(url, {}, body, signal, onChunk, l => {
    if (!l.startsWith('data: ')) return ''
    try { return JSON.parse(l.slice(6)).candidates?.[0]?.content?.parts?.[0]?.text || '' } catch { return '' }
  })
}

async function callMistral({ apiKey, model, messages, signal, onChunk, tools, onToolCalls }) {
  return callOpenAI({
    baseUrl: PROVIDERS.mistral.baseUrl,
    apiKey,
    model,
    messages,
    signal,
    onChunk,
    tools,
    onToolCalls,
    extra: { 'Accept': 'application/json' },
  })
}

// ── preprocessWithZen: usa Zen para leer proyecto completo y extraer datos clave ─

async function preprocessWithZen({ projectFiles, userQuestion, zenApiKey, signal }) {
  if (!zenApiKey) return null

  const allContent = Object.entries(projectFiles)
    .map(([rel, content]) => `=== ${rel} ===\n${content}`)
    .join('\n\n')

  const prompt = `Leé todo este proyecto y extraé los datos clave relevantes para responder esta pregunta del usuario: "${userQuestion}".

Proporcioná un resumen DETALLADO y COMPLETO que incluya:
- Arquitectura general del proyecto con explicaciones completas
- Todas las funciones y clases principales con sus implementaciones
- Todas las dependencias clave y su uso
- Cualquier detalle específico relevante para la pregunta, con ejemplos de código
- Fragmentos de código importantes completos, no resumidos

Incluí todo el contexto necesario, no omitas nada importante. Sé exhaustivo.`

  const zenMessages = [
    { role: 'system', content: 'Sos un analista de código experto y detallado. Leés proyectos completos y proporcionás información exhaustiva, completa y detallada. Nunca resumes, siempre das el contexto completo.' },
    { role: 'user', content: `Proyecto:\n${allContent}\n\n${prompt}` },
  ]

  let summary = ''
  try {
    await callOpenAI({
      baseUrl: PROVIDERS.zen.baseUrl,
      apiKey: zenApiKey,
      model: 'auto',  // Zen elige automáticamente
      messages: zenMessages,
      signal,
      onChunk: (_, full) => { summary = full },
    })
  } catch (e) {
    console.warn('Zen preprocessing failed:', e)
    return null
  }

  return summary.trim()
}

// ── searchWithZen: Zen busca información específica en el proyecto ─

async function searchWithZen({ projectFiles, searchQuery, zenApiKey, signal }) {
  if (!zenApiKey) return null

  const allContent = Object.entries(projectFiles)
    .map(([rel, content]) => `=== ${rel} ===\n${content}`)
    .join('\n\n')

  const prompt = `Buscá en este proyecto la información específica solicitada: "${searchQuery}".

Proporcioná TODOS los fragmentos de código, funciones, clases o secciones relevantes COMPLETOS. Incluí referencias exactas a archivos y líneas. No resumes, proporciona el código completo y el contexto necesario. Sé exhaustivo y detallado.

Resultados completos:`

  const zenMessages = [
    { role: 'system', content: 'Sos un buscador de código experto y detallado. Buscás información específica en proyectos completos y proporcionás TODOS los fragmentos relevantes COMPLETOS, con contexto detallado. Nunca resumes, siempre das el código completo y explicaciones detalladas.' },
    { role: 'user', content: `Proyecto:\n${allContent}\n\n${prompt}` },
  ]

  let results = ''
  try {
    await callOpenAI({
      baseUrl: PROVIDERS.zen.baseUrl,
      apiKey: zenApiKey,
      model: 'auto',
      messages: zenMessages,
      signal,
      onChunk: (_, full) => { results = full },
    })
  } catch (e) {
    console.warn('Zen search failed:', e)
    return null
  }

  return results.trim()
}

// ── Smart Pipeline: Zen trabaja primero, Gemini solo supervisa si Zen lo pide ──

async function runSmartPipeline({ userQuestion, projectFiles, relevantFiles, geminiKey, geminiModel, zenKey, model, signal, onChunk, onProgress }) {
  // Usar solo archivos relevantes en lugar de todo el proyecto
  const fileList = relevantFiles?.length > 0 ? relevantFiles : Object.keys(projectFiles)
  const allContent = fileList
    .map(rel => `=== ${rel} ===\n${projectFiles[rel] || ''}`)
    .join('\n\n')
  const truncated = allContent.length > 50000 ? allContent.slice(0, 50000) + '\n… (truncado)' : allContent

  // Step 1: Zen investiga y responde directamente
  onProgress?.('◉ Zen: analizando el proyecto…')
  const zenModel = (model && model !== 'auto') ? model : PROVIDERS.zen.defaultModel
  let zenResponse = ''
  const zenTimeout = AbortSignal.timeout?.(120_000)
  const combinedSignal = signal ? AbortSignal.any?.([signal, zenTimeout]) : (zenTimeout || signal)
  try {
    await callOpenAI({
      baseUrl: PROVIDERS.zen.baseUrl,
      apiKey: zenKey,
      model: zenModel,
      messages: [
        { role: 'system', content: 'Sos un desarrollador experto. Recibís la pregunta del usuario y el proyecto completo. Respondé CONCRETAMENTE lo que pide el usuario: corregí errores, implementá features, etc.\n\nIMPORTANTE: Si tenés dudas sobre algo o necesitás confirmación, terminá tu respuesta con [CONSULTAR_GEMINI: descripción de tus dudas]. Si estás seguro de tu respuesta, NO incluyas ese marcador.' },
        { role: 'user', content: `Pregunta: ${userQuestion}\n\nProyecto:\n${truncated}` }
      ],
      signal: combinedSignal,
      onChunk: (chunk, full) => {
        zenResponse = full
        onChunk?.(chunk, normalizeTools(full).replace(TOOL_RE, '').trim())
      }
    })
  } catch { return null }

  // Process tool calls in Zen's response
  const normZen = normalizeTools(zenResponse)
  const toolMatches = [...normZen.matchAll(TOOL_RE)]
  if (toolMatches.length > 0) {
    const toolResults = []
    for (const m of toolMatches) {
      const result = await executeToolCall(m[1], String(m[2] ?? '').trim(), { projectFiles, rootDir })
      toolResults.push(result)
    }
    const cleanedZen = normZen.replace(TOOL_RE, '').trim()
    onProgress?.('◉ Zen: procesando resultados…')
    let toolResponse = ''
    try {
      await callOpenAI({
        baseUrl: PROVIDERS.zen.baseUrl,
        apiKey: zenKey,
        model: zenModel,
        messages: [
          { role: 'system', content: 'Sos un desarrollador experto.' },
          { role: 'user', content: `Pregunta: ${userQuestion}\n\nProyecto:\n${truncated}` },
          { role: 'assistant', content: cleanedZen || '[...]' },
          { role: 'user', content: `Datos solicitados:\n${toolResults.join('\n\n')}\n\nCompletá tu respuesta.` }
        ],
        signal: combinedSignal,
        onChunk: (chunk, full) => {
          toolResponse = full
          onChunk?.(chunk, full)
        }
      })
    } catch { return cleanedZen || zenResponse }
    zenResponse = toolResponse || zenResponse
  }

  // Step 2: Si Zen tiene dudas, Gemini supervisa
  const consultMatch = zenResponse.match(/\[CONSULTAR_GEMINI:\s*(.*?)\]/i)
  if (consultMatch) {
    onProgress?.('◉ Gemini: revisando dudas de Zen…')
    const doubts = consultMatch[1].trim()
    const cleanZen = zenResponse.replace(/\[CONSULTAR_GEMINI:.*?\]/i, '').trim()
    let geminiFinal = ''
    try {
      await callGemini({
        apiKey: geminiKey,
        model: geminiModel,
        messages: [
          { role: 'system', content: 'Sos un supervisor de código. Recibís la pregunta del usuario, el análisis de un asistente (Zen), y sus dudas. Resolvé las dudas y corregí o completá la respuesta si es necesario. Sé conciso.' },
          { role: 'user', content: `Pregunta original: ${userQuestion}\n\nRespuesta de Zen:\n${cleanZen}\n\nDudas de Zen: ${doubts}\n\nRevisá y completá la respuesta. Si la respuesta de Zen es correcta, solo decí "OK" y nada más.` }
        ],
        signal,
        onChunk: (chunk, full) => {
          geminiFinal = full
          onChunk?.(chunk, full)
        }
      })
    } catch { return cleanZen }

    if (geminiFinal.trim() === 'OK') {
      return cleanZen
    }
    return `${cleanZen}\n\n---\n*🧠 Gemini (supervisor):* ${geminiFinal.trim()}`
  }

  return zenResponse?.trim() || null
}

// ── sendToAI principal ────────────────────────────────────────────────────────

export async function sendToAI({ provider, model, apiKey, messages, signal, onChunk, settings, imageBase64, activeFile, activeContent, projectFiles, relevantFiles, rootDir, onToolProgress, agentMode }) {
  const ollamaUrl = settings?.ollamaUrl || 'http://localhost:11434'
  const useAgent = agentMode !== undefined ? !!agentMode : settings?.agentMode !== false
  const agentCap = Number(settings?.agentToolRounds)
  const cappedAgentRounds = Number.isFinite(agentCap)
    ? Math.min(24, Math.max(4, Math.floor(agentCap)))
    : 24
  const maxToolRounds = useAgent ? cappedAgentRounds : 4

  const toolCtx = { projectFiles, rootDir }
  const runToolWrapped = async (name, argStr) => {
    const detail = (typeof argStr === 'string' ? argStr : JSON.stringify(argStr)).slice(0, 160)
    onToolProgress?.({ name, detail, phase: 'start' })
    try {
      const result = await executeToolCall(name, typeof argStr === 'string' ? argStr : JSON.stringify(argStr), toolCtx)
      const s = String(result ?? '')
      const bad = s.startsWith('[Error:') || s.startsWith('[Herramienta desconocida')
      onToolProgress?.({ name, detail, phase: 'done', ok: !bad })
      return result
    } catch (e) {
      onToolProgress?.({ name, detail: e.message, phase: 'done', ok: false })
      throw e
    }
  }

  // Manejo especial para zen+gemini: Gemini puede pedir a Zen que busque información específica
  if (provider === 'zen+gemini') {
    const zenKey = apiKey?.zen
    const geminiKey = apiKey?.gemini
    const geminiModel = model.split('+')[1] || 'gemini-2.5-flash'
    if (!zenKey || !geminiKey) throw new Error('Faltan API keys para zen+gemini')

    const projectIndex = projectFiles ? buildProjectIndex(projectFiles) : 'Sin proyecto'

    const initialMessages = messages.map((m, i) => 
      i === messages.length - 1 
        ? { ...m, content: `Índice del proyecto:\n${projectIndex}\n\nPregunta: ${m.content}\n\nINSTRUCCIONES: Sé conciso y directo en tu respuesta. Solo proporciona la información necesaria. Si necesitas ver código específico o detalles largos del proyecto, usa [ZEN_REQUEST: descripción detallada de lo que necesitas]. Zen te proporcionará toda la información detallada que solicites.` }
        : m
    )

    let geminiResponse = ''
    await callGemini({ apiKey: geminiKey, model: geminiModel, messages: initialMessages, signal, onChunk: (chunk, full) => {
      geminiResponse = full
      onChunk(chunk, full)
    }, imageBase64 })

    const zenRequestMatch = geminiResponse.match(/\[ZEN_REQUEST:\s*(.*?)\]/i)
    if (zenRequestMatch) {
      const searchQuery = zenRequestMatch[1].trim()
      const zenResults = await searchWithZen({ projectFiles, searchQuery, zenApiKey: zenKey, signal })
      if (zenResults) {
        const followUpMessages = [
          ...initialMessages,
          { role: 'assistant', content: geminiResponse.replace(/\[ZEN_REQUEST:.*?\]/i, '') },
          { role: 'user', content: `Información completa y detallada de Zen sobre "${searchQuery}":\n${zenResults}\n\nAhora proporciona una respuesta concisa y directa usando esta información completa.` }
        ]
        geminiResponse = ''
        await callGemini({ apiKey: geminiKey, model: geminiModel, messages: followUpMessages, signal, onChunk: (chunk, full) => {
          geminiResponse = full
          onChunk(chunk, full)
        }, imageBase64 })
      }
    }
    return geminiResponse
  }

  // If pipeline is enabled, use pipeline instead of direct provider call
  if (settings?.pipeline && settings?.pipelineStages) {
    const stages = settings.pipelineStages || []
    const keys = stages.map(s => s.key).filter(Boolean)
    if (keys.length > 0) {
      let pipelineOutput = ''
      const result = await runPipeline({
        provider: stages[0]?.provider || provider,
        keys,
        model: stages[0]?.model || model,
        stages,
        activeFile,
        activeContent,
        projectFiles,
        relevantFiles,
        signal,
        settings,
        onStage: (stage) => {
          if (stage.done && stage.result) {
            onChunk?.(stage.result, stage.result)
            pipelineOutput = stage.result
          }
        },
      })
      return result
    }
  }

  let finalMessages = messages

  // ── Smart Pipeline: solo sin imagen (Gemini ve la imagen directo) ──
  if (!imageBase64 && projectFiles && Object.keys(projectFiles).length > 0 && provider === 'gemini') {
    const geminiKey = settings?.apiKeys?.gemini
    const zenKey = settings?.apiKeys?.zen
    const geminiModel = settings?.models?.gemini || PROVIDERS.gemini.defaultModel
    const zenModel = settings?.models?.zen || PROVIDERS.zen.defaultModel
    if (zenKey) {
      const lastContent = messages[messages.length - 1]?.content || ''
      const smartResult = await runSmartPipeline({
        userQuestion: typeof lastContent === 'string' ? lastContent : '',
        projectFiles, relevantFiles, geminiKey, geminiModel, zenKey, model: zenModel, signal,
        onChunk,
        onProgress: (msg) => onChunk?.(msg, msg),
      })
      if (smartResult) {
        return smartResult
      }
    }
  }

  // ── Tool-aware provider call helper ──
  const toolAwareOnChunk = (() => {
    let rawFull = '', cleanFull = ''
    const cb = (chunk, full) => {
      rawFull = full
      if (!chunk) return
      const cleanChunk = normalizeTools(chunk).replace(TOOL_RE, '')
      cleanFull += cleanChunk
      if (cleanFull.trim()) onChunk(cleanChunk, cleanFull)
    }
    cb.getRaw = () => rawFull
    cb.reset = () => { rawFull = ''; cleanFull = '' }
    return cb
  })()

  // Collects native tool_calls from providers that support function calling
  let nativeToolCalls = null
  let preservedReasoningContent = null
  let currentRoundReasoning = null   // reasoning_content del round actual (se incluye en assistant msg)

  const supportsNativeTools = provider !== 'ollama' && provider !== 'gemini' && provider !== 'zen+gemini'

  const makeProviderCall = async (msgs, toolCb, useRetry = true, overrideImage, useTools = false) => {
    nativeToolCalls = null
    currentRoundReasoning = null   // reset per-round reasoning cada vez que llamamos al provider
    const img = overrideImage || imageBase64
    const call = async (cb) => {
      const tools = useTools && supportsNativeTools ? TOOL_SCHEMAS : undefined
      const onToolCalls = (calls) => { nativeToolCalls = calls }
      const onMetadata = ({ reasoning_content }) => {
        if (reasoning_content) {
          preservedReasoningContent = (preservedReasoningContent || '') + reasoning_content
          currentRoundReasoning = (currentRoundReasoning || '') + reasoning_content
        }
      }

      switch (provider) {
        case 'ollama':
          return callOllama({ model, messages: msgs, signal, onChunk: cb, ollamaUrl })

        case 'groq':
          return callOpenAI({
            baseUrl: PROVIDERS.groq.baseUrl, apiKey, model, tools,
            messages: img && modelSupportsVision('groq', model) ? buildVisionMessages(msgs, img) : msgs,
            signal, onChunk: cb, onToolCalls, onMetadata, reasoningContent: true,
          })

        case 'cerebras':
          return callOpenAI({
            baseUrl: PROVIDERS.cerebras.baseUrl, apiKey, model, messages: msgs, signal, onChunk: cb, tools, onToolCalls, onMetadata, reasoningContent: true,
          })

        case 'mistral':
          return callMistral({ apiKey, model, messages: msgs, signal, onChunk: cb, tools, onToolCalls })

        case 'together':
          return callOpenAI({
            baseUrl: PROVIDERS.together.baseUrl, apiKey, model, messages: msgs, signal, onChunk: cb, tools, onToolCalls, onMetadata, reasoningContent: true,
          })

        case 'zen': {
          if (!apiKey) throw new Error('Zen requiere API key.\nRegistrate en opencode.ai/zen, cargá créditos y copiá tu key.\nModelos con sufijo -free no requieren créditos.')
          const zenModels = await fetchZenModels()
          const targetModel = (model && model !== 'auto')
            ? model
            : (zenModels.find(m => m.endsWith('-free')) || zenModels[0])
          if (!targetModel) throw new Error('Zen: no se encontraron modelos disponibles.')

          const tryZen = (m) => callOpenAI({
            baseUrl: PROVIDERS.zen.baseUrl, apiKey, model: m, tools,
            messages: img && modelSupportsVision('zen', m) ? buildVisionMessages(msgs, img) : msgs,
            signal, onChunk: cb, onToolCalls, onMetadata, reasoningContent: true,
          })

          try {
            return await tryZen(targetModel)
          } catch (e) {
            const msg = String(e.message)
            // HTTP 400/422 → el modelo rechazó algún campo (tools, reasoning_content, etc.)
            // Retry con body limpio: sin tools, sin reasoning_content, sin metadata acumulada
            if (/^4(00|22)/.test(msg)) {
              const tryClean = (m) => callOpenAI({
                baseUrl: PROVIDERS.zen.baseUrl, apiKey, model: m, tools: undefined,
                messages: img && modelSupportsVision('zen', m) ? buildVisionMessages(msgs, img) : msgs,
                signal, onChunk: cb, onToolCalls: ()=>{}, onMetadata: ()=>{}, reasoningContent: true,
              })
              try { return await tryClean(targetModel) } catch (e2) { /* fallthrough */ }
            }
            removeFailedModel(targetModel, 'zen')
            const isCredits = /402|credit|billing|balance|insufficient/i.test(e.message)
            if (isCredits && !targetModel.endsWith('-free')) {
              const freeM = zenModels.find(m => m.endsWith('-free'))
              if (freeM) return tryZen(freeM)
              throw new Error('Zen: sin créditos.\nCargá créditos en opencode.ai/zen o usá un modelo -free.')
            }
            const fallback = zenModels.find(m => m !== targetModel)
            if (fallback) return tryZen(fallback)
            throw new Error('Zen: todos los modelos fallaron.\nÚltimo: ' + e.message)
          }
        }

        case 'openrouter': {
          const orExtra = { 'HTTP-Referer': 'https://mcservices.app', 'X-Title': 'MCodeAI Pre' }

          if (model && model !== 'models/free' && model !== 'meta-llama/llama-3.1-8b-instruct:free') {
            try {
              return await callOpenAI({
                baseUrl: PROVIDERS.openrouter.baseUrl, apiKey, model, tools, messages: msgs, signal, onChunk: cb, extra: orExtra, onToolCalls, onMetadata, reasoningContent: true,
              })
            } catch (e) {
              removeFailedModel(model)
              const fallbacks = CURATED_FREE.filter(id => id !== model)
              let lastErr = e
              for (const fm of fallbacks.slice(0, 2)) {
                if (signal?.aborted) break
                try {
                  return await callOpenAI({
                    baseUrl: PROVIDERS.openrouter.baseUrl, apiKey, model: fm, tools, messages: msgs, signal, onChunk: cb, extra: orExtra, onToolCalls, onMetadata, reasoningContent: true,
                  })
                } catch (e2) { lastErr = e2; removeFailedModel(fm) }
              }
              throw new Error('OpenRouter: modelo ' + model + ' y fallbacks fallaron.\nÚltimo: ' + (lastErr?.message || '?'))
            }
          }

          let freeModels = await fetchFreeModels()
          if (!freeModels.length) throw new Error('OpenRouter: sin modelos free disponibles.\nUsá Groq o Zen.')
          let lastErr = null, fi = 0
          while (fi < freeModels.length) {
            if (signal?.aborted) break
            const m = freeModels[fi]
            try {
              return await callOpenAI({
                baseUrl: PROVIDERS.openrouter.baseUrl, apiKey, model: m, tools, messages: msgs, signal, onChunk: cb, extra: orExtra, onToolCalls, onMetadata, reasoningContent: true,
              })
            } catch (e) {
              lastErr = e; removeFailedModel(m)
              freeModels = await fetchFreeModels(true); fi = -1
            }
            fi++
          }
          throw new Error('OpenRouter: todos los modelos free fallaron.\nÚltimo: ' + (lastErr?.message || '?'))
        }

        case 'gemini':
          return callGemini({ apiKey, model, messages: msgs, signal, onChunk: cb, imageBase64: img })

        case 'sambanova':
          return callOpenAI({
            baseUrl: PROVIDERS.sambanova.baseUrl, apiKey, model, tools, messages: msgs, signal, onChunk: cb, onToolCalls, onMetadata, reasoningContent: true,
          })

        case 'fireworks':
          return callOpenAI({
            baseUrl: PROVIDERS.fireworks.baseUrl, apiKey, model, tools, messages: msgs, signal, onChunk: cb, onToolCalls, onMetadata, reasoningContent: true,
          })

        case 'deepseek':
          return callOpenAI({
            baseUrl: PROVIDERS.deepseek.baseUrl, apiKey, model, tools, messages: msgs, signal, onChunk: cb, onToolCalls, onMetadata, reasoningContent: true,
          })

        case 'nvidia':
          return callOpenAI({
            baseUrl: PROVIDERS.nvidia.baseUrl, apiKey, model, tools, messages: msgs, signal, onChunk: cb, onToolCalls, onMetadata, reasoningContent: true,
          })

    default:
          throw new Error('Proveedor desconocido: ' + provider)
      }
    }
    return useRetry
      ? withRetry(() => call(toolCb), { maxRetries: 1, signal })
      : call(toolCb)
  }

  // ── Status: contacting provider ──
  const provName = PROVIDERS[provider]?.name || provider
  onChunk?.(`◉ Conectando con ${provName}…`, `◉ Conectando con ${provName}…`)

  // ── First call with tool-aware streaming ──
  toolAwareOnChunk.reset()
  // Enviamos tools en la primera llamada si el provider soporta function calling nativo
  let response = await makeProviderCall(finalMessages, toolAwareOnChunk, true, null, supportsNativeTools)

  // ── Tool round-trips (max 4) ──
  for (let round = 0; round < maxToolRounds; round++) {
    // Check for native tool_calls first (from providers with function calling)
    if (nativeToolCalls?.length) {
      const toolResults = []
      let toolImage = null
      for (const tc of nativeToolCalls) {
        const argStr = typeof tc.arguments === 'object' && tc.arguments !== null
          ? JSON.stringify(tc.arguments)
          : String(tc.arguments || '')
        const result = await runToolWrapped(tc.name, argStr)
        if (result && result._image) {
          toolImage = result._image.base64
          toolResults.push(result.text || '📸 Captura realizada')
        } else {
          toolResults.push(result)
        }
      }

      // Add tool results as role: "tool" messages (native format)
      const asstContent = toolAwareOnChunk.getRaw?.() || ''
      finalMessages.push({ role: 'assistant', content: asstContent || null, tool_calls: nativeToolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: typeof tc.arguments === 'object' ? JSON.stringify(tc.arguments) : tc.arguments } })), ...(currentRoundReasoning ? { reasoning_content: currentRoundReasoning } : {}) })
      for (const [i, tc] of nativeToolCalls.entries()) {
        finalMessages.push({ role: 'tool', tool_call_id: tc.id, content: String(toolResults[i] || '') })
      }

      response = await makeProviderCall(finalMessages, toolAwareOnChunk, true, toolImage, true)
      continue
    }

    // Fallback: text-based [TOOL: ...] parsing (Ollama, Gemini, or when native tools not used)
    const raw = toolAwareOnChunk.getRaw()
    const norm = normalizeTools(raw)
    const matches = [...norm.matchAll(TOOL_RE)]
    if (!matches.length) break

    const cleanResponse = norm.replace(TOOL_RE, '').trim()

    const toolResults = []
    let toolImage = null
    for (const m of matches) {
      const result = await runToolWrapped(m[1], String(m[2] ?? '').trim())
      if (result && result._image) {
        toolImage = result._image.base64
        toolResults.push(result.text || '📸 Captura realizada')
      } else {
        toolResults.push(result)
      }
    }

    const followUpMessages = [
      ...finalMessages,
      { role: 'assistant', content: cleanResponse || '[...]' },
      { role: 'user', content: `Datos solicitados de los archivos:\n${toolResults.join('\n\n')}\n\nAhora completá tu respuesta con esta información. Sé completo y detallado.` }
    ]

    toolAwareOnChunk.reset()
    response = await makeProviderCall(followUpMessages, toolAwareOnChunk, false, toolImage, true)
  }

  // ── Native tool_calls pendientes después del loop (límite alcanzado) ──
  if (nativeToolCalls?.length) {
    const toolResults = []
    let toolImage = null
    for (const tc of nativeToolCalls) {
      const argStr = typeof tc.arguments === 'object' && tc.arguments !== null
        ? JSON.stringify(tc.arguments)
        : String(tc.arguments || '')
      const result = await runToolWrapped(tc.name, argStr)
      if (result && result._image) {
        toolImage = result._image.base64
        toolResults.push(result.text || '📸 Captura realizada')
      } else {
        toolResults.push(result)
      }
    }
    const asstContent = toolAwareOnChunk.getRaw?.() || ''
    finalMessages.push({ role: 'assistant', content: asstContent || null, tool_calls: nativeToolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: typeof tc.arguments === 'object' ? JSON.stringify(tc.arguments) : tc.arguments } })), ...(currentRoundReasoning ? { reasoning_content: currentRoundReasoning } : {}) })
    for (const [i, tc] of nativeToolCalls.entries()) {
      finalMessages.push({ role: 'tool', tool_call_id: tc.id, content: String(toolResults[i] || '') })
    }
    toolAwareOnChunk.reset()
    response = await makeProviderCall(finalMessages, toolAwareOnChunk, false, toolImage, false)
  }

  // ── Final round: pedir que termine sin nuevos tool calls ──
  const finalRaw = normalizeTools(response)
  if (TOOL_RE.test(finalRaw)) {
    const wrapUpMessages = [
      ...finalMessages,
      { role: 'assistant', content: finalRaw.replace(TOOL_RE, '').trim() || '[...]' },
      { role: 'user', content: 'Completá tu respuesta final sin usar [TOOL:]. Dá la solución completa directamente.' }
    ]
    toolAwareOnChunk.reset()
    response = await makeProviderCall(wrapUpMessages, toolAwareOnChunk, false)
  }

  return normalizeTools(response).replace(TOOL_RE, '').trim()
}

// ── Índice del proyecto (solo nombres + métricas, sin contenido) ──────────────

// Cache para buildProjectIndex — se invalida cuando projectFiles cambia de referencia
const _indexCache = { ref: null, result: null }
function buildProjectIndex(projectFiles) {
  if (!projectFiles) return ''
  if (_indexCache.ref === projectFiles && _indexCache.result) return _indexCache.result
  const lines = []
  const byDir = {}
  for (const [rel, content] of Object.entries(projectFiles)) {
    if (content === '[archivo muy grande, omitido]') { lines.push(rel + '  [omitido]'); continue }
    const lc = content.split('\n').length
    const symbols = []
    for (const m of content.matchAll(/^\s*(?:export\s+)?(?:async\s+)?(?:function|const|class|let|var)\s+(\w+)/gm))
      symbols.push((m[0].includes('class') ? 'class ' : m[0].includes('function') ? 'fn ' : '') + m[1])
    for (const m of content.matchAll(/ipcMain\.handle\(['"](\w[\w-]+)['"]/g)) symbols.push('ipc:' + m[1])
    for (const m of content.matchAll(/router\.(get|post|put|delete)\(['"](\/[^'"]+)['"]/g)) symbols.push(m[1].toUpperCase() + ' ' + m[2])
    for (const m of content.matchAll(/^def\s+(\w+)/gm)) symbols.push('fn ' + m[1])
    for (const m of content.matchAll(/^class\s+(\w+)/gm)) symbols.push('class ' + m[1])
    const dir = rel.includes('/') ? rel.split('/').slice(0, -1).join('/') : '.'
    if (!byDir[dir]) byDir[dir] = []
    byDir[dir].push({ rel, lc, sym: symbols.slice(0, 8) })
  }
  for (const [dir, files] of Object.entries(byDir).sort()) {
    lines.push(dir === '.' ? '── Raíz' : '── ' + dir + '/')
    for (const f of files)
      lines.push('  ' + f.rel.split('/').pop() + '  (' + f.lc + ' lines)' + (f.sym.length ? '  → ' + f.sym.join(', ') : ''))
  }
  _indexCache.ref = projectFiles
  _indexCache.result = lines.join('\n')
  return _indexCache.result
}

export function selectRelevantFiles(projectFiles, userQuestion, activeFile, maxFiles = 5) {
  if (!projectFiles || !userQuestion) return []
  const normalizedQuestion = userQuestion.toLowerCase().replace(/[^a-z0-9ñáéíóúü_\s]/gi, ' ')
  const terms = [...new Set(normalizedQuestion.split(/\s+/).filter(Boolean))]
  if (terms.length === 0) return []

  const activeName = activeFile ? activeFile.replace(/\\/g, '/').split('/').pop() : ''
  const scores = Object.entries(projectFiles).map(([rel, content]) => {
    const relLower = rel.toLowerCase()
    if (!rel || rel === activeFile || rel === activeName || relLower.endsWith('/' + activeName)) {
      return { rel, score: -Infinity }
    }

    let score = 0
    for (const term of terms) {
      if (relLower.includes(term)) score += 4
      if (relLower.endsWith('.' + term)) score += 2
    }

    if (content && content !== '[archivo muy grande, omitido]') {
      const snippet = content.slice(0, 2000).toLowerCase()
      for (const term of terms) {
        if (snippet.includes(term)) score += 1
      }
    }

    return { rel, score }
  })

  return scores
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxFiles)
    .map(item => item.rel)
}

// ── Orquestador ───────────────────────────────────────────────────────────────

export function isOperationalQuestion(text) {
  if (!text) return false
  const q = text.toLowerCase()

  // Si parece un error/stack trace → NO es operativo, es análisis
  const hasStackTrace = /\n\s+at\s/.test(q) || /\n\s+at\s+async\s/.test(q)
  const hasErrorWord = /\b(error|exception|uncaught|traceback|failed|fail|panic)\b/i.test(q)
  const hasErrorType = /\b(syntaxerror|typeerror|referenceerror|rangeerror|urierror|evalerror|assertionerror)\b/i.test(q)
  if (hasStackTrace || (hasErrorWord && hasErrorType)) return false
  if (hasErrorWord && /:\d+:\d+/.test(q)) return false

  return /\b(git|npm|yarn|docker|compose|run|start|build|install|test|deploy|open|close|rename|move|mv|ls|dir|cd|kill|launch|execute|comando|terminal|shell|prompt|checkout|commit|pull|push|merge|branch|serve|npm\s+run|yarn\s+run)\b/.test(q)
}

async function orchestrateRoute({ userQuestion, projectFiles, activeFile, settings, signal }) {
  // Simplificado: Gemini analiza → Zen investiga, sin Groq
  const hasGemini = !!settings.apiKeys?.gemini
  const hasZen = !!settings.apiKeys?.zen
  const geminiModel = settings.models?.gemini || PROVIDERS.gemini.defaultModel

  if (hasGemini) {
    return { provider: 'gemini', model: geminiModel, apiKey: settings.apiKeys?.gemini }
  }
  if (hasZen) {
    return { provider: 'zen', model: 'auto', apiKey: settings.apiKeys?.zen }
  }
  return null
}

// ── routeProvider: cadena de fallbacks ───────────────────────────────────────

export async function routeProvider(settings, projectFiles, userQuestion, activeFile, signal) {
  const available = []
  if (settings.apiKeys?.gemini) {
    available.push({ provider: 'gemini', model: settings.models?.gemini || PROVIDERS.gemini.defaultModel, apiKey: settings.apiKeys?.gemini })
  }
  if (settings.apiKeys?.zen) {
    available.push({ provider: 'zen', model: settings.models?.zen || PROVIDERS.zen.defaultModel, apiKey: settings.apiKeys?.zen })
  }
  return available.length ? available : null
}

// ── routePipelineKeys ─────────────────────────────────────────────────────────

export function routePipelineKeys(settings, projectFiles) {
  const available = []
  const push = (p) => settings.apiKeys?.[p] && available.push({ provider: p, key: settings.apiKeys[p] })
  push('cerebras'); push('mistral'); push('fireworks'); push('deepseek'); push('sambanova'); push('nvidia'); push('gemini'); push('openrouter')
  if (available.length === 0) return []

  // Zen si tiene key
  if (settings.apiKeys?.zen) available.push({ provider: 'zen', key: settings.apiKeys.zen })

  return available.length >= 3
    ? available.slice(0, 3).map(a => ({ ...a, model: settings.models?.[a.provider] || PROVIDERS[a.provider]?.defaultModel }))
    : [
        available[0] && { ...available[0], model: settings.models?.[available[0].provider] || PROVIDERS[available[0].provider]?.defaultModel },
        available[1] && { ...available[1], model: settings.models?.[available[1].provider] || PROVIDERS[available[1].provider]?.defaultModel },
        available[0] && { ...available[0], model: settings.models?.[available[0].provider] || PROVIDERS[available[0].provider]?.defaultModel },
      ].filter(Boolean)
}

// ── analyzeProjectRelevance ───────────────────────────────────────────────────

export async function analyzeProjectRelevance({ projectFiles, userQuestion, openrouterApiKey, signal }) {
  const idx = buildProjectIndex(projectFiles)
  const allKeys = Object.keys(projectFiles)
  let result = ''

  if (!openrouterApiKey) return null

  const attempt = async ({ baseUrl, apiKey, model }) => {
    await callOpenAI({
      baseUrl,
      apiKey,
      model,
      messages: [
        { role: 'system', content: 'Orquestador. Dado el índice del proyecto y la pregunta, responde SOLO con los nombres de archivos relevantes (sin ruta). Máximo 3. Un nombre por línea.' },
        { role: 'user', content: 'Índice:\n' + idx + '\n\nPregunta:\n' + userQuestion },
      ],
      signal,
      onChunk: (_, f) => { result = f },
    })
  }

  const orModel = OR_MODEL_BY_COMPLEXITY.balanced

  try {
    await attempt({ baseUrl: PROVIDERS.openrouter.baseUrl, apiKey: openrouterApiKey, model: orModel })
  } catch {
    return null
  }
  const names = result.split('\n')
    .map(l => l.trim().replace(/^[-\s*`#.\/]+/, '').replace(/[,\s]+$/, ''))
    .filter(Boolean)
  const matched = names
    .map(n => allKeys.find(k => k === n || k.endsWith('/' + n) || k.replace(/^.*[/\\]/, '') === n))
    .filter(Boolean)
  return matched.length ? matched : null
}

// ── buildMessages: construye el contexto con presupuesto de tokens ────────────

export function buildMessages({ projectFiles, activeFile, activeContent, memories, history, relevantFiles, searchResults, projectSearchResults, devLogs, webPageIntel = null, tokenBudget = 8000, systemPrompt, agentMode = false }) {
  const msgs = []
  let usedTokens = 0

  const webBudget = Math.min(Math.floor(tokenBudget * 0.42), 18000)
  const webBlock = formatWebPageIntelBlock(webPageIntel, webBudget)

  let sys = systemPrompt || `Sos un asistente de desarrollo experto en MCodeAI Pre.

Estás dentro de un editor de código. Podés leer y modificar archivos automáticamente con herramientas — no le pidas al usuario que te pase contenido.

⚠️ IMPORTANTE — REGLA ABSOLUTA:
- NUNCA preguntes "¿quieres que...?", "¿te parece bien...?", "¿puedo...?" ni ninguna variación
- NUNCA esperes confirmación del usuario
- NUNCA digas "hay que", "debería", "sugiero que" — HACE directamente
- Asumí que el usuario SIEMPRE quiere que actúes sin pedir permiso
- El usuario deshabilitará acciones solo si las necesita desactivadas

HERRAMIENTAS — USO OBLIGATORIO:
- [TOOL: readFile ruta] — leé cualquier archivo
- [TOOL: grep patrón] — buscá texto regex en archivos
- [TOOL: glob **/*.js] — encontrá archivos por patrón
- [TOOL: searchProject texto] — búsqueda textual
- [TOOL: listDir ruta] — listá directorio
- [TOOL: tree ruta] — árbol de directorios
- [TOOL: run comando] — ejecutá un comando shell (cargo check, npm install, etc.)
- [TOOL: searchWeb consulta] — buscá en la web
- [TOOL: fetchURL url] — leé contenido de URL
- [TOOL: git args] — comando git

Si el proveedor soporta **function calling** nativo (OpenAI-compatible), podés usarlo directamente; equivale a [TOOL:...] pero con llamada JSON.

Consultá la web cuando necesites documentación, APIs, soluciones a errores, o versiones de paquetes.

CAPACIDADES GENERALES:
- Debatir ideas, arquitecturas, decisiones técnicas
- Revisar, corregir, refactorizar y generar código
- Investigar errores explorando múltiples hipótesis (leer archivos, grep, buscar web, git log)
- Razonar paso a paso en problemas complejos, directo cuando hay respuesta clara
- El archivo activo del usuario YA está incluido en tu contexto — no lo pidas
- El índice del proyecto solo tiene NOMBRES de archivo (sin contenido) — usá readFile para ver el código
- Los logs del servidor de desarrollo (salida dev/preview, errores JS) y las capturas \`[UI]\` (clic del usuario sobre un elemento: visibilidad, rect, pointer-events) pueden aparecer en tu contexto — usalos para bugs visuales o de interacción
- La sección "[Contexto de página web]" incluye HTML/texto visible de la pestaña 🌐 Web o la ventana Preview, más inventario de red si el usuario pulsó 📡 destripe — usala para explicar cómo recrear elementos o integraciones similares

TRANSMISIONES EN VIVO / VIDEO (HLS, DASH, reproductores):
- Ayudá con **arquitectura y código** cuando el usuario integre streaming **con derechos**: manifests propios, CDN/API/embed **oficial**, contenido **público y gratuito** que el emisor pone a disposición general (ej. medios públicos), o debugging de **su** página/app.
- **Accesibilidad / menos práctica tecnológica (ej. adultos mayores):** priorizá UI simple — tipografía grande, contraste alto, un botón claro tipo “Ver canal”, pocas opciones, pantalla completa opcional; automatizá reproducción donde el navegador lo permita y explicá con mensaje visible si hace falta **un primer toque** por políticas de autoplay (audio suele requerir gesto del usuario).
- Stacks habituales: **hls.js** o **Video.js** + VHS para HLS en Chromium; Safari suele tener HLS nativo; **Shaka Player** o **dash.js** para DASH; \`<video controls playsinline>\` y controles más grandes vía CSS. Probá en pestaña mínima o \`electron/stream-player-lab.html\`; cuando exista **embed oficial**, suele ser la forma más alineada con el proveedor.
- Si el destripe trae **streamingManifestHints** (.m3u8, .mpd, etc.), usalos como referencia técnica para un reproductor **sencillo** orientado a ese mismo contenido **cuando sea público y esté permitido por el origen**, sin instrucciones para eludir restricciones.
- **No ayudes** a vulnerar DRM, eludir pagos o cuentas, ni a usar el contenido contra los términos del proveedor; si hay DRM o bloqueo claro, orientá al **canal oficial** (web, app o iframe que ellos publiquen).

Si el usuario tiene un proyecto abierto en el editor, los bloques PATCH/WRITE/CREATE suelen aplicarse al disco automáticamente al terminar tu respuesta — seguí usando el formato exacto de abajo.

FORMATO PARA MODIFICAR ARCHIVOS (SOLO estos bloques):
\`\`\`PATCH:ruta/archivo:lineaInicio:lineaFin
codigo de reemplazo
\`\`\`
\`\`\`WRITE:ruta/archivo
codigo completo del archivo
\`\`\`
\`\`\`CREATE:ruta/archivo
contenido del archivo nuevo
\`\`\`
\`\`\`RUN:directorio
comando a ejecutar
\`\`\`

REGLAS:
- Respondé en el idioma del usuario
- Solo usá PATCH/WRITE/CREATE/RUN cuando haya un cambio real que hacer
- No uses RUN para leer archivos ni git — usá las herramientas de función
- Si generás comandos, asumí Windows/PowerShell (dir, npm, npx, node, git)
- Si no hay proyecto, creá la app desde cero con CREATE/WRITE para cada archivo
- Resolvé todo autónomamente: leé archivos, aplicá parches, verificá, corregí errores, repetí hasta que quede limpio
- ⚠️ NUNCA PREGUNTES NI PIDAS CONFIRMACIÓN — ACTUÁ DIRECTAMENTE Y SIEMPRE
- Si un cambio genera errores de sintaxis, corregilos inmediatamente sin esperar al usuario
- Investigá errores con múltiples hipótesis, no te aferres a una causa
- Distinguí síntomas de causa raíz
- NO HAGAS: "¿quieres que...?", "¿puedo...?", "¿te parece...?" — directamente GENERÁ los bloques PATCH/WRITE/CREATE/RUN`

  if (agentMode) {
    sys += `

## Modo Agente (MCodeAI — automatizado)
- **Exploración:** usá herramientas en una sola línea: \`[TOOL: readFile ruta/relativa]\`, \`[TOOL: grep patrón]\`, \`[TOOL: glob **/*.tsx]\`, \`[TOOL: searchProject texto]\`, \`[TOOL: listDir ruta]\`, etc. El editor ejecuta esas llamadas en bucle y te inyecta los resultados.
- Si el proveedor ofrece **function calling** nativo, usalo; equivale a [TOOL:…].
- **Cambios en disco:** al final SIEMPRE incluí los bloques con cabecera exacta \`\`\`PATCH:ruta:lineaIni:lineaFin\`\`\`, \`\`\`WRITE:ruta\`\`\` o \`\`\`CREATE:ruta\`\`\` (tipo en MAYÚSCULAS). Sin eso **no** se guardan archivos aunque muestres código en \`\`\`js\`\`\`.
- No pidas al usuario que copie ni confirme: el flujo es automático.`
  }

  if (!systemPrompt && webBlock) {
    sys += '\n\nCONTEXTO WEB ACTIVO: En el bloque [Contexto del proyecto] puede aparecer "[Contexto de página web]" con HTML/texto visible e inventario de red (destripe). Usalo como referencia principal cuando el usuario pregunte cómo recrear o imitar algo de esa página (componentes, estilos, comportamiento, fuentes multimedia o APIs públicas detectables).'
  }

  msgs.push({ role: 'system', content: sys })
  usedTokens += estimateTokens(sys)

  if (Array.isArray(searchResults) && searchResults.length > 0) {
    const webCtx = 'Información web relevante:\n' + searchResults.slice(0, 3)
      .map((r, i) => `${i + 1}. ${r.title || r.url}\n${r.url}\n${r.snippet || ''}`.trim())
      .join('\n\n')
    const toksWeb = estimateTokens(webCtx)
    if (usedTokens + toksWeb < tokenBudget * 0.45) {
      msgs.push({ role: 'system', content: webCtx })
      usedTokens += toksWeb
    }
  }

  const ctxParts = []

  // ── Archivo activo: SIEMPRE completo, sin truncar ─────────────────────────
  // El usuario lo está editando — necesita que el modelo vea cada línea exacta
  if (activeFile && activeContent) {
    const lines    = activeContent.split('\n')
    const numbered = lines.map((l, i) => `${i + 1}: ${l}`).join('\n')
    ctxParts.push(
      `Archivo activo — ${activeFile} (${lines.length} líneas):\n` +
      String.fromCharCode(96).repeat(3) + '\n' +
      numbered +
      '\n' + String.fromCharCode(96).repeat(3)
    )
    usedTokens += estimateTokens(numbered)
  }

  // ── Índice del proyecto ───────────────────────────────────────────────────
  if (projectFiles && Object.keys(projectFiles).length > 0) {
    const idx  = buildProjectIndex(projectFiles)
    const toks = estimateTokens(idx)
    if (usedTokens + toks < tokenBudget) {
      ctxParts.push(
        `Índice del proyecto (${Object.keys(projectFiles).length} archivos):\n` +
        String.fromCharCode(96).repeat(3) + '\n' +
        idx +
        '\n' + String.fromCharCode(96).repeat(3)
      )
      usedTokens += toks
    }

    // ── Archivos relevantes adicionales (sí tienen límite de presupuesto) ──
    const toInclude = relevantFiles?.filter(r => r !== activeFile).slice(0, 5) || []
    for (const rel of toInclude) {
      if (usedTokens >= tokenBudget * 0.85) break
      const fc = projectFiles[rel]
      if (!fc || fc === '[archivo muy grande, omitido]') continue
      const lines = fc.split('\n')
      // Archivos relevantes: hasta 500 líneas con numeración
      const cap   = Math.min(lines.length, 500)
      const snip  = `${rel} (${lines.length} líneas):\n` +
        String.fromCharCode(96).repeat(3) + '\n' +
        lines.slice(0, cap).map((l, i) => `${i + 1}: ${l}`).join('\n') +
        (lines.length > cap ? `\n… (${lines.length - cap} líneas más, abrí el archivo para ver el resto)` : '') +
        '\n' + String.fromCharCode(96).repeat(3)
      const toks2 = estimateTokens(snip)
      if (usedTokens + toks2 < tokenBudget) { ctxParts.push(snip); usedTokens += toks2 }
    }
  }

  // ── Página web (navegador integrado / Preview): DOM + destripe ─────────────
  if (webBlock) {
    ctxParts.push(webBlock)
    usedTokens += estimateTokens(webBlock)
  }

  // ── Logs del servidor de desarrollo ──────────────────────────────────────
  if (devLogs?.length > 0) {
    const recent = devLogs.slice(-25)
    const errLogs = recent.filter(l =>
      l.type === 'err' || l.type === 'warn' ||
      /\[UI\]|\[intel:|\[WEB\]/i.test(l.text || l) ||
      /error|fail|❌|⚠|unexpected|invalid|missing|denied|refused|timeout|warn|warning|exception|traceback|cannot|not found|not defined|syntax|undefined|null/i.test(l.text || l)
    )
    if (errLogs.length > 0) {
      const logStr = 'Logs del servidor de desarrollo:\n' +
        String.fromCharCode(96).repeat(3) + '\n' +
        recent.map(l => l.text || l).join('\n') +
        '\n' + String.fromCharCode(96).repeat(3)
      const toks = estimateTokens(logStr)
      if (usedTokens + toks < tokenBudget * 0.9) { ctxParts.push(logStr); usedTokens += toks }
    }
  }

  // ── Memorias relevantes ───────────────────────────────────────────────────
  if (memories?.length > 0) {
    const memStr = 'Contexto previo:\n' +
      memories.slice(0, 3).map(m => `- [${m.file || m.project || '?'}] ${m.user.slice(0, 100)}`).join('\n')
    ctxParts.push(memStr)
  }

  // ── Contexto del proyecto como system message separado ────────────────────
  const recentHistory = history.slice(-12)

  if (ctxParts.length > 0) {
    const ctx = ctxParts.join('\n\n')
    msgs.push({ role: 'system', content: `[Contexto del proyecto]\n${ctx}` })
  }

  return [...msgs, ...recentHistory]
}

// ── Pipeline (lector → corrector → revisor) ──────────────────────────────────

async function callProvider({ provider, apiKey, model, messages, signal, settings }) {
  if (provider === 'gemini') {
    let r = ''
    await callGemini({ apiKey, model, messages, signal, onChunk: c => r += c })
    return r
  }
  if (provider === 'zen') {
    const zenModels = await fetchZenModels()
    const m = (model === 'auto' || !model) ? (zenModels.find(x => x.endsWith('-free')) || zenModels[0]) : model
    let r = ''
    await callOpenAI({ baseUrl: PROVIDERS.zen.baseUrl, apiKey, model: m, messages, signal, onChunk: c => r += c })
    return r
  }
  let r = ''
  await callOpenAI({
    baseUrl: PROVIDERS[provider]?.baseUrl || PROVIDERS.groq.baseUrl,
    apiKey, model, messages, signal, onChunk: c => r += c,
    extra: provider === 'openrouter' ? { 'HTTP-Referer': 'https://mcservices.app', 'X-Title': 'MCodeAI Pre' } : {},
  })
  return r
}

export async function runPipeline({ provider, keys, model, stages, activeFile, activeContent, projectFiles, relevantFiles, signal, onStage, settings }) {
  if (!keys || keys.length < 1) throw new Error('Pipeline necesita al menos 1 API key')

  const stageMsgs = (extra) => {
    const ctx = []
    if (activeFile && activeContent) {
      const numbered = activeContent.split('\n').map((l, i) => (i + 1) + ': ' + l).join('\n')
      ctx.push(
        `Archivo activo (${activeFile}):\n` +
        String.fromCharCode(96).repeat(3) + '\n' +
        numbered +
        '\n' + String.fromCharCode(96).repeat(3)
      )
    }
    if (projectFiles) {
      ctx.push(buildProjectIndex(projectFiles))
      for (const rel of (relevantFiles || []).slice(0, 2)) {
        const fc = projectFiles[rel]
        if (fc && fc !== '[archivo muy grande, omitido]') {
          const lines = fc.split('\n')
          ctx.push(
            `${rel} (${lines.length} líneas):\n` +
            String.fromCharCode(96).repeat(3) + '\n' +
            lines.slice(0, 80).map((l, i) => (i + 1) + ': ' + l).join('\n') +
            (lines.length > 80 ? '\n...' : '') +
            '\n' + String.fromCharCode(96).repeat(3)
          )
        }
      }
    }
    ctx.push(extra || '')
    return ctx.join('\n\n')
  }

  const stagePrompts = {
    reader:   'Eres un revisor de código. Identificá errores, bugs, code smells y problemas de seguridad. Para cada uno indicá: archivo, línea exacta, problema y cómo corregirlo. No propongas comandos para buscar dentro de los archivos; usá el contexto del proyecto y el editor. Sé conciso.',
    fixer:    'Eres un corrector de código. Generá los parches usando EXACTAMENTE este formato:\n```PATCH:archivo:lineaInicio:lineaFin\ncodigo nuevo\n```\nPara archivos completos:\n```WRITE:archivo\ncodigo completo\n```\nPara comandos:\n```RUN:directorio\ncomando\n```\nNO uses formato diff. Si generás comandos, asumí un entorno Windows/PowerShell y evitá comandos Linux como ls, grep, sed, cat, rm -rf, bash, apt, curl, a menos que el usuario pida un sistema Linux explícitamente.',
    reviewer: 'Eres un revisor de calidad. Dado el código y los parches propuestos: 1) ¿Los parches resuelven el problema? 2) ¿Introducen nuevos errores? 3) ¿Siguen buenas prácticas? Respondé OK o detallá problemas.',
  }

  const stageNames = ['reader', 'fixer', 'reviewer']
  const results = []

  for (let i = 0; i < 3; i++) {
    if (signal?.aborted) throw new Error('Cancelado')
    const stageProv  = stages?.[i]?.provider || provider
    const stageModel = stages?.[i]?.model    || model
    const key        = stages?.[i]?.key      || keys[i] || keys[0]
    if (!key && stageProv !== 'zen') throw new Error(`Pipeline etapa ${i + 1}: no hay API key para ${stageProv}`)

    onStage?.({ stage: stageNames[i], index: i, provider: stageProv })

    const prev = results.length > 0 ? '\n\nEtapa anterior:\n' + results[results.length - 1].slice(0, 3000) : ''
    const content = stageMsgs(stagePrompts[stageNames[i]] + (i > 0 ? prev : ''))

    const result = await callProvider({
      provider: stageProv, apiKey: key, model: stageModel, signal, settings,
      messages: [
        { role: 'system', content: stagePrompts[stageNames[i]] },
        { role: 'user', content },
      ],
    })
    results.push(result)
    onStage?.({ stage: stageNames[i], index: i, done: true, result })
  }

  return {
    reader:  results[0],
    fixer:   results[1],
    reviewer: results[2],
    output:  results[2],
    patches: parseActions(results[1]),
  }
}

// ── parseActions / stripActions ───────────────────────────────────────────────

export function parseActions(text) {
  const actions = []
  const re = /```(WRITE|PATCH|CREATE|RUN):([^\n`]*?)(?::(\d+):(\d+))?\n([\s\S]*?)```/g
  let m
  while ((m = re.exec(text)) !== null) {
    const fp = String(m[2] || '').trim()
    const type = m[1]
    if (type === 'RUN') {
      actions.push({ type, filePath: fp, content: String(m[5] || '').trim() })
    } else if (!actions.some(a => a.filePath === fp && a.type === type)) {
      actions.push({
        type, filePath: fp,
        startLine: m[3] ? parseInt(m[3]) : null,
        endLine:   m[4] ? parseInt(m[4]) : null,
        content:   String(m[5] || ''),
      })
    }
  }
  const readRe = /(?:^|\n)READ:(\S[^\n]*)/g
  while ((m = readRe.exec(text)) !== null) {
    const path = String(m[1] || '').trim()
    if (path && !actions.some(a => a.type === 'READ' && a.filePath === path)) {
      actions.push({ type: 'READ', filePath: path, content: '' })
    }
  }
  return actions
}

export function stripActions(text) {
  return text.replace(/```(WRITE|PATCH|CREATE|RUN):[^\n]*\n[\s\S]*?```\n?/g, '').replace(/READ:\S[^\n]*\n?/g, '').trim()
}

// ── Vision support ────────────────────────────────────────────────────────────

export const VISION_MODELS = new Set([
  // Gemini — all support vision (1.5 y 2.0 están dados de baja)
  'gemini-2.5-flash','gemini-2.5-pro','gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite','gemini-3.1-pro',
  // Groq vision
  'llama-3.2-11b-vision-preview','llama-3.2-90b-vision-preview',
  // OpenRouter
  'meta-llama/llama-3.2-11b-vision-instruct:free','meta-llama/llama-3.2-11b-vision-instruct',
  // Zen
  'gpt-5-nano','gpt-5','gpt-5.4-nano','gpt-5.4',
])

export function modelSupportsVision(provider, model) {
  if (provider === 'gemini') return true
  return VISION_MODELS.has(model)
}

export async function imageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// Build messages array that includes an image for vision-capable models
export function buildVisionMessages(textMessages, imageBase64) {
  if (!imageBase64) return textMessages
  const [header, b64] = imageBase64.split(',')
  const mimeType = header?.match(/data:([^;]+)/)?.[1] || 'image/png'

  // Find and patch last user message to include image
  const msgs = [...textMessages]
  const lastUserIdx = msgs.findLastIndex(m => m.role === 'user')
  if (lastUserIdx < 0) return msgs

  const lastUser = msgs[lastUserIdx]
  const textContent = typeof lastUser.content === 'string' ? lastUser.content : ''

  // OpenAI-compatible vision format
  msgs[lastUserIdx] = {
    ...lastUser,
    content: [
      { type: 'text', text: textContent },
      { type: 'image_url', image_url: { url: `data:${mimeType};base64,${b64}` } },
    ],
  }
  return msgs
}

// Build Gemini-format messages with image
export function buildGeminiVisionContents(messages, imageBase64) {
  const [header, b64] = (imageBase64 || '').split(',')
  const mimeType = header?.match(/data:([^;]+)/)?.[1] || 'image/png'

  const contents = messages
    .filter(m => m.role !== 'system')
    .map((m, i, arr) => {
      const isLast = i === arr.length - 1 && m.role === 'user'
      const text   = typeof m.content === 'string' ? m.content : (m.content?.[0]?.text || '')
      const parts  = [{ text }]
      if (isLast && imageBase64) {
        parts.push({ inline_data: { mime_type: mimeType, data: b64 } })
      }
      return { role: m.role === 'assistant' ? 'model' : 'user', parts }
    })
  return contents
}

// Use Gemini to describe an image for text-only models (free, fast)
export async function describeImage({ imageBase64, userContext, geminiApiKey }) {
  if (!geminiApiKey) {
    return '[Imagen adjunta. Sin clave de Gemini no es posible analizarla automaticamente. Configurala en ajustes para activar analisis visual.]'
  }
  const [header, b64] = imageBase64.split(',')
  const mimeType = header?.match(/data:([^;]+)/)?.[1] || 'image/png'
  const prompt = (userContext ? userContext + '\n\n' : '') +
    'Describe esta imagen en detalle para un desarrollador. ' +
    'Si muestra un bug visual o UI: describe exactamente que se ve mal, colores, posiciones, elementos afectados. ' +
    'Si tiene codigo visible: transcribilo y describe el contexto. ' +
    'Se especifico y tecnico.'

  let desc = ''
  try {
    // Gemini vision call — inline_data in last user message
    const contents = [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: b64 } },
      ],
    }]
    const url  = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?key=${geminiApiKey}&alt=sse`
    const body = { contents, generationConfig: { maxOutputTokens: 1024 } }
    await doStream(url, {}, body, undefined, (c) => { desc += c }, l => {
      if (!l.startsWith('data: ')) return ''
      try { return JSON.parse(l.slice(6)).candidates?.[0]?.content?.parts?.[0]?.text || '' } catch { return '' }
    })
  } catch (e) {
    desc = '[No se pudo analizar la imagen: ' + e.message + ']'
  }
  return desc
}
