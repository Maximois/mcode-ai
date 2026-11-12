/**
 * Entrada dentro del contenedor: lee JSON por stdin, escribe un único JSON por stdout.
 * El proyecto está montado en /project (lectura/escritura mínima para npm audit).
 */
const chunks = []
process.stdin.on('data', (d) => chunks.push(d))
process.stdin.on('end', () => {
  let msg
  try {
    const raw = Buffer.concat(chunks).toString('utf8').trim()
    msg = JSON.parse(raw)
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: `docker_runner_stdin:${e.message}`, version: 3 }))
    process.exit(1)
    return
  }

  const sandboxIn = msg.sandbox || { ok: true }
  const options = msg.options || {}

  try {
    const { executeIntelScan } = require('./scan-core')
    const PROJECT = '/project'
    const report = executeIntelScan(
      PROJECT,
      {
        ...sandboxIn,
        ok: true,
        mode: 'docker-container',
        resolvedPath: PROJECT,
        note: 'Análisis dentro de contenedor Docker (vista acotada a /project + código del scanner montado read-only).',
      },
      options,
    )
    process.stdout.write(JSON.stringify(report))
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e.message || String(e), version: 3 }))
  }
})
