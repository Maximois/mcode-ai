# Resumen Completo del Editor MCodeAI Pre

## Arquitectura General

MCodeAI Pre es un **editor de código + IA** construido con **React + Monaco Editor** en el frontend y **Electron** en el backend. La comunicación entre frontend y sistema operativo ocurre mediante **IPC (ipcRenderer/ipcMain)** a través de un puente (`preload.js`).

```
index.html → src/main.jsx → src/App.jsx (componente principal)
  ├── src/ai.js           → Motor IA: providers, streaming, herramientas, planes, experiencia
  ├── src/BrowserTab.jsx   → Navegador web integrado (webview de Electron)
  ├── src/DevPanel.jsx     → Panel de servidor de desarrollo
  ├── src/ReverseIntelPanel.jsx → Análisis estático de proyectos
  ├── src/webPageDestripe.js    → Formateo de "destripe" (inteligencia web)
  ├── src/styles.css       → Estilos globales
  └── src/hooks/
       ├── useSettings.js  → Hook de configuración (persistencia en disco/localStorage)
       ├── useTabs.js      → Hook de pestañas de archivos
       └── useMemory.js    → Hook de memoria de conversaciones

electron/main.js           → Proceso principal de Electron (maneja IPC, servidores, ventanas)
electron/preload.js        → Puente IPC: expone window.api con todos los métodos
electron/pageDestripeScript.mjs  → Script injectado para destripe web
electron/previewInspectorScript.mjs → Script injectado para inspector visual
electron/reverse-engineering/    → Motor de análisis estático de proyectos
```

---

## 1. Sistema de Pestañas de Archivos (`useTabs.js`)

**Propósito:** Gestionar los archivos abiertos en el editor.

**Funciones:**
- `openDiskFile(entry)` — Abre archivo del disco: si ya está en pestañas, actualiza contenido; si no, crea nueva pestaña
- `saveTab(tab)` — Guarda archivo: si tiene `filePath` escribe al disco; si no, abre diálogo "Guardar como"
- `closeTab(id)` — Cierra pestaña, selecciona la anterior como activa
- `updateContent(id, content)` — Actualiza contenido y marca como dirty (modificado)
- `newTab(name)` — Crea pestaña vacía con lenguaje detectado por extensión

**Lógica:** Usa `useState` para `tabs[]` y `activeId`. El `activeTab` se deriva con `tabs.find()`. Cada tab tiene: `{ id, name, language, filePath, content, dirty }`.

---

## 2. Sistema de Configuración (`useSettings.js`)

**Propósito:** Persistir todas las preferencias del usuario.

**Defaults notables:**
- `provider: 'auto'` — Selección automática de IA
- `models` — Modelo por defecto para cada proveedor
- `apiKeys` — Keys para 10 proveedores
- `pipelineStages` — 3 etapas del pipeline (Reader→Fixer→Reviewer)
- `autoApplyAiPatches: true` — Auto-aplicar parches al disco
- `autoApplyAiRun: false` — Auto-ejecutar RUN (riesgoso)
- `outputDir: ''` — Directorio de salida para build
- `fontSize: 14`, `wordWrap: 'on'`, `minimap: false`, `theme: 'vs-dark'`

**Persistencia:** Intenta cargar/guardar desde el proceso principal (`window.api.settingsLoad/Save`) con fallback a `localStorage`.

---

## 3. Sistema de Memoria (`useMemory.js`)

**Propósito:** Recordar conversaciones previas por proyecto para dar contexto a la IA.

**Funciones:**
- `remember(projectPath, userMsg, aiMsg, activeFile)` — Guarda resumen de interacción
- `getRelevantMemories(projectPath, activeFile, limit)` — Filtra memorias por proyecto/archivo
- `clearMemories(projectPath)` — Limpia por proyecto o todas

**Persistencia:** `localStorage` con clave `mcap_memory_v1`, máximo 150 entradas.

---

## 4. Editor Principal (`App.jsx`)

### 4.1 Layout General

