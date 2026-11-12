// Pruebas del autopiloto fase 1 (src/autopilot.js): qué verificaciones correr, resumen de fallos y mensajes. Se corre desde `npm run verify`.
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const A = await import(pathToFileURL(resolve(root, 'src/autopilot.js')).href)
let n = 0, bad = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.error('  X ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: obtuvo ${JSON.stringify(a)}, esperaba ${JSON.stringify(b)}`)

// ── pickChecks ──
eq(A.pickChecks({ verify: 'node x', test: 'jest', lint: 'eslint .' }), [{ name: 'verify', command: 'npm run verify' }], 'si hay verify, solo verify')
eq(A.pickChecks({ test: 'vitest run', lint: 'eslint .' }).map(c => c.command), ['npm test', 'npm run lint'], 'sin verify: test y lint en ese orden')
eq(A.pickChecks({ test: 'echo "Error: no test specified" && exit 1' }), [], 'el test de relleno de npm init se ignora')
eq(A.pickChecks({ lint: 'eslint .' }).map(c => c.command), ['npm run lint'], 'solo lint')
eq(A.pickChecks({ build: 'vite build', dev: 'vite' }), [], 'build/dev no son verificaciones (no se lanzan por sorpresa)')
eq(A.pickChecks({ verify: '   ' }), [], 'verify vacío no cuenta')
eq(A.pickChecks(null), [], 'sin scripts')
eq(A.pickChecks({ verify: 5 }), [], 'script no-string se ignora')

// ── summarizeOutput ──
const ansi = '\u001b[31mError:\u001b[0m algo salió mal'
ok(A.summarizeOutput(ansi)[0] === 'Error: algo salió mal', 'quita colores ANSI')
const noisy = ['> proyecto@1.0.0 test', '> vitest run', '', ' RUN v1', ' ✓ a.test.js (3)', ' ❯ b.test.js (2)', '   FAIL  b.test.js > suma > da 4', '   AssertionError: expected 3 to be 4', '   at src/b.js:12:5', ' Test Files  1 failed | 1 passed'].join('\n')
const sm = A.summarizeOutput(noisy)
ok(sm.some(l => /AssertionError/.test(l)) && sm.some(l => /src\/b\.js:12/.test(l)), 'conserva el error y la ubicación')
ok(!sm.some(l => /RUN v1/.test(l)), 'descarta el ruido')
eq(A.summarizeOutput('todo\nlimpio\nsin pistas').length, 3, 'sin pistas deja el final de la salida')
eq(A.summarizeOutput(''), [], 'salida vacía')
ok(A.summarizeOutput(Array.from({ length: 100 }, (_, i) => `error ${i}`).join('\n')).length === 12, 'tope de 12 líneas')
ok(A.summarizeOutput('error '.repeat(200))[0].length <= 240, 'recorta líneas larguísimas')
eq(A.summarizeOutput('error x\nerror x\nerror x').length, 1, 'no repite líneas iguales')

// ── evaluateCheck ──
const good = A.evaluateCheck({ name: 'verify', command: 'npm run verify', code: 0, out: 'OK', err: '', ms: 1500 })
ok(good.ok && good.summary.length === 0, 'código 0 = ok')
const fail = A.evaluateCheck({ name: 'test', command: 'npm test', code: 1, out: '', err: 'SyntaxError: Unexpected token\n    at src/a.js:3:1', ms: 900 })
ok(!fail.ok && fail.locations[0] === 'src/a.js:3', 'código 1 = falla con ubicación')
const to = A.evaluateCheck({ name: 'test', command: 'npm test', code: null, out: '', err: '', ms: 180000, timedOut: true })
ok(!to.ok && to.timedOut && /tiempo/i.test(to.summary[0]), 'timeout = falla explicada')
ok(!A.evaluateCheck({ name: 'x', command: 'x', code: 0, timedOut: true }).ok, 'timeout con código 0 igual falla')
ok(!A.evaluateCheck({ name: 'x', command: 'x', code: -1, err: 'Failed to spawn' }).ok, 'código -1 falla')

// ── formatReport / errorForAI ──
const rep = A.formatReport([good, fail], ['npm run lint'])
ok(rep.includes('✔ `npm run verify`') && rep.includes('✗ `npm test`') && rep.includes('npm run lint') && rep.includes('1.5 s'), 'tarjeta con ✔, ✗, omitidos y tiempo')
eq(A.formatReport([]), '', 'sin resultados no hay tarjeta')
ok(!A.formatReport([good]).includes('⏭'), 'sin omitidos no hay línea de omitidos')
eq(A.errorForAI([good]), '', 'todo ok: nada que mandar a la IA')
const ai = A.errorForAI([good, fail])
ok(ai.includes('npm test') && ai.includes('src/a.js:3') && !ai.includes('verify'), 'a la IA solo le llega lo que falló')
const longFail = A.evaluateCheck({ name: 'test', command: 'npm test', code: 1, err: Array.from({ length: 50 }, (_, i) => `Error ${i}: ` + 'x'.repeat(200)).join('\n'), ms: 1 })
ok(A.errorForAI([longFail]).length <= 1400, 'el mensaje a la IA está acotado')

if (bad) { console.error(`autopiloto: ${bad} de ${n} comprobaciones fallaron`); process.exit(1) }
console.log(`  OK (${n} comprobaciones)`)
