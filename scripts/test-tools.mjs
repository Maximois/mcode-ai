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
let bad = 0
for (const [input, n, left] of cases) {
  const gotN = count(input), gotLeft = strip(input)
  if (gotN !== n || gotLeft !== left) {
    bad++
    console.error(`  X ${JSON.stringify(input)}: herramientas=${gotN} (esperaba ${n}), sobra=${JSON.stringify(gotLeft)} (esperaba ${JSON.stringify(left)})`)
  }
}
if (bad) { console.error(`parser de herramientas: ${bad} caso(s) fallaron`); process.exit(1) }
console.log(`  OK (${cases.length} casos)`)
