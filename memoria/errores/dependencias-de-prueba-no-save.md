---
tipo: error
fecha: 2026-10-29
commit: 1624487
---
# dependencias de prueba no save

Meter pdf.js como devDependency hacía que el build de Cloudflare intentase compilar `canvas` (módulo nativo) y fallase.
**Solución**: las dependencias de prueba se instalan con `npm run test:deps` (`--no-save`). No añadirlas a `package.json`.

Relacionado: [[pruebas]] · [[sin-framework]]
