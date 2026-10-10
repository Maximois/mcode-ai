import { useState, useEffect } from 'react'

const KEY = 'mcap_settings_v5'

const defaults = {
  provider: 'auto',
  models: {
    ollama:    'llama3.2:3b',
    groq:      'llama-3.1-8b-instant',
    gemini:    'gemini-2.5-flash',   // gratis, 1M ctx, recomendado
    openrouter:'meta-llama/llama-3.1-8b-instruct:free',
    zen:       'big-pickle',
    cerebras:  'llama-3.3-70b',
    mistral:   'codestral-latest',
    sambanova: 'Meta-Llama-3.3-70B-Instruct',
    fireworks: 'accounts/fireworks/models/llama-v3p1-8b-instruct',
    deepseek:  'deepseek-chat',
    nvidia:    'meta/llama-3.1-405b-instruct',
  },
  apiKeys: { groq: '', gemini: '', openrouter: '', zen: '', cerebras: '', mistral: '', sambanova: '', fireworks: '', deepseek: '', nvidia: '' },
  // Pipeline: 3 independent stages (Reader → Fixer → Reviewer)
  // Each stage can use a different provider+key so you don't saturate one account
  pipelineStages: [
    { provider: 'groq',   key: '', model: 'llama-3.1-8b-instant' },
    { provider: 'groq',   key: '', model: 'llama-3.3-70b-versatile' },
    { provider: 'groq',   key: '', model: 'llama-3.1-8b-instant' },
  ],
  fontSize: 14,
  ollamaUrl: 'http://localhost:11434',
  autocomplete: true,
  inlineErrors: true,
  pipeline: false,
  /** Modo Agente: más rondas de herramientas + trazas (desactiva lógica extra si Pipeline está ON) */
  agentMode: true,
  /** Máx. rondas tool→modelo con Modo Agente (4–24; fuera de agente siempre 4) */
  agentToolRounds: 10,
  /** Aplicar al disco PATCH/WRITE/CREATE del asistente sin clic */
  autoApplyAiPatches: true,
  /** Ejecutar bloques RUN automáticamente (riesgo: comandos arbitrarios) */
  autoApplyAiRun: false,
  /** Intel proyecto: proceso hijo Node (menos carga en Electron; requiere `node` en PATH) */
  reverseIntelSandboxMode: 'host-direct',
  /** Por defecto ejecutar npm audit en análisis (usa red del registry npm) */
  reverseIntelNpmAudit: false,
  /** Muestreo file(1)/strings(1) en binarios detectados (útil con imagen docker:intel-image) */
  reverseIntelBinaryStrings: false,
  wordWrap: 'on',
  minimap: false,
  theme: 'vs-dark',
  outputDir: '',
}

export function useSettings() {
  const [settings, setSettings] = useState(defaults)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      if (window.api?.settingsLoad) {
        try {
          const s = await window.api.settingsLoad()
          if (s && typeof s === 'object') {
            setSettings({
              ...defaults,
              ...s,
              models:         { ...defaults.models,         ...s.models         },
              apiKeys:        { ...defaults.apiKeys,        ...s.apiKeys        },
              pipelineStages: s.pipelineStages || defaults.pipelineStages,
            })
          }
        } catch (e) {
          console.warn('Failed to load settings from main process:', e.message)
        }
      } else {
        try {
          const s = JSON.parse(localStorage.getItem(KEY) || '{}')
          setSettings({
            ...defaults,
            ...s,
            models:         { ...defaults.models,         ...s.models         },
            apiKeys:        { ...defaults.apiKeys,        ...s.apiKeys        },
            pipelineStages: s.pipelineStages || defaults.pipelineStages,
          })
        } catch {}
      }
      setLoaded(true)
    }
    loadSettings()
  }, [])

  useEffect(() => {
    if (!loaded) return
    if (window.api?.settingsSave) {
      window.api.settingsSave(settings).catch(() => {})
    } else {
      localStorage.setItem(KEY, JSON.stringify(settings))
    }
  }, [settings, loaded])

  return {
    settings,
    updateSettings: patch => setSettings(p => ({ ...p, ...patch })),
    setApiKey:  (prov, key)       => setSettings(p => ({ ...p, apiKeys: { ...p.apiKeys, [prov]: key } })),
    setModel:   (prov, model)     => setSettings(p => ({ ...p, models:  { ...p.models,  [prov]: model } })),
    setPipelineStage: (idx, patch) => setSettings(p => {
      const stages = [...(p.pipelineStages || defaults.pipelineStages)]
      stages[idx] = { ...stages[idx], ...patch }
      return { ...p, pipelineStages: stages }
    }),
  }
}
