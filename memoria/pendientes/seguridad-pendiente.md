---
tipo: pendiente
fecha: 2026-10-29
---
# seguridad pendiente

- [ ] Supabase → Authentication → Password security: activar **Leaked password protection**.
- [ ] Regla de rate limiting de Cloudflare sobre `/api/*` (crear cuentas es gratis y los límites son por cuenta).
- [ ] SRI (`integrity`) en los scripts de CDN o servirlos desde `public/`.
- [ ] Actualizar supabase-js (v2), jsPDF 4 y pdf.js 4 y repetir `npm run test:e2e`.
- [ ] Las notas del ranking las calcula el navegador: corregir y guardar en el servidor.

Relacionado: [[pdfjs-cve-2024-4367]] · [[antes-de-abrir-al-publico]]
