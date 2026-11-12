import React, { useState, useEffect, useCallback } from 'react'

/**
 * Panel de inteligencia de proyecto: análisis estático en el proceso principal.
 * Base extensible para ingeniería inversa; el resumen puede ir al chat IA.
 */
function ReverseIntelPanel({ rootDir, settings = {}, changeRevision = 0, onSendToChat, onIntelSignals }) {
  const [busy, setBusy] = useState(false)
  const [quick, setQuick] = useState(false)
  const [npmAudit, setNpmAudit] = useState(() => !!settings.reverseIntelNpmAudit)
  const [binaryStrings, setBinaryStrings] = useState(() => !!settings.reverseIntelBinaryStrings)
  const [report, setReport] = useState(null)
  const [err, setErr] = useState(null)

  useEffect(() => {
    setNpmAudit(!!settings.reverseIntelNpmAudit)
  }, [settings.reverseIntelNpmAudit])

  useEffect(() => {
    setBinaryStrings(!!settings.reverseIntelBinaryStrings)
  }, [settings.reverseIntelBinaryStrings])

  useEffect(() => {
    setReport(null)
    setErr(null)
  }, [rootDir, changeRevision])

  const run = useCallback(async () => {
    if (!rootDir) {
      setErr('Abrí una carpeta de proyecto primero.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const r = await window.api.reverseAnalyze({
        rootDir,
        depth: quick ? 'quick' : 'standard',
        npmAudit: !quick && npmAudit,
        binaryStringsPreview: !quick && binaryStrings,
      })
      if (!r?.ok) {
        setErr(r?.error || 'Análisis fallido')
        setReport(null)
        return
      }
      setReport(r)
      try {
        window.api?.devLog?.({ type: 'info', text: `[intel] Análisis listo (${r.durationMs} ms) — tipo: ${r.manifest?.kind || '?'}` })
      } catch {}
      onIntelSignals?.(r)
    } catch (e) {
      setErr(e.message || String(e))
      setReport(null)
    } finally {
      setBusy(false)
    }
  }, [rootDir, quick, npmAudit, binaryStrings, onIntelSignals])

  const copyMd = useCallback(() => {
    if (!report?.summaryMarkdown) return
    navigator.clipboard?.writeText(report.summaryMarkdown).catch(() => {})
    try { window.api?.devLog?.({ type: 'info', text: '[intel] Resumen copiado al portapapeles' }) } catch {}
  }, [report])

  const sendChat = useCallback(() => {
    if (!report?.summaryMarkdown || !onSendToChat) return
    onSendToChat(
      'Usá este informe estático del proyecto para priorizar fixes, optimización y riesgos:\n\n' + report.summaryMarkdown
    )
  }, [report, onSendToChat])

  const sevClass = (s) => {
    if (s === 'error') return 'reverse-intel-sev-error'
    if (s === 'warn') return 'reverse-intel-sev-warn'
    return 'reverse-intel-sev-info'
  }

  return (
    <div className="dev-panel reverse-intel-panel">
      <div className="dev-panel-header">
        <span className="dev-panel-status" title="Modo sandbox — Configuración → Intel proyecto">
          🔬 Intel
          <span style={{ marginLeft: 6, opacity: 0.75, fontWeight: 400 }}>
            ({settings.reverseIntelSandboxMode === 'docker' ? 'docker' : settings.reverseIntelSandboxMode === 'child-process' ? 'hijo' : 'local'})
          </span>
        </span>
        {rootDir && (
          <span className="dev-panel-cwd" title={rootDir}>{rootDir.split(/[\\/]/).pop()}</span>
        )}
        <div style={{ flex: 1 }} />
        <label className="reverse-intel-quick" title="Menos archivos — más rápido">
          <input type="checkbox" checked={quick} onChange={e => setQuick(e.target.checked)} />
          Rápido
        </label>
        <label className="reverse-intel-quick" title="npm audit --json (usa red del registry npm)">
          <input type="checkbox" checked={npmAudit && !quick} disabled={quick} onChange={e => setNpmAudit(e.target.checked)} />
          npm audit
        </label>
        <label className="reverse-intel-quick" title="file(1) + strings(1) en hasta 3 binarios grandes">
          <input type="checkbox" checked={binaryStrings && !quick} disabled={quick} onChange={e => setBinaryStrings(e.target.checked)} />
          strings
        </label>
        <button type="button" className="term-run-btn" onClick={run} disabled={busy || !rootDir}>
          {busy ? '…' : 'Analizar'}
        </button>
        <button type="button" className="term-run-btn" onClick={copyMd} disabled={!report?.summaryMarkdown} title="Copiar markdown">
          Copiar
        </button>
        <button type="button" className="term-run-btn" onClick={sendChat} disabled={!report?.summaryMarkdown || !onSendToChat} title="Enviar al chat IA">
          → IA
        </button>
      </div>

      {!rootDir && (
        <div className="dev-panel-empty">Abrí una carpeta (📁) para escanear el proyecto.</div>
      )}

      {err && rootDir && (
        <div className="reverse-intel-error">{err}</div>
      )}

      {report && (
        <div className="reverse-intel-body">
          {report.unifiedSignals?.length > 0 && (
            <div className="reverse-intel-signals">
              {report.unifiedSignals.map((s, i) => (
                <span key={i} className={`reverse-intel-pill ${sevClass(s.severity)}`} title={s.message}>
                  {s.code}
                </span>
              ))}
            </div>
          )}
          <pre className="reverse-intel-md">{report.summaryMarkdown}</pre>
        </div>
      )}

      {rootDir && !report && !err && !busy && (
        <div className="dev-panel-empty">
          Escaneo: validación de ruta, lockfile, imports/hubs, binarios, tamaños, patrones. Opcional: proceso hijo Node (⚙) y npm audit (red). Rápido omite imports/binarios amplios.
        </div>
      )}
    </div>
  )
}

export default ReverseIntelPanel
