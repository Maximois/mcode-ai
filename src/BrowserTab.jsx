import React, { useRef, useState, useEffect, useCallback } from 'react'
import { setScreenshotHandler } from './ai.js'
import { INSPECTOR_FLOATING } from '../electron/previewInspectorScript.mjs'
import { PAGE_DESTRIPE } from '../electron/pageDestripeScript.mjs'

const HOME_URL = 'about:blank'

const BOOKMARKS = [
  { label: 'MDN',        url: 'https://developer.mozilla.org' },
  { label: 'Can I Use',  url: 'https://caniuse.com' },
  { label: 'npm',        url: 'https://npmjs.com' },
  { label: 'GitHub',     url: 'https://github.com' },
  { label: 'StackOverflow', url: 'https://stackoverflow.com' },
  { label: 'DevDocs',    url: 'https://devdocs.io' },
]

let tabIdCounter = 1
function nextTabId() { return tabIdCounter++ }

/** localhost / 127.0.0.1 — típico app dev lanzada desde el editor */
function isDevPreviewUrl(url) {
  if (!url || url === 'about:blank') return false
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const h = u.hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0'
  } catch {
    return false
  }
}

function formatPreviewInspectLog(info) {
  const parts = [
    '[UI] preview',
    info.pageUrl ? `url=${info.pageUrl}` : '',
    info.name ? `component=${info.name}` : '',
    info.tag ? `tag=<${info.tag}>` : '',
    info.framework ? `fw=${info.framework}` : '',
    Array.isArray(info.stack) && info.stack.length ? `stack=${info.stack.slice(0, 6).join('>')}` : '',
    info.x != null && info.y != null ? `xy=${Math.round(info.x)},${Math.round(info.y)}` : '',
    info.id ? `id=#${info.id}` : '',
    info.classes ? `class=${String(info.classes).slice(0, 100)}` : '',
  ].filter(Boolean)
  return parts.join(' ')
}

function createTab() {
  const id = nextTabId()
  return { id, url: HOME_URL, input: '', title: 'Nueva pestaña', loading: false, canBack: false, canFwd: false }
}

// ─── URL bridge for apps with internal webviews ────────────────────
// Detects <webview> elements in loaded pages, intercepts URL bar Enter,
// and reports diagnostics back to the editor.
const URL_BRIDGE = `
(function(){
  if (window.__mcapUrlBridge) return
  window.__mcapUrlBridge = true

  // Report webview elements found inside the page
  var wvs = document.querySelectorAll('webview')
  if (wvs.length > 0) {
    console.log('__MCAP_DIAG__' + JSON.stringify({
      type: 'webview-found',
      count: wvs.length,
      msg: 'Esta p\u00E1gina contiene ' + wvs.length + ' webview(s). Los webviews anidados no funcionan en Electron. Las URLs se redirigir\u00E1n a una pesta\u00F1a nativa.'
    }))
  }

  // Add a small diagnostic badge to the page
  var badge = document.createElement('div')
  badge.id = '__mcap_diag'
  badge.style.cssText = 'position:fixed;top:4px;right:4px;z-index:2147483647;background:rgba(255,200,0,.9);color:#000;font:9px/14px monospace;padding:2px 6px;border-radius:3px;cursor:pointer;display:none;box-shadow:0 1px 4px rgba(0,0,0,.3)'
  badge.textContent = 'WEBVIEW'
  badge.title = 'Webviews redirigidos a pesta\u00F1as nativas del editor'
  document.body.appendChild(badge)

  function hook() {
    var input = document.querySelector('input.nav-url')
    if (!input) return false
    input.addEventListener('keydown', function(e) {
      if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation()
        var url = input.value.trim()
        if (url) {
          console.log('__MCAP_TAB__' + url)
          if (wvs.length > 0) badge.style.display = 'block'
        }
      }
    }, true)
    return true
  }

  if (hook()) {
    if (wvs.length > 0) {
      badge.style.display = 'block'
      setTimeout(function() { badge.style.display = 'none' }, 4000)
    }
    return
  }
  var obs = new MutationObserver(function() { if (hook()) obs.disconnect() })
  obs.observe(document.body, {childList:true,subtree:true})
  setTimeout(function() { obs.disconnect(); hook() }, 5000)
})()
`

