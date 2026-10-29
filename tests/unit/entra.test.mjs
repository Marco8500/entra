// Pruebas unitarias de netlify/lib/entra.mjs y del webhook de Stripe. Sin red: fetch está simulado.
// Ejecutar: npm run test:unit
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";

const ENV = {
  SUPABASE_URL: "http://supabase.prueba", SUPABASE_SERVICE_ROLE_KEY: "service-prueba",
  GROQ_API_KEY: "g", GROQ_API_URL: "http://groq.prueba", GROQ_MODELOS: "g1", GROQ_MODELOS_RAPIDO: "g1",
  GEMINI_API_KEY: "m", GEMINI_API_URL: "http://gemini.prueba", GEMINI_MODELOS: "m1", GEMINI_MODELOS_RAPIDO: "m1",
  IA_ORDEN: "groq,gemini", STRIPE_SECRET_KEY: "sk_test_prueba", STRIPE_WEBHOOK_SECRET: "whsec_prueba",
  STRIPE_PRICE_ID: "price_test", STRIPE_PRICE_ID_LIVE: "price_live", STRIPE_PK_TEST: "pk_test_x", STRIPE_PK_LIVE: "pk_live_x",
};
globalThis.__ENTRA_ENV = { ...ENV };

const lib = await import("../../netlify/lib/entra.mjs");
const webhook = (await import("../../netlify/functions/stripe-webhook.mjs")).default;

// fetch simulado: cada prueba define qué responde cada servicio y se apuntan las llamadas
let rutas = {}, llamadas = [];
const sse = (trozos) => new Response(trozos.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}\n\n`).join("") + "data: [DONE]\n\n",
  { headers: { "content-type": "text/event-stream" } });
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  llamadas.push({ u, metodo: opts.method || "GET", body: opts.body });
  for (const [pref, fn] of Object.entries(rutas)) if (u.startsWith(pref)) return fn(u, opts);
  if (u.startsWith(ENV.SUPABASE_URL)) return new Response("[]", { headers: { "content-type": "application/json" } });
  return new Response("sin ruta " + u, { status: 599 });
};
beforeEach(() => { rutas = {}; llamadas = []; globalThis.__ENTRA_ENV = { ...ENV } });
const leer = async (r) => (await r.text()).trim();

test("jsonDe lee JSON limpio, con ```json, con texto alrededor y con espacios del latido", () => {
  assert.deepEqual(lib.jsonDe('{"a":1}'), { a: 1 });
  assert.deepEqual(lib.jsonDe("```json\n[1,2]\n```"), [1, 2]);
  assert.deepEqual(lib.jsonDe('   Aquí va: {"t":[{"x":1}]} fin'), { t: [{ x: 1 }] });
  assert.equal(lib.jsonDe('{"cortado": [1, 2'), null);
  assert.equal(lib.jsonDe(""), null);
});

test("planDe: Pro por suscripción o por pase vigente; un pase caducado no cuenta", () => {
  assert.equal(lib.planDe(null, { plan: "pro" }), "pro");
  assert.equal(lib.planDe(null, { plan: "free", pro_hasta: new Date(Date.now() + 864e5).toISOString() }), "pro");
  assert.equal(lib.planDe(null, { plan: "free", pro_hasta: new Date(Date.now() - 1000).toISOString() }), "free");
  assert.equal(lib.planDe(null, null), "free");
});

test("limiteDe suma lo ganado por invitaciones y conserva el resto de límites", () => {
  const l = lib.limiteDe("free", { extra_simulacros: 2, extra_paginas: 20 });
  assert.equal(l.simulacros, lib.LIMITES.free.simulacros + 2);
  assert.equal(l.paginas, lib.LIMITES.free.paginas + 20);
  assert.equal(l.correcciones, lib.LIMITES.free.correcciones);
  assert.ok(lib.LIMITES.pro.correcciones > lib.LIMITES.free.correcciones);
});

test("Stripe: precios y clave pública de prueba con sk_test y reales con sk_live", () => {
  assert.equal(lib.precioStripe("STRIPE_PRICE_ID"), "price_test");
  assert.equal(lib.clavePublicaStripe(), "pk_test_x");
  globalThis.__ENTRA_ENV.STRIPE_SECRET_KEY = "sk_live_prueba";
  assert.equal(lib.stripeReal(), true);
  assert.equal(lib.precioStripe("STRIPE_PRICE_ID"), "price_live");
  assert.equal(lib.clavePublicaStripe(), "pk_live_x");
});

