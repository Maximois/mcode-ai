// Capa de herramientas locales de M Code AI (cero tokens).
// Módulos aislados: no reemplazan nada del editor. Se registran con UNA línea en main.js:
//   require('./local-tools').registerLocalTools(ipcMain, { app })
const path = require('path')
const { validateFile, isSupported } = require('./validator')
const { scanDir } = require('./secret-scanner')
const gitignore = require('./gitignore')
const snapshots = require('./snapshots')

function wrap(fn) {
  return async (_, args) => {
    try { return await fn(args || {}) } catch (e) { return { ok: false, error: e && e.message ? e.message : String(e) } }
  }
}

function needRoot(root) {
  if (!root || typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Falta la carpeta del proyecto')
  return root
}

function registerLocalTools(ipcMain, { app }) {
  const baseDir = path.join(app.getPath('userData'), 'local-tools')

  ipcMain.handle('lt-validate',        wrap(({ p }) => validateFile(p)))
  ipcMain.handle('lt-validate-ext',    wrap(({ p }) => ({ ok: true, supported: isSupported(p) })))

  ipcMain.handle('lt-secrets-scan',    wrap(({ root }) => scanDir(needRoot(root))))

  ipcMain.handle('lt-gitignore-read',  wrap(({ root }) => gitignore.readRules(needRoot(root))))
  ipcMain.handle('lt-gitignore-add',   wrap(({ root, rules }) => gitignore.addRules(needRoot(root), rules)))
  ipcMain.handle('lt-gitignore-remove', wrap(({ root, rule }) => gitignore.removeRule(needRoot(root), rule)))

  ipcMain.handle('lt-snap-create',     wrap(({ root, label }) => snapshots.createSnapshot(baseDir, needRoot(root), label)))
  ipcMain.handle('lt-snap-list',       wrap(({ root }) => snapshots.listSnapshots(baseDir, needRoot(root))))
  ipcMain.handle('lt-snap-restore',    wrap(({ root, id }) => snapshots.restoreSnapshot(baseDir, needRoot(root), id)))
  ipcMain.handle('lt-snap-delete',     wrap(({ root, id }) => snapshots.deleteSnapshot(baseDir, needRoot(root), id)))
}

module.exports = { registerLocalTools }
