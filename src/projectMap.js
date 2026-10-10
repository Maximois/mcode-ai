// ════════════════════════════════════════════════════════════════════════════
//  projectMap.js — Mapa del proyecto: el mismo índice para la IA y para el usuario
//
//  Puro y sin APIs: recibe { rutaRelativa: contenido } y devuelve
//    - módulos por TIPO (interfaz, hooks, lógica, proceso principal, estilos, …)
//    - por archivo: resumen, símbolos de nivel superior CON LÍNEA, imports y "lo usan"
//    - un texto compacto para el modelo, ajustado a un presupuesto de tokens
//    - una puntuación de relevancia que entiende preguntas en español
// ════════════════════════════════════════════════════════════════════════════

// Orden = prioridad (el código primero; documentación y datos al final).
export const ROLE_META = {
  entry:   { order: 0,  label: 'Entrada',                 hint: 'Punto de arranque de la interfaz' },
  ui:      { order: 1,  label: 'Interfaz',                hint: 'Componentes y pantallas' },
  hooks:   { order: 2,  label: 'Hooks y estado',          hint: 'Estado y lógica reutilizable de la interfaz' },
  logic:   { order: 3,  label: 'Lógica y servicios',      hint: 'Código que no dibuja pantallas' },
  main:    { order: 4,  label: 'Proceso principal',       hint: 'Electron, servidor o backend' },
  styles:  { order: 5,  label: 'Estilos',                 hint: 'CSS y temas' },
  scripts: { order: 6,  label: 'Scripts y herramientas',  hint: 'Automatización, build, utilidades' },
  tests:   { order: 7,  label: 'Pruebas',                 hint: 'Verificación automática' },
  config:  { order: 8,  label: 'Configuración',           hint: 'Dependencias, build, formato' },
  docs:    { order: 9,  label: 'Documentación',           hint: 'Guías y notas' },
  data:    { order: 10, label: 'Datos',                   hint: 'JSON y otros datos' },
  other:   { order: 11, label: 'Otros',                   hint: '' },
}
export const ROLE_ORDER = Object.keys(ROLE_META).sort((a, b) => ROLE_META[a].order - ROLE_META[b].order)

const OMITTED = '[archivo muy grande, omitido]'
const CODE_EXT = new Set(['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte'])
const EXTS_TRY = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.css']

const baseName = p => p.split('/').pop()
const extOf = p => { const b = baseName(p); const i = b.lastIndexOf('.'); return i > 0 ? b.slice(i + 1).toLowerCase() : '' }
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '.')
export const estimateMapTokens = t => Math.ceil((t || '').length / 4)

