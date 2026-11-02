---
tipo: error
fecha: 2026-10-25
commit: 093f4f8
---
# ia gratis limite por minuto

**Síntoma**: subir ~30 fotos perdía todo lo leído.
**Causa**: se lanzaban 8 peticiones a la vez contra un plan de 5 peticiones/minuto; los 429 tumbaban la lectura entera.
**Solución**: como mucho 2 lotes de fotos a la vez (2 fotos por lote, 1400 px, calidad 0,78), reintento con cuenta atrás y guardar lo que sí se leyó.
**Regla**: con IAs gratis, pocas peticiones en paralelo y lotes pequeños.

Relacionado: [[lote-fallido-cancelaba-todo]] · [[cadena-de-ias-gratuitas]]
