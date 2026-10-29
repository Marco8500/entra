# Pruebas de Entra

| Tipo | Comando | Qué usa | Red externa |
|---|---|---|---|
| Unitarias | `npm run test:unit` | `node:test`, `fetch` simulado | No |
| Navegador (e2e) | `npm run test:e2e` (o `node tests/e2e/correr.mjs pago` para uno) | Playwright + Supabase local + IA y Stripe simulados (`dev/mocks.mjs`) | No |
| Rendimiento | `npm run perf` (opcional: número de repeticiones, p. ej. `npm run perf -- 50`) | Igual que e2e | No |

Ninguna prueba llama a las IAs reales, a Stripe real ni a la base de datos de producción.

## Preparar el entorno local para e2e y rendimiento

```sh
npm install && npm run test:deps        # pdf.js y jsPDF solo para las pruebas (no se guardan en package.json)
npx supabase start                      # Supabase local (Docker); aplica supabase/migrations
npm run mocks                           # IA simulada en :4010 y Stripe simulado en :4020
npx wrangler dev --port 8888            # la app (usa .dev.vars con las claves locales y URLs de los simuladores)
```

`.dev.vars` (no se sube a git) necesita, como mínimo: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (las del Supabase local),
`GROQ_API_KEY`/`GROQ_API_URL` y `MISTRAL_API_KEY`/`MISTRAL_API_URL` apuntando a `http://127.0.0.1:4010`,
`STRIPE_SECRET_KEY`, `STRIPE_API_URL=http://127.0.0.1:4020`, `STRIPE_WEBHOOK_SECRET` y `STRIPE_PK_TEST`.
Si `wrangler dev` falla por el enlace `[ai]`, usa una copia de `wrangler.toml` sin esa sección (`-c wrangler.local.toml`; no la subas).

Las capturas de pantalla de los flujos se guardan en `tests/e2e/capturas/` (ignorada por git).
