// Enfocador local (cero tokens, sin red ni DOM): a partir del pedido en lenguaje natural decide QUÉ archivos y QUÉ líneas
// importan, para que la IA reciba lo esencial y no tenga que explorar el proyecto. Es la fase A del "superasistente":
// léxico + sinónimos (es/en) + símbolos. Más adelante se le puede enchufar un embedder (ONNX) sin cambiar la interfaz.
// Se prueba en scripts/test-focus.mjs.

// ── Utilidades de texto ──────────────────────────────────────────────────────
const deaccent = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')

// "NotificationToast.tsx" -> ['notification','toast','tsx'] ; "use_toast" / "alert-box" también
export function splitIdent(s) {
  return deaccent(s)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9ñ]+/)
    .filter(Boolean)
}

// Raíz corta: une plurales y primos español/inglés ("alertas"/"alert", "notificación"/"notification")
export const stemOf = (w) => (w.length <= 5 ? w : w.slice(0, 5))

const STOP = new Set(('el la los las un una unos unas de del al a en y o u e que se su sus lo le les me mi mis te tu ' +
  'por para con sin sobre entre como cuando donde este esta esto estos estas ese esa eso esos esas aqui alli ahi ' +
  'muy mas menos pero si no ya hay ser es son fue era estar esta estan tiene tienen tener hacer haz hace quiero quiere ' +
  'puedes puede podes podrias podria necesito necesita favor porfa ayudame ayuda cambia cambiar cambies modifica modificar ' +
  'agrega agregar anade anadir arregla arreglar corrige corregir revisa revisar mira mirar fijate quiero queres ' +
  'the a an of to in on for and or is are was be it its this that these those with without from as at by my me i you ' +
  'please can could would should want need make change fix add update check look do does ' +
  'hola buenas buenos dias tardes noches tal gracias dale ok oka bien hey hello hi thanks thx ' +
  'integra integrar integrame implementa implementar crea crear genera generar haceme pone poner ponele agrega agregame anadime').split(/\s+/))

const KEEP_SHORT = new Set(['ui', 'db', 'js', 'ts', 'css', 'api', 'git', 'npm', 'ipc', 'sql', 'png', 'svg', 'jsx', 'tsx', 'py', 'md'])

// ── Sinónimos (palabras sueltas, sin tildes). Cada grupo se expande por raíz ──
const SYN_GROUPS = [
  ['alerta', 'aviso', 'notificacion', 'notification', 'toast', 'snackbar', 'alert', 'popup', 'banner'],
  ['cajita', 'caja', 'box', 'card', 'tarjeta', 'panel', 'contenedor', 'container', 'widget'],
  ['boton', 'button', 'btn'],
  ['menu', 'dropdown', 'desplegable', 'select', 'nav', 'navegacion', 'navbar'],
  ['color', 'colour', 'tema', 'theme', 'paleta', 'palette', 'fondo', 'background'],
  ['animacion', 'animation', 'transicion', 'transition', 'keyframes', 'suave', 'smooth'],
  ['estilo', 'style', 'css', 'clase', 'class', 'apariencia', 'diseno', 'design'],
  ['modal', 'dialogo', 'dialog', 'ventana', 'popup'],
  ['sidebar', 'lateral', 'panel'],
  ['error', 'fallo', 'falla', 'excepcion', 'exception', 'bug', 'crash'],
  ['formulario', 'form', 'input', 'campo', 'field'],
  ['lista', 'list', 'tabla', 'table', 'grilla', 'grid'],
  ['usuario', 'user', 'cuenta', 'account', 'perfil', 'profile', 'login', 'sesion', 'session', 'auth', 'autenticacion'],
  ['guardar', 'save', 'persistir', 'persist', 'almacenar', 'storage', 'store'],
  ['archivo', 'file', 'fichero'],
  ['carpeta', 'folder', 'directorio', 'directory'],
  ['buscar', 'search', 'busqueda', 'find', 'filtro', 'filter'],
  ['configuracion', 'settings', 'ajustes', 'config', 'opciones', 'options', 'preferencias'],
  ['pestana', 'tab', 'tabs', 'solapa'],
  ['chat', 'conversacion', 'mensajes', 'messages'],
  ['icono', 'icon', 'imagen', 'image', 'img', 'foto', 'picture', 'logo'],
  ['optimizar', 'optimizador', 'minificar', 'minify', 'comprimir', 'compress', 'compresion', 'min'],
  ['texto', 'text', 'fuente', 'font', 'tipografia', 'typography'],
  ['peticion', 'request', 'fetch', 'endpoint', 'servidor', 'server', 'http'],
  ['database', 'db', 'sqlite', 'sql'],
]
const SYN = new Map()   // raíz -> Set de raíces hermanas
for (const g of SYN_GROUPS) {
  const stems = g.map(w => stemOf(deaccent(w)))
  for (const s of stems) {
    if (!SYN.has(s)) SYN.set(s, new Set())
    for (const o of stems) if (o !== s) SYN.get(s).add(o)
  }
}

