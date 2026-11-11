# Changelog

Todos los cambios notables a este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

## [Unreleased]

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
