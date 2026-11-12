import { useState, useEffect, useCallback } from 'react'

const KEY = 'mcap_memory_v1'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export function useMemory() {
  const [memories, setMemories] = useState(load)
  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify(memories)) } catch {}
  }, [memories])

  const remember = useCallback((projectPath, userMsg, aiMsg, activeFile) => {
    const user = userMsg.replace(/```[\s\S]*?```/g, '[codigo]').slice(0, 120).trim()
    const ai = aiMsg.replace(/```[\s\S]*?```/g, '[codigo]').slice(0, 150).trim()
    if (!user || !ai) return
    setMemories(prev => [{
      id: Date.now(),
      ts: new Date().toISOString(),
      project: projectPath ? projectPath.split(/[\\/]/).pop() : null,
      projectPath: projectPath || null,
      file: activeFile || null,
      user, ai,
    }, ...prev].slice(0, 150))
  }, [])

  const getRelevantMemories = useCallback((projectPath, activeFile, limit = 5) => {
    const name = projectPath ? projectPath.split(/[\\/]/).pop() : null
    return memories.filter(m =>
      (projectPath && m.projectPath === projectPath) ||
      (name && m.project === name) ||
      (activeFile && m.file === activeFile)
    ).slice(0, limit)
  }, [memories])

  const clearMemories = useCallback((projectPath) => {
    if (projectPath) {
      const name = projectPath.split(/[\\/]/).pop()
      setMemories(prev => prev.filter(m => m.projectPath !== projectPath && m.project !== name))
    } else {
      setMemories([])
    }
  }, [])

  return { memories, remember, getRelevantMemories, clearMemories }
}
