import { useState, useCallback } from 'react'

const EXT_LANG = {
  py:'python', js:'javascript', jsx:'javascript', ts:'typescript', tsx:'typescript',
  html:'html', css:'css', json:'json', md:'markdown', sh:'shell', bash:'shell',
  rs:'rust', go:'go', cpp:'cpp', c:'c', java:'java', rb:'ruby', php:'php',
  vue:'html', scss:'css', sass:'css', txt:'plaintext',
}

export function getLang(name) {
  return EXT_LANG[name.split('.').pop()?.toLowerCase()] || 'plaintext'
}

export function useTabs() {
  const [tabs, setTabs] = useState([])
  const [activeId, setActiveId] = useState(null)

  const activeTab = tabs.find(t => t.id === activeId) || null

  const openDiskFile = useCallback(async (entry) => {
    const existing = tabs.find(t => t.filePath === entry.path)
    let content = null
    if (window.api) {
      const r = await window.api.readFile(entry.path)
      if (r.ok) content = r.content
    }
    if (existing) {
      if (!existing.dirty && content !== null && content !== existing.content) {
        setTabs(p => p.map(t => t.filePath === entry.path
          ? { ...t, content, name: entry.name, language: getLang(entry.name), dirty: false }
          : t
        ))
      }
      setActiveId(existing.id)
      return
    }
    const id = 'f_' + Date.now()
    setTabs(p => [...p, { id, name: entry.name, language: getLang(entry.name), filePath: entry.path, content: content ?? '', dirty: false }])
    setActiveId(id)
  }, [tabs])

  const saveTab = useCallback(async (tab) => {
    if (!tab || !window.api) return false
    if (tab.filePath) {
      const r = await window.api.writeFile({ p: tab.filePath, content: tab.content })
      if (r.ok) { setTabs(p => p.map(t => t.id === tab.id ? { ...t, dirty: false } : t)); return true }
    } else {
      const fp = await window.api.saveFile(tab.name, tab.content)
      if (fp) {
        setTabs(p => p.map(t => t.id === tab.id ? { ...t, filePath: fp, name: fp.split(/[\\/]/).pop(), dirty: false } : t))
        return true
      }
    }
    return false
  }, [])

  const closeTab = useCallback((id) => {
    setTabs(p => {
      const idx = p.findIndex(t => t.id === id)
      const next = p.filter(t => t.id !== id)
      if (activeId === id) {
        const fallback = next[Math.max(0, idx - 1)]
        setActiveId(fallback ? fallback.id : null)
      }
      return next
    })
  }, [activeId])

  const updateContent = useCallback((id, content) => {
    setTabs(p => p.map(t => t.id === id ? { ...t, content, dirty: true } : t))
  }, [])

  const newTab = useCallback((name = 'nuevo.py') => {
    const id = 'n_' + Date.now()
    setTabs(p => [...p, { id, name, language: getLang(name), filePath: null, content: '', dirty: false }])
    setActiveId(id)
  }, [])

  return { tabs, activeTab, activeId, setActiveId, openDiskFile, saveTab, closeTab, updateContent, newTab }
}
