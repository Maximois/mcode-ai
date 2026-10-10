# Reglas para agentes de IA (Claude Code, Copilot, Cursor, Cline, Roo, Codex, etc.)

Este archivo lo leen todos los agentes del proyecto. Cumplilo siempre.

## REGLA DE ORO: commit ANTES de editar

**Antes de modificar cualquier archivo de codigo, hacé un commit con el estado actual.**
Así siempre existe un punto al que volver si algo sale mal.

1. Ejecutá `scripts\checkpoint.bat` (o `git add -A && git commit -m "checkpoint: antes de <tarea>"`).
2. Recién después editá.
3. Si la tarea es grande, hacé un commit intermedio al terminar cada parte que funcione.
4. Si algo se rompe: volvé con `git revert` o `git reset --hard HEAD~1`. No intentes "arreglar encima" de un estado roto sin avisar.

Nunca borres historial (`push --force`, `reset` sobre commits ya subidos, `rebase` de commits publicados) sin que el usuario lo pida de forma explícita.

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
