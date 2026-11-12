import React, { useRef, useEffect, useState } from 'react'
import { initVscodeApi } from './editorServices.js'

let initPromise = null
function ensureApi() {
  if (!initPromise) {
    initPromise = initVscodeApi()
  }
  return initPromise
}

export default function Editor({ activeTab, editorRef: editorRefProp, onChange, options }) {
  const containerRef = useRef(null)
  const innerRef = useRef(null)
  const [initError, setInitError] = useState(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let editor = null
    let cancelled = false

    ;(async () => {
      try {
        await ensureApi()
        if (cancelled) return
        const monaco = await import('monaco-editor/esm/vs/editor/editor.api.js')
        if (cancelled) return

        editor = monaco.editor.create(container, {
          value: activeTab?.content || '',
          language: activeTab?.language || 'plaintext',
          theme: 'vs-dark',
          automaticLayout: true,
          ...options,
        })
        innerRef.current = editor
        if (editorRefProp) editorRefProp.current = editor
        setInitError(null)

        editor.onDidChangeModelContent(() => {
          if (onChange) onChange(editor.getValue())
        })
      } catch (err) {
        console.error('[Editor] Initialization failed:', err)
        setInitError(err.message || 'Editor initialization failed')
        if (!cancelled) {
          container.innerHTML = `<div style="color: red; padding: 20px; font-family: monospace;">⚠️ Editor Error: ${err.message}</div>`
        }
      }
    })()

    return () => {
      cancelled = true
      if (editor) {
        editor.dispose()
        innerRef.current = null
        if (editorRefProp) editorRefProp.current = null
      }
    }
  }, [])

  useEffect(() => {
    const editor = innerRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return

    if (activeTab?.content !== undefined && activeTab.content !== model.getValue()) {
      model.setValue(activeTab.content)
    }
  }, [activeTab?.id, activeTab?.content])

  useEffect(() => {
    const editor = innerRef.current
    if (!editor) return
    const model = editor.getModel()
    if (!model) return
    if (activeTab?.language) {
      import('monaco-editor/esm/vs/editor/editor.api.js').then(monaco => {
        monaco.editor.setModelLanguage(model, activeTab.language)
      })
    }
  }, [activeTab?.language])

  return (
    <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
  )
}
