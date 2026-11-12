const { analyzeManifest } = require('./analyzers/manifest')
const { analyzeHotspots } = require('./analyzers/hotspots')
const { analyzePatterns } = require('./analyzers/patterns')
const { analyzeDependencies } = require('./analyzers/dependencies')
const { analyzeImports } = require('./analyzers/imports')
const { analyzeBinaries } = require('./analyzers/binaries')
const { runNpmAudit } = require('./analyzers/npm-audit')
const { previewBinaryStrings } = require('./analyzers/native-strings')

function formatBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function buildUnifiedSignals(manifest, patterns, dependencies, binaries, npmAuditResult) {
  const list = []
  for (const c of manifest.conflicts || []) {
    list.push({ severity: c.severity, code: c.code, message: c.message, source: 'manifest' })
  }
  for (const c of dependencies.conflicts || []) {
    list.push({ severity: c.severity, code: c.code, message: c.message, source: 'dependencies' })
  }
  for (const s of patterns.signals || []) {
    if (s.severity === 'error' || s.severity === 'warn') {
      list.push({
        severity: s.severity,
        code: `pattern:${s.id}`,
        message: `${s.label}: ${s.count} ocurrencia(s) en el muestreo`,
        source: 'patterns',
        sampleFiles: s.sampleFiles,
      })
    }
  }
  const consoleSig = patterns.signals?.find(s => s.id === 'console_log')
  if (consoleSig && consoleSig.count > 40) {
    list.push({
      severity: 'info',
      code: 'noise:console',
      message: `Muchos console.log en muestra (${consoleSig.count}) — considerar logger o niveles para producción.`,
      source: 'patterns',
    })
  }
  if (binaries.nodeAddonCount > 0) {
    list.push({
      severity: 'info',
      code: 'native:node_addon',
      message: `${binaries.nodeAddonCount} archivo(s) .node — addons nativos; validar arquitectura y ABI.`,
      source: 'binaries',
    })
  }

  if (npmAuditResult && !npmAuditResult.skipped && npmAuditResult.summary) {
    const { critical = 0, high = 0, moderate = 0 } = npmAuditResult.summary
    if (critical > 0) {
      list.push({
        severity: 'error',
        code: 'npm_audit:critical',
        message: `npm audit: ${critical} vulnerabilidad(es) critical (${high} high, ${moderate} moderate).`,
        source: 'npm-audit',
      })
    } else if (high > 0) {
      list.push({
        severity: 'warn',
        code: 'npm_audit:high',
        message: `npm audit: ${high} high (${moderate} moderate). Revisar dependencias.`,
        source: 'npm-audit',
      })
    } else if (moderate > 0 && !npmAuditResult.ok) {
      list.push({
        severity: 'info',
        code: 'npm_audit:moderate',
        message: `npm audit: ${moderate} moderate — conviene actualizar cuando sea posible.`,
        source: 'npm-audit',
      })
    }
  }

  return list
}

