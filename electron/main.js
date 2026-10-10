const { app, BrowserWindow, ipcMain, dialog, shell, session, protocol, net } = require('electron')
const path = require('path')
const fs = require('fs')
const { spawn, exec } = require('child_process')
const os = require('os')
const express = require('express')
const { pathToFileURL } = require('url')
const { runProjectIntelligence } = require('./reverse-engineering/runner')

let keytar = null
try { keytar = require('keytar') } catch (err) { console.warn('Keytar not available:', err.message) }
const KEYTAR_SERVICE = 'mcap-api-keys'
const API_KEY_PROVIDERS = ['groq', 'gemini', 'openrouter', 'zen', 'cerebras', 'mistral', 'sambanova', 'fireworks', 'deepseek', 'nvidia']

const isDev = process.env.NODE_ENV === 'development'

const VSIX_EXTS_DIR = path.join(__dirname, 'extensions', 'vsix')

let mainWindow = null

// Envia al renderer principal solo si la ventana sigue viva.
// `mainWindow?.` NO alcanza: la referencia queda no-nula aun despues de destruirse
// y send() lanza "TypeError: Object has been destroyed".
function sendToMain(channel, payload) {
  try {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send(channel, payload)
    }
  } catch {}
}
function safeSend(sender, channel, payload) {
  try {
    if (sender && !sender.isDestroyed()) sender.send(channel, payload)
  } catch {}
}
let webServer = null
let webServerPort = 3000

const activeProcs = new Set()   // track spawned processes -> kill on quit
const MAX_TRACKED_PROCS = 10

function getShell() {
  if (process.platform === 'win32') {
    return process.env.comspec || process.env.SystemRoot + '\\system32\\cmd.exe' || 'cmd.exe'
  }
  return process.env.SHELL || '/bin/bash'
}

function spawnTracked(...args) {
  if (activeProcs.size >= MAX_TRACKED_PROCS) {
    throw new Error('Too many concurrent processes. Espera a que finalicen algunos antes de ejecutar otro comando.')
  }
  const proc = spawn(...args)
  activeProcs.add(proc)
  proc.on('close', () => activeProcs.delete(proc))
  return proc
}

function spawnShell(cmd, opts = {}) {
  const isWin = process.platform === 'win32'
  const shell = getShell()
  
  // Agregar node_modules/.bin a PATH para que npm, yarn, etc funcionen
  const cwd = opts.cwd || process.cwd()
  const nodeModulesBin = path.join(cwd, 'node_modules', '.bin')
  const newPath = isWin
    ? `${nodeModulesBin};${process.env.PATH};${process.env.SystemRoot}\\system32`
    : `${nodeModulesBin}:${process.env.PATH}:/bin:/usr/bin`
  
  if (isWin) {
    return spawnTracked(shell, ['/d', '/s', '/c', '"' + cmd + '"'], {
      ...opts,
      windowsVerbatimArguments: true,
      env: { ...process.env, PATH: newPath },
    })
  }
  return spawnTracked(shell, ['-c', cmd], { 
    ...opts,
    env: { ...process.env, PATH: newPath },
  })
}

const TEXT_EXTS = new Set([
  'py','js','jsx','ts','tsx','html','htm','css','scss','sass','less','json','xml','yaml','yml',
  'go','rs','cpp','c','h','hpp','java','rb','php','sh','bash','zsh','md','txt','vue','svelte',
  'swift','kt','scala','ex','exs','erl','hs','lua','r','m','mm','pl','pm','sql','graphql','gql',
  'proto','toml','ini','cfg','conf','env','bat','cmd','ps1','psm1','dockerfile','makefile',
  'gradle','mjs','cjs','mts','cts','dart','zig','nim','cr','clj','cljs','edn',
])

const BROWSER_PARTITION = 'persist:browser'
const EXTENSIONS_DIR = path.join(__dirname, 'extensions')

function getSettingsFile() {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readSettingsFile() {
  const settingsPath = getSettingsFile()
  try {
    if (!fs.existsSync(settingsPath)) return {}
    return JSON.parse(fs.readFileSync(settingsPath, 'utf8') || '{}')
  } catch (err) {
    console.warn('Cannot read settings file:', err.message)
    return {}
  }
}

async function readApiKeys() {
  if (!keytar) return {}
  const result = {}
  for (const prov of API_KEY_PROVIDERS) {
    try {
      const value = await keytar.getPassword(KEYTAR_SERVICE, prov)
      if (value) result[prov] = value
    } catch (err) {
      console.warn(`Failed to read api key for ${prov}:`, err.message)
    }
  }
  return result
}

async function readSettings() {
  const settings = readSettingsFile()
  const storedKeys = await readApiKeys()
  return {
    ...settings,
    apiKeys: {
      ...(settings.apiKeys || {}),
      ...storedKeys,
    },
  }
}

function scrubSettingsForFile(settings) {
  const apiKeys = {}
  for (const prov of API_KEY_PROVIDERS) apiKeys[prov] = ''
  return {
    ...settings,
    apiKeys,
  }
}

async function writeSettings(settings) {
  const settingsPath = getSettingsFile()
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true })
    const payload = keytar ? scrubSettingsForFile(settings) : settings
    fs.writeFileSync(settingsPath, JSON.stringify(payload, null, 2), { mode: 0o600 })
  } catch (err) {
    console.warn('Cannot write settings file:', err.message)
  }

  if (!keytar) return

  const storedKeys = await readApiKeys()
  for (const prov of API_KEY_PROVIDERS) {
    const value = settings.apiKeys?.[prov]
    try {
      if (value === undefined) {
        continue
      }
      if (value) {
        await keytar.setPassword(KEYTAR_SERVICE, prov, value)
      } else if (!storedKeys[prov]) {
        await keytar.deletePassword(KEYTAR_SERVICE, prov)
      }
    } catch (err) {
      console.warn(`Failed to store api key for ${prov}:`, err.message)
    }
  }
}

