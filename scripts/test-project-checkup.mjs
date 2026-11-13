// Pruebas de las rutinas mecánicas (src/projectCheckup.js): .gitignore, formateador y chequeo. Se corre desde `npm run verify`.
import { pathToFileURL, fileURLToPath } from 'node:url'
import { resolve, dirname } from 'node:path'
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const C = await import(pathToFileURL(resolve(root, 'src/projectCheckup.js')).href)
let n = 0, bad = 0
const ok = (c, m) => { n++; if (!c) { bad++; console.error('  X ' + m) } }
const eq = (a, b, m) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: obtuvo ${JSON.stringify(a)}, esperaba ${JSON.stringify(b)}`)
const rules = (arr, ctx) => C.recommendGitignore({ rules: arr, ...ctx }).map(r => r.rule)

// ── isCovered ──
ok(C.isCovered('node_modules/', ['node_modules']), 'node_modules cubre node_modules/')
ok(C.isCovered('node_modules/', ['/node_modules/']), '/node_modules/ cubre')
ok(C.isCovered('node_modules/', ['**/node_modules']), '**/node_modules cubre')
ok(C.isCovered('.env', ['.env*']), '.env* cubre .env')
ok(C.isCovered('.env.local', ['.env.*']), '.env.* cubre .env.local')
ok(C.isCovered('*.pyc', ['*.py[cod]']) === false, 'glob con corchetes no se interpreta (no cubre) y no rompe')
ok(C.isCovered('dist/', ['dist-electron/']) === false, 'dist-electron no cubre dist')
ok(C.isCovered('dist/', ['d*']), 'un comodín amplio sí cubre')
ok(!C.isCovered('.env', ['# .env', '!.env']), 'comentarios y negaciones no cuentan como cobertura')
ok(!C.isCovered('node_modules/', []), 'sin reglas no está cubierto')
ok(C.isCovered('', []), 'regla vacía no se recomienda')

// ── recommendGitignore ──
eq(rules([], { pkg: { name: 'x' }, present: ['package.json'] }), ['node_modules/'], 'proyecto node sin gitignore: node_modules')
eq(rules(['node_modules/'], { pkg: {}, present: ['dist', 'build', '.env'] }), ['dist/', 'build/', '.env'], 'solo carpetas de build que EXISTEN y .env')
eq(rules(['node_modules/', 'dist/', '.env'], { pkg: {}, present: ['dist', '.env'] }), [], 'todo cubierto: nada')
eq(rules([], { present: ['requirements.txt', '.venv'] }), ['__pycache__/', '*.pyc', '.venv/'], 'python')
eq(rules([], { pkg: null, present: [] }), [], 'proyecto sin node ni python: nada que inventar')
eq(rules([], { pkg: {}, present: ['.vscode', '.idea'] }), ['node_modules/', '.vscode/', '.idea/'], 'editores si existen')
ok(!rules([], { pkg: {}, present: ['package.json'] }).includes('package-lock.json'), 'nunca recomienda ignorar el lockfile')
ok(C.recommendGitignore({ rules: [], present: new Set(['.env']) }).some(r => r.rule === '.env' && r.why), 'acepta Set y trae el motivo')
eq(rules(['*.log'], { pkg: {}, present: [] }), ['node_modules/'], 'reglas ajenas no interfieren')

// ── detectFormatter ──
eq(C.detectFormatter({ scripts: { format: 'prettier --write .' } }), { command: 'npm run format', via: 'script "format"' }, 'script format')
eq(C.detectFormatter({ devDependencies: { prettier: '^3' } }), { command: 'npx --no-install prettier --write .', via: 'prettier' }, 'prettier instalado, sin descargar (--no-install)')
eq(C.detectFormatter({ scripts: { format: '  ' }, dependencies: {} }), null, 'script vacío no cuenta')
eq(C.detectFormatter({ scripts: { lint: 'eslint' } }), null, 'sin formateador')
eq(C.detectFormatter(null), null, 'sin package.json')
ok(C.detectFormatter({ devDependencies: { prettier: '1' } }).command.includes('--no-install'), 'nunca descarga')

// ── buildCheckup ──
ok(C.buildCheckup({}).includes('Sin sugerencias'), 'nada que sugerir')
const recs = [{ rule: 'node_modules/', why: 'x' }, { rule: '.env', why: 'y' }]
const full = C.buildCheckup({
  recs, gitignoreExists: false, secrets: { ok: true, findings: [1, 2], truncated: false }, junk: { ok: true, total: 3, totalBytes: 2048 },
  pkg: { scripts: { build: 'vite build' } }, formatter: { command: 'x', via: 'prettier' }, git: { ok: true, total: 30 },
})
ok(full.includes('No hay `.gitignore`') && full.includes('`node_modules/`, `.env`') && full.includes('arreglá el gitignore'), 'checkup: gitignore con la frase de acción')
ok(full.includes('2 posibles secretos') && full.includes('buscá secretos'), 'checkup: secretos')
ok(full.includes('3 elementos') && full.includes('2.0 KB'), 'checkup: basura')
ok(full.includes('no define `verify`'), 'checkup: sin scripts de verificación')
ok(full.includes('formateá el proyecto') && full.includes('30 cambios sin commitear'), 'checkup: formateador y cambios')
ok(full.includes('Chequeo del proyecto (6)'), 'checkup: cuenta los puntos')
ok(!C.buildCheckup({ pkg: { scripts: { test: 'echo "Error: no test specified" && exit 1' } } }).includes('Sin sugerencias'), 'test de relleno cuenta como sin verificación')
ok(C.buildCheckup({ pkg: { scripts: { verify: 'node x' } } }).includes('Sin sugerencias'), 'con verify no se sugiere nada')
ok(C.buildCheckup({ git: { ok: false } }).includes('no es un repositorio'), 'sin git se avisa')
ok(!C.buildCheckup({ secrets: { ok: false, error: 'x' }, junk: { ok: false } }).includes('secreto'), 'errores de escaneo no inventan hallazgos')

// ── formatGitignoreResult ──
ok(C.formatGitignoreResult([], null).includes('ya cubre todo'), 'gitignore: nada que agregar')
const gr = C.formatGitignoreResult(recs, { ok: true, added: ['node_modules/', '.env'] })
ok(gr.includes('Agregué 2 reglas') && gr.includes('`.env` — y') && gr.includes('no se tocó lo que había'), 'gitignore: lo agregado con motivo')
ok(C.formatGitignoreResult(recs, { ok: false, error: 'EPERM' }).includes('EPERM'), 'gitignore: error visible')
ok(C.formatGitignoreResult(recs, { ok: true, added: [] }).includes('ya tenía'), 'gitignore: ya estaba')

// ── formatFormatResult ──
const F = { command: 'npm run format', via: 'script "format"' }
ok(/no instalo nada/i.test(C.formatFormatResult({ formatter: null })), 'format: sin formateador')
ok(/no formateé nada/i.test(C.formatFormatResult({ formatter: F, snapshot: { ok: false, error: 'sin espacio' } })), 'format: sin snapshot no se toca nada')
ok(C.formatFormatResult({ formatter: F, snapshot: { ok: true, id: 's1' }, ok: true, git: { ok: true, total: 4, shortstat: '4 files changed' } }).includes('4 archivos con cambios'), 'format: ok con cambios')
ok(/desactualizados/.test(C.formatFormatResult({ formatter: F, snapshot: { ok: true, id: 's1' }, ok: true, git: { ok: true, total: 4 } })), 'format: avisa de archivos abiertos desactualizados')
ok(C.formatFormatResult({ formatter: F, snapshot: { ok: true, id: 's1' }, ok: true, git: { ok: true, total: 0 } }).includes('No cambió ningún archivo'), 'format: ok sin cambios')
ok(C.formatFormatResult({ formatter: F, snapshot: { ok: true, id: 's1' }, ok: false, summary: ['Error: boom'] }).includes('Error: boom'), 'format: falla con detalle')
ok(C.formatFormatResult({ formatter: F, snapshot: { ok: true, id: 's1' }, timedOut: true }).includes('Rollbacks'), 'format: timeout apunta al snapshot')

if (bad) { console.error(`rutinas mecánicas: ${bad} de ${n} comprobaciones fallaron`); process.exit(1) }
console.log(`  OK (${n} comprobaciones)`)
