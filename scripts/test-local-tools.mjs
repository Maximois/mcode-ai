// Pruebas de regresion de electron/local-tools/ (se corren desde `npm run verify`).
// Cubren las propiedades de SEGURIDAD de cada modulo (no borrar de mas, no escribir fuera del
// proyecto, todo-o-nada, idempotencia), que son las que el build no detecta.
// Autonomo: solo Node, carpetas temporales, sin red salvo un servidor falso en 127.0.0.1.
import { createRequire } from 'node:module'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createServer } from 'node:http'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const req = createRequire(join(root, 'package.json'))
const L = (m) => req(join(root, 'electron', 'local-tools', m))

const tmp = mkdtempSync(join(tmpdir(), 'mcode-lt-'))
let passed = 0
const failures = []
const check = (name, cond, detail = '') => { if (cond) passed++; else failures.push(`${name}${detail ? ' -> ' + detail : ''}`) }
const dir = (...p) => { const d = join(tmp, ...p); mkdirSync(d, { recursive: true }); return d }
const put = (p, text) => { mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, text, 'utf8'); return p }
const read = (p) => readFileSync(p, 'utf8')
const section = async (name, fn) => { try { await fn() } catch (e) { failures.push(`[${name}] excepcion: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`) } }
const throws = (fn) => { try { fn(); return false } catch { return true } }
const rejects = async (p) => { try { await p; return false } catch { return true } }
let hasGit = true
try { execFileSync('git', ['--version'], { stdio: 'ignore' }) } catch { hasGit = false }

await section('validator', async () => {
  const { validateFile } = L('validator')
  const d = dir('validator')
  const bad = await validateFile(put(join(d, 'bad.json'), '{\n "a": [1, 2\n}\n'))
  check('json roto', !bad.ok && bad.errors[0].line >= 1)
  check('json ok', (await validateFile(put(join(d, 'ok.json'), '{"a":1}'))).ok)
  check('yaml clave duplicada', !(await validateFile(put(join(d, 'd.yml'), 'a: 1\nb: 2\na: 3\n'))).ok)
  check('yaml bloque literal no da falso positivo', (await validateFile(put(join(d, 'ok.yml'), 'a:\n  d: |\n    x: 1\n    x: 2\n'))).ok)
  const js = await validateFile(put(join(d, 'bad.js'), 'const a = 1\nconst b = ;\n'))
  check('js roto con linea correcta', !js.ok && js.errors[0].line === 2, JSON.stringify(js.errors))
  check('js ok con shebang', (await validateFile(put(join(d, 's.js'), '#!/usr/bin/env node\nconsole.log(1)\n'))).ok)
  check('esm no es falso positivo', (await validateFile(put(join(d, 'e.js'), 'import fs from "fs"\nexport const x = 1\n'))).ok)
  check('archivo borrado no es error', (await validateFile(join(d, 'nope.json'))).ok)
})

await section('secret-scanner', async () => {
  const { scanText } = L('secret-scanner')
  const token = 'ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8'
  const f = scanText(`const t = "${token}"\nconst ok = process.env.KEY\nconst password = "your_password_here_xx"\n`, 'x.js')
  check('detecta token github', f.length === 1 && f[0].rule === 'github-token')
  check('no filtra el secreto completo', f.length === 1 && !JSON.stringify(f).includes(token))
})

await section('gitignore', async () => {
  const g = L('gitignore')
  const d = dir('gi')
  writeFileSync(join(d, '.gitignore'), 'node_modules/\n# comentario\ndist/\n')
  check('agrega sin duplicar', g.addRules(d, ['.env', 'dist/']).added.join() === '.env')
  g.removeRule(d, 'dist/')
  const t = read(join(d, '.gitignore'))
  check('conserva comentarios y quita la regla', t.includes('# comentario') && !t.includes('dist/') && t.includes('.env'))
  check('rechaza reglas con salto de linea', g.addRules(d, ['a\nb']).added.length === 0)
})