function startWebServer(port = 3000) {
  if (webServer) return { ok: false, error: 'Server already running' }
  try {
    const distPath = path.join(__dirname, '..', 'dist')
    if (!fs.existsSync(distPath)) {
      return { ok: false, error: 'Build not found. Run "npm run build-renderer" first.' }
    }
    const app = express()
    app.use(express.static(distPath, { extensions: ['html'] }))
    app.get('*', (req, res, next) => {
      if (req.accepts('html')) {
        return res.sendFile(path.join(distPath, 'index.html'))
      }
      next()
    })
    app.use((req, res) => {
      res.status(404).send('Not found')
    })

    webServer = app.listen(port, '0.0.0.0', () => {
      console.log(`Web server started on port ${port}`)
    })
    webServerPort = port
    return { ok: true, port }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function stopWebServer() {
  if (!webServer) return { ok: false, error: 'Server not running' }
  try {
    webServer.close()
    webServer = null
    console.log('Web server stopped')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

function getLocalIPs() {
  const interfaces = os.networkInterfaces()
  const ips = []
  for (const iface of Object.values(interfaces)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) {
        ips.push(addr.address)
      }
    }
  }
  return ips
}

async function loadBrowserExtensions() {
  try {
    if (!fs.existsSync(EXTENSIONS_DIR)) return
    const entries = fs.readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && entry.name !== 'vsix')
    for (const entry of entries) {
      const extPath = path.join(EXTENSIONS_DIR, entry.name)
      try {
        const loaded = await session.fromPartition(BROWSER_PARTITION).loadExtension(extPath, { allowFileAccess: true })
        console.log(`Loaded browser extension: ${loaded.name} (${loaded.id})`)
      } catch (err) {
        console.warn(`Failed to load extension ${extPath}: ${err.message}`)
      }
    }
  } catch (err) {
    console.warn('Error loading browser extensions:', err.message)
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400, height: 900, minWidth: 900, minHeight: 600,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      webviewTag: true,        // needed for <webview> browser tab
      nodeIntegration: false,
    },
  })
  mainWindow.on('closed', () => { mainWindow = null })
  if (isDev) mainWindow.loadURL('http://127.0.0.1:5176')
  else mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
}

const MIME_MAP = {
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.html': 'text/html',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
}

app.whenReady().then(async () => {
  protocol.handle('mc-vsix', async (request) => {
    const url = new URL(request.url)
    const filePath = path.join(VSIX_EXTS_DIR, url.hostname, url.pathname.replace(/^\//, '').replace(/\\/g, '/'))
    try {
      const data = await fs.promises.readFile(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const contentType = MIME_MAP[ext] || 'application/octet-stream'
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
          'Cross-Origin-Resource-Policy': 'cross-origin',
        }
      })
    } catch (e) {
      return new Response('Not found', { status: 404 })
    }
  })
  await loadBrowserExtensions()
  createWindow()
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', () => {
  for (const p of activeProcs) { try { p.kill() } catch {} }
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close()
  previewWindow = null
  if (webServer) { try { webServer.close() } catch {} }
})
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })

// ── Dialogs ───────────────────────────────────────────────────────────────────
ipcMain.handle('dialog-open-folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Abrir proyecto' })
  return r.canceled ? null : r.filePaths[0]
})

ipcMain.handle('dialog-open-file', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Código', extensions: ['py','js','jsx','ts','tsx','html','css','json','go','rs','cpp','c','java','rb','php','sh','md','txt','vue','scss'] },
      { name: 'Todos', extensions: ['*'] },
    ]
  })
  return r.canceled ? null : r.filePaths
})

ipcMain.handle('dialog-open-vsix', async () => {
  const r = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    title: 'Seleccionar archivo VSIX',
    filters: [
      { name: 'VSIX Extensions', extensions: ['vsix'] },
      { name: 'Todos', extensions: ['*'] },
    ]
  })
  return r.canceled ? null : r.filePaths
})

ipcMain.handle('dialog-save-file', async (_, { name, content }) => {
  const r = await dialog.showSaveDialog({ defaultPath: name || 'archivo.py' })
  if (r.canceled) return null
  fs.writeFileSync(r.filePath, content, 'utf8')
  return r.filePath
})

