// Concurrencia: Stripe repite el mismo aviso varias veces a la vez → el pase se suma una sola vez (7 días, no 35).
// Va contra el entorno local (wrangler dev + Supabase local); no usa el navegador.
const fs = require("fs");
const Stripe = require("stripe");
const PROJ = require("path").resolve(__dirname, "../.."), S = "http://127.0.0.1:54321", APP = "http://localhost:8888";
const vars = fs.readFileSync(PROJ + "/.dev.vars", "utf8");
const K = vars.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim(), SECRET = vars.match(/STRIPE_WEBHOOK_SECRET=(.+)/)[1].trim();
const H = { apikey: K, authorization: `Bearer ${K}`, "content-type": "application/json" };
(async () => {
  const u = await (await fetch(`${S}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email: `doble${Date.now()}@test.local`, password: "MiClave2026", email_confirm: true }) })).json();
  const sesion = `cs_test_doble_${Date.now()}`;
  const payload = JSON.stringify({ id: "evt_doble_" + Date.now(), object: "event", type: "checkout.session.completed",
    data: { object: { id: sesion, object: "checkout.session", mode: "payment", payment_status: "paid", client_reference_id: u.id, metadata: { user_id: u.id, tipo: "pase" } } } });
  const firma = new Stripe("sk_test_x").webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const res = await Promise.all(Array.from({ length: 5 }, () => fetch(APP + "/api/stripe-webhook", { method: "POST", headers: { "stripe-signature": firma }, body: payload }).then((r) => r.status)));
  const p = (await (await fetch(`${S}/rest/v1/perfiles?id=eq.${u.id}&select=pro_hasta`, { headers: H })).json())[0];
  const pases = await (await fetch(`${S}/rest/v1/pases?session_id=eq.${sesion}&select=session_id`, { headers: H })).json();
  const dias = (new Date(p.pro_hasta) - Date.now()) / 864e5;
  console.log(`respuestas: ${res.join(",")} · pases guardados: ${pases.length} · días de Pro: ${dias.toFixed(2)}`);
  if (res.some((s) => s !== 200) || pases.length !== 1 || dias > 7.01 || dias < 6.99) { console.error("✘ el pase no es idempotente"); process.exit(1) }
  console.log("✔ 5 avisos simultáneos → un solo pase de 7 días");
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