```
┌─────────────────────────────────────────────────────┐
│ Titlebar (botones de acción)                        │
├──────────┬────────────────────────────────┬─────────┤
│ Sidebar  │ Editor (Monaco) / Browser      │ Chat IA │
│ (FileTree│ ┌─────────────────────────┐    │ (oculto │
│  + Dash) │ │ Buscar/Reemplazar       │    │  o      │
│          │ ├─────────────────────────┤    │ visible)│
│          │ │ TabBar + Toolbar        │    │         │
│          │ ├─────────────────────────┤    │         │
│          │ │ Monaco Editor           │    │         │
│          │ ├─────────────────────────┤    │         │
│          │ │ Bottom Panel            │    │         │
│          │ │ (Terminal/Dev/Intel)    │    │         │
├──────────┴────────────────────────────────┴─────────┤
│ StatusBar (modelo, lenguaje, línea:col)             │
└─────────────────────────────────────────────────────┘
```

### 4.2 Titlebar

Botones principales:
- **📁 Abrir** — Abre carpeta como proyecto (`openFolder`)
- **📂 Output** — Abre carpeta de salida (guarda ruta en settings. outputDir)
- **📄 Archivo** — Abre archivo individual
- **💾 Guardar** — Guarda pestaña activa
- **🛠 Construir** — Build/compila el archivo activo
- **⊞** — Toggle sidebar
- **⌨** — Toggle terminal/dev panel
- **🌐 Web** — Toggle navegador integrado
- **🎯** — Inspeccionar elemento en Preview
- **📡** — Destripe web (inteligencia de red)
- **◈ IA** — Toggle chat IA
- **🔎 Buscar** — Buscar en archivo
- **⚙** — Settings

### 4.3 Sidebar

- **FileTree** — Árbol de directorios con exploración perezosa (auto-expande directorios con ≤15 hijos)
  - Íconos por extensión con colores
  - Botón 🌐 en archivos .html para previsualizar en navegador
  - Destaca archivo activo
- **Project Tools** — Detecta automáticamente herramientas del proyecto:
  - Node.js (package.json) → npm/pnpm/yarn
  - Python (requirements.txt / pyproject.toml) → pip/poetry
  - Go (go.mod) → go
  - Rust (Cargo.toml) → cargo
  - PHP (composer.json) → composer
  - Muestra dependencias, instalación, y búsqueda de paquetes
- **Dashboard** — Métricas del proyecto: archivos, dependencias, lenguajes, undos, experiencia, timeline
- **Experience Panel** — Búsqueda en base de conocimiento (errores/soluciones previas)
- **Timeline Panel** — Línea temporal de cambios y aprendizaje (por hora del día)
- **Sidebar Footer** — Crear archivo, crear app con IA, abrir UI app, limpiar memoria, proyectos recientes

### 4.4 FileTree

**Propósito:** Explorador visual del proyecto.

**Lógica:**
- Carga directorios bajo demanda (`window.api.readDir`)
- Omite `.`, `node_modules`, `__pycache__`, `dist`, `.git`, etc.
- Ordena directorios primero, luego archivos alfabéticamente
- Auto-expande directorios en root y primer nivel si tienen ≤15 hijos
- Soporta context menu (onContextMenu)

### 4.5 Monaco Editor

- Editor profesional con resaltado de sintaxis por lenguaje
- **Opciones:** fontSize, fontFamily (JetBrains Mono), fontLigatures, minimap, wordWrap, bracket pair colorization
- **Eventos:** cursor position → StatusBar, onChange → updateContent
- Carga lazy (`Suspense`) con `@monaco-editor/react`
- Chunking de build: `monaco-editor` separado en chunk propio

### 4.6 Editor Toolbar

Botones contextuales sobre el editor:
- **🌐 Preview** — Para archivos `.html`, abre previsualización en el navegador integrado
- **🔍 Explicar** — Envía código seleccionado (o todo el archivo) al chat IA para explicación

### 4.7 Search/Replace Panel

