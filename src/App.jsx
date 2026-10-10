import React, {
  useState, useEffect, useRef, useCallback, lazy, Suspense, memo,
} from 'react'
import {
  routeProvider, sendToAI, buildMessages, searchWeb, parseActions, stripActions,
  analyzeProjectRelevance, selectRelevantFiles, helperApisEnabled, PROVIDERS, fetchZenModels, estimateTokens,
  imageToBase64, modelSupportsVision, describeImage, pushUndo, undoHistory, addExperience, searchExperience, getExperienceStats, getTimeline,
} from './ai.js'
import { useSettings } from './hooks/useSettings.js'
import { useTabs, getLang } from './hooks/useTabs.js'
import { useMemory } from './hooks/useMemory.js'
import BrowserTab from './BrowserTab.jsx'
import { formatDestripeLogLine, formatDestripeMarkdown, fetchLiveWebSnapshots } from './webPageDestripe.js'
import DevPanel from './DevPanel.jsx'
import ReverseIntelPanel from './ReverseIntelPanel.jsx'
import ExtensionManager from './ExtensionManager.jsx'
import { WorkCard, WorkSummary } from './WorkCard.jsx'
import Editor from './Editor.jsx'

function isLikelyNetworkOnlyIssue(message, reason) {
  const s = `${message ?? ''} ${reason != null ? String(reason) : ''}`.toLowerCase()
  if (!s.trim()) return false
  const netHint = /failed to fetch|networkerror|network request failed|load failed|aborted|err_connection|connection refused|net::err|fetch/i.test(s)
  const codeHint = /syntaxerror|referenceerror|typeerror|cannot read properties|is not a function|is not iterable|undefined is not|null is not|unexpected token/i.test(s)
  return netHint && !codeHint
}

/** Salida dev/preview que no debe alimentar la IA ni disparar auto-fix */
function isMonitoringNoise(text) {
  const t = String(text || '')
  if (!t.trim()) return true

  if (/\[preview\]\s*\[network\]/i.test(t)) return true
  if (/net::ERR_|ERR_CONNECTION|CONNECTION_REFUSED/i.test(t) && /localhost|127\.0\.0\.1|:5173|:5174|:5175|:5176|:3000|:8080|:4173/i.test(t)) return true

  if (/\[preview\].*Electron Security Warning/i.test(t)) return true
  if (/\[preview\].*React DevTools/i.test(t)) return true
  if (/\[preview\].*\[vite\]\s*(connecting|connected)/i.test(t)) return true
  if (/\[preview\].*✅ Cargado:/i.test(t)) return true
  if (/\[preview\]\s*\[console\.(log|info)\]/i.test(t)) return true

  if (/\[dev\].*VITE v[\d.]+ ready/i.test(t)) return true
  if (/\[dev\].*ready in \d+/i.test(t)) return true
  if (/\[dev\].*➜\s*Local:/i.test(t)) return true
  if (/\[dev\].*➜\s*Network:/i.test(t)) return true
  if (/\[dev\].*Proyecto Electron detectado/i.test(t)) return true
  if (/\[dev\].*Puertos limpiados/i.test(t)) return true
  if (/\[dev\].*servidor web \(sin ventana/i.test(t)) return true
  if (/\[diagnóstico\]/i.test(t)) return true

  if (/\[preview\]\s*Ventana cerrada/i.test(t)) return true

  return false
}

// ─── App Monitoring System ──────────────────────────────────────────────────
function useAppMonitor(devLogRef, onErrorRef) {
  const monitorRef = useRef({
    errors: [],
    performance: {},
    network: [],
    components: new Map(),
    startTime: Date.now()
  })

  const logError = useCallback((error, context = {}) => {
    const errorEntry = {
      type: 'error',
      message: error.message || String(error),
      stack: error.stack,
      context,
      timestamp: Date.now(),
      url: window.location.href,
      userAgent: navigator.userAgent
    }
    
    monitorRef.current.errors.push(errorEntry)
    
    // Send to dev panel
    if (window.api?.devLog) {
      const text = `[MONITOR] ${error.message || String(error)} ${context.component ? `(${context.component})` : ''}`
      window.api.devLog({ type: 'err', text })
      if (devLogRef?.current) {
        devLogRef.current.push({ text, time: Date.now(), type: 'err' })
        if (devLogRef.current.length > 80) devLogRef.current.splice(0, devLogRef.current.length - 80)
      }
    }
    
    // Keep only last 50 errors
    if (monitorRef.current.errors.length > 50) {
      monitorRef.current.errors = monitorRef.current.errors.slice(-50)
    }
    
    console.error('[AppMonitor]', errorEntry)
    
    if (onErrorRef?.current) onErrorRef.current(errorEntry)
  }, [onErrorRef])

  const logPerformance = useCallback((metric, value, context = {}) => {
    monitorRef.current.performance[metric] = {
      value,
      context,
      timestamp: Date.now()
    }
  }, [])

  const monitorComponent = useCallback((componentName, action, data = {}) => {
    const componentData = monitorRef.current.components.get(componentName) || { renders: 0, errors: 0, mounts: 0, unmounts: 0 }
    
    switch (action) {
      case 'mount':
        componentData.mounts++
        break
      case 'unmount':
        componentData.unmounts++
        break
      case 'render':
        componentData.renders++
        break
      case 'error':
        componentData.errors++
        logError(data.error, { component: componentName, ...data.context })
        break
    }
    
    monitorRef.current.components.set(componentName, componentData)
    
    if (window.api?.devLog && action === 'error') {
      const text = `[COMPONENT] ${componentName} error (mounts: ${componentData.mounts}, renders: ${componentData.renders})`
      window.api.devLog({ type: 'err', text })
      if (devLogRef?.current) {
        devLogRef.current.push({ text, time: Date.now(), type: 'err' })
        if (devLogRef.current.length > 80) devLogRef.current.splice(0, devLogRef.current.length - 80)
      }
    }
  }, [logError])

  // Setup global error handlers
  useEffect(() => {
    const handleError = (event) => {
      const msg = event.message || (event.error && event.error.message) || ''
      if (isLikelyNetworkOnlyIssue(msg, event.error)) return
      logError(event.error || new Error(event.message), {
        filename: event.filename,
        lineno: event.lineno,
        colno: event.colno,
        component: 'Global'
      })
    }

    const handleUnhandledRejection = (event) => {
      const msg = event.reason?.message != null ? String(event.reason.message) : String(event.reason ?? '')
      if (isLikelyNetworkOnlyIssue(msg, event.reason)) return
      logError(new Error(`Unhandled Promise Rejection: ${event.reason}`), {
        component: 'Promise',
        reason: event.reason
      })
    }

    window.addEventListener('error', handleError)
    window.addEventListener('unhandledrejection', handleUnhandledRejection)

    // Performance monitoring
    if ('performance' in window && 'getEntriesByType' in performance) {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.entryType === 'measure') {
            logPerformance(entry.name, entry.duration, { type: 'measure' })
          } else if (entry.entryType === 'navigation') {
            logPerformance('navigation', entry.loadEventEnd - entry.fetchStart, { type: 'navigation' })
          }
        }
      })
      observer.observe({ entryTypes: ['measure', 'navigation'] })
    }

    return () => {
      window.removeEventListener('error', handleError)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection)
    }
  }, [logError, logPerformance])

  return {
    monitor: monitorRef.current,
    logError,
    logPerformance,
    logNetwork: () => {},
    monitorComponent,
    getData: () => ({
      components: Object.fromEntries(monitorRef.current.components),
      errors: monitorRef.current.errors.slice(-10), // Last 10 errors
      performance: monitorRef.current.performance,
      network: monitorRef.current.network.slice(-10), // Last 10 network requests
      uptime: Date.now() - monitorRef.current.startTime
    })
  }
}

// Create monitoring context
const MonitorContext = React.createContext(null)

// ─── Component Monitoring HOC ────────────────────────────────────────────────
function withMonitoring(Component, componentName) {
  return React.memo(function MonitoredComponent(props) {
    const monitor = React.useContext(MonitorContext)
    
    React.useEffect(() => {
      monitor?.monitorComponent(componentName, 'mount')
      return () => monitor?.monitorComponent(componentName, 'unmount')
    }, [monitor])
    
    React.useEffect(() => {
      monitor?.monitorComponent(componentName, 'render')
    })
    
    try {
      return <Component {...props} />
    } catch (error) {
      monitor?.monitorComponent(componentName, 'error', { error })
      throw error
    }
  })
}

function extOf(name = '') { return name.split('.').pop()?.toLowerCase() || '' }

function shouldUseWebSearch(text = '') {
  const q = text.toLowerCase()
  const triggers = [
    'error', 'exception', 'stack', 'npm', 'pip', 'docker', 'install', 'download',
    'documentación', 'docs', 'stackoverflow', 'tutorial', 'cómo', 'como', 'qué',
    'versión', 'version', 'deprecated', 'api', 'endpoint', 'curl', 'aws', 'azure',
    'gcp', 'build', 'compilar', '404', '500', 'bug', 'issue', 'problema', 'actualizar'
  ]
  return triggers.some(term => q.includes(term))
}

function searchProjectFiles(projectFiles, query, maxFiles = 5, maxMatchesPerFile = 3) {
  if (!projectFiles || !query || query.trim().length < 3) return []
  const needle = query.trim().toLowerCase()
  const results = []

  for (const [rel, content] of Object.entries(projectFiles)) {
    if (!rel || typeof content !== 'string') continue
    const relLower = rel.toLowerCase()
    let score = 0
    if (relLower.includes(needle)) score += 5
    if (content === '[archivo muy grande, omitido]') {
      if (score <= 0) continue
      results.push({ file: rel, score, matches: [] })
      continue
    }

    const snippetLower = content.toLowerCase()
    if (snippetLower.includes(needle)) score += 3
    if (score <= 0) continue

    const lines = content.split('\n')
    const matches = []
    for (let i = 0; i < lines.length && matches.length < maxMatchesPerFile; i++) {
      const line = lines[i]
      if (line.toLowerCase().includes(needle)) {
        const start = Math.max(0, i - 1)
        const end = Math.min(lines.length - 1, i + 1)
        const preview = lines.slice(start, end + 1)
          .map((l, idx) => `${start + idx + 1}: ${l}`)
          .join('\n')
        matches.push({ line: i + 1, preview })
      }
    }
    if (matches.length) results.push({ file: rel, score, matches })
  }

  return results
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file))
    .slice(0, maxFiles)
}

const EXT_COLOR = {
  js: '#f7df1e', jsx: '#61dafb', ts: '#3178c6', tsx: '#3178c6',
  py: '#3572A5', rb: '#701516', rs: '#dea584', go: '#00ADD8',
  java: '#b07219', kt: '#7F52FF', swift: '#F05138',
  css: '#563d7c', scss: '#c6538c', less: '#1d365d',
  html: '#e34f26', htm: '#e34f26', xml: '#0060ac', json: '#292929',
  yml: '#cb171e', yaml: '#cb171e', md: '#083fa1', rst: '#083fa1',
  sh: '#89e051', bash: '#89e051', zsh: '#89e051',
  ps1: '#012456', bat: '#c1f12e', cmd: '#c1f12e',
  sql: '#e38c00', dockerfile: '#2496ed', conf: '#bcbec0',
  lock: '#7a7a7a', toml: '#7a7a7a', ini: '#7a7a7a', cfg: '#7a7a7a',
  c: '#555555', cpp: '#f34b7d', h: '#555555', hpp: '#f34b7d',
  vue: '#42b883', svelte: '#ff3e00', astro: '#ff5d01',
  php: '#777BB4', pl: '#0298c3', pm: '#0298c3',
  dart: '#00B4AB', lua: '#000080', r: '#198CE7',
  scala: '#c22d40', groovy: '#4298b8',
  pdf: '#b30b00', zip: '#7a7a7a', tar: '#7a7a7a', gz: '#7a7a7a',
  exe: '#7a7a7a', dll: '#7a7a7a', so: '#7a7a7a', dmg: '#7a7a7a',
  ico: '#7a7a7a', png: '#7a7a7a', jpg: '#7a7a7a', jpeg: '#7a7a7a',
  gif: '#7a7a7a', svg: '#ffb13b', webp: '#7a7a7a',
  mp4: '#7a7a7a', mp3: '#7a7a7a', wav: '#7a7a7a',
  gitignore: '#f05032', gitattributes: '#f05032', gitmodules: '#f05032',
  env: '#f7931e', editorconfig: '#7a7a7a', eslintrc: '#7b28c5',
  prettierrc: '#56b3b4', babelrc: '#f5da55'
}

const EXT_ICON = {
  js: 'JS', jsx: '⚛', ts: 'TS', tsx: '⚛',
  py: '🐍', rb: '💎', rs: '🦀', go: '🔷',
  java: '☕', kt: 'K', swift: 'S',
  css: '#', scss: '#', less: '#',
  html: '<>', htm: '<>', xml: '</>', json: '{ }',
  yml: 'Y', yaml: 'Y', md: '📝', rst: '📝',
  sh: '>_', bash: '>_', zsh: '>_',
  ps1: 'PS', bat: '>_', cmd: '>_',
  sql: 'SQL', dockerfile: '🐳', conf: '⚙',
  lock: '🔒', toml: 'T', ini: '⚙', cfg: '⚙',
  c: 'C', cpp: 'C++', h: 'H', hpp: 'H++',
  vue: 'V', svelte: 'S', astro: 'A',
  php: 'PHP', pl: 'PL', pm: 'PM',
  dart: 'D', lua: 'L', r: 'R',
  pdf: '📄', zip: '📦', tar: '📦', gz: '📦',
  exe: '⚡', dll: 'D', ico: '🖼', png: '🖼',
  jpg: '🖼', jpeg: '🖼', gif: '🖼', svg: 'SVG',
  mp4: '🎬', mp3: '🎵', wav: '🎵',
  gitignore: 'G', gitattributes: 'G', env: '🔐',
  editorconfig: 'E', eslintrc: 'E', prettierrc: 'P', babelrc: 'B'
}

function FileIcon({ name, isDir, open }) {
  if (isDir) return <span style={{ color:'#7c6af7', fontSize:10, fontWeight:700, letterSpacing:1 }}>{open ? '▾' : '▸'}</span>
  const ext = extOf(name)
  return <span style={{ fontSize:8, fontWeight:800, color: EXT_COLOR[ext] || '#888', letterSpacing:.5, minWidth:26, textAlign:'center' }}>{EXT_ICON[ext] || ext.toUpperCase().slice(0,3) || '·'}</span>
}

// ─── Markdown-ish renderer (simple) ──────────────────────────────────────────
function joinPath(dir, name) {
  const sep = dir.includes('\\') ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${sep}${name}`
}

function parseRequirementsText(text) {
  return text.split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('--'))
    .map(line => line.split(/[ \t=<>!~]+/)[0])
}

function parseTomlSection(text, section) {
  const lines = text.split('\n')
  const result = []
  let inSection = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    if (line.startsWith('[')) {
      inSection = line === `[${section}]`
      continue
    }
    if (!inSection) continue
    const key = line.split('=')[0].trim()
    if (key) result.push(key.replace(/"/g, ''))
  }
  return result
}

function parseGoMod(text) {
  const result = []
  const lines = text.split('\n')
  let inBlock = false
  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line || line.startsWith('//')) continue
    if (line.startsWith('require (')) { inBlock = true; continue }
    if (inBlock) {
      if (line === ')') { inBlock = false; continue }
      result.push(line.split(/\s+/)[0])
      continue
    }
    if (line.startsWith('require ')) {
      result.push(line.split(/\s+/)[1])
    }
  }
  return result
}

function parseCargoToml(text) {
  const dependencies = parseTomlSection(text, 'dependencies')
  const devDependencies = parseTomlSection(text, 'dev-dependencies')
  return { dependencies, devDependencies }
}

function parsePyProject(text) {
  const dependencies = parseTomlSection(text, 'tool.poetry.dependencies')
  const devDependencies = parseTomlSection(text, 'tool.poetry.dev-dependencies')
  const projectDeps = parseTomlSection(text, 'project.dependencies')
  const optionalDeps = parseTomlSection(text, 'project.optional-dependencies')
  return {
    dependencies: [...dependencies, ...projectDeps],
    devDependencies: devDependencies,
    optionalDependencies: optionalDeps,
  }
}

const Prose = memo(function Prose({ text }) {
  const html = text
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) =>
      `<pre class="code-block" data-lang="${lang}"><code>${code.trimEnd()}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/\n/g, '<br/>')
  return <div className="prose" dangerouslySetInnerHTML={{ __html: html }} />
})

