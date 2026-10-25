// POST /api/borrar · borra la cuenta y todos sus datos (apuntes, simulacros, uso, perfil)
import { admin, stripeClient, error, json } from "../lib/entra.mjs";

export default async (req) => {
  if (req.method !== "POST") return error("metodo", "Usa POST.", 405);
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const db = admin();
  const { data } = await db.auth.getUser(token);
  const user = data?.user;
  if (!user) return error("no_auth", "Inicia sesión para continuar.", 401);

  // Cancela la suscripción si la hay, para no seguir cobrando
  const { data: perfil } = await db.from("perfiles").select("stripe_customer_id").eq("id", user.id).maybeSingle();
  if (perfil?.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const stripe = stripeClient();
      const subs = await stripe.subscriptions.list({ customer: perfil.stripe_customer_id, status: "all", limit: 10 });
      for (const s of subs.data) if (!["canceled", "incomplete_expired"].includes(s.status)) await stripe.subscriptions.cancel(s.id);
    } catch (e) { console.error("stripe cancel", e) }
  }
  const { error: e } = await db.auth.admin.deleteUser(user.id); // las tablas se borran en cascada
  if (e) return error("borrar", "No se ha podido borrar la cuenta. Escríbenos.", 500);
  return json({ ok: true });
};

export const config = { path: "/api/borrar" };
