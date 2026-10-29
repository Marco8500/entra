---
tipo: decision
fecha: 2026-10-29
commit: 327ad11
---
# pdf se lee en el navegador

Los PDF con texto se leen en el navegador con pdf.js y solo se manda el texto (más rápido y barato que imágenes).

- **Modo índice**: el texto va con líneas numeradas y la IA solo devuelve dónde empieza cada tema (máx. 2000 tokens); el contenido se corta del original, sin resumir ni inventar.
- 4 lotes en paralelo. Lotes de texto de hasta 12.000 caracteres sin partir líneas.
- Las páginas escaneadas (sin texto) se convierten en imagen y van por visión: máximo 15 imágenes por subida; PDF con texto hasta 60 páginas.
- Las fotos **no se guardan**, solo el texto de los temas.

Relacionado: [[texto-pegado-se-cortaba]] · [[pdfjs-cve-2024-4367]] · [[lote-fallido-cancelaba-todo]]
