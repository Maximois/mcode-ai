// Validación local siempre activa (cero tokens) + marcas de error en el editor Monaco.
// Vive en App (no en el panel) para que las marcas funcionen con el panel cerrado.
//   useLocalValidation  → { [rutaNormalizada]: { path, errors:[{line,col,message}] } }
//   useEditorMarkers    → pinta esos errores en el editor del archivo activo
import { useState, useEffect, useCallback } from 'react'

const SKIP = /(^|[\\/])(node_modules|\.git|dist|dist-electron|build|out|__pycache__)([\\/]|$)/
const EXT = ['json', 'yml', 'yaml', 'js', 'mjs', 'cjs']
const OWNER = 'local-tools'

export const normPath = (p) => String(p || '').replace(/\\/g, '/').toLowerCase()

function joinPath(dir, file) {
  const sep = dir.includes('\\') ? '\\' : '/'
  return dir.replace(/[\\/]+$/, '') + sep + file
}
const supported = (file) => EXT.includes(String(file).split('.').pop()?.toLowerCase())

export function useLocalValidation({ rootDir, enabled, activeFilePath }) {
  const [problems, setProblems] = useState({})

  const validate = useCallback(async (full) => {
    const lt = window.api?.localTools
    if (!lt || !full) return
    const r = await lt.validate(full).catch(() => null)
    if (!r) return
    setProblems(p => {
      const key = normPath(full)
      const n = { ...p }
      if (r.ok || !r.errors?.length) delete n[key]
      else n[key] = { path: full, errors: r.errors }
      return n
    })
  }, [])

  useEffect(() => { setProblems({}) }, [rootDir])

  // Al guardar (o cuando el agente escribe en disco): escucha el watcher que App ya inicia
  useEffect(() => {
    if (!enabled || !rootDir || !window.api?.onFileChanged) return
    const timers = new Map()
    const unsub = window.api.onFileChanged((m) => {
      if (!m || !m.file || SKIP.test(m.file) || !supported(m.file)) return
      const full = joinPath(m.dir || rootDir, m.file)
      clearTimeout(timers.get(full))
      timers.set(full, setTimeout(() => { timers.delete(full); validate(full) }, 500))
    })
    return () => { unsub?.(); timers.forEach(clearTimeout) }
  }, [enabled, rootDir, validate])

  // Al abrir o cambiar de archivo: validar una vez para que un archivo ya roto se marque enseguida
  useEffect(() => {
    if (!enabled || !activeFilePath || !supported(activeFilePath) || SKIP.test(activeFilePath)) return
    validate(activeFilePath)
  }, [enabled, activeFilePath, validate])

  return problems
}

// Las marcas reflejan el archivo GUARDADO: si la pestaña tiene cambios sin guardar se ocultan
// (los números de línea podrían estar desplazados) y vuelven al guardar y revalidar.
export function useEditorMarkers({ editorRef, activeTab, problems, enabled }) {
  const filePath = activeTab?.filePath
  const dirty = !!activeTab?.dirty
  const entry = filePath ? problems[normPath(filePath)] : null

  useEffect(() => {
    let cancelled = false
    let timer = null
    let attempts = 0

    const apply = async () => {
      const editor = editorRef?.current
      const model = editor?.getModel?.()
      if (!model) {
        // El editor de Monaco se crea de forma asíncrona: reintentar unos instantes
        if (!cancelled && ++attempts <= 20) timer = setTimeout(apply, 150)
        return
      }
      const monaco = await import('monaco-editor/esm/vs/editor/editor.api.js')
      if (cancelled) return
      const show = enabled && entry && !dirty
      if (!show) { monaco.editor.setModelMarkers(model, OWNER, []); return }
      const last = model.getLineCount()
      const markers = entry.errors.slice(0, 20).map((e) => {
        const line = Math.min(Math.max(1, e.line || 1), last)
        return {
          severity: monaco.MarkerSeverity.Error,
          message: e.message,
          source: 'Herramientas locales',
          startLineNumber: line,
          startColumn: model.getLineFirstNonWhitespaceColumn(line) || 1,
          endLineNumber: line,
          endColumn: model.getLineMaxColumn(line),
        }
      })
      monaco.editor.setModelMarkers(model, OWNER, markers)
    }
    apply()

    return () => {
      cancelled = true
      clearTimeout(timer)
      // Limpiar las marcas del modelo actual al cambiar de archivo o desactivar
      const model = editorRef?.current?.getModel?.()
      if (model) import('monaco-editor/esm/vs/editor/editor.api.js').then(m => m.editor.setModelMarkers(model, OWNER, [])).catch(() => {})
    }
  }, [editorRef, enabled, entry, dirty, filePath, activeTab?.id])
}
