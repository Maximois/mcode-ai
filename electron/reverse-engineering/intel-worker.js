/**
 * Proceso hijo Node: mensaje IPC desde fork → executeIntelScan → respuesta.
 */
process.on('message', (msg) => {
  try {
    const { executeIntelScan } = require('./scan-core')
    const { rootDir, sandbox, options } = msg || {}
    if (!rootDir) {
      process.send({ ok: false, error: 'missing_rootDir', version: 3 })
      return
    }
    const report = executeIntelScan(rootDir, sandbox || { ok: true, mode: 'child-process' }, options || {})
    process.send({ ok: true, report })
  } catch (e) {
    process.send({ ok: false, error: e.message || String(e), version: 3 })
  }
})
