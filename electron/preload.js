const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // ── Filesystem ──────────────────────────────────────────────────────────────
  readFile:       (p)            => ipcRenderer.invoke('fs-read', p),
  writeFile:      (args)         => ipcRenderer.invoke('fs-write', args),
  writeLines:     (args)         => ipcRenderer.invoke('fs-write-lines', args),
  readDir:        (dir)          => ipcRenderer.invoke('fs-readdir', dir),
  exists:         (p)            => ipcRenderer.invoke('fs-exists', p),
  delete:         (p)            => ipcRenderer.invoke('fs-delete', p),
  rename:         (from, to)     => ipcRenderer.invoke('fs-rename', { from, to }),
  shellOpen:      (p)            => ipcRenderer.invoke('shell-open', p),
  projectContext: (rootDir)      => ipcRenderer.invoke('fs-project-context', rootDir),
  toolGrep:       (rootDir, query) => ipcRenderer.invoke('fs-grep', { rootDir, query }),
  toolGlob:       (rootDir, pattern) => ipcRenderer.invoke('fs-glob', { rootDir, pattern }),

  // ── Dialogs ─────────────────────────────────────────────────────────────────
  openFolder:     ()             => ipcRenderer.invoke('dialog-open-folder'),
  openFile:       ()             => ipcRenderer.invoke('dialog-open-file'),
  openVsix:       ()             => ipcRenderer.invoke('dialog-open-vsix'),
  saveFile:       (name, content) => ipcRenderer.invoke('dialog-save-file', { name, content }),

  // ── Code execution ──────────────────────────────────────────────────────────
  runCode:        (args)         => ipcRenderer.invoke('run-code', args),
  runCommand:     (args)         => ipcRenderer.invoke('run-command', args),
  terminalCreate: (args)         => ipcRenderer.invoke('terminal-create', args),
  terminalStdin:  (args)         => ipcRenderer.invoke('terminal-stdin', args),
  terminalKill:   (args)         => ipcRenderer.invoke('terminal-kill', args),
  buildExe:       (args)         => ipcRenderer.invoke('build-exe', args),

  // ── Dev server ──────────────────────────────────────────────────────────────
  devStart:       (opts)         => ipcRenderer.invoke('dev-start', opts),
  devStop:        ()             => ipcRenderer.invoke('dev-stop'),
  devStatus: () => ipcRenderer.invoke('dev-status'),
  devLog:   (data) => ipcRenderer.invoke('dev-log-send', data),
  devOpenWindow: (url) => ipcRenderer.invoke('dev-open-window', { url }),
  devCloseWindow: () => ipcRenderer.invoke('dev-close-window'),
  previewInjectInspector: () => ipcRenderer.invoke('preview-inject-inspector'),
  previewDestripe: () => ipcRenderer.invoke('preview-destripe'),
  previewPageSnapshot: (opts) => ipcRenderer.invoke('preview-page-snapshot', opts || {}),
  reverseAnalyze: (opts) => ipcRenderer.invoke('reverse-analyze', opts || {}),
  onDevLog: (cb) => {
    const h = (_, d) => cb(d)
    ipcRenderer.on('dev-log', h)
    return () => ipcRenderer.removeListener('dev-log', h)
  },
  onDevUrl: (cb) => {
    const h = (_, url) => cb(url)
    ipcRenderer.on('dev-url', h)
    return () => ipcRenderer.removeListener('dev-url', h)
  },
  onDevStatus: (cb) => {
    const h = (_, s) => cb(s)
    ipcRenderer.on('dev-status', h)
    return () => ipcRenderer.removeListener('dev-status', h)
  },

  // Terminal streaming
  onCmdStream: (cb) => {
    const h = (_, d) => cb(d)
    ipcRenderer.on('cmd-stream', h)
    return () => ipcRenderer.removeListener('cmd-stream', h)
  },

  // ── AI Proxy (bypasses CORS — all AI calls go through Node.js) ─────────────
  aiStream: (id, url, headers, body, onData) => {
    const handler = (_, msg) => { if (msg.id === id) onData(msg) }
    ipcRenderer.on('ai-chunk', handler)
    ipcRenderer.invoke('ai-stream', { id, url, headers, body })
      .catch(e => onData({ id, error: e.message, done: true }))
    return () => ipcRenderer.removeListener('ai-chunk', handler)
  },
  aiFetch: (url, opts) => ipcRenderer.invoke('ai-fetch', { url, ...opts }),
  fetchURL: (url) => ipcRenderer.invoke('fs-fetch-url', { url }),

  // ── Webview helpers ─────────────────────────────────────────────────────────
  webviewCapture: (id) => ipcRenderer.invoke('webview-capture',  { webContentsId: id }),
  webviewGetText: (id) => ipcRenderer.invoke('webview-get-text', { webContentsId: id }),
  webviewGetSnapshot: (args) => ipcRenderer.invoke('webview-get-snapshot', args || {}),
  openExtensionsFolder: () => ipcRenderer.invoke('open-extensions-folder'),

  // ── VSIX extension management ─────────────────────────────────────────────
  vsixInstall:   (vsixPath)  => ipcRenderer.invoke('vsix-install',   { vsixPath }),
  vsixList:      ()          => ipcRenderer.invoke('vsix-list'),
  vsixListFiles: (extId)     => ipcRenderer.invoke('vsix-list-files', { extId }),
  vsixUninstall: (extId)     => ipcRenderer.invoke('vsix-uninstall', { extId }),

  // ── ASAR operations ─────────────────────────────────────────────────────────
  asarExtract: (archivePath, destDir) => ipcRenderer.invoke('asar-extract', { archivePath, destDir }),
  asarPack:    (srcDir, destPath)     => ipcRenderer.invoke('asar-pack', { srcDir, destPath }),
  asarList:    (archivePath)          => ipcRenderer.invoke('asar-list', { archivePath }),

  settingsLoad: () => ipcRenderer.invoke('settings-load'),
  settingsSave: (settings) => ipcRenderer.invoke('settings-save', settings),
  webServerStart: (port) => ipcRenderer.invoke('web-server-start', port),
  webServerStop: () => ipcRenderer.invoke('web-server-stop'),
  webServerStatus: () => ipcRenderer.invoke('web-server-status'),
  watchStart: (dir) => ipcRenderer.invoke('fs-watch-start', dir),
  watchStop: (dir) => ipcRenderer.invoke('fs-watch-stop', dir),
  onFileChanged: (cb) => {
    const h = (_, msg) => cb(msg)
    ipcRenderer.on('fs-changed', h)
    return () => ipcRenderer.removeListener('fs-changed', h)
  },
})