await section('snapshots', async () => {
  const s = L('snapshots')
  const proj = dir('snap-proj'), base = dir('snap-data')
  put(join(proj, 'a.txt'), 'uno')
  put(join(proj, 'node_modules', 'x.js'), 'no debe respaldarse')
  const c = s.createSnapshot(base, proj, 'manual uno')
  check('crea snapshot', c.ok && c.files === 1, JSON.stringify(c))
  writeFileSync(join(proj, 'a.txt'), 'ROTO')
  const r = s.restoreSnapshot(base, proj, c.id)
  check('restaura el contenido', r.ok && read(join(proj, 'a.txt')) === 'uno')
  check('crea respaldo de seguridad antes de restaurar', s.listSnapshots(base, proj).snapshots.some(x => x.label === 'antes-de-restaurar'))
  // Un zip VALIDO fuera de la carpeta de snapshots: sin validar el id, '../evil' lo encontraria y lo restauraria
  const AdmZip = req('adm-zip'); const evil = new AdmZip(); evil.addFile('pwned.txt', Buffer.from('x'))
  mkdirSync(join(base, 'snapshots'), { recursive: true }); evil.writeZip(join(base, 'snapshots', 'evil.zip'))
  check('rechaza id con .. aunque el zip exista', s.restoreSnapshot(base, proj, '../evil').ok === false && !existsSync(join(proj, 'pwned.txt')))
  check('rechaza borrar con id ..', s.deleteSnapshot(base, proj, '../evil').ok === false && existsSync(join(base, 'snapshots', 'evil.zip')))
  const proj2 = dir('snap-proj2'); put(join(proj2, 'a.txt'), '1')
  check('auto-snapshot crea', s.autoSnapshot(base, proj2, 'agente').ok === true)
  check('auto-snapshot respeta el limite de 1 minuto', s.autoSnapshot(base, proj2, 'agente').skipped === true)
  const proj3 = dir('snap-proj3'); put(join(proj3, 'a.txt'), '1')
  for (let i = 0; i < 3; i++) s.createSnapshot(base, proj3, 'man' + i)
  for (let i = 0; i < 8; i++) s.createSnapshot(base, proj3, 'auto-x' + i)
  const labels = s.listSnapshots(base, proj3).snapshots.map(x => x.label)
  check('cupo propio de automaticos (5) sin desplazar manuales', labels.filter(l => l.startsWith('auto-')).length === 5 && labels.filter(l => !l.startsWith('auto-')).length === 3, labels.join(','))
})

await section('jsdoc', async () => {
  const j = L('jsdoc')
  const f = put(join(dir('jsdoc'), 'a.js'), '/**\n * Ya documentada.\n */\nfunction yaDoc(a) { return a }\n\nfunction sumar(a, b = 2, ...rest) {\n  return a + b\n}\nfunction g(a, enc?: string) { return a }\nfunction h(a) { console.log(a) }\n')
  const pv = j.previewJsdoc(f)
  check('no documenta lo ya documentado', pv.count === 3 && !pv.items.some(i => i.name === 'yaDoc'), String(pv.count))
  const sum = pv.items.find(i => i.name === 'sumar').block
  check('parametros opcionales y rest', sum.includes('[b]') && sum.includes('{...*} rest') && sum.includes('@returns'))
  check('return en una linea / sin return', pv.items.find(i => i.name === 'g').block.includes('@returns') && !pv.items.find(i => i.name === 'h').block.includes('@returns'))
  check('opcional con ? se marca', pv.items.find(i => i.name === 'g').block.includes('[enc]'))
  check('aplica con descripcion saneada', j.applyJsdoc(f, { sumar: 'Suma */ dos valores.' }).inserted === 3 && read(f).includes('Suma  dos valores.') && !read(f).includes('*/ dos'))
  check('es idempotente', j.applyJsdoc(f).inserted === 0)
})

