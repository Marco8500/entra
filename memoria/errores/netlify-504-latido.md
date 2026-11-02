---
tipo: error
fecha: 2026-10-26
commit: 8fac2fb
---
# netlify 504 latido

Netlify cortaba con 504 mientras la IA pensaba.
**Solución**: el servidor manda un espacio cada 8 s (latido) en el streaming; el navegador corta si en 90 s no llega ningún byte.
Sigue activo en Cloudflare: el streaming espera a la red y no gasta CPU.

Relacionado: [[cloudflare-workers-no-pages]] · [[5xx-no-es-ia-saturada]]
