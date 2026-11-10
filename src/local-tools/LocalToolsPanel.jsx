// Panel lateral independiente de herramientas locales (cero tokens).
// No depende del estado interno de App.jsx: recibe solo rootDir, onOpenFile y onClose.
import React, { useState, useEffect, useCallback } from 'react'
import './local-tools.css'

const SKIP = /(^|[\\/])(node_modules|\.git|dist|dist-electron|build|out|__pycache__)([\\/]|$)/
const EXT = ['json', 'yml', 'yaml', 'js', 'mjs', 'cjs']

function joinPath(dir, file) {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + file
}
function baseName(p) { return p.split(/[\\/]/).pop() }
function fmtSize(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB' }
function fmtTime(ts) {
  try { return new Date(ts).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) } catch { return '' }
}

export default function LocalToolsPanel({ rootDir, onOpenFile, onClose }) {
  const lt = window.api?.localTools
  const [tab, setTab] = useState('errors')
  const [problems, setProblems] = useState({}) // ruta absoluta -> [{line,col,message}]
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  // Secretos
  const [secrets, setSecrets] = useState(null)
  // .gitignore
  const [gi, setGi] = useState(null)
  const [giInput, setGiInput] = useState('')
  // Snapshots
  const [snaps, setSnaps] = useState([])
  const [snapLabel, setSnapLabel] = useState('')

  useEffect(() => { setProblems({}); setSecrets(null); setGi(null); setSnaps([]); setMsg('') }, [rootDir])

  // ── Validación al guardar: escucha el watcher que App ya inicia (también cubre parches del agente) ──
  useEffect(() => {
    if (!rootDir || !lt || !window.api?.onFileChanged) return
    const timers = new Map()
    const unsub = window.api.onFileChanged((m) => {
      if (!m || !m.file || SKIP.test(m.file)) return
      const ext = m.file.split('.').pop()?.toLowerCase()
      if (!EXT.includes(ext)) return
      const full = joinPath(m.dir || rootDir, m.file)
      clearTimeout(timers.get(full))
      timers.set(full, setTimeout(async () => {
        timers.delete(full)
        const r = await lt.validate(full).catch(() => null)
        if (!r) return
        setProblems(p => {
          const n = { ...p }
          if (r.ok || !r.errors?.length) delete n[full]
          else n[full] = r.errors
          return n
        })
      }, 500))
    })
    return () => { unsub?.(); timers.forEach(clearTimeout) }
  }, [rootDir, lt])

  const refreshGi = useCallback(async () => {
    if (!rootDir || !lt) return
    setGi(await lt.gitignoreRead(rootDir))
  }, [rootDir, lt])
  const refreshSnaps = useCallback(async () => {
    if (!rootDir || !lt) return
    const r = await lt.snapList(rootDir)
    setSnaps(r?.snapshots || [])
  }, [rootDir, lt])

  useEffect(() => {
    if (tab === 'gitignore') refreshGi()
    if (tab === 'snaps') refreshSnaps()
  }, [tab, refreshGi, refreshSnaps])

  if (!lt) {
    return <div className="lt-panel"><span className="lt-muted">Herramientas locales no disponibles en este entorno.</span></div>
  }
  if (!rootDir) {
    return <div className="lt-panel"><span className="lt-muted">Abrí una carpeta de proyecto para usar las herramientas locales.</span></div>
  }

  const problemFiles = Object.keys(problems)

  const runScan = async () => {
    setBusy(true); setMsg('')
    const r = await lt.secretsScan(rootDir)
    setSecrets(r)
    setBusy(false)
  }
  const addRules = async (rules) => {
    const r = await lt.gitignoreAdd(rootDir, rules)
    setMsg(r?.ok ? (r.added.length ? `Agregadas: ${r.added.join(', ')}` : 'Ya estaban en .gitignore') : (r?.error || 'Error'))
    refreshGi()
  }
  const removeRule = async (rule) => { await lt.gitignoreRemove(rootDir, rule); refreshGi() }
  const createSnap = async () => {
    setBusy(true); setMsg('')
    const r = await lt.snapCreate(rootDir, snapLabel)
    setMsg(r?.ok ? `Snapshot creado (${r.files} archivos${r.truncated ? ', truncado por tamaño' : ''})` : (r?.error || 'Error'))
    setSnapLabel('')
    setBusy(false)
    refreshSnaps()
  }
  const restoreSnap = async (s) => {
    const ok = window.confirm(`¿Restaurar el snapshot "${s.label || fmtTime(s.ts)}"?\n\nSe crea antes un respaldo del estado actual. Los archivos creados después del snapshot no se borran.`)
    if (!ok) return
    setBusy(true)
    const r = await lt.snapRestore(rootDir, s.id)
    setMsg(r?.ok ? `Restaurados ${r.restored} archivos (respaldo previo guardado)` : (r?.error || 'Error'))
    setBusy(false)
    refreshSnaps()
  }
  const deleteSnap = async (s) => { await lt.snapDelete(rootDir, s.id); refreshSnaps() }

  const TabBtn = ({ id, children }) => (
    <button className={'lt-tab' + (tab === id ? ' active' : '')} onClick={() => { setTab(id); setMsg('') }}>{children}</button>
  )

  return (
    <div className="lt-panel">
      <div className="lt-head project-tools-header">
        <span>🛠 Herramientas locales</span>
        <button className="sb-btn" style={{ fontSize: 8, padding: '1px 6px' }} onClick={onClose}>×</button>
      </div>
      <div className="lt-tabs">
        <TabBtn id="errors">Errores{problemFiles.length > 0 && <span className="lt-badge">{problemFiles.length}</span>}</TabBtn>
        <TabBtn id="secrets">Secretos{secrets?.findings?.length > 0 && <span className="lt-badge">{secrets.findings.length}</span>}</TabBtn>
        <TabBtn id="gitignore">.gitignore</TabBtn>
        <TabBtn id="snaps">Rollbacks</TabBtn>
      </div>

      {msg && <div className="lt-muted" style={{ marginBottom: 4 }}>{msg}</div>}

      {tab === 'errors' && (
        <div>
          <div className="lt-muted">Se valida al guardar: JSON, YAML (chequeo ligero) y JS/MJS/CJS. JSX/TS no se validan aquí.</div>
          {problemFiles.length === 0
            ? <div className="lt-ok" style={{ marginTop: 6 }}>✓ Sin errores detectados desde que abriste el panel</div>
            : (
              <div className="lt-list">
                {problemFiles.map(f => (
                  <div key={f} className="lt-item clickable" onClick={() => onOpenFile?.({ path: f, name: baseName(f) })} title="Abrir archivo">
                    <div className="lt-file">{baseName(f)}</div>
                    {problems[f].slice(0, 5).map((e, i) => (
                      <div key={i} className="lt-err">L{e.line}:{e.col} — {e.message}</div>
                    ))}
                    {problems[f].length > 5 && <div className="lt-muted">+{problems[f].length - 5} más</div>}
                  </div>
                ))}
              </div>
            )}
        </div>
      )}

      {tab === 'secrets' && (
        <div>
          <div className="lt-muted">Busca claves y tokens hardcodeados. Solo muestra una versión enmascarada.</div>
          <div className="lt-row">
            <button className="sb-btn" onClick={runScan} disabled={busy}>{busy ? 'Escaneando…' : 'Escanear proyecto'}</button>
          </div>
          {secrets && !secrets.ok && <div className="lt-err">{secrets.error}</div>}
          {secrets?.ok && (
            <>
              <div className={secrets.findings.length ? 'lt-err' : 'lt-ok'}>
                {secrets.findings.length ? `${secrets.findings.length} posible(s) secreto(s)` : '✓ Sin secretos detectados'}
                <span className="lt-muted"> · {secrets.scanned} archivos{secrets.truncated ? ' · lista truncada' : ''}</span>
              </div>
              <div className="lt-list">
                {secrets.findings.map((f, i) => (
                  <div key={i} className="lt-item clickable" onClick={() => onOpenFile?.({ path: joinPath(rootDir, f.file), name: baseName(f.file) })}>
                    <div className="lt-file">{f.file}:{f.line}</div>
                    <div>{f.label} <span className="lt-muted">{f.preview}</span></div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {tab === 'gitignore' && (
        <div>
          {gi && !gi.exists && <div className="lt-muted">Este proyecto no tiene .gitignore; se creará al agregar una regla.</div>}
          <div className="lt-row">
            <input value={giInput} onChange={e => setGiInput(e.target.value)} placeholder="Ej: *.log o carpeta/"
              onKeyDown={e => { if (e.key === 'Enter' && giInput.trim()) { addRules([giInput]); setGiInput('') } }} />
            <button className="sb-btn" disabled={!giInput.trim()} onClick={() => { addRules([giInput]); setGiInput('') }}>Agregar</button>
          </div>
          {gi?.presets && (
            <div className="lt-presets">
              {Object.keys(gi.presets).map(k => (
                <button key={k} className="lt-tab" onClick={() => addRules(gi.presets[k])} title={gi.presets[k].join(', ')}>+ {k}</button>
              ))}
            </div>
          )}
          <div className="lt-list">
            {(gi?.rules || []).map(r => (
              <div key={r} className="lt-item lt-rule"><span>{r}</span><button className="lt-x" onClick={() => removeRule(r)} title="Quitar regla">×</button></div>
            ))}
          </div>
        </div>
      )}

      {tab === 'snaps' && (
        <div>
          <div className="lt-muted">Copias comprimidas del proyecto (sin node_modules/.git/dist), guardadas fuera de la carpeta. Se conservan las últimas 15.</div>
          <div className="lt-row">
            <input value={snapLabel} onChange={e => setSnapLabel(e.target.value)} placeholder="Nombre (opcional)" maxLength={40} />
            <button className="sb-btn" onClick={createSnap} disabled={busy}>{busy ? '…' : 'Crear'}</button>
          </div>
          <div className="lt-list">
            {snaps.length === 0 && <div className="lt-muted">Sin snapshots todavía</div>}
            {snaps.map(s => (
              <div key={s.id} className="lt-item">
                <div>{s.label || 'snapshot'} <span className="lt-muted">· {fmtTime(s.ts)} · {fmtSize(s.size)}</span></div>
                <div className="lt-row" style={{ margin: '3px 0 0' }}>
                  <button className="sb-btn" onClick={() => restoreSnap(s)} disabled={busy}>Restaurar</button>
                  <button className="sb-btn" onClick={() => deleteSnap(s)} disabled={busy}>Borrar</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
