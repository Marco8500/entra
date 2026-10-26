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

## 3. La IA (Gemini gratis, o Claude)
Entra funciona con **Google Gemini** (tiene plan gratuito) o con **Claude** (de pago). Se elige con variables de entorno, sin tocar código.

**Gemini (por defecto):**
1. Entra en [aistudio.google.com/apikey](https://aistudio.google.com/apikey) con tu cuenta de Google → **Create API key**. No pide tarjeta.
2. En Netlify pon `GEMINI_API_KEY` con esa clave.
3. Modelos: `IA_MODELO` (lee apuntes y crea exámenes, por defecto `gemini-3.5-flash`) e `IA_MODELO_RAPIDO` (corrige y repasa, por defecto `gemini-3.5-flash-lite`). Cámbialos si Google retira alguno. `IA_RAZONAMIENTO` (por defecto `low`) equilibra calidad y rapidez. Si un modelo está agotado o saturado, Entra pasa solo a los de reserva (cada uno tiene su propio cupo gratuito); se cambian con `IA_RESERVA` e `IA_RESERVA_RAPIDO` (separados por comas). Si se agotan todos, la app avisa de que la IA gratuita de hoy se ha acabado.
4. ⚠️ El plan **gratuito** tiene límites por minuto y por día (en algunos modelos, solo 20 peticiones al día; un examen 39+5 usa 4), y según las [condiciones de Gemini API](https://ai.google.dev/gemini-api/terms) para ofrecer la app a usuarios de la UE hay que usar el plan de pago. Vale para probar; antes de abrir al público, activa la facturación en Google AI Studio (o cambia a Claude).

**Claude:** pon `IA_PROVEEDOR=anthropic` y `ANTHROPIC_API_KEY` (de [console.anthropic.com](https://console.anthropic.com), con límite de gasto). Modelos por defecto: `claude-sonnet-5-5` y `claude-haiku-5-5` (cámbialos con `IA_MODELO` / `IA_MODELO_RAPIDO`).

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

## 5. Netlify (la web)
1. Edita `public/assets/config.js` con tu `SUPABASE_URL`, `SUPABASE_ANON_KEY`, precio y email de contacto.
2. Sube la carpeta a un repositorio de GitHub y en Netlify: **Add new site → Import from Git** (recomendado, para que instale las dependencias). Build command: vacío. Publish directory: `public` (ya viene en `netlify.toml`).
3. **Site configuration → Environment variables**:

| Variable | Valor |
|---|---|
| `SUPABASE_URL` | URL del proyecto |
| `SUPABASE_SERVICE_ROLE_KEY` | clave service_role |
| `GEMINI_API_KEY` | API key de Gemini (o `ANTHROPIC_API_KEY` + `IA_PROVEEDOR=anthropic`) |
| `STRIPE_SECRET_KEY` | `sk_...` |
| `STRIPE_PRICE_ID` | `price_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |

4. **Deploys → Trigger deploy** para que coja las variables.
5. **Domain management**: conecta tu dominio.

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
- Las respuestas de la IA viajan en *streaming* (las funciones de Netlify en streaming pueden durar hasta 60 s).
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
netlify dev                     # en otra terminal: http://localhost:8888/app
```
- Los emails del enlace mágico **no salen a Internet**: ábrelos en Mailpit, http://127.0.0.1:54324.
- `public/assets/config.js` usa automáticamente las claves locales cuando la web se abre en `localhost`.
- En la página de pago simulada usa `4242424242424242`; cualquier otra tarjeta se rechaza.
- `GEMINI_API_URL`, `ANTHROPIC_API_URL` y `STRIPE_API_URL` solo existen para apuntar a los simuladores. **No los pongas en Netlify.**
- Para probar en local con tus cuentas reales de prueba: pon en `.env` tus claves, borra esas dos variables y usa
  `stripe listen --forward-to localhost:8888/api/stripe-webhook` (Stripe CLI) para recibir los webhooks; el `whsec_...` que muestra va en `STRIPE_WEBHOOK_SECRET`.
- Si cambias `supabase/schema.sql`, copia el cambio también en `supabase/migrations/` (es el mismo SQL) y ejecuta `supabase db reset`.
