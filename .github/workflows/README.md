# GitHub Workflows Documentation

## Archivos disponibles

### `build.yml`
Pipeline de CI/CD que:
- Ejecuta en: Ubuntu, Windows, macOS
- Node.js: 18.x, 20.x
- Acciones:
  - Instala dependencias (`npm ci`)
  - Compila el proyecto (`npm run build`)
  - Genera artefactos de build
  - Ejecuta auditoría de seguridad npm

**Dispara en:**
- Push a `main` o `develop`
- Pull requests a `main`

## Cómo añadir más workflows

1. Crea nuevo archivo en `.github/workflows/nombre.yml`
2. Usa la sintaxis de [GitHub Actions](https://docs.github.com/en/actions)
3. Commit y push
4. GitHub ejecutará automáticamente

## Ejemplos útiles

### Workflow de Release
```yaml
name: Release
on:
  release:
    types: [created]
jobs:
  publish:
    # Publicar a npm, GitHub Releases, etc
```

### Workflow de Lint/Format
```yaml
name: Lint
on: [push, pull_request]
jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm run lint
```

### Workflow de Test Coverage
```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm test -- --coverage
      - uses: codecov/codecov-action@v3
```

## Secrets y variables

Para usar secrets en workflows:

1. Ve a Settings → Secrets → Actions → New repository secret
2. Agrega el secret (ej: `API_KEY`)
3. En el workflow: `${{ secrets.API_KEY }}`

Ejemplo:
```yaml
- name: Deploy
  env:
    GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
  run: npm run deploy
```

## Debugging

**Ver logs de un workflow:**
1. Actions → Workflow → Click en una ejecución
2. Expande "Build" o el job que falle
3. Si necesitas más debugging, agrega: `run: set -x` (bash)

**Ejecutar locally:**
```bash
# Instala act: https://github.com/nektos/act
act -j build
```
