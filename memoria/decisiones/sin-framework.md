---
tipo: decision
fecha: 2026-10-25
commit: 798e11a
---
# sin framework

El frontend es HTML + CSS + JS sin compilación (`public/assets/app.js` de una pieza). supabase-js, pdf.js 3.11.174 y jsPDF 2.5.1 vienen de CDN con versión fijada.
jsPDF solo se descarga al pulsar "Descargar PDF de repaso". No hay lint ni TypeScript a propósito: no meter dependencias sin necesidad.

Relacionado: [[dependencias-de-prueba-no-save]]
