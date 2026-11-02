// GET /api/estado · qué servicios tienen configuración en el servidor (sí/no) y cómo va la IA en la última hora.
// Nunca devuelve claves ni datos de usuarios: sirve para comprobar de un vistazo que el despliegue tiene sus secretos.
import { admin, clave, env, iasConfiguradas, json, stripeReal } from "../lib/entra.mjs";

export default async () => {
  const hay = (k) => !!env(k);
  let ia = null;
  try {
    const { data } = await admin().from("ia_errores").select("proveedor, ok")
      .gte("creado_at", new Date(Date.now() - 3600_000).toISOString()).limit(2000);
    ia = {};
    for (const r of data || []) {
      ia[r.proveedor] ??= { bien: 0, mal: 0 };
      ia[r.proveedor][r.ok ? "bien" : "mal"]++;
    }
  } catch {}
  const ias = iasConfiguradas();
  return new Response(JSON.stringify({
    ok: hay("SUPABASE_SERVICE_ROLE_KEY") && ias.some((n) => n !== "cloudflare" && n !== "cloudflareVision"),
    ias,
    faltan: ["GROQ_API_KEY", "GEMINI_API_KEY"].filter((k) => !clave(k)),
    supabase: hay("SUPABASE_URL") && hay("SUPABASE_SERVICE_ROLE_KEY"),
    stripe: hay("STRIPE_SECRET_KEY") ? (stripeReal() ? "real" : "prueba") : "sin clave",
    stripeWebhook: hay("STRIPE_WEBHOOK_SECRET"),
    tutorChat: !!clave("MAKE_CHAT_URL"),
    iaUltimaHora: ia,
  }, null, 2), { headers: { "content-type": "application/json", "cache-control": "no-store" } });
};

export const config = { path: "/api/estado" };
