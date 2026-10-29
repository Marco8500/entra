---
tipo: entorno
fecha: 2026-10-29
---
# red bloqueada

Desde el contenedor **no hay acceso** a `entraia.workers.dev`, la API de Cloudflare, Groq, Gemini, Stripe real ni Make.
Sí funciona el conector de Supabase (consultas y migraciones en producción).
Todo lo demás se prueba con los simuladores de `dev/mocks.mjs`; decirlo claramente cuando algo no se ha podido probar de verdad.

Relacionado: [[pruebas]] · [[sesiones-en-la-nube]]