**Búsqueda en el archivo activo:**
- Buscar siguiente/anterior, reemplazar actual/todo
- Opciones: Match case, palabra completa, regex

**Búsqueda global (en todo el proyecto):**
- **📁 En contenidos** — Busca texto en todos los archivos del proyecto (usa `searchProjectFiles`)
- **📑 Duplicados** — Encuentra bloques de 4+ líneas duplicados entre archivos
- **🔄 Reemplazar en archivos** — Reemplazo masivo con regex

**Lógica de searchProjectFiles:**
- Recorre todos los archivos del proyecto
- Scorea por coincidencia en nombre de archivo (5 pts) y contenido (3 pts)
- Muestra preview de líneas con contexto (1 línea antes/después)
- Límite: 5 archivos, 3 matches por archivo

**Lógica de findDuplicates:**
- Hash de bloques de 4 líneas (trim)
- Detecta bloques idénticos en archivos diferentes
- Ordena por cantidad de ocurrencias

### 4.8 Welcome Screen

Pantalla de bienvenida cuando no hay pestañas:
- Logo MCodeAI
- Botones: Abrir carpeta, Abrir archivo, Nuevo archivo, Crear app IA, Configurar IA
- Proyectos recientes (persistidos en localStorage)
- Atajos de teclado

---

## 5. Navegador Integrado (`BrowserTab.jsx`)

**Propósito:** Navegador web completo dentro del editor usando `<webview>` de Electron.

### 5.1 Pestañas del Navegador

- Múltiples pestañas con historial de navegación individual
- URL bar con botones: atrás, adelante, recargar, descargar página, agregar bookmark, historial, inspector, destripe, control de popups
- Ctrl+Enter abre URL en nueva pestaña
- Página de inicio con accesos directos (MDN, Can I Use, npm, GitHub, StackOverflow, DevDocs, localhost:5175, localhost:3000)

### 5.2 Bookmarks Bar

- Botones: 📁 (abrir carpeta), 📂 (ir a output dir)
- Bookmarks predefinidos (MDN, Can I Use, npm, GitHub, StackOverflow, DevDocs)
- Separador visual (`.bookmark-sep`)
- Bookmarks personalizables guardados en localStorage (`browserBookmarks`)

### 5.3 Webview Wiring

Cada pestaña tiene un `<webview>` con `partition="persist:browser"` y `contextIsolation=false`. Eventos wireados:

- **did-navigate** / **did-navigate-in-page** — Actualiza URL y botones de navegación
- **did-start-loading** / **did-stop-loading** — Spinner de carga, captura `webContentsId`
- **page-title-updated** — Título de pestaña
- **new-window** — Control de popups (bloqueados por defecto)
- **console-message** — Puente de comunicación con scripts injectados:
  - `__MCAP_INSPECT__` — Resultado del inspector visual
  - `__MCAP_TAB__` — Intercepción de URL para nueva pestaña
  - `__MCAP_DESTRIPE__` — Datos de destripe web
  - `__MCAP_DIAG__` — Diagnóstico de webviews anidados

### 5.4 Scripts Injectados

- **INSPECTOR_FLOATING** — Inspector visual flotante para seleccionar elementos en la página
- **URL_BRIDGE** — Detecta `<webview>` anidados, interfecta URL bar, muestra badge diagnóstico
- **PAGE_DESTRIPE** — Extrae inventario de red: scripts, CSS, imágenes, video, audio, fuentes, manifiestos streaming, CSP, Performance API

### 5.5 Acciones

- **sendPageToChat** — Envía contenido textual de la página al chat IA
- **screenshotToChat** — Captura screenshot del webview y lo envía al chat (para análisis visual)
- **downloadPage** — Descarga el HTML completo de la página
- **runPageDestripe** — Ejecuta destripe en la ventana Preview o en el webview
- **injectInspectorUi** — Inyecta inspector visual (prioriza ventana Preview del dev server)
- **searchWeb** — Busca en web usando el término en la URL bar, envía resultados al chat
- **addBookmark** — Guarda bookmark en localStorage

