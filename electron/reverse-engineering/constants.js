/** Directorios que no se recorren en escaneos de intel (ruido / enormes). */
const SKIP_DIRS = new Set([
  'node_modules', '__pycache__', 'dist', '.git', 'dist-electron', '.venv', 'venv',
  'env', 'build', 'target', 'vendor', 'bower_components', '.next', '.nuxt', 'coverage',
  '.cache', 'tmp', 'temp', 'logs', 'out', '.turbo', '.parcel-cache', 'Pods',
])

module.exports = { SKIP_DIRS }
