// Pestaña "Mantenimiento": versión + changelog, limpieza de basura y enlaces rotos.
// Todo es local (sin IA, sin tokens). Lo que escribe o borra pide confirmación.
import React, { useState, useEffect, useCallback } from 'react'

function joinPath(dir, file) {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + file
}
function baseName(p) { return String(p || '').split(/[\\/]/).pop() }
function fmtBytes(n) {
  if (!n) return '0 KB'
  if (n > 1073741824) return (n / 1073741824).toFixed(1) + ' GB'
  if (n > 1048576) return (n / 1048576).toFixed(1) + ' MB'
  return Math.max(1, Math.round(n / 1024)) + ' KB'
}

// ── Versión y changelog ─────────────────────────────────────────────────────
function VersionSection({ rootDir }) {
  const lt = window.api.localTools
  const [info, setInfo] = useState(null)
  const [version, setVersion] = useState('')
  const [log, setLog] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const load = useCallback(async () => {
    const r = await lt.semverInfo(rootDir).catch(e => ({ ok: false, error: e.message }))
    setInfo(r)
    if (r?.ok && r.files[0]) setVersion(v => v || r.files[0].version)
  }, [lt, rootDir])

  useEffect(() => { setInfo(null); setLog(null); setVersion(''); setNote(''); load() }, [load])

  const files = info?.files || []
  const main = files.find(f => f.valid)

  const bump = async (level) => {
    const lines = files.filter(f => f.valid).map(f => `${f.file}: ${f.version} → ${f.next[level]}`).join('\n')
    if (!window.confirm(`Subir versión (${level}):\n\n${lines}\n\nSe cambia solo el valor de "version"; el resto del archivo queda igual.`)) return
    setBusy(true); setNote('')
    const r = await lt.semverBump(rootDir, level).catch(e => ({ ok: false, error: e.message }))
    if (r.ok) {
      setNote(`Versión actualizada: ${r.changed.map(c => `${c.file} ${c.from} → ${c.to}`).join(' · ')}`)
      setVersion(r.changed[0].to); setLog(null)
      await load()
    } else setNote(r.error)
    setBusy(false)
  }

  const runLog = async (mode) => {
    if (mode === 'write' && !window.confirm(`Agregar la sección ${version} a CHANGELOG.md (si no existe, se crea)?`)) return
    setBusy(true); setNote('')
    const r = await lt.changelog(rootDir, version, mode).catch(e => ({ ok: false, error: e.message }))
    if (r.ok) {
      setLog(r)
      if (mode === 'write') setNote(`Escrito en ${r.written}`)
    } else { setNote(r.error); if (mode === 'preview') setLog(null) }
    setBusy(false)
  }

  return (
    <div>
      <div className="lt-section">Versión</div>
      {info && !info.ok && <div className="lt-err">{info.error}</div>}
      {info?.ok && files.length === 0 && <div className="lt-muted">No hay package.json ni manifest.json con versión.</div>}
      {files.map(f => (
        <div key={f.file} className="lt-item lt-rule">
          <span>{f.file}</span>
          <span className={f.valid ? 'lt-ok' : 'lt-err'}>{f.version}{f.valid ? '' : ' (no es SemVer)'}</span>
        </div>
      ))}
      {main && (
        <div className="lt-row">
          {['patch', 'minor', 'major'].map(l => (
            <button key={l} className="sb-btn" disabled={busy} onClick={() => bump(l)} title={`${main.version} → ${main.next[l]}`}>
              {l} → {main.next[l]}
            </button>
          ))}
        </div>
      )}

      <div className="lt-section">Changelog</div>
      <div className="lt-muted">Arma la sección con los commits desde el último tag (o los últimos 60), agrupados por tipo. Ignora los "checkpoint:".</div>
      <div className="lt-row">
        <input value={version} onChange={e => { setVersion(e.target.value); setLog(null) }} placeholder="Versión, ej: 2.1.0" style={{ maxWidth: 110 }} />
        <button className="sb-btn" disabled={busy || !version.trim()} onClick={() => runLog('preview')}>Previsualizar</button>
        <button className="sb-btn" disabled={busy || !log} onClick={() => runLog('write')}>Escribir</button>
      </div>
      {log && <div className="lt-muted">{log.count} commits{log.since ? ` desde ${log.since}` : ''}</div>}
      {log && <pre className="lt-pre">{log.markdown}</pre>}
      {note && <div className="lt-muted">{note}</div>}
    </div>
  )
}