// ── File system (FULL ACCESS) ─────────────────────────────────────────────────
ipcMain.handle('fs-read', (_, p) => {
  try { return { ok: true, content: fs.readFileSync(p, 'utf8'), size: fs.statSync(p).size } }
  catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('open-extensions-folder', async () => {
  try {
    await shell.openPath(EXTENSIONS_DIR)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('fs-write', (_, { p, content }) => {
  try {
    // Auto-create parent dirs if needed
    fs.mkdirSync(path.dirname(p), { recursive: true })
    fs.writeFileSync(p, content, 'utf8')
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('fs-write-lines', (_, { p, startLine, endLine, newLines }) => {
  // Precise line-level edit: replace lines startLine..endLine (1-indexed) with newLines
  try {
    const lines = fs.readFileSync(p, 'utf8').split('\n')
    lines.splice(startLine - 1, endLine - startLine + 1, ...newLines)
    fs.writeFileSync(p, lines.join('\n'), 'utf8')
    return { ok: true }
  } catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('fs-readdir', (_, dir) => {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && !['node_modules','__pycache__','dist','.git','dist-electron','.venv','venv','env'].includes(e.name))
      .map(e => ({
        name: e.name, isDir: e.isDirectory(),
        path: path.join(dir, e.name),
        ext: e.isFile() ? path.extname(e.name).slice(1) : null,
      }))
      .sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1)
  } catch (e) { return [] }
})

ipcMain.handle('fs-exists', (_, p) => fs.existsSync(p))
ipcMain.handle('fs-delete', (_, p) => { try { fs.unlinkSync(p); return { ok: true } } catch(e) { return { ok: false, error: e.message } } })
ipcMain.handle('fs-rename', (_, { from, to }) => { try { fs.renameSync(from, to); return { ok: true } } catch(e) { return { ok: false, error: e.message } } })
ipcMain.handle('shell-open', (_, p) => shell.openPath(p))

// ── ASAR operations ────────────────────────────────────────────────────────────
const asar = (() => { try { return require('@electron/asar') } catch { return null } })()

ipcMain.handle('asar-extract', async (_, { archivePath, destDir }) => {
  if (!asar) return { ok: false, error: '@electron/asar no está instalado' }
  try {
    if (!fs.existsSync(archivePath)) return { ok: false, error: 'Archivo no encontrado' }
    fs.mkdirSync(destDir, { recursive: true })
    await asar.extractAll(archivePath, destDir)
    return { ok: true, dest: destDir }
  } catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('asar-pack', async (_, { srcDir, destPath }) => {
  if (!asar) return { ok: false, error: '@electron/asar no está instalado' }
  try {
    if (!fs.existsSync(srcDir)) return { ok: false, error: 'Directorio fuente no encontrado' }
    fs.mkdirSync(path.dirname(destPath), { recursive: true })
    await asar.createPackage(srcDir, destPath)
    return { ok: true, dest: destPath }
  } catch (e) { return { ok: false, error: e.message } }
})

ipcMain.handle('asar-list', async (_, { archivePath }) => {
  if (!asar) return { ok: false, error: '@electron/asar no está instalado' }
  try {
    if (!fs.existsSync(archivePath)) return { ok: false, error: 'Archivo no encontrado' }
    const files = asar.listPackage(archivePath)
    return { ok: true, files }
  } catch (e) { return { ok: false, error: e.message } }
})

// ── VSIX Extension Management ──────────────────────────────────────────────────
const AdmZip = require('adm-zip')

ipcMain.handle('vsix-install', async (_, { vsixPath }) => {
  try {
    if (!fs.existsSync(vsixPath)) return { ok: false, error: 'VSIX no encontrado' }

    const tmpDir = path.join(os.tmpdir(), `mcap-vsix-${Date.now()}`)
    fs.mkdirSync(tmpDir, { recursive: true })

    const zip = new AdmZip(vsixPath)
    zip.extractAllTo(tmpDir, true)

    let pkgJsonPath = path.join(tmpDir, 'extension', 'package.json')
    if (!fs.existsSync(pkgJsonPath)) {
      pkgJsonPath = path.join(tmpDir, 'package.json')
    }
    if (!fs.existsSync(pkgJsonPath)) {
      fs.rmSync(tmpDir, { recursive: true, force: true })
      return { ok: false, error: 'VSIX inválido: no contiene package.json' }
    }

    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'))
    const extId = pkg.publisher ? `${pkg.publisher}.${pkg.name}` : pkg.name || path.basename(vsixPath, '.vsix')
    const destDir = path.join(VSIX_EXTS_DIR, extId)

    if (fs.existsSync(destDir)) {
      fs.rmSync(destDir, { recursive: true, force: true })
    }
    fs.mkdirSync(destDir, { recursive: true })

    const srcDir = fs.existsSync(path.join(tmpDir, 'extension'))
      ? path.join(tmpDir, 'extension')
      : tmpDir
    const entries = fs.readdirSync(srcDir)
    for (const e of entries) {
      if (e === 'extension.vsixmanifest' || e === '[Content_Types].xml') continue
      const src = path.join(srcDir, e)
      const dst = path.join(destDir, e)
      if (fs.statSync(src).isDirectory()) {
        fs.cpSync(src, dst, { recursive: true })
      } else {
        fs.copyFileSync(src, dst)
      }
    }
    fs.rmSync(tmpDir, { recursive: true, force: true })

    console.log(`VSIX installed: ${extId} (${pkg.displayName || pkg.name || ''})`)
    return { ok: true, id: extId, name: pkg.displayName || pkg.name, version: pkg.version, description: pkg.description }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('vsix-list', async () => {
  try {
    if (!fs.existsSync(VSIX_EXTS_DIR)) return []
    const entries = fs.readdirSync(VSIX_EXTS_DIR, { withFileTypes: true }).filter(e => e.isDirectory())
    const result = []
    for (const entry of entries) {
      const extDir = path.join(VSIX_EXTS_DIR, entry.name)
      const pkgPath = path.join(extDir, 'package.json')
      try {
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
          result.push({
            id: entry.name,
            name: pkg.displayName || pkg.name || entry.name,
            version: pkg.version || '0.0.0',
            description: pkg.description || '',
            publisher: pkg.publisher || '',
            contributes: pkg.contributes || {},
            engines: pkg.engines || {},
            activationEvents: pkg.activationEvents || [],
            enabled: true,
            manifest: pkg,
          })
        } else {
          result.push({ id: entry.name, name: entry.name, version: '?', description: '', enabled: true, manifest: null })
        }
      } catch {}
    }
    return result
  } catch (e) {
    return []
  }
})

ipcMain.handle('vsix-list-files', async (_, { extId }) => {
  try {
    const extDir = path.join(VSIX_EXTS_DIR, extId)
    if (!fs.existsSync(extDir)) return { ok: false, error: 'Extensión no encontrada' }
    const files = []
    function walk(dir, prefix) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const e of entries) {
        const full = path.join(dir, e.name)
        const rel = prefix ? prefix + '/' + e.name : e.name
        if (e.isDirectory()) {
          walk(full, rel)
        } else {
          const stat = fs.statSync(full)
          files.push({ path: rel, size: stat.size })
        }
      }
    }
    walk(extDir, '')
    return { ok: true, files }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('vsix-uninstall', async (_, { extId }) => {
  try {
    const extDir = path.join(VSIX_EXTS_DIR, extId)
    if (!fs.existsSync(extDir)) return { ok: false, error: 'Extensión no encontrada' }
    fs.rmSync(extDir, { recursive: true, force: true })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Read entire project tree with file contents (for AI context)
// ── AI Tool: grep (search file contents on disk) ──────────────────────────────
ipcMain.handle('fs-grep', async (_, { rootDir, query }) => {
  try {
    const isRegex = query.startsWith('/') && query.endsWith('/') && query.length > 2
    const regex = isRegex
      ? new RegExp(query.slice(1, -1), 'gi')
      : new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')

    const MAX_RESULTS = 50
    const MAX_MATCHES_PER_FILE = 10
    const results = []

    function walk(dir, depth = 0) {
      if (depth > 8 || results.length >= MAX_RESULTS) return
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const e of entries) {
          if (results.length >= MAX_RESULTS) break
          if (e.name.startsWith('.')) continue
          const skip = ['node_modules','__pycache__','dist','.git','dist-electron','.venv','venv','env','build','target']
          if (skip.includes(e.name.toLowerCase())) continue
          const full = path.join(dir, e.name)
          if (e.isDirectory()) { walk(full, depth + 1); continue }
          try {
            const stat = fs.statSync(full)
            if (stat.size > 1024 * 1024) continue
            const content = fs.readFileSync(full, 'utf8')
            const lines = content.split('\n')
            const matches = []
            for (let i = 0; i < lines.length; i++) {
              regex.lastIndex = 0
              if (regex.test(lines[i])) {
                matches.push({ line: i + 1, text: lines[i].trim().slice(0, 200) })
                if (matches.length >= MAX_MATCHES_PER_FILE) break
              }
            }
            if (matches.length > 0) {
              const rel = path.relative(rootDir, full).replace(/\\/g, '/')
              results.push({ file: rel, matches })
            }
          } catch {}
        }
      } catch {}
    }

    if (rootDir && fs.existsSync(rootDir)) walk(rootDir)
    return results
  } catch (e) { return [] }
})

// ── AI Tool: glob (recursive file find by pattern) ────────────────────────────
ipcMain.handle('fs-glob', async (_, { rootDir, pattern }) => {
  try {
    let reStr = '^'
    for (let i = 0; i < pattern.length; i++) {
      const ch = pattern[i]
      if (ch === '*') {
        if (pattern[i + 1] === '*') { reStr += '.*'; i++; if (pattern[i + 1] === '/' || pattern[i + 1] === '\\') i++ }
        else { reStr += '[^/\\\\]*' }
      } else if (ch === '?') { reStr += '[^/\\\\]' }
      else if (/[.+^${}()|[\]\\]/.test(ch)) { reStr += '\\' + ch }
      else { reStr += ch }
    }
    reStr += '$'
    const regex = new RegExp(reStr, 'i')
    const results = []

    function walk(dir, depth = 0) {
      if (depth > 8 || results.length >= 200) return
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const e of entries) {
          if (results.length >= 200) break
          if (e.name.startsWith('.')) continue
          const skip = ['node_modules','__pycache__','dist','.git','dist-electron','.venv','venv','env','build','target']
          if (skip.includes(e.name.toLowerCase())) continue
          const full = path.join(dir, e.name)
          const rel = path.relative(rootDir, full).replace(/\\/g, '/')
          if (regex.test(rel)) {
            const stat = fs.statSync(full)
            results.push({ name: e.name, path: rel, isDir: e.isDirectory(), size: stat.size })
          }
          if (e.isDirectory()) walk(full, depth + 1)
        }
      } catch {}
    }

    if (rootDir && fs.existsSync(rootDir)) walk(rootDir)
    return results.sort((a, b) => a.path.localeCompare(b.path))
  } catch (e) { return [] }
})

ipcMain.handle('fs-project-context', (_, rootDir) => {
  const result = {}
  let totalChars = 0
  const MAX_FILE_SIZE = 100 * 1024  // 100KB per file
  const MAX_FILES = 200
  const MAX_TOTAL_CHARS = 600000    // ~600KB total context

  function isTextFile(name) {
    const ext = name.split('.').pop()?.toLowerCase()
    if (!ext) return true // no extension, try as text
    return TEXT_EXTS.has(ext)
  }

  function walk(dir, depth = 0) {
    if (depth > 6) return
    if (Object.keys(result).length >= MAX_FILES) return
    if (totalChars >= MAX_TOTAL_CHARS) return

    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
        .filter(e => {
          if (e.name.startsWith('.')) return false
          const skip = ['node_modules','__pycache__','dist','.git','dist-electron',
            '.venv','venv','env','build','target','vendor','bower_components',
            '.next','.nuxt','coverage','.cache','tmp','temp','logs','out']
          return !skip.includes(e.name.toLowerCase())
        })

      for (const e of entries) {
        if (Object.keys(result).length >= MAX_FILES) break
        if (totalChars >= MAX_TOTAL_CHARS) break

        const full = path.join(dir, e.name)
        if (e.isDirectory()) { walk(full, depth + 1); continue }

        if (!isTextFile(e.name)) continue

        const rel = path.relative(rootDir, full).replace(/\\/g, '/')
        try {
          const stat = fs.statSync(full)
          if (stat.size > MAX_FILE_SIZE) {
            result[rel] = '[archivo muy grande, omitido]'
            continue
          }
          const content = fs.readFileSync(full, 'utf8')
          result[rel] = content
          totalChars += content.length
        } catch {}
      }
    } catch {}
  }

  walk(rootDir)
  return result
})

ipcMain.handle('settings-load', async () => {
  return await readSettings()
})

ipcMain.handle('settings-save', async (_, settings) => {
  await writeSettings(settings)
  return { ok: true }
})

// ── Web server ───────────────────────────────────────────────────────────────
ipcMain.handle('web-server-start', async (_, port) => {
  return startWebServer(port)
})

ipcMain.handle('web-server-stop', async () => {
  return stopWebServer()
})

ipcMain.handle('web-server-status', async () => {
  return { running: !!webServer, port: webServerPort, ips: getLocalIPs() }
})

// ── Run code ─────────────────────────────────────────────────────────────────
ipcMain.handle('run-code', async (_, { code, language, filename, cwd }) => {
  const tmp = path.join(os.tmpdir(), `mcap_${Date.now()}`)
  const exts = { python:'py', javascript:'js', typescript:'ts', go:'go', rust:'rs', cpp:'cpp', c:'c', java:'java', ruby:'rb', php:'php', shell:'sh', bash:'sh', html:'html' }
  const ext = exts[language] || 'txt'
  const src = `${tmp}.${ext}`
  fs.writeFileSync(src, code, 'utf8')

  const runCwd = cwd || path.dirname(src)

  const cmds = {
    python:     `python "${src}"`,
    javascript: `node "${src}"`,
    typescript: `npx --yes ts-node "${src}"`,
    go:         `go run "${src}"`,
    rust:       `rustc "${src}" -o "${tmp}_out" && "${tmp}_out"`,
    cpp:        `g++ "${src}" -o "${tmp}_out" && "${tmp}_out"`,
    c:          `gcc "${src}" -o "${tmp}_out" && "${tmp}_out"`,
    ruby:       `ruby "${src}"`,
    php:        `php "${src}"`,
    shell:      `bash "${src}"`,
    bash:       `bash "${src}"`,
    // HTML: write to temp file and open in default browser
    html: null,  // handled separately below
  }

  // HTML files — open in browser directly
  if (language === 'html') {
    await shell.openPath(src)
    const out = `✓ Abriendo ${path.basename(src)} en el navegador...\n(El archivo se abrió en tu browser por defecto)`
    try { fs.unlinkSync(src) } catch {}
    return { ok: true, out }
  }

  const cmd = cmds[language]
  if (!cmd) return { ok: false, out: `Runner no disponible para "${language}".` }

  return new Promise(resolve => {
    const proc = spawnShell(cmd, { timeout: 30000, cwd: runCwd })
    let out = '', err = ''
    proc.stdout.on('data', d => { out += d; sendToMain('cmd-stream', { type: 'out', text: d.toString() }) })
    proc.stderr.on('data', d => { err += d; sendToMain('cmd-stream', { type: 'err', text: d.toString() }) })
    proc.on('close', code => {
      try { fs.unlinkSync(src) } catch {}
      resolve(code === 0 ? { ok: true, out: out || '(sin salida)' } : { ok: false, out: err || out || `Exit: ${code}` })
    })
    proc.on('error', e => resolve({ ok: false, out: `Error al ejecutar: ${e.message}\n\n¿Tenés instalado el intérprete de ${language}?` }))
  })
})

// ── Shell command ──────────────────────────────────────────────────────────────
ipcMain.handle('run-command', async (_, { command, cwd }) => {
  return new Promise(resolve => {
    try {
      const proc = spawnShell(command, { cwd: cwd || os.homedir(), timeout: 60000 })
      let out = '', err = ''
      
      if (!proc.stdout || !proc.stderr) {
        return resolve({ ok: false, out: '', err: 'Failed to spawn process', code: -1 })
      }
      
      proc.stdout.on('data', d => { 
        out += d
        sendToMain('cmd-stream', { type: 'out', text: d.toString() }) 
      })
      proc.stderr.on('data', d => { 
        err += d
        sendToMain('cmd-stream', { type: 'err', text: d.toString() }) 
      })
      proc.on('close', code => {
        resolve({ ok: code === 0, out: out || '', err: err || '', code })
      })
      proc.on('error', e => {
        const message = e.message || 'Unknown error'
        console.error('[run-command] Error:', message, 'Command:', command, 'CWD:', cwd)
        resolve({ 
          ok: false, 
          out: '', 
          err: `❌ ${message}\n\nCommand: ${command}\nWorking dir: ${cwd}`,
          code: -1 
        })
      })
    } catch (e) {
      console.error('[run-command] Spawn error:', e.message)
      resolve({ 
        ok: false, 
        out: '', 
        err: `❌ Failed to spawn: ${e.message}`,
        code: -1 
      })
    }
  })
})

// ── Terminal sessions (persistent shell per tab) ─────────────────────────────
const terminalSessions = new Map()

ipcMain.handle('terminal-create', (_, { cwd }) => {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  const isWin = process.platform === 'win32'
  const shell = getShell()
  const proc = spawnTracked(shell, isWin ? [] : ['--norc', '--noprofile'], {
    cwd: cwd || os.homedir(),
    windowsHide: false,
    env: { ...process.env, PATH: process.env.PATH + ';' + process.env.SystemRoot + '\\system32' },
  })

  proc.stdout.on('data', d => {
    const text = d.toString()
    sendToMain('cmd-stream', { type: 'out', text, termId: id })
  })
  proc.stderr.on('data', d => {
    const text = d.toString()
    sendToMain('cmd-stream', { type: 'err', text, termId: id })
  })
  proc.on('close', code => {
    const text = `\nProceso terminado (código ${code})`
    sendToMain('cmd-stream', { type: 'info', text, termId: id, closed: true })
    terminalSessions.delete(id)
  })
  proc.on('error', e => {
    sendToMain('cmd-stream', { type: 'err', text: e.message, termId: id, closed: true })
    terminalSessions.delete(id)
  })

  terminalSessions.set(id, { proc, cwd })
  return id
})

ipcMain.handle('terminal-stdin', (_, { id, data }) => {
  const term = terminalSessions.get(id)
  if (term) { term.proc.stdin.write(data); return true }
  return false
})

ipcMain.handle('terminal-kill', (_, { id }) => {
  const term = terminalSessions.get(id)
  if (term) {
    term.proc.kill()
    terminalSessions.delete(id)
    return true
  }
  return false
})

// ── Dev server management ──────────────────────────────────────────────────────
let devServerProc = null
let devServerCwd = null

// Extract just the web dev server command from an Electron project's dev script
// e.g. "concurrently \"vite\" \"electron .\"" → "vite"
//      "vite && electron ." → "vite"
//      "electron-vite dev" → null (can't split, run as-is)
function extractWebServerCmd(script) {
  // electron-vite: can't split, run as-is
  if (script.includes('electron-vite')) return null

  // concurrently: extract first quoted arg
  const conMatch = script.match(/concurrently\s+["']([^"']+)["']/i)
  if (conMatch) return conMatch[1]

  // Split by &&, ||, &, ; and take first non-electron, non-wait-on part
  const parts = script.split(/\s*&&\s*|\s*\|\|\s*|\s*;\s*|\s*&\s*/).map(s => s.trim()).filter(Boolean)
  for (const part of parts) {
    const lower = part.toLowerCase()
    if (!lower.includes('electron') && !lower.includes('wait-on') && !lower.startsWith('concurrently')) {
      return part
    }
  }
  return null
}

// Kill any process using a given port on Windows
function killPort(port) {
  try {
    const buf = require('child_process').execSync(`netstat -ano | findstr :${port}`, { timeout: 3000, encoding: 'utf8' })
    const pids = new Set()
    for (const line of buf.split(/\r?\n/)) {
      // Match lines like:  TCP    0.0.0.0:5175   0.0.0.0:0   LISTENING    12345
      const m = line.trim().match(/:\d+\s+\S+\s+LISTENING\s+(\d+)$/m)
      if (m) pids.add(m[1])
    }
    for (const pid of pids) {
      if (pid && pid !== '0') {
        try { require('child_process').execSync(`taskkill /PID ${pid} /F`, { timeout: 2000 }) } catch {}
      }
    }
  } catch {}
}

ipcMain.handle('dev-start', async (event, { cwd, cmd } = {}) => {
  try {
    if (devServerProc) { devServerProc.kill(); devServerProc = null }
    const projectDir = cwd || process.cwd()

    // Auto-detect command from package.json
    if (!cmd) {
      const pkgPath = path.join(projectDir, 'package.json')
      try {
        if (fs.existsSync(pkgPath)) {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
          const raw = pkg.scripts?.dev || pkg.scripts?.start
          const isEditorProject = pkg.name === 'mcode-ai-pre'
          const hasElectron = !isEditorProject && (pkg.devDependencies?.electron || pkg.dependencies?.electron || (raw && raw.includes('electron')))

          if (hasElectron && raw) {
            // Electron project: extract just the web server (skip Electron window)
            const webCmd = extractWebServerCmd(raw)
            if (webCmd) {
              cmd = webCmd
              sendToMain('cmd-stream', { type: 'info', text: '[dev] Proyecto Electron detectado — ejecutando solo el servidor web (sin ventana Electron)' })
              sendToMain('cmd-stream', { type: 'warn', text: '[diagnóstico] Los proyectos Electron suelen usar <webview>. Si ves contenido vacío, usá ↗ o Ctrl+Enter para abrir URLs en pestañas nativas del editor.' })
            } else {
              cmd = raw
            }
          } else if (raw) {
            cmd = raw
          } else {
            cmd = 'npm run dev'
          }
        } else {
          cmd = 'npm run dev'
        }
      } catch { cmd = 'npm run dev' }
    }

    // Strip any --open or -o flags
    const cleaned = cmd.replace(/--open\b/gi, '').replace(/(?:^|\s+)-o(?=\s|$)/g, ' ').trim()

    devServerCwd = projectDir
    sendToMain('cmd-stream', { type: 'cmd', text: `[dev] ${cleaned}` })

    // Kill any stale process on common dev ports before spawning
    ;[5173, 5174, 5175, 5176, 3000, 8080].forEach(killPort)
    sendToMain('cmd-stream', { type: 'info', text: '[dev] Puertos limpiados (stale processes killed)' })

    // Add node_modules/.bin to PATH so we can resolve executables like npm does
    const nodeBin = path.join(projectDir, 'node_modules', '.bin')
    const envPath = (fs.existsSync(nodeBin) ? nodeBin + path.delimiter : '') + (process.env.PATH || '')

    devServerProc = spawnShell(cleaned, {
      cwd: projectDir,
      env: {
        ...process.env,
        PATH: envPath,
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        BROWSER: 'none',
      },
    })
    activeProcs.add(devServerProc)
    const thisProc = devServerProc

    const pipeOutput = (type, text) => {
      sendToMain('dev-log', { type, text })
      sendToMain('cmd-stream', { type, text: `[dev] ${text}` })
      const urls = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):\d+/g)
      if (urls) {
        sendToMain('dev-url', urls[0])
        // Auto-open the preview window with DevTools
        if (!previewWindow || previewWindow.isDestroyed()) {
          try { openPreviewWindow(urls[0]) } catch {}
        }
      }
    }

    devServerProc.stdout.on('data', d => pipeOutput('out', d.toString()))
    devServerProc.stderr.on('data', d => pipeOutput('err', d.toString()))

    devServerProc.on('exit', code => {
      const msg = `[Dev server exited with code ${code}]`
      sendToMain('dev-log', { type: 'info', text: msg })
      sendToMain('cmd-stream', { type: 'info', text: msg })
      activeProcs.delete(thisProc)
      if (devServerProc === thisProc) {
        sendToMain('dev-status', { running: false, cwd: devServerCwd })
        devServerProc = null
        devServerCwd = null
      }
    })

    devServerProc.on('error', e => {
      const msg = `[Dev server error: ${e.message}]`
      sendToMain('dev-log', { type: 'err', text: msg })
      sendToMain('cmd-stream', { type: 'err', text: msg })
      activeProcs.delete(thisProc)
      if (devServerProc === thisProc) {
        sendToMain('dev-status', { running: false, cwd: devServerCwd })
        devServerProc = null
        devServerCwd = null
      }
    })

    sendToMain('dev-status', { running: true, cwd: devServerCwd })
    return { ok: true, cmd: cleaned }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('dev-stop', async () => {
  if (devServerProc) {
    devServerProc.kill()
    activeProcs.delete(devServerProc)
    devServerProc = null
    devServerCwd = null
    sendToMain('cmd-stream', { type: 'info', text: '[Dev server stopped]' })
  }
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close()
  previewWindow = null
  sendToMain('dev-status', { running: false, cwd: null })
  return { ok: true }
})

ipcMain.handle('dev-status', async () => {
  return { running: devServerProc !== null, cwd: devServerCwd }
})

// Allow renderer to push diagnostic logs to dev-log
ipcMain.handle('dev-log-send', async (_, data) => {
  sendToMain('dev-log', data)
  sendToMain('cmd-stream', { type: data.type || 'info', text: `[diagnóstico] ${data.text}` })
})

// ── Open dev app in a separate Electron window ──────────────────────────
let previewWindow = null

/** Igual que formatPreviewInspectLog en BrowserTab.jsx — contexto IA + Dev Logs */
function formatPreviewInspectLog(info) {
  const parts = [
    '[UI] preview',
    info.pageUrl ? `url=${info.pageUrl}` : '',
    info.name ? `component=${info.name}` : '',
    info.tag ? `tag=<${info.tag}>` : '',
    info.framework ? `fw=${info.framework}` : '',
    Array.isArray(info.stack) && info.stack.length ? `stack=${info.stack.slice(0, 6).join('>')}` : '',
    info.x != null && info.y != null ? `xy=${Math.round(info.x)},${Math.round(info.y)}` : '',
    info.id ? `id=#${info.id}` : '',
    info.classes ? `class=${String(info.classes).slice(0, 100)}` : '',
  ].filter(Boolean)
  return parts.join(' ')
}

function shouldInjectPreviewInspector(pageUrl) {
  if (!pageUrl || pageUrl === 'about:blank') return false
  try {
    const u = new URL(pageUrl)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const h = u.hostname
    return h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '0.0.0.0'
  } catch {
    return false
  }
}

let previewInspectorScriptCache = null
async function getPreviewInspectorScript() {
  if (previewInspectorScriptCache) return previewInspectorScriptCache
  const mod = await import(pathToFileURL(path.join(__dirname, 'previewInspectorScript.mjs')).href)
  previewInspectorScriptCache = mod.INSPECTOR_FLOATING
  return previewInspectorScriptCache
}

let pageDestripeScriptCache = null
async function getPageDestripeScript() {
  if (pageDestripeScriptCache) return pageDestripeScriptCache
  const mod = await import(pathToFileURL(path.join(__dirname, 'pageDestripeScript.mjs')).href)
  pageDestripeScriptCache = mod.PAGE_DESTRIPE
  return pageDestripeScriptCache
}

function openPreviewWindow(url) {
  if (previewWindow && !previewWindow.isDestroyed()) {
    previewWindow.loadURL(url)
    previewWindow.focus()
    return
  }

  previewWindow = new BrowserWindow({
    width: 1280, height: 800,
    minWidth: 800, minHeight: 600,
    title: `Preview — ${url}`,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      webviewTag: true,
      nodeIntegration: false,
    },
  })

  previewWindow.loadURL(url)
  previewWindow.webContents.openDevTools()

  // ── Capture console messages ──
  previewWindow.webContents.on('console-message', (e, level, message, line, sourceId) => {
    if (typeof message === 'string' && message.startsWith('__MCAP_INSPECT__')) {
      try {
        const data = JSON.parse(message.replace('__MCAP_INSPECT__', ''))
        const logLine = formatPreviewInspectLog(data)
        if (logLine) {
          sendToMain('dev-log', { type: 'out', text: logLine })
          sendToMain('cmd-stream', { type: 'out', text: `[preview] ${logLine}` })
        }
      } catch (_) {}
      return
    }
    // Destripe: no duplicar Dev Logs aquí — el renderer recibe el JSON vía preview-destripe IPC.
    if (typeof message === 'string' && message.startsWith('__MCAP_DESTRIPE__')) {
      return
    }
    const levels = ['log', 'info', 'warn', 'error']
    const type = levels[level] || 'log'
    const text = `[console.${type}] ${message}  (${sourceId || '?'}:${line})`
    sendToMain('dev-log', { type: type === 'error' ? 'err' : type === 'warn' ? 'warn' : 'out', text })
    sendToMain('cmd-stream', { type: type === 'error' ? 'err' : 'out', text: `[preview] ${text}` })
  })

  // ── Capture navigation + inject JS error handlers + inspector UI ──
  previewWindow.webContents.on('did-finish-load', () => {
    const wc = previewWindow?.webContents
    if (!wc) return
    const u = wc.getURL()
    sendToMain('cmd-stream', { type: 'info', text: `[preview] ✅ Cargado: ${u}` })
    const runInject = async () => {
      try {
        await wc.executeJavaScript(`
      window.onerror = (msg, src, line, col, err) => {
        const text = (err && err.stack) ? err.stack.slice(0, 500) : msg + ' at ' + (src || '?') + ':' + (line || 0)
        console.error('[RUNTIME ERROR]', text)
      }
      window.onunhandledrejection = (e) => {
        const text = (e.reason && e.reason.stack ? e.reason.stack : String(e.reason || e)).slice(0, 500)
        console.error('[RUNTIME ERROR] Unhandled Rejection:', text)
      }
    `)
        if (shouldInjectPreviewInspector(u)) {
          const inject = await getPreviewInspectorScript()
          await wc.executeJavaScript(inject).catch(() => {})
        }
      } catch (_) {}
    }
    runInject()
  })

  previewWindow.webContents.on('did-fail-load', (e, code, desc, url) => {
    sendToMain('cmd-stream', { type: 'err', text: `[preview] ❌ Error de carga: ${url}\n  ${desc} (código ${code})` })
  })

  function isLocalDevPreviewUrl(url) {
    try {
      const u = new URL(url)
      const h = u.hostname
      if (h !== 'localhost' && h !== '127.0.0.1' && h !== '0.0.0.0' && h !== '[::1]') return false
      const p = u.port || (u.protocol === 'https:' ? '443' : '80')
      return ['5173', '5174', '5175', '5176', '3000', '8080', '4173'].includes(p)
    } catch {
      return false
    }
  }

  function skipPreviewDevNoise(details) {
    const err = String(details.error || '')
    if (!isLocalDevPreviewUrl(details.url)) return false
    return /ERR_CONNECTION|REFUSED|ABORTED|TIMED_OUT|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED/i.test(err)
  }

  // ── Capture network errors (4xx/5xx) ──
  const netFilter = { urls: ['http://*/*', 'https://*/*'] }
  previewWindow.webContents.session.webRequest.onCompleted(details => {
    if (details.statusCode >= 400) {
      sendToMain('cmd-stream', {
        type: 'err',
        text: `[preview] [network] ${details.method} ${details.url} → ${details.statusCode}`,
      })
    }
  }, netFilter)
  previewWindow.webContents.session.webRequest.onErrorOccurred(details => {
    if (skipPreviewDevNoise(details)) return
    sendToMain('cmd-stream', {
      type: 'err',
      text: `[preview] [network] ${details.method} ${details.url} → ${details.error}`,
    })
  }, netFilter)

  previewWindow.on('closed', () => {
    previewWindow = null
    sendToMain('cmd-stream', { type: 'info', text: '[preview] Ventana cerrada' })
  })
}

ipcMain.handle('dev-open-window', async (_, { url }) => {
  openPreviewWindow(url)
  return { ok: true }
})
ipcMain.handle('dev-close-window', async () => {
  if (previewWindow && !previewWindow.isDestroyed()) previewWindow.close()
  previewWindow = null
  return { ok: true }
})

/** Enfoca la ventana Preview del dev server e inyecta el inspector (misma app que los logs [preview]). */
ipcMain.handle('preview-inject-inspector', async () => {
  if (!previewWindow || previewWindow.isDestroyed()) {
    return { ok: false, error: 'no_preview' }
  }
  try {
    previewWindow.focus()
    const wc = previewWindow.webContents
    const u = wc.getURL()
    if (shouldInjectPreviewInspector(u)) {
      const inject = await getPreviewInspectorScript()
      await wc.executeJavaScript(inject)
    }
    return { ok: true, url: u }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

/** Inventario de red/multimedia en la ventana Preview (misma página que los logs [preview]). */
ipcMain.handle('preview-destripe', async () => {
  if (!previewWindow || previewWindow.isDestroyed()) {
    return { ok: false, error: 'no_preview' }
  }
  try {
    previewWindow.focus()
    const wc = previewWindow.webContents
    const u = wc.getURL()
    if (!u || u === 'about:blank') {
      return { ok: false, error: 'blank_page', url: u }
    }
    const script = await getPageDestripeScript()
    await wc.executeJavaScript(script)
    const data = await wc.executeJavaScript('window.__MCAP_DESTRIPE_LAST__ ? JSON.stringify(window.__MCAP_DESTRIPE_LAST__) : null')
    if (!data) return { ok: false, error: 'no_data', url: u }
    let parsed
    try {
      parsed = JSON.parse(data)
    } catch {
      return { ok: false, error: 'parse_failed', url: u }
    }
    return { ok: true, data: parsed, url: u }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

/** HTML + texto visible de la ventana Preview (contexto IA). */
ipcMain.handle('preview-page-snapshot', async (_, opts = {}) => {
  if (!previewWindow || previewWindow.isDestroyed()) {
    return { ok: false, error: 'no_preview' }
  }
  const mh = Number.isFinite(Number(opts.maxHtml)) ? Math.min(Math.max(0, Number(opts.maxHtml)), 400000) : 140000
  const mt = Number.isFinite(Number(opts.maxText)) ? Math.min(Math.max(0, Number(opts.maxText)), 200000) : 90000
  try {
    const wc = previewWindow.webContents
    const u = wc.getURL()
    if (!u || u === 'about:blank') {
      return { ok: false, error: 'blank_page', url: u }
    }
    const raw = await wc.executeJavaScript(`(() => {
      try {
        var html = document.documentElement && document.documentElement.outerHTML ? document.documentElement.outerHTML : ''
        var text = document.documentElement && document.documentElement.innerText ? document.documentElement.innerText : ''
        return JSON.stringify({
          title: String(document.title || ''),
          url: String(location.href || ''),
          htmlLen: html.length,
          textLen: text.length,
          html: html.slice(0, ${mh}),
          text: text.slice(0, ${mt}),
        })
      } catch (e) {
        return JSON.stringify({ error: String(e.message || e) })
      }
    })()`)
    const o = JSON.parse(raw)
    if (o.error) return { ok: false, error: o.error, url: u }
    return {
      ok: true,
      title: o.title,
      url: o.url || u,
      html: o.html || '',
      text: o.text || '',
      htmlTruncated: (o.htmlLen || 0) > mh,
      textTruncated: (o.textLen || 0) > mt,
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})

/** Análisis estático / “intel” del proyecto (sandbox opcional vía proceso hijo Node + npm audit opcional). */
ipcMain.handle('reverse-analyze', async (_, opts = {}) => {
  try {
    const { rootDir, depth, npmAudit: npmAuditOpt, sandboxMode: sandboxOpt } = opts
    if (!rootDir || typeof rootDir !== 'string') return { ok: false, error: 'invalid_root', version: 3 }
    const settings = await readSettings()
    const allowedSandbox = new Set(['host-direct', 'child-process', 'docker'])
    let sandboxMode = sandboxOpt ?? settings.reverseIntelSandboxMode ?? 'host-direct'
    if (!allowedSandbox.has(sandboxMode)) sandboxMode = 'host-direct'
    const npmAudit = !!(npmAuditOpt ?? settings.reverseIntelNpmAudit ?? false)
    const binaryStringsPreview = !!(opts.binaryStringsPreview ?? settings.reverseIntelBinaryStrings ?? false)
    return await runProjectIntelligence(rootDir, {
      depth: depth === 'quick' ? 'quick' : 'standard',
      npmAudit,
      binaryStringsPreview,
      sandboxMode,
    })
  } catch (e) {
    return { ok: false, error: e.message || String(e), version: 3 }
  }
})

// ── Build exe ─────────────────────────────────────────────────────────────────
ipcMain.handle('build-exe', async (_, { code, language, filename }) => {
  const outDir = path.join(os.homedir(), 'MCodeAI_Pre_Builds')
  fs.mkdirSync(outDir, { recursive: true })
  const base = (filename || 'programa').replace(/\.[^.]+$/, '')
  const exts = { python:'py', javascript:'js', cpp:'cpp', c:'c', go:'go', rust:'rs' }
  const src = path.join(outDir, `${base}.${exts[language] || 'txt'}`)
  const out = path.join(outDir, base + (process.platform === 'win32' ? '.exe' : ''))
  fs.writeFileSync(src, code, 'utf8')

  // Use a separate tmp dir for pyinstaller spec/cache files (avoids polluting outDir)
  const pyTmpDir = require('path').join(require('os').tmpdir(), 'mcap_pyinstaller')
  fs.mkdirSync(pyTmpDir, { recursive: true })
  const builders = {
    python:     `pyinstaller --onefile --distpath "${outDir}" --specpath "${pyTmpDir}" --workpath "${pyTmpDir}" --name "${base}" "${src}"`,
    javascript: `pkg "${src}" --output "${out}"`,
    cpp:        `g++ -O2 "${src}" -o "${out}"`,
    c:          `gcc -O2 "${src}" -o "${out}"`,
    go:         `go build -o "${out}" "${src}"`,
    rust:       `rustc -O "${src}" -o "${out}"`,
  }

  const cmd = builders[language]
  if (!cmd) return { ok: false, out: `Build no disponible para ${language}.`, dir: null }

  return new Promise(resolve => {
    exec(cmd, { timeout: 120000 }, (err, stdout, stderr) => {
      resolve(err
        ? { ok: false, out: stderr || err.message, dir: null }
        : { ok: true, out: `✓ Ejecutable generado:\n${out}`, dir: outDir })
    })
  })
})

// ── AI Proxy (CORS fix) ───────────────────────────────────────────────────────
// All AI API calls route through here (Node.js has no CORS restrictions)
// Streaming: chunks sent via 'ai-chunk' IPC event with unique requestId

ipcMain.handle('ai-stream', async (event, { id, url, headers, body }) => {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    })

    if (!res.ok) {
      const text = await res.text().catch(() => '')
      safeSend(event.sender, 'ai-chunk', { id, error: `${res.status}: ${text.slice(0, 400)}` })
      safeSend(event.sender, 'ai-chunk', { id, done: true })
      return { ok: false, status: res.status }
    }

    const reader = res.body.getReader()
    const dec    = new TextDecoder()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      safeSend(event.sender, 'ai-chunk', { id, chunk: dec.decode(value, { stream: true }) })
    }
    safeSend(event.sender, 'ai-chunk', { id, done: true })
    return { ok: true }
  } catch (e) {
    safeSend(event.sender, 'ai-chunk', { id, error: e.message })
    safeSend(event.sender, 'ai-chunk', { id, done: true })
    return { ok: false, error: e.message }
  }
})

// Non-streaming fetch for orchestrator calls (model list, etc.)
ipcMain.handle('ai-fetch', async (_, { url, method = 'GET', headers = {}, body }) => {
  try {
    const opts = { method, headers }
    if (body) opts.body = typeof body === 'string' ? body : JSON.stringify(body)
    const res  = await fetch(url, opts)
    const text = await res.text()
    return { ok: res.ok, status: res.status, text }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// ── File watcher ─────────────────────────────────────────────────────────────
const activeWatchers = new Map()

ipcMain.handle('fs-watch-start', (event, dirPath) => {
  try {
    if (activeWatchers.has(dirPath)) return { ok: true }
    if (!fs.existsSync(dirPath)) return { ok: false, error: 'Directory not found' }
    const watcher = fs.watch(dirPath, { recursive: true }, (eventType, filename) => {
      if (filename && !filename.startsWith('.')) {
        safeSend(event.sender, 'fs-changed', { dir: dirPath, event: eventType, file: filename })
      }
    })
    activeWatchers.set(dirPath, watcher)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('fs-watch-stop', (_, dirPath) => {
  try {
    const watcher = activeWatchers.get(dirPath)
    if (watcher) { watcher.close(); activeWatchers.delete(dirPath) }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Cleanup watchers on quit
const origQuit = app.quit.bind(app)
app.on('before-quit', () => {
  for (const [, w] of activeWatchers) try { w.close() } catch {}
})

// ── AI Tool: fetch URL (read web pages) ──────────────────────────────────────
ipcMain.handle('fs-fetch-url', async (_, { url }) => {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}: ${res.statusText}`, text: '' }
    const text = await res.text()
    return { ok: true, text: text.slice(0, 50000), url: res.url }
  } catch (e) {
    return { ok: false, error: e.message, text: '' }
  }
})

// ── Webview helpers ───────────────────────────────────────────────────────────
// Capture screenshot of a webview by its webContentsId
ipcMain.handle('webview-capture', async (_, { webContentsId }) => {
  try {
    const wc = require('electron').webContents.fromId(webContentsId)
    if (!wc) return { ok: false, error: 'webContents not found' }
    const img = await wc.capturePage()
    const b64 = img.toDataURL()   // data:image/png;base64,...
    return { ok: true, dataUrl: b64 }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

// Execute JS in a webview to grab its text content
ipcMain.handle('webview-get-text', async (_, { webContentsId }) => {
  try {
    const wc = require('electron').webContents.fromId(webContentsId)
    if (!wc) return { ok: false, error: 'webContents not found' }
    const text = await wc.executeJavaScript(`
      (function() {
        const sel = document.getSelection()
        if (sel && sel.toString().trim()) return sel.toString().trim()
        return (document.documentElement?.innerText || document.body?.innerText || '').slice(0, 10000)
      })()
    `)
    const title = await wc.executeJavaScript('document.title')
    const url   = wc.getURL()
    return { ok: true, text, title, url }
  } catch (e) {
    return { ok: false, error: e.message }
  }
})

ipcMain.handle('webview-get-snapshot', async (_, { webContentsId, maxHtml, maxText } = {}) => {
  try {
    const wc = require('electron').webContents.fromId(webContentsId)
    if (!wc) return { ok: false, error: 'webContents not found' }
    const mh = Number.isFinite(Number(maxHtml)) ? Math.min(Math.max(0, Number(maxHtml)), 400000) : 140000
    const mt = Number.isFinite(Number(maxText)) ? Math.min(Math.max(0, Number(maxText)), 200000) : 90000
    const raw = await wc.executeJavaScript(`(() => {
      try {
        var html = document.documentElement && document.documentElement.outerHTML ? document.documentElement.outerHTML : ''
        var text = document.documentElement && document.documentElement.innerText ? document.documentElement.innerText : ''
        return JSON.stringify({
          title: String(document.title || ''),
          url: String(location.href || ''),
          htmlLen: html.length,
          textLen: text.length,
          html: html.slice(0, ${mh}),
          text: text.slice(0, ${mt}),
        })
      } catch (e) {
        return JSON.stringify({ error: String(e.message || e) })
      }
    })()`)
    const o = JSON.parse(raw)
    if (o.error) return { ok: false, error: o.error }
    const extUrl = wc.getURL()
    return {
      ok: true,
      title: o.title,
      url: o.url || extUrl || '',
      html: o.html || '',
      text: o.text || '',
      htmlTruncated: (o.htmlLen || 0) > mh,
      textTruncated: (o.textLen || 0) > mt,
    }
  } catch (e) {
    return { ok: false, error: e.message || String(e) }
  }
})
