// Indicador de trabajo del agente: reemplaza el "···" y las listas con símbolos sueltos.
//  - WorkCard:    tarjeta viva mientras el agente trabaja (estado + pasos + cronómetro)
//  - WorkSummary: resumen colapsable que queda en el chat cuando terminó
// Los estilos están en styles.css (clases work-*).
import React, { useEffect, useState, memo } from 'react'

// [verbo mientras corre, verbo al terminar, texto si falla]
const VERBS = {
  readfile:        ['Leyendo', 'Leyó', 'No se pudo leer'],
  grep:            ['Buscando', 'Buscó', 'Falló la búsqueda'],
  searchproject:   ['Buscando', 'Buscó', 'Falló la búsqueda'],
  glob:            ['Buscando archivos', 'Buscó archivos', 'Falló la búsqueda de archivos'],
  listdir:         ['Explorando', 'Exploró', 'No se pudo explorar'],
  tree:            ['Explorando', 'Exploró', 'No se pudo explorar'],
  run:             ['Ejecutando', 'Ejecutó', 'Falló al ejecutar'],
  searchweb:       ['Buscando en la web', 'Buscó en la web', 'Falló la búsqueda web'],
  fetchurl:        ['Leyendo la página', 'Leyó la página', 'No se pudo leer la página'],
  git:             ['Consultando git', 'Consultó git', 'Falló git'],
  createplan:      ['Armando un plan', 'Armó un plan', 'No se pudo armar el plan'],
  updateplan:      ['Actualizando el plan', 'Actualizó el plan', 'No se pudo actualizar el plan'],
  listplans:       ['Revisando los planes', 'Revisó los planes', 'No se pudieron revisar los planes'],
  undo:            ['Deshaciendo', 'Deshizo', 'No se pudo deshacer'],
  review:          ['Revisando', 'Revisó', 'Falló la revisión'],
  rename:          ['Renombrando', 'Renombró', 'No se pudo renombrar'],
  createcomponent: ['Creando un componente', 'Creó un componente', 'No se pudo crear el componente'],
  changelog:       ['Actualizando el changelog', 'Actualizó el changelog', 'No se pudo actualizar el changelog'],
  learn:           ['Guardando aprendizaje', 'Guardó un aprendizaje', 'No se pudo guardar'],
  remember:        ['Recordando', 'Recordó', 'No se pudo recordar'],
  experience:      ['Consultando experiencia', 'Consultó experiencia', 'Falló la consulta'],
  timeline:        ['Revisando el historial', 'Revisó el historial', 'Falló la consulta'],
  screenshot:      ['Capturando la pantalla', 'Capturó la pantalla', 'No se pudo capturar'],
}
const PATH_TOOLS = new Set(['readfile', 'listdir', 'tree', 'rename', 'createcomponent'])
const MAX_VISIBLE = 4

// Los argumentos pueden venir como texto ("src/App.jsx:10-30") o como JSON de function calling ({"path":"..."})
function plainDetail(detail) {
  const raw = String(detail ?? '').trim()
  if (!raw) return ''
  if (raw[0] === '{') {
    try {
      const o = JSON.parse(raw)
      const v = o.path ?? o.file ?? o.filePath ?? o.query ?? o.pattern ?? o.command ?? o.cmd ?? o.url ?? o.args
        ?? Object.values(o).find(x => typeof x === 'string')
      if (v != null) return String(v)
    } catch { /* texto plano */ }
  }
  return raw
}

function shortText(t, n = 44) {
  const s = String(t).replace(/\s+/g, ' ').trim()
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}

function shortPath(p) {
  const clean = String(p).replace(/:\d+(-\d+)?$/, '').replace(/\\/g, '/')
  const parts = clean.split('/').filter(Boolean)
  return parts.length > 2 ? '…/' + parts.slice(-2).join('/') : parts.join('/') || clean
}