// ── Limpieza de basura ──────────────────────────────────────────────────────
function CleanSection({ rootDir }) {
  const lt = window.api.localTools
  const [scan, setScan] = useState(null)
  const [sel, setSel] = useState({})
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => { setScan(null); setSel({}); setNote('') }, [rootDir])

  const run = async (keepNote = false) => {
    setBusy(true)
    if (!keepNote) setNote('')
    const r = await lt.cleanScan(rootDir, []).catch(e => ({ ok: false, error: e.message }))
    setScan(r)
    if (r.ok) setSel(Object.fromEntries(Object.entries(r.categories).map(([k, v]) => [k, v.defaultOn])))
    else setNote(r.error)
    setBusy(false)
  }

  const chosen = Object.keys(sel).filter(k => sel[k] && scan?.categories?.[k]?.count)
  const chosenCount = chosen.reduce((s, k) => s + scan.categories[k].count, 0)
  const chosenBytes = chosen.reduce((s, k) => s + scan.categories[k].bytes, 0)

  const apply = async () => {
    if (!window.confirm(`Se borrarán ${chosenCount} elementos (${fmtBytes(chosenBytes)}) de las categorías elegidas.\n\nEs basura regenerable, pero el borrado no se puede deshacer.`)) return
    setBusy(true)
    const r = await lt.cleanApply(rootDir, chosen).catch(e => ({ ok: false, error: e.message }))
    setNote(r.ok ? `Borrados ${r.deleted} elementos, liberados ${fmtBytes(r.freed)}${r.failedCount ? ` · ${r.failedCount} no se pudieron borrar` : ''}` : r.error)
    setBusy(false)
    if (r.ok) await run(true) // refrescar la lista conservando el mensaje de resultado
  }

  return (
    <div>
      <div className="lt-section">Limpieza</div>
      <div className="lt-muted">Busca basura regenerable. No toca .git, node_modules (salvo su caché) ni enlaces simbólicos.</div>
      <div className="lt-row"><button className="sb-btn" onClick={() => run()} disabled={busy}>{busy ? 'Buscando…' : 'Buscar basura'}</button></div>
      {scan?.ok && (
        <>
          {Object.entries(scan.categories).map(([k, c]) => (
            <label key={k} className="lt-item" style={{ display: 'flex', gap: 6, alignItems: 'flex-start', cursor: c.count ? 'pointer' : 'default', opacity: c.count ? 1 : 0.5 }}>
              <input type="checkbox" checked={!!sel[k] && c.count > 0} disabled={!c.count} onChange={e => setSel(s => ({ ...s, [k]: e.target.checked }))} />
              <span>{c.label}<br /><span className="lt-muted">{c.count} elementos · {fmtBytes(c.bytes)}</span></span>
            </label>
          ))}
          {scan.truncated && <div className="lt-muted">Recorrido parcial (proyecto muy grande): pueden quedar más elementos.</div>}
          {scan.total === 0
            ? <div className="lt-ok">✓ No hay basura que limpiar</div>
            : (
              <>
                <div className="lt-list" style={{ maxHeight: 120 }}>
                  {scan.sample.filter(i => sel[i.cat]).map((i, n) => <div key={n} className="lt-muted lt-rule"><span>{i.rel}{i.isDir ? '/' : ''}</span><span>{fmtBytes(i.size)}</span></div>)}
                </div>
                <div className="lt-row"><button className="sb-btn" onClick={apply} disabled={busy || !chosenCount}>Borrar seleccionados ({chosenCount})</button></div>
              </>
            )}
        </>
      )}
      {note && <div className="lt-muted">{note}</div>}
    </div>
  )
}

