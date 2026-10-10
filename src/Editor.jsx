import React, { useRef, useEffect } from 'react'
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

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let editor = null
    let cancelled = false

    ;(async () => {
      await ensureApi()
      if (cancelled) return
      const monaco = await import('monaco-editor/esm/vs/editor/editor.api.js')
      if (cancelled) return

      editor = monaco.editor.create(container, {
        value: activeTab?.content || '',
        language: activeTab?.language || 'plaintext',
        theme: 'vs-dark',
        ...options,
      })
      innerRef.current = editor
      if (editorRefProp) editorRefProp.current = editor

      editor.onDidChangeModelContent(() => {
        if (onChange) onChange(editor.getValue())
      })
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

  return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
}
