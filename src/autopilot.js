// Autopiloto (fase 1): lógica PURA y determinista, sin IA ni red. Decide qué verificaciones correr tras aplicar
// cambios, resume su salida y arma el mensaje corto para el chat y para la IA. Se prueba en scripts/test-autopilot.mjs.

// Scripts de package.json que cuentan como verificación, en orden. Si existe "verify" (que ya agrupa todo) se usa solo ese.
const PLACEHOLDER_TEST = /no test specified/i

export function pickChecks(scripts) {
  const s = scripts && typeof scripts === 'object' ? scripts : {}
  const has = (k) => typeof s[k] === 'string' && s[k].trim() !== ''
  if (has('verify')) return [{ name: 'verify', command: 'npm run verify' }]
  const out = []
  if (has('test') && !PLACEHOLDER_TEST.test(s.test)) out.push({ name: 'test', command: 'npm test' })
  if (has('lint')) out.push({ name: 'lint', command: 'npm run lint' })
  return out
}

const ANSI = /\u001b\[[0-9;?]*[A-Za-z]/g
const stripAnsi = (t) => String(t || '').replace(ANSI, '')

// Líneas que suelen indicar el problema real
const BAD_LINE = /(\berror\b|\bfail(?:ed|ure|ing)?\b|✗|✘|\bX\s|\bTypeError\b|\bReferenceError\b|\bSyntaxError\b|\bAssertionError\b|\bnot ok\b|\bUnexpected\b|\bcannot find\b|is not defined|\bERR!|\bTraceback\b)/i
const LOCATION = /([\w./\\-]+\.(?:jsx?|tsx?|mjs|cjs|py|css|json)):(\d+)/

// Resume la salida de un comando fallido en pocas líneas útiles (máx. maxLines), priorizando las de error y las
// que traen archivo:línea; si no hay ninguna, deja el final de la salida.
export function summarizeOutput(text, maxLines = 12) {
  const lines = stripAnsi(text).split(/\r?\n/).map(l => l.replace(/\s+$/, '')).filter(l => l.trim() !== '')
  if (!lines.length) return []
  const picked = []
  const seen = new Set()
  const take = (l) => { const k = l.trim().slice(0, 200); if (!seen.has(k) && picked.length < maxLines) { seen.add(k); picked.push(l.trim().slice(0, 240)) } }
  for (const l of lines) if (BAD_LINE.test(l) || LOCATION.test(l)) take(l)
  if (!picked.length) lines.slice(-Math.min(maxLines, 6)).forEach(take)
  return picked
}

// result: {name, command, code, out, err, ms, timedOut}
export function evaluateCheck(result) {
  const ok = result.code === 0 && !result.timedOut
  const joined = `${result.err || ''}\n${result.out || ''}`
  const summary = ok ? [] : result.timedOut
    ? ['Se agotó el tiempo de espera: el comando tardó demasiado (o quedó colgado).']
    : summarizeOutput(joined)
  const loc = []
  for (const l of summary) { const m = l.match(LOCATION); if (m && !loc.includes(`${m[1]}:${m[2]}`)) loc.push(`${m[1]}:${m[2]}`) }
  return { name: result.name, command: result.command, ok, ms: result.ms || 0, timedOut: !!result.timedOut, summary, locations: loc.slice(0, 6) }
}

const secs = (ms) => (ms / 1000).toFixed(1) + ' s'

// Texto de la tarjeta que se muestra en el chat. results = salida de evaluateCheck (+ skipped: nombres no corridos)
export function formatReport(results, skipped = []) {
  if (!results.length) return ''
  const lines = ['🔎 **Verificación automática**']
  for (const r of results) {
    if (r.ok) lines.push(`- ✔ \`${r.command}\` (${secs(r.ms)})`)
    else {
      lines.push(`- ✗ \`${r.command}\` (${secs(r.ms)})`)
      for (const l of r.summary.slice(0, 6)) lines.push(`    ${l}`)
    }
  }
  if (skipped.length) lines.push(`- ⏭ Sin correr (se frenó en el primer fallo): ${skipped.join(', ')}`)
  return lines.join('\n')
}

// Mensaje CORTO para la IA cuando algo falló (en vez de ~2 KB de log crudo)
export function errorForAI(results, maxChars = 1400) {
  const bad = results.filter(r => !r.ok)
  if (!bad.length) return ''
  const parts = []
  for (const r of bad) {
    parts.push(`\`${r.command}\` falló${r.timedOut ? ' (tiempo agotado)' : ''}:\n` + r.summary.join('\n') + (r.locations.length ? `\nUbicaciones: ${r.locations.join(', ')}` : ''))
  }
  const txt = 'La verificación automática falló tras tus cambios.\n' + parts.join('\n\n')
  return txt.length > maxChars ? txt.slice(0, maxChars - 1) + '…' : txt
}