await section('license', async () => {
  const lic = L('license')
  const d = dir('lic')
  put(join(d, 'a.js'), 'const a = 1\n')
  put(join(d, 'b.js'), '#!/usr/bin/env node\nconsole.log(1)\n')
  put(join(d, 'c.js'), '/* Copyright (c) 2020 Otro */\nconst c = 1\n')
  put(join(d, 'd.py'), '# -*- coding: utf-8 -*-\nimport os\n')
  put(join(d, 'node_modules', 'x.js'), 'const x = 1\n')
  const opts = { holder: 'MC SERVICES', license: 'MIT', year: '2026' }
  check('exige titular', throws(() => lic.previewLicense(d, { holder: '' })))
  check('aplica solo a los que faltan', lic.applyLicense(d, opts).written === 3)
  check('conserva shebang', read(join(d, 'b.js')).startsWith('#!/usr/bin/env node\n'))
  check('conserva linea de encoding de python', read(join(d, 'd.py')).split('\n')[0].includes('coding'))
  check('no toca node_modules ni archivos con copyright', read(join(d, 'node_modules', 'x.js')) === 'const x = 1\n' && read(join(d, 'c.js')).startsWith('/* Copyright (c) 2020 Otro'))
  check('es idempotente', lic.applyLicense(d, opts).written === 0)
})

await section('scaffold', async () => {
  const sc = L('scaffold')
  const base = dir('sc-data'), proj = dir('sc-proj')
  put(join(base, 'templates', 'mala.json'), JSON.stringify({ label: 'Mala', files: { '../escape.txt': 'x' } }))
  check('plantilla con ruta ../ se rechaza', sc.createFromTemplate(base, proj, 'custom:mala', 'zz').ok === false && !existsSync(join(dirname(proj), 'escape.txt')) && !existsSync(join(proj, 'escape.txt')))
  check('nombre invalido (../x)', sc.createFromTemplate(base, proj, 'node-cli', '../x').ok === false)
  // Nombres que NO escapan de la carpeta: solo los frena la validacion del nombre (no la comprobacion de destino)
  for (const bad of ['con espacio', 'a:b', 'a;b', '', '-rf', 'x'.repeat(61)]) check(`nombre invalido ${JSON.stringify(bad)}`, sc.createFromTemplate(base, proj, 'node-cli', bad).ok === false && !existsSync(join(proj, bad || '_')))
  const ok = sc.createFromTemplate(base, proj, 'express-api', 'mi-api')
  check('crea desde plantilla integrada', ok.ok && read(join(proj, 'mi-api', 'package.json')).includes('"name": "mi-api"'))
  check('no pisa una carpeta con contenido', sc.createFromTemplate(base, proj, 'express-api', 'mi-api').ok === false)
})

await section('semver', async () => {
  const sv = L('semver')
  check('tabla de bump', sv.bump('1.2.3', 'patch') === '1.2.4' && sv.bump('1.2.3', 'minor') === '1.3.0' && sv.bump('1.2.3', 'major') === '2.0.0' && sv.bump('1.2.3-beta.1', 'patch') === '1.2.3')
  check('rechaza nivel invalido', throws(() => sv.bump('1.0.0', 'x')))
  const a = dir('sv-a')
  put(join(a, 'package.json'), '{\n    "name": "d",\n    "version": "1.4.9",\n    "scripts": { "a": "b" }\n}\n')
  put(join(a, 'manifest.json'), '{"version":"2.0.0"}')
  const before = read(join(a, 'package.json'))
  check('sube ambos manifiestos', sv.applyBump(a, 'minor').changed.length === 2)
  check('cambia solo el valor de version', read(join(a, 'package.json')) === before.replace('1.4.9', '1.5.0'))
  const b = dir('sv-b'); put(join(b, 'package.json'), '{"config":{"version":"9.9.9"},"name":"x","version":"1.0.0"}')
  check('version anidada primero: aborta sin tocar', throws(() => sv.applyBump(b, 'patch')) && read(join(b, 'package.json')).includes('"version":"1.0.0"'))
  const c = dir('sv-c'); put(join(c, 'package.json'), '{"version":"1.0.0"}'); put(join(c, 'manifest.json'), '{"version":"nada"}')
  check('todo o nada entre manifiestos', throws(() => sv.applyBump(c, 'patch')) && read(join(c, 'package.json')) === '{"version":"1.0.0"}')
  if (hasGit) {
    const g = dir('sv-git')
    const git = (...a) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', '-C', g, ...a], { stdio: 'pipe' })
    git('init', '-q'); put(join(g, 'a'), '1'); git('add', '-A'); git('commit', '-qm', 'feat: base'); git('tag', 'v1.0.0')
    for (const m of ['feat(ui): marcas', 'fix: crash', 'checkpoint: antes de tocar', 'chore: limpieza']) { writeFileSync(join(g, 'a'), m); git('add', '-A'); git('commit', '-qm', m) }
    writeFileSync(join(g, 'CHANGELOG.md'), '# Changelog\r\n\r\n## [1.0.0] - 2026-01-01\r\n\r\n### Added\r\n- algo\r\n')
    const pv = await sv.changelog(g, '1.1.0', 'preview')
    check('changelog ignora checkpoint y agrupa', pv.count === 3 && pv.markdown.includes('**ui:** marcas') && !pv.markdown.includes('checkpoint'), pv.markdown)
    await sv.changelog(g, '1.1.0', 'write')
    const t = read(join(g, 'CHANGELOG.md'))
    check('respeta CRLF y el orden', !/[^\r]\n/.test(t) && t.indexOf('## [1.1.0]') < t.indexOf('## [1.0.0]'))
    check('no repite una version', await rejects(sv.changelog(g, '1.1.0', 'write')))
  }
})