// ── Tipo de tarea (solo orienta un poco el orden; nunca descarta nada) ───────
export function classifyTask(query) {
  const q = deaccent(query).toLowerCase()
  if (/\b(error|fallo|falla|bug|excepcion|exception|crash|traceback|no funciona|roto|se rompe|rompio|undefined|typeerror|referenceerror)\b/.test(q)) return 'error'
  if (/\b(test|tests|prueba|pruebas|spec|cobertura|coverage)\b/.test(q)) return 'prueba'
  if (/\b(refactor\w*|renombr\w*|reorganiz\w*|simplific\w*|extraer|extrae|dividir|separar)\b/.test(q)) return 'refactor'
  if (/\b(color|colores|estilo|estilos|css|animacion|diseno|visual|margen|padding|fuente|tema|apariencia|sutil|suave|se vea|se ve)\b/.test(q)) return 'estilo'
  return 'otro'
}

// ── Términos del pedido ──────────────────────────────────────────────────────
const IDENT_RE = /[A-Za-z_][\w-]*(?:[./\\][\w-]+)*\.[A-Za-z0-9]{1,5}\b|\b[a-z]+(?:[A-Z][a-z0-9]+)+\b|\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b|\b[a-z0-9]+(?:_[a-z0-9]+)+\b/g

