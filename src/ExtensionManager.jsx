import React, { useState } from 'react'
import { useExtensions } from './hooks/useExtensions.js'

export default function ExtensionManager({ onClose }) {
  const { extensions, loaded, installQueue, installVsix, uninstall, installViaDialog, refresh } = useExtensions()
  const [filter, setFilter] = useState('')
  const [details, setDetails] = useState(null)
  const [installing, setInstalling] = useState(false)
  const [statusMsg, setStatusMsg] = useState('')

  const handleDrop = async (e) => {
    e.preventDefault()
    const files = [...(e.dataTransfer?.files || [])].filter(f => f.name.endsWith('.vsix'))
    for (const f of files) {
      setInstalling(true)
      setStatusMsg(`Instalando ${f.name}…`)
      const r = await installVsix(f.path)
      setStatusMsg(r.ok ? `✓ ${r.name || r.id} instalada` : `✗ Error: ${r.error}`)
      setInstalling(false)
    }
  }

  const filtered = extensions.filter(e =>
    !filter || e.name?.toLowerCase().includes(filter.toLowerCase()) || e.id?.toLowerCase().includes(filter.toLowerCase())
  )

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100%', width:320, background:'var(--bg2)', borderLeft:'0.5px solid var(--border)' }}>
      <div style={{ display:'flex', alignItems:'center', padding:'8px 10px', borderBottom:'0.5px solid var(--border)', fontSize:12, fontWeight:600, color:'var(--text)', flexShrink:0 }}>
        <span style={{ flex:1 }}>🧩 Extensiones VSIX</span>
        <button onClick={onClose} style={{ background:'none', border:'none', color:'var(--text3)', cursor:'pointer', fontSize:16, padding:'0 4px' }}>×</button>
      </div>

      <div style={{ display:'flex', gap:6, padding:'6px 10px', borderBottom:'0.5px solid var(--border)', flexShrink:0 }}>
        <input style={{ flex:1, background:'var(--bg3)', border:'0.5px solid var(--border2)', borderRadius:4, padding:'4px 8px', fontSize:11, color:'var(--text)', outline:'none' }}
          value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filtrar…" />
        <button style={{ background:'none', border:'0.5px solid var(--accent)', color:'var(--accent2)', fontSize:11, padding:'3px 10px', borderRadius:4, cursor:'pointer', fontFamily:'var(--font)' }}
          onClick={async () => {
            setInstalling(true); setStatusMsg('Seleccionando…')
            const results = await installViaDialog()
            setInstalling(false)
            if (results?.length > 0) {
              const ok = results.filter(r => r.ok)
              const fail = results.filter(r => !r.ok)
              setStatusMsg(ok.length > 0 ? `✓ ${ok.length} instalada${ok.length>1?'s':''}${fail.length>0?`, ${fail.length} fallida${fail.length>1?'s':''}`:''}` : `✗ ${fail.length} fallida${fail.length>1?'s':''}`)
            }
          }}
          disabled={installing || installQueue.length > 0}>
          + VSIX
        </button>
        <button onClick={refresh} style={{ background:'none', border:'0.5px solid var(--border2)', color:'var(--text2)', fontSize:14, padding:'3px 6px', borderRadius:4, cursor:'pointer' }} title="Actualizar">↻</button>
      </div>

      {statusMsg && (
        <div style={{ fontSize:10, padding:'3px 10px', borderBottom:'0.5px solid var(--border)',
          background: statusMsg.startsWith('✓') ? 'rgba(29,158,117,.15)' : statusMsg.startsWith('✗') ? 'rgba(226,75,74,.15)' : 'rgba(186,117,23,.1)',
          color: statusMsg.startsWith('✓') ? 'var(--accent2)' : statusMsg.startsWith('✗') ? 'var(--red)' : 'var(--amber2)' }}>
          {statusMsg}
        </div>
      )}

      <div style={{ flex:1, overflow:'auto', padding:'4px 0' }}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}>

        {!loaded ? (
          <div style={{ textAlign:'center', padding:20, color:'var(--text3)', fontSize:11 }}>Cargando…</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign:'center', padding:20, color:'var(--text3)', fontSize:11 }}>
            {extensions.length === 0 ? 'Sin extensiones instaladas.' : 'Ninguna coincide.'}
          </div>
        ) : (
          filtered.map(ext => (
            <div key={ext.id}
              style={{
                padding:'6px 10px', cursor:'pointer', borderBottom:'0.5px solid var(--border)',
                background: details === ext.id ? 'var(--bg3)' : 'transparent'
              }}
              onClick={() => setDetails(details === ext.id ? null : ext.id)}>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <span style={{ fontSize:12, opacity: ext.enabled ? 1 : 0.4 }}>■</span>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontWeight:600, fontSize:12, color:'var(--text)' }}>{ext.name}</div>
                  <div style={{ fontSize:9, color:'var(--text3)' }}>{ext.id} · v{ext.version}</div>
                </div>
                <button style={{ background:'none', border:'none', color:'var(--red)', cursor:'pointer', fontSize:11, padding:'2px' }}
                  onClick={e => { e.stopPropagation(); uninstall(ext.id) }} title="Desinstalar">🗑</button>
              </div>
              {details === ext.id && (
                <div style={{ fontSize:10, color:'var(--text2)', marginTop:4, lineHeight:1.6 }}>
                  {ext.description && <div>{ext.description}</div>}
                  {ext.engines?.vscode && <div style={{ marginTop:2 }}>Engine: ^<code>{ext.engines.vscode}</code></div>}
                  {ext.activationEvents?.length > 0 && (
                    <div style={{ marginTop:2 }}>Activation: {ext.activationEvents.join(', ')}</div>
                  )}
                  {ext.contributes && Object.keys(ext.contributes).length > 0 && (
                    <div style={{ marginTop:2, color:'var(--accent2)' }}>
                      Contributes: {Object.keys(ext.contributes).join(', ')}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      <div style={{ padding:'6px 10px', borderTop:'0.5px solid var(--border)', fontSize:9, color:'var(--text3)', flexShrink:0 }}>
        Arrastrá .vsix acá para instalar · {extensions.filter(e => e.enabled).length} activas
      </div>
    </div>
  )
}