### 5.6 External URL Interception

Escucha eventos `dev-open-newtab` (disparados desde DevPanel) para abrir URLs en nuevas pestañas.

---

## 6. Chat IA (`ChatPanel` en `App.jsx` + `ai.js`)

### 6.1 Flujo de Envío (`send` function)

1. Recopila contexto en paralelo:
   - Archivos del proyecto (`projectContext`)
   - Archivos relevantes (`selectRelevantFiles`)
   - Búsqueda en proyecto (`searchProjectFiles`)
   - Ruteo de proveedor (`routeProvider`)
   - Análisis de relevancia (`analyzeProjectRelevance`)
2. Busca web si corresponde (`shouldUseWebSearch`)
3. Recolecta intel de página web (`collectWebPageIntel`)
4. Construye mensajes con `buildMessages` (presupuesto de 25000 tokens)
5. Stream de respuesta con `sendToAI`
6. Procesa acciones (parses automáticos):
   - PATCH/WRITE/CREATE → auto-aplica si `autoApplyAiPatches` está activo
   - RUN → auto-ejecuta si `autoApplyAiRun` está activo
   - READ → se ignora en auto-apply (solo lectura)
7. Recuerda la conversación (`remember`)

### 6.2 Componentes del Chat

- **ChatMsg** — Renderiza mensajes con avatar, proveedor, modelo, imagen adjunta, texto markdown (Prose), y botones de acción (PATCH/WRITE/CREATE/RUN/READ)
- **PlansPanel** — Muestra planes activos con barra de progreso
- **DiffModal** — Modal de confirmación antes de aplicar cambios (muestra diff antes/después)
- **Quick Actions** — Botones: Docs, Tests, Optimizar, Security, Types, Refactor, Captura
- **Image attachment** — Paste (Ctrl+V) o file picker. Si el modelo no soporta visión, describe con Gemini

### 6.3 Toolbar del Chat

- 📍 — Marca fin de contexto
- ↺ — Restablece punto de corte
- ◈ — Selector de modelo/proveedor (dropdown inline)
- 🔍 — Búsqueda en mensajes
- 💾 — Exportar chat a Markdown
- ⌫ — Limpiar chat
- ↩ — Badge de deshacer (cantidad de cambios disponibles)

---

## 7. Motor IA (`ai.js`)

### 7.1 Providers Soportados (12)

| Provider | API | Gratis | Modelo Default |
|----------|-----|--------|----------------|
| Ollama | Local | Sí | llama3.2:3b |
| Groq | OpenAI | Sí | llama-3.1-8b-instant |
| Gemini | Google | Sí (1M ctx) | gemini-2.5-flash |
| OpenRouter | OpenAI | Sí | meta-llama/llama-3.1-8b-instruct:free |
| Zen (opencode.ai) | OpenAI | Parcial (-free) | big-pickle |
| Cerebras | OpenAI | Sí | gpt-oss-120b |
| Mistral | OpenAI | Sí | mistral-small-latest |
| Together | OpenAI | Sí | gpt-4o-mini |
| SambaNova | OpenAI | Sí (30 RPM) | Meta-Llama-3.3-70B-Instruct |
| Fireworks | OpenAI | Sí (10 RPM) | llama-v3p1-8b-instruct |
| DeepSeek | OpenAI | 5M tokens | deepseek-chat |
| NVIDIA NIM | OpenAI | 1000 req/mes | meta/llama-3.1-405b-instruct |

Provider especial:
- **`auto`** — Orquestador inteligente: usa Gemini o Zen según disponibilidad

### 7.2 Streaming

**callOpenAI** — Función genérica OpenAI-compatible:
1. POST a `baseUrl + '/chat/completions'` con `stream: true`
2. Parsea líneas SSE (`data: {...}`)
3. Captura `delta.content` y `delta.tool_calls`
4. Soporta `onMetadata` para `reasoning_content` (DeepSeek)
5. Retorna texto completo acumulado

