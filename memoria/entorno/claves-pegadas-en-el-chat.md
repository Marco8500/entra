---
tipo: entorno
fecha: 2026-10-29
---
# claves pegadas en el chat

En conversaciones anteriores se pegaron claves en el chat (Groq, Gemini, Stripe test, service_role, token de Cloudflare, secretos de webhook). No están en el repo, pero **hay que rotarlas**.
**Regla**: nunca escribir claves secretas en el repo, en notas ni en commits. Solo las públicas (anon, `pk_`, ids de precio) pueden ir en `config.js` o `wrangler.toml`.

Relacionado: [[seguridad-pendiente]]
