// Pruebas del asistente local (src/localAssistant.js). Foco: que reconozca los pedidos obvios y, sobre todo, que NO
// intercepte mensajes que necesitan a la IA. Se corre desde `npm run verify`.
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const L = await import(pathToFileURL(resolve(root, 'src/localAssistant.js')).href)
let n = 0, bad = 0
const eq = (got, want, m) => { n++; if (got !== want) { bad++; console.error(`  X ${m}: obtuvo ${JSON.stringify(got)}, esperaba ${JSON.stringify(want)}`) } }

// ── Deben reconocerse ──
const yes = {
  tests: ['corré los tests', 'Corré los tests.', 'ejecutá los tests', 'correr tests', 'corré verify', 'ejecutá el verify', 'corré las pruebas', 'por favor corré los tests', 'corré los tests por favor', 'dale, corré los tests ahora', 'verificá el proyecto', 'verificá', 'npm test', 'npm run verify', 'corré lint', 'lanzá los checks', '¿Podés correr los tests?', 'hacé las pruebas'],
  status: ['qué cambió', 'Qué cambió?', 'que cambio', 'qué hay sin commitear', 'estado del proyecto', 'git status', 'cambios pendientes', 'mostrame los cambios pendientes', 'decime qué cambió'],
  errors: ['qué errores hay', 'hay errores', 'mostrame los errores', 'ver errores', 'listame los errores', 'errores actuales'],
  secrets: ['buscá secretos', 'hay secretos', 'escaneá secretos en el proyecto', 'revisá las credenciales', 'detectá tokens', 'buscar api keys'],
  snapshot: ['hacé un snapshot', 'creá un snapshot', 'guardá un backup', 'sacá una copia de seguridad', 'creá un punto de restauración', 'generá un respaldo ahora'],
  undo: ['deshacé el último cambio', 'deshacer', 'deshacé', 'revertí el último cambio', 'volvé atrás', 'undo', 'deshacé el último parche'],
  junk: ['qué basura hay', 'hay basura', 'buscá basura', 'qué se puede limpiar'],
  help: ['ayuda', 'comandos', 'qué podés hacer sin ia', 'asistente local'],
}
for (const [intent, list] of Object.entries(yes)) for (const t of list) eq(L.matchIntent(t), intent, `reconoce "${t}"`)

// ── NO deben interceptarse (necesitan IA o son otra cosa) ──
const no = [
  'corré los tests y arreglá el que falla', 'corré los tests y decime por qué fallan', 'por qué fallan los tests',
  'explicame qué hace verify', 'agregá tests para ai.js', 'escribí tests para la función sum', 'qué cambió en ai.js y por qué',
  'qué cambió en el último commit de Juan', 'deshacé el último commit', 'deshacé todo y empezá de nuevo', 'revertí el commit abc123',
  'creá un snapshot de la base de datos', 'hacé un backup en la nube', 'buscá secretos y borralos', 'buscá secretos en config.js',
  'qué errores hay en este archivo y cómo se arreglan', 'hay errores de CORS en el servidor', 'ayuda con el login',
  'ayudame a refactorizar', 'hola', 'gracias', 'ok', 'sí', 'dale', 'arreglá los errores', 'mostrame los errores y corregilos',
  'estado del arte de React', 'estado', 'cambios', 'errores', 'tests', 'basura', 'secretos',
  'verificá que el login funcione', 'verificá si hay un bug en el parser', 'corré el servidor', 'ejecutá el proyecto', 'corré npm install',
  'qué cambió?\ny después explicame', 'corré los tests ```js\nfoo()\n```', '', '   ', 'x'.repeat(300),
  'qué pasa si corro los tests', 'no corras los tests', 'nunca hagas un snapshot', 'ya corrí los tests',
]
for (const t of no) eq(L.matchIntent(t), null, `NO intercepta "${String(t).slice(0, 50).replace(/\n/g, '\\n')}"`)
eq(L.matchIntent(null), null, 'null seguro')
eq(L.matchIntent(undefined), null, 'undefined seguro')
eq(L.normalizeText('¿Qué CAMBIÓ?!'), 'que cambio', 'normaliza acentos y signos')

