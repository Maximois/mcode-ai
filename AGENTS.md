# Reglas para agentes de IA (Claude Code, Gemini, Copilot, Cursor, Cline, Roo, Codex, etc.)

Este archivo lo leen todos los agentes del proyecto. Cumplilo siempre.

## REGLA DE ORO: commit ANTES de editar

**Antes de modificar cualquier archivo de codigo, hacé un commit con el estado actual.**
Así siempre existe un punto al que volver si algo sale mal.

1. Ejecutá `scripts\checkpoint.bat` (o `git add -A && git commit -m "checkpoint: antes de <tarea>"`).
2. Recién después editá.
3. Si la tarea es grande, hacé un commit intermedio al terminar cada parte que funcione.
4. Si algo se rompe: volvé con `git revert` o `git reset --hard HEAD~1`. No intentes "arreglar encima" de un estado roto sin avisar.

Nunca borres historial (`push --force`, `reset` sobre commits ya subidos, `rebase` de commits publicados) sin que el usuario lo pida de forma explícita.

## FLUJO OBLIGATORIO para cualquier cambio de código

Nunca des algo por terminado solo porque lo editaste. Seguí siempre estos pasos:

1. **Planear.** Antes de tocar nada, escribí un plan corto: qué vas a cambiar, en qué archivos y cómo vas a comprobar que quedó bien. Si el cambio es grande o riesgoso, mostrá el plan y esperá el visto bueno.
2. **Checkpoint.** Hacé el commit de la REGLA DE ORO.
3. **Editar** solo lo que el plan indica. No "mejores" cosas que nadie pidió.
4. **Verificar de verdad.** Corré `npm run verify` (sintaxis de `electron/` + build de vite). Para cambios muy chicos podés usar `npm run verify -- --quick`, pero antes de dar por cerrada una tarea corré la versión completa.
5. **Si falla: leé el error, repará y volvé a verificar.** Repetí hasta que pase. Si después de 3 intentos sigue fallando, o cada arreglo rompe otra cosa, **frená**: volvé al checkpoint (`git reset --hard HEAD`) y explicá qué pasó en vez de seguir apilando parches.
6. **Revisar lo que no cubre el build.** El build no detecta errores en ejecución (ventanas de Electron, IPC, procesos). Si tocaste `electron/main.js`, `preload.js` o algo que depende de la app corriendo, revisá a mano el flujo afectado (por ejemplo: eventos que se disparan al cerrar ventanas o al salir de la app) y, si podés, ejecutá la app.
7. **Reportar con honestidad:** qué verificaste y con qué resultado, y qué NO pudiste verificar. Está prohibido decir "listo" o "funciona" sin haber corrido el paso 4.
8. **Commit** del cambio ya verificado, con mensaje claro.

## Qué NO se sube nunca a git

- Paquetes y binarios: `*.vsix`, `*.zip`, `*.exe`, `*.msi`, `*.dll`, `*.node`, `*.db`, `*.sqlite`
- Salidas de build: `dist/`, `dist-electron/`, `build/`, `out/`
- `node_modules/` y `package-lock.json` (está ignorado a propósito)
- Secretos: `.env*`, claves API, tokens, `*.pem`, `*.key`
- Configuración local de herramientas: `.vscode/`, `.roo/`, `.cline/`, `.cursor/`, `.claude/settings.local.json`
- Imágenes o archivos sueltos de prueba en la raíz (capturas, `file.png`, etc.)

Antes de cada commit revisá `git status`. Si aparece algo de esta lista, **no lo agregues**: agregalo a `.gitignore`.
Usá `git add` con rutas concretas en lugar de `git add -A` cuando haya archivos sin revisar.

## Subir a GitHub

- Primera vez en una PC: `scripts\github-login.bat` (vincula la cuenta una sola vez).
- Para subir: `scripts\push.bat` (hace checkpoint, hace push, y si falta sesión abre el login).
- No pegues tokens en el código, en comandos ni en la URL del remoto.

## Estilo de trabajo

- Plataforma objetivo: Windows. Máquina con 8 GB de RAM: evitá procesos pesados o paralelos innecesarios.
- Mensajes de commit claros y en español o inglés, con prefijo (`fix:`, `feat:`, `chore:`, `docs:`).
- Si un cambio es riesgoso o grande, preguntá antes de hacerlo.
