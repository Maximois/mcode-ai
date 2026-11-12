const path = require('path')
const fs = require('fs')

/**
 * Capa de aislamiento para análisis / ingeniería inversa.
 * - host-direct: mismo proceso Electron.
 * - child-process: fork Node en el host.
 * - docker-container: contenedor con volumen del proyecto (fallback a hijo → host).
 */

const MODES = {
  HOST_DIRECT: 'host-direct',
  CHILD_PROCESS: 'child-process',
  DOCKER_CONTAINER: 'docker-container',
}

/**
 * @param {string} rootDir - Carpeta del proyecto (absoluta normalizada).
 * @param {{ preferredMode?: string }} [opts]
 */
function resolveSandboxContext(rootDir, opts = {}) {
  const resolved = path.resolve(rootDir)
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    return {
      ok: false,
      mode: null,
      error: 'not_a_directory',
      resolvedPath: resolved,
    }
  }

  const lower = resolved.toLowerCase()
  if (process.platform === 'win32') {
    if (/^[a-z]:\\windows\\|^\\\\/.test(lower)) {
      return { ok: false, mode: null, error: 'unsafe_path', resolvedPath: resolved }
    }
  } else if (resolved === '/' || resolved.startsWith('/System') || resolved.startsWith('/usr/')) {
    return { ok: false, mode: null, error: 'unsafe_path', resolvedPath: resolved }
  }

  const pref = opts.preferredMode || 'host-direct'
  let mode = MODES.HOST_DIRECT
  let note =
    'Escaneo en el proceso del editor (rápido). Otros modos en Configuración → Intel proyecto.'

  if (pref === 'docker') {
    mode = MODES.DOCKER_CONTAINER
    note =
      'Escaneo preferente en contenedor Docker: proceso y red aisladas (sin npm audit → sin red saliente).'
  } else if (pref === 'child-process') {
    mode = MODES.CHILD_PROCESS
    note =
      'Escaneo preferente en proceso Node hijo (menos carga en Electron). npm audit usa red solo si lo activás.'
  }

  return {
    ok: true,
    mode,
    resolvedPath: resolved,
    preferredMode: pref,
    note,
    capabilities: {
      staticFsRead: true,
      docker: mode === MODES.DOCKER_CONTAINER,
      childProcess: mode === MODES.CHILD_PROCESS || mode === MODES.DOCKER_CONTAINER,
      networkOptional: true,
    },
  }
}

module.exports = { resolveSandboxContext, MODES }
