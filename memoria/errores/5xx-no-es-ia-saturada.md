---
tipo: error
fecha: 2026-10-29
commit: 1624487
---
# 5xx no es ia saturada

`api()` convertía cualquier 5xx en "La IA está saturada", también en pago, borrar cuenta o chat, y no tenía tiempo máximo.
**Solución**: si el servidor manda mensaje, se muestra tal cual; sin conexión → "Sin conexión con Entra"; corte a los 90 s sin datos. Reintentos de 8, 15 y 30 s (antes 20, 40 y 60).
**Regla**: nunca tapar el error real con un mensaje genérico.

Relacionado: [[netlify-504-latido]]
