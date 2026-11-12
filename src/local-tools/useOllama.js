// Estado del Ollama local para las herramientas (solo localhost; lo exige el proceso principal).
import { useState, useEffect, useCallback } from 'react'

export function useOllama(settings) {
  const url = settings?.ollamaUrl || 'http://localhost:11434'
  const [model, setModel] = useState(settings?.models?.ollama || '')
  const [state, setState] = useState({ checking: false, ok: false, models: [], error: '' })

  const refresh = useCallback(async () => {
    const lt = window.api?.localTools
    if (!lt) return
    setState(s => ({ ...s, checking: true }))
    try {
      const r = await lt.ollamaStatus(url)
      if (r?.ok) {
        setState({ checking: false, ok: true, models: r.models, error: '' })
        // Si el modelo guardado no está instalado, usar el primero disponible
        setModel(m => (m && r.models.includes(m)) ? m : (r.models[0] || m))
      } else setState({ checking: false, ok: false, models: [], error: r?.error || 'Sin respuesta' })
    } catch (e) {
      setState({ checking: false, ok: false, models: [], error: e.message })
    }
  }, [url])

  useEffect(() => { refresh() }, [refresh])

  return { url, model, setModel, ...state, ready: state.ok && !!model, refresh }
}
