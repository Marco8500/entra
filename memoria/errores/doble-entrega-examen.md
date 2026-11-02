---
tipo: error
fecha: 2026-10-29
commit: 1624487
---
# doble entrega examen

El reloj y el botón podían entregar el mismo examen dos veces: doble corrección y doble guardado.
**Solución**: `WeakSet entregados`, cada examen se entrega una vez.

Relacionado: [[errores-silenciados]]