// ─── BrowserTab component ──────────────────────────────────────────────
function BrowserTab({ onSendToChat, onScreenshotToChat, isVisible, onInspectResult, onPreviewUiLog, devUrl, onWebDestripe, onBrowserSurfaceChange, previewUrl, onOpenFolder, onOpenOutputDir }) {
  const [tabs, setTabs] = useState(() => [createTab()])
  const [activeId, setActiveId] = useState(1)
  const webviewRefs = useRef({})
  const wiredTabs = useRef(new Set())
  const activeTab = tabs.find(t => t.id === activeId) || tabs[0]

  const [bookmarks, setBookmarks] = useState(() => {
    try { return JSON.parse(window.localStorage?.getItem('browserBookmarks')) || BOOKMARKS } catch { return BOOKMARKS }
  })
  const [showHistory, setShowHistory] = useState(false)
  const [popupsBlocked, setPopupsBlocked] = useState(true)
  const popupsBlockedRef = useRef(popupsBlocked)
  popupsBlockedRef.current = popupsBlocked
  const [historyEntries, setHistoryEntries] = useState(() => {
    try { return JSON.parse(window.localStorage?.getItem('browserHistory')) || [] } catch { return [] }
  })

  // Creates a new tab for intercepted URLs (from URL_BRIDGE, devPanel ↗, Ctrl+Enter)
  const addTabAndNavigateRef = useRef(null)
  addTabAndNavigateRef.current = (url) => {
    const tab = createTab()
    setTabs(prev => [...prev, tab])
    setActiveId(tab.id)
    const tid = tab.id
    const tryNav = (attempt = 0) => {
      const nav = navigateRef.current
      if (nav && webviewRefs.current[tid]) {
        nav(url, tid)
      } else if (attempt < 5) {
        setTimeout(() => tryNav(attempt + 1), 200)
      }
    }
    setTimeout(() => tryNav(), 100)
  }

  const navigateRef = useRef(null)
  const updateTab = useCallback((id, patch) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])

  // ── Navigate ──────────────────────────────────────────────────────────
  const navigate = useCallback((target, tabId) => {
    const tid = tabId || activeId
    const wv = webviewRefs.current[tid]
    if (!wv) return
    let href = (target || '').trim()
    if (!href) return
    if (!href.startsWith('http') && !href.startsWith('file:') && !href.startsWith('about:') && !href.startsWith('data:')) {
      const looksLikeUrl = /^[\w-]+\.[\w-]/.test(href) && !href.includes(' ')
      href = looksLikeUrl ? 'https://' + href : `https://www.google.com/search?q=${encodeURIComponent(href)}`
    }
    updateTab(tid, { url: href, input: href })
    try { wv.loadURL(href) } catch (e) { console.warn('loadURL error:', e.message) }
  }, [activeId, updateTab])
  navigateRef.current = navigate

  // ── Navigate when devUrl prop changes ──────────────────────────────
  // Creates ONE preview tab and reuses it on subsequent URL changes.
  const previewTabIdRef = useRef(null)
  const lastDevUrlRef = useRef('')
  useEffect(() => {
    if (!devUrl || devUrl === lastDevUrlRef.current) return
    lastDevUrlRef.current = devUrl

    if (previewTabIdRef.current && tabs.some(t => t.id === previewTabIdRef.current)) {
      setActiveId(previewTabIdRef.current)
      const nav = navigateRef.current
      if (nav) nav(devUrl, previewTabIdRef.current)
      return
    }

    const tab = createTab()
    previewTabIdRef.current = tab.id
    setTabs(prev => [...prev, tab])
    setActiveId(tab.id)
    const tid = tab.id
    const tryNav = (attempt = 0) => {
      const nav = navigateRef.current
      if (nav && webviewRefs.current[tid]) {
        nav(devUrl, tid)
      } else if (attempt < 5) {
        setTimeout(() => tryNav(attempt + 1), 200)
      }
    }
    setTimeout(() => tryNav(), 100)
  }, [devUrl])

  // Navigate when previewUrl prop changes (from external preview request)
  useEffect(() => {
    if (!previewUrl) return
    const nav = navigateRef.current
    if (nav) nav(previewUrl, activeId)
  }, [previewUrl, activeId])

  useEffect(() => {
    if (!onBrowserSurfaceChange) return
    onBrowserSurfaceChange({
      wcId: activeTab?.wcId ?? null,
      url: activeTab?.url ?? '',
      title: activeTab?.title ?? '',
    })
  }, [onBrowserSurfaceChange, activeTab?.wcId, activeTab?.url, activeTab?.title])

  // ── Listen for manual "open in new tab" from DevPanel ────────────
  useEffect(() => {
    const handler = (e) => addTabAndNavigateRef.current?.(e.detail)
    window.addEventListener('dev-open-newtab', handler)
    return () => window.removeEventListener('dev-open-newtab', handler)
  }, [])

  // ── Set screenshot handler for [TOOL: screenshot] ────────────────
  useEffect(() => {
    setScreenshotHandler(async () => {
      const wv = webviewRefs.current[activeId]
      if (!wv || !activeTab?.wcId || !window.api?.webviewCapture) return { ok: false, error: 'No hay webview activo para capturar' }
      const r = await window.api.webviewCapture(activeTab.wcId)
      if (!r?.ok) return { ok: false, error: 'Error al capturar' }
      // Also send to chat for vision analysis
      const name = `Captura de ${activeTab.title || 'página'}`
      onScreenshotToChat?.(r.dataUrl, name)
      return { ok: true, dataUrl: r.dataUrl, width: r.width || 0, height: r.height || 0, size: r.size || 0 }
    })
  }, [activeId, activeTab, onScreenshotToChat])

  // ── Wire webview events ──────────────────────────────────────────────
  const wireWebview = useCallback((el, tabId) => {
    if (!el || wiredTabs.current.has(tabId)) return
    wiredTabs.current.add(tabId)

    const onDidNav = (e) => {
      if (!e.isMainFrame) return
      updateTab(tabId, { url: e.url, input: e.url, canBack: el.canGoBack(), canFwd: el.canGoForward() })
      if (e.url && e.url !== HOME_URL) {
        setHistoryEntries(prev => {
          if (prev.length && prev[prev.length - 1].url === e.url) return prev
          return [...prev, { label: e.url, url: e.url }].slice(-200)
        })
      }
      if (isDevPreviewUrl(e.url)) {
        el.executeJavaScript(INSPECTOR_FLOATING).catch(() => {})
        el.executeJavaScript(URL_BRIDGE).catch(() => {})
      }
    }
    const onStart = () => updateTab(tabId, { loading: true })
    const onStop = () => updateTab(tabId, { loading: false, wcId: el.getWebContentsId?.() })
    const onTitle = (e) => updateTab(tabId, { title: e.title })
    const onNewWin = (e) => {
      e.preventDefault()
      if (!popupsBlockedRef.current) navigate(e.url)
    }
    const onConsole = (e) => {
      const msg = e.message
      if (msg.startsWith('__MCAP_INSPECT__')) {
        try {
          const data = JSON.parse(msg.replace('__MCAP_INSPECT__', ''))
          const logLine = formatPreviewInspectLog(data)
          if (logLine) {
            if (onPreviewUiLog) onPreviewUiLog(logLine, 'out')
            else try { window.api?.devLog?.({ type: 'out', text: logLine }) } catch {}
          }
          onInspectResult?.(data)
        } catch(err) { console.warn('Inspect parse error:', err) }
      } else if (msg.startsWith('__MCAP_TAB__')) {
        const url = msg.replace('__MCAP_TAB__', '')
        if (url) {
          addTabAndNavigateRef.current?.(url)
          try { window.api?.devLog?.({ type: 'info', text: `[diagnóstico] Webview interceptado → "${url}" abierto en nueva pestaña` }) } catch {}
        }
      } else if (msg.startsWith('__MCAP_DESTRIPE__')) {
        try {
          const data = JSON.parse(msg.replace('__MCAP_DESTRIPE__', ''))
          onWebDestripe?.(data)
        } catch (err) { console.warn('Destripe parse error:', err) }
      } else if (msg.startsWith('__MCAP_DIAG__')) {
        try {
          const data = JSON.parse(msg.replace('__MCAP_DIAG__', ''))
          try { window.api?.devLog?.({ type: 'warn', text: `[diagnóstico] ${data.msg}` }) } catch {}
        } catch(err) { console.warn('Diag parse error:', err) }
      }
    }

    el.addEventListener('did-navigate', onDidNav)
    el.addEventListener('did-navigate-in-page', onDidNav)
    el.addEventListener('did-start-loading', onStart)
    el.addEventListener('did-stop-loading', onStop)
    el.addEventListener('page-title-updated', onTitle)
    el.addEventListener('new-window', onNewWin)
    el.addEventListener('console-message', onConsole)

    el.__mcapCleanup = () => {
      el.removeEventListener('did-navigate', onDidNav)
      el.removeEventListener('did-navigate-in-page', onDidNav)
      el.removeEventListener('did-start-loading', onStart)
      el.removeEventListener('did-stop-loading', onStop)
      el.removeEventListener('page-title-updated', onTitle)
      el.removeEventListener('new-window', onNewWin)
      el.removeEventListener('console-message', onConsole)
      wiredTabs.current.delete(tabId)
    }
  }, [updateTab, navigate, onInspectResult, onPreviewUiLog, onWebDestripe])

  const runPageDestripe = useCallback(async () => {
    try {
      const r = await window.api?.previewDestripe?.()
      if (r?.ok && r.data) {
        onWebDestripe?.(r.data)
        return
      }
    } catch (_) {}
    const el = webviewRefs.current[activeId]
    const tab = tabs.find(t => t.id === activeId)
    if (!el || !tab || tab.url === HOME_URL) {
      try {
        window.api?.devLog?.({ type: 'warn', text: '[WEB] Destripe: cargá una URL en esta pestaña o abrí la ventana Preview del dev server y usá 📡 en la barra superior del editor.' })
      } catch {}
      return
    }
    try {
      await el.executeJavaScript(PAGE_DESTRIPE)
    } catch (e) {
      try { window.api?.devLog?.({ type: 'warn', text: `[WEB] Destripe falló: ${e.message || e}` }) } catch {}
    }
  }, [activeId, tabs, onWebDestripe])

  const injectInspectorUi = useCallback(async () => {
    try {
      const r = await window.api?.previewInjectInspector?.()
      if (r?.ok) {
        try {
          window.api?.devLog?.({ type: 'info', text: '[UI] Ventana Preview al frente (la del dev server). En esa ventana: 🔍 abajo a la derecha → pasá el mouse y clic en el elemento.' })
        } catch {}
        return
      }
    } catch (_) {}
    const el = webviewRefs.current[activeId]
    const tab = tabs.find(t => t.id === activeId)
    if (!el || !tab || tab.url === HOME_URL) {
      try {
        window.api?.devLog?.({ type: 'warn', text: '[UI] No hay ventana Preview abierta: iniciá el servidor (⌨ Dev) o ⟐ en el panel Dev. O abrí una URL en 🌐 Web (pestaña del editor).' })
      } catch {}
      return
    }
    el.executeJavaScript(INSPECTOR_FLOATING).catch(() => {})
    try { window.api?.devLog?.({ type: 'info', text: '[UI] Navegador integrado: 🔍 en la página → clic en el elemento.' }) } catch {}
  }, [activeId, tabs])

  // Cleanup webviews on unmount
  useEffect(() => {
    return () => {
      for (const el of Object.values(webviewRefs.current)) {
        if (el && el.__mcapCleanup) { el.__mcapCleanup(); delete el.__mcapCleanup }
      }
      wiredTabs.current.clear()
    }
  }, [])

  // ── Tab management ────────────────────────────────────────────────────
  const addTab = useCallback(() => {
    const tab = createTab()
    setTabs(prev => [...prev, tab])
    setActiveId(tab.id)
  }, [])

  const closeTab = useCallback((id) => {
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id)
      if (next.length === 0) {
        const tab = createTab()
        tabIdCounter = tab.id + 1
        return [tab]
      }
      return next
    })
  }, [])

  // Ensure activeId is valid after tabs change
  useEffect(() => {
    if (!tabs.some(t => t.id === activeId)) {
      setActiveId(tabs[0]?.id || 1)
    }
  }, [tabs, activeId])

  const selectTab = useCallback((id) => {
    setActiveId(id)
    setShowHistory(false)
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────
  const onKey = useCallback((e) => {
    if (e.key === 'Enter') {
      if (e.ctrlKey || e.metaKey) {
        addTabAndNavigateRef.current?.(activeTab?.input)
      } else {
        navigate(activeTab?.input)
      }
    }
  }, [navigate, activeTab])

  const sendPageToChat = useCallback(async () => {
    const wv = webviewRefs.current[activeId]
    if (!wv || !window.api?.webviewGetText) return
    const r = await window.api.webviewGetText(activeTab?.wcId)
    if (!r?.ok) return
    const msg = r.text
      ? `**Página:** ${r.title}\n**URL:** ${r.url}\n\n---\n\n${r.text.slice(0, 6000)}`
      : `**Página:** ${r.title}\n**URL:** ${r.url}\n\n(sin contenido de texto accesible)`
    onSendToChat?.(msg)
  }, [activeId, activeTab, onSendToChat])

  const screenshotToChat = useCallback(async () => {
    if (!activeTab?.wcId || !window.api?.webviewCapture) return
    const r = await window.api.webviewCapture(activeTab.wcId)
    if (!r?.ok) return
    onScreenshotToChat?.(r.dataUrl, `Captura de ${activeTab.title}`)
  }, [activeTab, onScreenshotToChat])

  const downloadPage = useCallback(async () => {
    const wv = webviewRefs.current[activeId]
    if (!wv || !window.api?.saveFile) return
    try {
      const html = await wv.executeJavaScript('document.documentElement.outerHTML')
      const safeTitle = (activeTab?.title || 'pagina').replace(/[\\/:*?"<>|]+/g, '').slice(0, 40) || 'pagina'
      await window.api.saveFile(`${safeTitle}.html`, html)
    } catch (e) { console.warn('No se pudo descargar la página:', e.message) }
  }, [activeId, activeTab])

  const addBookmark = useCallback(() => {
    const url = activeTab?.url
    if (!url || url === HOME_URL) return
    if (bookmarks.some(b => b.url === url)) return
    const next = [...bookmarks, { label: activeTab.title || url, url }]
    setBookmarks(next)
    window.localStorage?.setItem('browserBookmarks', JSON.stringify(next))
  }, [activeTab, bookmarks])

  const searchWeb = useCallback(async () => {
    if (!activeTab?.input.trim()) return
    try {
      const { searchWeb: searchFn } = await import('./ai.js')
      const results = await searchFn(activeTab.input, 3)
      if (results?.ok && results.results?.length > 0) {
        const msg = `**Búsqueda:** "${activeTab.input}"\n\n` +
          results.results.map((r, i) => `${i + 1}. **${r.title || r.snippet}**\n   ${r.url || r.source}`).join('\n\n')
        onSendToChat?.(msg)
      } else {
        onSendToChat?.(`Sin resultados para: "${activeTab.input}"`)
      }
    } catch (e) { console.warn('Error en búsqueda web:', e.message) }
  }, [activeTab, onSendToChat])

  // ── Webview ref callback ──────────────────────────────────────────────
  const storeWebviewRef = useCallback((el, tabId) => {
    if (!el) {
      delete webviewRefs.current[tabId]
      return
    }
    webviewRefs.current[tabId] = el
    wireWebview(el, tabId)
  }, [wireWebview])

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="browser-tab">
      {/* Tab bar */}
      <div className="browser-tabbar">
        <div className="browser-tabbar-scroll">
          {tabs.map(t => (
            <div key={t.id}
              className={`browser-tab-item ${t.id === activeId ? 'active' : ''}`}
              onClick={() => selectTab(t.id)}
            >
              <span className="browser-tab-title">{t.title || 'about:blank'}</span>
              <button className="browser-tab-close" onClick={e => { e.stopPropagation(); closeTab(t.id) }}>×</button>
            </div>
          ))}
          <button className="browser-tab-add" onClick={addTab} title="Nueva pestaña">+</button>
        </div>
      </div>

      {/* Navigation bar */}
      <div className="browser-nav">
        <button className="nav-btn" onClick={() => webviewRefs.current[activeId]?.goBack()}    disabled={!activeTab?.canBack} title="Atrás">‹</button>
        <button className="nav-btn" onClick={() => webviewRefs.current[activeId]?.goForward()} disabled={!activeTab?.canFwd}  title="Adelante">›</button>
        <button className="nav-btn" onClick={() => webviewRefs.current[activeId]?.reload()}    title="Recargar">{activeTab?.loading ? '✕' : '↻'}</button>
        <button className="nav-btn" onClick={downloadPage} title="Descargar página">⬇</button>
        <button className="nav-btn" onClick={addBookmark} title="Agregar acceso directo">☆</button>
        <button className="nav-btn" onClick={() => setShowHistory(s => !s)} title="Mostrar historial">≡</button>
        <button className="nav-btn" onClick={() => { injectInspectorUi() }} title="Prioridad: ventana Preview del dev server. Si no existe, usa la pestaña de 🌐 Web.">
          🎯
        </button>
        <button className="nav-btn" onClick={() => { runPageDestripe() }} title="Destripe: scripts, multimedia, orígenes (prioridad ventana Preview; si no, esta pestaña)">
          📡
        </button>
        <button className={`nav-btn ${popupsBlocked ? 'popup-blocked' : 'popup-allowed'}`}
          onClick={() => setPopupsBlocked(s => !s)}
          title={popupsBlocked ? 'Popups bloqueados' : 'Popups permitidos'}>
          {popupsBlocked ? '🚫' : '✓'}
        </button>

        <div className="nav-url-wrap">
          {activeTab?.loading && <span className="nav-spinner">⟳</span>}
          <input
            className="nav-url"
            value={activeTab?.input || ''}
            onChange={e => updateTab(activeId, { input: e.target.value })}
            onKeyDown={onKey}
            onFocus={e => e.target.select()}
            placeholder="URL — Enter navega, Ctrl+Enter nueva pestaña"
            spellCheck={false}
          />
          <button className="nav-btn nav-newtab-btn"
            onClick={() => addTabAndNavigateRef.current?.(activeTab?.input)}
            disabled={!activeTab?.input?.trim()}
            title="Abrir URL en nueva pestaña">+</button>
        </div>
      </div>

      {/* Bookmarks bar */}
      <div className="browser-bookmarks">
        {onOpenFolder && <button className="bookmark-btn" onClick={onOpenFolder} title="Abrir carpeta">📁</button>}
        {onOpenOutputDir && <button className="bookmark-btn" onClick={onOpenOutputDir} title="Ir a carpeta de salida">📂</button>}
        <span className="bookmark-sep"/>
        {BOOKMARKS.map(b => (
          <button key={b.url} className="bookmark-btn" onClick={() => navigate(b.url)}>{b.label}</button>
        ))}
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="browser-history-panel">
          <div className="history-header">Historial reciente</div>
          <div className="history-list">
            {historyEntries.length > 0 ? historyEntries.slice(-15).reverse().map((item, i) => (
              <button key={i} className="history-item" onClick={() => navigate(item.url)}>{item.label}</button>
            )) : (
              <div className="history-empty">No hay historial aún</div>
            )}
          </div>
        </div>
      )}

      {/* Webview + home overlay */}
      <div className="browser-webview-wrap">
        {tabs.map(t => {
          const isActive = t.id === activeId
          const showHome = isActive && (t.url === HOME_URL)
          return (
            <webview
              key={t.id}
              ref={el => storeWebviewRef(el, t.id)}
              src={HOME_URL}
              partition="persist:browser"
              className={`browser-webview ${!isActive || showHome ? 'browser-webview-hidden' : ''}`}
              style={{ pointerEvents: isActive && !showHome ? 'auto' : 'none' }}
              webpreferences="contextIsolation=false"
            />
          )
        })}
        {activeTab && activeTab.url === HOME_URL && (
          <div className="browser-home">
            <div className="browser-home-title">MCodeAI Pre Browser</div>
            <div className="browser-home-sub">Buscá o navegá — el contenido está disponible para la IA</div>
            <div className="browser-home-grid">
              {BOOKMARKS.map(b => (
                <button key={b.url} className="browser-home-card" onClick={() => navigate(b.url)}>
                  <span className="home-card-icon">🌐</span>
                  <span>{b.label}</span>
                </button>
              ))}
              <button className="browser-home-card" onClick={() => navigate('http://127.0.0.1:5175')}>
                <span className="home-card-icon">⚡</span>
                <span>127.0.0.1:5175</span>
              </button>
              <button className="browser-home-card" onClick={() => navigate('https://localhost:3000')}>
                <span className="home-card-icon">⚡</span>
                <span>localhost:3000</span>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default BrowserTab
