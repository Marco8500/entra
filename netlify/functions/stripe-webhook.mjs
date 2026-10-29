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
  // Si la base de datos falla devolvemos 500: Stripe reintenta el aviso (hasta 3 días) y nadie se queda sin su Pro pagado
  const fallo = (r) => {
    if (r?.error) throw new Error(r.error.message);
    return r;
  };

  try {
    if (evt.type === "checkout.session.completed") {
      const s = evt.data.object;
      const userId = s.client_reference_id || s.metadata?.user_id;
      if (userId && s.mode === "payment" && s.metadata?.tipo === "pase") {
        // Pase de examen: 7 días de Pro (activar_pase no lo suma dos veces si Stripe repite el aviso)
        if (s.payment_status === "paid") fallo(await db.rpc("activar_pase", { p_user: userId, p_session: s.id, p_dias: 7 }));
      } else if (userId) fallo(await db.from("perfiles").update({ plan: "pro", stripe_customer_id: s.customer }).eq("id", userId));
    }

    if (evt.type === "customer.subscription.updated" || evt.type === "customer.subscription.deleted") {
      const sub = evt.data.object;
      const activo = evt.type === "customer.subscription.updated" && ["active", "trialing", "past_due"].includes(sub.status);
      fallo(await db.from("perfiles").update({ plan: activo ? "pro" : "free" }).eq("stripe_customer_id", sub.customer));
    }
  } catch (e) {
    console.error("stripe-webhook", evt.type, evt.id, e.message);
    return new Response("Error guardando el pago", { status: 500 });
  }

  return new Response("ok");
};

export const config = { path: "/api/stripe-webhook" };
