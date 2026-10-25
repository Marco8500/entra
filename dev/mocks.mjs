// Simuladores SOLO para desarrollo local (no se despliegan):
//  - API de Claude en http://localhost:4010  → respuestas en streaming con el mismo formato que Anthropic
//  - API de Stripe  en http://localhost:4020  → clientes, Checkout (página o integrado), portal y suscripciones,
//    webhooks firmados, y un Stripe.js simulado en /stripe.js
// Uso: node dev/mocks.mjs   (lee STRIPE_WEBHOOK_SECRET, WEBHOOK_URL y WEBHOOK_DELAY_MS del entorno)
import http from "node:http";
import Stripe from "stripe";

const SECRET = process.env.STRIPE_WEBHOOK_SECRET || "whsec_local_test";
const WEBHOOK_URL = process.env.WEBHOOK_URL || "http://localhost:8888/api/stripe-webhook";
const RETRASO = +process.env.WEBHOOK_DELAY_MS || 0; // simula que el webhook llega después de volver a la web
const stripe = new Stripe("sk_test_mock");
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const leerBody = (req) => new Promise((r) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => r(b)); });

/* ---------------- Claude ---------------- */
function respuestaIA(prompt, nImgs) {
  if (prompt.includes("lector de apuntes")) {
    return JSON.stringify({
      asignatura: "PRL · Unidades 1 y 2",
      temas: [
        { titulo: "Riesgo laboral", unidad: "UD1", entra: true, contenido: "Riesgo laboral es la posibilidad de que un trabajador sufra un daño derivado del trabajo. Se valora por probabilidad y severidad.", notas: "importante" },
        { titulo: "Equipos de protección individual", unidad: "UD1", entra: true, contenido: "Los EPI protegen al trabajador frente a riesgos. Se usan cuando la protección colectiva no basta. El empresario los entrega gratis.", notas: "test" },
        { titulo: "Ruido", unidad: "UD2", entra: true, contenido: "El ruido continuo se mide con sonómetro; el discontinuo con dosímetro. Nivel inferior de acción 80 dB(A).", notas: "pregunta corta" },
        { titulo: "Historia de la PRL", unidad: "UD2", entra: false, contenido: "Origen de la ley 31/1995.", notas: "" },
      ].concat(nImgs ? [{ titulo: `Foto leída (${nImgs})`, unidad: "UD3", entra: null, contenido: "Contenido leído de las fotos subidas.", notas: "" }] : []),
    });
  }
  if (prompt.includes("prepara simulacros")) {
    const nTest = +(prompt.match(/- (\d+) preguntas tipo test/) || [])[1] || 0;
    const nOpc = +(prompt.match(/cada una con (\d+) opciones/) || [])[1] || 4;
    const nCortas = +(prompt.match(/- (\d+) preguntas de respuesta corta/) || [])[1] || 0;
    const temas = [...prompt.matchAll(/^TEMA \d+: (.+?)(?: \[anotación|$)/gm)].map((m) => m[1]);
    const salt = Math.random().toString(36).slice(2, 6);
    return JSON.stringify({
      test: Array.from({ length: nTest }, (_, i) => ({
        pregunta: `¿Pregunta ${i + 1} (${salt}) sobre ${temas[i % temas.length]}?`,
        opciones: Array.from({ length: nOpc }, (_, j) => `Opción ${"abcde"[j]}`),
        correcta: 0, tema: temas[i % temas.length], explicacion: "La correcta es la a.",
      })),
      cortas: Array.from({ length: nCortas }, (_, i) => ({
        pregunta: `Explica brevemente (${salt}) ${temas[i % temas.length]}.`, tema: temas[i % temas.length],
        respuestaModelo: "Respuesta modelo de ejemplo.", puntosClave: ["dosímetro", "80 dB"],
      })),
    });
  }
  if (prompt.includes("Corrige como un profesor")) {
    const n = (prompt.match(/^#\d+$/gm) || []).length;
    return JSON.stringify(Array.from({ length: n }, (_, i) => ({ i, nota: 6, comentario: "Bien, pero te faltó un dato." })));
  }
  if (prompt.includes("tutor de Entra")) {
    const temas = [...prompt.matchAll(/^TEMA: (.+)$/gm)].map((m) => m[1]);
    return JSON.stringify(temas.map((t) => ({ tema: t, resumen: `Resumen de ${t}.`, claves: ["Discontinuo → Dosímetro", "EPI gratis", "80 dB"], busquedas: [`${t} explicación`, `${t} FP`] })));
  }
  return "{}";
}

http.createServer(async (req, res) => {
  const body = await leerBody(req);
  if (req.method !== "POST" || req.url !== "/v1/messages") { res.writeHead(404); return res.end() }
  if (!req.headers["x-api-key"] || !req.headers["anthropic-version"]) { res.writeHead(401); return res.end('{"type":"error"}') }
  const b = JSON.parse(body);
  const content = b.messages?.[0]?.content || [];
  const prompt = content.filter((c) => c.type === "text").map((c) => c.text).join("\n");
  const nImgs = content.filter((c) => c.type === "image").length;
  log("claude", b.model, `stream=${b.stream}`, `imgs=${nImgs}`, prompt.slice(0, 40).replace(/\n/g, " "));
  const txt = respuestaIA(prompt, nImgs);
  res.writeHead(200, { "content-type": "text/event-stream" });
  const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
  ev("message_start", { message: { id: "msg_mock", role: "assistant", content: [] } });
  ev("content_block_start", { index: 0, content_block: { type: "text", text: "" } });
  for (let i = 0; i < txt.length; i += 200) { ev("content_block_delta", { index: 0, delta: { type: "text_delta", text: txt.slice(i, i + 200) } }); await new Promise((r) => setTimeout(r, 5)) }
  ev("content_block_stop", { index: 0 });
  ev("message_delta", { delta: { stop_reason: "end_turn" } });
  ev("message_stop", {});
  res.end();
}).listen(4010, () => log("Claude simulado en http://localhost:4010"));

/* ---------------- Stripe ---------------- */
const sesiones = new Map(), subs = new Map(), clientes = new Map();
let n = 0; const id = (p) => `${p}_mock${++n}`;
const sJSON = (res, d, s = 200) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(d)) };

async function webhook(type, object) {
  const payload = JSON.stringify({ id: id("evt"), object: "event", type, data: { object } });
  const header = stripe.webhooks.generateTestHeaderString({ payload, secret: SECRET });
  const r = await fetch(WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
  log("webhook", type, "→", r.status);
  return r.status;
}

http.createServer(async (req, res) => {
  const body = await leerBody(req);
  const url = new URL(req.url, "http://localhost:4020");
  const f = Object.fromEntries(new URLSearchParams(body));
  const auth = req.headers.authorization || "";
  if (url.pathname.startsWith("/v1/")) {
    if (!/^Bearer sk_test_/.test(auth)) return sJSON(res, { error: { message: "Clave de prueba no válida" } }, 401);
    log("stripe", req.method, url.pathname);
  }

  if (req.method === "POST" && url.pathname === "/v1/customers") {
    const c = { id: id("cus"), object: "customer", email: f.email || null, metadata: { user_id: f["metadata[user_id]"] } };
    clientes.set(c.id, c.email);
    return sJSON(res, c);
  }
  if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
    if (f.mode !== "subscription" || !f["line_items[0][price]"]?.startsWith("price_")) return sJSON(res, { error: { message: "price no válido" } }, 400);
    if (f.customer && !clientes.has(f.customer)) return sJSON(res, { error: { message: "No such customer" } }, 400);
    const embebido = f.ui_mode === "embedded";
    if (embebido ? !f.return_url || f.success_url : !f.success_url) return sJSON(res, { error: { message: "return_url solo con ui_mode=embedded" } }, 400);
    const s = { id: id("cs_test"), object: "checkout.session", mode: f.mode, ui_mode: embebido ? "embedded" : "hosted", client_reference_id: f.client_reference_id, customer: f.customer || null, customer_email: f.customer_email || clientes.get(f.customer) || null, success_url: f.success_url || f.return_url, cancel_url: f.cancel_url, metadata: { user_id: f["metadata[user_id]"] } };
    if (embebido) s.client_secret = `${s.id}_secret_mock`; else s.url = `http://localhost:4020/pay/${s.id}`;
    sesiones.set(s.id, s);
    return sJSON(res, s);
  }
  if (req.method === "POST" && url.pathname === "/v1/billing_portal/sessions") {
    return sJSON(res, { id: id("bps"), object: "billing_portal.session", url: `http://localhost:4020/portal/${f.customer}?return=${encodeURIComponent(f.return_url)}` });
  }
  if (req.method === "GET" && url.pathname === "/v1/subscriptions") {
    const c = url.searchParams.get("customer");
    return sJSON(res, { object: "list", has_more: false, data: [...subs.values()].filter((s) => s.customer === c) });
  }
  const del = url.pathname.match(/^\/v1\/subscriptions\/(\w+)$/);
  if (req.method === "DELETE" && del) {
    const s = subs.get(del[1]); if (!s) return sJSON(res, { error: { message: "no existe" } }, 404);
    s.status = "canceled"; webhook("customer.subscription.deleted", s);
    return sJSON(res, s);
  }

  // Stripe.js simulado: initEmbeddedCheckout monta un iframe con la página de pago
  if (url.pathname === "/stripe.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    return res.end(`window.Stripe = (pk) => ({ initEmbeddedCheckout: async ({ fetchClientSecret }) => {
      const id = (await fetchClientSecret()).split("_secret_")[0]; let f;
      return { mount(el) { f = document.createElement("iframe"); f.id = "stripe-embedded"; f.src = "http://localhost:4020/pay/" + id + "?embebido=1"; f.style.cssText = "width:100%;height:420px;border:0"; el.append(f) }, destroy() { f?.remove() } };
    } });`);
  }
  // Página de pago simulada (sustituye a checkout.stripe.com o al formulario integrado)
  const pay = url.pathname.match(/^\/pay\/(\w+)$/);
  if (pay) {
    const s = sesiones.get(pay[1]); if (!s) { res.writeHead(404); return res.end("Sesión no encontrada") }
    if (req.method === "POST") {
      if (f.card !== "4242424242424242" || !f.name) { res.writeHead(402, { "content-type": "text/html; charset=utf-8" }); return res.end("<p id=err>Tarjeta rechazada</p>") }
      s.customer ||= id("cus"); clientes.set(s.customer, s.customer_email);
      const sub = { id: id("sub"), object: "subscription", customer: s.customer, status: "active", metadata: s.metadata };
      subs.set(sub.id, sub); s.subscription = sub.id; s.status = "complete"; s.payment_status = "paid";
      const enviar = () => webhook("checkout.session.completed", s);
      if (RETRASO) setTimeout(enviar, RETRASO); else await enviar();
      if (s.ui_mode === "embedded") { res.writeHead(200, { "content-type": "text/html" }); return res.end(`<script>top.location.href = ${JSON.stringify(s.success_url)}</script>`) }
      res.writeHead(303, { location: s.success_url }); return res.end();
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    // Con un cliente ya creado no se pide el email (igual que Stripe)
    return res.end(`<!doctype html><meta charset=utf-8><title>Stripe Checkout (simulado)</title><h1>Entra Pro · 3,99 €/mes (MODO PRUEBA)</h1>
      <p id=emailinfo>${s.customer_email || ""}</p><form method=post>${s.customer ? "" : "<input name=email id=email placeholder=Email>"}
      <input name=name id=name placeholder="Nombre completo"><input name=address id=address placeholder="Dirección">
      <input name=card id=card placeholder="4242 4242 4242 4242"><button id=paybtn>Suscribirse</button></form>${s.cancel_url ? `<a id=cancel href="${s.cancel_url}">Volver</a>` : ""}`);
  }
  // Portal de cliente simulado
  const portal = url.pathname.match(/^\/portal\/(\w+)$/);
  if (portal) {
    const back = url.searchParams.get("return");
    if (req.method === "POST") {
      for (const s of subs.values()) if (s.customer === portal[1] && s.status === "active") { s.status = "canceled"; await webhook("customer.subscription.deleted", s) }
      res.writeHead(303, { location: back }); return res.end();
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    return res.end(`<!doctype html><meta charset=utf-8><title>Portal (simulado)</title><h1>Tu suscripción</h1><form method=post><button id=cancelSub>Cancelar suscripción</button></form><a href="${back}">Volver</a>`);
  }
  sJSON(res, { error: { message: `no simulado: ${req.method} ${url.pathname}` } }, 404);
}).listen(4020, () => log("Stripe simulado en http://localhost:4020"));
