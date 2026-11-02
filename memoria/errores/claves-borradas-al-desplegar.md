---
tipo: error
fecha: 2026-11-02
commit: (este)
---
# claves borradas al desplegar

**Síntoma**: "siempre falla". En producción `ia_errores` solo tenía filas de `cloudflare` (30 de 33 fallidas, JSON roto de llama-4-scout); Groq y Gemini no aparecían nunca.
**Causa**: `wrangler deploy` (cada push a main con Workers Builds) borra las variables del panel de tipo "Text" y solo respeta las de tipo "Secret". Las claves de Groq y Gemini dejaron de existir para el Worker.
**Solución**: `keep_vars = true` en `wrangler.toml`; `/api/estado` dice qué claves faltan (sin mostrarlas); Workers AI usa gpt-oss-120b y llama-3.3-70b para texto, y llama-4-scout solo para fotos.
**Además**: en el panel estaban como `GROK_KEY` y `Gemini_API_Key` (los nombres distinguen mayúsculas). `clave()` en `entra.mjs` acepta esos alias.
**Regla**: las claves van siempre como **Secret** en Cloudflare. Tras cada despliegue, abrir `https://entra.entraia.workers.dev/api/estado` y comprobar que `faltan` está vacío.

Relacionado: [[cadena-de-ias-gratuitas]] · [[cloudflare-workers-no-pages]]
