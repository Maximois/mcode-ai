@AGENTS.md

# Resumen para Gemini (por si tu herramienta no importa archivos con @)

Las reglas completas estan en AGENTS.md (fuente unica de verdad). Lo esencial:

1. Planear antes de editar: que cambias, en que archivos y como lo vas a comprobar.
2. Commit de checkpoint ANTES de editar codigo (scripts\checkpoint.bat).
3. Despues de editar corre `npm run verify`. Si falla, lee el error, repara y vuelve a verificar. Tras 3 intentos fallidos, frena, vuelve al checkpoint y explica.
4. No digas "listo" ni "funciona" sin haber corrido la verificacion. Informa que verificaste y que no pudiste verificar.
5. Nunca subas *.vsix, binarios, dist/, node_modules, .env ni claves.
6. Para subir a GitHub usa scripts\push.bat.
