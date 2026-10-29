---
tipo: error
fecha: 2026-10-29
commit: 2b95324
---
# lote fallido cancelaba todo

Un 5xx del servidor en un lote cancelaba toda la lectura de apuntes.
**Solución**: se reintenta como "saturada" y, si sigue fallando, se guardan los temas de los demás lotes y se avisa.

Relacionado: [[ia-gratis-limite-por-minuto]]
