# Changelog

Todos los cambios notables a este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

### 🤖 Autopiloto (fase 1): verificación automática tras aplicar cambios
- Tras aplicar un cambio de código (por lote o con el botón Aplicar suelto, también en modo Manual) corre las verificaciones del proyecto: `verify` si existe o, si no, `test` y `lint` de `package.json`. Una a la vez, se frena en el primer fallo, con 3 min de tope
- Tarjeta de resultado en el chat (✔/✗ con tiempos y la ubicación del fallo); a la IA solo le llega un resumen corto del fallo, no el log completo
- Opción en Ajustes para apagarlo; `run-command` acepta `timeoutMs` opcional y avisa `timedOut`
- `scripts/test-autopilot.mjs` (27 comprobaciones, enganchado a `npm run verify`)

### 🤖 Autopiloto (fase 2): preparador de contexto
- Cada pregunta al agente lleva un bloque "Estado automático del proyecto" recolectado sin IA: rama y último commit, cambios sin commitear (con su código y el diff resumido), errores de validación local actuales y el resultado de la última verificación. Así el agente no gasta rondas de herramientas en averiguarlo
- Git se consulta con una lectura segura (`ctx-git-summary`: sin shell, argumentos fijos, sin tomar locks, 4 s de tope); si no hay git o no es un repo, el bloque simplemente se omite
- Los textos de commits y archivos se neutralizan (son datos, no instrucciones) y el bloque tiene tope de tamaño según el presupuesto del modelo
- Opción en Ajustes para apagarlo; 11 comprobaciones nuevas en `scripts/test-autopilot.mjs`

### 🤖 Autopiloto (fase 3): asistente de comandos locales
- Pedidos obvios de una sola acción se resuelven sin IA ni tokens (respuesta marcada "Asistente local (sin IA)"): "corré los tests" (verify, o test y lint), "qué cambió" (git), "qué errores hay", "buscá secretos" (valores enmascarados), "hacé un snapshot", "deshacé el último cambio" y "qué basura hay" (solo muestra, no borra). "ayuda" lista todo
- Reconocimiento deliberadamente estrecho: el mensaje completo tiene que ser el comando; si trae algo más ("corré los tests y arreglá lo que falle", "qué cambió en ai.js") va a la IA
- Opción en Ajustes para apagarlo; `scripts/test-local-assistant.mjs` (125 comprobaciones, incluye ~50 mensajes que NO deben interceptarse)

### 🛡 Agente: contexto fiable y freno de mano
- Modo de parches **Manual por defecto** (botón ✋ Manual / ⚡ Auto en el chat y opción en Ajustes): los PATCH/WRITE/CREATE y los RUN esperan tu clic en Aplicar. En Auto, un parche sobre un archivo que el agente no leyó en ese turno se rechaza y se le pide leerlo primero (en Manual solo se avisa)
- Índice del proyecto siempre presente y honesto: avisa cuando es parcial (tope de archivos/tamaño/profundidad), lista los archivos que quedaron sin contenido y pasa a formato compacto si no entra en el presupuesto
- `searchProject` busca en el disco (todo el proyecto) y no en el mapa recortado en memoria
- El presupuesto de contexto depende del modelo (ventana estimada, o la que fijes en Ajustes) y el historial se compacta solo, sin gastar tokens: lo viejo se resume y el último pedido queda intacto
- Historial de chat por proyecto (`<userData>/chats/`, solo texto, hasta 300 mensajes / 4 MB)
- El prompt del agente exige no afirmar nada de un archivo que no leyó
- `scripts/test-agent-context.mjs` (38 comprobaciones, enganchado a `npm run verify`)

### ✨ Added
- Herramientas locales de cero tokens (botón 🛠 Local del explorador; se desactivan con `localTools: false`). Capa aislada en `electron/local-tools/` y `src/local-tools/` que no reemplaza nada del editor:
  - Validación al guardar y al abrir (JSON, YAML, JS/MJS/CJS) con la línea con error subrayada en el editor
  - Escáner de secretos (valores enmascarados) y gestor visual de `.gitignore`
  - Rollbacks: snapshots comprimidos fuera del proyecto, con respaldo previo al restaurar y snapshot automático antes de que el agente cambie 2+ archivos (opcional en Ajustes)
  - Índice de símbolos, generador de README, JSDoc y encabezados de licencia (con vista previa y snapshot previo), y scaffolding desde plantillas JSON
  - Biblioteca de 16 snippets validados con parámetros saneados
  - Mantenimiento: versionado SemVer, changelog desde git, limpieza de basura regenerable, enlaces rotos y minificado de CSS (`.min.css`, sin tocar los originales)
- Redactor local opcional con Ollama (solo `localhost`): propone mensajes de commit, introducciones de README y descripciones JSDoc, y adapta snippets; todo se revisa antes de usarse
- `scripts/test-local-tools.mjs` (79 comprobaciones, se corre desde `npm run verify`) con foco en la seguridad de borrados, snapshots y escritura en masa

## [2.0.0] - 2024-10-09

### ✨ Added
- Orquestación automática de proveedores IA con pipeline 3-etapas (Reader → Fixer → Reviewer)
- Integración de 8 proveedores: Groq, Cerebras, Gemini, Mistral, OpenRouter, Together AI, Zen, Ollama
- Interfaz mejorada con Monaco Editor completo
- Sistema de extensiones VSIX compatible VS Code
- Memoria persistente por proyecto para contexto continuado
- Soporte para múltiples lenguajes de programación
- Modo "Auto" que elige automáticamente el mejor proveedor y modelo
- Atajos de teclado personalizables
- Sistema de settings persistente

### 🎨 Changed
- Refactor completo de arquitectura Electron
- Migración a Vite para mejor performance de desarrollo
- Actualización a React 18.3
- UI rediseñada con componentes funcionales

### 🚀 Improved
- Tiempos de carga reducidos 40%
- Mejor manejo de memoria para proyectos grandes
- Performance en rendering del editor

### 🐛 Fixed
- Estabilidad al editar archivos grandes
- Manejo de errores en conexión a providers
- Sincronización entre tabs

---

## [1.0.0] - 2024-00-00

### ✨ Initial Release
- Versión inicial del editor con IA
- Soporte básico para integración de modelos
- Editor de código con Monaco
- Integración Electron

---

## Notas de versión futura

### [Unreleased]
- 🔄 Refactor del sistema de plugins
- 🎨 Nueva paleta de temas
- 📊 Panel de estadísticas de uso
- 🔐 Autenticación mejorada
- 🌐 Soporte multiidioma completo

---

### Cómo ver diferencias entre versiones

```bash
# Ver tags
git tag -l

# Ver cambios entre versiones
git log v1.0.0..v2.0.0 --oneline

# Checkout a versión específica
git checkout v2.0.0
```
