---
tipo: error
fecha: 2026-10-29
commit: 1624487
---
# registros en segundo plano

Esperar con `await` el registro en `ia_errores` retrasaba el cambio de IA y el cierre de cada respuesta.
**Solución**: `enSegundoPlano()` con `ctx.waitUntil` (AsyncLocalStorage en `worker.js`): no retrasa y Cloudflare no lo corta.

Relacionado: [[cadena-de-ias-gratuitas]]
