---
tipo: error
fecha: 2026-10-29
commit: adefef7
---
# cache de assets

El navegador se quedaba con una versión vieja de `app.js` tras desplegar.
**Solución**: `/assets/*` con `Cache-Control: no-cache` en `public/_headers`.
