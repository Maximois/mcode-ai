// Panel "Mapa": el mismo índice que lee la IA, pero visual. Módulos por tipo, buscador y archivos con
// resumen, tamaño, símbolos (clic = abrir) y relaciones. Estilos: clases pmap-* en styles.css.
import React, { useMemo, useState, memo } from 'react'
import { buildProjectMap } from './projectMap.js'

const ROLE_COLOR = {
  entry: '#9d8eff', ui: '#61afef', hooks: '#c678dd', logic: '#4ec9b0', main: '#e5c07b',
  styles: '#e06c75', scripts: '#d19a66', tests: '#98c379', config: '#7f8aa3', docs: '#8f9bb3', data: '#7f8aa3', other: '#667',
}
const KIND_MARK = { component: 'C', hook: 'H', fn: 'ƒ', class: 'K', const: '#' }
const fmt = n => (n >= 1000 ? (n / 1000).toFixed(1).replace('.0', '') + 'k' : String(n))

const FileRow = memo(function FileRow({ f, color, maxLines, open, onToggle, onOpenFile }) {
  const pct = Math.max(3, Math.round((f.lines / maxLines) * 100))
  return (
    <li className="pmap-file">
      <button className="pmap-file-head" onClick={onToggle} aria-expanded={open}>
        <span className="pmap-file-name" title={f.rel}>{f.name}</span>
        <span className="pmap-file-lines">{f.omitted ? 'grande' : fmt(f.lines)}</span>
        <span className="pmap-bar" aria-hidden="true"><span style={{ width: pct + '%', background: color }} /></span>
      </button>
      {open && (
        <div className="pmap-file-body">
          {f.summary && <div className="pmap-summary">{f.summary}</div>}
          <div className="pmap-path">{f.rel}</div>
          {(f.symbols.length > 0 || f.ipc.length > 0) && (
            <div className="pmap-syms">
              {f.symbols.filter(s => s.kind !== 'const' || s.exported).slice(0, 40).map(s => (
                <button key={s.name + s.line} className={`pmap-sym pmap-k-${s.kind}`} title={`${s.kind} · línea ${s.line}`} onClick={() => onOpenFile(f, s.line)}>
                  <i>{KIND_MARK[s.kind] || '·'}</i>{s.name}<em>{s.line}</em>
                </button>
              ))}
              {f.ipc.slice(0, 20).map(i => (
                <button key={i.name} className="pmap-sym pmap-k-ipc" title={`canal IPC · línea ${i.line}`} onClick={() => onOpenFile(f, i.line)}>
                  <i>⇄</i>{i.name}<em>{i.line}</em>
                </button>
              ))}
            </div>
          )}
          {(f.imports.length > 0 || f.usedBy.length > 0) && (
            <div className="pmap-rel">
              {f.imports.length > 0 && <div><b>usa</b> {f.imports.map(r => r.split('/').pop()).join(', ')}</div>}
              {f.usedBy.length > 0 && <div><b>lo usan</b> {f.usedBy.map(r => r.split('/').pop()).join(', ')}</div>}
            </div>
          )}
          <button className="pmap-open" onClick={() => onOpenFile(f)}>Abrir archivo</button>
        </div>
      )}
    </li>
  )
})

export default function ProjectMap({ projectFiles, rootDir, onOpen, loading }) {
  const map = useMemo(() => buildProjectMap(projectFiles), [projectFiles])
  const [query, setQuery] = useState('')
  const [openFile, setOpenFile] = useState(null)
  const [collapsed, setCollapsed] = useState(() => ({ docs: true, data: true, config: true, other: true }))
  const q = query.trim().toLowerCase()
  const maxLines = useMemo(() => Math.max(1, ...Object.values(map.files).map(f => f.lines)), [map])

  const modules = useMemo(() => map.modules.map(m => ({
    ...m,
    files: !q ? m.files : m.files.filter(f => f.rel.toLowerCase().includes(q) || f.summary.toLowerCase().includes(q) || f.symbols.some(s => s.name.toLowerCase().includes(q))),
  })).filter(m => m.files.length > 0), [map, q])

  const open = (f, line) => {
    const sep = rootDir && rootDir.includes('\\') ? '\\' : '/'
    onOpen?.({ path: rootDir ? rootDir.replace(/[\\/]$/, '') + sep + f.rel.split('/').join(sep) : f.rel, name: f.name, line })
  }

  if (!projectFiles) return <div className="pmap-empty">{loading ? 'Leyendo el proyecto…' : 'Abrí una carpeta para ver su mapa.'}</div>

  return (
    <div className="pmap">
      <div className="pmap-stats">
        <span><b>{map.stats.files}</b> archivos</span>
        <span><b>{fmt(map.stats.lines)}</b> líneas</span>
        {map.stats.core[0] && <span title="El archivo más importado">núcleo: <b>{map.stats.core[0].split('/').pop()}</b></span>}
      </div>
      <input className="pmap-search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar archivo, función o tema…" />
      <div className="pmap-legend" aria-hidden="true">
        {Object.entries(KIND_MARK).filter(([k]) => k !== 'const').map(([k, v]) => <span key={k}><i>{v}</i>{k === 'fn' ? 'función' : k === 'component' ? 'componente' : k === 'class' ? 'clase' : k}</span>)}
      </div>
      <div className="pmap-modules">
        {modules.map(m => {
          const isCollapsed = !q && collapsed[m.role]
          const color = ROLE_COLOR[m.role]
          return (
            <section key={m.role} className="pmap-module" style={{ '--pm': color }}>
              <button className="pmap-module-head" onClick={() => setCollapsed(p => ({ ...p, [m.role]: !p[m.role] }))} aria-expanded={!isCollapsed}>
                <span className="pmap-dot" />
                <span className="pmap-module-name">{m.label}</span>
                <span className="pmap-count">{m.files.length}</span>
                <span className="pmap-chev">{isCollapsed ? '▸' : '▾'}</span>
              </button>
              {!isCollapsed && (
                <>
                  {m.hint && !q && <div className="pmap-hint">{m.hint}</div>}
                  <ul className="pmap-files">
                    {m.files.map(f => (
                      <FileRow key={f.rel} f={f} color={color} maxLines={maxLines} open={openFile === f.rel || (!!q && m.files.length <= 3)}
                        onToggle={() => setOpenFile(p => (p === f.rel ? null : f.rel))} onOpenFile={open} />
                    ))}
                  </ul>
                </>
              )}
            </section>
          )
        })}
        {modules.length === 0 && <div className="pmap-empty">Nada coincide con “{query}”.</div>}
      </div>
    </div>
  )
}
