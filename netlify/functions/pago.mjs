// POST /api/pago · crea la sesión de Stripe Checkout (suscripción Pro) o abre el portal de facturación
// body: { accion: "suscribir" | "pase" | "portal", embebido: bool } · "pase" = 7 días de Pro con pago único
// Con embebido=true devuelve { clientSecret } para mostrar el formulario de pago dentro de la web.
import { env, admin, clavePublicaStripe, precioStripe, stripeClient, error, json } from "../lib/entra.mjs";

export default async (req) => {
  if (req.method !== "POST") return error("metodo", "Usa POST.", 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const db = admin();
  const { data } = await db.auth.getUser(token);
  const user = data?.user;
  if (!user) return error("no_auth", "Inicia sesión para continuar.", 401);

  const stripe = stripeClient();
  const base = env("URL") || new URL(req.url).origin; // Netlify define URL con el dominio del sitio
  const { accion, embebido } = await req.json().catch(() => ({}));
  const { data: perfil } = await db.from("perfiles").select("stripe_customer_id, plan").eq("id", user.id).maybeSingle();

  if (accion === "portal") {
    if (!perfil?.stripe_customer_id) return error("sin_cliente", "Todavía no tienes suscripción.");
    const s = await stripe.billingPortal.sessions.create({ customer: perfil.stripe_customer_id, return_url: `${base}/app` });
    return json({ url: s.url });
  }

  if (accion !== "suscribir" && accion !== "pase") return error("accion", "Acción no válida.");
  if (perfil?.plan === "pro") return error("ya_pro", "Ya tienes Entra Pro.");
  if (!user.email) return error("necesita_email", "Tu cuenta no tiene email. Escríbenos.", 403);

  // El cliente de Stripe se crea con el email de la cuenta, así Checkout no lo vuelve a pedir
  let customer = perfil?.stripe_customer_id;
  if (!customer) {
    customer = (await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } })).id;
    await db.from("perfiles").update({ stripe_customer_id: customer }).eq("id", user.id);
  }
  const pase = accion === "pase";
  const comun = {
    mode: pase ? "payment" : "subscription",
    line_items: [{ price: precioStripe(pase ? "STRIPE_PRICE_PASE" : "STRIPE_PRICE_ID"), quantity: 1 }],
    client_reference_id: user.id,
    customer,
    customer_update: { name: "auto", address: "auto" },
    billing_address_collection: "required",
    allow_promotion_codes: true,
    locale: "es",
    metadata: { user_id: user.id, tipo: pase ? "pase" : "suscripcion" },
    ...(pase ? { payment_intent_data: { metadata: { user_id: user.id, tipo: "pase" } } } : { subscription_data: { metadata: { user_id: user.id } } }),
  };
  const extra = embebido ? { ui_mode: "embedded", return_url: `${base}/app?pago=ok` } : { success_url: `${base}/app?pago=ok`, cancel_url: `${base}/app?pago=cancelado` };
  let s;
  try { s = await stripe.checkout.sessions.create({ ...comun, ...extra }) }
  catch (e) {
    // Cliente guardado de otro modo (prueba ↔ real): se crea uno nuevo y se reintenta
    if (e?.code !== "resource_missing" || e?.param !== "customer") throw e;
    comun.customer = (await stripe.customers.create({ email: user.email, metadata: { user_id: user.id } })).id;
    await db.from("perfiles").update({ stripe_customer_id: comun.customer }).eq("id", user.id);
    s = await stripe.checkout.sessions.create({ ...comun, ...extra });
  }
  return json(embebido ? { clientSecret: s.client_secret, publishableKey: clavePublicaStripe() } : { url: s.url });
};

export const config = { path: "/api/pago" };
