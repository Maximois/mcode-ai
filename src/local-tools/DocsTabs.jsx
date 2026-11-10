// Pestañas de la fase 2 del panel de herramientas locales: Índice, Docs y Nuevo (scaffolding).
// Todas trabajan 100% en local (Node.js vía window.api.localTools), sin llamar a ninguna API de IA.
import React, { useState, useEffect, useCallback } from 'react'

function baseName(p) { return String(p || '').split(/[\\/]/).pop() }
const KIND_LABEL = { class: 'clase', function: 'función', method: 'método', export: 'export' }
const KIND_ORDER = ['class', 'function', 'method', 'export']

// ── Índice de símbolos del archivo activo ───────────────────────────────────
export function IndexTab({ rootDir, activeFilePath }) {
  const lt = window.api.localTools
  const [data, setData] = useState(null)
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!activeFilePath) { setData(null); return }
    setLoading(true)
    const r = await lt.indexFile(rootDir, activeFilePath).catch(e => ({ ok: false, error: e.message }))
    setData(r)
    setLoading(false)
  }, [lt, rootDir, activeFilePath])

  useEffect(() => { load() }, [load])

  if (!activeFilePath) return <div className="lt-muted">Abrí un archivo para ver su índice.</div>

  const symbols = (data?.symbols || []).filter(s => !filter || s.name.toLowerCase().includes(filter.toLowerCase()))

  return (
    <div>
      <div className="lt-muted">Clases, funciones y exports de <span className="lt-file">{baseName(activeFilePath)}</span> (JS/TS/Python, análisis aproximado).</div>
      <div className="lt-row">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar por nombre…" />
        <button className="sb-btn" onClick={load} disabled={loading}>↻</button>
      </div>
      {data && !data.ok && <div className="lt-err">{data.error}</div>}
      {data?.ok && !data.supported && <div className="lt-muted">Tipo de archivo no soportado por el indexador.</div>}
      {data?.ok && data.supported && (
        <>
          <div className="lt-muted">{data.symbols.length} símbolos · {data.lines} líneas</div>
          <div className="lt-list">
            {KIND_ORDER.map(kind => {
              const group = symbols.filter(s => s.kind === kind)
              if (!group.length) return null
              return (
                <div key={kind}>
                  <div className="lt-muted" style={{ textTransform: 'uppercase', margin: '4px 0 2px' }}>{KIND_LABEL[kind]}s ({group.length})</div>
                  {group.map((s, i) => (
                    <div key={kind + i} className="lt-item lt-rule">
                      <span>{s.exported ? '↗ ' : ''}{s.name}</span>
                      <span className="lt-muted">L{s.line}</span>
                    </div>
                  ))}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// ── Documentación: README, JSDoc y licencias ────────────────────────────────
export function DocsTab({ rootDir, activeFilePath, onOpenFile }) {
  const lt = window.api.localTools
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [readme, setReadme] = useState(null)
  const [jsdoc, setJsdoc] = useState(null)
  const [lic, setLic] = useState(null)
  const [holder, setHolder] = useState('')
  const [license, setLicense] = useState('MIT')
  const [year, setYear] = useState(String(new Date().getFullYear()))

  const licOpts = { holder, license, year }

  const run = async (fn) => { setBusy(true); setNote(''); try { await fn() } catch (e) { setNote('Error: ' + e.message) } setBusy(false) }

  const previewReadme = () => run(async () => setReadme(await lt.readme(rootDir, 'preview')))
  const writeReadme = () => run(async () => {
    const r = await lt.readme(rootDir, 'write')
    setNote(r.ok ? `Escrito ${r.written}${r.written !== 'README.md' ? ' (ya existía un README.md; no se pisó)' : ''}` : r.error)
  })

  const previewJsdoc = () => run(async () => {
    const r = await lt.jsdocPreview(rootDir, activeFilePath)
    setJsdoc(r)
    if (!r.ok) setNote(r.error)
  })
  const applyJsdoc = () => run(async () => {
    if (!window.confirm(`Se insertarán ${jsdoc.count} bloques JSDoc en ${baseName(activeFilePath)}.\n\nGuardá antes los cambios pendientes del archivo. Se crea un snapshot previo para poder volver atrás en Rollbacks.`)) return
    const r = await lt.jsdocApply(rootDir, activeFilePath)
    if (r.ok) {
      setNote(`Insertados ${r.inserted} bloques. Snapshot previo guardado.`)
      setJsdoc(null)
      onOpenFile?.({ path: activeFilePath, name: baseName(activeFilePath) }) // refresca la pestaña si no tiene cambios sin guardar
    } else setNote(r.error)
  })

  const previewLic = () => run(async () => {
    const r = await lt.licensePreview(rootDir, licOpts)
    setLic(r)
    if (!r.ok) setNote(r.error)
  })
  const applyLic = () => run(async () => {
    if (!window.confirm(`Se agregará el encabezado de copyright a ${lic.count} archivos del proyecto.\n\nSe crea un snapshot previo para poder volver atrás en Rollbacks.`)) return
    const r = await lt.licenseApply(rootDir, licOpts)
    if (r.ok) { setNote(`Encabezado agregado a ${r.written} archivos. Snapshot previo guardado.`); setLic(null) }
    else setNote(r.error)
  })

  return (
    <div>
      {note && <div className="lt-muted" style={{ marginBottom: 4 }}>{note}</div>}

      <div className="lt-section">README</div>
      <div className="lt-muted">Se genera desde package.json y la estructura. Nunca pisa un README.md existente.</div>
      <div className="lt-row">
        <button className="sb-btn" onClick={previewReadme} disabled={busy}>Previsualizar</button>
        <button className="sb-btn" onClick={writeReadme} disabled={busy}>Escribir</button>
      </div>
      {readme?.ok && <pre className="lt-pre">{readme.markdown}</pre>}

      <div className="lt-section">JSDoc del archivo activo</div>
      <div className="lt-muted">{activeFilePath ? <>Documenta funciones sin JSDoc en <span className="lt-file">{baseName(activeFilePath)}</span>.</> : 'Abrí un archivo JS/TS.'}</div>
      <div className="lt-row">
        <button className="sb-btn" onClick={previewJsdoc} disabled={busy || !activeFilePath}>Previsualizar</button>
        <button className="sb-btn" onClick={applyJsdoc} disabled={busy || !jsdoc?.count}>Aplicar ({jsdoc?.count || 0})</button>
      </div>
      {jsdoc?.ok && (jsdoc.count === 0
        ? <div className="lt-ok">✓ Todas las funciones ya tienen JSDoc</div>
        : <pre className="lt-pre">{jsdoc.items.slice(0, 3).map(i => `// línea ${i.line}\n${i.block}`).join('\n\n')}{jsdoc.count > 3 ? `\n\n… y ${jsdoc.count - 3} más` : ''}</pre>)}

      <div className="lt-section">Encabezado de licencia</div>
      <div className="lt-muted">Agrega copyright + SPDX a los .js/.ts/.css/.py del proyecto. Omite los que ya lo tienen.</div>
      <div className="lt-row">
        <input value={holder} onChange={e => { setHolder(e.target.value); setLic(null) }} placeholder="Titular, ej: MC SERVICES" maxLength={80} />
      </div>
      <div className="lt-row">
        <select className="lt-select" value={license} onChange={e => { setLicense(e.target.value); setLic(null) }}>
          {['MIT', 'Apache-2.0', 'ISC', 'BSD-3-Clause', 'GPL-3.0-only', 'Proprietary'].map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <input style={{ maxWidth: 70 }} value={year} onChange={e => { setYear(e.target.value); setLic(null) }} placeholder="Año" />
      </div>
      <div className="lt-row">
        <button className="sb-btn" onClick={previewLic} disabled={busy || !holder.trim()}>Previsualizar</button>
        <button className="sb-btn" onClick={applyLic} disabled={busy || !lic?.count}>Aplicar ({lic?.count || 0})</button>
      </div>
      {lic?.ok && (
        <div className="lt-item">
          <div>{lic.count} archivos a modificar · {lic.skipped} omitidos</div>
          <pre className="lt-pre">{lic.example}</pre>
          {lic.sample.map(f => <div key={f} className="lt-muted">{f}</div>)}
        </div>
      )}
    </div>
  )
}

// ── Scaffolding desde plantillas JSON ───────────────────────────────────────
export function ScaffoldTab({ rootDir }) {
  const lt = window.api.localTools
  const [tpls, setTpls] = useState(null)
  const [sel, setSel] = useState('')
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    lt.scaffoldList().then(r => { setTpls(r); if (r?.templates?.length) setSel(s => s || r.templates[0].id) }).catch(() => {})
  }, [lt])

  const current = tpls?.templates?.find(t => t.id === sel)

  const create = async () => {
    setBusy(true); setNote('')
    const r = await lt.scaffoldCreate(rootDir, sel, name.trim())
    setNote(r.ok ? `Creado "${name.trim()}" con ${r.created.length} archivos dentro del proyecto abierto.` : r.error)
    if (r.ok) setName('')
    setBusy(false)
  }

  if (!tpls) return <div className="lt-muted">Cargando plantillas…</div>
  return (
    <div>
      <div className="lt-muted">Crea una carpeta nueva con archivos base dentro del proyecto abierto. No sobrescribe carpetas con contenido.</div>
      <div className="lt-row">
        <select className="lt-select" value={sel} onChange={e => setSel(e.target.value)}>
          {tpls.templates.map(t => <option key={t.id} value={t.id}>{t.label}{t.custom ? ' (propia)' : ''}</option>)}
        </select>
      </div>
      {current && <div className="lt-muted">{current.description} · {current.files.join(', ')}</div>}
      <div className="lt-row">
        <input value={name} onChange={e => setName(e.target.value)} placeholder="Nombre de la carpeta"
          onKeyDown={e => { if (e.key === 'Enter' && name.trim() && !busy) create() }} />
        <button className="sb-btn" onClick={create} disabled={busy || !name.trim() || !sel}>Crear</button>
      </div>
      {note && <div className="lt-muted">{note}</div>}
      <div className="lt-muted" style={{ marginTop: 6 }}>Plantillas propias: archivos .json con <code>files</code> en <span className="lt-file">{tpls.customDir}</span></div>
    </div>
  )
}
