// Asistente de scaffolding (cero tokens): crea árboles de carpetas y archivos base desde plantillas JSON.
// Plantillas integradas + las que el usuario deje en <userData>/local-tools/templates/*.json.
// Formato: { "id", "label", "description", "files": { "ruta/relativa": "contenido con {{name}}" } }
const fs = require('fs')
const path = require('path')

const BUILTIN = [
  {
    id: 'node-cli', label: 'Node CLI', description: 'Herramienta de línea de comandos mínima',
    files: {
      'package.json': '{\n  "name": "{{name}}",\n  "version": "0.1.0",\n  "description": "",\n  "main": "src/index.js",\n  "bin": { "{{name}}": "bin/cli.js" },\n  "scripts": { "start": "node bin/cli.js" },\n  "license": "MIT"\n}\n',
      'bin/cli.js': "#!/usr/bin/env node\nrequire('../src/index.js').main(process.argv.slice(2))\n",
      'src/index.js': "function main(args) {\n  console.log('{{name}}', args)\n}\n\nmodule.exports = { main }\n",
      '.gitignore': 'node_modules/\n.env\n*.log\n',
      'README.md': '# {{name}}\n\nHerramienta CLI.\n',
    },
  },
  {
    id: 'express-api', label: 'API Express', description: 'Servidor HTTP con una ruta de salud',
    files: {
      'package.json': '{\n  "name": "{{name}}",\n  "version": "0.1.0",\n  "main": "src/server.js",\n  "scripts": { "start": "node src/server.js" },\n  "dependencies": { "express": "^5.2.1" },\n  "license": "MIT"\n}\n',
      'src/server.js': "const express = require('express')\nconst app = express()\napp.use(express.json())\n\napp.get('/health', (_req, res) => res.json({ ok: true, name: '{{name}}' }))\n\nconst port = process.env.PORT || 3000\napp.listen(port, () => console.log(`{{name}} en http://localhost:${port}`))\n",
      '.gitignore': 'node_modules/\n.env\n*.log\n',
      'README.md': '# {{name}}\n\nAPI Express.\n',
    },
  },
  {
    id: 'static-web', label: 'Web estática', description: 'HTML + CSS + JS sin build',
    files: {
      'index.html': '<!doctype html>\n<html lang="es">\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>{{name}}</title>\n  <link rel="stylesheet" href="css/style.css">\n</head>\n<body>\n  <h1>{{name}}</h1>\n  <script src="js/main.js"></script>\n</body>\n</html>\n',
      'css/style.css': 'body { font-family: system-ui, sans-serif; margin: 2rem; }\n',
      'js/main.js': "console.log('{{name}} listo')\n",
    },
  },
]

const NAME_RE = /^[A-Za-z0-9][\w.-]{0,59}$/

function customDir(baseDir) { return path.join(baseDir, 'templates') }

function loadCustom(baseDir) {
  const dir = customDir(baseDir)
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.json')) continue
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^﻿/, ''))
      if (t && t.files && typeof t.files === 'object') out.push({ id: 'custom:' + path.basename(f, '.json'), label: t.label || f, description: t.description || 'Plantilla propia', files: t.files, custom: true })
    } catch { /* plantilla inválida: se ignora */ }
  }
  return out
}

function listTemplates(baseDir) {
  const all = [...BUILTIN, ...loadCustom(baseDir)]
  return { ok: true, templates: all.map(t => ({ id: t.id, label: t.label, description: t.description, files: Object.keys(t.files), custom: !!t.custom })), customDir: customDir(baseDir) }
}

function createFromTemplate(baseDir, root, templateId, name) {
  const n = String(name || '').trim()
  if (!NAME_RE.test(n)) return { ok: false, error: 'Nombre inválido (letras, números, punto, guion; hasta 60 caracteres)' }
  const tpl = [...BUILTIN, ...loadCustom(baseDir)].find(t => t.id === templateId)
  if (!tpl) return { ok: false, error: 'Plantilla no encontrada' }

  const target = path.resolve(root, n)
  if (path.dirname(target) !== path.resolve(root)) return { ok: false, error: 'Destino inválido' }
  if (fs.existsSync(target) && fs.readdirSync(target).length) return { ok: false, error: `La carpeta "${n}" ya existe y no está vacía` }

  const created = []
  for (const [rel, content] of Object.entries(tpl.files)) {
    const dest = path.resolve(target, rel)
    if (dest !== target && !dest.startsWith(target + path.sep)) return { ok: false, error: `Ruta no permitida en la plantilla: ${rel}`, created }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, String(content).replace(/\{\{name\}\}/g, n), 'utf8')
    created.push(path.join(n, rel).replace(/\\/g, '/'))
  }
  return { ok: true, created, folder: target }
}

module.exports = { listTemplates, createFromTemplate }
