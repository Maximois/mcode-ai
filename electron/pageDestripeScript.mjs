/**
 * Inyectado en páginas web (webview / Preview): inventario de orígenes de red,
 * multimedia, fuentes y recursos observados (similar a “stripping” / intel web).
 * Expone también window.__MCAP_DESTRIPE_LAST__ para executeJavaScript desde main.
 */
export const PAGE_DESTRIPE = `
(function(){
  function abs(u, base) {
    try { return new URL(u, base || document.baseURI).href } catch(e){ return null }
  }
  function uniq(arr) {
    var seen = {}, out = []
    for (var i = 0; i < arr.length; i++) {
      var x = arr[i]
      if (!x || seen[x]) continue
      seen[x] = 1
      out.push(x)
    }
    return out
  }
  function originOf(url) {
    try { return new URL(url).origin } catch(e){ return '' }
  }
  function parseSrcset(ss) {
    if (!ss || typeof ss !== 'string') return []
    var parts = ss.split(/\\s*,\\s*/)
    var urls = []
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i].trim().split(/\\s+/)[0]
      if (p) {
        var u = abs(p)
        if (u) urls.push(u)
      }
    }
    return urls
  }

  var pageUrl = String(location.href || '')
  var baseEl = document.querySelector('base[href]')
  var baseHref = baseEl ? abs(baseEl.getAttribute('href')) : abs('', pageUrl)

  var scripts = { external: [], inline: 0 }
  document.querySelectorAll('script[src]').forEach(function(s) {
    var u = abs(s.getAttribute('src'))
    if (u) scripts.external.push(u)
  })
  document.querySelectorAll('script:not([src])').forEach(function() { scripts.inline++ })

  var stylesheets = []
  document.querySelectorAll('link[rel~=stylesheet][href]').forEach(function(l) {
    var u = abs(l.getAttribute('href'))
    if (u) stylesheets.push(u)
  })

  var hints = { preload: [], prefetch: [], modulepreload: [], preconnect: [], dnsPrefetch: [] }
  document.querySelectorAll('link[rel][href]').forEach(function(l) {
    var rel = (l.getAttribute('rel') || '').toLowerCase().trim()
    var href = l.getAttribute('href')
    var u = abs(href)
    if (!u) return
    var as = (l.getAttribute('as') || '').trim()
    if (rel === 'preload') hints.preload.push({ url: u, as: as })
    else if (rel === 'prefetch') hints.prefetch.push(u)
    else if (rel === 'modulepreload') hints.modulepreload.push(u)
    else if (rel === 'preconnect') hints.preconnect.push(u)
    else if (rel === 'dns-prefetch') hints.dnsPrefetch.push(u)
  })

  var images = []
  document.querySelectorAll('img[src],img[data-src]').forEach(function(img) {
    ;['src','data-src'].forEach(function(attr) {
      var v = img.getAttribute(attr)
      if (v) {
        var u = abs(v)
        if (u) images.push(u)
      }
    })
    var ss = img.getAttribute('srcset')
    if (ss) images = images.concat(parseSrcset(ss))
  })
  document.querySelectorAll('picture source[srcset]').forEach(function(s) {
    images = images.concat(parseSrcset(s.getAttribute('srcset')))
  })

  var videos = [], audios = [], sources = []
  document.querySelectorAll('video[src],video source[src]').forEach(function(el) {
    var u = abs(el.getAttribute('src'))
    if (u) videos.push(u)
  })
  document.querySelectorAll('audio[src],audio source[src]').forEach(function(el) {
    var u = abs(el.getAttribute('src'))
    if (u) audios.push(u)
  })
  document.querySelectorAll('source[src]').forEach(function(el) {
    var u = abs(el.getAttribute('src'))
    if (u) sources.push(u)
  })

  var frames = []
  document.querySelectorAll('iframe[src],frame[src],embed[src]').forEach(function(el) {
    var u = abs(el.getAttribute('src'))
    if (u) frames.push(u)
  })
  document.querySelectorAll('object[data]').forEach(function(el) {
    var u = abs(el.getAttribute('data'))
    if (u) frames.push(u)
  })

  var cspMeta = []
  document.querySelectorAll('meta[http-equiv]').forEach(function(m) {
    var h = (m.getAttribute('http-equiv') || '').toLowerCase()
    if (h === 'content-security-policy') {
      cspMeta.push((m.getAttribute('content') || '').slice(0, 1500))
    }
  })

  var ogMedia = []
  document.querySelectorAll('meta[property][content],meta[name][content]').forEach(function(m) {
    var p = (m.getAttribute('property') || m.getAttribute('name') || '').toLowerCase()
    var c = m.getAttribute('content') || ''
    if (/^(og:image|og:video|og:audio|twitter:image)/.test(p)) {
      var u = abs(c) || (c.indexOf('http') === 0 ? c : null)
      if (u) ogMedia.push({ prop: p, url: u })
    }
  })

  var perfByType = {}
  var perfSamples = []
  try {
    var entries = performance.getEntriesByType('resource')
    var cap = Math.min(entries.length, 300)
    for (var i = 0; i < cap; i++) {
      var e = entries[i]
      var t = e.initiatorType || 'other'
      if (!perfByType[t]) perfByType[t] = { count: 0, origins: {} }
      perfByType[t].count++
      var o = originOf(e.name)
      if (o) perfByType[t].origins[o] = (perfByType[t].origins[o] || 0) + 1
      if (i < 80) {
        perfSamples.push({
          url: e.name,
          type: t,
          ms: Math.round(e.duration)
        })
      }
    }
  } catch (err) {}

  var transmissionHints = []
  try {
    var html = document.documentElement && document.documentElement.outerHTML
      ? document.documentElement.outerHTML.slice(0, 240000)
      : ''
    var re = /\\b(wss?:\\/\\/[^\\s"'<>]+|https?:\\/\\/[^\\s"'<>]{6,400})/gi
    var m, seenTx = {}, capTx = 120
    while ((m = re.exec(html)) !== null && transmissionHints.length < capTx) {
      var raw = m[1]
      if (seenTx[raw]) continue
      seenTx[raw] = 1
      if (/\\.(png|jpe?g|gif|webp|svg|css|woff2?|ttf|ico)(\\?|$)/i.test(raw)) continue
      transmissionHints.push(raw)
    }
  } catch (e2) {}

  var streamingHints = []
  var streamSeen = {}
  function pushStreamUrl(u) {
    if (!u || typeof u !== 'string' || streamSeen[u]) return
    streamSeen[u] = 1
    streamingHints.push(u)
  }
  function looksLikeStreamManifest(u) {
    return /\.m3u8(\\?|#|$)/i.test(u) || /\.m3u(\\?|#|$)/i.test(u) || /\.mpd(\\?|#|$)/i.test(u) ||
      /\\/manifest(\\/|\\.|\\?|#|$)/i.test(u) || /\\/playlist(\\/|\\.|\\?|#|$)/i.test(u) ||
      /\\/master\\.m3u8/i.test(u) || /\\/index\\.m3u8/i.test(u)
  }
  try {
    var entS = performance.getEntriesByType('resource')
    var capS = Math.min(entS.length, 400)
    for (var si = 0; si < capS && streamingHints.length < 72; si++) {
      var nm = entS[si].name || ''
      if (looksLikeStreamManifest(nm)) pushStreamUrl(nm)
    }
  } catch (es0) {}
  for (var ti = 0; ti < transmissionHints.length && streamingHints.length < 96; ti++) {
    if (looksLikeStreamManifest(transmissionHints[ti])) pushStreamUrl(transmissionHints[ti])
  }
  videos.concat(audios).concat(sources).forEach(function(u0) {
    if (looksLikeStreamManifest(u0)) pushStreamUrl(u0)
  })
  streamingHints = uniq(streamingHints)

  var fontUrls = []
  hints.preload.forEach(function(x) {
    if (x.as === 'font' && x.url) fontUrls.push(x.url)
  })
  try {
    var entries2 = performance.getEntriesByType('resource')
    for (var j = 0; j < entries2.length; j++) {
      if (entries2[j].initiatorType === 'css' || entries2[j].initiatorType === 'font') {
        var name = entries2[j].name || ''
        if (/\\.(woff2?|ttf|otf|eot)(\\?|$)/i.test(name)) fontUrls.push(name)
      }
    }
  } catch (e3) {}
  fontUrls = uniq(fontUrls)

  var originsSummary = {}
  function bumpOrigin(url, tag) {
    var o = originOf(url)
    if (!o) return
    if (!originsSummary[o]) originsSummary[o] = {}
    originsSummary[o][tag] = (originsSummary[o][tag] || 0) + 1
  }
  scripts.external.forEach(function(u){ bumpOrigin(u,'script') })
  stylesheets.forEach(function(u){ bumpOrigin(u,'css') })
  images.forEach(function(u){ bumpOrigin(u,'img') })
  videos.concat(audios).concat(sources).forEach(function(u){ bumpOrigin(u,'media') })
  fontUrls.forEach(function(u){ bumpOrigin(u,'font') })
  streamingHints.forEach(function(u){ bumpOrigin(u,'stream') })

  var out = {
    version: 1,
    pageUrl: pageUrl,
    documentTitle: String(document.title || ''),
    baseHref: baseHref,
    scripts: { external: uniq(scripts.external), inlineCount: scripts.inline },
    stylesheets: uniq(stylesheets),
    hints: {
      preload: hints.preload,
      prefetch: uniq(hints.prefetch),
      modulepreload: uniq(hints.modulepreload),
      preconnect: uniq(hints.preconnect),
      dnsPrefetch: uniq(hints.dnsPrefetch),
    },
    media: {
      images: uniq(images),
      videos: uniq(videos),
      audios: uniq(audios),
      sources: uniq(sources),
    },
    frames: uniq(frames),
    fonts: fontUrls,
    ogTwitterMedia: ogMedia,
    cspMeta: cspMeta,
    performance: { byInitiatorType: perfByType, sample: perfSamples },
    transmissionHintsFromMarkup: transmissionHints.slice(0, 80),
    streamingManifestHints: streamingHints.slice(0, 80),
    originsSummary: originsSummary,
  }

  try { window.__MCAP_DESTRIPE_LAST__ = out } catch (e4) {}
  try {
    console.log('__MCAP_DESTRIPE__' + JSON.stringify(out))
  } catch (e5) {}
})()
`