**doStream** — Abstracción que elige entre:
- `ipcStream` — Electron IPC proxy (bypass CORS)
- `nativeFetchStream` — Fetch nativo del navegador

**callGemini** — API específica de Gemini (Google):
- Concatena system messages en uno solo
- Construye `contents[]` con roles `user`/`model`
- Soporta imágenes vía `parts`

**callOllama** — API local de Ollama

### 7.3 Tool Calling

**Dos sistemas paralelos:**

1. **Text-based TOOL** — Regex `[TOOL: readFile ...]` / `[TOC: ...]` (normalizado):
   - `normalizeTools(text)` — Normaliza variantes de formato a `[TOOL: cmd args]`
   - `TOOL_RE` — Regex que captura comandos
   - `executeToolCall(name, args)` — Ejecuta la herramienta y retorna resultado
   - Hasta 4 rondas de tool calls, más ronda final

2. **Native function calling** — Providers que soportan `tools` en el body:
   - `TOOL_SCHEMAS` — Definiciones de 20+ herramientas

**Herramientas disponibles:**
- `readFile(path)` — Lee archivo (soporta `path:inicio-fin`)
- `searchProject(query)` — Busca texto en proyecto
- `listDir(path)` — Lista directorio
- `glob(pattern)` — Busca archivos por patrón
- `grep(pattern)` — Busca con regex
- `searchWeb(query)` — Busca en web
- `fetchURL(url)` — Obtiene contenido de URL
- `git(args)` — Comandos git
- `createPlan(title, steps)` — Crea plan de tareas
- `updatePlan(step)` — Actualiza estado de paso
- `listPlans()` — Lista planes
- `undo(count)` — Deshace cambios
- `tree(path, depth)` — Árbol de directorios
- `review(path)` — Revisa archivo
- `rename(from, to)` — Renombra símbolo
- `createComponent(name)` — Crea componente React
- `changelog()` — Genera changelog
- `learn(type, tags, context, solution, code)` — Guarda en base de conocimiento
- `remember(query)` — Busca en experiencia
- `experience(action)` — Estadísticas o limpieza
- `timeline(time, window)` — Línea temporal
- `screenshot()` — Captura pantalla

### 7.4 Plan/Task Management

- `_plans[]` — Array en memoria de planes activos
- Persistencia en localStorage (`mcap_plans_v1`)
- Cada plan tiene: título, pasos con estado (pending/in_progress/completed), barra de progreso
- Máximo 20 planes guardados

### 7.5 Undo History

- `undoHistory[]` — Array de cambios aplicados
- `pushUndo(filePath, originalContent, actionDesc)` — Guarda antes de cada modificación
- Máximo 50 entradas

### 7.6 Experience Database

- `loadExp()` / `saveExp()` — Persistencia en localStorage (`mcap_experience_v1`)
- `addExperience({ type, tags, context, solution, code, file, project })` — Guarda corrección/solución
- `searchExperience(query, limit)` — Busca por relevancia (tags > context > solution > file)
- `getExperienceStats()` — Estadísticas por tipo
- `getTimeline(timeQuery, windowMin)` — Timeline de eventos cerca de un momento
- Máximo 200 entradas

### 7.7 Pipeline de 3 Etapas

Cuando `settings.pipeline = true`:
1. **Reader** — Lee proyecto y detecta problemas
2. **Fixer** — Genera parches
3. **Reviewer** — Verifica calidad

Cada etapa puede usar proveedor/api key diferente para no saturar rate limits.

### 7.8 Smart Pipeline (Zen + Gemini)

Cuando se usa Gemini con Zen disponible:
- **Zen** analiza el proyecto completo y responde
- Si Zen tiene dudas (`[CONSULTAR_GEMINI: ...]`), **Gemini** supervisa y corrige
- Zen también puede solicitar búsqueda específica al proyecto

### 7.9 buildMessages (Presupuesto de Contexto)

Construye el array de mensajes para la IA respetando un presupuesto de tokens:

