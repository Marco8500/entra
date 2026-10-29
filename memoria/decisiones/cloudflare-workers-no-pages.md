---
tipo: decision
fecha: 2026-10-26
commit: d3252cd
---
# cloudflare workers no pages

La web se publica como **Cloudflare Worker con assets estáticos**, no como Pages.

- El proyecto se creó en Cloudflare como Worker conectado a GitHub y la compilación de Pages fallaba.
- `worker.js` sirve `public/` (enlace `ASSETS`) y enruta `/api/*` a `netlify/functions/*.mjs`.
- Cada push a `main` despliega solo (Workers Builds). Los secretos van en Workers → entra → Settings → Variables and Secrets.
- Las funciones siguen en formato Request → Response, así que Netlify (`netlify.toml`) sigue siendo un plan B.

Relacionado: [[netlify-504-latido]] · [[wrangler-dev-sin-ai]] · [[cadena-de-ias-gratuitas]]
