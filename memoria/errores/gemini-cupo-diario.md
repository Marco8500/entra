---
tipo: error
fecha: 2026-10-25
commit: 1cd9c87
---
# gemini cupo diario

**Síntoma**: la app reintentaba sin fin diciendo "IA saturada".
**Causa**: el plan gratis de Gemini da solo ~20 peticiones al día por modelo; al gastarse devolvía 429 para siempre.
**Solución**: cada modelo tiene su propio cupo → si uno da 429/503 se prueba el siguiente modelo. Si todos tienen el cupo gastado, error `cuota` y la app dice "Hoy se ha agotado la IA gratuita", sin reintentos.
**Regla**: un 429 de cupo diario no se arregla reintentando.

Relacionado: [[cadena-de-ias-gratuitas]] · [[gemini-modelo-retirado]]
