const path = require('path')
const { spawn } = require('child_process')
const scanCore = require('../scan-core')

function dockerBinary() {
  return process.env.MCAP_DOCKER_PATH || 'docker'
}

/** Imagen explícita (env) o, si existe localmente, la construida con `npm run docker:intel-image`; si no, node slim estándar. */
function resolveIntelDockerImage() {
  const fromEnv = process.env.MCAP_INTEL_DOCKER_IMAGE
  if (fromEnv && String(fromEnv).trim()) return String(fromEnv).trim()
  const { spawnSync } = require('child_process')
  const localTag = 'mcap-intel-sandbox:local'
  try {
    const r = spawnSync(dockerBinary(), ['image', 'inspect', localTag], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true,
      shell: process.platform === 'win32',
    })
    if (r.status === 0) return localTag
  } catch {}
  return 'node:20-bookworm-slim'
}

function dockerDaemonReachable() {
  const { spawnSync } = require('child_process')
  try {
    const r = spawnSync(dockerBinary(), ['info'], {
      encoding: 'utf8',
      timeout: 12000,
      windowsHide: true,
      shell: process.platform === 'win32',
    })
    return r.status === 0
  } catch {
    return false
  }
}

function normalizeDockerVolume(hostPath) {
  const resolved = path.resolve(hostPath)
  if (process.platform === 'win32') {
    return resolved.replace(/\\/g, '/')
  }
  return resolved
}

/**
 * Ejecuta scan-core dentro de node:… montando proyecto en /project y este directorio en /scan.
 */
function runIntelDocker(hostProjectPath, sandbox, options) {
  const scanRoot = path.join(__dirname, '..')
  const volProject = normalizeDockerVolume(hostProjectPath)
  const volScan = normalizeDockerVolume(scanRoot)
  const image = resolveIntelDockerImage()
  const payload = JSON.stringify({
    sandbox: { ...sandbox, docker: true },
    options,
  })

  const timeoutMs = options.npmAudit ? 300000 : 180000
  const netArgs = options.npmAudit ? [] : ['--network', 'none']
  const projectRw = options.npmAudit ? '' : ':ro'

  const args = [
    'run',
    '--rm',
    ...netArgs,
    '-v',
    `${volProject}:/project${projectRw}`,
    '-v',
    `${volScan}:/scan:ro`,
    '-w',
    '/project',
    image,
    'node',
    '/scan/docker-runner.js',
  ]

  return new Promise((resolve) => {
    const proc = spawn(dockerBinary(), args, {
      windowsHide: true,
      shell: false,
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(payload)
    }

    const timer = setTimeout(() => {
      try {
        proc.kill('SIGTERM')
      } catch {}
      finish({
        ok: false,
        error: 'docker_intel_timeout',
        version: 3,
        detail: stderr.slice(0, 400),
      })
    }, timeoutMs)

    proc.stdout.on('data', (d) => {
      stdout += d.toString('utf8')
    })
    proc.stderr.on('data', (d) => {
      stderr += d.toString('utf8')
    })
    proc.on('error', (e) => {
      finish({
        ok: false,
        error: `docker_spawn:${e.message}`,
        version: 3,
      })
    })
    proc.on('close', (code) => {
      const trimmed = stdout.trim()
      try {
        const report = JSON.parse(trimmed)
        if (report.ok === false && !report.summaryMarkdown) {
          finish({
            ok: false,
            error: report.error || 'docker_runner_failed',
            version: 3,
            stderr: stderr.slice(0, 600),
          })
          return
        }
        report.sandbox = {
          ...sandbox,
          ok: true,
          mode: 'docker-container',
          docker: true,
          dockerExitCode: code,
          dockerImage: image,
          dockerProjectReadOnly: !options.npmAudit,
          note: options.npmAudit
            ? 'Docker: /project lectura/escritura (npm audit); red saliente habilitada.'
            : 'Docker: /project solo lectura; sin red saliente (--network none).',
        }
        report.summaryMarkdown = scanCore.buildSummaryMarkdown(report)
        if (code !== 0 && report.ok) {
          report.sandbox.dockerWarning = `docker exit ${code}`
        }
        finish(report)
      } catch {
        finish({
          ok: false,
          error: 'docker_bad_stdout',
          version: 3,
          detail: stderr.slice(0, 400),
          stdoutPreview: trimmed.slice(0, 240),
        })
      }
    })

    proc.stdin.write(payload, 'utf8')
    proc.stdin.end()
  })
}

module.exports = { dockerDaemonReachable, runIntelDocker, dockerBinary, resolveIntelDockerImage }
