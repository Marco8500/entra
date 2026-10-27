# Entra ✱ · Guía de lanzamiento

Web de simulacros de examen con tus apuntes. Estructura:

```
public/              → web (landing, app, privacidad, términos)
  assets/config.js   → ⚠️ aquí pones tus claves PÚBLICAS de Supabase y el precio
netlify/functions/   → servidor: IA, pagos, cuenta, borrado
netlify/lib/         → código compartido y LÍMITES de cada plan
supabase/schema.sql  → base de datos (se pega una vez en Supabase)
```

Tiempo estimado: 1-2 horas la primera vez. Hazlo en este orden.

---

## 1. Dominio
Compra el dominio (por ejemplo `entra.app`, `entraexamen.com` o `usaentra.com`). Lo conectarás a Netlify en el paso 5.

## 2. Supabase (base de datos y login)
1. Crea un proyecto en [supabase.com](https://supabase.com). Región: **Frankfurt / EU Central** (datos en Europa).
2. **SQL Editor → New query** → pega todo `supabase/schema.sql` → **Run**.
3. **Project Settings → API** → copia:
   - `Project URL` → va en `config.js` **y** en Netlify como `SUPABASE_URL`
   - `anon public` → va en `config.js`
   - `service_role` → **solo** en Netlify como `SUPABASE_SERVICE_ROLE_KEY` (nunca en la web)
4. **Authentication → URL Configuration**:
   - Site URL: `https://tudominio.com`
   - Redirect URLs: `https://tudominio.com/app` y `https://*.netlify.app/app`
5. **Authentication → Email**: el email por defecto de Supabase tiene un límite bajo de envíos. Antes de lanzar, configura **SMTP propio** (Resend, Brevo…) en *Authentication → SMTP Settings*, y traduce la plantilla del email a español en *Email Templates*.
6. **Registro sin emails:** en *Authentication → Sign In / Providers → Email* desactiva **"Confirm email"**. Así la cuenta (email + contraseña) se crea al momento y no hace falta enviar ningún correo. Solo se envía email si alguien pulsa "He olvidado mi contraseña": el correo por defecto de Supabase solo llega a los miembros de tu equipo, así que antes de abrir al público configura SMTP propio en *Authentication → Emails → SMTP Settings* (gratis: Gmail con una contraseña de aplicación; con dominio: Resend).
7. (Opcional) **Login con Google:** crea un "ID de cliente de OAuth" (aplicación web) en [Google Cloud Console](https://console.cloud.google.com/apis/credentials) con la URI de redirección `https://TU-PROYECTO.supabase.co/auth/v1/callback`, pega el ID y el secreto en *Authentication → Sign In / Providers → Google* y pon `GOOGLE: true` en `public/assets/config.js` para que aparezca el botón.

## 3. La IA (cadena de IAs gratuitas)
Entra no depende de una sola IA: prueba los proveedores en orden y, si uno está saturado, sin cupo o tarda más de 25 s, pasa al siguiente al momento (y lo salta durante 1 minuto). Solo se usan los que tengan clave. Orden por defecto (`IA_ORDEN`): `mistral,groq,groqVision,gemini,cloudflare,anthropic`.

| Proveedor | Variable | Dónde sacar la clave | Notas |
|---|---|---|---|
| Mistral | `MISTRAL_API_KEY` | [console.mistral.ai](https://console.mistral.ai) → API Keys (plan gratuito, verifica el móvil, sin tarjeta) | Lee fotos y texto. Modelos: `MISTRAL_MODELOS`, `MISTRAL_MODELOS_RAPIDO`. En el plan gratuito Mistral puede usar los datos para entrenar. |
| Groq | `GROQ_API_KEY` | [console.groq.com/keys](https://console.groq.com/keys) (sin tarjeta) | Muy rápida. Texto con `openai/gpt-oss-120b`; fotos con `GROQ_MODELOS_VISION` si el modelo sigue gratis. |
| Gemini | `GEMINI_API_KEY` | [aistudio.google.com/apikey](https://aistudio.google.com/apikey) | Lee fotos y texto. Se satura a menudo en el plan gratis. Modelos: `GEMINI_MODELOS`, `GEMINI_MODELOS_RAPIDO`. |
| Cloudflare Workers AI | (ninguna) | Va con el enlace `AI` de `wrangler.toml` | Último recurso: 10.000 "neuronas" gratis al día. Modelos: `CF_MODELOS`. |
| Claude (de pago) | `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Opcional, con límite de gasto. |

Si todos fallan, la app espera y reintenta sola con una cuenta atrás. ⚠️ Los planes gratuitos tienen límites y condiciones que cambian; revísalos antes de abrir al público.

## 4. Stripe (pagos)
1. Crea cuenta en [stripe.com](https://stripe.com) y empieza en **modo prueba**.
2. **Productos → Añadir producto**: "Entra Pro", precio recurrente mensual (p. ej. 3,99 €). Copia el **ID del precio** (`price_...`) → `STRIPE_PRICE_ID`.
3. **Desarrolladores → Claves de API**: copia la clave secreta (`sk_...`) → `STRIPE_SECRET_KEY`, y la **clave publicable** (`pk_...`) → `STRIPE_PUBLISHABLE_KEY` en `config.js`. Con la publicable, el pago se hace dentro de la web (Checkout integrado) y no se vuelve a pedir el email; sin ella, se usa la página de pago de Stripe.
4. **Desarrolladores → Webhooks → Añadir endpoint**:
   - URL: `https://tudominio.com/api/stripe-webhook`
   - Eventos: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Copia el **secreto de firma** (`whsec_...`) → `STRIPE_WEBHOOK_SECRET`
5. **Configuración → Portal de clientes**: actívalo (permite cancelar la suscripción).
6. Prueba con la tarjeta `4242 4242 4242 4242`. Cuando todo funcione, repite los pasos 2-4 en **modo real**.

## 5. Cloudflare Workers (la web)
1. Edita `public/assets/config.js` con tu `SUPABASE_URL`, `SUPABASE_ANON_KEY`, precio y email de contacto.
2. En [dash.cloudflare.com](https://dash.cloudflare.com): **Workers & Pages → Create → Import a repository** → elige el repositorio. Cloudflare usa `wrangler.toml`: la web sale de `public/` y la API de `worker.js` (`/api/*`). Deploy command: `npx wrangler deploy` (el de por defecto).
3. En el Worker → **Settings → Variables and Secrets** (todas como *Secret* salvo `STRIPE_PRICE_ID`):

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | URL del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | clave service_role |
| `MISTRAL_API_KEY`, `GROQ_API_KEY`, `GEMINI_API_KEY` | claves de IA (ver punto 3) |
| `STRIPE_SECRET_KEY` | `sk_...` |
| `STRIPE_PRICE_ID` | `price_...` (suscripción mensual) |
| `STRIPE_PRICE_PASE` | `price_...` (pase de examen, pago único de 7 días) |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |
| `MAKE_CHAT_URL` | webhook del chatbot de Make |

4. Cada `git push` a `main` publica solo (los secretos se mantienen entre publicaciones).
5. Cuando tengas la dirección (`https://entra.<tu-subdominio>.workers.dev` o tu dominio), ponla en Supabase (**Authentication → URL Configuration**: Site URL y Redirect URLs `.../app`), en el webhook de Stripe (`.../api/stripe-webhook`) y en el portal de clientes de Stripe.

Las funciones siguen en `netlify/functions` (formato estándar Request → Response), así que también se puede publicar en Netlify con `netlify.toml`.

## 6. Antes de abrirlo al público
- [ ] Rellena los `[corchetes]` de `privacidad.html` y `terminos.html` y **revísalos con un profesional** (son una plantilla).
- [ ] Si cobras, date de alta como autónomo o usa tu sociedad, y activa la facturación con IVA en Stripe (Stripe Tax o facturas automáticas).
- [ ] Haz un recorrido completo en modo prueba: registro → leer fotos → examen 39+5 → corrección → repaso → PDF → pagar → cancelar → borrar cuenta.
- [ ] IA: plan de pago de Gemini (obligatorio para usuarios de la UE) o Claude con límite de gasto.

---

## Ajustes rápidos
- **Límites de cada plan**: `netlify/lib/entra.mjs` → `LIMITES` (simulacros, páginas y bloques al mes). Cambia también los textos de `index.html` (sección Precios).
- **Precio mostrado**: `public/assets/config.js` → `PRECIO_PRO`.
- **Colores y tipografía**: `public/assets/style.css` (variables al principio).

## Cómo funciona por dentro
- Las fotos se reducen en el móvil (máx. 1568 px) y se envían de 4 en 4 a `/api/leer`. **No se guardan**: solo se guarda el texto de los temas.
- Los exámenes largos se piden en bloques de ~13 preguntas en paralelo a `/api/examen`, para que cada llamada termine rápido.
- Las respuestas de la IA viajan en *streaming* y el servidor manda un espacio cada 8 s mientras la IA piensa, para que la conexión no se corte.
- Cada usuario solo puede leer sus propios datos (políticas RLS en Supabase). El plan y el uso solo los cambia el servidor.

## Desarrollo en local
Todo funciona en tu ordenador sin cuentas reales: Supabase local (Docker) y simuladores de Stripe y de Claude.

Necesitas Node 20+ y Docker en marcha.
```bash
npm install
npm i -g netlify-cli supabase
cp .env.local.example .env      # variables para local (no se sube a Git)
supabase start                  # base de datos + login; aplica supabase/migrations
npm run mocks                   # en otra terminal: Claude simulado (:4010) y Stripe simulado (:4020)
cp .env .dev.vars && npx wrangler dev --port 8888   # en otra terminal: http://localhost:8888/app
# (o, con Netlify: netlify dev)
```
- Los emails del enlace mágico **no salen a Internet**: ábrelos en Mailpit, http://127.0.0.1:54324.
- `public/assets/config.js` usa automáticamente las claves locales cuando la web se abre en `localhost`.
- En la página de pago simulada usa `4242424242424242`; cualquier otra tarjeta se rechaza.
- `MISTRAL_API_URL`, `GROQ_API_URL`, `GEMINI_API_URL`, `ANTHROPIC_API_URL` y `STRIPE_API_URL` solo existen para apuntar a los simuladores. **No los pongas en producción.**
- Para probar en local con tus cuentas reales de prueba: pon en `.env` tus claves, borra esas dos variables y usa
  `stripe listen --forward-to localhost:8888/api/stripe-webhook` (Stripe CLI) para recibir los webhooks; el `whsec_...` que muestra va en `STRIPE_WEBHOOK_SECRET`.
- Si cambias `supabase/schema.sql`, copia el cambio también en `supabase/migrations/` (es el mismo SQL) y ejecuta `supabase db reset`.
