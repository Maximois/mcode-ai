// Capa de herramientas locales de M Code AI (cero tokens).
// Módulos aislados: no reemplazan nada del editor. Se registran con UNA línea en main.js:
//   require('./local-tools').registerLocalTools(ipcMain, { app })
const path = require('path')
const { validateFile, isSupported } = require('./validator')
const { scanDir } = require('./secret-scanner')
const gitignore = require('./gitignore')
const snapshots = require('./snapshots')
const { indexFile } = require('./indexer')
const jsdoc = require('./jsdoc')
const license = require('./license')
const readme = require('./readme')
const scaffold = require('./scaffold')

function insideRoot(root, p) {
  const r = path.resolve(root)
  const f = path.resolve(String(p || ''))
  if (f !== r && !f.startsWith(r + path.sep)) throw new Error('El archivo está fuera del proyecto')
  return f
}

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

  // ── Fase 2: índice, documentación, licencias, scaffolding ──
  ipcMain.handle('lt-index-file',      wrap(({ root, p }) => indexFile(insideRoot(needRoot(root), p))))

  ipcMain.handle('lt-jsdoc-preview',   wrap(({ root, p }) => jsdoc.previewJsdoc(insideRoot(needRoot(root), p))))
  ipcMain.handle('lt-jsdoc-apply',     wrap(({ root, p }) => {
    const file = insideRoot(needRoot(root), p)
    const snap = snapshots.createSnapshot(baseDir, root, 'antes-de-jsdoc')
    if (!snap.ok) return { ok: false, error: 'No se aplicó: falló el snapshot previo (' + snap.error + ')' }
    return { ...jsdoc.applyJsdoc(file), snapshotId: snap.id }
  }))

  ipcMain.handle('lt-license-preview', wrap(({ root, opts }) => license.previewLicense(needRoot(root), opts || {})))
  ipcMain.handle('lt-license-apply',   wrap(({ root, opts }) => {
    needRoot(root)
    license.previewLicense(root, opts || {}) // valida opciones antes de crear el snapshot
    const snap = snapshots.createSnapshot(baseDir, root, 'antes-de-licencias')
    if (!snap.ok) return { ok: false, error: 'No se aplicó: falló el snapshot previo (' + snap.error + ')' }
    return { ...license.applyLicense(root, opts || {}), snapshotId: snap.id }
  }))

  ipcMain.handle('lt-readme',          wrap(({ root, mode }) => readme.generateReadme(needRoot(root), mode === 'write' ? 'write' : 'preview')))

  ipcMain.handle('lt-scaffold-list',   wrap(() => scaffold.listTemplates(baseDir)))
  ipcMain.handle('lt-scaffold-create', wrap(({ root, templateId, name }) => scaffold.createFromTemplate(baseDir, needRoot(root), templateId, name)))
}

module.exports = { registerLocalTools }
