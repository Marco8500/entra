---
tipo: decision
fecha: 2026-10-27
commit: 3cdcc90
---
# stripe modo por clave

El modo de Stripe lo decide la clave secreta: con `sk_live_...` se usan solos `STRIPE_PRICE_ID_LIVE`, `STRIPE_PRICE_PASE_LIVE` y `STRIPE_PK_LIVE` de `wrangler.toml`.
Para pasar a cobrar de verdad basta con cambiar `STRIPE_SECRET_KEY` y `STRIPE_WEBHOOK_SECRET` en Cloudflare.

Relacionado: [[cliente-stripe-de-otro-modo]] · [[pase-de-examen]]