await section('cleaner', async () => {
  const cl = L('cleaner')
  const d = dir('clean', 'p')
  for (const f of ['.DS_Store', 'a.tmp', '.vite/x', 'node_modules/.cache/x', 'node_modules/pkg/.DS_Store', '.git/.DS_Store', 'keep.txt']) put(join(d, f), 'x')
  const r = cl.applyClean(d, ['os', 'tmp', 'cache'])
  check('borra solo lo regenerable', r.ok && r.deleted === 4, JSON.stringify(r))
  check('protege .git y node_modules/pkg', existsSync(join(d, '.git', '.DS_Store')) && existsSync(join(d, 'node_modules', 'pkg', '.DS_Store')) && existsSync(join(d, 'keep.txt')))
  check('exige categorias validas', cl.applyClean(d, ['nada', '../..']).ok === false)
  const outside = put(join(dir('clean', 'out'), 'important.txt'), 'SECRETO')
  let linked = true
  try { symlinkSync(outside, join(d, 'Thumbs.db')) } catch { linked = false } // en Windows puede requerir permisos
  if (linked) { cl.applyClean(d, ['os']); check('omite los symlinks (ni los borra ni los sigue)', read(outside) === 'SECRETO' && lstatSync(join(d, 'Thumbs.db')).isSymbolicLink()) }
})

await section('linkcheck', async () => {
  const lk = L('linkcheck')
  const d = dir('links')
  put(join(d, 'img', 'ok.png'), ''); put(join(d, 'public', 'logo.svg'), '')
  put(join(d, 'index.html'), '<img src="img/ok.png"><img src="img/falta.png"><a href="https://x.y/z">x</a><a href="#a"></a><img src="data:image/png;base64,AA"><a href="mailto:a@b.c"></a><img src="{{dyn}}"><img src="/logo.svg"><img src="../fuera.png">\n')
  const r = lk.scanLinks(d)
  check('solo marca el enlace realmente roto', r.findings.length === 1 && r.findings[0].ref === 'img/falta.png', JSON.stringify(r.findings))
})

await section('cssmin', async () => {
  const m = L('cssmin')
  check('quita ;; y el ultimo ;', m.minify('a { color : red ; ; }') === 'a{color : red}')
  check('conserva calc() y strings', m.minify('a{width:calc( 100% - 10px )}').includes('100% - 10px') && m.minify('a::before{content:"x  ;  }  /* y */"}').includes('"x  ;  }  /* y */"'))
  const v = m.minify(':root{--p:1px   2px ;--e: ;}')
  check('no toca el valor de las --variables', v.includes('--p:1px   2px') && v.includes('--e: ;'), v)
  const sample = '/*! lic */ a  >  b , c  :hover { margin : -1px  -2px ; background : url( x.png ) ; }\n@media screen  and ( min-width : 600px ) { a { color : red ; } }'
  check('es idempotente y verifica', m.minify(m.minify(sample)) === m.minify(sample) && m.verify(sample, m.minify(sample)) === '')
  check('rechaza comentario o string sin cerrar', throws(() => m.minify('a{}/* x')) && throws(() => m.minify('a{content:"x}\n')))
  check('verify rechaza CSS desbalanceado', m.verify('a{color:red}}', 'a{color:red}}') !== '')
  const d = dir('css')
  put(join(d, 'a.css'), '/* comentario largo para asegurar ahorro de bytes */\n.a {\n    color : red ;\n    margin : 0 ;\n}\n\n.b {\n    padding : 1px ;\n}\n'.repeat(4))
  put(join(d, 'a.min.css'), '.ajeno{}')
  check('respeta un .min.css ajeno', m.scanCss(d).files[0].status === 'exists' && m.applyCss(d).written === 0 && read(join(d, 'a.min.css')) === '.ajeno{}')
  rmSync(join(d, 'a.min.css'))
  const orig = read(join(d, 'a.css'))
  check('genera .min.css con marca sin tocar el original', m.applyCss(d).written === 1 && read(join(d, 'a.min.css')).startsWith(m.MARKER) && read(join(d, 'a.css')) === orig)
  check('re-aplicar sobrescribe solo los propios', m.applyCss(d).written === 1)
})

