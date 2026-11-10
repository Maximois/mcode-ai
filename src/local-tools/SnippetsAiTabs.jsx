// Pestañas de la fase 3: Snippets (biblioteca local con validación) e IA local (redactor Ollama).
// La IA solo redacta texto y adapta nombres; vos revisás el resultado antes de usarlo.
import React, { useState, useEffect } from 'react'

const copy = (text) => navigator.clipboard?.writeText(text).then(() => true).catch(() => false)

// ── Snippets ────────────────────────────────────────────────────────────────
export function SnippetsTab({ rootDir, activeFilePath, ai, onInsertText }) {
  const lt = window.api.localTools
  const [list, setList] = useState(null)
  const [cat, setCat] = useState('')
  const [selId, setSelId] = useState('')
  const [values, setValues] = useState({})
  const [rendered, setRendered] = useState(null)
  const [adapted, setAdapted] = useState(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  useEffect(() => { lt.snippetList().then(setList).catch(() => setList({ ok: false, snippets: [] })) }, [lt])

  const snippets = list?.snippets || []
  const cats = [...new Set(snippets.map(s => s.category))]
  const visible = snippets.filter(s => !cat || s.category === cat)
  const sel = snippets.find(s => s.id === selId)

  // Render (y validación de sintaxis en el proceso principal) con un pequeño debounce
  useEffect(() => {
    if (!selId) { setRendered(null); return }
    setAdapted(null)
    const t = setTimeout(async () => {
      const r = await lt.snippetRender(selId, values).catch(e => ({ ok: false, error: e.message }))
      setRendered(r)
    }, 250)
    return () => clearTimeout(t)
  }, [lt, selId, values])

  const pick = (s) => { setSelId(s.id); setValues({}); setNote(''); setAdapted(null) }
  const finalCode = adapted?.code ?? rendered?.code

  const insert = () => {
    const ok = onInsertText?.(finalCode)
    setNote(ok ? 'Insertado en el cursor del editor' : 'Abrí un archivo en el editor para insertar')
  }
  const doCopy = async () => setNote((await copy(finalCode)) ? 'Copiado al portapapeles' : 'No se pudo copiar')
  const adapt = async () => {
    setBusy(true); setNote('')
    const r = await lt.snippetAdapt(rootDir, activeFilePath || null, selId, values, ai.url, ai.model).catch(e => ({ ok: false, error: e.message }))
    if (r.ok) setAdapted({ code: r.code })
    else setNote(r.error || 'No se pudo adaptar; queda el snippet original')
    setBusy(false)
  }

  if (!list) return <div className="lt-muted">Cargando snippets…</div>

  return (
    <div>
      <div className="lt-muted">Bloques listos y validados en local. La IA es opcional y solo adapta nombres.</div>
      <div className="lt-row">
        <select className="lt-select" value={cat} onChange={e => setCat(e.target.value)}>
          <option value="">Todas las categorías</option>
          {cats.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div className="lt-list" style={{ maxHeight: 140 }}>
        {visible.map(s => (
          <div key={s.id} className={'lt-item clickable' + (s.id === selId ? ' lt-selected' : '')} onClick={() => pick(s)}>
            <div>{s.title}{s.custom && <span className="lt-muted"> · propio</span>}</div>
            <div className="lt-muted">{s.category} · {s.language}</div>
          </div>
        ))}
      </div>

      {sel && (
        <div style={{ marginTop: 6 }}>
          <div className="lt-muted">{sel.description}</div>
          {sel.params.map(p => (
            <div key={p.name} className="lt-row">
              <span className="lt-muted" style={{ minWidth: 70 }}>{p.label}</span>
              <input value={values[p.name] ?? ''} placeholder={p.default} onChange={e => setValues(v => ({ ...v, [p.name]: e.target.value }))} />
            </div>
          ))}
          {sel.deps.length > 0 && <div className="lt-muted">Requiere: {sel.deps.join(', ')} → <code>npm install {sel.deps.join(' ')}</code></div>}

          {rendered && !rendered.ok && <div className="lt-err">{rendered.error}</div>}
          {rendered?.ok && !rendered.valid && <div className="lt-err">Error de sintaxis: {rendered.validationError}</div>}
          {rendered?.ok && rendered.valid && sel.validate && !adapted && <div className="lt-ok">✓ Sintaxis válida</div>}
          {adapted && <div className="lt-ok">✓ Adaptado por la IA local (sintaxis validada). Revisalo antes de insertar.</div>}

          {finalCode && <pre className="lt-pre">{finalCode}</pre>}

          <div className="lt-row">
            <button className="sb-btn" onClick={insert} disabled={!finalCode || rendered?.valid === false}>Insertar</button>
            <button className="sb-btn" onClick={doCopy} disabled={!finalCode}>Copiar</button>
            <button className="sb-btn" onClick={adapt} disabled={busy || !ai.ready || rendered?.valid === false}
              title={ai.ready ? 'Adapta nombres al archivo activo' : 'Ollama no disponible (ver pestaña IA local)'}>
              {busy ? 'Adaptando…' : '✨ Adaptar'}
            </button>
            {adapted && <button className="sb-btn" onClick={() => setAdapted(null)}>Original</button>}
          </div>
        </div>
      )}
      {note && <div className="lt-muted" style={{ marginTop: 4 }}>{note}</div>}
      <div className="lt-muted" style={{ marginTop: 6 }}>Snippets propios: archivos .snippet en <span className="lt-file">{list.customDir}</span></div>
    </div>
  )
}

// ── IA local (Ollama) ───────────────────────────────────────────────────────
export function AiTab({ rootDir, ai }) {
  const lt = window.api.localTools
  const [commit, setCommit] = useState('')
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')

  const genCommit = async () => {
    setBusy(true); setNote(''); setCommit('')
    const r = await lt.writerCommit(rootDir, ai.url, ai.model).catch(e => ({ ok: false, error: e.message }))
    if (r.ok) setCommit(r.text); else setNote(r.error)
    setBusy(false)
  }

  return (
    <div>
      <div className="lt-muted">La IA local solo redacta texto. Validar, escribir archivos y ejecutar lo hace código determinista, y todo lo que escribe lo revisás vos. Solo se conecta a Ollama en este equipo.</div>

      <div className="lt-section">Ollama</div>
      <div className={ai.ok ? 'lt-ok' : 'lt-err'}>
        {ai.checking ? 'Comprobando…' : ai.ok ? `● Conectado (${ai.models.length} modelos)` : '● No disponible'}
        <span className="lt-muted"> · {ai.url}</span>
      </div>
      {!ai.ok && !ai.checking && (
        <div className="lt-muted">{ai.error}. Instalá Ollama y descargá un modelo liviano, por ejemplo <code>ollama pull llama3.2:3b</code>. La URL se cambia en Ajustes.</div>
      )}
      <div className="lt-row">
        <select className="lt-select" value={ai.model} onChange={e => ai.setModel(e.target.value)} disabled={!ai.ok}>
          {ai.models.length === 0 && <option value="">(sin modelos)</option>}
          {ai.models.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <button className="sb-btn" onClick={ai.refresh} disabled={ai.checking}>↻</button>
      </div>

      <div className="lt-section">Mensaje de commit</div>
      <div className="lt-muted">Describe los cambios en stage (o, si no hay, los modificados). No hace el commit: solo te lo propone.</div>
      <div className="lt-row">
        <button className="sb-btn" onClick={genCommit} disabled={busy || !ai.ready}>{busy ? 'Redactando…' : 'Proponer mensaje'}</button>
      </div>
      {note && <div className="lt-err">{note}</div>}
      {commit && (
        <>
          <textarea className="lt-textarea" value={commit} onChange={e => setCommit(e.target.value)} rows={4} />
          <div className="lt-row"><button className="sb-btn" onClick={async () => setNote((await copy(commit)) ? '' : 'No se pudo copiar')}>Copiar</button></div>
        </>
      )}
    </div>
  )
}