// ── Formateo ──
const git = { ok: true, branch: 'main', last: 'abc fix', total: 3, status: [' M a.js', '?? b.js', 'A  c.md'], shortstat: '2 files changed' }
const gs = L.formatGitStatus(git)
eq(gs.includes('Asistente local (sin IA)') && gs.includes('main') && gs.includes('`M` a.js') && gs.includes('`??` b.js') && gs.includes('2 files changed'), true, 'status: rama, cambios y diff')
eq(L.formatGitStatus({ ok: true, branch: 'm', total: 0, status: [] }).includes('limpio'), true, 'status: árbol limpio')
eq(L.formatGitStatus({ ok: false }).includes('no es un repositorio'), true, 'status: sin git')
eq(L.formatGitStatus({ ok: true, branch: 'm', total: 40, status: Array.from({ length: 40 }, (_, i) => ` M f${i}`) }).includes('y 15 más'), true, 'status: tope de 25')
const pr = { k: { path: 'C:\\p\\src\\x.js', errors: [{ line: 3, message: 'Unexpected `token`\nmal' }, { line: 4, message: 'b' }, { line: 5, message: 'c' }, { line: 6, message: 'd' }] } }
const fe = L.formatErrors(pr, 'C:\\p')
eq(fe.includes('`src/x.js`') && fe.includes('línea 3: Unexpected token mal') && fe.includes('+1 más'), true, 'errores: ruta relativa, línea y resto')
eq(L.formatErrors({}, '').includes('No hay errores'), true, 'errores: ninguno')
const fs1 = L.formatSecrets({ ok: true, scanned: 40, findings: [{ file: 'src/a.js', line: 9, label: 'AWS key', preview: 'AKIA…XYZ' }] })
eq(fs1.includes('src/a.js:9') && fs1.includes('AKIA…XYZ') && fs1.includes('enmascarados'), true, 'secretos: ubicación y valor enmascarado')
eq(L.formatSecrets({ ok: true, scanned: 7, findings: [] }).includes('7 archivos'), true, 'secretos: ninguno')
eq(L.formatSecrets({ ok: false, error: 'boom' }).includes('boom'), true, 'secretos: error')
eq(L.formatSnapshot({ ok: true, id: 'agente 2026', files: 12 }).includes('12 archivos'), true, 'snapshot ok')
eq(L.formatSnapshot({ ok: false, error: 'no hay' }).includes('no hay'), true, 'snapshot error')
const fj = L.formatJunk({ ok: true, total: 3, totalBytes: 2048, categories: { os: { label: 'Sistema', count: 2, bytes: 100 }, tmp: { label: 'Temp', count: 0, bytes: 0 }, cache: { label: 'Cachés', count: 1, bytes: 1948 } } })
eq(fj.includes('Sistema: 2') && !fj.includes('Temp:') && fj.includes('2.0 KB') && fj.includes('No borré nada'), true, 'basura: resumen sin borrar')
eq(L.formatUndo({ filePath: 'src/a.js', actionDesc: 'PATCH 1-3' }).includes('src/a.js'), true, 'undo ok')
eq(L.formatUndo(null).includes('No hay cambios'), true, 'undo vacío')
const h = L.helpText()
eq(Object.keys(L.INTENT_LABELS).every(k => h.includes(L.INTENT_LABELS[k])) && h.includes('se lo paso a la IA'), true, 'ayuda lista todo y aclara el pase a la IA')

if (bad) { console.error(`asistente local: ${bad} de ${n} comprobaciones fallaron`); process.exit(1) }
console.log(`  OK (${n} comprobaciones)`)
