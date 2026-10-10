import { useState, useEffect, useCallback } from 'react'

export function useExtensions() {
  const [extensions, setExtensions] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [installQueue, setInstallQueue] = useState([])

  const refresh = useCallback(async () => {
    if (!window.api?.vsixList) return
    try {
      const list = await window.api.vsixList()
      setExtensions(list || [])
      setLoaded(true)
    } catch (e) {
      console.warn('Failed to list extensions:', e.message)
      setLoaded(true)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const installVsix = useCallback(async (filePath) => {
    setInstallQueue(p => [...p, filePath])
    try {
      const r = await window.api.vsixInstall(filePath)
      if (r.ok) {
        // La extensión se instaló correctamente.
        // La UI de Roo Code se carga desde extensionWorkbench.js
        // y se comunica via rooBridge.js, no necesita registrarse
        // en el extension host de monaco-vscode-api.
        await refresh()
        return { ok: true, id: r.id, name: r.name }
      }
      return { ok: false, error: r.error }
    } catch (e) {
      return { ok: false, error: e.message }
    } finally {
      setInstallQueue(p => p.filter(f => f !== filePath))
    }
  }, [refresh])

  const uninstall = useCallback(async (extId) => {
    const r = await window.api.vsixUninstall(extId)
    if (r.ok) await refresh()
    return r
  }, [refresh])

  const installViaDialog = useCallback(async () => {
    if (!window.api?.openVsix) return
    const paths = await window.api.openVsix()
    if (!paths) return
    const results = []
    for (const p of paths) {
      const r = await installVsix(p)
      results.push(r)
    }
    return results
  }, [installVsix])

  return { extensions, loaded, installQueue, refresh, installVsix, uninstall, installViaDialog }
}