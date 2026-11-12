// Pruebas del contexto del agente (src/agentContext.js + buildMessages de src/ai.js). Se corre desde `npm run verify`.
// Cubre: ventana/presupuesto por modelo, compactación del historial, índice que siempre cabe con aviso de recorte,
// guardia "leer antes de parchear".
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'

const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.window = undefined
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const A = await import(pathToFileURL(resolve(root, 'src/agentContext.js')).href)
const AI = await import(pathToFileURL(resolve(root, 'src/ai.js')).href)

let n = 0, bad = 0
const ok = (cond, msg) => { n++; if (!cond) { bad++; console.error('  X ' + msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: obtuvo ${JSON.stringify(a)}, esperaba ${JSON.stringify(b)}`)

// ── Ventana y presupuesto ──
eq(A.contextWindowFor('gemini', 'gemini-2.5-flash'), 1000000, 'gemini = 1M')
eq(A.contextWindowFor('groq', 'llama-3.1-8b-instant'), 16000, 'groq conservador')
eq(A.contextWindowFor('zen+gemini', 'big-pickle+gemini-2.5-flash'), 1000000, 'modelo con "gemini" en el nombre manda')
eq(A.contextWindowFor('zen+gemini', 'x'), 32000, 'combo usa el más chico')
eq(A.contextWindowFor('openrouter', 'foo-bar-32k'), 32000, 'sufijo -32k')
eq(A.contextWindowFor('groq', 'x', 100000), 100000, 'override del usuario')
eq(A.contextWindowFor('groq', 'x', 500), 16000, 'override absurdo se ignora')
eq(A.contextWindowFor('nuevo', 'x'), 16000, 'proveedor desconocido')
eq(A.promptBudgetFor(1000), 4000, 'presupuesto mínimo')
eq(A.promptBudgetFor(16000), 8000, 'presupuesto 50%')
eq(A.promptBudgetFor(1000000), 48000, 'presupuesto máximo')

// ── Compactación del historial ──
const mk = (n) => Array.from({ length: n }, (_, i) => i % 2 === 0
  ? { role: 'user', content: `pedido ${i} ` + 'x'.repeat(400) }
  : { role: 'assistant', content: `respuesta ${i} ` + 'y'.repeat(400) + '\n```PATCH:src/mod' + i + '.js:1:2\ncode\n```' })
const small = mk(3)
eq(A.compactHistory(small, 100000).compacted, 0, 'si cabe, no se toca')
eq(A.compactHistory(small, 100000).messages.length, 3, 'si cabe, mismos mensajes')
const long = mk(41)                       // termina en user (índice 40)
const c = A.compactHistory(long, 1500)
ok(c.compacted > 0, 'compacta cuando no cabe')
ok(c.messages[0].role === 'user', 'el primero conservado es del usuario')
ok(c.messages[c.messages.length - 1].content === long[40].content, 'el último pedido queda intacto')
ok(c.messages.every((m, i, a) => i === 0 || m.role !== a[i - 1].role), 'roles alternan')
ok(c.messages[0].content.includes('[Resumen automático'), 'incluye el resumen')
ok(/archivos: src\/mod\d+\.js/.test(c.messages[0].content), 'el resumen recuerda archivos tocados')
const toks = c.messages.reduce((s, m) => s + A.estTokens(m.content), 0)
ok(toks < 1500 * 1.5, `queda cerca del presupuesto (${toks} tokens)`)
eq(A.compactHistory([{ role: 'user', content: 'a'.repeat(100000) }], 100).messages.length, 1, 'un único mensaje enorme no se pierde')

// ── Índice parcial ──
eq(A.indexNotice(null), '', 'sin meta, sin aviso')
eq(A.indexNotice({ truncated: false, extraFiles: [] }), '', 'sin recorte, sin aviso')
const meta = { truncated: true, loaded: 200, reasons: ['tope de 200 archivos'], extraFiles: ['src/z/extra1.js', 'docs/a.md'], skippedLarge: 2, skippedDirs: ['dist'] }
const note = A.indexNotice(meta)
ok(/PARCIAL/.test(note) && /NO significa que no exista/.test(note) && /2 más/.test(note), 'el aviso explica el recorte y que "no figura" != "no existe"')
const files = { 'src/a.js': 'x', 'src/b.js': 'y', 'README.md': 'z' }
const compact = A.buildCompactIndex(files, meta, 1000)
ok(compact.includes('extra1.js') && compact.includes('a.js') && compact.includes('README.md'), 'índice compacto incluye cargados y extra')
const tiny = A.buildCompactIndex(Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`dir${i}/f.js`, ''])), null, 50)
ok(/archivos más/.test(tiny) && A.estTokens(tiny) < 120, 'índice compacto respeta el tope y avisa lo que falta')

// ── Guardia de lectura ──
const rootDir = 'C:\\proy'
const seen = new Set(['src/leido.js'])
const existing = new Set(['src/leido.js', 'src/nolei.js', 'src/otro.js'])
const acts = [
  { type: 'PATCH', filePath: 'src/leido.js' },
  { type: 'PATCH', filePath: 'src/nolei.js' },
  { type: 'WRITE', filePath: 'C:\\proy\\src\\otro.js' },
  { type: 'WRITE', filePath: 'src/nuevo.js' },
  { type: 'CREATE', filePath: 'src/c.js' },
  { type: 'PATCH', filePath: 'src/nolei.js' },
]
eq(A.findUnreadTargets(acts, { seen, existing, rootDir }), ['src/nolei.js', 'src/otro.js'], 'solo PATCH/WRITE de existentes no leídos, sin duplicados, rutas absolutas normalizadas')
eq(A.readTargetOf('src/a.js:10-30', rootDir), 'src/a.js', 'readFile con rango')
eq(A.readTargetOf('{"path":"C:/proy/src/a.js"}', rootDir), 'src/a.js', 'readFile JSON nativo')
eq(A.readTargetOf('./src/a.js', rootDir), 'src/a.js', 'ruta con ./')

// ── Integración: buildMessages con proyecto grande y presupuesto chico ──
const big = {}
for (let i = 0; i < 120; i++) big[`src/mod${i}/file${i}.js`] = Array.from({ length: 80 }, (_, j) => `export function fn${i}_${j}() { return ${j} }`).join('\n')
const hist = mk(41)
const notes = {}
const sys = (msgs) => msgs.filter(m => m.role === 'system').map(m => m.content).join('\n')
const full = AI.buildMessages({ projectFiles: big, activeFile: 'src/mod0/file0.js', activeContent: big['src/mod0/file0.js'], memories: [], history: hist, relevantFiles: [], tokenBudget: 4000, projectMeta: meta, ctxNotes: notes })
const sysText = sys(full)
ok(/Índice del proyecto/.test(sysText), 'con presupuesto chico el índice IGUAL está presente')
ok(/Índice del proyecto \(\d+ archivos, PARCIAL\)/.test(sysText) && /ÍNDICE PARCIAL:/.test(sysText) && /NO significa que no exista/.test(sysText), 'y trae el aviso de recorte')
ok(/extra1\.js/.test(sysText), 'lista los archivos que quedaron sin contenido')
ok(notes.compacted > 0, 'el historial se compactó con ese presupuesto')
const idxBlock = sysText.slice(sysText.indexOf('Índice del proyecto'))
ok(A.estTokens(idxBlock) < 4000 * 0.6, `el índice no se come el presupuesto (${A.estTokens(idxBlock)} tokens)`)
const roomy = AI.buildMessages({ projectFiles: files, activeFile: null, activeContent: '', memories: [], history: small, relevantFiles: [], tokenBudget: 48000, projectMeta: null, ctxNotes: {} })
ok(!/Índice del proyecto \(\d+ archivos, PARCIAL\)/.test(sys(roomy)) && !/ÍNDICE PARCIAL:/.test(sys(roomy)), 'sin recorte no hay aviso de parcial')
ok(roomy.filter(m => m.role !== 'system').length === 3, 'con presupuesto holgado el historial va completo')
ok(/No afirmes nada sobre el contenido de un archivo que no leíste/.test(sys(roomy)), 'el prompt exige no afirmar lo no leído')

if (bad) { console.error(`contexto del agente: ${bad} de ${n} comprobaciones fallaron`); process.exit(1) }
console.log(`  OK (${n} comprobaciones)`)
