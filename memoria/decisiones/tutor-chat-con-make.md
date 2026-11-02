---
tipo: decision
fecha: 2026-10-26
commit: 530d3f8
---
# tutor chat con make

El tutor por chat reenvía a un escenario de **Make** (`MAKE_CHAT_URL`) con los apuntes del alumno como contexto.
`/api/chat` comprueba la sesión y el límite mensual (20 gratis, 200 Pro). Tiempo máximo 40 s. Hay simulador del webhook en `dev/mocks.mjs`.
