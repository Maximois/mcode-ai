// Verificacion rapida del proyecto. Uso:
//   npm run verify          -> sintaxis de electron/ + build real de vite (mas lento, mas confiable)
//   npm run verify -- --quick  -> solo sintaxis de electron/ (segundos)
// Sale con codigo != 0 si algo falla, para que un agente (o el CI) lo detecte.
import { spawnSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join, extname, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const quick = process.argv.includes('--quick')
let failed = 0

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (['.js', '.mjs', '.cjs'].includes(extname(p))) out.push(p)
  }
  return out
}

// 1) Sintaxis de todo el codigo del proceso principal de Electron
const files = [...walk(join(root, 'electron')), join(root, 'vite.config.js')]
console.log(`[1/2] Sintaxis: ${files.length} archivos`)
for (const f of files) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' })
  if (r.status !== 0) {
    failed++
    console.error(`  X ${f.replace(root, '.')}\n${(r.stderr || '').trim().split('\n').slice(0, 6).join('\n')}`)
  }
}
if (!failed) console.log('  OK')

// 1b) Pruebas del parser de herramientas del agente (regresion del bug de "[]" vacio)
console.log('[1b] Parser de herramientas (src/ai.js)')
{
  const r = spawnSync(process.execPath, ['--no-warnings', join(root, 'scripts', 'test-tools.mjs')], { encoding: 'utf8' })
  if (r.status !== 0) { failed++; console.error((r.stderr || r.stdout || '').trim().split('\n').slice(-10).join('\n')) }
  else console.log((r.stdout || '').trimEnd())
}

// 1c) Pruebas del mapa del proyecto (src/projectMap.js)
console.log('[1c] Mapa del proyecto (src/projectMap.js)')
{
  const r = spawnSync(process.execPath, ['--no-warnings', join(root, 'scripts', 'test-map.mjs')], { encoding: 'utf8' })
  if (r.status !== 0) { failed++; console.error((r.stderr || r.stdout || '').trim().split('\n').slice(-10).join('\n')) }
  else console.log((r.stdout || '').trimEnd())
}

// 2) Build real del renderer (detecta errores de JSX, imports rotos, etc.)
if (quick) {
  console.log('[2/2] Build de vite: omitido (--quick)')
} else {
  console.log('[2/2] Build de vite (npx vite build)...')
  const r = spawnSync('npx', ['vite', 'build'], { cwd: root, encoding: 'utf8', shell: true })
  if (r.status !== 0) {
    failed++
    const out = `${r.stdout || ''}\n${r.stderr || ''}`.trim().split('\n')
    console.error('  X vite build fallo:\n' + out.slice(-25).join('\n'))
  } else {
    console.log('  OK')
  }
}

if (failed) {
  console.error(`\nVERIFICACION FALLIDA (${failed} problema/s). Corregi y volve a correr: npm run verify`)
  process.exit(1)
}
console.log('\nVERIFICACION OK')