// ─── FileTree ───────────────────────────────────────────────────────────────
function FileTree({ rootDir, onOpen, activeFilePath, onContextMenu, onOpenInBrowser }) {
  const [tree, setTree]   = useState({})
  const [open, setOpen]   = useState({})
  const [loading, setLoad]= useState(false)

  const loadDir = useCallback(async (dir) => {
    if (!window.api) return []
    const entries = await window.api.readDir(dir)
    setTree(p => ({ ...p, [dir]: entries }))
    return entries
  }, [])

  // Auto-expand root and first-level dirs that have few children
  useEffect(() => {
    if (!rootDir) return
    setTree({}); setOpen({})
    setLoad(true)
    loadDir(rootDir).then(async entries => {
      setOpen(p => ({ ...p, [rootDir]: true }))
      // Auto-expand dirs with <=15 files (common src/, lib/, etc.)
      const dirs = entries.filter(e => e.isDir)
      await Promise.all(dirs.map(async d => {
        const children = await loadDir(d.path)
        if (children.length <= 15) {
          setOpen(p => ({ ...p, [d.path]: true }))
        }
      }))
    }).finally(() => setLoad(false))
  }, [rootDir, loadDir])

  const toggle = async (entry) => {
    if (!entry.isDir) { onOpen(entry); return }
    const next = !open[entry.path]
    setOpen(p => ({ ...p, [entry.path]: next }))
    if (next && !tree[entry.path]) await loadDir(entry.path)
  }

  const normPath = p => (p || '').replace(/\\/g, '/')

  const renderEntries = (dir, depth = 0) => {
    const entries = tree[dir]
    if (!entries) return null
    return entries.map(e => (
      <div key={e.path}>
        <div
          className={`tree-row ${normPath(activeFilePath) === normPath(e.path) ? 'tree-active' : ''}`}
          style={{ paddingLeft: 6 + depth * 12 }}
          onClick={() => toggle(e)}
          onContextMenu={() => onContextMenu?.(e)}
          title={e.path}
        >
          <FileIcon name={e.name} isDir={e.isDir} open={open[e.path]} />
          <span className="tree-name">{e.name}</span>
          {!e.isDir && /\.html?$/i.test(e.name) && onOpenInBrowser && (
            <button className="tree-preview-btn" onClick={ev=>{ev.stopPropagation();onOpenInBrowser(e.path)}} title="Previsualizar en navegador">🌐</button>
          )}
          {!e.isDir && <span className="tree-ext">{extOf(e.name)}</span>}
        </div>
        {e.isDir && open[e.path] && tree[e.path] && renderEntries(e.path, depth + 1)}
        {e.isDir && open[e.path] && !tree[e.path] && (
          <div style={{ paddingLeft: 6 + (depth+1) * 12, color:'var(--text-3)', fontSize:9 }}>cargando…</div>
        )}
      </div>
    ))
  }

  if (!rootDir) return (
    <div className="tree-empty">
      <div style={{ opacity:.4, fontSize:11, textAlign:'center', padding:'24px 12px', lineHeight:1.8 }}>
        Sin proyecto<br/>
        <span style={{ fontSize:9 }}>Abrí una carpeta para empezar</span>
      </div>
    </div>
  )

  return (
    <div className="tree-scroll">
      {loading && <div className="tree-loading">Indexando proyecto…</div>}
      {!loading && renderEntries(rootDir)}
    </div>
  )
}

// ─── TabBar ───────────────────────────────────────────────────────────────────
const TabBar = memo(({ tabs, activeId, onSelect, onClose, onNew }) => (
  <div className="tabbar">
    <div className="tabbar-scroll">
      {tabs.map(t => (
        <div
          key={t.id}
          className={`tab ${t.id === activeId ? 'tab-active' : ''} ${t.dirty ? 'tab-dirty' : ''}`}
          onClick={() => onSelect(t.id)}
          title={t.filePath || t.name}
        >
          <FileIcon name={t.name} />
          <span className="tab-name">{t.name}</span>
          {t.dirty && <span className="tab-dot">●</span>}
          <span className="tab-close" onClick={e => { e.stopPropagation(); onClose(t.id) }}>×</span>
        </div>
      ))}
    </div>
    <button className="tab-new" onClick={onNew} title="Nuevo archivo">+</button>
  </div>
))

// ─── Terminal ─────────────────────────────────────────────────────────────────
function TerminalPanel({
  lines, onRun, busy, cwd, onClear,
  shellTerms, activeShellTerm, onTermSelect, onNewTerm, onCloseTerm, onRunShell,
}) {
  const copyOutput = (src) => {
    navigator.clipboard.writeText(src.map(l => l.text).join('\n')).catch(() => {})
  }
  const [cmd, setCmd] = useState('')
  const [hist, setHist] = useState([])
  const [hIdx, setHIdx] = useState(-1)
  const endRef = useRef(null)
  const isMain = activeShellTerm < 0
  const activeLines = isMain ? lines : (shellTerms[activeShellTerm]?.lines || [])
  const activeBusy = isMain ? busy : false

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }) }, [activeLines])

  const run = () => {
    if (!cmd.trim()) return
    setHist(p => [cmd, ...p.slice(0, 49)])
    setHIdx(-1)
    if (isMain) {
      onRun(cmd.trim())
    } else {
      onRunShell(activeShellTerm, cmd.trim())
    }
    setCmd('')
  }

  const onKey = (e) => {
    if (e.key === 'Enter') { run(); return }
    if (e.key === 'ArrowUp') { const ni = Math.min(hIdx + 1, hist.length - 1); setHIdx(ni); setCmd(hist[ni] || '') }
    if (e.key === 'ArrowDown') { const ni = Math.max(hIdx - 1, -1); setHIdx(ni); setCmd(ni < 0 ? '' : hist[ni] || '') }
  }

  return (
    <div className="terminal">
      <div className="terminal-header">
        <div className="term-tabs-wrap">
          <button className={`term-tab ${isMain ? 'active' : ''}`} onClick={() => onTermSelect(-1)}>
            Consola
          </button>
          {shellTerms.map((t, i) => (
            <div key={t.id} className={`term-tab-wrap ${activeShellTerm === i ? 'active' : ''}`}>
              <button className="term-tab" onClick={() => onTermSelect(i)}>
                {t.name}
              </button>
              <button className="term-tab-close" onClick={() => onCloseTerm(i)}>×</button>
            </div>
          ))}
          <button className="term-tab term-tab-new" onClick={onNewTerm} title="Nueva terminal">+</button>
        </div>
        <div className="term-toolbar">
          {cwd && <span className="terminal-cwd">{cwd.split(/[\\/]/).slice(-2).join('/')}</span>}
          <button className="icon-btn" onClick={() => copyOutput(activeLines)} title="Copiar salida">📋</button>
          <button className="icon-btn" onClick={onClear} title="Limpiar">⌫</button>
        </div>
      </div>
      <div className="terminal-output">
        {activeLines.map((l, i) => (
          <div key={i} className={`term-line term-${l.type}`}>{l.text}</div>
        ))}
        <div ref={endRef} />
      </div>
      <div className="terminal-input">
        <span className="term-prompt">❯</span>
        <input
          className="term-input"
          value={cmd}
          onChange={e => setCmd(e.target.value)}
          onKeyDown={onKey}
          placeholder={activeBusy ? 'ejecutando…' : 'comando'}
          disabled={activeBusy}
          spellCheck={false}
        />
        <button className="term-run-btn" onClick={run} disabled={activeBusy || !cmd.trim()}>▶</button>
      </div>
    </div>
  )
}

