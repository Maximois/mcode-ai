import React, { useState, useEffect, useRef, useCallback } from 'react'

function DevPanel({ cwd, changeRevision = 0 }) {
  const [status, setStatus] = useState('idle')
  const [logs, setLogs] = useState([])
  const [url, setUrl] = useState('')
  const [manualUrl, setManualUrl] = useState('')
  const [devCmd, setDevCmd] = useState('')
  const [filter, setFilter] = useState('')
  const [errorCount, setErrorCount] = useState(0)
  const [monitorData, setMonitorData] = useState({ components: {}, errors: [] })
  const endRef = useRef(null)
  const logSigMapRef = useRef(new Map())

  const normalizeLogSignature = useCallback((data) => {
    const text = String(data?.text || '')
      .replace(/\(\d+(?:\.\d+)?ms\)/gi, '(Xms)')
      .replace(/\s+/g, ' ')
      .trim()
    return `${data?.type || 'out'}|${text}`
  }, [])

  useEffect(() => { endRef.current?.scrollIntoView({ behavior:'smooth' }) }, [logs])

  useEffect(() => {
    const unsubLog = window.api.onDevLog(data => {
      const sig = normalizeLogSignature(data)
      setLogs(p => {
        const existing = logSigMapRef.current.get(sig)
        if (existing && existing.rev === changeRevision && p[existing.idx]) {
          const prev = p[existing.idx]
          const updated = { ...prev, time: Date.now(), repeat: (prev.repeat || 1) + 1 }
          const next = [...p]
          next[existing.idx] = updated
          return next
        }

        const now = Date.now()
        const entry = { ...data, time: now, repeat: 1, rev: changeRevision, sig }
        const next = [...p, entry]
        logSigMapRef.current.set(sig, { idx: next.length - 1, rev: changeRevision })
        return next
      })
      if (data.type === 'err') {
        setErrorCount(p => p + 1)
      }
    })
    const unsubUrl = window.api.onDevUrl(detectedUrl => {
      setUrl(detectedUrl)
      setManualUrl(detectedUrl)
    })
    const unsubStat = window.api.onDevStatus(s => {
      setStatus(s.running ? 'running' : 'idle')
      if (!s.running) setUrl('')
    })
    return () => { unsubLog?.(); unsubUrl?.(); unsubStat?.() }
  }, [])

  useEffect(() => {
    // New code revision: allow new first occurrence per signature
    logSigMapRef.current.clear()
  }, [changeRevision])

  useEffect(() => {
    window.api.devStatus().then(s => {
      if (s.running) setStatus('running')
    })
  }, [])

  const start = useCallback(async () => {
    if (!cwd) {
      setLogs(p => [...p, { type:'err', text: 'Abrí una carpeta de proyecto primero (📁 Abrir)', time: Date.now() }])
      return
    }
    if (status === 'running' || status === 'starting') return
    setStatus('starting')
    setLogs(p => [...p, { type:'info', text: `Iniciando servidor en: ${cwd}`, time: Date.now() }])
    setErrorCount(0)
    const res = await window.api.devStart({ cwd, cmd: devCmd || undefined })
    if (!res.ok) {
      setStatus('error')
      setLogs(p => [...p, { type:'err', text: `Error: ${res.error}`, time: Date.now() }])
    }
  }, [cwd, devCmd, status])

  const stop = useCallback(async () => {
    setLogs(p => [...p, { type:'info', text: 'Deteniendo servidor…', time: Date.now() }])
    await window.api.devStop()
    setStatus('idle')
    setUrl('')
    setManualUrl('')
  }, [])

  const restart = useCallback(async () => {
    await stop()
    setTimeout(() => start(), 300)
  }, [stop, start])

  const openManualUrl = useCallback(() => {
    if (manualUrl.trim()) {
      window.dispatchEvent(new CustomEvent('dev-open-newtab', { detail: manualUrl.trim() }))
    }
  }, [manualUrl])

  const statusIcon = status === 'running' ? '🟢' : status === 'starting' ? '🟡' : status === 'error' ? '🔴' : '⚪'
  const statusLabel = status === 'running' ? 'Running' : status === 'starting' ? 'Starting…' : status === 'error' ? 'Error' : 'Idle'

  const filteredLogs = filter
    ? logs.filter(l => l.text.toLowerCase().includes(filter.toLowerCase()))
    : logs

  const fmtTime = (t) => {
    const d = new Date(t)
    return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}:${String(d.getSeconds()).padStart(2,'0')}`
  }

  const isErrorLine = (text) => /error|failed|exception|traceback|cannot|not found|not defined|syntaxerror|typeerror|referenceerror|exit code/i.test(text)

  return (
    <div className="dev-panel">
      {/* Header */}
      <div className="dev-panel-header">
        <span className="dev-panel-status" title={statusLabel}>
          {statusIcon} {statusLabel}
        </span>
        {cwd && <span className="dev-panel-cwd" title={cwd}>{cwd}</span>}
        <div style={{ flex:1 }} />
        {errorCount > 0 && <span className="dev-panel-err-count">{errorCount} error(es)</span>}
        <input className="dev-panel-filter" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar logs…" />
        <button className="icon-btn" onClick={() => { setLogs([]); setErrorCount(0); logSigMapRef.current.clear() }} title="Limpiar logs">⌫</button>
        {status === 'running' ? (
          <button className="icon-btn" onClick={stop} title="Detener servidor">⏹</button>
        ) : (
          <button className="icon-btn" onClick={start} disabled={status === 'starting'} title="Iniciar servidor">▶</button>
        )}
        {status === 'running' && <button className="icon-btn" onClick={restart} title="Reiniciar servidor">🔄</button>}
      </div>

      {/* URL bar (manual + detected) */}
      <div className="dev-url-bar">
        <span className="dev-panel-prompt">URL</span>
        <input className="dev-url-input" value={manualUrl}
          onChange={e => setManualUrl(e.target.value)}
          placeholder={url || 'http://localhost:... (auto o manual)'} spellCheck={false} />
        <button className="term-run-btn" onClick={() => { const u = (manualUrl || url).trim(); if (u) window.api.devOpenWindow(u) }} disabled={!manualUrl.trim() && !url} title="Abrir la app en ventana Preview (misma que los logs [preview])">↗</button>
        <button className="term-run-btn" onClick={() => { const u = (manualUrl || url).trim(); if (u) window.dispatchEvent(new CustomEvent('dev-open-newtab', { detail: u })) }} disabled={!manualUrl.trim() && !url} title="Abrir en pestaña del navegador integrado del editor (opcional)">⟐</button>
        {url && manualUrl === url && <span className="dev-url-detected">auto</span>}
      </div>

      {/* Logs output */}
      <div className="dev-panel-logs">
        {filteredLogs.length === 0 && (
          <div className="dev-panel-empty">
            {status === 'idle' ? 'Presioná ▶ para iniciar el servidor de desarrollo' : 'Esperando salida…'}
          </div>
        )}
        {filteredLogs.map((l, i) => (
          <div key={i} className={`dev-log-line dev-log-${l.type}${isErrorLine(l.text) ? ' dev-log-error' : ''}`}>
            <span className="dev-log-time">{fmtTime(l.time)}</span>
            <span className="dev-log-text">
              {l.text}
              {l.repeat > 1 ? `  (x${l.repeat})` : ''}
            </span>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {/* Custom command input */}
      <div className="dev-panel-input">
        <span className="dev-panel-prompt">$</span>
        <input className="dev-panel-cmd-input" value={devCmd} onChange={e => setDevCmd(e.target.value)}
          placeholder="Comando (vacío = auto-detect desde package.json)" spellCheck={false} />
        <button className="term-run-btn" onClick={start} disabled={status === 'starting' || status === 'running'}>▶</button>
      </div>
    </div>
  )
}

export default DevPanel