1. **System Prompt** — Instrucciones del sistema (~75 líneas)
2. **Web Context** — Resultados de búsqueda web (hasta 45% del budget, máx 18000 tok)
3. **Context Parts:**
   - Archivo activo (siempre completo, sin truncar)
   - Índice del proyecto (solo nombres + símbolos)
   - 5 archivos relevantes (hasta 500 líneas c/u)
   - Web page intel (destripe + DOM en vivo)
   - Dev logs (últimos 25, filtrados por errores)
   - Memorias del proyecto
   - Historial de conversación (recortado por markers)
   - Project search results

### 7.10 Auto-Fix System

Sistema de monitoreo y corrección automática:

1. **useAppMonitor** — Captura errores globales (window.onerror, unhandledrejection), métricas de performance
2. **analyzeAndFixErrors** — Cuando se detectan errores, envía prompt de corrección al chat IA:
   - Analiza patrones de error (JS, componentes, performance)
   - Incluye logs recientes
   - Pide a la IA que actúe inmediatamente
   - Cooldown entre correcciones (15s)
3. **Auto-fix desde dev logs** — Detecta errores en la salida del servidor y dispara corrección
4. **Deduplicación** — No corrige el mismo error dentro de 60s
5. **Límite de 20 auto-correcciones** por conversación

### 7.11 sendToAI

**Flujo principal del chat IA:**

1. Si provider es `zen+gemini`: Gemini orquesta → Zen investiga
2. Si pipeline está activo: ejecuta pipeline 3 etapas
3. Si es Gemini con Zen: intenta Smart Pipeline
4. Si no: llamada directa al proveedor con:
   - `toolAwareOnChunk` — Callback que filtra `[TOOL: ...]` del stream visible al usuario
   - `makeProviderCall` — Llama al proveedor específico con retry
   - Hasta 4 rondas de tool calling (nativo o text-based)
   - Ronda final forzada sin tools

### 7.12 executeToolCall

Dispatcher de herramientas con 22+ comandos:

| Comando | Implementación |
|---------|---------------|
| readFile | `window.api.readFile` con rango opcional de líneas |
| grep | `window.api.toolGrep` en proceso principal |
| glob | `window.api.toolGlob` con patrón |
| searchProject | `searchProjectFiles` en el caché |
| searchWeb | `searchWeb` vía fetch |
| fetchURL | `window.api.fetchURL` (IPC proxy) |
| listDir | `window.api.readDir` |
| tree | Construye árbol recursivo |
| git | `window.api.runCommand` con cwd del proyecto |
| screenshot | `setScreenshotHandler` en BrowserTab |
| createPlan/updatePlan/listPlans | Gestión en memoria |
| undo | `confirmAction` con undoHistory |
| review | Lee archivo y retorna análisis |
| rename | Reemplazo global en archivos del proyecto |
| createComponent | Crea archivo .jsx con template React |
| changelog | `git log` en proyecto |
| learn/remember/experience/timeline | Experience Database |

---

## 8. Acciones de la IA (Action System)

### 8.1 Formatos Reconocidos

```markdown
## Bloque de acción (auto-aplicable):
\`\`\`WRITE:ruta/archivo
contenido completo
\`\`\`

\`\`\`PATCH:ruta/archivo:inicio:fin
nuevo contenido para ese rango
\`\`\`

\`\`\`CREATE:ruta/archivo
nuevo archivo
\`\`\`

\`\`\`RUN:directorio
comando a ejecutar
\`\`\`

## Lectura (línea simple, sin backticks):
READ:ruta/archivo
READ:ruta/archivo:inicio:fin
```

### 8.2 parseActions

