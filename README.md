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
6. (Opcional) Login con Google: *Authentication → Providers → Google*. Si no lo configuras, quita el botón "Continuar con Google" de `public/assets/app.js`.

## 3. API de Claude (la IA)
1. Crea una cuenta en [console.anthropic.com](https://console.anthropic.com), añade saldo y crea una **API key**.
2. Pon un **límite de gasto mensual** en la consola (Settings → Limits) para no llevarte sustos.
3. Modelos que usa (cámbialos con variables de entorno si quieres):
   - `ANTHROPIC_MODEL` (lee apuntes y crea exámenes) → por defecto `claude-sonnet-5-5`
   - `ANTHROPIC_MODEL_FAST` (corrige y hace repasos) → por defecto `claude-haiku-5-5`
   Mira precios actualizados en la web de Anthropic y calcula: un examen 39+5 son 4 llamadas de generación + 1 de corrección.

## 4. Stripe (pagos)
1. Crea cuenta en [stripe.com](https://stripe.com) y empieza en **modo prueba**.
2. **Productos → Añadir producto**: "Entra Pro", precio recurrente mensual (p. ej. 3,99 €). Copia el **ID del precio** (`price_...`) → `STRIPE_PRICE_ID`.
3. **Desarrolladores → Claves de API**: copia la clave secreta (`sk_...`) → `STRIPE_SECRET_KEY`.
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
| `ANTHROPIC_API_KEY` | API key de Claude |
| `STRIPE_SECRET_KEY` | `sk_...` |
| `STRIPE_PRICE_ID` | `price_...` |
| `STRIPE_WEBHOOK_SECRET` | `whsec_...` |

4. **Deploys → Trigger deploy** para que coja las variables.
5. **Domain management**: conecta tu dominio.

## 6. Antes de abrirlo al público
- [ ] Rellena los `[corchetes]` de `privacidad.html` y `terminos.html` y **revísalos con un profesional** (son una plantilla).
- [ ] Si cobras, date de alta como autónomo o usa tu sociedad, y activa la facturación con IVA en Stripe (Stripe Tax o facturas automáticas).
- [ ] Haz un recorrido completo en modo prueba: registro → leer fotos → examen 39+5 → corrección → repaso → PDF → pagar → cancelar → borrar cuenta.
- [ ] Pon el límite de gasto en Anthropic.

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
```bash
npm install
npx netlify-cli dev   # crea un archivo .env con las variables del paso 5
```
