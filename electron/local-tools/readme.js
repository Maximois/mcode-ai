// Generador de README (cero tokens): arma el documento solo con metadatos locales
// (package.json + estructura). Devuelve también esos metadatos en crudo para que, en la
// fase 3, un modelo local ligero pueda redactar la introducción si el usuario lo activa.
const fs = require('fs')
const path = require('path')

const SKIP = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'build', 'out', '.venv', 'venv', '__pycache__', '.cache', '.vite', 'coverage'])

function readPkg(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8').replace(/^\uFEFF/, '')) } catch { return null }
}

function topLevel(root) {
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && !SKIP.has(e.name))
      .sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1))
      .slice(0, 40)
      .map(e => (e.isDirectory() ? e.name + '/' : e.name))
  } catch { return [] }
}

function collectMeta(root) {
  const pkg = readPkg(root)
  return {
    name: pkg?.name || path.basename(root),
    version: pkg?.version || '',
    description: pkg?.description || '',
    license: pkg?.license || '',
    main: pkg?.main || '',
    scripts: pkg?.scripts || {},
    dependencies: Object.keys(pkg?.dependencies || {}),
    devDependencies: Object.keys(pkg?.devDependencies || {}),
    tree: topLevel(root),
    hasPackageJson: !!pkg,
  }
}

function buildMarkdown(meta) {
  const L = []
  L.push(`# ${meta.name}`)
  if (meta.version) L.push('', `Versión \`${meta.version}\``)
  L.push('', meta.description || '_Agregá aquí una descripción del proyecto._')
  const scripts = Object.entries(meta.scripts)
  if (meta.hasPackageJson) {
    L.push('', '## Instalación', '', '```bash', 'npm install', '```')
  }
  if (scripts.length) {
    L.push('', '## Scripts', '', '| Comando | Qué ejecuta |', '| --- | --- |')
    for (const [k, v] of scripts) L.push(`| \`npm run ${k}\` | \`${String(v).replace(/\|/g, '\\|')}\` |`)
  }
  if (meta.tree.length) {
    L.push('', '## Estructura', '', '```', ...meta.tree, '```')
  }
  if (meta.dependencies.length) {
    L.push('', '## Dependencias', '', meta.dependencies.slice(0, 30).map(d => `- ${d}`).join('\n'))
    if (meta.dependencies.length > 30) L.push(`- … y ${meta.dependencies.length - 30} más`)
  }
  if (meta.license) L.push('', '## Licencia', '', meta.license)
  return L.join('\n') + '\n'
}

/**
 * mode 'preview' no escribe. mode 'write' nunca pisa un README.md existente:
 * en ese caso escribe README.generated.md.
 */
function generateReadme(root, mode = 'preview') {
  const meta = collectMeta(root)
  const markdown = buildMarkdown(meta)
  if (mode !== 'write') return { ok: true, markdown, meta }
  const target = fs.existsSync(path.join(root, 'README.md')) ? 'README.generated.md' : 'README.md'
  fs.writeFileSync(path.join(root, target), markdown, 'utf8')
  return { ok: true, markdown, meta, written: target }
}

module.exports = { generateReadme, collectMeta, buildMarkdown }