test("streamIA: si la primera IA está saturada (503) pasa a la siguiente y apunta el fallo", async () => {
  rutas[ENV.GROQ_API_URL] = () => new Response("busy", { status: 503 });
  rutas[ENV.GEMINI_API_URL] = () => sse(['{"ok":', "true}"]);
  let hecho = false;
  const r = lib.streamIA({ content: [{ type: "text", text: "hola" }], ruta: "prueba", onDone: async () => { hecho = true } });
  assert.equal(await leer(r), '{"ok":true}');
  assert.equal(hecho, true);
  assert.ok(llamadas.some((c) => c.u.startsWith(ENV.GROQ_API_URL)) && llamadas.some((c) => c.u.startsWith(ENV.GEMINI_API_URL)));
  await new Promise((ok) => setTimeout(ok, 20)); // registros en segundo plano
  const registros = llamadas.filter((c) => c.u.includes("/rest/v1/ia_errores") && c.metodo === "POST").map((c) => JSON.parse(c.body));
  assert.ok(registros.some((x) => x.proveedor === "groq" && x.status === 503));
  assert.ok(registros.some((x) => x.proveedor === "gemini" && x.ok === true));
});

test("streamIA con validar: una respuesta cortada no llega al alumno, se pide a la siguiente IA", async () => {
  rutas[ENV.GROQ_API_URL] = () => sse(['[{"i":0,"nota":']); // cortada
  rutas[ENV.GEMINI_API_URL] = () => sse(['[{"i":0,"nota":7}]']);
  const r = lib.streamIA({ content: [{ type: "text", text: "x" }], model: lib.MODELO_RAPIDO, ruta: "prueba2",
    validar: (j) => Array.isArray(j) && j.every((x) => Number.isFinite(+x.nota)) });
  assert.deepEqual(JSON.parse(await leer(r)), [{ i: 0, nota: 7 }]);
});

test("streamIA: si todas fallan termina con [[ERROR:...]] (el navegador lo reconoce)", async () => {
  rutas[ENV.GROQ_API_URL] = () => new Response("x", { status: 500 });
  rutas[ENV.GEMINI_API_URL] = () => new Response("x", { status: 500 });
  const r = lib.streamIA({ content: [{ type: "text", text: "x" }], ruta: "prueba3" });
  assert.match(await leer(r), /\[\[ERROR:(ia|ocupado)\]\]$/);
});

const stripe = new Stripe("sk_test_prueba");
const aviso = (obj) => {
  const payload = JSON.stringify({ id: "evt_1", object: "event", type: "checkout.session.completed", data: { object: obj } });
  const firma = stripe.webhooks.generateTestHeaderString({ payload, secret: ENV.STRIPE_WEBHOOK_SECRET });
  return new Request("http://x/api/stripe-webhook", { method: "POST", body: payload, headers: { "stripe-signature": firma } });
};

test("webhook: firma falsa → 400", async () => {
  const r = await webhook(new Request("http://x/api/stripe-webhook", { method: "POST", body: "{}", headers: { "stripe-signature": "t=1,v1=mal" } }));
  assert.equal(r.status, 400);
});

test("webhook: si la base de datos falla responde 500 para que Stripe lo reintente", async () => {
  rutas[ENV.SUPABASE_URL + "/rest/v1/rpc/activar_pase"] = () => new Response(JSON.stringify({ message: "caída" }), { status: 503, headers: { "content-type": "application/json" } });
  const r = await webhook(aviso({ id: "cs_1", mode: "payment", payment_status: "paid", client_reference_id: "u1", metadata: { tipo: "pase" } }));
  assert.equal(r.status, 500);
});

test("webhook: pase pagado → activa 7 días y responde 200", async () => {
  rutas[ENV.SUPABASE_URL + "/rest/v1/rpc/activar_pase"] = () => new Response("null", { headers: { "content-type": "application/json" } });
  const r = await webhook(aviso({ id: "cs_2", mode: "payment", payment_status: "paid", client_reference_id: "u1", metadata: { tipo: "pase" } }));
  assert.equal(r.status, 200);
  const c = llamadas.find((x) => x.u.endsWith("/rpc/activar_pase"));
  assert.deepEqual(JSON.parse(c.body), { p_user: "u1", p_session: "cs_2", p_dias: 7 });
});