Extrae acciones del texto de respuesta de la IA. Primero busca bloques ` ```TIPO:ruta `, luego líneas `READ:ruta`. Deduplica por tipo + ruta (excepto RUN que permite múltiples).

### 8.3 stripActions

Remueve todas las acciones del texto para mostrar solo el contenido legible.

### 8.4 applyAction

Muestra preview al usuario en `DiffModal`:
- **WRITE** — Muestra diff before/after (si archivo existe) o "CREAR ARCHIVO"
- **PATCH** — Muestra fragmento original vs reemplazo
- **CREATE** — Muestra "NUEVO ARCHIVO" + contenido
- **RUN** — Muestra comando a ejecutar
- **READ** — Lee archivo y muestra contenido

### 8.5 confirmAction

Ejecuta la acción confirmada:
- **RUN** — Ejecuta comando en terminal
- **READ** — Lee archivo y muestra en terminal
- **PATCH** — `writeLines` (reemplazo preciso de líneas)
- **WRITE/CREATE** — `writeFile` (archivo completo)
- Guarda undo antes de modificar
- Verifica sintaxis automáticamente: node --check, tsc, python -m py_compile, JSON.parse
- Actualiza pestaña abierta si coincide

---

## 9. Terminal y Dev Server

### 9.1 TerminalPanel

- Múltiples terminales (shell integrado vía `terminalCreate/terminalStdin/terminalKill`)
- Historial de comandos (flechas arriba/abajo)
- Soporta procesos hijo creados con `spawnTracked`
- Output coloreado por tipo: cmd, out, err, info

### 9.2 DevPanel (`DevPanel.jsx`)

**Propósito:** Iniciar/detener servidor de desarrollo y monitorear logs.

**Funciones:**
- ▶ **Iniciar** — `window.api.devStart({ cwd, cmd })` — Ejecuta comando de desarrollo
- ⏹ **Detener** — `window.api.devStop()`
- 🔄 **Reiniciar** — Stop + Start
- **URL manual** — Abrir URL en ventana Preview (↗) o en pestaña del navegador integrado (⟐)
- **Logs** — Streaming en tiempo real con:
  - Filtro por texto
  - Conteo de errores
  - Deduplicación de líneas repetidas
  - Marcas de tiempo
- **Comando personalizado** — En vez de auto-detectar, especificar comando manual

### 9.3 Electron Dev Server Management

En el proceso principal (`main.js`):
- `devStart` — `spawn` con `shell: true` en el directorio del proyecto
- Transmite stdout/stderr al renderer vía `cmd-stream`
- Detecta URL del servidor automáticamente (monitorea salida en busca de `http://localhost:...`)
- Ventana Preview separada para la app en desarrollo
- `devOpenWindow` — Crea/enfoca ventana BrowserWindow para la app
- `previewInjectInspector` — Inyecta inspector visual en la ventana Preview
- `previewDestripe` — Ejecuta destripe en la ventana Preview
- `previewPageSnapshot` — Captura HTML/texto de la ventana Preview

---

## 10. Reverse Intel Panel (`ReverseIntelPanel.jsx`)

**Propósito:** Análisis estático de proyectos para extraer inteligencia.

**Modos de sandbox (configurable en Settings):**
- **host-direct** — En el proceso de Electron (rápido)
- **child-process** — Proceso hijo Node.js
- **docker** — Contenedor Docker (imagen node:20-bookworm-slim)

**Analizadores (`electron/reverse-engineering/`):**
- `scan-core.js` — Orquestador principal
- `analyzers/manifest.js` — Detecta tipo de proyecto (package.json, go.mod, Cargo.toml, etc.)
- `analyzers/imports.js` — Analiza imports y dependencias
- `analyzers/hotspots.js` — Detecta "hot spots" (archivos grandes, complejos)
- `analyzers/patterns.js` — Patrones de código
- `analyzers/binaries.js` — Detecta binarios grandes
- `analyzers/dependencies.js` — Árbol de dependencias
- `analyzers/native-strings.js` — Strings en binarios
- `analyzers/npm-audit.js` — npm audit --json

**Opciones:**
- **Rápido** — Menos archivos, más rápido
- **npm audit** — Usa red del registry npm
- **strings** — `file(1)` + `strings(1)` en binarios

