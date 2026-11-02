---
tipo: error
fecha: 2026-10-29
commit: 1624487
---
# texto pegado se cortaba

El texto pegado de más de 60.000 caracteres se cortaba en silencio en el servidor y se perdía el final de los apuntes. Además los lotes iban por páginas (8), no por tamaño.
**Solución**: lotes de hasta 12.000 caracteres sin partir líneas (`lotesDeTexto`, `MAX_CHARS_LOTE`).

Relacionado: [[pdf-se-lee-en-el-navegador]]
