# 🚀 MCodeAI v2 - Guía de Inicio Rápido

## Estado Actual

✅ **Proyecto listo para ejecutar**

- Dependencias instalables
- Código compilado sin errores (npm run build)
- 4 problemas críticos resueltos
- Editor funcional con manejo de errores
- Terminal con soporte para comandos npm
- IA con acceso al proyecto

---

## 🎯 Cómo Empezar

### 1. Inicia el Desarrollo

```bash
cd c:\Desktop\mcode-ai-v2
npm run dev
```

Esto abre:
- **Vite dev server** (http://localhost:5176)
- **Electron app** (ventana desktop)
- **Terminal** mostrando logs en tiempo real

**Espera 10-20 segundos** hasta que cargue completamente.

### 2. Prueba el Editor

La ventana Electron debería mostrar:
- Panel izquierdo: Árbol de archivos
- Centro: Editor Monaco (o error legible si falla)
- Derecha: Chat IA
- Abajo: Terminal/Logs

### 3. Carga un Proyecto

- Botón 📁 Abrir carpeta
- Selecciona una carpeta con código (ej: `c:\Desktop\mcode-ai-v2`)
- Árbol debe poblarse con archivos

### 4. Prueba la IA

En el chat escribe:
```
Lee el archivo package.json
```

La IA debe:
- ✅ Leer el archivo
- ✅ Mostrar contenido o resumen
- ✅ Sin errores de "[Error: ...]"

---

## 🔧 Troubleshooting

### Error: "Editor Error: ..."

**Causa:** Monaco no inicializó  
**Solución:**
```bash
rm -r node_modules/.vite
npm run dev
```

### Error: "npm not found"

**Causa:** Path no tiene node_modules/.bin  
**Solución:** Ya arreglado en `electron/main.js`  
**Verifica:**
```bash
echo %PATH%  # Windows
# Debe contener: C:\Desktop\mcode-ai-v2\node_modules\.bin
```

### IA no lee archivos

**Causa:** rootDir no se pasa a herramientas  
**Solución:** Ya arreglado en `src/ai.js`  
**Verifica:**
```javascript
// En DevTools → Console
window.api.readFile('package.json')
  .then(r => console.log(r))
```

### Terminal dice "Too many concurrent processes"

**Causa:** Más de 10 comandos ejecutándose simultáneamente  
**Solución:** Detén procesos anteriores  
**Aumenta el límite en:** `electron/main.js` linea 20
```javascript
const MAX_TRACKED_PROCS = 20  // Cambiar de 10
```

---

## 📚 Archivos Importantes

| Archivo | Propósito |
|---------|-----------|
| `src/Editor.jsx` | ✅ Componente Editor con error handling |
| `src/ai.js` | ✅ Motor IA con herramientas |
| `electron/main.js` | ✅ Proceso principal con PATH arreglado |
| `src/App.jsx` | Componente principal |
| `package.json` | Dependencias (ya instaladas) |

---

## 🧪 Checklist de Verificación

Ejecuta esto cuando abras `npm run dev`:

- [ ] Ventana Electron abre sin errores negros
- [ ] Se ve el editor Monaco en el centro
- [ ] Árbol de archivos carga cuando abres carpeta
- [ ] Escribes en el editor y se graba
- [ ] Terminal inferior muestra logs
- [ ] Chat IA acepta mensajes sin error de API
- [ ] IA puede leer archivos del proyecto

---

## 🆘 Logs Útiles

Abre **DevTools** (F12 en Electron):

```javascript
// Ver errores de inicialización
console.log('[Editor]')      // Busca problemas
console.log('[editorServices]')
console.log('[run-command]')

// Ver si rootDir se pasa
console.log('[executeToolCall]')
```

---

## 📊 Comandos Disponibles

```bash
# Desarrollo (con hot reload)
npm run dev

# Build producción
npm run build

# Previsualizar build
npm run preview

# Solo Vite (frontend)
npm run vite

# Solo Electron (backend)
npm run electron
```

---

## 📝 Próximos Pasos

1. ✅ **Verifica que funciona** con los checks arriba
2. 📋 **Si hay errores**, abre DevTools (F12) y busca el problema
3. 🐛 **Si es un bug grandi**, crea un issue en GitHub
4. 🚀 **Customiza la IA** agregando providers en `settings`
5. 💾 **Guarda la rama** para cambios futuros

---

## 🔐 Configuración de IA

Abre **Configuración** (Ctrl+,):

- Elige provider: Groq, Gemini, Ollama, etc.
- Agrega API keys (gratis para la mayoría)
- Configura modelos defedidos

**Providers recomendados:**
- **Groq**: Más rápido, gratis, ideal para tareas
- **Gemini**: 1M contexto, excelente, gratis
- **Ollama**: Local, sin internet, privado

---

## 📞 Support

| Problema | Ubicación |
|----------|-----------|
| Errores técnicos | [FIXES_APLICADOS.md](FIXES_APLICADOS.md) |
| Documentación general | [README.md](README.md) |
| Diagnóstico | [DIAGNOSTICO.md](DIAGNOSTICO.md) |
| Configuración GitHub | [GITHUB_SETUP.md](GITHUB_SETUP.md) |
| Guía contribución | [CONTRIBUTING.md](CONTRIBUTING.md) |

---

**¡Listo para comenzar! 🎉**

Ejecuta: `npm run dev`

Si algo falla, busca los logs en DevTools (F12).
Luego revisa [DIAGNOSTICO.md](DIAGNOSTICO.md) o [FIXES_APLICADOS.md](FIXES_APLICADOS.md).

