// Mide la latencia de los endpoints en local (wrangler dev en :8888 + Supabase local + simuladores).
// Uso: node tests/perf/medir-api.mjs [repeticiones]
import fs from "node:fs";
const APP = process.env.APP || "http://localhost:8888", S = "http://127.0.0.1:54321";
const vars = fs.readFileSync(new URL("../../.dev.vars", import.meta.url), "utf8");
const K = vars.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const ANON = fs.readFileSync(new URL("../../public/assets/config.js", import.meta.url), "utf8").match(/SUPABASE_ANON_KEY: "(ey[^"]+)"/)[1];
const N = +process.argv[2] || 20;
const H = { apikey: K, authorization: `Bearer ${K}`, "content-type": "application/json" };

const email = `perf${Date.now()}@test.local`;
const u = await (await fetch(`${S}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email, password: "Clave-12345", email_confirm: true }) })).json();
await fetch(`${S}/rest/v1/perfiles?id=eq.${u.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ acepto_terminos_at: new Date().toISOString(), plan: "pro" }) });
const { access_token: tok } = await (await fetch(`${S}/auth/v1/token?grant_type=password`, { method: "POST", headers: { apikey: ANON, "content-type": "application/json" }, body: JSON.stringify({ email, password: "Clave-12345" }) })).json();
const A = { authorization: `Bearer ${tok}`, "content-type": "application/json" };

async function medir(nombre, fn) {
  await fn(); // calentamiento
  const t = [];
  for (let i = 0; i < N; i++) { const t0 = performance.now(); await fn(); t.push(performance.now() - t0) }
  t.sort((a, b) => a - b);
  const p = (q) => t[Math.min(t.length - 1, Math.floor(q * t.length))].toFixed(0);
  console.log(`${nombre.padEnd(34)} mediana ${p(0.5).padStart(5)} ms · p90 ${p(0.9).padStart(5)} ms`);
}
await medir("GET /api/cuenta", async () => { const r = await fetch(`${APP}/api/cuenta`, { headers: A }); await r.text() });
await medir("POST /api/leer (texto, IA simulada)", async () => { const r = await fetch(`${APP}/api/leer`, { method: "POST", headers: A, body: JSON.stringify({ texto: "1| Tema 1 Ruido\n2| El ruido continuo se mide con sonómetro.", paginas: 1, indice: true }) }); await r.text() });
await medir("POST /api/corregir (IA simulada)", async () => { const r = await fetch(`${APP}/api/corregir`, { method: "POST", headers: A, body: JSON.stringify({ preguntas: [{ pregunta: "¿Con qué se mide el ruido?", respuestaModelo: "Sonómetro", puntosClave: ["sonómetro"], respuesta: "con sonómetro" }] }) }); await r.text() });
await medir("GET /api/ranking", async () => { const r = await fetch(`${APP}/api/ranking`); await r.text() });
await fetch(`${S}/auth/v1/admin/users/${u.id}`, { method: "DELETE", headers: H });
