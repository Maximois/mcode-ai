const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

/**
 * Ejecuta `npm audit --json` en rootDir (usa red del registry npm).
 * No sustituye políticas de seguridad corporativas; útil como señal para IA y revisiones.
 */
function runNpmAudit(rootDir, timeoutMs = 120000) {
  const pkgPath = path.join(rootDir, 'package.json')
  if (!fs.existsSync(pkgPath)) {
    return { skipped: true, reason: 'no_package_json' }
  }

  const attempts = []
  if (process.platform === 'win32') {
    attempts.push({ cmd: 'npm.cmd', args: ['audit', '--json'] })
    attempts.push({ cmd: 'npm', args: ['audit', '--json'] })
  } else {
    attempts.push({ cmd: 'npm', args: ['audit', '--json'] })
  }

  let last = null
  for (const { cmd, args } of attempts) {
    try {
      last = spawnSync(cmd, args, {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: timeoutMs,
        shell: false,
        windowsHide: true,
        maxBuffer: 12 * 1024 * 1024,
      })
      if (last.error && last.error.code === 'ENOENT') continue
      break
    } catch (e) {
      last = { error: e, status: 1, stdout: '', stderr: String(e.message) }
    }
  }

  if (!last || last.error?.code === 'ENOENT') {
    try {
      last = spawnSync('npm audit --json', {
        cwd: rootDir,
        encoding: 'utf8',
        timeout: timeoutMs,
        shell: true,
        windowsHide: true,
        maxBuffer: 12 * 1024 * 1024,
      })
    } catch (e) {
      last = last || { error: e, status: 1, stdout: '', stderr: String(e.message) }
    }
  }

  if (!last) {
    return { skipped: true, reason: 'spawn_failed', detail: 'npm no encontrado en PATH' }
  }

  const raw = String(last.stdout || '').trim()
  if (!raw) {
    return {
      skipped: false,
      ok: false,
      exitCode: last.status,
      stderr: String(last.stderr || '').slice(0, 500),
      summary: null,
      meta: null,
    }
  }

  let json
  try {
    json = JSON.parse(raw)
  } catch {
    return {
      skipped: false,
      ok: false,
      parseError: true,
      exitCode: last.status,
      stderr: String(last.stderr || '').slice(0, 300),
    }
  }

  const meta = json.metadata?.vulnerabilities || json.vulnerabilities?.metadata || null
  let critical = 0
  let high = 0
  let moderate = 0
  let low = 0
  let info = 0

  if (meta && typeof meta === 'object') {
    critical = meta.critical || 0
    high = meta.high || 0
    moderate = meta.moderate || 0
    low = meta.low || 0
    info = meta.info || 0
  }

  const vulnObj = json.vulnerabilities
  const names = vulnObj && typeof vulnObj === 'object' ? Object.keys(vulnObj) : []
  const top = []
  for (const name of names.slice(0, 40)) {
    const v = vulnObj[name]
    const sev = v?.severity || v?.via?.[0]?.severity || '?'
    top.push({ name, severity: sev })
  }
  top.sort((a, b) => rankSev(b.severity) - rankSev(a.severity))

  return {
    skipped: false,
    ok: last.status === 0 || (critical === 0 && high === 0),
    exitCode: last.status,
    summary: { critical, high, moderate, low, info, advisoryCount: names.length },
    topAdvisories: top.slice(0, 12),
  }
}

function rankSev(s) {
  const k = String(s).toLowerCase()
  if (k === 'critical') return 4
  if (k === 'high') return 3
  if (k === 'moderate') return 2
  if (k === 'low') return 1
  return 0
}

module.exports = { runNpmAudit }
