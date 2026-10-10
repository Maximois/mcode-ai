# MCodeAI — Editor de código con IA

<div align="center">

[![GitHub version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-32.0-blue?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.3-blue?logo=react)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.4-blue?logo=vite)](https://vitejs.dev/)

</div>

Editor de código de escritorio construido con **Electron + Vite + React + Monaco Editor**, con orquestación inteligente de múltiples proveedores de IA.

### Características principales ✨

- 🤖 **Orquestación IA automática** - Elige el mejor modelo/proveedor para cada tarea
- ⚡ **8 proveedores de IA** - Groq, Cerebras, Gemini, Mistral, OpenRouter, Together AI, Ollama, Zen
- 💻 **Editor completo** - Monaco Editor con soporte para múltiples lenguajes
- 🔄 **Pipeline 3 etapas** - Reader → Fixer → Reviewer para mayor precisión
- 📦 **Extensiones VSIX** - Soporte para extensiones de VS Code
- 💾 **Memoria persistente** - Historial por proyecto para mejor contexto

---

## 🚀 Instalación y arranque

```bash
# 1. Instalar dependencias
npm install

# 2. Modo desarrollo (Vite + Electron en paralelo)
npm run dev

# 3. Build distributable
npm run build

# 4. Testear build de producción local
npm run preview
```

---

## 🤖 Proveedores de IA soportados

| Proveedor | Gratis | Velocidad | Mejor para |
|-----------|--------|-----------|------------|
| **Groq** | ✅ | ⚡⚡⚡ | Orquestador, comandos rápidos |
| **Zen** (opencode.ai) | ✅ Sin key | ⚡⚡ | Tareas simples sin configuración |
| **Cerebras** | ✅ | ⚡⚡⚡ | ~2000 tok/s, rival de Groq |
| **Mistral** | ✅ | ⚡⚡ | Código especializado (Codestral) |
| **OpenRouter** | ✅ | ⚡⚡ | Muchos modelos free dinámicos |
| **Together AI** | ✅ créditos | ⚡⚡ | Llama-3.3-70B gratis |
| **Gemini** | ✅ | ⚡⚡ | 1M contexto, proyectos grandes |
| **Ollama** | ✅ Local | ⚡ | Sin internet, privado |

### Obtener API Keys (todas gratuitas)

- **Groq**: https://console.groq.com/keys
- **Gemini**: https://aistudio.google.com/app/apikey
- **OpenRouter**: https://openrouter.ai/keys
- **Cerebras**: https://cloud.cerebras.ai
- **Mistral**: https://console.mistral.ai/api-keys/
- **Together AI**: https://api.together.ai/settings/api-keys
- **Zen**: No requiere key

---

## ⌨️ Atajos de teclado

| Atajo | Acción |
|-------|--------|
| `Ctrl+S` | Guardar archivo |
| `Ctrl+N` | Nuevo archivo |
| `Ctrl+B` | Toggle explorador |
| `Ctrl+J` | Toggle terminal |
| `Ctrl+I` | Toggle chat IA |
| `Ctrl+,` | Configuración |

---

## 🧠 Modo Auto (orquestador)

Con **Groq configurado**, el modo `Auto` analiza cada pregunta y elige automáticamente:
- el **proveedor** más adecuado (según disponibilidad y complejidad)
- el **modelo** específico dentro del proveedor
- los **archivos relevantes** del proyecto

```
Tarea operativa (npm install, git commit) → Groq (rápido)
Tarea simple (editar 1 función)           → Zen o Cerebras
Tarea moderada (bug en módulo)            → Mistral Codestral
Análisis profundo (arquitectura)          → Together / Gemini
Proyecto grande (>2000 líneas)            → Gemini (1M ctx)
```

---

## 📁 Estructura del proyecto

```
mcode-ai/
├── electron/
│   ├── main.js       # Proceso principal Electron
│   └── preload.js    # Bridge renderer ↔ main (contextBridge)
├── src/
│   ├── ai.js         # Motor IA: providers, orquestador, pipeline
│   ├── App.jsx       # Componente principal
│   ├── main.jsx      # Entry point React
│   ├── styles.css    # Estilos globales
│   └── hooks/
│       ├── useSettings.js  # Settings + API keys persistentes
│       ├── useTabs.js      # Manejo de tabs del editor
│       └── useMemory.js    # Memoria por proyecto
├── index.html        # Entry point Vite
├── vite.config.js    # Config Vite + Monaco
└── package.json
```

---

## 🔧 Acciones de IA en el editor

El modelo puede proponer cambios que se aplican con un click:

```
# Editar líneas específicas (preciso, no reescribe todo)
```PATCH:src/App.jsx:42:55
código nuevo
```

# Escribir archivo completo
```WRITE:src/utils.js
export function ...
```

# Crear archivo nuevo
```CREATE:src/components/Button.jsx
import React from 'react'
...
```

# Ejecutar comandos
```RUN:./
npm install axios
npm run build
```
```

---

## 🏗️ Build distributable

```bash
npm run build
# Genera instalador en dist-electron/
# Windows: MCodeAI Setup.exe
# Mac: MCodeAI.dmg
# Linux: MCodeAI.AppImage
```

---

## � Requisitos del sistema

- **Node.js** 18+ 
- **npm** 9+ (o yarn/pnpm)
- **Windows 10+**, **macOS 10.13+**, o **Linux** (veriones recientes)
- RAM mínima: 2GB
- Conexión a internet (algunas IA requieren API keys)

---

## ⚙️ Configuración inicial

1. **Clonar el repositorio**
   ```bash
   git clone https://github.com/tu-usuario/mcode-ai.git
   cd mcode-ai
   ```

2. **Instalar dependencias**
   ```bash
   npm install
   ```

3. **Configurar API Keys** (opcional)
   - Abre la app: `npm run dev`
   - Ve a Configuración (Ctrl+,)
   - Ingresa tus API keys (todas son gratuitas)
   - Sin configurar, usa **Zen** como fallback (sin key)

4. **Iniciar en desarrollo**
   ```bash
   npm run dev
   ```

---

## 🐛 Troubleshooting

| Problema | Solución |
|----------|----------|
| `npm install` falla | Borra `node_modules/` y `package-lock.json`, intenta nuevamente |
| Vite no inicia | Puerto 5176 ocupado: cambia en `vite.config.js` |
| Electron no abre | Verifica que Node.js esté en PATH: `node --version` |
| IA no responde | Verifica conexión internet y API keys en Configuración |
| Monaco no renderiza código | Borra `.vite/` y reconstruye |

---

## 🤝 Contribuir

¡Las contribuciones son bienvenidas! Consulta [CONTRIBUTING.md](./CONTRIBUTING.md) para detalles sobre cómo:
- Reportar bugs
- Proponer nuevas características
- Enviar pull requests
- Desarrollar nuevos proveedores de IA

---

## 📄 Licencia

Este proyecto está bajo la licencia [MIT](./LICENSE).

---

## 📞 Soporte

- 📖 **Wiki**: https://github.com/tu-usuario/mcode-ai/wiki
- 🐛 **Issues**: https://github.com/tu-usuario/mcode-ai/issues
- 💬 **Discussions**: https://github.com/tu-usuario/mcode-ai/discussions

---

## 📝 Notas técnicas

- **Zen** funciona sin API key como fallback siempre disponible
- El **pipeline de 3 etapas** (Reader → Fixer → Reviewer) se activa en Configuración
- La **memoria por proyecto** guarda el historial de interacciones y lo usa como contexto
- Monaco Editor carga workers en modo ES module — no modificar `optimizeDeps` en vite.config.js

---

## 🙏 Créditos

Desarrollado por **MC SERVICES**

Stack: Electron • Vite • React • Monaco • Groq • Mistral • Gemini

---

**MC SERVICES** · MCodeAI v1.0
