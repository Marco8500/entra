---
tipo: error
fecha: 2026-10-29
commit: 199d6f7
---
# ia respuesta cortada

La IA a veces devolvía JSON cortado o mal formado y la corrección se rompía.
**Solución**: `streamIA({ validar })` junta la respuesta, la comprueba y, si no vale, la apunta en `ia_errores` y pasa a otra IA. Margen de tokens según el número de preguntas y un elemento por respuesta.

Relacionado: [[correccion-por-ideas]] · [[cadena-de-ias-gratuitas]]
