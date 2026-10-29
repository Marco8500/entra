// Cloudflare Workers: sirve la web estática (public/, enlace ASSETS) y la API /api/*.
// Las funciones viven en netlify/functions (formato Request → Response).
import borrar from "./netlify/functions/borrar.mjs";
import chat from "./netlify/functions/chat.mjs";
import corregir from "./netlify/functions/corregir.mjs";
import cuenta from "./netlify/functions/cuenta.mjs";
import examen from "./netlify/functions/examen.mjs";
import leer from "./netlify/functions/leer.mjs";
import pago from "./netlify/functions/pago.mjs";
import ranking from "./netlify/functions/ranking.mjs";
import repaso from "./netlify/functions/repaso.mjs";
import stripeWebhook from "./netlify/functions/stripe-webhook.mjs";
import { peticion } from "./netlify/lib/entra.mjs";

const API = {
  "/api/borrar": borrar, "/api/chat": chat, "/api/corregir": corregir, "/api/cuenta": cuenta,
  "/api/examen": examen, "/api/leer": leer, "/api/pago": pago, "/api/ranking": ranking, "/api/repaso": repaso,
  "/api/stripe-webhook": stripeWebhook,
};

export default {
  async fetch(req, env, ctx) {
    const handler = API[new URL(req.url).pathname];
    if (!handler) return env.ASSETS.fetch(req);
    globalThis.__ENTRA_ENV = env;
    globalThis.__ENTRA_AI = env.AI;
    try { return await peticion.run(ctx, () => handler(req, ctx)) }
    catch (e) {
      console.error(req.url, e?.stack || e);
      return new Response(JSON.stringify({ error: "servidor", mensaje: "Algo ha fallado en el servidor. Vuelve a intentarlo." }), { status: 500, headers: { "content-type": "application/json" } });
    }
  },
};
