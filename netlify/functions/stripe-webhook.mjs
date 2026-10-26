// POST /api/stripe-webhook · Stripe avisa de altas, cambios y bajas de la suscripción
import { env, admin, stripeClient } from "../lib/entra.mjs";

export default async (req) => {
  const stripe = stripeClient();
  const firma = req.headers.get("stripe-signature");
  const raw = await req.text();
  let evt;
  try {
    evt = await stripe.webhooks.constructEventAsync(raw, firma, env("STRIPE_WEBHOOK_SECRET"));
  } catch (e) {
    return new Response("Firma no válida", { status: 400 });
  }
  const db = admin();

  if (evt.type === "checkout.session.completed") {
    const s = evt.data.object;
    const userId = s.client_reference_id || s.metadata?.user_id;
    if (userId) await db.from("perfiles").update({ plan: "pro", stripe_customer_id: s.customer }).eq("id", userId);
  }

  if (evt.type === "customer.subscription.updated" || evt.type === "customer.subscription.deleted") {
    const sub = evt.data.object;
    const activo = evt.type === "customer.subscription.updated" && ["active", "trialing", "past_due"].includes(sub.status);
    await db.from("perfiles").update({ plan: activo ? "pro" : "free" }).eq("stripe_customer_id", sub.customer);
  }

  return new Response("ok");
};

export const config = { path: "/api/stripe-webhook" };