function buildSummaryMarkdown(report) {
  const m = report.manifest
  const lines = []
  lines.push(`## Intel de proyecto (${report.durationMs} ms)`)
  lines.push(`**Raíz:** \`${report.rootDir}\``)
  lines.push(`**Tipo inferido:** ${m.kind}${m.electron?.isElectronApp ? ' · Electron' : ''}`)
  if (m.name) lines.push(`**package:** ${m.name}@${m.version || '?'}`)
  if (m.electron?.isElectronApp) {
    lines.push(`**Electron:** ${m.electron.electronVersion || '?'} · main: \`${m.electron.mainEntry}\``)
  }
  if (Object.keys(m.scripts).length) {
    lines.push(`**Scripts:** ${Object.keys(m.scripts).slice(0, 10).join(', ')}${Object.keys(m.scripts).length > 10 ? '…' : ''}`)
  }
  lines.push('')
  lines.push('### Optimización / tamaño')
  const top = report.hotspots.largestTextFiles.slice(0, 6)
  if (top.length) {
    for (const f of top) {
      lines.push(`- \`${f.path}\` — ${formatBytes(f.bytes)}`)
    }
  } else {
    lines.push('- (sin archivos de texto grandes en el muestreo)')
  }
  lines.push('')
  lines.push('### Señales de código (muestreo)')
  if (report.patterns.signals.length === 0) {
    lines.push('- Nada destacado en los archivos revisados.')
  } else {
    for (const s of report.patterns.signals.slice(0, 12)) {
      lines.push(`- **${s.label}** (${s.severity}): ${s.count} — ej. ${s.sampleFiles.map(f => f.path).slice(0, 3).join(', ')}`)
    }
  }
  if (m.hints.length) {
    lines.push('')
    lines.push('### Notas')
    for (const h of m.hints) lines.push(`- ${h}`)
  }
  if (report.unifiedSignals.filter(u => u.severity === 'error').length) {
    lines.push('')
    lines.push('### Atención')
    for (const u of report.unifiedSignals.filter(x => x.severity === 'error')) {
      lines.push(`- **${u.code}:** ${u.message}`)
    }
  }

  const dep = report.dependencies
  if (dep) {
    lines.push('')
    lines.push('### Dependencias / lockfile')
    if (dep.lockfile) {
      lines.push(`- Lock: **${dep.lockfile}** (\`${dep.lockfilePath}\`)${dep.lockPackageEstimate != null ? ` · ~${dep.lockPackageEstimate} entradas` : ''}`)
    } else if (report.manifest.packageJsonPath) {
      lines.push('- Sin lockfile detectado (ver avisos).')
    } else {
      lines.push('- Sin package.json en la raíz del escaneo.')
    }
    for (const h of dep.hints || []) lines.push(`- ${h}`)
  }

  const na = report.npmAudit
  if (na && !na.skipped) {
    lines.push('')
    lines.push('### npm audit (requiere red)')
    if (na.summary) {
      const s = na.summary
      lines.push(`- Critical: **${s.critical}** · High: **${s.high}** · Moderate: ${s.moderate} · Low: ${s.low}`)
      if (na.topAdvisories?.length) {
        lines.push('- Ejemplos:')
        for (const a of na.topAdvisories.slice(0, 8)) {
          lines.push(`  - \`${a.name}\` (${a.severity})`)
        }
      }
    } else if (na.detail || na.stderr) {
      lines.push(`- No se pudo obtener JSON (${na.detail || na.stderr || 'error'})`)
    }
  } else if (na?.skipped && na.reason === 'no_package_json') {
    lines.push('')
    lines.push('### npm audit')
    lines.push('- Omitido: sin package.json.')
  }

  if (report.imports && report.imports.hubFiles?.length) {
    lines.push('')
    lines.push('### Grafos de import (heurística, sin AST)')
    lines.push('Archivos con más imports/requires en el muestreo:')
    for (const h of report.imports.hubFiles.slice(0, 8)) {
      lines.push(`- \`${h.path}\` — ${h.degree} (rel: ${h.relativeCount}, pkg: ${h.packageCount})`)
    }
    if (report.imports.topPackages?.length) {
      lines.push('')
      lines.push('Paquetes más referenciados (nombre scoped/base):')
      for (const p of report.imports.topPackages.slice(0, 10)) {
        lines.push(`- \`${p.name}\` × ${p.count}`)
      }
    }
    if (report.imports.couplingHints?.length) {
      lines.push('')
      lines.push('Posible acoplamiento fuerte (mismo muestreo):')
      for (const c of report.imports.couplingHints.slice(0, 6)) {
        lines.push(`- \`${c.from}\` → \`${c.to}\` (\`${c.via}\`)`)
      }
    }
  }

  if (report.binaries?.binaries?.length) {
    lines.push('')
    lines.push('### Binarios / nativos (inventario, sin ejecutar)')
    for (const b of report.binaries.binaries.slice(0, 12)) {
      lines.push(`- \`${b.path}\` (${b.ext}) — ${formatBytes(b.bytes)}`)
    }
    if (report.binaries.binaries.length > 12) lines.push('- … y más')
  }

  const bs = report.binaryStrings
  if (bs && !bs.skipped && bs.samples?.length) {
    lines.push('')
    lines.push('### Binarios — `file` / `strings` (muestreo)')
    if (!bs.stringsAvailable) {
      lines.push('- `strings` no está en PATH (instalá binutils o usá la imagen Docker `mcap-intel-sandbox:local`: `npm run docker:intel-image`).')
    }
    for (const s of bs.samples) {
      lines.push(`- **\`${s.path}\`** (${s.ext}) — ${formatBytes(s.bytes)}`)
      if (s.fileType) lines.push(`  - **file:** ${s.fileType}`)
      if (s.stringsLines) {
        const snip = s.stringsLines.length > 1600 ? `${s.stringsLines.slice(0, 1600)}\n…` : s.stringsLines
        lines.push(`  - **strings:**\n\`\`\`\n${snip}\n\`\`\``)
      }
    }
  }

  if (report.sandbox) {
    lines.push('')
    lines.push(`### Sandbox: **${report.sandbox.mode}**${report.sandbox.forked ? ' (proceso hijo)' : ''}`)
    lines.push(`- ${report.sandbox.note}`)
  }

  return lines.join('\n')
}

/**
 * Escaneo completo en el proceso actual (Electron principal o worker Node).
 * @param {string} resolvedPath - Raíz absoluta ya validada
 * @param {object} sandbox - Contexto de sandbox del padre
 * @param {{ depth?: string, npmAudit?: boolean, binaryStringsPreview?: boolean }} options
 */
function executeIntelScan(resolvedPath, sandbox, options = {}) {
  const started = Date.now()
  const depth = options.depth || 'standard'
  const isQuick = depth === 'quick'
  const wantAudit = !!options.npmAudit && !isQuick
  const wantStrings = !!options.binaryStringsPreview && !isQuick

  const manifest = analyzeManifest(resolvedPath)
  const dependencies = analyzeDependencies(resolvedPath)
  const hotspots = analyzeHotspots(resolvedPath, isQuick ? { maxDepth: 6, maxFilesScanned: 800 } : {})
  const patterns = analyzePatterns(resolvedPath, isQuick ? { maxDepth: 5 } : {})
  const imports = isQuick ? null : analyzeImports(resolvedPath)
  const binaries = analyzeBinaries(resolvedPath, isQuick ? { maxList: 15, maxDepth: 5 } : { maxList: 45, maxDepth: 6 })

  let binaryStrings = null
  if (wantStrings && binaries.binaries?.length) {
    binaryStrings = previewBinaryStrings(resolvedPath, binaries.binaries)
  }

  let npmAudit = null
  if (wantAudit) {
    npmAudit = runNpmAudit(resolvedPath, 120000)
  }

  const unifiedSignals = buildUnifiedSignals(manifest, patterns, dependencies, binaries, npmAudit)
  const report = {
    ok: true,
    version: 3,
    rootDir: resolvedPath,
    durationMs: Date.now() - started,
    sandbox: { ...sandbox, ok: true },
    manifest,
    dependencies,
    hotspots,
    patterns,
    imports,
    binaries,
    binaryStrings,
    npmAudit,
    unifiedSignals,
    summaryMarkdown: '',
  }
  report.summaryMarkdown = buildSummaryMarkdown(report)
  return report
}

module.exports = {
  executeIntelScan,
  buildSummaryMarkdown,
  formatBytes,
}
