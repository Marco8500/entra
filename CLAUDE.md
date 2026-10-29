# Entra ✱

Web de simulacros de examen a partir de los apuntes del alumno (fotos, PDF o texto). Público: estudiantes en España. Gratis con límites, Pro 3,99 €/mes o pase de examen de 7 días por 1,99 €.

Producción: Cloudflare Worker `entra` (`entraia.workers.dev`). Cada push a `main` despliega solo.

Sesiones principales: **Entra AI** (código) e **Instagram ENTRA** (contenido de redes). Ver `memoria/entorno/sesiones-principales.md`.

## Memoria (leer antes de empezar)

Las sesiones en la nube empiezan de cero: lo único que se recuerda entre sesiones es lo que está en git. La memoria del proyecto está en [`memoria/`](memoria/README.md).

1. **Al empezar una tarea**: lee `memoria/README.md` y busca en `memoria/` las palabras de la tarea (`grep -ril "stripe" memoria/`). Si una nota dice que algo ya falló o se decidió de otra forma, síguela o explica por qué no.
2. **Al terminar**: si has resuelto un error, tomado una decisión o aprendido algo que la siguiente sesión debería saber, crea una nota con `memoria/_plantilla.md`:
   - una lección por nota, título corto en minúsculas que diga la lección (`gemini-cupo-diario`);
   - en `decisiones/`, `errores/`, `entorno/` o `pendientes/`;
   - con `Relacionado: [[otra-nota]]` hacia las notas que toca;
   - y una línea en `memoria/README.md`.
3. Si una nota se queda vieja, corrígela en vez de añadir otra que la contradiga. Marca los pendientes hechos.
4. Nunca escribas claves secretas en las notas.

## Mapa

```
public/               web sin compilación: index.html, app.html, assets/app.js (toda la app), style.css
public/assets/config.js  claves PÚBLICAS de Supabase, Stripe y precios
worker.js             Cloudflare: sirve public/ y enruta /api/* a netlify/functions
netlify/functions/    API: leer, examen, corregir, repaso, chat, pago, stripe-webhook, cuenta, borrar, ranking
netlify/lib/entra.mjs autenticación, LIMITES por plan, cadena de IAs (streamIA), Stripe
supabase/             schema.sql + migrations/ (RLS en todas las tablas)
dev/mocks.mjs         IA, Stripe y Make simulados para local
tests/                unitarias, e2e Playwright y rendimiento (ver tests/README.md)
```

## Comandos

```sh
npm run test:unit                 # rápidas, sin red
npm run test:e2e                  # necesita Supabase local, npm run mocks y wrangler dev (tests/README.md)
node --check public/assets/app.js # sintaxis de la app
npx wrangler deploy --dry-run     # que el build de Cloudflare compila
```

## Reglas

- Todo en español: textos de la web, mensajes de error, commits y notas.
- Los commits explican qué cambia para el alumno, con una lista de detalles debajo.
- Toda llamada a Supabase comprueba su `error`. Nunca tapar un error real con "IA saturada".
- Cambios de base de datos: migración nueva en `supabase/migrations/` y el mismo cambio en `supabase/schema.sql`. Preferir cambios aditivos.
- No añadir dependencias ni frameworks sin necesidad. Las de prueba van con `npm run test:deps` (`--no-save`).
- Secretos solo en Cloudflare (Variables and Secrets) o `.dev.vars`; nunca en el repo.
- Desde el contenedor no se llega a Cloudflare, las IAs, Stripe real ni Make: lo que no se haya podido probar de verdad, se dice.
