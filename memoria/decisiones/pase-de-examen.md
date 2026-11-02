---
tipo: decision
fecha: 2026-10-27
commit: 9b335f5
---
# pase de examen

Además de Pro mensual (3,99 €) hay un **pase de examen de 7 días por 1,99 €** (pago único).

- `perfiles.pro_hasta`; el webhook lo activa una sola vez por sesión de pago (tabla `pases`, `activar_pase` idempotente).
- Se recomienda el pase si el alumno tiene un examen en los próximos 10 días.
- Límites por plan en `netlify/lib/entra.mjs` → `LIMITES` (gratis: 3 simulacros, 25 páginas, 20 mensajes, 40 correcciones).

Relacionado: [[stripe-modo-por-clave]] · [[webhook-perdia-pagos]] · [[pago-solo-tarjeta]]