// ─── Chat Message ─────────────────────────────────────────────────────────────
const ChatMsg = memo(function ChatMsg({ msg, onApply, onApplyAll }) {
  if (msg.type === 'marker') {
    return (
      <div className="msg msg-marker">
        <div className="msg-marker-line">{msg.content || '— Fin de contexto —'}</div>
      </div>
    )
  }

  if (msg.type === 'agent_log' && Array.isArray(msg.toolSteps) && msg.toolSteps.length > 0) {
    // Compatibilidad: registros viejos traian { ok } en vez de { status }
    const steps = msg.toolSteps.map(r => ({ ...r, status: r.status || (r.ok === false ? 'err' : 'ok') }))
    return (
      <div className="msg msg-ai agent-log-msg">
        <div className="msg-avatar work-avatar" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14"><path d="M8 1.5l1.4 3.6 3.6 1.4-3.6 1.4L8 11.5 6.6 7.9 3 6.5l3.6-1.4L8 1.5zM12.5 10l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7.7-1.8z" fill="currentColor" opacity="0.7"/></svg>
        </div>
        <div className="msg-body agent-log-body" style={{ background: 'transparent', padding: 0 }}>
          <WorkSummary steps={steps} totalMs={msg.totalMs} />
        </div>
      </div>
    )
  }

  const actions = msg.role === 'assistant' ? parseActions(msg.content) : []
  const clean    = msg.role === 'assistant' ? stripActions(msg.content) : msg.content
  const isUser   = msg.role === 'user'
  const isAutoApplied = msg.content?.includes('Auto-aplicado')

  return (
    <div className={`msg ${isUser ? 'msg-user' : 'msg-ai'}`}>
      <div className="msg-avatar">{isUser ? 'U' : 'AI'}</div>
      <div className="msg-body">
        {msg.provider && (
          <div className="msg-meta">
            <span style={{ color: PROVIDERS[msg.provider]?.color || '#888' }}>
              {PROVIDERS[msg.provider]?.name || msg.provider}
            </span>
            {msg.model && <span className="msg-model">· {msg.model.split('/').pop()}</span>}
          </div>
        )}
        {msg.image && (
          <div className="msg-image-wrap">
            <img src={msg.image} alt="adjunto" className="msg-image" />
          </div>
        )}
        <Prose text={clean} />
        {actions.length > 0 && !isAutoApplied && (
          <div className="msg-actions">
            {actions.length > 1 && (
              <button className="action-btn action-all" onClick={() => onApplyAll(actions)}>
                ✦ Aplicar todo ({actions.length})
              </button>
            )}
            {actions.map((a, i) => (
              <button key={`action-${msg._id}-${i}-${a.type}-${a.filePath}`} className="action-btn" onClick={() => onApply(a)}>
                {a.type === 'RUN' ? '▶ Ejecutar' : a.type === 'READ' ? `📖 ${a.filePath}` : `✦ ${a.type} ${a.filePath?.split('/').pop() || ''}`}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
})

// ─── Plans Panel (inline in chat) ────────────────────────────────────────────
// ─── Chat Panel ───────────────────────────────────────────────────────────────
function ChatPanel({ settings, updateSettings, setPipelineStage, tabs, activeTab, rootDir, projectFiles, projectIndex, memories, getRelevantMemories, remember, onApplyAction, onApplyAll, chosenModel, setChosenModel, sendRef, devLogs = [], collectWebPageIntel }) {
  const msgIdCounter = useRef(0)
  const nextMsgId = () => ++msgIdCounter.current
  const [msgs, setMsgs]       = useState([{ role:'assistant', content:'Hola! Soy **MCodeAI Pre**. Abrí un proyecto o archivo y preguntame lo que necesités.', _id: 'welcome' }])
  const [input, setInput]     = useState('')
  const [image, setImage]     = useState(null)   // { base64, name, preview }
  const [busy, setBusy]       = useState(false)
  const [chatSearch, setChatSearch] = useState('')
  const [showChatSearch, setShowChatSearch] = useState(false)
  const abortRef              = useRef(null)
  const endRef                = useRef(null)
  const inputRef              = useRef(null)
  const fileInputRef          = useRef(null)

  const [showModelPanel, setShowModelPanel] = useState(false)
  const [agentTrace, setAgentTrace] = useState([])
  const agentTraceRef = useRef([])
  const [workText, setWorkText] = useState('')       // frase de estado (sin simbolos) mientras trabaja
  const [workStart, setWorkStart] = useState(null)   // Date.now() de inicio, para el cronometro
  const workStartRef = useRef(null)
  const modelPanelRef = useRef(null)
  useEffect(() => {
    if (!showModelPanel) return
    const handler = (e) => { if (modelPanelRef.current && !modelPanelRef.current.contains(e.target)) setShowModelPanel(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [showModelPanel])

  const markerActive = msgs.some(m => m.type === 'marker')
  const addContextMarker = () => {
    console.log('Adding context marker')
    setMsgs(p => [...p, { type:'marker', content:'— Hasta aquí termina el contexto anterior —', _id: nextMsgId() }])
  }
  const clearContextMarkers = () => setMsgs(p => p.filter(m => m.type !== 'marker'))

  const trimHistoryAfterMarker = (history) => {
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i]?.type === 'marker') {
        return history.slice(i + 1)
      }
    }
    return history
  }

  const autoFixCount = useRef(0)
  const pendingRef = useRef('')
  const handleApplyAll = async (actions) => {
    try {
      await onApplyAll(actions, {
        onError: (errors) => {
          const errMsg = errors.slice(0, 2000)
          setMsgs(p => [...p, { role:'assistant', content:'⚠️ Error de verificación al aplicar cambios:\n```\n' + errMsg + '\n```', _id: nextMsgId() }])
          if (autoFixCount.current >= 20) return
          autoFixCount.current++
          queueMicrotask(() => send(`La verificación de sintaxis encontró estos errores al aplicar los cambios anteriores:\n\`\`\`\n${errMsg}\n\`\`\`\nCorregilos. Si persisten, segui intentando hasta que compile sin errores.`, { auto: true }))
        }
      })
    } catch (e) {
      console.warn('Auto-fix error:', e)
    }
  }

  const pipelineProviders = Object.keys(PROVIDERS).filter(k => !['auto'].includes(k))
  const stageLabels = ['① Reader — detecta problemas', '② Fixer — genera parches', '③ Reviewer — verifica calidad']

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'instant' }) }, [msgs])

  // Image paste from clipboard
  const handlePaste = useCallback(async (e) => {
    const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
    if (!item) return
    e.preventDefault()
    const file   = item.getAsFile()
    const base64 = await imageToBase64(file)
    setImage({ base64, name: 'clipboard.png', preview: base64 })
  }, [])

  // Image file upload
  const handleImageFile = useCallback(async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const base64 = await imageToBase64(file)
    setImage({ base64, name: file.name, preview: base64 })
    e.target.value = ''
  }, [])

  // Expose send methods so BrowserTab can inject content/screenshots
  useEffect(() => {
    if (!sendRef) return
    sendRef.current = {
      sendMessage: (text) => send(text),
      sendImage:   (dataUrl, name) => setImage({ base64: dataUrl, name: name || 'captura.png', preview: dataUrl }),
      sendScreenshot: (dataUrl, name) => {
        setImage({ base64: dataUrl, name: name || 'captura.png', preview: dataUrl })
        // Send after React processes the image state
        setTimeout(() => send('📸 Captura de pantalla — analizá visualmente esta página.'), 50)
      },
    }
  })

  const prevMsgsLen = useRef(0)
  useEffect(() => {
    if (msgs.length !== prevMsgsLen.current) {
      prevMsgsLen.current = msgs.length
      endRef.current?.scrollIntoView({ behavior:'smooth' })
    } else {
      endRef.current?.scrollIntoView({ behavior:'instant' })
    }
  }, [msgs])

  const prov      = settings.provider
  const apiKey    = settings.apiKeys?.[prov] || null
  const model     = settings.models?.[prov]  || PROVIDERS[prov]?.defaultModel || ''

  const send = async (text, sendOpts = {}) => {
    if ((!text.trim() && !image) || busy) return
    // El tope de 20 auto-reparaciones es por pedido del usuario, no de por vida de la app
    if (!sendOpts.auto) autoFixCount.current = 0
    const imageData = image
    let userContent = text.trim() || (image ? '¿Qué ves en esta imagen?' : '')
    let displayImage = imageData?.preview

    setBusy(true)
    setAgentTrace([])
    agentTraceRef.current = []
    workStartRef.current = Date.now()
    setWorkStart(workStartRef.current)
    setWorkText('Preparando el contexto')
    const ab = new AbortController()
    abortRef.current = ab

    const agentModeEffective = !settings.pipeline && settings.agentMode !== false

    try {
      // Parallel: route + relevance
      const freshFiles = rootDir && window.api ? await window.api.projectContext(rootDir).catch(() => null) : projectFiles
      const lastQ = text.trim()
      const needsRoute  = prov === 'auto'
      // Con un solo modelo elegido NO se consulta OpenRouter por su cuenta (salvo "APIs auxiliares" activadas)
      const needsRelev  = !!(helperApisEnabled(settings) && freshFiles && settings.apiKeys?.openrouter && Object.keys(freshFiles || {}).length > 3)

      const localRelevantFiles = freshFiles
        ? selectRelevantFiles(freshFiles, lastQ, activeTab?.filePath || activeTab?.name, 5)
        : null

      const localProjectSearch = freshFiles
        ? searchProjectFiles(freshFiles, lastQ, 5, 3)
        : null

      const [routeResult, relevResult] = await Promise.all([
        needsRoute ? routeProvider(settings, freshFiles, lastQ, activeTab?.filePath || activeTab?.name, ab.signal).catch(() => null) : null,
        needsRelev ? analyzeProjectRelevance({ projectFiles: freshFiles, userQuestion: lastQ, openrouterApiKey: settings.apiKeys.openrouter, signal: ab.signal }).catch(() => null) : null,
      ])

      let activeProv = prov, activeModel = model, activeKey = apiKey
      if (needsRoute && routeResult?.length) {
        const p = routeResult[0]
        activeProv = p.provider; activeModel = p.model; activeKey = p.apiKey
        setChosenModel(`${PROVIDERS[activeProv]?.name || activeProv} · ${activeModel.split('/').pop()}`)
      } else if (!needsRoute) {
        // Manual single-model mode: respetar la selección del usuario
        setChosenModel(`${PROVIDERS[activeProv]?.name || activeProv} · ${activeModel.split('/').pop()}`)
      }

      const routeCandidates = needsRoute && Array.isArray(routeResult) && routeResult.length
        ? routeResult
        : [{ provider: activeProv, model: activeModel, apiKey: activeKey }]

      const userMsg = {
        role: 'user',
        content: userContent,
        image: displayImage,
        _id: nextMsgId(),
      }
      const rawHistory = [...msgs, userMsg]
      setMsgs(rawHistory)
      setInput('')
      setImage(null)

      const history = trimHistoryAfterMarker(rawHistory)
      const ctx = activeTab
        ? (activeTab.filePath ? `[Archivo activo: ${activeTab.name}]\n` : '') + (activeTab.content || '')
        : ''

      const mems = getRelevantMemories(rootDir, activeTab?.filePath)
      // Strip extra fields (provider, model) — Mistral/Together reject them with 422
      const cleanHistory = history
        .filter(m => m.type !== 'agent_log')
        .map(m => ({ role: m.role, content: m.content || '' }))
      const relevantFiles = relevResult || localRelevantFiles || projectIndex

      let webSearchResults = null
      if (shouldUseWebSearch(lastQ)) {
        try {
          const searchRes = await searchWeb(lastQ, 3)
          if (searchRes?.ok && Array.isArray(searchRes.results) && searchRes.results.length > 0) {
            webSearchResults = searchRes.results
          }
        } catch (err) {
          console.warn('Web search failed', err)
        }
      }

      let webPageIntel = null
      if (collectWebPageIntel) {
        try {
          webPageIntel = await collectWebPageIntel()
        } catch (err) {
          console.warn('collectWebPageIntel', err)
        }
      }

      const baseMessages = buildMessages({
        projectFiles:         freshFiles,
        activeFile:           activeTab?.filePath || activeTab?.name,
        activeContent:        activeTab?.content,
        memories:             mems,
        history:              cleanHistory,
        relevantFiles,
        searchResults:        webSearchResults,
        projectSearchResults: localProjectSearch,
        devLogs,
        webPageIntel,
        tokenBudget:          25000,
        agentMode:            agentModeEffective,
      })

      // Stream response
      let aiMsg = { role:'assistant', content:'', provider: activeProv, model: activeModel, _id: nextMsgId() }
      setMsgs(p => [...p, aiMsg])

      const bufferFallbacks = routeCandidates.length > 1
      let lastError = null
      for (let idx = 0; idx < routeCandidates.length; idx++) {
        const route = routeCandidates[idx]
        activeProv = route.provider
        activeModel = route.model
        activeKey = route.apiKey

        if (needsRoute) {
          setChosenModel(`${PROVIDERS[activeProv]?.name || activeProv} · ${activeModel.split('/').pop()}`)
        }

        const routeSupportsVision = modelSupportsVision(activeProv, activeModel)
        const routeImageBase64 = routeSupportsVision ? imageData?.base64 : null
        let routeUserContent = userContent
        if (imageData && !routeSupportsVision) {
          if (helperApisEnabled(settings) && settings.apiKeys?.gemini) {
            routeUserContent = await describeImage({ imageBase64: imageData.base64, userContext: text.trim(), geminiApiKey: settings.apiKeys.gemini })
          } else {
            // Un solo proveedor: no se manda la imagen a otra API; se avisa con claridad
            setMsgs(p => [...p, { role:'assistant', content: `${PROVIDERS[activeProv]?.name || activeProv} · ${String(activeModel).split('/').pop()} no procesa imágenes, así que la imagen no se envió. Elegí un modelo con visión o activá "APIs auxiliares" en Ajustes para que Gemini la describa.`, _id: nextMsgId() }])
          }
        }
        const routeMessages = baseMessages.map((m, i) =>
          i === baseMessages.length - 1
            ? { ...m, content: routeUserContent }
            : m
        )

        aiMsg = { role:'assistant', content:'', provider: activeProv, model: activeModel, _id: aiMsg._id }

        let candidateFull = ''
        let rafPending = false
        let sawText = false
        const onChunkCallback = (chunk, full) => {
          if (!sawText && String(full || '').trim()) { sawText = true; setWorkText('Escribiendo la respuesta') }
          candidateFull = full
          pendingRef.current = full
          if (!rafPending) {
            rafPending = true
            requestAnimationFrame(() => {
              rafPending = false
              aiMsg = { ...aiMsg, content: pendingRef.current }
              setMsgs(p => [...p.slice(0, -1), aiMsg])
            })
          }
        }

        try {
          await sendToAI({
            provider: activeProv, model: activeModel, apiKey: activeKey, messages: routeMessages,
            signal: ab.signal, settings,
            imageBase64: routeImageBase64,
            activeFile: activeTab?.filePath || activeTab?.name,
            activeContent: activeTab?.content,
            projectFiles: freshFiles,
            relevantFiles,
            rootDir,
            onChunk: onChunkCallback,
            agentMode: agentModeEffective,
            onStatus: ({ text: st }) => { if (st) setWorkText(st) },
            onToolProgress: ({ phase, name, detail, ok }) => {
              const nm = name || '?', dt = detail || ''
              if (phase === 'start') {
                const row = { id: `${Date.now()}-${agentTraceRef.current.length}`, name: nm, detail: dt, status: 'run', t0: Date.now() }
                agentTraceRef.current.push(row)
                setAgentTrace(t => [...t, row])
                return
              }
              if (phase !== 'done') return
              // Cierra el ultimo paso en curso con el mismo nombre (o crea uno si no hubo 'start')
              const list = agentTraceRef.current
              let idx = -1
              for (let i = list.length - 1; i >= 0; i--) { if (list[i].status === 'run' && list[i].name === nm) { idx = i; break } }
              const status = ok === false ? 'err' : 'ok'
              if (idx >= 0) list[idx] = { ...list[idx], status, ms: Date.now() - list[idx].t0 }
              else list.push({ id: `${Date.now()}-${list.length}`, name: nm, detail: dt, status, ms: null })
              setAgentTrace([...list])
              setWorkText('Pensando')
            },
          })

          // Flush final content after streaming ends
          rafPending = false
          if (pendingRef.current) {
            aiMsg = { ...aiMsg, content: pendingRef.current }
            setMsgs(p => [...p.slice(0, -1), aiMsg])
          }

          const persistedSteps = agentTraceRef.current.map(({ id, name, detail, status, ms }) => ({ id, name, detail, status: status === 'run' ? 'ok' : status, ms }))
          const workTotalMs = workStartRef.current ? Date.now() - workStartRef.current : null
          if (persistedSteps.length > 0) {
            const logId = nextMsgId()
            setMsgs(p => {
              const last = p[p.length - 1]
              if (!last || last.role !== 'assistant' || last._id !== aiMsg._id) return p
              const logMsg = {
                type: 'agent_log',
                role: 'assistant',
                toolSteps: persistedSteps,
                totalMs: workTotalMs,
                provider: activeProv,
                model: activeModel,
                _id: logId,
              }
              return [...p.slice(0, -1), logMsg, last]
            })
          }
          setAgentTrace([])
          agentTraceRef.current = []

          const finalAssistantContent = pendingRef.current || aiMsg.content || ''
          if (finalAssistantContent.trim() && window.api) {
            const allActs = parseActions(finalAssistantContent)
            console.log(`[AI-RESPONSE] Acciones parseadas: ${allActs.length}`, allActs.map(a => ({ type: a.type, path: a.filePath })))
            if (allActs.length > 0 && !rootDir) {
              setMsgs(p => [...p, { role:'assistant', content:'ℹ️ La respuesta incluye parches (`\`\`\`PATCH/WRITE/CREATE\`\`\``). Aplicando directamente...', _id: nextMsgId() }])
            }
            if (allActs.length === 0) {
              lastError = null
              break
            }

            const fileActs = allActs.filter(a => a.type !== 'RUN' && a.type !== 'READ')
            const readActs = allActs.filter(a => a.type === 'READ')
            const runActs = allActs.filter(a => a.type === 'RUN')
            console.log(`[AI-RESPONSE] Auto-aplicar config:`, { autoApplyAiPatches: settings.autoApplyAiPatches, fileActs: fileActs.length, readActs: readActs.length, runActs: runActs.length })
            if (allActs.length > 0 && fileActs.length === 0 && runActs.length === 0) {
              const detail = readActs.length > 0 
                ? `ℹ️ La respuesta incluye solo acciones de lectura (READ: ${readActs.map(a => a.filePath).join(', ')}). No hay parches para aplicar automáticamente.`
                : `ℹ️ No se detectaron acciones modificables en la respuesta.`
              console.log('[AUTO-APPLY] No hay acciones de modificación de archivos para auto-aplicar.', allActs)
              setMsgs(p => [...p, { role:'assistant', content: detail, _id: nextMsgId() }])
            }
            const appendAutoNote = (paths) => {
              if (!paths?.length) return
              const note = `\n\n— *Auto-aplicado (${paths.length}): ${paths.join(', ')}* —`
              const nextContent = (pendingRef.current || aiMsg.content) + note
              pendingRef.current = nextContent
              aiMsg = { ...aiMsg, content: nextContent }
              setMsgs(p => {
                const last = p[p.length - 1]
                if (!last || last.role !== 'assistant' || last._id !== aiMsg._id) return p
                return [...p.slice(0, -1), { ...last, content: nextContent }]
              })
            }

            if (settings.autoApplyAiPatches !== false && fileActs.length > 0 && window.api) {
              console.log(`[AUTO-APPLY] Intentando aplicar ${fileActs.length} acciones: ${fileActs.map(a => a.type).join(', ')}`)
              const r = await onApplyAll(fileActs, {
                onError: (errMsg) => {
                  console.error('[AUTO-APPLY] Error:', errMsg)
                  setMsgs(p => [...p, { role:'assistant', content:'⚠️ Auto-aplicar: error de verificación:\n```\n' + errMsg.slice(0, 2000) + '\n```', _id: nextMsgId() }])
                  if (autoFixCount.current < 20) {
                    autoFixCount.current++
                    queueMicrotask(() => send(`Tras auto-aplicar parches, la verificación falló:\n\`\`\`\n${errMsg.slice(0, 2000)}\n\`\`\`\nCorregí el código.`, { auto: true }))
                  }
                },
              })
              console.log(`[AUTO-APPLY] Resultado:`, r)
              if (r?.ok) {
                console.log(`[AUTO-APPLY] Éxito! Archivos: ${fileActs.map(a => a.filePath).join(', ')}`)
                appendAutoNote(fileActs.map(a => a.filePath).filter(Boolean))
              } else {
                console.warn(`[AUTO-APPLY] Falló. Errores: ${r?.errors?.length || 'desconocido'}`)
              }
            } else if (fileActs.length > 0) {
              console.log(`[AUTO-APPLY] Omitido - autoApplyAiPatches: ${settings.autoApplyAiPatches}, window.api: ${!!window.api}`)
            }

            if (settings.autoApplyAiRun && runActs.length > 0) {
              await onApplyAll(runActs, {
                onError: (errMsg) => {
                  setMsgs(p => [...p, { role:'assistant', content:'⚠️ Auto-ejecutar RUN:\n```\n' + errMsg.slice(0, 1500) + '\n```', _id: nextMsgId() }])
                },
              })
            }
          }

          lastError = null
          break
        } catch (e) {
          lastError = e
          agentTraceRef.current = []
          setAgentTrace([])
          if (idx === routeCandidates.length - 1) throw e
        }
      }

      remember(rootDir, text, pendingRef.current || aiMsg.content, activeTab?.filePath)
    } catch (e) {
      if (e.name !== 'AbortError') {
        setMsgs(p => [...p, { role:'assistant', content:'❌ ' + e.message, _id: nextMsgId() }])
      }
    } finally {
      setBusy(false)
      abortRef.current = null
      setAgentTrace([])
      agentTraceRef.current = []
    }
  }

  const stop = () => { abortRef.current?.abort(); setBusy(false); setAgentTrace([]); agentTraceRef.current = [] }

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) }
  }

  return (
    <div className="chat-panel">
      <div className="panel-header">
        <span className="panel-label">AI CHAT</span>
        {chosenModel && prov === 'auto' && (
          <span className="chosen-model">→ {chosenModel}</span>
        )}
        {settings.agentMode !== false && !settings.pipeline && (
          <span className="context-badge agent-mode-badge" title="Modo Agente: más pasadas de herramientas y trazas tipo Cursor">
            ⚡ Agente
          </span>
        )}
        {busy && prov === 'gemini' && helperApisEnabled(settings) && settings.apiKeys?.gemini && settings.apiKeys?.zen && projectFiles && Object.keys(projectFiles).length > 0 && (
          <span className="context-badge" style={{ borderColor:'#569cd6', color:'#569cd6' }} title="Zen analiza el proyecto y Gemini supervisa (APIs auxiliares activadas)">Gemini + Zen</span>
        )}
        {markerActive && <span className="context-badge">Corte de contexto activo</span>}
        <button
          className="icon-btn"
          onClick={addContextMarker}
          title="Marcar fin de contexto"
        >📍</button>
        <button
          className="icon-btn"
          onClick={clearContextMarkers}
          title="Restablecer punto de corte"
          disabled={!markerActive}
        >↺</button>
        <div className="model-select-inline" ref={modelPanelRef}>
          <button className="icon-btn" onClick={() => setShowModelPanel(p => !p)} title="Seleccionar modelo">
            {settings.provider === 'auto' ? '◈' : settings.provider === 'gemini' ? '◈' : '◈'}
          </button>
          {showModelPanel && (
            <div className="model-select-dropdown">
              <div className="model-dd-section">
                <div className="model-dd-label">Proveedor</div>
                <select className="settings-select-sm" value={settings.provider}
                  onChange={e => updateSettings({ provider: e.target.value })}>
                  {Object.entries(PROVIDERS).map(([k, v]) => (
                    <option key={k} value={k}>{v.name}</option>
                  ))}
                </select>
              </div>
              {settings.provider !== 'auto' && (
                <div className="model-dd-section">
                  <div className="model-dd-label">Modelo</div>
                  {PROVIDERS[settings.provider]?.models?.length > 0 ? (
                    <select className="settings-select-sm" value={settings.models[settings.provider] || PROVIDERS[settings.provider].defaultModel}
                      onChange={e => updateSettings({ models: { ...settings.models, [settings.provider]: e.target.value } })}>
                      {PROVIDERS[settings.provider].models.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  ) : (
                    <input className="key-input" value={settings.models[settings.provider] || ''}
                      onChange={e => updateSettings({ models: { ...settings.models, [settings.provider]: e.target.value } })}
                      placeholder={PROVIDERS[settings.provider]?.defaultModel || 'modelo'} />
                  )}
                </div>
              )}
              <div className="model-dd-section">
                <div className="model-dd-label">Modo</div>
                <label className="model-dd-check">
                  <input type="checkbox" checked={settings.agentMode !== false}
                    disabled={!!settings.pipeline}
                    onChange={e => updateSettings({ agentMode: e.target.checked })} />
                  Modo Agente (herramientas + trazas)
                </label>
                <label className="model-dd-check">
                  <input type="checkbox" checked={settings.pipeline}
                    onChange={e => updateSettings({ pipeline: e.target.checked })} />
                  Pipeline 3 etapas
                </label>
              </div>
              {settings.pipeline && (
                <div className="model-dd-section">
                  <div className="model-dd-label">Etapas del pipeline</div>
                  {(settings.pipelineStages || []).map((stage, idx) => (
                    <div key={idx} className="pipeline-stage">
                      <div className="pipeline-stage-label">{stageLabels[idx]}</div>
                      <div className="pipeline-stage-row">
                        <select className="settings-select-sm" value={stage.provider}
                          onChange={e => setPipelineStage(idx, { provider: e.target.value, model: PROVIDERS[e.target.value]?.defaultModel || '' })}>
                          {pipelineProviders.map(k => (
                            <option key={k} value={k}>{PROVIDERS[k]?.name || k}</option>
                          ))}
                        </select>
                        <input type="password" className="key-input" placeholder="API Key"
                          value={stage.key || ''} onChange={e => setPipelineStage(idx, { key: e.target.value })}
                          style={{ flex: 1 }} />
                      </div>
                      <input className="key-input key-model-input" placeholder={`Modelo (default: ${PROVIDERS[stage.provider]?.defaultModel || ''})`}
                        value={stage.model || ''} onChange={e => setPipelineStage(idx, { model: e.target.value })} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
        <button className="icon-btn" onClick={() => setShowChatSearch(p => !p)} title="Buscar en chat">🔍</button>
        <button className="icon-btn" onClick={async () => {
          if (!window.api) return
          const text = msgs.map(m => {
            if (m.type === 'agent_log' && Array.isArray(m.toolSteps)) {
              const lines = m.toolSteps.map(s => `- ${(s.status === 'err' || s.ok === false) ? 'err' : 'ok'} ${s.name} ${s.detail || ''}`).join('\n')
              return `## Herramientas (${m.provider || ''})\n${lines}`
            }
            return `## ${m.role === 'user' ? 'Usuario' : 'IA'}${m.provider ? ' (' + m.provider + ')' : ''}\n${m.content || ''}`
          }).join('\n\n---\n\n')
          const r = await window.api.saveFile('chat-export.md', text)
          if (r) setMsgs(p => [...p, { role:'assistant', content:`✅ Chat exportado: \`${r}\``, _id: nextMsgId() }])
        }} title="Exportar chat">💾</button>
        <button className="icon-btn" onClick={() => setMsgs([{ role:'assistant', content:'Chat reiniciado.', _id: nextMsgId() }])} title="Limpiar chat">⌫</button>
        {undoHistory.length > 0 && (
          <span className="undo-badge" title={`${undoHistory.length} cambio(s) para deshacer`}>↩ {undoHistory.length}</span>
        )}
      </div>

      {showChatSearch && (
        <div className="chat-search-bar">
          <input
            className="chat-search-input"
            value={chatSearch}
            onChange={e => setChatSearch(e.target.value)}
            placeholder="Buscar en mensajes…"
            autoFocus
          />
          <button className="icon-btn" onClick={() => { setChatSearch(''); setShowChatSearch(false) }}>×</button>
        </div>
      )}

      <div className="chat-messages">
        {msgs.filter(m => {
          if (m.role === 'assistant' && !m.type && !String(m.content ?? '').trim() && !m.image) return false
          if (!chatSearch.trim()) return true
          const q = chatSearch.toLowerCase()
          if ((m.content || '').toLowerCase().includes(q) || (m.role || '').toLowerCase().includes(q)) return true
          if (m.type === 'agent_log' && Array.isArray(m.toolSteps)) {
            return m.toolSteps.some(s =>
              (s.name || '').toLowerCase().includes(q) || (s.detail || '').toLowerCase().includes(q))
          }
          return false
        }).map((m, i) => (
          <ChatMsg key={`${m._id != null && m._id !== '' ? `id-${m._id}` : 'noid'}-${i}`} msg={m} onApply={onApplyAction} onApplyAll={handleApplyAll} />
        ))}
        {busy && (
          <div className="msg msg-ai work-msg">
            <div className="msg-avatar work-avatar" aria-hidden="true" />
            <div className="msg-body">
              <WorkCard text={workText} steps={agentTrace} startedAt={workStart} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-input-area">
        {/* Image preview */}
        {image && (
          <div className="chat-image-preview">
            <img src={image.preview} alt={image.name} className="chat-preview-img" />
            <div className="chat-preview-info">
              <span>{image.name}</span>
              {modelSupportsVision(prov, model)
                ? <span className="vision-badge">👁 visión nativa</span>
                : <span className="vision-badge vision-desc">📝 se describirá con Gemini</span>
              }
            </div>
            <button className="chat-preview-remove" onClick={() => setImage(null)}>×</button>
          </div>
        )}

        {/* Quick actions */}
        <div className="quick-actions">
          <button className="qa-btn" onClick={() => send('Agregá comentarios y docstrings a este archivo')} disabled={busy} title="Documentar código">📝 Docs</button>
          <button className="qa-btn" onClick={() => send('Agregá unit tests para este código')} disabled={busy} title="Generar tests">🧪 Tests</button>
          <button className="qa-btn" onClick={() => send('Optimizá el rendimiento de este código. Identificá cuellos de botella y proponé mejoras.')} disabled={busy} title="Optimizar">⚡ Optimizar</button>
          <button className="qa-btn" onClick={() => send('Revisá la seguridad de este código. Buscá vulnerabilidades, inyecciones, XSS, CSRF, etc.')} disabled={busy} title="Revisar seguridad">🔒 Security</button>
          <button className="qa-btn" onClick={() => send('Agregá TypeScript types a este archivo')} disabled={busy} title="Agregar types">📐 Types</button>
          <button className="qa-btn" onClick={() => send('Refactorizá este código para mejorarlo. Aplicá patrones de diseño si corresponde.')} disabled={busy} title="Refactorizar">🔄 Refactor</button>
          <button className="qa-btn" onClick={async () => {
            try {
              const { takeScreenshot } = await import('./ai.js')
              const r = await takeScreenshot()
              if (r.ok) chatSendRef.current?.sendScreenshot?.(r.dataUrl, 'Captura')
            } catch {}
          }} disabled={busy} title="Capturar pantalla y analizar con IA">📸 Captura</button>
        </div>
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={onKey}
          onPaste={handlePaste}
          placeholder={busy ? 'Generando…' : 'Preguntá · pega imagen con Ctrl+V · Shift+Enter nueva línea'}
          disabled={busy}
          rows={3}
        />
        <div className="chat-actions">
          <div style={{ display:'flex', gap:5, alignItems:'center' }}>
            <span className="input-hint">{estimateTokens(input)} tok</span>
            <button
              className="icon-btn"
              title="Adjuntar imagen"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              style={{ fontSize:14 }}
            >🖼</button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display:'none' }}
              onChange={handleImageFile}
            />
          </div>
          {busy
            ? <button className="send-btn stop-btn" onClick={stop}>◼ Detener</button>
            : <button className="send-btn" onClick={() => send(input)} disabled={!input.trim() && !image}>Enviar ↵</button>
          }
        </div>
      </div>
    </div>
  )
}

// ─── Model Selector Modal ─────────────────────────────────────────────────────
// ─── Settings Modal ───────────────────────────────────────────────────────────
function SettingsModal({ settings, updateSettings, setApiKey, setModel, setPipelineStage, onClose, webServerPort, webServerRunning, webServerIPs, toggleWebServer, updateWebServerPort }) {
  const providers = [
    { key:'groq',       name:'Groq',       url:'https://console.groq.com/keys',            free:true  },
    { key:'gemini',     name:'Gemini',      url:'https://aistudio.google.com/app/apikey',   free:true  },
    { key:'openrouter', name:'OpenRouter',  url:'https://openrouter.ai/keys',               free:true  },
    { key:'cerebras',   name:'Cerebras',    url:'https://cloud.cerebras.ai',                free:true  },
    { key:'mistral',    name:'Mistral',     url:'https://console.mistral.ai/api-keys/',     free:true  },
    { key:'zen',       name:'Zen (opencode.ai)', url:'https://opencode.ai/zen',                   free:'parcial' },
    { key:'sambanova', name:'SambaNova',   url:'https://cloud.sambanova.ai/apis',              free:true  },
    { key:'fireworks', name:'Fireworks',    url:'https://fireworks.ai/api-keys',                free:true  },
    { key:'deepseek',  name:'DeepSeek',     url:'https://platform.deepseek.com/api_keys',       free:true  },
    { key:'nvidia',    name:'NVIDIA NIM',   url:'https://build.nvidia.com',                     free:true  },
  ]

  const pipelineProviders = Object.keys(PROVIDERS).filter(k => !['auto'].includes(k))
  const stageLabels = ['① Reader — detecta problemas', '② Fixer — genera parches', '③ Reviewer — verifica calidad']

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-header">
          <span className="modal-title">⚙ Configuración</span>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">

          {/* Provider */}
          <div className="settings-section">
            <div className="settings-label">Proveedor activo</div>
            <select className="settings-select" value={settings.provider} onChange={e => updateSettings({ provider: e.target.value })}>
              {Object.entries(PROVIDERS).map(([k, v]) => (
                <option key={k} value={k}>{v.name} — {v.label}</option>
              ))}
            </select>
            {settings.provider === 'auto' && (
              <div style={{ fontSize:9, color:'#4ec9b0', marginTop:4, lineHeight:1.6 }}>
                ✦ Modo Auto: orquesta entre Gemini y Zen según el contexto.<br/>
                Configurá Gemini o Zen para activarlo.
              </div>
            )}
          </div>

          {/* API Keys */}
          <div className="settings-section">
            <div className="settings-label">API Keys</div>
            {providers.map(p => (
              <div key={p.key} className="key-row">
                <div className="key-info">
                  <span className="key-name" style={{ color: PROVIDERS[p.key]?.color }}>{p.name}</span>
                  {p.free === true && <span className="key-free">GRATIS</span>}
                  {p.free === 'parcial' && <span className="key-free" style={{ borderColor:'#e5c07b', color:'#e5c07b' }}>-free models</span>}
                  <a className="key-link" href={p.url} target="_blank" rel="noreferrer">↗ Obtener key</a>
                </div>
                <input
                  type="password"
                  className="key-input"
                  placeholder={`${p.name} API Key…`}
                  value={settings.apiKeys?.[p.key] || ''}
                  onChange={e => setApiKey(p.key, e.target.value)}
                />
                {settings.models?.[p.key] !== undefined && (
                  <div className="key-model-row">
                    <span className="key-model-label">Modelo:</span>
                    {PROVIDERS[p.key]?.models?.length > 0 ? (
                      <select
                        className="settings-select key-model-input"
                        value={settings.models[p.key] || PROVIDERS[settings.provider].defaultModel}
                        onChange={e => setModel(p.key, e.target.value)}
                      >
                        {PROVIDERS[settings.provider].models.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    ) : (
                      <input
                        className="key-input key-model-input"
                        value={settings.models[p.key] || ''}
                        onChange={e => setModel(p.key, e.target.value)}
                        placeholder={PROVIDERS[settings.provider]?.defaultModel || 'modelo'} />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Intel proyecto / sandbox */}
          <div className="settings-section">
            <div className="settings-label">🔬 Intel proyecto (ingeniería inversa)</div>
            <div style={{ fontSize: 10, color: 'var(--text-3)', marginBottom: 8, lineHeight: 1.5 }}>
              Opciones: proceso del editor, hijo Node o contenedor Docker (imagen Node oficial; sin npm audit el contenedor usa <code>--network none</code>). Si Docker no está, se usa hijo → editor.
              <code style={{ marginLeft: 4 }}>npm audit</code> usa red (registry npm).
            </div>
            <div className="settings-row">
              <span>Modo sandbox</span>
              <select
                className="settings-select-sm"
                value={settings.reverseIntelSandboxMode || 'host-direct'}
                onChange={e => updateSettings({ reverseIntelSandboxMode: e.target.value })}
              >
                <option value="host-direct">Proceso del editor (rápido)</option>
                <option value="child-process">Proceso hijo Node</option>
                <option value="docker">Docker (contenedor + volumen)</option>
              </select>
            </div>
            <label className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!settings.reverseIntelNpmAudit}
                onChange={e => updateSettings({ reverseIntelNpmAudit: e.target.checked })}
              />
              <span>Incluir npm audit por defecto (red + más lento)</span>
            </label>
            <label className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={!!settings.reverseIntelBinaryStrings}
                onChange={e => updateSettings({ reverseIntelBinaryStrings: e.target.checked })}
              />
              <span>Incluir strings/file en binarios (ejecutá antes <code style={{ fontSize: 9 }}>npm run docker:intel-image</code> para Docker)</span>
            </label>
            <div style={{ fontSize: 9, color: 'var(--text-3)', marginTop: 4 }}>
              Hijo Node: <code>MCAP_NODE_EXEC</code>. Docker: imagen <code>MCAP_INTEL_DOCKER_IMAGE</code> (default <code>node:20-bookworm-slim</code>), binario <code>MCAP_DOCKER_PATH</code>.
            </div>
          </div>

          {/* IA: auto-aplicar parches */}
          <div className="settings-section">
            <div className="settings-label">IA — aplicar cambios</div>
            <div style={{ fontSize:10, color:'var(--text-3)', marginBottom:8, lineHeight:1.5 }}>
              Tras cada respuesta del asistente, los bloques PATCH / WRITE / CREATE pueden aplicarse solos al proyecto abierto (📁).
            </div>
            <label className="settings-row" style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
              <input type="checkbox" checked={settings.agentMode !== false}
                disabled={!!settings.pipeline}
                onChange={e => updateSettings({ agentMode: e.target.checked })} />
              <span>Modo Agente (más pasadas de [TOOL:], trazas arriba del chat; desactivado mientras Pipeline 3 etapas está ON)</span>
            </label>
            <label className="settings-row" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ minWidth: 140 }}>Rondas herramienta</span>
              <select
                className="settings-select-sm"
                disabled={!!settings.pipeline || settings.agentMode === false}
                value={String([4, 8, 10, 14, 18, 24].includes(settings.agentToolRounds) ? settings.agentToolRounds : 10)}
                onChange={e => updateSettings({ agentToolRounds: Number(e.target.value) })}
              >
                {[4, 8, 10, 14, 18, 24].map(n => (
                  <option key={n} value={n}>{n} rondas</option>
                ))}
              </select>
              <span style={{ fontSize: 9, color: 'var(--text-3)' }}>Con agente ON, sin Pipeline</span>
            </label>
            <label className="settings-row" style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
              <input type="checkbox" checked={settings.autoApplyAiPatches !== false}
                onChange={e => updateSettings({ autoApplyAiPatches: e.target.checked })} />
              <span>Aplicar automáticamente archivos (PATCH, WRITE, CREATE)</span>
            </label>
            <label className="settings-row" style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
              <input type="checkbox" checked={!!settings.autoApplyAiRun}
                onChange={e => updateSettings({ autoApplyAiRun: e.target.checked })} />
              <span>También ejecutar bloques RUN (comandos en tu máquina — usar con cuidado)</span>
            </label>
          </div>

          <div className="settings-section">
            <div className="settings-label">IA — un solo proveedor</div>
            <div style={{ fontSize:10, color:'var(--text-3)', marginBottom:8, lineHeight:1.5 }}>
              Con un modelo elegido (no "Auto"), cada mensaje va solo a esa API. Si lo activás, otras APIs con key guardada pueden ayudar por detrás.
            </div>
            <label className="settings-row" style={{ display:'flex', alignItems:'center', gap:8, cursor:'pointer' }}>
              <input type="checkbox" checked={!!settings.helperApis}
                onChange={e => updateSettings({ helperApis: e.target.checked })} />
              <span>Permitir APIs auxiliares (Zen + Gemini juntos, OpenRouter para el índice, Gemini para describir imágenes)</span>
            </label>
          </div>

          {/* Pipeline stages */}
          <div className="settings-section">
            <div className="settings-label" style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <span>Pipeline — 3 etapas independientes</span>
              <button className="toggle-btn" data-on={settings.pipeline} onClick={() => updateSettings({ pipeline: !settings.pipeline })}>
                {settings.pipeline ? 'ON' : 'OFF'}
              </button>
            </div>
            <div style={{ fontSize:9, color:'var(--text-3)', marginBottom:6, lineHeight:1.6 }}>
              Cada etapa usa su propio proveedor y API key.<br/>
              Usá 3 cuentas distintas del mismo servicio para no saturar el rate limit.
            </div>
            {(settings.pipelineStages || []).map((stage, idx) => (
              <div key={idx} className="pipeline-stage">
                <div className="pipeline-stage-label">{stageLabels[idx]}</div>
                <div className="pipeline-stage-row">
                  <select
                    className="settings-select-sm"
                    value={stage.provider}
                    onChange={e => setPipelineStage(idx, { provider: e.target.value, model: PROVIDERS[e.target.value]?.defaultModel || '' })}
                  >
                    {pipelineProviders.map(k => (
                      <option key={k} value={k}>{PROVIDERS[k]?.name || k}</option>
                    ))}
                  </select>
                  <input
                    type="password"
                    className="key-input"
                    placeholder="API Key para esta etapa…"
                    value={stage.key || ''}
                    onChange={e => setPipelineStage(idx, { key: e.target.value })}
                    style={{ flex:1 }}
                  />
                </div>
                <input
                  className="key-input key-model-input"
                  placeholder={`Modelo (default: ${PROVIDERS[stage.provider]?.defaultModel || ''})`}
                  value={stage.model || ''}
                  onChange={e => setPipelineStage(idx, { model: e.target.value })}
                />
              </div>
            ))}
          </div>

          {/* Editor */}
          <div className="settings-section">
            <div className="settings-label">Editor</div>
            <div className="settings-row">
              <span>Tamaño de fuente</span>
              <input type="number" className="settings-num" min={10} max={24} value={settings.fontSize}
                onChange={e => updateSettings({ fontSize: parseInt(e.target.value) })} />
            </div>
            <div className="settings-row">
              <span>Ajuste de línea</span>
              <select className="settings-select-sm" value={settings.wordWrap} onChange={e => updateSettings({ wordWrap: e.target.value })}>
                <option value="on">Activado</option>
                <option value="off">Desactivado</option>
              </select>
            </div>
            <div className="settings-row">
              <span>Minimapa</span>
              <button className="toggle-btn" data-on={settings.minimap} onClick={() => updateSettings({ minimap: !settings.minimap })}>
                {settings.minimap ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Ollama */}
          <div className="settings-section">
            <div className="settings-label">Ollama (local)</div>
            <input className="key-input" value={settings.ollamaUrl}
              onChange={e => updateSettings({ ollamaUrl: e.target.value })}
              placeholder="http://localhost:11434" />
          </div>

          {/* Web Server */}
          <div className="settings-section">
            <div className="settings-label">Servidor Web Local</div>
            <div className="settings-row">
              <span>Puerto</span>
              <input type="number" className="settings-num" min={1024} max={65535} value={webServerPort}
                onChange={e => updateWebServerPort(parseInt(e.target.value) || 3000)} />
            </div>
            <div className="settings-row">
              <span>Estado</span>
              <button className="toggle-btn" data-on={webServerRunning} onClick={toggleWebServer}>
                {webServerRunning ? 'ACTIVO' : 'INACTIVO'}
              </button>
            </div>
            {webServerRunning && webServerIPs.length > 0 && (
              <div style={{ fontSize:10, color:'var(--text-2)', marginTop:8 }}>
                <strong>URLs locales:</strong>
                {webServerIPs.map(ip => (
                  <div key={ip}>http://{ip}:{webServerPort}</div>
                ))}
              </div>
            )}
            <div style={{ fontSize:9, color:'var(--text-3)', marginTop:6, lineHeight:1.6 }}>
              Accedé al chat desde otros dispositivos en la misma red.<br/>
              Asegurate de que el puerto esté abierto en tu firewall.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Status Bar ───────────────────────────────────────────────────────────────
function StatusBar({ settings, chosenModel, activeTab, busy, linesCount, colNum }) {
  const prov  = settings.provider
  const pInfo = PROVIDERS[prov] || {}
  const model = settings.models?.[prov] || ''
  const displayModel = chosenModel || `${pInfo.name} · ${model.split('/').pop()}`

  return (
    <div className="statusbar">
      <div className="status-left">
        <span className="status-provider" style={{ color: pInfo.color || '#888' }}>
          {busy ? '⟳ ' : '◉ '}{displayModel}
        </span>
      </div>
      <div className="status-right">
        {activeTab && <>
          <span>{activeTab.language || 'plaintext'}</span>
          <span>Ln {linesCount}, Col {colNum}</span>
          <span>{activeTab.dirty ? '● modificado' : '✓ guardado'}</span>
        </>}
        <span>MCodeAI Pre v1.0</span>
      </div>
    </div>
  )
}

// ─── DiffModal ────────────────────────────────────────────────────────────────
function DiffModal({ pendingAction, onConfirm, onCancel }) {
  if (!pendingAction) return null
  const { action, preview, isRun } = pendingAction

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onCancel()}>
      <div className="modal" style={{ maxWidth: 700, maxHeight: '80vh' }}>
        <div className="modal-header">
          <span className="modal-title">{(isRun ? '▶' : '✎') + ' ' + action.type + ' — ' + action.filePath?.split('/').pop()}</span>
          <button className="modal-close" onClick={onCancel}>×</button>
        </div>
        <div className="modal-body" style={{ gap: 8 }}>
          <pre className="diff-preview" style={{
            background: 'var(--bg-2)', color: 'var(--text)', padding: 12, borderRadius: 4,
            fontSize: 11, lineHeight: 1.5, overflow: 'auto', maxHeight: '50vh', whiteSpace: 'pre-wrap',
            fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
          }}>{preview}</pre>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
            <button className="send-btn" style={{ background:'var(--red)', color:'#fff', border:'none', padding:'6px 16px', borderRadius:4, cursor:'pointer' }} onClick={onCancel}>Cancelar</button>
            <button className="send-btn" style={{ background:'var(--green,#4ec9b0)', color:'#fff', border:'none', padding:'6px 16px', borderRadius:4, cursor:'pointer' }} onClick={() => onConfirm(action)}>{(isRun ? 'Ejecutar' : 'Aplicar')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────
function App() {
  const { settings, updateSettings, setApiKey, setModel, setPipelineStage } = useSettings()
  const { tabs, activeTab, activeId, setActiveId, openDiskFile, saveTab, closeTab, updateContent, newTab } = useTabs()
  const { memories, remember, getRelevantMemories, clearMemories } = useMemory()

  const [rootDir,       setRootDir]     = useState(null)
  const [projectFiles,        setProjFiles]     = useState(null)
  const [projectIndex,        setProjIndex]     = useState(null)
  const [projectTools,        setProjectTools]   = useState(null)
  const [projectToolsLoading, setProjectToolsLoading] = useState(false)
  const [packageInput,        setPackageInput]   = useState('')
  const [showSettings,        setShowSettings]   = useState(false)
  const [showExtensions,      setShowExtensions]  = useState(false)
  const [showSidebar,   setShowSidebar] = useState(false)
  const [showChat,      setShowChat]    = useState(false)
  const [showTerminal,  setShowTerminal]= useState(false)
  const [bottomTab,     setBottomTab]   = useState('terminal') // 'terminal' | 'dev' | 'reverse'
  const [showBrowser,   setShowBrowser] = useState(false)  // browser tab toggle
  const [browserUrl,    setBrowserUrl]  = useState(null)
  const [showSearch,    setShowSearch]  = useState(false)
  const [searchQuery,   setSearchQuery] = useState('')
  const [replaceQuery,  setReplaceQuery]= useState('')
  const [searchMatch,   setSearchMatch] = useState(0)
  const [searchTotal,   setSearchTotal] = useState(0)
  const [searchWholeWord, setSearchWholeWord] = useState(false)
  const [searchMatchCase, setSearchMatchCase] = useState(false)
  const [searchRegex,     setSearchRegex] = useState(false)
  const [globalResults, setGlobalResults] = useState(null) // { type, results, query }
  const [globalSearchLoading, setGlobalSearchLoading] = useState(false)
  const [recentProjects, setRecentProjects] = useState(() => {
    try { return JSON.parse(window.localStorage?.getItem('recentProjects') || '[]') }
    catch { return [] }
  })
  const [webServerRunning, setWebServerRunning] = useState(false)
  const [webServerPort,   setWebServerPort] = useState(3000)
  const [webServerIPs,    setWebServerIPs] = useState([])
  const [termLines,     setTermLines]   = useState([{ type:'info', text:'MCodeAI Pre Terminal listo.' }])
  const [termBusy,      setTermBusy]    = useState(false)
  const [shellTerms,    setShellTerms]  = useState([])
  const [activeShellTerm, setActiveShellTerm] = useState(-1)
  const [changeRevision, setChangeRevision] = useState(0)
  const devLogRef = useRef([])
  /** Último destripe (markdown) para fusionar con captura DOM en cada mensaje a la IA */
  const webPageIntelRef = useRef({ destripeMarkdown: '', destripeUrl: '', destripeAt: 0 })
  /** Pestaña activa del navegador integrado — para webview-get-snapshot */
  const browserSurfaceRef = useRef({ wcId: null, url: '', title: '' })
  const markCodeChanged = useCallback(() => {
    setChangeRevision(prev => prev + 1)
  }, [])

  // Initialize monitoring system
  const onErrorRef = useRef(null)
  const { monitor, logError, logPerformance, monitorComponent } = useAppMonitor(devLogRef, onErrorRef)


  const logPreviewUiLine = useCallback((text, type = 'out') => {
    if (window.api?.devLog) window.api.devLog({ type, text })
    const arr = devLogRef.current
    arr.push({ text, time: Date.now(), type })
    if (arr.length > 80) arr.splice(0, arr.length - 80)
  }, [])

  const onIntelSignals = useCallback((report) => {
    if (!report?.unifiedSignals?.length) return
    for (const s of report.unifiedSignals) {
      if (s.severity !== 'error' && s.severity !== 'warn') continue
      const text = `[intel:${s.severity}] ${s.code}: ${s.message}`
      logPreviewUiLine(text, s.severity === 'error' ? 'err' : 'warn')
    }
  }, [logPreviewUiLine])

  const [devUrl, setDevUrl] = useState('')

  useEffect(() => {
    if (!window.api?.onDevUrl) return
    const unsub = window.api.onDevUrl((url) => { if (url) setDevUrl(url) })
    return () => unsub?.()
  }, [])

  const focusPreviewInspector = useCallback(async () => {
    let r = await window.api?.previewInjectInspector?.()
    if (!r?.ok && devUrl?.trim()) {
      await window.api?.devOpenWindow?.(devUrl.trim())
      r = await window.api?.previewInjectInspector?.()
    }
    if (r?.ok) {
      try { window.api?.devLog?.({ type: 'info', text: '[UI] Ventana Preview: tocá 🔍 en la página y elegí un elemento.' }) } catch {}
    } else {
      try {
        window.api?.devLog?.({ type: 'warn', text: '[UI] Iniciá el dev server (⌨ ▶) o abrí la URL con ↗ en el panel Dev. Opcional: 🌐 Web para el navegador integrado.' })
      } catch {}
    }
  }, [devUrl])

  const handleWebDestripe = useCallback((payload) => {
    const line = formatDestripeLogLine(payload)
    if (line) logPreviewUiLine(line, 'out')
    webPageIntelRef.current = {
      destripeMarkdown: formatDestripeMarkdown(payload),
      destripeUrl: payload.pageUrl || '',
      destripeAt: Date.now(),
    }
    try {
      window.api?.devLog?.({ type: 'info', text: '[WEB] Destripe guardado: la IA verá inventario + DOM capturado en tus próximas preguntas (📡 de nuevo tras navegar).' })
    } catch (_) {}
  }, [logPreviewUiLine])

  const onBrowserSurfaceChange = useCallback((info) => {
    browserSurfaceRef.current = {
      wcId: info?.wcId ?? null,
      url: info?.url ?? '',
      title: info?.title ?? '',
    }
  }, [])

  const collectWebPageIntel = useCallback(async () => {
    try {
      const live = await fetchLiveWebSnapshots({
        showBrowser,
        browserSurface: browserSurfaceRef.current,
      })
      const stash = webPageIntelRef.current
      const dm = stash.destripeMarkdown || ''
      const du = stash.destripeUrl || ''
      if (!live.snapshot && !dm) return null
      return {
        destripeMarkdown: dm,
        destripeUrl: du,
        snapshot: live.snapshot,
        surfaceSource: live.source,
      }
    } catch {
      return null
    }
  }, [showBrowser])

  const runDestripeFromTitlebar = useCallback(async () => {
    try {
      const r = await window.api?.previewDestripe?.()
      if (r?.ok && r.data) {
        handleWebDestripe(r.data)
        return
      }
    } catch (_) {}
    try {
      window.api?.devLog?.({ type: 'warn', text: '[WEB] Sin ventana Preview activa: abrí 🌐 Web, cargá la página y pulsá 📡 en la barra del navegador.' })
    } catch {}
    setShowBrowser(true)
  }, [handleWebDestripe])

  // Subscribe to cmd-stream for dev server output, shell terminals, and preview logs
  useEffect(() => {
    if (!window.api?.onCmdStream) return
    const unsub = window.api.onCmdStream(data => {
      if (data.termId) {
        setShellTerms(p => p.map(t =>
          t.sessionId === data.termId
            ? { ...t, lines: [...t.lines, { type: data.type, text: data.text }] }
            : t
        ))
      } else {
        if (data.text?.startsWith('[dev]')) {
          setTermLines(p => [...p, { type: data.type === 'err' ? 'err' : 'out', text: data.text }])
        }
        // Buffer para la IA: dev/preview/MONITOR, excluyendo ruido (Vite listo, CSP, red local, etc.)
        if ((data.text?.startsWith('[dev]') || data.text?.startsWith('[preview]') || data.text?.includes('[MONITOR]')) && !isMonitoringNoise(data.text)) {
          const arr = devLogRef.current
          arr.push({ text: data.text, time: Date.now(), type: data.type })
          if (arr.length > 80) arr.splice(0, arr.length - 80)
        }
      }
    })
    return () => unsub?.()
  }, [monitor, devLogRef, changeRevision])

  // ── Shell terminal management ──
  const createShellTerm = useCallback(async () => {
    if (!window.api) return
    const id = await window.api.terminalCreate({ cwd: rootDir || undefined })
    const num = shellTerms.length + 1
    setShellTerms(p => [...p, { id: `shell-${num}`, name: String(num), sessionId: id, lines: [{ type:'info', text:`Terminal ${num} lista.` }] }])
    setActiveShellTerm(shellTerms.length)
  }, [rootDir])

  const closeShellTerm = useCallback(async (idx) => {
    const term = shellTerms[idx]
    if (term && term.sessionId) {
      try { await window.api.terminalKill({ id: term.sessionId }) } catch {}
    }
    setShellTerms(p => p.filter((_, i) => i !== idx))
    setActiveShellTerm(p => Math.min(p, shellTerms.length - 2))
  }, [shellTerms])

  const runShellTerm = useCallback((idx, cmd) => {
    const term = shellTerms[idx]
    if (!term || !term.sessionId) return
    window.api.terminalStdin({ id: term.sessionId, data: cmd + '\n' }).catch(() => {})
  }, [shellTerms])
  const [chosenModel,   setChosenModel] = useState(null)
  const [cursorPos,     setCursorPos]   = useState({ line:1, col:1 })
  const [pendingAction, setPendingAction] = useState(null)
  const [showRecent, setShowRecent] = useState(false)
  const [showExp, setShowExp] = useState(false)
  const [expSearch, setExpSearch] = useState('')
  const [showTimeline, setShowTimeline] = useState(false)
  const [tlQuery, setTlQuery] = useState('')
  const [tlWindow, setTlWindow] = useState(30)
  const [tlResults, setTlResults] = useState({ events: [], startWindow: null, endWindow: null })
  const [expResults, setExpResults] = useState([])
  const appliedHashes = useRef(new Set())
  const installOffered = useRef(new Set())  // herramientas de verificacion ya ofrecidas (1 vez por sesion)
  // ── File watcher — auto-refresh on disk changes ──
  useEffect(() => {
    if (!rootDir || !window.api?.watchStart) return
    window.api.watchStart(rootDir)
    const unsub = window.api.onFileChanged((msg) => {
      if (!msg || !msg.file) return
      const ext = msg.file.split('.').pop()?.toLowerCase()
      if (!['js','jsx','ts','tsx','py','css','html','json','md','yml','yaml','toml','env'].includes(ext)) return
      // Refresh project files on change
      window.api.projectContext(rootDir).then(files => {
        if (files) setProjFiles(files)
      }).catch(() => {})
      markCodeChanged()
    })
    return () => {
      window.api.watchStop(rootDir)
      unsub?.()
    }
  }, [rootDir, markCodeChanged])

  const editorRef   = useRef(null)
  const searchInputRef = useRef(null)
  const chatSendRef = useRef(null)   // exposed by ChatPanel so browser can inject messages

  const createAppPrompt = (extra = '') =>
    `Creá una aplicación nueva desde cero y entregá todos los archivos necesarios usando el formato CREATE:ruta/archivo o WRITE:ruta/archivo. Generá la estructura completa del proyecto, incluyendo archivos de configuración. ${extra}`

  const createAppFromScratch = (extra = '') => {
    const prompt = createAppPrompt(extra)
    setShowChat(true)
    setTimeout(() => {
      chatSendRef.current?.sendMessage(prompt)
    }, 80)
  }

  // Load project files + auto-index when rootDir changes
  useEffect(() => {
    if (!rootDir || !window.api) return
    setProjIndex(null)
    window.api.projectContext(rootDir).then(async files => {
      setProjFiles(files)
      // Auto-index: build symbol map immediately (no user prompt needed)
      if (files && helperApisEnabled(settings) && settings.apiKeys?.openrouter && Object.keys(files).length > 0) {
        try {
          const { analyzeProjectRelevance } = await import('./ai.js')
          // Run a background "warm-up" so the index is ready for first question
          const idx = await analyzeProjectRelevance({
            projectFiles: files,
            userQuestion: 'Índice general del proyecto: estructura, archivos principales, entry points, dependencias',
            openrouterApiKey: settings.apiKeys.openrouter,
          })
          setProjIndex(idx)
        } catch {}
      }
    }).catch(() => {})
  }, [rootDir])

  const detectProjectTools = useCallback(async () => {
    if (!rootDir || !window.api) return null
    const exists = async (file) => await window.api.exists(joinPath(rootDir, file))
    const tools = []
    const pkgJsonPath = joinPath(rootDir, 'package.json')
    if (await exists('package.json')) {
      const pkg = await window.api.readFile(pkgJsonPath)
      try {
        const data = JSON.parse(pkg)
        const dependencies = Object.keys(data.dependencies || {})
        const devDependencies = Object.keys(data.devDependencies || {})
        let manager = 'npm'
        if (await exists('pnpm-lock.yaml')) manager = 'pnpm'
        else if (await exists('yarn.lock')) manager = 'yarn'
        else if (await exists('package-lock.json')) manager = 'npm'
        tools.push({
          title: 'Node.js',
          manager,
          installCommand: manager === 'pnpm' ? 'pnpm install' : manager === 'yarn' ? 'yarn install' : 'npm install',
          packageCommand: manager === 'pnpm' ? 'pnpm add' : manager === 'yarn' ? 'yarn add' : 'npm install',
          dependencies,
          devDependencies,
          path: 'package.json',
        })
      } catch (err) {
        tools.push({ title: 'Node.js', manager: 'npm', installCommand: 'npm install', packageCommand: 'npm install', dependencies: [], devDependencies: [], path:'package.json' })
      }
    }

    if (await exists('requirements.txt')) {
      const text = await window.api.readFile(joinPath(rootDir, 'requirements.txt'))
      tools.push({
        title: 'Python',
        manager: 'pip',
        installCommand: 'pip install -r requirements.txt',
        packageCommand: 'pip install',
        dependencies: parseRequirementsText(text),
        path: 'requirements.txt',
      })
    }

    if (await exists('pyproject.toml')) {
      const text = await window.api.readFile(joinPath(rootDir, 'pyproject.toml'))
      const { dependencies, devDependencies, optionalDependencies } = parsePyProject(text)
      const manager = await exists('poetry.lock') ? 'poetry' : 'pip'
      tools.push({
        title: 'Python',
        manager,
        installCommand: manager === 'poetry' ? 'poetry install' : 'pip install .',
        packageCommand: manager === 'poetry' ? 'poetry add' : 'pip install',
        dependencies,
        devDependencies,
        optionalDependencies,
        path: 'pyproject.toml',
      })
    }

    if (await exists('go.mod')) {
      const text = await window.api.readFile(joinPath(rootDir, 'go.mod'))
      tools.push({
        title: 'Go',
        manager: 'go',
        installCommand: 'go mod download',
        packageCommand: 'go get',
        dependencies: parseGoMod(text),
        path: 'go.mod',
      })
    }

    if (await exists('Cargo.toml')) {
      const text = await window.api.readFile(joinPath(rootDir, 'Cargo.toml'))
      const { dependencies, devDependencies } = parseCargoToml(text)
      tools.push({
        title: 'Rust',
        manager: 'cargo',
        installCommand: 'cargo fetch',
        packageCommand: 'cargo add',
        dependencies,
        devDependencies,
        path: 'Cargo.toml',
      })
    }

    if (await exists('composer.json')) {
      const text = await window.api.readFile(joinPath(rootDir, 'composer.json'))
      try {
        const data = JSON.parse(text)
        tools.push({
          title: 'PHP',
          manager: 'composer',
          installCommand: 'composer install',
          packageCommand: 'composer require',
          dependencies: Object.keys(data.require || {}),
          devDependencies: Object.keys(data['require-dev'] || {}),
          path: 'composer.json',
        })
      } catch {
        tools.push({ title: 'PHP', manager: 'composer', installCommand: 'composer install', packageCommand: 'composer require', dependencies: [], devDependencies: [], path:'composer.json' })
      }
    }

    return tools.length ? tools : null
  }, [rootDir])

  useEffect(() => {
    let cancelled = false
    setProjectToolsLoading(true)
    detectProjectTools().then(tools => {
      if (cancelled) return
      setProjectTools(tools)
    }).catch(() => { if (!cancelled) setProjectTools(null) })
      .finally(() => { if (!cancelled) setProjectToolsLoading(false) })
    return () => { cancelled = true }
  }, [detectProjectTools])

  // Check web server status on mount
  useEffect(() => {
    if (!window.api?.webServerStatus) return
    window.api.webServerStatus().then(status => {
      setWebServerRunning(status.running)
      setWebServerPort(status.port)
      setWebServerIPs(status.ips)
    }).catch(() => {})
  }, [])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = async (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault()
        if (activeTab) await saveTab(activeTab)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') { e.preventDefault(); setShowSidebar(p => !p) }
      if ((e.ctrlKey || e.metaKey) && e.key === 'j') { e.preventDefault(); setShowTerminal(p => !p) }
      if ((e.ctrlKey || e.metaKey) && e.key === 'd' && e.shiftKey) { e.preventDefault(); setShowTerminal(true); setBottomTab('reverse') }
      else if ((e.ctrlKey || e.metaKey) && e.key === 'd') { e.preventDefault(); setShowTerminal(true); setBottomTab('dev') }
      if ((e.ctrlKey || e.metaKey) && e.key === 'w') { e.preventDefault(); setShowBrowser(p => !p) }
      if ((e.ctrlKey || e.metaKey) && e.key === 'i') { e.preventDefault(); setShowChat(p => !p) }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') { e.preventDefault(); newTab() }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') { e.preventDefault(); setShowSettings(true) }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault()
        setShowSearch(true)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'h') {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [activeTab, saveTab, newTab])

  const openFolder = async () => {
    if (!window.api) return
    const dir = await window.api.openFolder()
    if (dir) {
      setRootDir(dir)
      setProjFiles(null)
      setShowSidebar(true)
      setRecentProjects(prev => {
        const next = [dir, ...prev.filter(p => p !== dir)].slice(0, 10)
        try { window.localStorage?.setItem('recentProjects', JSON.stringify(next)) } catch {}
        return next
      })
    }
  }

  const focusSearch = () => {
    setShowSearch(true)
    setTimeout(() => searchInputRef.current?.focus(), 50)
  }

  const getEditorMatches = () => {
    const editor = editorRef.current
    if (!editor || !searchQuery.trim()) return []
    const model = editor.getModel()
    if (!model) return []
    try {
      return model.findMatches(
        searchQuery,
        false,
        searchRegex,
        searchMatchCase,
        searchWholeWord,
        true,
      )
    } catch {
      return []
    }
  }

  useEffect(() => {
    if (showSearch) {
      searchInputRef.current?.focus()
      const matches = getEditorMatches()
      setSearchTotal(matches.length)
      if (matches.length === 0) setSearchMatch(0)
      else if (searchMatch >= matches.length) setSearchMatch(0)
    }
  }, [showSearch, searchQuery, searchMatchCase, searchWholeWord, searchRegex])

  const selectSearchMatch = (index) => {
    const editor = editorRef.current
    const matches = getEditorMatches()
    if (!editor || matches.length === 0) return
    const normalized = ((index % matches.length) + matches.length) % matches.length
    const range = matches[normalized].range
    editor.setSelection(range)
    editor.revealRangeInCenter(range)
    setSearchMatch(normalized)
    setSearchTotal(matches.length)
  }

  const searchNext = () => {
    const matches = getEditorMatches()
    if (matches.length === 0) return
    selectSearchMatch(searchMatch + 1)
  }

  const searchPrevious = () => {
    const matches = getEditorMatches()
    if (matches.length === 0) return
    selectSearchMatch(searchMatch - 1)
  }

  const replaceCurrent = () => {
    const editor = editorRef.current
    const matches = getEditorMatches()
    if (!editor || matches.length === 0) return
    const index = searchMatch >= 0 && searchMatch < matches.length ? searchMatch : 0
    const range = matches[index].range
    editor.executeEdits('search', [{ range, text: replaceQuery }])
    editor.pushUndoStop()
    selectSearchMatch(index)
  }

  const replaceAll = () => {
    const editor = editorRef.current
    const matches = getEditorMatches()
    if (!editor || matches.length === 0) return
    const edits = matches
      .slice()
      .reverse()
      .map(match => ({ range: match.range, text: replaceQuery }))
    editor.executeEdits('search', edits)
    editor.pushUndoStop()
    setSearchMatch(0)
    setSearchTotal(0)
  }

  const searchInAllFiles = () => {
    if (!projectFiles || !searchQuery.trim()) return
    setGlobalSearchLoading(true)
    const results = searchProjectFiles(projectFiles, searchQuery, 50, 5)
    setGlobalResults({ type: 'file', results, query: searchQuery })
    setGlobalSearchLoading(false)
  }

  const findDuplicates = () => {
    if (!projectFiles) return
    setGlobalSearchLoading(true)
    const blocks = new Map() // contentHash -> [{ file, startLine, block }]
    for (const [rel, content] of Object.entries(projectFiles)) {
      if (typeof content !== 'string' || content === '[archivo muy grande, omitido]') continue
      const lines = content.split('\n')
      for (let i = 0; i <= lines.length - 4; i++) {
        const block = lines.slice(i, i + 4)
        if (block.every(l => l.trim() === '')) continue
        const key = block.map(l => l.trim()).join('|')
        if (!blocks.has(key)) blocks.set(key, [])
        blocks.get(key).push({ file: rel, startLine: i + 1 })
      }
    }
    const duplicates = []
    for (const [, locations] of blocks) {
      if (locations.length >= 2) {
        const uniqueFiles = [...new Set(locations.map(l => l.file))]
        if (uniqueFiles.length >= 2) {
          duplicates.push({ locations })
        }
      }
    }
    duplicates.sort((a, b) => b.locations.length - a.locations.length)
    setGlobalResults({ type: 'duplicate', results: duplicates.slice(0, 50) })
    setGlobalSearchLoading(false)
  }

  const replaceInAllFiles = async () => {
    if (!projectFiles || !searchQuery.trim() || !window.api) return
    setGlobalSearchLoading(true)
    const needle = searchQuery
    const caseSensitive = searchMatchCase
    const results = []
    for (const [rel, content] of Object.entries(projectFiles)) {
      if (typeof content !== 'string') continue
      const regex = new RegExp(
        searchRegex ? needle : needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        caseSensitive ? 'g' : 'gi'
      )
      let count = 0
      const replaced = content.replace(regex, () => { count++; return replaceQuery })
      if (count > 0) {
        const fp = joinPath(rootDir, rel)
        await window.api.writeFile({ p: fp, content: replaced }).catch(() => {})
        results.push({ file: rel, count })
      }
    }
    setGlobalResults({ type: 'replace', results, query: searchQuery })
    setGlobalSearchLoading(false)
    // Refresh project files to reflect changes
    if (rootDir && window.api) {
      window.api.projectContext(rootDir).then(files => {
        if (files) setProjFiles(files)
      }).catch(() => {})
    }
    if (results.length > 0) markCodeChanged()
  }

  const openFile = async () => {
    if (!window.api) return
    const paths = await window.api.openFile()
    if (paths) paths.forEach(p => openDiskFile({ path: p, name: p.split(/[\\/]/).pop(), isDir: false }))
  }

  const openOutputDir = async () => {
    if (!window.api) return
    let dir = settings.outputDir
    if (!dir) {
      dir = await window.api.openFolder()
      if (!dir) return
      updateSettings({ outputDir: dir })
    }
    setRootDir(dir)
    setProjFiles(null)
    setShowSidebar(true)
  }

  const openPreviewInBrowser = async (filePath) => {
    if (!window.api) return
    const r = await window.api.readFile(filePath)
    if (!r.ok) return
    const dataUri = 'data:text/html;charset=utf-8,' + encodeURIComponent(r.content)
    setBrowserUrl(dataUri)
    setShowBrowser(true)
  }

  // Confirm and execute a pending action
  const confirmAction = useCallback(async (action) => {
    if (!window.api) {
      console.warn('[CONFIRM-ACTION] window.api no disponible')
      return 'window.api no disponible'
    }
    console.log(`[CONFIRM-ACTION] Ejecutando ${action.type}: ${action.filePath}`)
    const addTerm = (t, type='out') => setTermLines(p => [...p, { type, text: `${new Date().toLocaleTimeString()} ${t}` }])
    const addErr = (t) => addTerm(t, 'err')

    // Prevenir doble aplicación de la misma acción
    const hash = JSON.stringify({ fp: action.filePath, type: action.type, sl: action.startLine, el: action.endLine, c: action.content })
    if (action.type !== 'RUN' && appliedHashes.current.has(hash)) {
      addTerm(`⏭ Acción ya aplicada — ${action.filePath}`, 'info')
      return
    }

    if (action.type === 'RUN') {
      setTermBusy(true)
      setShowTerminal(true)
      addTerm(`❯ ${action.content}`, 'cmd')
      const cwd = action.filePath || rootDir || undefined
      const lines = action.content.split('\n').filter(l => l.trim())
      for (const line of lines) {
        if (!line.trim()) continue
        const r = await window.api.runCommand({ command: line, cwd })
        if (r.out) addTerm(r.out.trim(), r.ok ? 'out' : 'err')
        if (r.err && r.err !== r.out) addTerm(r.err.trim(), 'err')
      }
      setTermBusy(false)
      return
    }

    if (action.type === 'READ') {
      const normRoot = (rootDir || '').replace(/\\/g, '/')
      const normFile = (action.filePath || '').replace(/\\/g, '/')
      const fp = normRoot ? normRoot.replace(/\/$/, '') + '/' + normFile.replace(/^\//, '') : normFile
      const r = await window.api.readFile(fp)
      if (r.ok) {
        addTerm(`📖 ${action.filePath} (${r.content.split('\n').length} líneas)`, 'out')
        const lines = r.content.split('\n')
        if (action.startLine && action.endLine) {
          addTerm(lines.slice(action.startLine - 1, action.endLine).join('\n'), 'out')
        } else {
          addTerm(r.content.slice(0, 3000), 'out')
        }
      } else {
        addTerm(`✗ No se pudo leer ${action.filePath}`, 'err')
      }
      return
    }

    const normRoot = (rootDir || '').replace(/\\/g, '/')
    const normFile = (action.filePath || '').replace(/\\/g, '/')
    const fp = normRoot ? normRoot.replace(/\/$/, '') + '/' + normFile.replace(/^\//, '') : normFile

    try {
      // Save to undo history before applying (solo si el archivo existe)
      const orig = await window.api.readFile(fp)
      if (orig.ok) {
        const desc = action.type === 'PATCH' ? `PATCH ${action.filePath}:${action.startLine}-${action.endLine}` : `${action.type} ${action.filePath}`
        pushUndo(fp, orig.content, desc)
      }
      
      // Aplicar cambios
      if (action.type === 'PATCH' && action.startLine && action.endLine) {
        const newLines = action.content.split('\n')
        await window.api.writeLines({ p: fp, startLine: action.startLine, endLine: action.endLine, newLines })
      } else if (action.type === 'WRITE' || action.type === 'CREATE') {
        await window.api.writeFile({ p: fp, content: action.content })
      }
      
      markCodeChanged()
      appliedHashes.current.add(hash)
      addTerm(`✦ ${action.type} → ${action.filePath}`, 'out')
    } catch (e) {
      appliedHashes.current.add(hash)
      addErr(`✗ Error al aplicar ${action.type}: ${e.message || e}`)
      setShowTerminal(true)
      return e.message || String(e)
    }

    const rel = normFile
    const fpNorm = fp.replace(/\\/g, '/')
    const matchTab = tabs.find(t => t.filePath && (
      t.filePath.replace(/\\/g, '/').endsWith('/' + rel) ||
      t.filePath.replace(/\\/g, '/') === fpNorm
    ))
    if (matchTab) {
      const r = await window.api.readFile(fp)
      if (r.ok) updateContent(matchTab.id, r.content)
    }

    // ── Verificación automática (por archivo) ──
    // Regla: solo se dice "correcto" cuando un verificador REAL lo comprobó.
    // Si falta el verificador en esta PC, se OFRECE instalarlo (con confirmación) en vez de saltear en silencio.
    const ext = normFile.split('.').pop()?.toLowerCase()
    const isWin = typeof navigator !== 'undefined' && /Win/i.test(navigator.userAgent)
    const q = (x) => `"${x}"`
    const jsonPath = fp.replace(/\\/g, '/')
    const silenceOut = isWin ? '1>NUL' : '1>/dev/null'   // esbuild imprime el codigo transformado: no hace falta
    const checkers = {
      js:   { tool: 'node',    cmds: [`node --check ${q(fp)}`] },
      mjs:  { tool: 'node',    cmds: [`node --check ${q(fp)}`] },
      cjs:  { tool: 'node',    cmds: [`node --check ${q(fp)}`] },
      json: { tool: 'node',    cmds: [`node -e "JSON.parse(require('fs').readFileSync('${jsonPath}','utf8'))"`] },
      py:   { tool: 'python',  cmds: [`python -m py_compile ${q(fp)}`, `python3 -m py_compile ${q(fp)}`, `py -m py_compile ${q(fp)}`] },
      // JSX/TS/TSX: node no los entiende. esbuild (ya presente en proyectos Vite) los parsea de verdad.
      jsx:  { tool: 'esbuild', cmds: [`npx --no-install esbuild ${q(fp)} --log-level=error ${silenceOut}`] },
      tsx:  { tool: 'esbuild', cmds: [`npx --no-install esbuild ${q(fp)} --log-level=error ${silenceOut}`] },
      ts:   { tool: 'esbuild', cmds: [`npx --no-install esbuild ${q(fp)} --log-level=error ${silenceOut}`] },
    }
    const installable = {
      python:  { label: 'Python', why: 'verificar archivos .py',
                 cmd: isWin ? 'winget install --id Python.Python.3.12 -e --accept-source-agreements --accept-package-agreements' : null,
                 url: 'https://www.python.org/downloads/', restart: true },
      node:    { label: 'Node.js', why: 'verificar archivos .js y .json',
                 cmd: isWin ? 'winget install --id OpenJS.NodeJS.LTS -e --accept-source-agreements --accept-package-agreements' : null,
                 url: 'https://nodejs.org/', restart: true },
      esbuild: { label: 'esbuild (verificador de JSX/TS)', why: 'verificar archivos .jsx, .ts y .tsx',
                 cmd: rootDir ? 'npm install --save-dev esbuild' : null, url: null, restart: false },
    }
    const toolMissing = (t) => /no se reconoce|is not recognized|not found|no such file or directory|command not found|cannot find the file|no se encuentra el archivo|missing packages|could not determine executable|npx canceled/i.test(t)
    // recorta el stack interno de node/npx que ensucia el error real
    const cleanErr = (t) => String(t || '').split(/\n(?:node:child_process|Error: Command failed)/)[0].trim()

    const offerInstall = (key) => {
      const t = installable[key]
      if (installOffered.current.has(key)) {
        addTerm(`ℹ ${action.filePath}: sin verificar (falta ${t.label}; ya te lo ofrecí en esta sesión)`, 'info')
        return
      }
      installOffered.current.add(key)
      if (!t.cmd) {
        addTerm(`⚠ Falta ${t.label} para ${t.why}.${t.url ? ' Instalalo desde ' + t.url + ' y reiniciá MCodeAI.' : ''}`, 'err')
        return
      }
      const lines = [
        `Para ${t.why} falta ${t.label} en esta PC.`,
        '',
        'Instalarlo ahora ejecuta:',
        `  ❯ ${t.cmd}`,
        '',
        t.restart ? 'Cuando termine, reiniciá MCodeAI para que lo detecte (el PATH se actualiza al abrir de nuevo).'
                  : 'Esto agrega la dependencia a package.json y node_modules de ESTE proyecto.',
        t.url ? `Si prefirís hacerlo a mano: ${t.url}` : '',
        '',
        'Cancelar = seguir sin verificar este tipo de archivo (se informará como "sin verificar", nunca como correcto).',
      ].filter((l, i, a) => !(l === '' && a[i - 1] === ''))
      setPendingAction({ action: { type: 'RUN', filePath: rootDir || '', content: t.cmd }, preview: lines.join('\n'), isRun: true })
      addTerm(`⚠ Falta ${t.label} para ${t.why}. Revisá el diálogo para instalarlo.`, 'err')
    }

    const checker = checkers[ext]
    if (checker) {
      addTerm(`🔍 Verificando sintaxis de ${action.filePath}…`, 'info')
      setShowTerminal(true)
      let verified = false
      let missing = false
      for (const cmd of checker.cmds) {
        try {
          const r = await window.api.runCommand({ command: cmd, cwd: rootDir || undefined })
          const text = `${r.err || ''}\n${r.out || ''}`.trim()
          if (r.code === 0 || r.ok) { verified = true; break }
          if (toolMissing(text)) { missing = true; continue }   // ese intérprete no existe: probar el siguiente
          const shown = cleanErr(text)
          addTerm(`⚠ Error en ${action.filePath}:`, 'err')
          addTerm(shown, 'err')
          return shown || `Error de sintaxis en ${action.filePath}`
        } catch (e) {
          addTerm(`⚠ No se pudo ejecutar el verificador: ${e.message}`, 'err')
        }
      }
      if (verified) addTerm(`✔ Sintaxis correcta — ${action.filePath}`, 'out')
      else if (missing) offerInstall(checker.tool)
      else addTerm(`ℹ ${action.filePath}: sin verificar`, 'info')
    }
  }, [rootDir, tabs, updateContent, markCodeChanged])

  // Apply user/assistant actions directly without extra file preview
  const applyAction = useCallback(async (action) => {
    if (!window.api) return

    if (action.type === 'RUN') {
      setPendingAction({ action, preview: `Ejecutar:\n❯ ${action.content}`, isRun: true })
      return
    }

    await confirmAction(action)
    return
  }, [confirmAction])

  const applyAll = useCallback(async (actions, opts = {}) => {
    const errors = []
    for (const a of actions) {
      const err = await confirmAction(a)
      if (err) errors.push(err)
    }
    // Verificación del proyecto: solo si el proyecto define el script "verify" en package.json
    // (no se lanzan builds pesados por sorpresa). Una vez por lote, no por archivo.
    const touchedCode = actions.some(a => a.type !== 'RUN' && a.type !== 'READ' && /\.(jsx?|tsx?|mjs|cjs)$/i.test(a.filePath || ''))
    if (errors.length === 0 && touchedCode && rootDir && window.api) {
      try {
        const root = rootDir.replace(/\\/g, '/').replace(/\/$/, '')
        const pk = await window.api.readFile(root + '/package.json')
        const hasVerify = pk.ok && !!JSON.parse(pk.content || '{}')?.scripts?.verify
        if (hasVerify) {
          setShowTerminal(true)
          setTermLines(p => [...p, { type: 'info', text: `${new Date().toLocaleTimeString()} 🔍 Verificando el proyecto (npm run verify)…` }])
          const r = await window.api.runCommand({ command: 'npm run verify', cwd: rootDir })
          const text = `${r.err || ''}\n${r.out || ''}`.trim()
          if (r.code === 0 || r.ok) {
            setTermLines(p => [...p, { type: 'out', text: `${new Date().toLocaleTimeString()} ✔ Proyecto verificado` }])
          } else {
            setTermLines(p => [...p, { type: 'err', text: `${new Date().toLocaleTimeString()} ✗ npm run verify falló:\n${text.slice(-1500)}` }])
            errors.push(`npm run verify falló tras tus cambios:\n${text.slice(-1800) || '(sin salida; posible tiempo agotado)'}`)
          }
        }
      } catch (e) {
        console.warn('[VERIFY-PROJECT]', e)
      }
    }
    const errText = errors.length > 0 ? errors.join('\n\n') : ''
    if (errText) opts.onError?.(errText)
    return { ok: errors.length === 0, errors, applied: actions.length - errors.length }
  }, [confirmAction, rootDir])

  // Terminal run command
  const runCmd = async (cmd) => {
    if (!window.api) return
    const safeCmd = String(cmd || '').trim()
    if (!safeCmd) return
    setTermBusy(true)
    setTermLines(p => [...p, { type:'cmd', text: `${new Date().toLocaleTimeString()} ❯ ${safeCmd}` }])
    const r = await window.api.runCommand({ command: safeCmd, cwd: rootDir || undefined })
    if (r.out) setTermLines(p => [...p, { type:'out', text: `${new Date().toLocaleTimeString()} ${String(r.out || '').trim()}` }])
    if (r.err && r.err !== r.out) setTermLines(p => [...p, { type:'err', text: `${new Date().toLocaleTimeString()} ${String(r.err || '').trim()}` }])
    if (!r.out && !r.err) setTermLines(p => [...p, { type:'info', text: `${new Date().toLocaleTimeString()} Salió con código ${r.code}` }])
    setTermBusy(false)
  }

  const installDependencies = async (tool) => {
    if (!tool?.installCommand) return
    await runCmd(tool.installCommand)
  }

  const installPackage = async (tool) => {
    if (!tool?.packageCommand || !packageInput.trim()) return
    await runCmd(`${tool.packageCommand} ${packageInput.trim()}`)
    setPackageInput('')
  }

  const buildActiveFile = async () => {
    if (!window.api || !activeTab) return
    if (!activeTab.content.trim()) {
      setTermLines(p => [...p, { type:'info', text: 'No hay código para compilar.' }])
      return
    }

    setShowTerminal(true)
    setTermBusy(true)
    setTermLines(p => [...p, { type:'cmd', text: `🛠 Construyendo ${activeTab.name}` }])

    if (activeTab.dirty) {
      const saved = await saveTab(activeTab)
      if (!saved) {
        setTermLines(p => [...p, { type:'err', text: 'No se pudo guardar el archivo antes de build.' }])
        setTermBusy(false)
        return
      }
    }

    const r = await window.api.buildExe({
      code: activeTab.content,
      language: activeTab.language,
      filename: activeTab.filePath ? activeTab.filePath.split(/[\\/]/).pop() : activeTab.name,
    })

    if (r.ok) {
      setTermLines(p => [...p, { type:'out', text: r.out.trim() }])
      if (r.dir) setTermLines(p => [...p, { type:'info', text: `Build guardado en: ${r.dir}` }])
    } else {
      setTermLines(p => [...p, { type:'err', text: r.out || r.error || 'Build fallido' }])
    }
    setTermBusy(false)
  }

  const refreshProjectTools = () => {
    if (!rootDir) return
    detectProjectTools().then(setProjectTools).catch(() => setProjectTools(null))
  }

  const toggleWebServer = async () => {
    if (!window.api) return
    if (webServerRunning) {
      const r = await window.api.webServerStop()
      if (r.ok) {
        setWebServerRunning(false)
        setWebServerIPs([])
        setTermLines(p => [...p, { type:'info', text:'Servidor web detenido.' }])
      } else {
        setTermLines(p => [...p, { type:'err', text:`Error deteniendo servidor: ${r.error}` }])
      }
    } else {
      const r = await window.api.webServerStart(webServerPort)
      if (r.ok) {
        setWebServerRunning(true)
        setTermLines(p => [...p, { type:'info', text:`Servidor web iniciado en puerto ${r.port}.` }])
        // Update IPs
        const status = await window.api.webServerStatus()
        if (status.running) setWebServerIPs(status.ips)
      } else {
        setTermLines(p => [...p, { type:'err', text:`Error iniciando servidor: ${r.error}` }])
      }
    }
  }

  const updateWebServerPort = (newPort) => {
    setWebServerPort(newPort)
    if (webServerRunning) {
      // Restart server with new port
      toggleWebServer().then(() => {
        if (!webServerRunning) toggleWebServer()
      })
    }
  }

  const editorOptions = {
    fontSize: settings.fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    fontLigatures: true,
    minimap:       { enabled: settings.minimap },
    wordWrap:      settings.wordWrap,
    scrollBeyondLastLine: false,
    renderWhitespace: 'selection',
    smoothScrolling: true,
    cursorBlinking: 'smooth',
    cursorSmoothCaretAnimation: 'on',
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true },
    padding: { top: 12, bottom: 12 },
    lineNumbersMinChars: 3,
  }

  return (
    <div className="app">
      {/* ── Titlebar ── */}
      <div className="titlebar">
        <div className="titlebar-left">
          <div className="logo">
            <span className="logo-m">M</span>Code<span className="logo-ai">AI</span>
          </div>
          <div className="titlebar-actions">
            <button className="tb-btn" onClick={openFolder} title="Abrir carpeta (Ctrl+B)">📁 Abrir</button>
            <button className="tb-btn" onClick={openOutputDir} title={settings.outputDir||'Seleccionar carpeta de salida'}>📂 Output</button>
            <button className="tb-btn" onClick={openFile}   title="Abrir archivo">📄 Archivo</button>
            <button className="tb-btn" onClick={() => activeTab && saveTab(activeTab)} title="Guardar (Ctrl+S)" disabled={!activeTab}>💾 Guardar</button>
            <button className="tb-btn" onClick={buildActiveFile} title="Build" disabled={!activeTab || termBusy}>🛠 Construir</button>
            <button className={`tb-btn ${showSidebar?'tb-active':''}`} onClick={() => setShowSidebar(p=>!p)} title="Explorador (Ctrl+B)">⊞</button>
            <button className={`tb-btn ${showTerminal?'tb-active':''}`} onClick={() => setShowTerminal(p=>!p)} title="Terminal/Dev (Ctrl+J)">⌨</button>
            <button className={`tb-btn ${showBrowser?'tb-active':''}`}  onClick={() => setShowBrowser(p=>!p)}  title="Navegador integrado del editor (opcional). La app del dev server suele abrirse en ventana Preview aparte.">🌐 Web</button>
            <button className="tb-btn" onClick={focusPreviewInspector()} title="Inspeccionar en la ventana Preview del dev server (no hace falta abrir 🌐 Web)">🎯</button>
            <button className="tb-btn" onClick={() => runDestripeFromTitlebar()} title="Destripe web: scripts, multimedia, orígenes de red (ventana Preview; si no hay, abre 🌐 Web y usá 📡 ahí)">📡</button>
            <button className={`tb-btn ${showChat?'tb-active':''}`} onClick={() => setShowChat(p=>!p)} title="IA Chat (Ctrl+I)">◈ IA</button>
            <button className={`tb-btn ${showExtensions?'tb-active':''}`}
              onClick={() => setShowExtensions(p=>!p)}
              title="Extensiones VSIX">🧩 Ext</button>
            <button className="tb-btn" onClick={focusSearch} title="Buscar/Reemplazar (Ctrl+F)">🔎 Buscar</button>
          </div>
        </div>
        <div className="titlebar-right">
          <button className={`tb-btn ${showSettings ? 'tb-active' : ''}`} onClick={() => setShowSettings(true)} title="Configuración (Ctrl+,)">⚙</button>
        </div>
      </div>

      {/* ── Main Layout ── */}
      <div className="layout">

        {/* Sidebar */}
        {showSidebar && (
          <div className="sidebar">
            <div className="sidebar-header">
              <span className="panel-label">EXPLORADOR</span>
              {rootDir && <span className="sidebar-root">{rootDir.split(/[\\/]/).pop()}</span>}
            </div>
            <FileTree rootDir={rootDir} onOpen={openDiskFile} onOpenInBrowser={openPreviewInBrowser} activeFilePath={activeTab?.filePath} />
            {projectTools && (
              <div className="project-tools">
                <div className="project-tools-header">Herramientas de proyecto</div>
                {projectTools.map((tool, idx) => (
                  <div key={idx} className="project-tool-card">
                    <div className="project-tool-title">{tool.title} · {tool.manager}</div>
                    <div className="project-tool-path">{tool.path}</div>
                    <div className="project-tool-actions">
                      <button className="sb-btn" onClick={() => installDependencies(tool)} disabled={termBusy}>Instalar</button>
                      <button className="sb-btn" onClick={() => installPackage(tool)} disabled={termBusy || !packageInput.trim()}>Instalar paquete</button>
                    </div>
                    <div className="project-tool-input">
                      <input
                        value={packageInput}
                        onChange={e => setPackageInput(e.target.value)}
                        placeholder={`Ej: ${tool.manager === 'pip' ? 'requests' : tool.manager === 'composer' ? 'monolog/monolog' : 'lodash'}`}
                      />
                    </div>
                    {(tool.dependencies?.length > 0 || tool.devDependencies?.length > 0) && (
                      <div className="project-tool-list">
                        {tool.dependencies?.length > 0 && (
                          <div><strong>Dependencias:</strong> {tool.dependencies.slice(0, 10).join(', ')}{tool.dependencies.length > 10 ? '…' : ''}</div>
                        )}
                        {tool.devDependencies?.length > 0 && (
                          <div><strong>Dev:</strong> {tool.devDependencies.slice(0, 10).join(', ')}{tool.devDependencies.length > 10 ? '…' : ''}</div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                <button className="sb-btn" onClick={refreshProjectTools} title="Detectar nuevamente">Actualizar detección</button>
              </div>
            )}
            {rootDir && !projectTools && (
              <div className="project-tools project-tools-empty">
                <div className="project-tools-header">Herramientas de proyecto</div>
                <div className="project-tools-empty-text">
                  {projectToolsLoading ? 'Detectando herramientas de proyecto…' : 'No se detectaron manifiestos de dependencias en este proyecto.'}
                </div>
                <button className="sb-btn" onClick={refreshProjectTools} disabled={projectToolsLoading} title="Detectar nuevamente">Actualizar detección</button>
              </div>
            )}
            {/* Project Dashboard */}
            {rootDir && projectFiles && (
              <div className="project-dashboard">
                <div className="project-tools-header">Dashboard</div>
                <div className="dashboard-grid">
                  <div className="dashboard-item">
                    <span className="dashboard-num">{Object.keys(projectFiles).length}</span>
                    <span className="dashboard-label">Archivos</span>
                  </div>
                  <div className="dashboard-item">
                    <span className="dashboard-num">{projectTools ? projectTools.reduce((s, t) => s + (t.dependencies?.length || 0) + (t.devDependencies?.length || 0), 0) : '?'}</span>
                    <span className="dashboard-label">Dependencias</span>
                  </div>
                  <div className="dashboard-item">
                    <span className="dashboard-num">{projectTools?.length || 0}</span>
                    <span className="dashboard-label">Lenguajes</span>
                  </div>
                  <div className="dashboard-item">
                    <span className="dashboard-num">{undoHistory.length}</span>
                    <span className="dashboard-label">Undos</span>
                  </div>
                  <div className="dashboard-item" style={{ cursor:'pointer' }} onClick={() => setShowExp(p => !p)}>
                    <span className="dashboard-num">{getExperienceStats().total}</span>
                    <span className="dashboard-label">Experiencia</span>
                  </div>
                  <div className="dashboard-item" style={{ cursor:'pointer' }} onClick={() => setShowTimeline(p => !p)}>
                    <span className="dashboard-num">🕐</span>
                    <span className="dashboard-label">Timeline</span>
                  </div>
                </div>
              </div>
            )}

            {/* Experience Panel */}
            {showExp && (
              <div className="project-dashboard" style={{ borderTop:'none' }}>
                <div className="project-tools-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>🧠 Experiencia</span>
                  <button className="sb-btn" style={{ fontSize:8, padding:'1px 6px' }} onClick={() => setShowExp(false)}>×</button>
                </div>
                <div style={{ display:'flex', gap:4, margin:'4px 0' }}>
                  <input className="chat-search-input" style={{ flex:1 }} value={expSearch}
                    onChange={e => { setExpSearch(e.target.value); setExpResults(searchExperience(e.target.value, 5)) }}
                    placeholder="Buscar en experiencia…" />
                </div>
                {expResults.length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:4, marginTop:4 }}>
                    {expResults.map((e, i) => (
                      <div key={e.id || i} className="exp-card">
                        <div className="exp-card-type">{e.type}</div>
                        <div className="exp-card-context">{e.context.slice(0, 80)}</div>
                        <div className="exp-card-solution">{e.solution.slice(0, 100)}</div>
                        {e.tags?.length > 0 && (
                          <div className="exp-card-tags">{e.tags.map(t => <span key={t} className="exp-tag">{t}</span>)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Timeline Panel */}
            {showTimeline && (
              <div className="project-dashboard" style={{ borderTop:'none' }}>
                <div className="project-tools-header" style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <span>🕐 Timeline</span>
                  <button className="sb-btn" style={{ fontSize:8, padding:'1px 6px' }} onClick={() => setShowTimeline(false)}>×</button>
                </div>
                <div style={{ display:'flex', gap:4, margin:'4px 0' }}>
                  <input className="chat-search-input" style={{ flex:1 }} value={tlQuery}
                    onChange={e => setTlQuery(e.target.value)}
                    placeholder="Ej: 21:00, hace 1 hora, ayer…" />
                  <input type="number" style={{ width:50, fontSize:10 }} value={tlWindow}
                    onChange={e => setTlWindow(Number(e.target.value))} title="Ventana (min)" />
                  <button className="sb-btn" style={{ fontSize:10, padding:'1px 6px' }}
                    onClick={() => setTlResults(getTimeline(tlQuery, tlWindow))}>
                    Buscar
                  </button>
                </div>
                {tlResults.events.length > 0 && (
                  <div style={{ display:'flex', flexDirection:'column', gap:2, marginTop:4, fontSize:11 }}>
                    <div style={{ color:'#888', marginBottom:4 }}>
                      {tlResults.startWindow && (
                        <>Ventana: {tlResults.startWindow.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })} → {tlResults.endWindow.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })}
                        <br/>{tlResults.events.length} evento(s)</>
                      )}
                    </div>
                    {tlResults.events.map((ev, i) => (
                      <div key={i} className="exp-card" style={{ fontSize:10, lineHeight:1.3 }}>
                        <div className="exp-card-type" style={{ display:'flex', gap:4, alignItems:'center' }}>
                          <span>{ev.type === 'experience' ? '🧠' : '✏'}</span>
                          <span>{ev.type === 'experience' ? 'Experiencia' : 'Cambio'}</span>
                          <span style={{ marginLeft:'auto', color:'#888' }}>{ev.time.toLocaleTimeString('es-AR', { hour:'2-digit', minute:'2-digit' })}</span>
                        </div>
                        <div className="exp-card-context">{ev.desc}</div>
                        <div className="exp-card-solution">{ev.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
                {tlQuery && tlResults.events.length === 0 && (
                  <div style={{ color:'#888', fontSize:11, marginTop:4 }}>Sin eventos cerca de esa hora</div>
                )}
              </div>
            )}

            {rootDir && (
              <div className="sidebar-footer">
                <button className="sb-btn" onClick={() => newTab('nuevo.js')} title="Nuevo archivo">+ Archivo</button>
                <button className="sb-btn" onClick={() => createAppFromScratch()} title="Scaffold proyecto con IA">✨ App IA</button>
                <button className="sb-btn" onClick={async () => {
                  const u = devUrl?.trim()
                  if (!u) {
                    try { window.api?.devLog?.({ type: 'warn', text: '[UI] Iniciá el servidor en ⌨ Dev (▶). La URL se detecta sola y se abre la ventana Preview.' }) } catch {}
                    setShowTerminal(true)
                    setShowSidebar(false)
                    return
                  }
                  await window.api?.devOpenWindow?.(u)
                  setShowSidebar(false)
                }} title="Abrir o enfocar la app en la ventana Preview (la del dev log), no el navegador integrado">🌐 UI app</button>
                <button className="sb-btn" onClick={() => clearMemories(rootDir)} title="Limpiar memoria del proyecto">⊗ Memoria</button>
                <button className="sb-btn" onClick={() => setShowRecent(s => !s)} title="Proyectos recientes">🕐 Recientes</button>
              </div>
            )}
            {showRecent && (
              <div className="recent-projects-dropdown">
                {recentProjects.length > 0 ? (
                  recentProjects.map((p, i) => (
                    <button key={i} className="recent-project-item" onClick={() => { setRootDir(p); setProjFiles(null); setShowSidebar(true); setShowRecent(false) }}>
                      {p.split(/[\\/]/).pop()} <span className="recent-project-path">{p}</span>
                    </button>
                  ))
                ) : (
                  <div className="recent-project-empty">Abrí una carpeta (📁 Abrir) para guardarla acá</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Editor area */}
        <div className="editor-area">
          <TabBar tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} onNew={() => newTab()} />

          {showSearch && !showBrowser && (
            <div className="search-panel">
              <div className="search-row">
                <input
                  ref={searchInputRef}
                  className="search-input"
                  value={searchQuery}
                  onChange={e => { setSearchQuery(e.target.value); setSearchMatch(0); setSearchTotal(0) }}
                  placeholder="Buscar..."
                  onKeyDown={e => { if (e.key === 'Enter') searchNext() }}
                />
                <input
                  className="search-input"
                  value={replaceQuery}
                  onChange={e => setReplaceQuery(e.target.value)}
                  placeholder="Reemplazar con..."
                  onKeyDown={e => { if (e.key === 'Enter') replaceCurrent() }}
                />
                <button className="search-btn" onClick={() => { searchNext(); setSearchTotal(getEditorMatches().length) }} title="Buscar siguiente">Siguiente</button>
                <button className="search-btn" onClick={searchPrevious} title="Buscar anterior">Anterior</button>
                <button className="search-btn" onClick={replaceCurrent} title="Reemplazar actual">Reemplazar</button>
                <button className="search-btn" onClick={replaceAll} title="Reemplazar todo">Reemplazar todo</button>
                <button className="search-btn" onClick={() => setShowSearch(false)} title="Cerrar búsqueda">Cerrar</button>
              </div>
              <div className="search-meta">
                <span>{searchTotal > 0 ? `${searchMatch + 1}/${searchTotal}` : '0/0'} resultados</span>
                <label><input type="checkbox" checked={searchMatchCase} onChange={e => setSearchMatchCase(e.target.checked)} /> Match case</label>
                <label><input type="checkbox" checked={searchWholeWord} onChange={e => setSearchWholeWord(e.target.checked)} /> Palabra completa</label>
                <label><input type="checkbox" checked={searchRegex} onChange={e => setSearchRegex(e.target.checked)} /> Regex</label>
              </div>
              {rootDir && projectFiles && (
                <div className="search-row" style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                  <button className="search-btn" onClick={searchInAllFiles} disabled={globalSearchLoading} title="Buscar en todo el proyecto">📁 En contenidos</button>
                  <button className="search-btn" onClick={findDuplicates} disabled={globalSearchLoading} title="Buscar bloques duplicados entre archivos">📑 Duplicados</button>
                  <button className="search-btn" onClick={replaceInAllFiles} disabled={globalSearchLoading || !replaceQuery} title="Reemplazar en todos los archivos">🔄 Reemplazar en archivos</button>
                  {globalSearchLoading && <span className="search-loading">Buscando…</span>}
                </div>
              )}
              {globalResults && (
                <div className="search-results">
                  {globalResults.type === 'file' && (
                    <div className="search-results-list">
                      {globalResults.results.length === 0 && <div className="search-result-empty">Sin resultados en el proyecto</div>}
                      {globalResults.results.map((r, i) => (
                        <div key={i} className="search-result-item" onClick={() => { const fp = joinPath(rootDir, r.file); openDiskFile({ path: fp, name: r.file.split('/').pop() || r.file.split('\\').pop(), isDir: false }) }}>
                          <div className="search-result-file">{r.file}</div>
                          {r.matches?.map((m, j) => (
                            <pre key={j} className="search-result-preview">{m.preview}</pre>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {globalResults.type === 'duplicate' && (
                    <div className="search-results-list">
                      {globalResults.results.length === 0 && <div className="search-result-empty">Sin bloques duplicados</div>}
                      {globalResults.results.map((r, i) => (
                        <div key={i} className="search-result-item">
                          {r.locations.map((loc, j) => (
                            <div key={j} className="search-result-file" onClick={() => { const fp = joinPath(rootDir, loc.file); openDiskFile({ path: fp, name: loc.file.split('/').pop() || loc.file.split('\\').pop(), isDir: false }) }}>
                              {loc.file}:{loc.startLine}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                  {globalResults.type === 'replace' && (
                    <div className="search-results-list">
                      {globalResults.results.length === 0 && <div className="search-result-empty">Sin reemplazos</div>}
                      {globalResults.results.map((r, i) => (
                        <div key={i} className="search-result-item">
                          <div className="search-result-file">{r.file}</div>
                          <div className="search-result-meta">{r.count} reemplazo(s)</div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="search-btn" onClick={() => setGlobalResults(null)} style={{ marginTop: 4 }}>Limpiar resultados</button>
                </div>
              )}
            </div>
          )}

          <div style={{ position: 'relative', flex: 1, overflow: 'hidden', minHeight: 0 }}>
            {/* Browser — always mounted, hidden via CSS when not active */}
            <div className="editor-area-browser" style={{ display: showBrowser ? 'flex' : 'none', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: showBrowser ? 10 : -1, pointerEvents: showBrowser ? 'auto' : 'none' }}>
              <BrowserTab
                devUrl={devUrl}
                previewUrl={browserUrl}
                isVisible={showBrowser}
                onPreviewUiLog={logPreviewUiLine}
                onOpenFolder={openFolder}
                onOpenOutputDir={openOutputDir}
                onSendToChat={(text) => {
                  chatSendRef.current?.sendMessage(text)
                  setShowChat(true)
                }}
                onScreenshotToChat={(dataUrl, name) => {
                  chatSendRef.current?.sendImage(dataUrl, name)
                  setShowChat(true)
                }}
                onWebDestripe={handleWebDestripe}
                onBrowserSurfaceChange={onBrowserSurfaceChange}
                onInspectResult={(info) => {
                  let msg = `🔍 **Elemento en la app en ejecución** (ventana Preview o 🌐 Web)\n\n`
                  if (info.pageUrl) msg += `**URL:** ${info.pageUrl}\n`
                  msg += `**Componente:** ${info.name}\n`
                  msg += `**Tag:** \`<${info.tag}>\``
                  if (info.id) msg += `\n**ID:** \`#${info.id}\``
                  if (info.classes) msg += `\n**Clases:** \`.${String(info.classes).replace(/ /g, '.')}\``
                  if (info.framework) msg += `\n**Framework:** ${info.framework}`
                  if (info.stack && info.stack.length > 1) msg += `\n**Jerarquía:** ${info.stack.join(' > ')}`
                  if (info.attrs) {
                    const entries = Object.entries(info.attrs).slice(0, 8)
                    if (entries.length) msg += `\n**Atributos:** ${entries.map(([k, v]) => `\`${k}="${v}"\``).join(', ')}`
                  }
                  msg += `\n\n_Registrado desde la ventana Preview o el navegador integrado. Buscá este componente en el código del proyecto._`
                  chatSendRef.current?.sendMessage(msg)
                  setShowChat(true)
                }}
              />
            </div>

            {/* Editor + Terminal — always mounted, hidden via CSS when browser active */}
            <div className="editor-area-editor" style={{ display: showBrowser ? 'none' : 'flex', position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: showBrowser ? -1 : 10, pointerEvents: showBrowser ? 'none' : 'auto' }}>
            {activeTab ? (
              <div style={{ flex:1, minHeight:0, overflow:'hidden', display:'flex', flexDirection:'column', position:'relative' }}>
                <div className="editor-toolbar">
                  {activeTab && /\.html?$/i.test(activeTab.name) && activeTab.filePath && (
                    <button className="editor-tb-btn" onClick={() => openPreviewInBrowser(activeTab.filePath)} title="Previsualizar en navegador">🌐 Preview</button>
                  )}
                  <button className="editor-tb-btn" onClick={() => {
                    const ed = editorRef.current
                    if (!ed) return
                    const sel = ed.getSelection()
                    const model = ed.getModel()
                    if (!model || sel?.isEmpty()) {
                      chatSendRef.current?.sendMessage('Explicá este archivo:\n```' + (activeTab.language || '') + '\n' + (activeTab.content || '').slice(0, 3000) + '\n```')
                    } else {
                      const text = model.getValueInRange(sel)
                      chatSendRef.current?.sendMessage('Explicá este código:\n```' + (activeTab.language || '') + '\n' + text + '\n```')
                    }
                    setShowChat(true)
                  }} title="Explicar código seleccionado">🔍 Explicar</button>
                </div>
                <Editor
                  activeTab={activeTab}
                  editorRef={editorRef}
                  options={editorOptions}
                  onChange={(val) => {
                    if (val !== undefined) updateContent(activeTab.id, val)
                  }}
                  onMount={(editor, monaco) => {
                    editorRef.current = editor
                    editor.onDidChangeCursorPosition(e => {
                      setCursorPos({ line: e.position.lineNumber, col: e.position.column })
                    })
                    setTimeout(() => editor.layout(), 50)
                    setTimeout(() => editor.layout(), 200)
                  }}
                />
              </div>
            ) : (
              <div className="editor-welcome">
                <div className="welcome-logo">
                  <span className="logo-m">M</span>Code<span className="logo-ai">AI</span>
                </div>
                <div className="welcome-sub">Editor de código con IA · MC SERVICES</div>
                <div className="welcome-actions">
                  <button className="welcome-btn" onClick={openFolder}>📁 Abrir carpeta</button>
                  <button className="welcome-btn" onClick={openFile}>📄 Abrir archivo</button>
                  <button className="welcome-btn" onClick={() => newTab()}>+ Nuevo archivo</button>
                  <button className="welcome-btn" onClick={() => createAppFromScratch()}>✨ Crear app IA</button>
                  <button className="welcome-btn" onClick={() => setShowSettings(true)}>⚙ Configurar IA</button>
                </div>
                {recentProjects.length > 0 && (
                  <div className="welcome-recent">
                    <div className="welcome-recent-title">Proyectos recientes</div>
                    {recentProjects.map((p, i) => (
                      <button key={i} className="welcome-recent-item" onClick={() => { setRootDir(p); setProjFiles(null); setShowSidebar(true) }}>
                        {p.split(/[\\/]/).pop()} <span className="welcome-recent-path">{p}</span>
                      </button>
                    ))}
                  </div>
                )}
                <div className="welcome-shortcuts">
                  <span>Ctrl+S guardar</span>
                  <span>Ctrl+B explorador</span>
                  <span>Ctrl+J terminal/dev</span>
                  <span>Ctrl+D dev · Ctrl+Shift+D intel</span>
                  <span>Ctrl+I chat IA</span>
                  <span>Ctrl+, config</span>
                </div>
              </div>
            )}

            {/* Bottom panel: Terminal + Dev Logs */}
            {showTerminal && (
              <div className="bottom-panel">
                <div className="bottom-panel-tabs">
                  <button className={`bottom-panel-tab ${bottomTab === 'terminal' ? 'active' : ''}`}
                    onClick={() => setBottomTab('terminal')}>
                    ⌨ TERMINAL
                  </button>
                  <button className={`bottom-panel-tab ${bottomTab === 'dev' ? 'active' : ''}`}
                    onClick={() => setBottomTab('dev')}>
                    🛠 DEV LOGS
                  </button>
                  <button className={`bottom-panel-tab ${bottomTab === 'reverse' ? 'active' : ''}`}
                    onClick={() => setBottomTab('reverse')}
                    title="Análisis estático del proyecto (Ctrl+Shift+D)">
                    🔬 INTEL
                  </button>
                </div>
                {bottomTab === 'terminal' ? (
                  <TerminalPanel
                    lines={termLines}
                    onRun={runCmd}
                    busy={termBusy}
                    cwd={rootDir}
                    onClear={() => setTermLines([])}
                    shellTerms={shellTerms}
                    activeShellTerm={activeShellTerm}
                    onTermSelect={setActiveShellTerm}
                    onNewTerm={createShellTerm}
                    onCloseTerm={closeShellTerm}
                    onRunShell={runShellTerm}
                  />
                ) : bottomTab === 'dev' ? (
                  <DevPanel cwd={rootDir} changeRevision={changeRevision} />
                ) : (
                  <ReverseIntelPanel
                    rootDir={rootDir}
                    settings={settings}
                    changeRevision={changeRevision}
                    onIntelSignals={onIntelSignals}
                    onSendToChat={(text) => {
                      chatSendRef.current?.sendMessage(text)
                      setShowChat(true)
                    }}
                  />
                )}
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Chat — always mounted, hidden via CSS to preserve state */}
        <div className={`chat-wrapper ${showChat ? '' : 'chat-wrapper-hidden'}`}>
          <ChatPanel
            settings={settings}
            updateSettings={updateSettings}
            setPipelineStage={setPipelineStage}
            tabs={tabs}
            activeTab={activeTab}
            rootDir={rootDir}
            projectFiles={projectFiles}
            projectIndex={projectIndex}
            memories={memories}
            getRelevantMemories={getRelevantMemories}
            remember={remember}
            onApplyAction={applyAction}
            onApplyAll={applyAll}
            chosenModel={chosenModel}
            setChosenModel={setChosenModel}
            sendRef={chatSendRef}
            devLogs={devLogRef.current}
            collectWebPageIntel={collectWebPageIntel}
          />
        </div>

        {/* Extension panel */}
        <div className={`ext-panel ${showExtensions ? '' : 'ext-panel-hidden'}`}>
          <ExtensionManager onClose={() => setShowExtensions(false)} />
        </div>
      </div>

      {/* Status bar */}
      <StatusBar
        settings={settings}
        chosenModel={chosenModel}
        activeTab={activeTab}
        busy={termBusy}
        linesCount={cursorPos.line}
        colNum={cursorPos.col}
      />

      {showSettings && (
        <SettingsModal
          settings={settings}
          updateSettings={updateSettings}
          setApiKey={setApiKey}
          setModel={setModel}
          setPipelineStage={setPipelineStage}
          onClose={() => setShowSettings(false)}
          webServerPort={webServerPort}
          webServerRunning={webServerRunning}
          webServerIPs={webServerIPs}
          toggleWebServer={toggleWebServer}
          updateWebServerPort={updateWebServerPort}
        />
      )}

      <DiffModal
        pendingAction={pendingAction}
        onConfirm={async (action) => { setPendingAction(null); const _err = await confirmAction(action); if (_err) setMsgs(p => [...p, { role:'assistant', content:'⚠️ Error de verificación en ' + action.type + ' ' + (action.filePath || '') + ':\n```\n' + _err.slice(0, 2000) + '\n```', _id: nextMsgId() }]) }}
        onCancel={() => setPendingAction(null)}
      />
    </div>
  )
}

// ─── Main App with Monitoring ─────────────────────────────────────────────────
function AppWithMonitoring() {
  return <App />
}

export default AppWithMonitoring

// ─── Named Exports for Monitoring ─────────────────────────────────────────────
export { withMonitoring, MonitorContext }
