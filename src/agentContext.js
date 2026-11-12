// Utilidades PURAS (sin red ni DOM) para el contexto del agente: presupuesto según el modelo, compactación
// del historial, índice que siempre cabe y guardia de "leer antes de parchear". Se prueban en scripts/test-tools.mjs.

export const estTokens = (s) => Math.ceil(String(s || '').length / 4)

// ── Ventana de contexto efectiva según proveedor/modelo ──────────────────────
// Son valores CONSERVADORES (los planes gratuitos suelen limitar tokens por minuto mucho antes que la
// ventana real). El usuario puede fijar un valor propio en Ajustes (override > 0).
const PROVIDER_WINDOW = {
  ollama: 8000, groq: 16000, cerebras: 16000, sambanova: 16000, openrouter: 32000, zen: 32000,
  mistral: 64000, deepseek: 64000, fireworks: 64000, nvidia: 64000, gemini: 1000000,
}

export function contextWindowFor(provider, model, override) {
  const o = Number(override)
  if (Number.isFinite(o) && o >= 2000) return Math.floor(o)
  const name = String(model || '').toLowerCase()
  if (/gemini/.test(name)) return 1000000
  const k = name.match(/(\d{2,4})k\b/)           // p. ej. "...-32k", "...-128k"
  if (k) return Math.min(1000000, Number(k[1]) * 1000)
  // "provider" puede ser un combo ("zen+gemini"): se usa el más chico
  const parts = String(provider || '').split('+')
  const sizes = parts.map(p => PROVIDER_WINDOW[p] || 16000)
  return Math.min(...sizes)
}

// Presupuesto TOTAL del prompt (sistema + contexto del proyecto + historial): la mitad de la ventana,
// acotado para no gastar de más en modelos con ventanas enormes ni quedarse sin espacio en los chicos.
export function promptBudgetFor(windowTokens) {
  return Math.max(4000, Math.min(48000, Math.round(windowTokens * 0.5)))
}

// ── Compactación del historial (cero tokens, extractiva) ─────────────────────
const ACTION_RE = /```(?:PATCH|WRITE|CREATE):([^\s:`\n]+)/g

export function filesTouched(text) {
  const out = new Set()
  for (const m of String(text || '').matchAll(ACTION_RE)) out.add(m[1])
  const auto = String(text || '').match(/Auto-aplicado \(\d+\): ([^*]+)\*/)
  if (auto) auto[1].split(',').map(s => s.trim()).filter(Boolean).forEach(f => out.add(f))
  return [...out]
}

const oneLine = (s, n) => String(s || '').replace(/```[\s\S]*?```/g, ' [código] ').replace(/\s+/g, ' ').trim().slice(0, n)

// history: [{role, content}] (último = pedido actual del usuario). Si no cabe en `budgetTokens`, los mensajes
// viejos se resumen en un bloque corto que se antepone al primer mensaje conservado (siempre un "user", así no
// se rompe la alternancia de roles que exigen algunos proveedores).
export function compactHistory(history, budgetTokens) {
  const msgs = (history || []).filter(m => m && (m.role === 'user' || m.role === 'assistant'))
  const total = msgs.reduce((s, m) => s + estTokens(m.content), 0)
  if (total <= budgetTokens || msgs.length <= 2) return { messages: msgs, compacted: 0 }

  const keepBudget = Math.max(500, Math.floor(budgetTokens * 0.7))
  let start = msgs.length
  let used = 0
  while (start > 0) {
    const t = estTokens(msgs[start - 1].content)
    if (used + t > keepBudget && start < msgs.length) break
    used += t; start--
  }
  // el primer mensaje conservado debe ser del usuario
  while (start < msgs.length - 1 && msgs[start].role !== 'user') start++
  if (start <= 0) return { messages: msgs, compacted: 0 }

  const old = msgs.slice(0, start)
  const lines = []
  for (const m of old) {
    if (m.role === 'user') lines.push('- Usuario: ' + oneLine(m.content, 160))
    else {
      const f = filesTouched(m.content)
      lines.push('- IA: ' + oneLine(m.content, 140) + (f.length ? ` (archivos: ${f.slice(0, 6).join(', ')})` : ''))
    }
  }
  const maxChars = Math.max(600, Math.floor(budgetTokens * 4 * 0.2))
  let summary = ''
  for (const l of lines.slice().reverse()) {          // se priorizan los más recientes de los viejos
    if ((summary.length + l.length + 1) > maxChars) break
    summary = l + '\n' + summary
  }
  const head = `[Resumen automático de ${old.length} mensajes anteriores — contexto comprimido; el estado real del código se consulta con las herramientas]\n${summary}[Fin del resumen]\n\n`
  const kept = msgs.slice(start)
  kept[0] = { ...kept[0], content: head + String(kept[0].content || '') }
  return { messages: kept, compacted: old.length }
}