/** { verb, target } en español para un paso del agente. row: { name, detail, status: 'run'|'ok'|'err' } */
export function describeStep(row) {
  const key = String(row?.name || '').toLowerCase()
  const [running, done, failed] = VERBS[key] || [row?.name || 'Trabajando', row?.name || 'Listo', `Falló ${row?.name || 'el paso'}`]
  const detail = plainDetail(row?.detail)
  const target = !detail ? '' : PATH_TOOLS.has(key) ? shortPath(detail) : shortText(detail)
  return { verb: row?.status === 'run' ? running : row?.status === 'err' ? failed : done, target }
}

/** 850 ms -> "<1 s", 3400 -> "3,4 s", 72000 -> "1 min 12 s" */
export function formatMs(ms) {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return ''
  if (ms < 1000) return '<1 s'
  const s = ms / 1000
  if (s < 10) return s.toFixed(1).replace('.', ',') + ' s'
  if (s < 60) return Math.round(s) + ' s'
  return Math.floor(s / 60) + ' min ' + Math.round(s % 60) + ' s'
}

export function StepIcon({ status }) {
  if (status === 'run') {
    return (
      <svg className="work-ico work-ico-run" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2" />
        <path d="M8 2a6 6 0 0 1 6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    )
  }
  if (status === 'err') {
    return (
      <svg className="work-ico work-ico-err" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity="0.16" />
        <path d="M5.5 5.5l5 5M10.5 5.5l-5 5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg className="work-ico work-ico-ok" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity="0.16" />
      <path d="M5 8.3l2.2 2.2L11 6.2" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function StepRow({ step }) {
  const { verb, target } = describeStep(step)
  return (
    <li className={`work-step work-step-${step.status}`}>
      <StepIcon status={step.status} />
      <span className="work-step-verb">{verb}</span>
      {target && <span className="work-step-target" title={plainDetail(step.detail)}>{target}</span>}
      {step.status !== 'run' && step.ms != null && <span className="work-step-ms">{formatMs(step.ms)}</span>}
    </li>
  )
}

export function StepList({ steps }) {
  return (
    <ol className="work-steps">
      {steps.map((s, i) => <StepRow key={s.id || i} step={s} />)}
    </ol>
  )
}

/** Tarjeta viva. steps: [{id,name,detail,status,ms}], startedAt: Date.now() del inicio */
export const WorkCard = memo(function WorkCard({ text, steps = [], startedAt }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(id)
  }, [])

  const running = steps.find(s => s.status === 'run')
  const headline = running ? describeStep(running).verb : (text || 'Pensando')
  const hidden = Math.max(0, steps.length - MAX_VISIBLE)
  const visible = steps.slice(-MAX_VISIBLE)

  return (
    <div className="work-card" role="status" aria-live="polite">
      <div className="work-head">
        <span className="work-orb" aria-hidden="true" />
        <span className="work-title">{headline}</span>
        <span className="work-elapsed">{formatMs(startedAt ? now - startedAt : null)}</span>
      </div>
      {visible.length > 0 && (
        <>
          {hidden > 0 && <div className="work-more">+{hidden} paso{hidden === 1 ? '' : 's'} anterior{hidden === 1 ? '' : 'es'}</div>}
          <StepList steps={visible} />
        </>
      )}
    </div>
  )
})

/** Resumen colapsable que queda en el chat al terminar. */
export function WorkSummary({ steps = [], totalMs }) {
  const n = steps.length
  const errs = steps.filter(s => s.status === 'err').length
  return (
    <details className="work-summary">
      <summary className="work-summary-head">
        <svg className="work-chevron" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
          <path d="M6 3.5L10.5 8 6 12.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span>Trabajó en {n} paso{n === 1 ? '' : 's'}</span>
        {totalMs != null && <span className="work-summary-time">· {formatMs(totalMs)}</span>}
        {errs > 0 && <span className="work-summary-err">{errs} con error</span>}
      </summary>
      <StepList steps={steps} />
    </details>
  )
}
