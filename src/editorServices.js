/**
 * editorServices.js
 * 
 * Inicialización de servicios de Monaco Editor.
 * Extraído de extensionHost.js para desacoplar el editor
 * del sistema de host de extensiones VSIX.
 * 
 * Solo importa lo que necesita Monaco Editor para funcionar:
 * - Layout service override
 * - Syntax highlighting extensions
 * - Stubs para servicios que crashean sin workbench
 */

import { initialize, SyncDescriptor } from 'vscode/services'
import layoutOverride from '@codingame/monaco-vscode-layout-service-override'

// Default extensions for editor language features (syntax highlighting, etc.)
import '@codingame/monaco-vscode-theme-defaults-default-extension'
import '@codingame/monaco-vscode-css-language-features-default-extension'
import '@codingame/monaco-vscode-html-language-features-default-extension'
import '@codingame/monaco-vscode-json-language-features-default-extension'
import '@codingame/monaco-vscode-python-default-extension'
import '@codingame/monaco-vscode-typescript-language-features-default-extension'
import '@codingame/monaco-vscode-markdown-language-features-default-extension'

// ── Monaco Workers ──
self.MonacoEnvironment = {
  getWorker(_workerId, label) {
    if (label === 'editorWorkerService') {
      return new Worker(new URL('../node_modules/vscode/workers/editor.worker.js', import.meta.url))
    }
    return new Worker(new URL('../node_modules/vscode/workers/extensionHost.worker.js', import.meta.url))
  }
}

// ── Stubs ──
// Estos reemplazan servicios de VSCode que crashean en modo standalone
// porque esperan un DOM/workbench que no existe.

class SafeAccessibilityService {
  constructor() {
    const noopDisposable = { dispose: () => {} }
    const noopEvent = () => noopDisposable
    this._onDidChangeScreenReaderOptimizedEvent = noopEvent
    this._onDidChangeReducedMotionEvent = noopEvent
    this._onDidChangeReducedTransparencyEvent = noopEvent
    this._onDidChangeLinkUnderlineEvent = noopEvent
  }
  get onDidChangeScreenReaderOptimized() { return this._onDidChangeScreenReaderOptimizedEvent }
  get onDidChangeReducedMotion() { return this._onDidChangeReducedMotionEvent }
  get onDidChangeReducedTransparency() { return this._onDidChangeReducedTransparencyEvent }
  get onDidChangeLinkUnderlines() { return this._onDidChangeLinkUnderlineEvent }
  isScreenReaderOptimized() { return false }
  getAccessibilitySupportConfigurationValue() { return 'auto' }
  isMotionReduced() { return false }
  isTransparencyReduced() { return false }
  alwaysUnderlineAccessKeys() { return Promise.resolve(false) }
  getAccessibilitySupport() { return 0 }
  setAccessibilitySupport(_support) { }
  alert(_message) { }
  status(_message) { }
  dispose() { }
}

class SafeContextViewService {
  constructor() {
    this._disposables = []
  }
  showContextView(_delegate, _container, _shadowRoot) { return { close: () => {} } }
  hideContextView(_data) { }
  layout() { }
  getContextViewElement() { return document.createElement('div') }
  dispose() { this._disposables.forEach(d => d.dispose?.()) }
}

// ── Init ──

let initPromise = null

/**
 * Inicializa los servicios de Monaco Editor.
 * Solo se ejecuta una vez. Llamada desde Editor.jsx.
 */
export async function initVscodeApi() {
  if (initPromise) return initPromise

  initPromise = (async () => {
    await initialize({
      ...layoutOverride(document.body),
      ['accessibilityService']: new SyncDescriptor(SafeAccessibilityService, [], true),
      ['contextViewService']: new SyncDescriptor(SafeContextViewService, [], true)
    })
    console.log('[editorServices] VSCode API initialized')
    return true
  })()

  return initPromise
}
