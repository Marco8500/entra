---
tipo: decision
fecha: 2026-11-09
commit: (este)
---
# portada apuntes a examen

**Qué**: la portada se ordena alrededor de una sola idea, "tus apuntes → tu simulacro → tu nota".
- Arriba, un ejemplo con apuntes reales de PRL (con "entra" y "no entra" marcados) y la pregunta de examen que sale de ellos.
- Después, cómo funciona en 3 pasos, la comparación "como siempre / con Entra", las herramientas extra, el ranking, los precios (gratis, pase de 1,99 € y Pro), las preguntas frecuentes y un último botón.

**Por qué**: el ejemplo anterior era una pregunta de Colón sin relación con "tus apuntes" y no explicaba el producto. El ranking iba segundo y estaba vacío, y "cómo funciona" iba cuarto. Además, el pase de examen no salía en los precios.

**Detalles**:
- En móvil el menú solo enseña "Empezar gratis".
- `/app?pase=1` abre directamente el pago del pase.
- Lo comprueba `tests/e2e/flujo-portada.cjs`.

Relacionado: [[pase-de-examen]] · [[sin-framework]]
