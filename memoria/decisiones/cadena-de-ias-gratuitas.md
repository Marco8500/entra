---
tipo: decision
fecha: 2026-10-26
commit: 06fc0d1
---
# cadena de ias gratuitas

No depender de una sola IA: `streamIA` prueba proveedores en orden y salta al siguiente si uno está saturado, sin cupo o tarda más de 25 s.

- Orden por defecto (`IA_ORDEN`): `mistral,groq,groqVision,gemini,cloudflare,anthropic`. Solo se usan los que tienen clave.
- Un proveedor que falla se salta durante 1 minuto; los que tienen 3+ fallos en 15 min van al final.
- Cada llamada (buena o mala) queda en la tabla `ia_errores` con proveedor, modelo, código y ms.
- Para ver qué IA va mejor: `select proveedor, modelo, ok, count(*), avg(ms) from ia_errores group by 1,2,3`.

Relacionado: [[gemini-cupo-diario]] · [[ia-gratis-limite-por-minuto]] · [[ia-respuesta-cortada]] · [[registros-en-segundo-plano]]
