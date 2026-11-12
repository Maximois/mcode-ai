# Guía de Contribución

¡Gracias por tu interés en contribuir a MCodeAI! 🎉

## Cómo comenzar

### 1. Fork y clona el repositorio

```bash
git clone https://github.com/tu-usuario/mcode-ai.git
cd mcode-ai
git remote add upstream https://github.com/original-owner/mcode-ai.git
```

### 2. Crea una rama para tu función

```bash
git checkout -b feature/mi-nueva-funcion
# O para bugfixes:
git checkout -b bugfix/descripcion-del-bug
```

### 3. Instala dependencias y desarrolla

```bash
npm install
npm run dev
```

---

## Reportar Bugs 🐛

Antes de crear un issue, verifica:
- ✅ Lee la documentación en el [README.md](./README.md)
- ✅ Busca en [Issues existentes](https://github.com/tu-usuario/mcode-ai/issues)
- ✅ [Consulta el Troubleshooting](./README.md#troubleshooting)

**Al reportar un bug, incluye:**
- Descripción clara del problema
- Pasos para reproducir
- Comportamiento esperado vs actual
- Sistema operativo y versión de Node.js
- Capturas/logs si es relevante

Formato ejemplo:
```
**Describir el bug:**
Al abrir un archivo grande, MCodeAI se congela.

**Reproducir:**
1. Abrir archivo > 10MB
2. Esperar 5 segundos

**Esperado:**
Debería cargar sin freezes

**Sistema:**
- Windows 11, Node 20.5, MCodeAI 2.0.0
```

---

## Proponer Nuevas Características 🚀

1. Abre un [Discussion](https://github.com/tu-usuario/mcode-ai/discussions) primero para validar la idea
2. Si hay consenso, crea un GitHub Issue con etiqueta `enhancement`
3. Describe:
   - **Problema** que resuelve
   - **Solución** propuesta
   - **Alternativas** consideradas
   - **Impacto**: ¿afecta UI, performance, API externa?

---

## Enviar Pull Requests ✅

### Antes de hacer commit

```bash
# Verifica que todo funcione
npm run dev      # desarrollo
npm run build    # producción

# Lint y formatea (siguiente paso)
```

### Estructura del Pull Request

**Título claro:**
```
✨ feat: Agregar soporte para provider X-AI
🐛 fix: Corregir crash al editar archivos grandes
📝 docs: Actualizar README con ejemplos Ollama
```

**Descripción:**
```markdown
## Cambios
- Agregar integración X-AI en ai.js
- Actualizar tabla de proveedores

## Tipo
- [ ] 🐛 Bugfix
- [x] ✨ Feature
- [ ] 📝 Docs
- [ ] 🎨 Refactor

## Testing
- [ ] Probado en Windows 10
- [ ] Probado en macOS
- [ ] Probado en Linux
- [ ] Nuevas funciones testadas

## Relacionado
Closes #123
```

### Checklist del PR

- [ ] Rama basada en `main` actual
- [ ] Un commit por cambio lógico (usa `git rebase -i`)
- [ ] Mensaje de commit claro y descriptivo
- [ ] Sin conflictos con `main`
- [ ] Código sigue el estilo existente
- [ ] Funciona localmente: `npm run dev` y `npm run build`
- [ ] Sin console.log/debugger dejados atrás

---

## Convenciones de código

### Estilo

```javascript
// ✅ BIEN: Nombres descriptivos, funciones pequeñas
function processAIResponse(response, context) {
  const cleaned = response.trim();
  return formatForEditor(cleaned, context);
}

// ❌ EVITAR: Nombres genéricos, lógica mezclada
function proc(r, c) {
  let x = r.trim();
  return x.replace(/\n/g, ' ').toLowerCase();
}
```

### Componentes React

```jsx
// Usar hooks funcionales
function MiComponente({ prop1, prop2 }) {
  const [estado, setEstado] = React.useState(null);
  
  return <div>{estado}</div>;
}

// Incluir PropTypes o TypeScript
MiComponente.propTypes = {
  prop1: PropTypes.string.required,
};
```

### Comentarios

```javascript
// ✅ Explica el "por qué", no el "qué"
// Los tokens de Groq se restablecen cada hora,
// por eso cachamos al cliente durante 50 minutos
const GROQ_CACHE_TTL = 50 * 60 * 1000;

// ❌ Estado obvio, no aporta valor
const token = api.getToken(); // obtiene el token
```

---

## Agregar un nuevo provider de IA

1. **Crea el adaptador** en `src/ai.js`:
   ```javascript
   export class MiProviderClient {
     constructor(apiKey) { this.apiKey = apiKey; }
     
     async complete(prompt, model) {
       // llamar API
       return response;
     }
   }
   ```

2. **Intégralo** en el orquestador:
   ```javascript
   providers.push({
     id: 'mi-provider',
     name: 'Mi Provider',
     client: new MiProviderClient(apiKey),
     models: ['modelo-1', 'modelo-2'],
   });
   ```

3. **Updatea README.md**: Agrega la fila en la tabla de proveedores

4. **Prueba localmente**: `npm run dev` y testa el selector de providers

---

## Proceso de revisión

1. Un maintainer revisará tu PR en 3-5 días
2. Pueden solicitar cambios
3. Una vez aprobado, se funde a `main`
4. Se agregará automáticamente al próximo release

---

## Licencia

Al contribuir, aceptas que tu código se distribuya bajo la [Licencia MIT](./LICENSE).

---

¡Gracias por mejorar MCodeAI! 💪