**Salida:** Reporte Markdown con señales unificadas (severidad: error/warn/info) que puede copiarse o enviarse al chat IA.

---

## 11. Destripe Web (`webPageDestripe.js` + `pageDestripeScript.mjs`)

**Propósito:** Extraer inteligencia de páginas web (scripts, multimedia, red) para que la IA la use como referencia.

**Captura (`fetchLiveWebSnapshots`):**
1. Prioridad: webview del navegador integrado (🌐 Web)
2. Fallback: ventana Preview del dev server
3. Retorna: título, URL, HTML, texto visible

**Formato de salida (`formatDestripeMarkdown`):**
- Scripts externos e inline
- CSS externos
- Preload / prefetch / fuentes
- Multimedia (imágenes, video, audio desde DOM)
- Frames / iframes
- Open Graph / Twitter meta
- CSP
- Performance API (initiatorType → orígenes)
- Manifiestos streaming (HLS/DASH)
- URLs de transmisión en markup
- Resumen por origen

---

## 12. Web Server Local

Servidor Express integrado que sirve la build del editor (`dist/`) en `0.0.0.0:{port}`:
- Iniciar/detener desde Settings
- Muestra URLs locales (IPs de red)
- Acceso desde otros dispositivos en la misma red
- Fallback SPA para rutas HTML

---

## 13. File Watcher

- `watchStart(rootDir)` / `watchStop(rootDir)` en proceso principal
- Detecta cambios en archivos del proyecto
- Auto-refresca `projectFiles` y `changeRevision`
- Filtra extensiones relevantes (js, jsx, ts, tsx, py, css, html, json, md, etc.)
- Dispara `markCodeChanged()` para señalizar cambios al auto-fix

---

## 14. Monitoreo de Errores

**`useAppMonitor`** — Hook que captura:
- Errores globales (`window.onerror`)
- Promesas rechazadas (`unhandledrejection`)
- Performance metrics (navigation, measures)
- Errores de componentes (mount, unmount, render)
- Errores de red (filtrados: no disparan auto-fix si son solo de red)

**Filtros de ruido:**
- `isMonitoringNoise` — Filtra logs de Vite, Electron Security Warning, React DevTools, conexiones locales fallidas, etc.
- `shouldAutoFixFromCmdText` — Solo dispara auto-fix ante errores reales (SyntaxError, TypeError, etc.)

---

## 15. Atajos de Teclado

| Atajo | Acción |
|-------|--------|
| Ctrl+S | Guardar archivo |
| Ctrl+B | Toggle sidebar |
| Ctrl+J | Toggle terminal/dev |
| Ctrl+D | Dev panel |
| Ctrl+Shift+D | Intel panel |
| Ctrl+W | Toggle navegador |
| Ctrl+I | Toggle chat IA |
| Ctrl+N | Nueva pestaña |
| Ctrl+, | Settings |
| Ctrl+F | Buscar/Reemplazar |
| Ctrl+H | Buscar/Reemplazar |

---

## 16. Estructura de Build

- **Vite** para bundling del frontend React
- **electron-builder** para empaquetado nativo
- Chunking: vendor (node_modules), monaco-editor, index
- `launcher.bat` — Script de inicio para dev: `vite --port 5175` + `electron .`
- **CSP** en index.html: conecta a APIs de todos los proveedores de IA

---

## 17. Proveedores de IA — Routing y Fallbacks

### modo auto
1. Intenta Gemini (si hay key)
2. Fallback a Zen (si hay key)

### routePipelineKeys
Toma hasta 3 proveedores con key, en orden: cerebras → mistral → fireworks → deepseek → sambanova → nvidia → gemini → openrouter → zen

### OpenRouter free models
Obtiene dinámicamente modelos gratuitos de `openrouter.ai/api/v1/models`, filtra por pricing=0, combina con lista curada de 7 modelos free.

### Zen models
Obtiene modelos dinámicos de `opencode.ai/zen/v1/models`, separa free (sufijo -free) de pagos. Cache de 5 minutos.
