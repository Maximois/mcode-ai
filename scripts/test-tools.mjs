// Pruebas de regresion del parser de herramientas de src/ai.js (se corre desde `npm run verify`).
// Bug cubierto: "[TOOL: x]" quedaba como "[[TOOL: x]]" y al quitar la herramienta sobraba un "[]" visible.
import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const store = new Map()
globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) }
globalThis.window = undefined

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { normalizeTools, TOOL_RE } = await import(pathToFileURL(resolve(root, 'src/ai.js')).href)
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
if (bad) { console.error(`parser de herramientas: ${bad} caso(s) fallaron`); process.exit(1) }
console.log(`  OK (${cases.length + captureCases.length} casos)`)
