name: ✨ Solicitud de Feature
description: Proponer una nueva característica
title: "[FEATURE] "
labels: ["enhancement"]

body:
  - type: markdown
    attributes:
      value: |
        ¿Tienes una idea para mejorar MCodeAI? Comparte los detalles aquí.
  
  - type: textarea
    id: problem
    attributes:
      label: Problema a resolver
      description: Describe el problema que esta feature resolvería
      placeholder: Actualmente no puedo... o es difícil...
    validations:
      required: true
  
  - type: textarea
    id: solution
    attributes:
      label: Solución propuesta
      description: Cómo imaginas esta feature
      placeholder: La feature debería... permitiendo que...
    validations:
      required: true
  
  - type: textarea
    id: alternatives
    attributes:
      label: Alternativas consideradas
      description: Otras formas de resolver esto
      placeholder: |
        - Opción A: ...
        - Opción B: ...
  
  - type: checkboxes
    id: impact
    attributes:
      label: Impacto
      options:
        - label: Afecta UI/UX
        - label: Afecta performance
        - label: Requiere API externa
        - label: Breaking change posible
  
  - type: textarea
    id: additional
    attributes:
      label: Contexto adicional
      description: Cualquier otra información útil
