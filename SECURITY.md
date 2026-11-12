# Security Policy

## Reporte de vulnerabilidades

Si descubres una vulnerabilidad de seguridad, **no** la reportes públicamente en Issues.

En su lugar:

1. **No publiques la vulnerabilidad** en redes sociales o foros públicos
2. **Envía un email privado** a: `security@mcservices.example.com` (reemplaza con tu email real)
3. **Incluye:**
   - Descripción de la vulnerabilidad
   - Pasos para reproducirla
   - Posible impacto
   - Tu contacto (opcional)

Recibirás una respuesta en **48 horas**.

---

## Versiones soportadas

| Versión | Soportado | Notas |
|---------|-----------|-------|
| 2.x     | ✅ Yes    | Versión actual, recibe parches |
| 1.x     | ❌ No     | End of Life - actualiza a 2.x |
| < 1.0   | ❌ No     | No soportado |

---

## Requisitos de seguridad

- Mantén **npm packages actualizados**: `npm audit fix`
- Revisa dependencias: `npm audit`
- Usa **API keys en variables de entorno**, nunca en código
- No commitees `.env` files (revisa `.gitignore`)

---

## Prácticas de desarrollo seguro

1. **Validar entrada** de usuarios
2. **No almacenar credenciales** en localStorage
3. **HTTPS-only** para llamadas a APIs
4. **Sanitizar** salidas en el editor
5. **Revisar** cambios de dependencias con `npm outdated`

---

## Contacto

- **Security**: security@mcservices.example.com
- **General**: contact@mcservices.example.com

Última actualización: 2024-10-09