// ── Clasificación por tipo ────────────────────────────────────────────────────
function classify(rel, content) {
  const lower = rel.toLowerCase()
  const base = baseName(lower)
  const ext = extOf(lower)
  const top = lower.split('/')[0]

  if (ext === 'md' || ext === 'txt' || ext === 'rst') return 'docs'
  if (['css', 'scss', 'sass', 'less'].includes(ext)) return 'styles'
  if (/(^|\/)(tests?|__tests__|spec)\//.test(lower) || /\.(test|spec)\./.test(base) || /^test[-_]/.test(base)) return 'tests'
  if (top === 'scripts' || top === 'bin' || ['bat', 'cmd', 'ps1', 'sh', 'bash'].includes(ext)) return 'scripts'
  if (/^(package|tsconfig|jsconfig|vite\.config|webpack\.config|rollup\.config|babel\.config|eslint|\.eslintrc|prettier|\.prettierrc|\.editorconfig|\.gitignore|\.npmignore|\.gitattributes|dockerfile|makefile|vercel|netlify)/.test(base) ||
      ['toml', 'ini', 'cfg', 'conf', 'yaml', 'yml', 'env'].includes(ext)) return 'config'
  if (/^(index\.html|main\.(jsx?|tsx?)|index\.(jsx|tsx))$/.test(base) && !/^(electron|server|api|backend)\//.test(lower)) return 'entry'
  if (/^(electron|main|server|api|backend)\//.test(lower)) return 'main'
  if (/(^|\/)hooks\//.test(lower) || /^use[A-Z]/.test(baseName(rel))) return 'hooks'
  if (['jsx', 'tsx', 'vue', 'svelte', 'html', 'htm'].includes(ext)) return 'ui'
  if (['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].includes(ext) && typeof content === 'string' &&
      /from\s+['"]react['"]/.test(content) && /<[A-Z][\w.]*[\s/>]/.test(content)) return 'ui'
  if (ext === 'json' || ext === 'xml' || ext === 'csv') return 'data'
  if (['js', 'mjs', 'cjs', 'ts', 'mts', 'cts', 'py', 'go', 'rs', 'java', 'kt', 'rb', 'php', 'cs', 'c', 'cpp', 'h', 'hpp', 'swift', 'dart', 'lua', 'sql'].includes(ext)) return 'logic'
  return 'other'
}

// ── Resumen de una línea (de los comentarios de cabecera, sin adornos) ────────
const DECOR = /^[\s═─━=\-_*#~./\\|]+$/
function cleanSummary(t) {
  let s = String(t || '').replace(/^[\s═─━=\-_*#~/]+|[\s═─━=\-_*#~/]+$/g, '').trim()
  const m = s.match(/^[\w.\-/]+\s+[—–-]+\s+(.+)$/)        // "ai.js — Motor IA" -> "Motor IA"
  if (m) s = m[1].trim()
  s = s.replace(/[:：]\s*$/, '')
  return s.length > 100 ? s.slice(0, 99).replace(/\s+\S*$/, '') + '…' : s
}

function extractSummary(rel, content, ext) {
  if (typeof content !== 'string' || !content) return ''
  if (ext === 'md') { const m = content.match(/^#\s+(.+)$/m); return m ? cleanSummary(m[1]) : '' }
  if (ext === 'html' || ext === 'htm') { const m = content.match(/<title>([^<]+)<\/title>/i); return m ? cleanSummary(m[1]) : '' }
  if (ext === 'json') {
    if (baseName(rel) !== 'package.json') return ''
    try {
      const p = JSON.parse(content)
      const deps = Object.keys(p.dependencies || {}).length + Object.keys(p.devDependencies || {}).length
      return cleanSummary(`${p.name || 'paquete'} · ${deps} dependencias · scripts: ${Object.keys(p.scripts || {}).join(', ')}`)
    } catch { return '' }
  }
  const lines = content.split('\n', 30)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim()
    if (!raw || raw.startsWith('#!') || /^['"]use strict['"]/.test(raw)) continue
    let text = null
    if (/^(\/\/|#)/.test(raw)) text = raw.replace(/^(\/\/+|#+)\s*/, '')
    else if (/^\/\*+/.test(raw)) text = raw.replace(/^\/\*+\s*/, '').replace(/\*\/\s*$/, '') || (lines[i + 1] || '').replace(/^\s*\*+\s?/, '')
    else if (/^(""")|^(''')/.test(raw)) text = raw.replace(/^("""|''')\s*/, '').replace(/("""|''')\s*$/, '')
    else break                                              // primer código real: se acabó la cabecera
    if (!text || DECOR.test(text)) continue
    if (!/[A-Za-zÁ-ú]{4,}/.test(text)) continue
    const s = cleanSummary(text)
    if (s.length >= 6) return s
  }
  return ''
}

// ── Símbolos de nivel superior (columna 0) con su línea ───────────────────────
const RE_FN = /^(export\s+)?(default\s+)?(async\s+)?function\s*\*?\s*(\w+)/
const RE_CLASS = /^(export\s+)?(default\s+)?class\s+(\w+)/
const RE_VAR = /^(export\s+)?(const|let|var)\s+(\w+)\s*(?::[^=]+)?=\s*(.*)$/
const RE_PY_DEF = /^(async\s+)?def\s+(\w+)/
const RE_PY_CLASS = /^class\s+(\w+)/
const RE_GO = /^func\s+(?:\([^)]*\)\s*)?(\w+)/
const RE_RS = /^(pub\s+)?(async\s+)?fn\s+(\w+)/

function extractSymbols(lines, ext, isJsxFile) {
  const out = [], exported = new Set()
  const isJs = CODE_EXT.has(ext)
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (!l || l[0] === ' ' || l[0] === '\t' || l[0] === '/' || l[0] === '*') continue
    const n = i + 1
    if (isJs) {
      let m
      if ((m = l.match(/^export\s*\{([^}]*)\}/))) { m[1].split(',').forEach(x => { const nm = x.trim().split(/\s+as\s+/).pop(); if (nm) exported.add(nm) }); continue }
      if ((m = l.match(/^export\s+default\s+(\w+)\s*;?\s*$/))) { exported.add(m[1]); continue }
      if ((m = l.match(/^module\.exports\s*=\s*\{([^}]*)\}/))) { m[1].split(',').forEach(x => { const nm = x.trim().split(':')[0].trim(); if (nm) exported.add(nm) }); continue }
      if ((m = l.match(/^(?:module\.)?exports\.(\w+)\s*=/))) { exported.add(m[1]); out.push({ name: m[1], kind: 'fn', line: n, exported: true }); continue }
      if ((m = l.match(RE_FN))) {
        const name = m[4]
        out.push({ name, kind: /^use[A-Z]/.test(name) ? 'hook' : (isJsxFile && /^[A-Z]/.test(name) ? 'component' : 'fn'), line: n, exported: !!m[1] || /^export\s+default/.test(l) })
        continue
      }
      if ((m = l.match(RE_CLASS))) { out.push({ name: m[3], kind: 'class', line: n, exported: !!m[1] }); continue }
      if ((m = l.match(RE_VAR))) {
        const name = m[3]
        const value = (m[4] + ' ' + lines.slice(i + 1, i + 6).join(' ')).trim()
        const isFnValue = /^(async\s+)?(\([^)]*\)|[\w$]+)\s*(:\s*[^=]+)?=>/.test(value) || /^(async\s+)?function\b/.test(value)
        const isWrapped = /^(React\.)?(memo|forwardRef)\(/.test(value)
        let kind = 'const'
        if (/^use[A-Z]/.test(name) && (isFnValue || isWrapped)) kind = 'hook'
        else if (/^[A-Z]/.test(name) && (isFnValue || isWrapped) && isJsxFile) kind = 'component'
        else if (isFnValue || isWrapped) kind = 'fn'
        else if (/^[A-Z][A-Z0-9_]+$/.test(name)) kind = 'const'
        out.push({ name, kind, line: n, exported: !!m[1] })
      }
    } else if (ext === 'py') {
      let m
      if ((m = l.match(RE_PY_DEF))) out.push({ name: m[2], kind: 'fn', line: n, exported: !m[2].startsWith('_') })
      else if ((m = l.match(RE_PY_CLASS))) out.push({ name: m[1], kind: 'class', line: n, exported: !m[1].startsWith('_') })
    } else if (ext === 'go') {
      const m = l.match(RE_GO); if (m) out.push({ name: m[1], kind: 'fn', line: n, exported: /^[A-Z]/.test(m[1]) })
    } else if (ext === 'rs') {
      const m = l.match(RE_RS); if (m) out.push({ name: m[3], kind: 'fn', line: n, exported: !!m[1] })
    }
  }
  for (const s of out) if (exported.has(s.name)) s.exported = true
  // Tamaño aproximado (líneas hasta el siguiente símbolo): los más grandes son los más importantes
  for (let i = 0; i < out.length; i++) out[i].size = (i + 1 < out.length ? out[i + 1].line : lines.length + 1) - out[i].line
  return out
}

// ── Imports y resolución a archivos del proyecto ──────────────────────────────
const RE_IMPORTS = [
  /\bimport\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g,
  /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
  /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
]
function normalizePath(p) {
  const out = []
  for (const part of p.split('/')) { if (part === '.' || part === '') continue; if (part === '..') out.pop(); else out.push(part) }
  return out.join('/')
}
function resolveImport(fromRel, spec, fileSet) {
  if (!spec.startsWith('.')) return null
  const target = normalizePath(dirOf(fromRel) + '/' + spec)
  if (fileSet.has(target)) return target
  for (const e of EXTS_TRY) if (fileSet.has(target + e)) return target + e
  for (const e of EXTS_TRY) if (fileSet.has(target + '/index' + e)) return target + '/index' + e
  return null
}

// ── Construcción del mapa (memoizada por referencia) ──────────────────────────
const _cache = new WeakMap()

export function buildProjectMap(projectFiles) {
  if (!projectFiles || typeof projectFiles !== 'object') return emptyMap()
  const cached = _cache.get(projectFiles)
  if (cached) return cached

  const rels = Object.keys(projectFiles).map(r => r.replace(/\\/g, '/'))
  const fileSet = new Set(rels)
  const files = {}
  const stackNames = []

  for (const rawRel of Object.keys(projectFiles)) {
    const rel = rawRel.replace(/\\/g, '/')
    const content = projectFiles[rawRel]
    const ext = extOf(rel)
    const omitted = content === OMITTED || typeof content !== 'string'
    const text = omitted ? '' : content
    const lines = omitted ? [] : text.split('\n')
    const role = classify(rel, text)
    const isJsxFile = ['jsx', 'tsx', 'vue', 'svelte'].includes(ext) || role === 'ui'
    const info = {
      rel, name: baseName(rel), dir: dirOf(rel), ext, role,
      lines: lines.length, bytes: text.length, omitted,
      summary: omitted ? '' : extractSummary(rel, text, ext),
      symbols: omitted || !['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts', 'vue', 'svelte', 'py', 'go', 'rs'].includes(ext) ? [] : extractSymbols(lines, ext, isJsxFile),
      ipc: [], routes: [], imports: [], usedBy: [],
    }
    if (!omitted && CODE_EXT.has(ext)) {
      for (const re of RE_IMPORTS) {
        re.lastIndex = 0
        let m
        while ((m = re.exec(text)) !== null) {
          const target = resolveImport(rel, m[1], fileSet)
          if (target && target !== rel && !info.imports.includes(target)) info.imports.push(target)
        }
      }
      let m; const reIpc = /ipcMain\.(?:handle|on)\(\s*['"]([\w:.-]+)['"]/g
      while ((m = reIpc.exec(text)) !== null && info.ipc.length < 60) info.ipc.push({ name: m[1], line: text.slice(0, m.index).split('\n').length })
      const reRoute = /\b(?:app|router)\.(get|post|put|delete|patch)\(\s*['"](\/[^'"]*)['"]/g
      while ((m = reRoute.exec(text)) !== null && info.routes.length < 40) info.routes.push({ name: `${m[1].toUpperCase()} ${m[2]}`, line: text.slice(0, m.index).split('\n').length })
    }
    if (baseName(rel) === 'package.json' && !omitted) {
      try {
        const p = JSON.parse(text)
        for (const k of Object.keys(p.dependencies || {})) stackNames.push(k)
      } catch { /* sin stack */ }
    }
    files[rel] = info
  }
  for (const f of Object.values(files)) for (const t of f.imports) files[t]?.usedBy.push(f.rel)

  // Módulos por tipo (y dentro de cada uno, por carpeta)
  const modules = ROLE_ORDER.map(role => {
    const list = Object.values(files).filter(f => f.role === role).sort((a, b) => a.rel.localeCompare(b.rel))
    return { role, ...ROLE_META[role], files: list, lines: list.reduce((s, f) => s + f.lines, 0) }
  }).filter(m => m.files.length > 0)

  const stack = []
  for (const n of stackNames) { const s = n.startsWith('@') ? n.split('/')[0] + '/*' : n; if (!stack.includes(s)) stack.push(s) }

  const all = Object.values(files)
  const map = {
    files, modules, stack: stack.slice(0, 10),
    stats: {
      files: all.length,
      lines: all.reduce((s, f) => s + f.lines, 0),
      omitted: all.filter(f => f.omitted).length,
      core: all.filter(f => f.usedBy.length >= 3).sort((a, b) => b.usedBy.length - a.usedBy.length).map(f => f.rel),
      orphans: all.filter(f => ['ui', 'hooks', 'logic'].includes(f.role) && f.usedBy.length === 0).map(f => f.rel),
    },
  }
  _cache.set(projectFiles, map)
  return map
}

function emptyMap() { return { files: {}, modules: [], stack: [], stats: { files: 0, lines: 0, omitted: 0, core: [], orphans: [] } } }

// ── Texto compacto para la IA, ajustado a un presupuesto de tokens ────────────
const fmtLines = n => (n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n))
const shortName = rel => baseName(rel).replace(/\.(jsx?|tsx?|mjs|cjs)$/, '')

function symbolList(f, max) {
  const pri = s => (s.kind === 'component' || s.kind === 'fn' || s.kind === 'hook' || s.kind === 'class' ? 0 : s.exported ? 1 : 2)
  const weight = s => (s.size || 0) + (s.exported ? 15 : 0)
  let list = f.symbols.filter(s => s.kind !== 'const' || s.exported || /^[A-Z][A-Z0-9_]+$/.test(s.name))
  if (list.length > max) {
    // Se conservan los más importantes, pero siempre en orden de línea (sirve para navegar)
    const keep = new Set([...list].sort((a, b) => pri(a) - pri(b) || weight(b) - weight(a) || a.line - b.line).slice(0, max))
    list = list.filter(s => keep.has(s))
  }
  const txt = list.map(s => `${s.kind === 'class' ? 'class ' : ''}${s.name}:${s.line}`)
  const extra = f.symbols.length - list.length
  return { txt, extra }
}

function renderFile(f, level, focus) {
  const isFocus = focus.has(f.rel)
  const maxSym = isFocus ? 30 : [16, 10, 5, 0, 0][level] ?? 0
  const head = f.omitted
    ? `${f.rel} (grande, no cargado)`
    : `${f.rel} · ${fmtLines(f.lines)} l${f.summary ? ' · ' + f.summary : ''}`
  const out = [head]
  if (maxSym > 0 && f.symbols.length) {
    const { txt, extra } = symbolList(f, maxSym)
    if (txt.length) out.push('  ' + txt.join(' ') + (extra > 0 ? ` …(+${extra})` : ''))
  }
  if (level <= 1 || isFocus) {
    if (f.ipc.length) out.push('  ipc ' + f.ipc.slice(0, isFocus ? 30 : 12).map(i => `${i.name}:${i.line}`).join(' ') + (f.ipc.length > 12 && !isFocus ? ` …(+${f.ipc.length - 12})` : ''))
    if (f.routes.length) out.push('  rutas ' + f.routes.slice(0, 12).map(i => `${i.name}:${i.line}`).join(' '))
  }
  if (level === 0 || isFocus) {
    const dep = []
    if (f.imports.length) dep.push('usa ' + f.imports.slice(0, 6).map(shortName).join(', ') + (f.imports.length > 6 ? ` …(+${f.imports.length - 6})` : ''))
    if (f.usedBy.length) dep.push('lo usan ' + f.usedBy.slice(0, 4).map(shortName).join(', ') + (f.usedBy.length > 4 ? ` …(+${f.usedBy.length - 4})` : ''))
    if (dep.length) out.push('  ' + dep.join(' | '))
  }
  return out.join('\n')
}

/**
 * @param map  resultado de buildProjectMap
 * @param opts { maxTokens = 5000, focus = [rutas con máximo detalle] }
 */
export function renderMapForAI(map, { maxTokens = 5000, focus = [] } = {}) {
  if (!map?.stats?.files) return ''
  const focusSet = new Set(focus.filter(Boolean).map(f => String(f).replace(/\\/g, '/')))
  const LOW = new Set(['docs', 'data', 'config', 'tests', 'other', 'styles'])
  const header = `MAPA DEL PROYECTO — ${map.stats.files} archivos · ${fmtLines(map.stats.lines)} líneas` +
    (map.stack.length ? ` · Stack: ${map.stack.join(', ')}` : '') +
    `\nCada símbolo va como nombre:línea. Para leer código usá [TOOL: readFile ruta:inicio-fin].` +
    (map.stats.core.length ? `\nNúcleo (los más importados): ${map.stats.core.slice(0, 5).map(shortName).join(', ')}.` : '')

  const build = level => {
    const parts = [header]
    for (const m of map.modules) {
      const collapse = level >= 4 || (level >= 3 && LOW.has(m.role))
      if (collapse) {
        parts.push(`\n## ${m.label} (${m.files.length})\n${m.files.map(f => f.rel).join(', ')}`)
        continue
      }
      parts.push(`\n## ${m.label} — ${m.hint || m.label} (${m.files.length} archivos · ${fmtLines(m.lines)} l)`)
      for (const f of m.files) parts.push(renderFile(f, LOW.has(m.role) && level < 3 ? Math.max(level, 2) : level, focusSet))
    }
    return parts.join('\n')
  }
  let text = ''
  for (let level = 0; level <= 4; level++) {
    text = build(level)
    if (estimateMapTokens(text) <= maxTokens) return text
  }
  return text.slice(0, maxTokens * 4) + '\n… (mapa recortado)'
}

// ── Relevancia: entiende preguntas en español sobre código en inglés ─────────
const STOP = new Set(('el la los las un una unos unas de del al a en y o u que se su sus por para con sin sobre entre es son era fue ser esta este estos estas eso esto ese esa como cuando donde cual cuales ' +
  'mi mis tu tus nos le les lo me te ya no si mas muy tan pero porque hay tiene tienen hace hacer haz quiero necesito favor podes puedes podrias arregla arreglar agrega agregar agregá cambia cambiar mejora mejorar revisa revisar ' +
  'the a an of to in on and or is are was be this that these those it for with without about from how what why when where which do does did can could please fix add change update improve check').split(/\s+/))

// Español -> términos que suelen aparecer en los nombres del código
const SYN = {
  guardar: ['save', 'write', 'persist'], guarda: ['save', 'write'], abrir: ['open'], abre: ['open'], cerrar: ['close'], cierra: ['close', 'quit'],
  boton: ['button', 'btn'], botones: ['button', 'btn'], ventana: ['window'], archivo: ['file'], archivos: ['file', 'files'], carpeta: ['folder', 'dir', 'directory'],
  barra: ['bar', 'toolbar', 'titlebar', 'statusbar'], pestana: ['tab'], pestanas: ['tab', 'tabs'], modelo: ['model'], modelos: ['model'],
  configuracion: ['settings', 'config', 'options'], ajustes: ['settings', 'config'], opciones: ['options', 'settings'], servidor: ['server'],
  previsualizacion: ['preview'], vista: ['view', 'preview'], proyecto: ['project'], mensaje: ['message', 'msg'], mensajes: ['message', 'msg'],
  herramienta: ['tool'], herramientas: ['tool', 'tools'], memoria: ['memory'], pegar: ['paste'], copiar: ['copy'], buscar: ['search', 'find'],
  busqueda: ['search', 'find'], reemplazar: ['replace'], borrar: ['delete', 'remove'], eliminar: ['delete', 'remove'], crear: ['create', 'new'], nuevo: ['new', 'create'],
  lista: ['list'], arbol: ['tree'], imagen: ['image', 'img'], texto: ['text'], tema: ['theme'], fuente: ['font', 'source'], deshacer: ['undo'], rehacer: ['redo'],
  ejecutar: ['run', 'exec'], compilar: ['build', 'compile'], instalar: ['install'], estilo: ['style', 'css'], estilos: ['style', 'css'], menu: ['menu'],
  dialogo: ['dialog', 'modal'], modal: ['modal', 'dialog'], entrada: ['input'], sesion: ['session'], clave: ['key', 'password'], proveedor: ['provider'],
  respuesta: ['response', 'reply'], enviar: ['send'], cargar: ['load'], descargar: ['download'], actualizar: ['update', 'refresh'], atajo: ['shortcut', 'hotkey', 'key'],
  panel: ['panel'], usuario: ['user'], contexto: ['context'], indice: ['index'], mapa: ['map'], error: ['error', 'err'], errores: ['error', 'err'],
  streaming: ['stream'], transmision: ['stream'], navegador: ['browser'], pagina: ['page'], editor: ['editor', 'monaco'], terminal: ['terminal', 'shell', 'cmd'],
  comando: ['command', 'cmd'], depurar: ['debug'], registro: ['log'], registros: ['log', 'logs'], consola: ['console', 'terminal'], plan: ['plan'], agente: ['agent'],
}
const fold = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
const splitWords = s => fold(s).replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9]+/).filter(Boolean)

export function questionTerms(question) {
  const base = [...new Set(fold(question).replace(/([a-z])([A-Z])/g, '$1 $2').split(/[^a-z0-9_]+/).filter(w => w.length >= 3 && !STOP.has(w)))]
  const out = new Set(base)
  for (const w of base) for (const s of SYN[w] || []) out.add(s)
  return { direct: base, all: [...out] }
}

/** Devuelve [{ rel, score }] ordenado, sin el archivo activo. */
export function scoreFiles(map, projectFiles, question, activeFile, maxFiles = 5) {
  const { direct, all } = questionTerms(question)
  if (!all.length) return []
  const active = activeFile ? String(activeFile).replace(/\\/g, '/') : ''
  const activeBase = active ? baseName(active) : ''
  const activeRel = Object.keys(map.files).find(r => r === active || (activeBase && r.endsWith('/' + activeBase) && active.endsWith(r))) || (map.files[active] ? active : '')
  const neighbors = new Set(activeRel ? [...(map.files[activeRel]?.imports || []), ...(map.files[activeRel]?.usedBy || [])] : [])
  const scores = []
  for (const f of Object.values(map.files)) {
    if (f.rel === activeRel || (activeBase && f.rel === activeBase)) continue
    let score = 0
    const nameWords = splitWords(f.name.replace(/\.[^.]+$/, ''))
    const dirWords = splitWords(f.dir)
    const symWords = new Set(); f.symbols.forEach(s => splitWords(s.name).forEach(w => symWords.add(w)))
    const sumLower = fold(f.summary)
    for (const t of all) {
      const w = direct.includes(t) ? 1 : 0.7                        // el término original pesa más que su traducción
      if (nameWords.includes(t)) score += 8 * w
      else if (nameWords.some(x => x.includes(t) || t.includes(x) && x.length >= 4)) score += 4 * w
      if (dirWords.includes(t)) score += 2 * w
      if (symWords.has(t)) score += 5 * w
      if (sumLower.includes(t)) score += 3 * w
    }
    const content = projectFiles?.[f.rel]
    if (typeof content === 'string' && content && content !== OMITTED) {
      const lower = fold(content)
      for (const t of all) {
        let c = 0, from = 0
        while (c < 8 && (from = lower.indexOf(t, from)) !== -1) { c++; from += t.length }
        score += Math.min(c, 8) * 0.5 * (direct.includes(t) ? 1 : 0.7)
      }
    }
    if (neighbors.has(f.rel)) score += 4                            // vecino directo del archivo activo en el grafo
    if (f.role === 'docs') score *= nameWords.some(x => all.includes(x)) ? 0.8 : 0.3
    else if (f.role === 'data') score *= 0.3
    else if (f.role === 'tests') score *= 0.6
    else if (f.role === 'config') score *= 0.5
    if (score >= 5) scores.push({ rel: f.rel, score })
  }
  return scores.sort((a, b) => b.score - a.score).slice(0, maxFiles)
}