// ── Enlaces rotos ───────────────────────────────────────────────────────────
function LinksSection({ rootDir, onOpenFile }) {
  const lt = window.api.localTools
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { setRes(null) }, [rootDir])

  const run = async () => {
    setBusy(true)
    setRes(await lt.linksScan(rootDir).catch(e => ({ ok: false, error: e.message })))
    setBusy(false)
  }

  return (
    <div>
      <div className="lt-section">Enlaces y rutas</div>
      <div className="lt-muted">Revisa src, href y url() en HTML, CSS, JSX, TSX y Vue. Ignora URLs externas y rutas dinámicas (análisis aproximado).</div>
      <div className="lt-row"><button className="sb-btn" onClick={run} disabled={busy}>{busy ? 'Revisando…' : 'Revisar enlaces'}</button></div>
      {res && !res.ok && <div className="lt-err">{res.error}</div>}
      {res?.ok && (
        <>
          <div className={res.findings.length ? 'lt-err' : 'lt-ok'}>
            {res.findings.length ? `${res.findings.length} enlace(s) con problema` : '✓ Sin enlaces rotos'}
            <span className="lt-muted"> · {res.scanned} archivos, {res.checked} referencias{res.truncated ? ' · lista truncada' : ''}</span>
          </div>
          <div className="lt-list">
            {res.findings.map((f, i) => (
              <div key={i} className="lt-item clickable" onClick={() => onOpenFile?.({ path: joinPath(rootDir, f.file), name: baseName(f.file) })}>
                <div className="lt-file">{f.file}:{f.line}</div>
                <div className={f.kind === 'case' ? '' : 'lt-err'} style={f.kind === 'case' ? { color: 'var(--yellow)' } : undefined}>{f.ref} <span className="lt-muted">— {f.detail}</span></div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ── Optimizar CSS (genera .min.css, no toca los originales) ──────────────────
const CSS_STATUS = {
  ok: { label: 'listo', cls: 'lt-ok' },
  nosavings: { label: 'sin ahorro', cls: 'lt-muted' },
  exists: { label: 'ya existe .min.css ajeno', cls: 'lt-muted' },
  skip: { label: 'omitido', cls: 'lt-muted' },
  error: { label: 'no seguro', cls: 'lt-err' },
}

function CssSection({ rootDir, onOpenFile }) {
  const lt = window.api.localTools
  const [res, setRes] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => { setRes(null); setNote('') }, [rootDir])

  const run = async (keepNote = false) => {
    setBusy(true)
    if (!keepNote) setNote('')
    setRes(await lt.cssScan(rootDir).catch(e => ({ ok: false, error: e.message })))
    setBusy(false)
  }

  const apply = async () => {
    if (!window.confirm(`Se crearán ${res.eligible} archivos .min.css junto a los originales (ahorro: ${fmtBytes(res.savedBytes)}).\n\nTus .css originales NO se modifican.`)) return
    setBusy(true)
    const r = await lt.cssApply(rootDir).catch(e => ({ ok: false, error: e.message }))
    setNote(r.ok ? `Generados ${r.written} archivos .min.css (ahorro: ${fmtBytes(r.saved)})${r.failedCount ? ` · ${r.failedCount} fallaron` : ''}` : r.error)
    setBusy(false)
    if (r.ok) await run(true)
  }

  return (
    <div>
      <div className="lt-section">Optimizar CSS</div>
      <div className="lt-muted">Crea una copia minificada (.min.css) de cada .css. No modifica los originales ni pisa .min.css de librerías. Cada resultado se verifica antes de escribirse.</div>
      <div className="lt-row">
        <button className="sb-btn" onClick={() => run()} disabled={busy}>{busy ? 'Revisando…' : 'Buscar CSS'}</button>
        <button className="sb-btn" onClick={apply} disabled={busy || !res?.eligible}>Generar .min.css ({res?.eligible || 0})</button>
      </div>
      {res && !res.ok && <div className="lt-err">{res.error}</div>}
      {res?.ok && (res.files.length === 0
        ? <div className="lt-muted">No hay archivos .css en el proyecto.</div>
        : (
          <>
            <div className="lt-muted">{res.files.length} archivos CSS · ahorro posible: {fmtBytes(res.savedBytes)}{res.truncated ? ' · lista parcial' : ''}</div>
            <div className="lt-list">
              {res.files.map(f => {
                const st = CSS_STATUS[f.status] || CSS_STATUS.skip
                return (
                  <div key={f.rel} className="lt-item clickable" onClick={() => onOpenFile?.({ path: joinPath(rootDir, f.rel), name: baseName(f.rel) })} title={f.reason || ''}>
                    <div className="lt-file">{f.rel}</div>
                    <div><span className={st.cls}>{st.label}</span> <span className="lt-muted">{f.status === 'ok' ? `${fmtBytes(f.before)} → ${fmtBytes(f.after)}` : (f.reason || '')}</span></div>
                  </div>
                )
              })}
            </div>
          </>
        ))}
      {note && <div className="lt-muted">{note}</div>}
    </div>
  )
}

export default function MaintenanceTab({ rootDir, onOpenFile }) {
  return (
    <div>
      <VersionSection rootDir={rootDir} />
      <CleanSection rootDir={rootDir} />
      <LinksSection rootDir={rootDir} onOpenFile={onOpenFile} />
      <CssSection rootDir={rootDir} onOpenFile={onOpenFile} />
    </div>
  )
}
