// POST /api/pago · crea la sesión de Stripe Checkout (suscripción Pro) o abre el portal de facturación
// body: { accion: "suscribir" | "portal" }
import Stripe from "stripe";
import { admin, error, json } from "../lib/entra.mjs";

export default async (req) => {
  if (req.method !== "POST") return error("metodo", "Usa POST.", 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const db = admin();
  const { data } = await db.auth.getUser(token);
  const user = data?.user;
  if (!user) return error("no_auth", "Inicia sesión para continuar.", 401);

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const base = process.env.URL || new URL(req.url).origin; // Netlify define URL con el dominio del sitio
  const { accion } = await req.json().catch(() => ({}));
  const { data: perfil } = await db.from("perfiles").select("stripe_customer_id, plan").eq("id", user.id).maybeSingle();

  if (accion === "portal") {
    if (!perfil?.stripe_customer_id) return error("sin_cliente", "Todavía no tienes suscripción.");
    const s = await stripe.billingPortal.sessions.create({ customer: perfil.stripe_customer_id, return_url: `${base}/app` });
    return json({ url: s.url });
  }

  if (perfil?.plan === "pro") return error("ya_pro", "Ya tienes Entra Pro.");
  const s = await stripe.checkout.sessions.create({
    mode: "subscription",
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    client_reference_id: user.id,
    customer: perfil?.stripe_customer_id || undefined,
    customer_email: perfil?.stripe_customer_id ? undefined : user.email,
    allow_promotion_codes: true,
    locale: "es",
    success_url: `${base}/app?pago=ok`,
    cancel_url: `${base}/app?pago=cancelado`,
    metadata: { user_id: user.id },
    subscription_data: { metadata: { user_id: user.id } },
  });
  return json({ url: s.url });
};

export const config = { path: "/api/pago" };
