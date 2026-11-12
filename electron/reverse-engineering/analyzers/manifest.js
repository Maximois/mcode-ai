const fs = require('fs')
const path = require('path')

/**
 * Lectura estática de manifiestos: package.json, pistas Electron/Vite/webpack.
 */
function analyzeManifest(rootDir) {
  const out = {
    kind: 'unknown',
    packageJsonPath: null,
    name: null,
    version: null,
    scripts: {},
    main: null,
    module: null,
    electron: { isElectronApp: false, electronVersion: null, mainEntry: null, hasBuilder: false },
    dependencies: { prod: 0, dev: 0, peer: 0, sampleProd: [], sampleDev: [] },
    engines: null,
    conflicts: [],
    hints: [],
  }

  const pkgPath = path.join(rootDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    out.hints.push('No hay package.json — proyecto no-Node o carpeta parcial.')
    return out
  }

  out.packageJsonPath = pkgPath
  let pkg
  try {
    pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
  } catch (e) {
    out.conflicts.push({ severity: 'error', code: 'package_json_parse', message: `package.json inválido: ${e.message}` })
    return out
  }

  out.name = pkg.name || null
  out.version = pkg.version || null
  out.scripts = typeof pkg.scripts === 'object' && pkg.scripts ? { ...pkg.scripts } : {}
  out.main = pkg.main || null
  out.module = pkg.module || null
  if (pkg.engines && typeof pkg.engines === 'object') out.engines = { ...pkg.engines }

  const dep = pkg.dependencies && typeof pkg.dependencies === 'object' ? pkg.dependencies : {}
  const devDep = pkg.devDependencies && typeof pkg.devDependencies === 'object' ? pkg.devDependencies : {}
  const peer = pkg.peerDependencies && typeof pkg.peerDependencies === 'object' ? pkg.peerDependencies : {}

  out.dependencies.prod = Object.keys(dep).length
  out.dependencies.dev = Object.keys(devDep).length
  out.dependencies.peer = Object.keys(peer).length
  out.dependencies.sampleProd = Object.keys(dep).slice(0, 12)
  out.dependencies.sampleDev = Object.keys(devDep).slice(0, 12)

  const electronVer = dep.electron || devDep.electron || peer.electron
  if (electronVer) {
    out.kind = 'electron'
    out.electron.isElectronApp = true
    out.electron.electronVersion = String(electronVer)
    out.electron.mainEntry = pkg.main || 'main.js (por convención)'
    out.hints.push('Proyecto Electron: evitar anidar otra app Electron dentro del editor; usar ventana Preview y sesión aparte.')
  } else if (dep.react || devDep.react || dep.vue || dep['@angular/core']) {
    out.kind = dep.react || devDep.react ? 'react' : dep.vue ? 'vue' : 'angular'
  } else if (out.scripts.dev || out.scripts.start) {
    out.kind = 'node'
  }

  if (pkg.build && typeof pkg.build === 'object' && (pkg.build.appId || pkg.build.productName)) {
    out.electron.hasBuilder = true
  }

  if (!out.scripts.dev && !out.scripts.start && out.kind === 'node') {
    out.conflicts.push({ severity: 'warn', code: 'no_dev_script', message: 'No hay scripts dev/start en package.json — el panel Dev puede necesitar comando manual.' })
  }

  const viteConfig = ['vite.config.js', 'vite.config.ts', 'vite.config.mjs'].some(f => fs.existsSync(path.join(rootDir, f)))
  if (viteConfig) {
    out.hints.push('Vite detectado: revisar puerto y base en vite.config si el preview no carga.')
  }

  return out
}

module.exports = { analyzeManifest }
