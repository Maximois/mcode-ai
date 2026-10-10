name: 🐛 Reporte de Bug
description: Reporta un bug encontrado
title: "[BUG] "
labels: ["bug"]
assignees: []

body:
  - type: markdown
    attributes:
      value: |
        Gracias por reportar un bug. Completa lo siguiente para ayudarnos a resolverlo.
  
  - type: checkboxes
    id: checks
    attributes:
      label: Verificaciones previas
      options:
        - label: Leí el [README.md](../README.md) y [Troubleshooting](../README.md#troubleshooting)
          required: true
        - label: Busqué en [issues existentes](../../issues)
          required: true
        - label: Este es un bug, no una pregunta
          required: true
  
  - type: textarea
    id: describe
    attributes:
      label: Describir el bug
      description: Descripción clara y concisa del problema
      placeholder: Cuando hago X, ocurre Y en lugar de Z
    validations:
      required: true
  
  - type: textarea
    id: reproduce
    attributes:
      label: Pasos para reproducir
      description: Lista de pasos específicos
      placeholder: |
        1. Abrir archivo...
        2. Ir a...
        3. Hacer clic en...
      value: |
        1. 
        2. 
        3. 
    validations:
      required: true
  
  - type: textarea
    id: expected
    attributes:
      label: Comportamiento esperado
      description: Qué debería ocurrir
      placeholder: Debería...
    validations:
      required: true
  
  - type: textarea
    id: actual
    attributes:
      label: Comportamiento actual
      description: Qué ocurre en realidad
      placeholder: En lugar de eso...
    validations:
      required: true
  
  - type: textarea
    id: environment
    attributes:
      label: Entorno del sistema
      description: Información del sistema
      placeholder: |
        - SO: Windows 11
        - Node.js: 20.5
        - npm: 9.8
        - Versión MCodeAI: 2.0.0
      value: |
        - SO: 
        - Node.js: (ejecuta `node --version`)
        - npm: (ejecuta `npm --version`)
        - Versión MCodeAI: 
    validations:
      required: true
  
  - type: textarea
    id: logs
    attributes:
      label: Logs o capturas de pantalla
      description: |
        Adjunta logs de consola, capturas de pantalla, console.log output, etc.
        Use `npm run dev` y abre las DevTools con F12
      placeholder: Pega logs aquí o sube imágenes

  - type: textarea
    id: additional
    attributes:
      label: Contexto adicional
      description: Otra información relevante (intentos previos, etc)
