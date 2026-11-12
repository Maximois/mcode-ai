// Pruebas de regresion del parser de herramientas de src/ai.js (se corre desde `npm run verify`).
// Bug cubierto: "[TOOL: x]" quedaba como "[[TOOL: x]]" y al quitar la herramienta sobraba un "[]" visible.
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.window = undefined

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const {
  normalizeTools, TOOL_RE, executeToolCall, extractWindowsPaths,
  normalizeProjectPath, findUnverifiedFileActions,
} = await import(pathToFileURL(resolve(root, 'src/ai.js')).href)
const strip = t => normalizeTools(t).replace(new RegExp(TOOL_RE.source, TOOL_RE.flags), '').trim()
const count = t => [...normalizeTools(t).matchAll(new RegExp(TOOL_RE.source, TOOL_RE.flags))].length

const cases = [
  // [entrada, herramientas esperadas, texto que debe quedar]
  ['[TOOL: glob **/*.js]', 1, ''],
  ['[TOOL: readFile src/App.jsx]', 1, ''],
  ['Voy a leer.\n[TOOL: grep foo]', 1, 'Voy a leer.'],
  ['[TOOL: readFile a.js][TOOL: grep x]', 2, ''],
  ['TOOL: glob **/*.js', 1, ''],
  ['`TOOL: readFile src/a.js`', 1, ''],
  ['TOC: grep foo', 1, ''],
  ['[TOC: grep foo]', 1, ''],
  ['readFile: src/a.js', 1, ''],
  ['Texto [1] y [2] normal', 0, 'Texto [1] y [2] normal'],
]
// Nombre y argumentos: la regresion que hacia que NINGUNA herramienta por texto se ejecutara
const parts = x => [...normalizeTools(x).matchAll(new RegExp(TOOL_RE.source, TOOL_RE.flags))].map(m => [m[1], m[2]])
const captureCases = [
  ['[TOOL: listDir src]', [['listDir', 'src']]],
  ['[TOOL: readFile src/a.js:10-30]', [['readFile', 'src/a.js:10-30']]],
  ['[TOOL: grep foo bar]', [['grep', 'foo bar']]],
  ['[TOOL: readFile a.js][TOOL: glob **/*.js]', [['readFile', 'a.js'], ['glob', '**/*.js']]],
  ['[TOOL: run npm test]', [['run', 'npm test']]],
  ['TOOL: run npm test', [['run', 'npm test']]],
  ['`TOOL: run ls`', [['run', 'ls']]],
  ['[TOC: run ls]', [['run', 'ls']]],
  ['[TOOL: screenshot]', [['screenshot', undefined]]],
  ['[TOOL: createComponent Button]', [['createComponent', 'Button']]],
]
let bad = 0
const same = (label, got, want) => {
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    bad++
    console.error(`  X ${label}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`)
  }
}
for (const [input, want] of captureCases) {
  const got = parts(input)
  if (JSON.stringify(got) !== JSON.stringify(want)) { bad++; console.error(`  X captura ${JSON.stringify(input)}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`) }
}
for (const [input, n, left] of cases) {
  const gotN = count(input), gotLeft = strip(input)
  if (gotN !== n || gotLeft !== left) {
    bad++
    console.error(`  X ${JSON.stringify(input)}: herramientas=${gotN} (esperaba ${n}), sobra=${JSON.stringify(gotLeft)} (esperaba ${JSON.stringify(left)})`)
  }
}

same('ruta Windows relativa', normalizeProjectPath('src\\ai.js', 'C:\\repo'), 'C:/repo/src/ai.js')
same('ruta Windows absoluta', normalizeProjectPath('C:\\repo\\src\\ai.js', 'C:\\otro'), 'C:/repo/src/ai.js')
same('rutas Windows explicitas', extractWindowsPaths('Revisá "C:\\Downloads\\app" y C:\\work\\main.js.'), [
  'C:\\Downloads\\app', 'C:\\work\\main.js',
])
same('bloqueo de archivos existentes sin lectura completa', findUnverifiedFileActions([
  { type: 'PATCH', filePath: 'src\\ai.js' },
  { type: 'WRITE', filePath: 'src\\nuevo.js' },
], 'C:\\repo', ['C:\\repo\\src\\ai.js'], []), [
  { type: 'PATCH', filePath: 'src\\ai.js' },
])
same('permite editar archivo existente leido', findUnverifiedFileActions([
  { type: 'PATCH', filePath: 'src\\ai.js' },
], 'C:\\repo', ['C:\\repo\\src\\ai.js'], ['c:\\repo\\src\\ai.js']), [])

globalThis.window = { api: { readFile: async () => ({ ok: true, content: 'const value = 1' }) } }
const fullReadContext = { rootDir: 'C:\\repo' }
await executeToolCall('readFile', 'src\\ai.js', fullReadContext)
same('lectura completa registra evidencia', [...(fullReadContext.readFiles || [])], ['C:/repo/src/ai.js'])
const partialReadContext = { rootDir: 'C:\\repo' }
await executeToolCall('readFile', 'src\\ai.js:1-1', partialReadContext)
same('lectura parcial no autoriza edicion', [...(partialReadContext.readFiles || [])], [])
let rootlessReadCalls = 0
globalThis.window = { api: { readFile: async () => { rootlessReadCalls++; return { ok: true, content: 'unexpected' } } } }
const rootlessRead = await executeToolCall('readFile', 'src\\ai.js', {})
same('lectura relativa bloqueada sin proyecto verificado', rootlessRead, '[Error: no hay una carpeta de proyecto verificada para resolver esta ruta relativa]')
same('lectura relativa no toca disco sin raiz', rootlessReadCalls, 0)
globalThis.window = undefined

if (bad) { console.error(`parser de herramientas: ${bad} caso(s) fallaron`); process.exit(1) }
console.log(`  OK (${cases.length + captureCases.length + 9} casos)`)
