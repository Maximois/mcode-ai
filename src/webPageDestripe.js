/**
 * Formatea el resultado del script PAGE_DESTRIPE (intel web / “destripe”).
 */

export function formatDestripeLogLine(payload) {
  if (!payload?.pageUrl) return ''
  const nScript = payload.scripts?.external?.length ?? 0
  const nCss = payload.stylesheets?.length ?? 0
  const nImg = payload.media?.images?.length ?? 0
  const nTx = payload.transmissionHintsFromMarkup?.length ?? 0
  const nMani = payload.streamingManifestHints?.length ?? 0
  const origins = payload.originsSummary ? Object.keys(payload.originsSummary).length : 0
  return `[WEB] destripe url=${payload.pageUrl} scripts=${nScript} css=${nCss} img=${nImg} origins=${origins} tx_hints=${nTx} manifests=${nMani}`
}

export function formatDestripeMarkdown(payload) {
  if (!payload || !payload.pageUrl) return '_Sin datos de destripe._'

  const lines = []
  lines.push('## Destripe web (orígenes y activos)')
  lines.push(`**URL:** \`${payload.pageUrl}\``)
  if (payload.documentTitle) lines.push(`**Título:** ${payload.documentTitle}`)
  if (payload.baseHref) lines.push(`**Base:** \`${payload.baseHref}\``)
  lines.push('')

  lines.push('### Scripts externos')
  ;(payload.scripts?.external || []).slice(0, 40).forEach((u) => lines.push(`- \`${u}\``))
  if ((payload.scripts?.external || []).length > 40) lines.push(`- … +${payload.scripts.external.length - 40} más`)
  lines.push(`- *inline:* ${payload.scripts?.inlineCount ?? 0} bloques`)
  lines.push('')

  lines.push('### Estilos (CSS)')
  ;(payload.stylesheets || []).slice(0, 30).forEach((u) => lines.push(`- \`${u}\``))
  lines.push('')

  lines.push('### Preload / prefetch / fuentes declaradas')
  const pre = payload.hints?.preload || []
  pre.slice(0, 25).forEach((x) => lines.push(`- preload **${x.as || '?'}** → \`${x.url}\``))
  ;(payload.hints?.modulepreload || []).slice(0, 15).forEach((u) => lines.push(`- modulepreload \`${u}\``))
  ;(payload.hints?.preconnect || []).slice(0, 15).forEach((u) => lines.push(`- preconnect \`${u}\``))
  ;(payload.hints?.dnsPrefetch || []).slice(0, 15).forEach((u) => lines.push(`- dns-prefetch \`${u}\``))
  lines.push('')
  lines.push('### Fuentes (preload font + recursos tipo fuente en Performance)')
  ;(payload.fonts || []).slice(0, 35).forEach((u) => lines.push(`- \`${u}\``))
  lines.push('')

  lines.push('### Multimedia (DOM)')
  lines.push(`**Imágenes (${payload.media?.images?.length || 0}):**`)
  ;(payload.media?.images || []).slice(0, 25).forEach((u) => lines.push(`- \`${u}\``))
  lines.push(`**Video:** ${(payload.media?.videos || []).length} · **Audio:** ${(payload.media?.audios || []).length}`)
  ;(payload.media?.videos || []).slice(0, 15).forEach((u) => lines.push(`- video \`${u}\``))
  ;(payload.media?.audios || []).slice(0, 15).forEach((u) => lines.push(`- audio \`${u}\``))
  lines.push('')

  lines.push('### Marcos / incrustaciones')
  ;(payload.frames || []).slice(0, 20).forEach((u) => lines.push(`- \`${u}\``))
  lines.push('')

  if (payload.ogTwitterMedia?.length) {
    lines.push('### Open Graph / Twitter (URLs en meta)')
    payload.ogTwitterMedia.slice(0, 15).forEach((x) => lines.push(`- **${x.prop}:** \`${x.url}\``))
    lines.push('')
  }

  if (payload.cspMeta?.length) {
    lines.push('### CSP (meta, truncado)')
    payload.cspMeta.forEach((c) => lines.push(`\`\`\`\n${c.slice(0, 1200)}\n\`\`\``))
    lines.push('')
  }

  lines.push('### Performance API (initiatorType → orígenes)')
  const bt = payload.performance?.byInitiatorType || {}
  Object.keys(bt).sort().forEach((k) => {
    const o = bt[k].origins || {}
    const top = Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, 6)
    lines.push(`- **${k}** (${bt[k].count}): ${top.map(([origin, n]) => `${origin}×${n}`).join(', ') || '—'}`)
  })
  lines.push('')

  lines.push('### Manifiestos streaming detectados (HLS/DASH — heurística)')
  lines.push('*Referencia técnica: útil para armar reproductores simples cuando el contenido es público y el origen lo permite; muchos streams usan tokens, cookies o DRM — verificar términos del emisor.*')
  const mans = payload.streamingManifestHints || []
  if (mans.length === 0) lines.push('- *(ninguno por patrón .m3u8/.m3u/.mpd/manifest/playlist)*')
  else mans.slice(0, 50).forEach((u) => lines.push(`- \`${u}\``))
  lines.push('')

  lines.push('### Patrones de transmisión / URLs en HTML (heurística)')
  lines.push('*URLs literales en markup (puede incluir WS/API/cdn); revisar falsos positivos.*')
  ;(payload.transmissionHintsFromMarkup || []).slice(0, 45).forEach((u) => lines.push(`- \`${u}\``))
  lines.push('')

  lines.push('### Resumen por origen (conteo por tipo)')
  const os = payload.originsSummary || {}
  Object.keys(os).sort().forEach((origin) => {
    const t = os[origin]
    const parts = Object.keys(t).map((k) => `${k}:${t[k]}`)
    lines.push(`- **${origin}** → ${parts.join(', ')}`)
  })

  return lines.join('\n')
}

/**
 * Prioridad: webview del navegador integrado (si está visible y cargado) → ventana Preview del dev server.
 */
export async function fetchLiveWebSnapshots({ showBrowser, browserSurface }) {
  const out = { snapshot: null, source: null }
  try {
    const wcId = browserSurface?.wcId
    const url = browserSurface?.url || ''
    if (showBrowser && wcId && url && url !== 'about:blank') {
      const snap = await window.api?.webviewGetSnapshot?.({
        webContentsId: wcId,
        maxHtml: 160000,
        maxText: 100000,
      })
      if (snap?.ok && (snap.html || snap.text)) {
        out.snapshot = {
          title: snap.title,
          url: snap.url,
          html: snap.html || '',
          text: snap.text || '',
          htmlTruncated: !!snap.htmlTruncated,
          textTruncated: !!snap.textTruncated,
        }
        out.source = 'webview_integrado'
        return out
      }
    }
  } catch (_) {}
  try {
    const ps = await window.api?.previewPageSnapshot?.({ maxHtml: 160000, maxText: 100000 })
    if (ps?.ok && (ps.html || ps.text)) {
      out.snapshot = {
        title: ps.title,
        url: ps.url,
        html: ps.html || '',
        text: ps.text || '',
        htmlTruncated: !!ps.htmlTruncated,
        textTruncated: !!ps.textTruncated,
      }
      out.source = 'ventana_preview_dev'
      return out
    }
  } catch (_) {}
  return out
}