await section('snippets', async () => {
  const sn = L('snippets')
  const base = dir('snip-data')
  const list = sn.listSnippets(base).snippets.filter(s => !s.custom)
  check('hay snippets integrados', list.length >= 10, String(list.length))
  for (const s of list) {
    const r = await sn.renderSnippet(base, s.id, {})
    if (!r.ok || !r.valid || /\{\{/.test(r.code)) check(`snippet ${s.id}`, false, r.validationError || 'marcador sin reemplazar')
  }
  check('snippets integrados validos', true)
  for (const evil of ["80'; process.exit()", '3000`', '1}{', 'a$b', 'x\ny']) check(`rechaza parametro ${JSON.stringify(evil)}`, await rejects(sn.renderSnippet(base, 'http-server', { port: evil })))
})

await section('writer', async () => {
  const w = L('writer')
  check('solo acepta Ollama en localhost', throws(() => w.parseBase('http://example.com:11434')) && throws(() => w.parseBase('http://192.168.1.5:11434')) && throws(() => w.parseBase('file:///etc/passwd')))
  check('acepta loopback', w.parseBase('http://localhost:11434') === 'http://localhost:11434' && w.parseBase('http://127.0.0.1:11434').includes('127.0.0.1'))
  let mode = 'ok'
  const srv = createServer((rq, rs) => {
    if (rq.url === '/api/tags') return rs.end(JSON.stringify({ models: [{ name: 'm1' }] }))
    let b = ''; rq.on('data', c => { b += c }); rq.on('end', () => {
      const code = JSON.parse(b).prompt.match(/<snippet>\n([\s\S]*?)<\/snippet>/)?.[1] || ''
      const out = mode === 'ok' ? code.replace(/PORT/g, 'PUERTO') : 'x'
      rs.end(JSON.stringify({ response: '```js\n' + out + '```' }))
    })
  })
  await new Promise(r => srv.listen(0, '127.0.0.1', r))
  try {
    const url = 'http://127.0.0.1:' + srv.address().port
    const st = await w.status({ url })
    check('lista modelos', st.ok && st.models[0] === 'm1')
    const code = 'const PORT = 3000\nconsole.log(PORT)\nconsole.log("listo")\n'
    const ok = await w.adaptSnippet({ url, model: 'm1', code, language: 'javascript', context: '' })
    check('adapta nombres', ok.ok && ok.code.includes('PUERTO'))
    mode = 'tiny'
    check('descarta una adaptacion que reescribe de mas', (await w.adaptSnippet({ url, model: 'm1', code, language: 'javascript', context: '' })).ok === false)
    check('Ollama caido da error claro', await rejects(w.status({ url: 'http://127.0.0.1:1' })))
  } finally { srv.close() }
})

rmSync(tmp, { recursive: true, force: true })
if (failures.length) {
  console.error(`  X ${failures.length} comprobacion(es) fallida(s) (${passed} ok):`)
  for (const f of failures.slice(0, 15)) console.error('    - ' + f)
  process.exit(1)
}
console.log(`  OK (${passed} comprobaciones${hasGit ? '' : '; sin git: se omitio el changelog'})`)
