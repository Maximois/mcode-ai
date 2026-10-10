/**
 * Inspector flotante inyectado en apps locales (localhost / 127.0.0.1 / ::1).
 * Compartido entre electron/main.js (ventana Preview) y src/BrowserTab.jsx (webview).
 * ESM: Vite puede importar named export; el main carga con import() dinámico.
 */
export const INSPECTOR_FLOATING = `
(function(){
  if (document.getElementById('__mcap_fab')) return
  var FAB = document.createElement('div')
  FAB.id = '__mcap_fab'
  FAB.textContent = '\uD83D\uDD0D'
  FAB.title = 'Inspeccionar componente'
  FAB.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:2147483647;width:36px;height:36px;border-radius:50%;background:rgba(0,102,204,.85);color:#fff;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);transition:all .2s;border:none;user-select:none'
  FAB.onmouseenter = function(){ this.style.transform = 'scale(1.1)'; this.style.background = '#06c' }
  FAB.onmouseleave = function(){ this.style.transform = 'scale(1)'; this.style.background = 'rgba(0,102,204,.85)' }
  document.body.appendChild(FAB)

  var active = false, OVERLAY, BADGE

  function makeOverlay() {
    OVERLAY = document.createElement('div')
    OVERLAY.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #09f;background:rgba(0,153,255,.08);display:none;transition:all .05s;top:0;left:0;width:0;height:0'
    document.body.appendChild(OVERLAY)
    BADGE = document.createElement('div')
    BADGE.style.cssText = 'position:fixed;z-index:2147483647;background:#09f;color:#fff;font:10px/14px monospace;padding:2px 7px;border-radius:3px;display:none;pointer-events:none;white-space:nowrap;max-width:400px;overflow:hidden;text-overflow:ellipsis;top:0;left:0'
    document.body.appendChild(BADGE)
  }

  function getInfo(el) {
    if (!el) return { tag:'?' }
    var info = { tag: el.tagName, id: el.id || '', classes: (el.className && typeof el.className === 'string') ? el.className.slice(0, 120) : '' }
    var k = Object.keys(el).find(function(k){ return k.startsWith('__reactFiber$') })
    if (k) {
      var f = el[k]; var stack = []; var depth = 0
      while (f && depth < 20) {
        if (f.type && typeof f.type !== 'string') { var n = f.type.displayName || f.type.name || ''; if (n && !n.startsWith('_')) stack.push(n) }
        if (f.type && typeof f.type === 'string') { stack.push(f.type.toLowerCase()) }
        f = f.return; depth++
      }
      if (stack.length) { info.framework = 'react'; info.stack = stack; info.name = stack[0]; return info }
    }
    k = Object.keys(el).find(function(k){ return k.startsWith('__vueParentComponent') })
    if (k) {
      var v = el[k]; var name = ''
      try { if (v && v.type) name = v.type.name || v.type.__name || v.type.displayName || '' } catch(e){}
      if (!name) { try { if (v && v.component && v.component.type) name = v.component.type.name || v.component.type.__name || '' } catch(e){} }
      info.framework = 'vue'; info.name = name || 'VueComponent'; return info
    }
    info.framework = 'dom'; info.name = el.tagName.toLowerCase(); return info
  }

  FAB.onclick = function(){
    active = !active
    FAB.style.background = active ? 'rgba(220,50,50,.9)' : 'rgba(0,102,204,.85)'
    FAB.textContent = active ? '\u2715' : '\uD83D\uDD0D'
    if (active) {
      makeOverlay()
      document.addEventListener('mousemove', onMove, true)
      document.addEventListener('click', onClick, true)
    } else { cleanup() }
  }

  function onMove(e) {
    if (!active) return
    var el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || el === OVERLAY || el === BADGE || el === FAB) return
    var r = el.getBoundingClientRect()
    OVERLAY.style.display = 'block'
    OVERLAY.style.left = r.left+'px'; OVERLAY.style.top = r.top+'px'
    OVERLAY.style.width = r.width+'px'; OVERLAY.style.height = r.height+'px'
    var info = getInfo(el)
    BADGE.style.display = 'block'
    BADGE.style.left = r.left+'px'; BADGE.style.top = (r.top-18)+'px'
    BADGE.textContent = info.name + (info.stack ? ' ['+info.stack.slice(0,3).join(' > ')+']' : '')
  }

  function onClick(e) {
    if (!active) return
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation()
    var el = document.elementFromPoint(e.clientX, e.clientY)
    if (!el || el === FAB) return
    var info = getInfo(el)
    info.x = e.clientX; info.y = e.clientY
    try { info.pageUrl = window.location.href } catch(err) {}
    active = false; cleanup()
    FAB.style.background = 'rgba(0,102,204,.85)'; FAB.textContent = '\uD83D\uDD0D'
    console.log('__MCAP_INSPECT__' + JSON.stringify(info))
  }

  function cleanup() {
    try { if (OVERLAY) { OVERLAY.remove(); OVERLAY = null } } catch(e){}
    try { if (BADGE) { BADGE.remove(); BADGE = null } } catch(e){}
    document.removeEventListener('mousemove', onMove, true)
    document.removeEventListener('click', onClick, true)
  }
})()
`
