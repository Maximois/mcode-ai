const fs = require('fs')
const path = require('path')

/**
 * Lockfiles y coherencia básica con package.json (sin ejecutar npm).
 */
function analyzeDependencies(rootDir) {
  const out = {
    lockfile: null,
    lockfilePath: null,
    lockPackageEstimate: null,
    conflicts: [],
    hints: [],
  }

  const pkgPath = path.join(rootDir, 'package.json')
  const hasPkg = fs.existsSync(pkgPath)

  const candidates = [
    { type: 'npm', file: 'package-lock.json' },
    { type: 'npm', file: 'npm-shrinkwrap.json' },
    { type: 'yarn', file: 'yarn.lock' },
    { type: 'pnpm', file: 'pnpm-lock.yaml' },
    { type: 'bun', file: 'bun.lockb' },
  ]

  for (const c of candidates) {
    const p = path.join(rootDir, c.file)
    if (fs.existsSync(p)) {
      out.lockfile = c.type
      out.lockfilePath = c.file
      if (c.file === 'package-lock.json' || c.file === 'npm-shrinkwrap.json') {
        out.lockPackageEstimate = estimateNpmLockPackages(p)
      }
      break
    }
  }

  if (hasPkg && !out.lockfile) {
    out.conflicts.push({
      severity: 'warn',
      code: 'deps:no_lockfile',
      message: 'Hay package.json pero no lockfile detectado — versiones menos reproducibles; generá package-lock / pnpm-lock / yarn.lock.',
    })
  }

  if (out.lockfile === 'pnpm') {
    out.hints.push('pnpm-lock presente: en CI usar la misma herramienta (pnpm i --frozen-lockfile).')
  }

  return out
}

function estimateNpmLockPackages(lockPath) {
  try {
    const raw = fs.readFileSync(lockPath, 'utf8')
    const json = JSON.parse(raw)
    if (json.packages && typeof json.packages === 'object') {
      return Object.keys(json.packages).length
    }
    if (json.dependencies && typeof json.dependencies === 'object') {
      return countNestedDeps(json.dependencies)
    }
  } catch {
    return null
  }
  return null
}

function countNestedDeps(deps) {
  let n = 0
  const walk = (d) => {
    if (!d || typeof d !== 'object') return
    for (const k of Object.keys(d)) {
      n++
      if (d[k].dependencies) walk(d[k].dependencies)
    }
  }
  walk(deps)
  return n
}

module.exports = { analyzeDependencies }
