# Changelog

Todos los cambios notables a este proyecto se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.0.0/),
y este proyecto adhiere a [Semantic Versioning](https://semver.org/lang/es/).

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