// Devuelve { words: [raíces directas], idents: [identificadores/rutas tal como se escribieron] }
export function extractTerms(query, selection) {
  const q = String(query || '')
  const idents = []
  const addIdent = (s) => { const t = s.replace(/\\/g, '/').replace(/^\.\//, ''); if (t.length >= 3 && !idents.includes(t)) idents.push(t) }
  for (const m of q.matchAll(IDENT_RE)) addIdent(m[0])
  for (const m of q.matchAll(/`([^`]{2,60})`|"([^"]{2,60})"/g)) { const t = (m[1] || m[2]).trim(); if (/^[\w./\\-]+$/.test(t)) addIdent(t) }
  // la selección del editor aporta identificadores (pista, no manda)
  if (selection) for (const m of String(selection).slice(0, 2000).matchAll(/\b[A-Za-z_][A-Za-z0-9_]{3,}\b/g)) {
    if (idents.length >= 8) break
    if (/[A-Z_]/.test(m[0].slice(1)) || m[0].length > 7) addIdent(m[0])
  }
  const words = []
  const add = (w) => {
    if (!w || STOP.has(w)) return
    if (w.length < 3 && !KEEP_SHORT.has(w)) return
    const s = stemOf(w)
    if (!words.includes(s)) words.push(s)
  }
  for (const w of deaccent(q).toLowerCase().split(/[^a-z0-9ñ]+/)) add(w)
  for (const id of idents) for (const w of splitIdent(id)) add(w)
  return { words: words.slice(0, 14), idents: idents.slice(0, 8) }
}

// ── Símbolos por archivo (regex rápido, aproximado) ──────────────────────────
const CODE_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'])
export function extractSymbols(content, rel) {
  const ext = String(rel || '').split('.').pop().toLowerCase()
  const out = []
  const lines = String(content || '').split(/\r?\n/)
  const push = (name, line) => { if (name && out.length < 300) out.push({ name, line }) }
  for (let i = 0; i < lines.length && out.length < 300; i++) {
    const l = lines[i]
    if (l.length > 400) continue
    let m
    if (CODE_EXT.has(ext)) {
      if ((m = l.match(/^\s*(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/))) push(m[1], i + 1)
      else if ((m = l.match(/^\s*(?:export\s+(?:default\s+)?)?class\s+([A-Za-z_$][\w$]*)/))) push(m[1], i + 1)
      else if ((m = l.match(/^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b|\([^)]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>|memo\(|forwardRef\(|React\.)/))) push(m[1], i + 1)
      else if ((m = l.match(/^\s*(?:export\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/))) push(m[1], i + 1)
    } else if (ext === 'py') {
      if ((m = l.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/)) || (m = l.match(/^\s*class\s+([A-Za-z_]\w*)/))) push(m[1], i + 1)
    } else if (ext === 'css' || ext === 'scss' || ext === 'less') {
      for (const c of l.matchAll(/(?:^|[\s,>+~])\.([A-Za-z_][\w-]*)/g)) push(c[1], i + 1)
      if ((m = l.match(/@keyframes\s+([\w-]+)/))) push(m[1], i + 1)
      for (const v of l.matchAll(/(--[\w-]+)\s*:/g)) push(v[1].slice(2), i + 1)
    } else if (ext === 'html' || ext === 'htm') {
      for (const c of l.matchAll(/\b(?:id|class)\s*=\s*"([^"]{1,80})"/g)) for (const w of c[1].split(/\s+/)) push(w, i + 1)
    }
  }
  return out
}

// ── Núcleo ───────────────────────────────────────────────────────────────────
const BIG = '[archivo muy grande, omitido]'
const SKIP_PATH = /(?:^|\/)(?:node_modules|\.git|dist|dist-electron|build|out|coverage|\.cache|\.vite)\//
const SKIP_FILE = /(?:\.min\.(?:js|css)|\.map|\.lock|package-lock\.json|\.svg|\.png|\.jpe?g|\.gif|\.ico|\.woff2?|\.ttf)$/i
const MAX_SCAN = 300000
const countOf = (hay, needle, cap) => {
  let n = 0, i = 0
  while (n < cap && (i = hay.indexOf(needle, i)) !== -1) { n++; i += needle.length }
  return n
}

// files: { rutaRelativa: contenido }. Devuelve { task, terms, confidence, files:[{file,score,reasons,lines}] }.
export function focusProject({ query, files, activeFile, selection, maxFiles = 5, extraSynonyms = null } = {}) {
  const empty = (confidence, reason) => ({ task: classifyTask(query), terms: [], confidence, files: [], reason })
  if (!files || typeof files !== 'object') return empty('ninguna', 'sin archivos')
  const { words, idents } = extractTerms(query, selection)
  if (!words.length && !idents.length) return empty('ninguna', 'el pedido no tiene términos útiles')
  const task = classifyTask(query)

  // términos con peso: directos 1, sinónimos 0.5 (nunca pisan a un directo)
  const weight = new Map()
  for (const w of words) weight.set(w, 1)
  for (const w of words) for (const s of (SYN.get(w) || [])) if (!weight.has(s)) weight.set(s, 0.5)
  if (extraSynonyms && typeof extraSynonyms === 'object') {
    for (const w of words) for (const s of (extraSynonyms[w] || [])) { const st = stemOf(deaccent(String(s)).toLowerCase()); if (!weight.has(st)) weight.set(st, 0.5) }
  }
  const stems = [...weight.keys()]
  const identLow = idents.map(i => i.toLowerCase())

  const entries = []
  for (const [rel, content] of Object.entries(files)) {
    const relN = String(rel).replace(/\\/g, '/')
    if (!relN || SKIP_PATH.test(relN + '/') || SKIP_FILE.test(relN)) continue
    const big = typeof content !== 'string' || content === BIG
    const text = big ? '' : content.length > MAX_SCAN ? content.slice(0, MAX_SCAN) : content
    const low = text.toLowerCase()
    const counts = new Map()
    for (const s of stems) { const n = low ? countOf(low, s, 6) : 0; if (n) counts.set(s, n) }
    entries.push({ rel: relN, text, low, counts, big })
  }
  const N = entries.length || 1
  const df = new Map()
  for (const e of entries) for (const s of e.counts.keys()) df.set(s, (df.get(s) || 0) + 1)
  const idf = (s) => Math.log(1 + N / (1 + (df.get(s) || 0)))

  const activeN = activeFile ? String(activeFile).replace(/\\/g, '/') : ''
  const scored = []
  for (const e of entries) {
    const segs = e.rel.split('/')
    const base = splitIdent(segs[segs.length - 1]).map(stemOf)
    const dirs = splitIdent(segs.slice(0, -1).join(' ')).map(stemOf)
    const reasons = []
    let score = 0
    let exact = false
    let specific = false   // hay un golpe en nombre/carpeta/símbolo, o en contenido de una palabra poco común
    const hitDirect = new Set()

    for (const [s, w] of weight) {
      if (base.includes(s)) { score += 6 * w; specific = true; reasons.push(`nombre: ${s}`); if (w === 1) hitDirect.add(s) }
      else if (dirs.includes(s)) { score += 2 * w; specific = true; reasons.push(`carpeta: ${s}`); if (w === 1) hitDirect.add(s) }
    }
    const relLow = e.rel.toLowerCase()
    for (const id of identLow) {
      if (relLow === id || relLow.endsWith('/' + id) || (id.includes('.') && relLow.includes(id))) { score += 10; exact = true; reasons.push(`ruta exacta: ${id}`) }
    }

    if (!e.big) {
      const syms = extractSymbols(e.text, e.rel)
      const symHit = new Set()
      const perStem = new Map()   // tope: un archivo con 40 clases "chat-*" no debe ganar solo por tamaño
      for (const sy of syms) {
        const parts = splitIdent(sy.name).map(stemOf)
        for (const [s, w] of weight) if (parts.includes(s) && !symHit.has(sy.name + s)) {
          symHit.add(sy.name + s)
          if (w === 1) hitDirect.add(s)
          const c = (perStem.get(s) || 0) + 1; perStem.set(s, c)
          if (c > 2) continue
          score += 3 * w; specific = true
          if (reasons.length < 8 && !reasons.includes(`símbolo: ${sy.name}`)) reasons.push(`símbolo: ${sy.name}`)
        }
        if (identLow.includes(sy.name.toLowerCase())) { score += 6; exact = true; reasons.push(`símbolo exacto: ${sy.name}`) }
      }
      for (const [s, n] of e.counts) {
        const w = weight.get(s)
        score += Math.min(n, 5) * idf(s) * w * 0.6
        if (w === 1) { hitDirect.add(s); if ((df.get(s) || 0) / N <= 0.3) specific = true }
      }
      const shown = [...e.counts.entries()].filter(([s]) => weight.get(s) === 1).slice(0, 3).map(([s, n]) => `${s}×${n}`)
      if (shown.length) reasons.push(`contenido: ${shown.join(', ')}`)
    }
    if (score <= 0) continue

    const directTotal = words.length || 1
    score *= 1 + 0.5 * (hitDirect.size / directTotal)
    if (task === 'estilo' && /\.(css|scss|less|html|jsx|tsx)$/i.test(e.rel)) score *= 1.15
    if (task === 'prueba' && /(test|spec)/i.test(e.rel)) score *= 1.2
    if (task !== 'prueba' && /(?:^|\/)(?:test|tests|__tests__|scripts\/test)[^/]*|\.(?:test|spec)\./i.test(e.rel)) score *= 0.8
    if (/\.(md|txt)$/i.test(e.rel) && !/\b(readme|docs?|documentacion|changelog|markdown|notas?)\b/.test(deaccent(String(query)).toLowerCase())) score *= 0.6
    if (activeN && (e.rel === activeN || activeN.endsWith('/' + e.rel))) score += 1.5
    scored.push({ file: e.rel, score: Math.round(score * 10) / 10, exact, specific: exact || specific, reasons: [...new Set(reasons)].slice(0, 5), _e: e })
  }
  scored.sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
  const top = scored[0]
  if (!top) return { task, terms: words, confidence: 'ninguna', files: [], reason: 'ningún archivo coincide' }

  const picked = scored.filter(f => f.score >= top.score * 0.25).slice(0, Math.max(1, maxFiles))
  for (const f of picked) { f.lines = bestLines(f._e, weight, idf); delete f._e }
  const second = picked[1]?.score || 0
  // vocabulario del pedido que el proyecto no tiene (ni la palabra ni sus sinónimos en nombres o contenido)
  const pathStems = new Set()
  for (const e of entries) for (const t of splitIdent(e.rel)) pathStems.add(stemOf(t))
  const present = (s) => df.has(s) || pathStems.has(s)
  let known = 0, unknown = 0
  for (const w of words) { if ([w, ...(SYN.get(w) || [])].some(present)) known++; else unknown++ }
  let confidence = 'ninguna'
  // Sin un golpe específico (nombre, símbolo o palabra poco común) una palabra genérica repetida no da confianza
  if (top.exact || (top.specific && top.score >= 12 && top.score >= 1.5 * second)) confidence = 'alta'
  else if (top.specific && top.score >= 6) confidence = 'media'
  else if (top.score >= 2.5) confidence = 'baja'
  // Si la mayor parte de lo pedido no existe en el proyecto, lo que se encontró es casualidad: no inspira confianza
  if (!top.exact && unknown > known && (confidence === 'alta' || confidence === 'media')) confidence = 'baja'
  if (confidence === 'ninguna') return { task, terms: words, confidence, files: [], reason: 'coincidencias demasiado débiles' }
  return { task, terms: words, confidence, files: picked.map(({ exact, specific, ...r }) => r), reason: '' }
}

// Las 3 líneas con más términos distintos (ponderados), en orden de aparición.
function bestLines(e, weight, idf) {
  if (e.big || !e.text) return []
  const lines = e.text.split(/\r?\n/)
  const cand = []
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l.trim() || l.length > 400) continue
    const low = l.toLowerCase()
    let sc = 0
    for (const [s, w] of weight) if (low.includes(s)) sc += w * idf(s)
    if (sc > 0) cand.push({ line: i + 1, text: l.trim().slice(0, 160), sc })
  }
  cand.sort((a, b) => b.sc - a.sc || a.line - b.line)
  return cand.slice(0, 3).sort((a, b) => a.line - b.line).map(({ line, text }) => ({ line, text }))
}

// ── Presentación ─────────────────────────────────────────────────────────────
export function describeFocus(focus, max = 3) {
  if (!focus || !focus.files?.length) return ''
  const parts = focus.files.slice(0, max).map(f => `${f.file} (${f.reasons.slice(0, 2).join('; ')})`)
  return `Enfoque local [confianza ${focus.confidence}]: ${parts.join(' · ')}`
}

// Bloque corto para el prompt: dónde mirar, con líneas exactas. Solo si la confianza es suficiente.
export function focusBlock(focus, { minConfidence = 'media', maxChars = 1200 } = {}) {
  const rank = { ninguna: 0, baja: 1, media: 2, alta: 3 }
  if (!focus || !focus.files?.length || rank[focus.confidence] < rank[minConfidence]) return ''
  let out = `Enfoque local (calculado sin IA, confianza ${focus.confidence}; es una pista, verificá con readFile antes de editar):\n`
  for (const f of focus.files) {
    let block = `- ${f.file} — ${f.reasons.slice(0, 3).join('; ')}\n`
    for (const l of (f.lines || [])) block += `    ${l.line}: ${l.text}\n`
    if (out.length + block.length > maxChars) break
    out += block
  }
  return out.trimEnd()
}

// Lista de rutas combinada: primero el enfoque (si es confiable), luego lo que ya había; sin repetidos.
export function mergeRelevant(focus, existing, { minConfidence = 'media', max = 5 } = {}) {
  const rank = { ninguna: 0, baja: 1, media: 2, alta: 3 }
  const first = focus && rank[focus.confidence] >= rank[minConfidence] ? focus.files.map(f => f.file) : []
  const out = []
  for (const r of [...first, ...(Array.isArray(existing) ? existing : [])]) if (r && !out.includes(r)) out.push(r)
  return out.slice(0, max)
}
