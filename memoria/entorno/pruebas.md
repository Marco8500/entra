---
tipo: entorno
fecha: 2026-10-29
commit: 1624487
---
# pruebas

- `npm run test:unit` → 10 unitarias, `fetch` simulado, sin red.
- `npm run test:e2e` (o `node tests/e2e/correr.mjs pago`) → 14 flujos Playwright con Supabase local + simuladores.
- `npm run perf` → tiempos de la API en local.
- Preparar: `npm install && npm run test:deps`, `npx supabase start`, `npm run mocks`, `npx wrangler dev --port 8888`.
- Detalle en `tests/README.md`. Ninguna prueba toca producción.

Relacionado: [[wrangler-dev-sin-ai]] · [[node-test-carpeta]] · [[simulador-ids-repetidos]]
