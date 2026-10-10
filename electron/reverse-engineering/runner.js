const fs = require('fs')
const path = require('path')
const { fork } = require('child_process')
const { resolveSandboxContext, MODES } = require('./sandbox/adapter')
const { dockerDaemonReachable, runIntelDocker } = require('./sandbox/docker-exec')
const scanCore = require('./scan-core')

function normalizeSandboxMode(mode) {
  if (mode === 'docker' || mode === 'child-process' || mode === 'host-direct') return mode
  return 'host-direct'
}

/**
 * Proceso hijo Node (execPath configurable) para aislar CPU/memoria del proceso Electron.
 */
function forkIntelWorker(resolvedPath, sandbox, options) {
  return new Promise((resolve) => {
    const workerPath = path.join(__dirname, 'intel-worker.js')
    const timeoutMs = options.npmAudit ? 240000 : 120000
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(payload)
    }

    const timer = setTimeout(() => {
      try {
        child.kill('SIGTERM')
      } catch {}
      finish({
        ok: false,
        error: 'intel_worker_timeout',
        version: 3,
        rootDir: resolvedPath,
      })
    }, timeoutMs)

    let child
    try {
      child = fork(workerPath, [], {
        cwd: resolvedPath,
        execPath: process.env.MCAP_NODE_EXEC || 'node',
        env: { ...process.env },
        silent: true,
      })
    } catch (e) {
      clearTimeout(timer)
      return resolve({
        ok: false,
        error: `fork_failed:${e.message}`,
        detail: '¿Tenés Node.js en PATH? Probá MCAP_NODE_EXEC=ruta\\node.exe',
        version: 3,
      })
    }

    child.on('message', (m) => {
      if (m?.ok && m.report) {
        const report = m.report
        report.sandbox = {
          ...sandbox,
          ok: true,
          forked: true,
          note:
            'Análisis en proceso Node hijo (cwd = proyecto). Fallbacks si Docker u otro modo falla.',
        }
        report.summaryMarkdown = scanCore.buildSummaryMarkdown(report)
        finish(report)
      } else {
        finish({
          ok: false,
          error: m?.error || 'worker_failed',
          version: 3,
        })
      }
    })

    child.on('error', (e) => {
      finish({ ok: false, error: e.message, version: 3 })
    })

    child.on('exit', (code, signal) => {
      if (!settled) {
        finish({
          ok: false,
          error: `worker_exit:${code}:${signal || ''}`,
          version: 3,
        })
      }
    })

    child.send({
      rootDir: resolvedPath,
      sandbox: { ...sandbox, forked: true },
      options,
    })
  })
}

async function tryForkFallback(resolvedPath, sandbox, scanOptions, reason) {
  const childSandbox = {
    ...sandbox,
    mode: MODES.CHILD_PROCESS,
    preferredMode: 'child-process',
    note: `${sandbox.note} Fallback proceso hijo (${reason}).`,
  }
  const forked = await forkIntelWorker(resolvedPath, childSandbox, scanOptions)
  if (forked && forked.ok !== false && forked.summaryMarkdown) {
    return forked
  }
  return scanCore.executeIntelScan(resolvedPath, {
    ...sandbox,
    mode: MODES.HOST_DIRECT,
    note: `${sandbox.note} Fallback proceso principal (${reason}: ${forked?.error || '?'}).`,
  }, scanOptions)
}

/**
 * @param {string} rootDir
 * @param {{ depth?: string, npmAudit?: boolean, sandboxMode?: string }} opts
 */
async function runProjectIntelligence(rootDir, opts = {}) {
  if (!rootDir || typeof rootDir !== 'string') {
    return { ok: false, error: 'invalid_root', version: 3 }
  }
  const resolved = path.resolve(rootDir)
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: 'root_not_found', version: 3, rootDir: resolved }
  }

  const sandboxMode = normalizeSandboxMode(opts.sandboxMode)
  const sandbox = resolveSandboxContext(resolved, { preferredMode: sandboxMode })

  if (!sandbox.ok) {
    return {
      ok: false,
      error: sandbox.error || 'sandbox_denied',
      version: 3,
      rootDir: resolved,
      sandbox,
    }
  }

  const depth = opts.depth === 'quick' ? 'quick' : 'standard'
  const npmAudit = !!opts.npmAudit && depth !== 'quick'

  const scanOptions = {
    depth,
    npmAudit,
    binaryStringsPreview: !!opts.binaryStringsPreview && depth !== 'quick',
  }

  if (sandbox.mode === MODES.DOCKER_CONTAINER) {
    const dockerOk = dockerDaemonReachable()
    if (dockerOk) {
      const dr = await runIntelDocker(sandbox.resolvedPath, sandbox, scanOptions)
      if (dr.ok !== false && dr.summaryMarkdown) {
        return dr
      }
      return tryForkFallback(sandbox.resolvedPath, sandbox, scanOptions, 'docker')
    }
    return tryForkFallback(sandbox.resolvedPath, sandbox, scanOptions, 'docker_unavailable')
  }

  if (sandbox.mode === MODES.CHILD_PROCESS) {
    const forked = await forkIntelWorker(sandbox.resolvedPath, sandbox, scanOptions)
    if (forked && forked.ok !== false && forked.summaryMarkdown) {
      return forked
    }
    const fb = scanCore.executeIntelScan(sandbox.resolvedPath, {
      ...sandbox,
      mode: MODES.HOST_DIRECT,
      note: `${sandbox.note} Fallback: escaneo en proceso principal (fork falló: ${forked?.error || '?' }).`,
    }, scanOptions)
    fb.sandbox.fallbackFromFork = true
    return fb
  }

  return scanCore.executeIntelScan(sandbox.resolvedPath, sandbox, scanOptions)
}

module.exports = {
  runProjectIntelligence,
  executeIntelScan: scanCore.executeIntelScan,
  buildSummaryMarkdown: scanCore.buildSummaryMarkdown,
}