// ── Índice del proyecto que siempre cabe + aviso de recorte ──────────────────
export function indexNotice(meta) {
  if (!meta) return ''
  const bits = []
  if (meta.truncated) {
    bits.push(`ÍNDICE PARCIAL: se cargó el contenido de ${meta.loaded ?? '?'} archivos y quedaron ${meta.extraFiles?.length ?? 0} más SOLO con su ruta (${(meta.reasons || []).join('; ')}).`)
  }
  if (meta.skippedLarge) bits.push(`${meta.skippedLarge} archivo(s) son muy grandes y se listan sin contenido: usá readFile con rango (ruta:10-80).`)
  if (meta.skippedDirs?.length) bits.push(`Carpetas no indexadas a propósito: ${meta.skippedDirs.slice(0, 12).join(', ')}.`)
  if (!bits.length) return ''
  bits.push('Que un archivo no figure en el índice NO significa que no exista: confirmalo con listDir/glob/grep/readFile antes de afirmarlo.')
  return bits.join(' ')
}

// Índice compacto: solo rutas agrupadas por carpeta; corta cuando se acaba el presupuesto y dice cuántas faltan.
export function buildCompactIndex(projectFiles, meta, maxTokens) {
  const names = Object.keys(projectFiles || {})
  for (const r of (meta?.extraFiles || [])) names.push(r)
  const byDir = {}
  for (const rel of names) {
    const i = rel.lastIndexOf('/')
    const dir = i < 0 ? '.' : rel.slice(0, i)
    ;(byDir[dir] ||= []).push(i < 0 ? rel : rel.slice(i + 1))
  }
  const lines = []
  let used = 0, listed = 0
  for (const dir of Object.keys(byDir).sort()) {
    const line = (dir === '.' ? '── Raíz: ' : `── ${dir}/: `) + byDir[dir].join(', ')
    const t = estTokens(line)
    if (used + t > maxTokens) {
      const rest = names.length - listed
      lines.push(`… (${rest} archivos más en carpetas no listadas por tamaño; usá glob/listDir)`)
      break
    }
    lines.push(line); used += t; listed += byDir[dir].length
  }
  return lines.join('\n')
}

// ── Guardia "leé antes de parchear" ──────────────────────────────────────────
export function normRel(p, rootDir) {
  let s = String(p || '').replace(/\\/g, '/').trim()
  const root = String(rootDir || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (root && s.toLowerCase().startsWith(root.toLowerCase() + '/')) s = s.slice(root.length + 1)
  return s.replace(/^\.\//, '').replace(/^\/+/, '')
}

// acts: [{type, filePath}]; seen: Set de rutas ya leídas/visibles (normalizadas); existing: Set de rutas que existen.
// Devuelve las rutas que se quieren PATCH/WRITE sin haberlas leído en este turno.
export function findUnreadTargets(acts, { seen, existing, rootDir }) {
  const out = []
  for (const a of acts || []) {
    if (a.type !== 'PATCH' && a.type !== 'WRITE') continue
    const rel = normRel(a.filePath, rootDir)
    if (!rel || seen.has(rel)) continue
    if (a.type === 'WRITE' && !existing.has(rel)) continue   // archivo nuevo: nada que leer
    if (!out.includes(rel)) out.push(rel)
  }
  return out
}

// Ruta pedida a readFile ("src/a.js", "src/a.js:10-30", absoluta o JSON nativo) -> ruta relativa normalizada
export function readTargetOf(args, rootDir) {
  let a = String(args ?? '').trim()
  if (a.startsWith('{')) { try { const o = JSON.parse(a); a = String(o.path ?? o.file ?? o.filePath ?? o.filename ?? '') } catch { /* texto plano */ } }
  a = a.replace(/:(\d+)-(\d+)$/, '').trim()
  return normRel(a, rootDir)
}
