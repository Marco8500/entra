// Corrección: 1) la primera IA devuelve JSON cortado → la corrige otra IA; 2) si fallan todas → corrección por ideas
const { chromium } = require("playwright");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", APP = "http://localhost:8888";
const paso = (m) => console.log("✔", m);
async function examen(p) {
  await p.fill("#paste", "Tema 1 ✱ Entra. El ruido continuo se mide con sonómetro y el discontinuo con dosímetro. El nivel inferior de acción es 80 dB.");
  await p.click("#analyze"); await p.waitForSelector(".topic"); await p.click("#next"); await p.click("text=Rápido"); await p.click("#gen");
  await p.waitForSelector("#submit");
  for (const q of await p.$$("#qt .q")) { const o = await q.$$(".opt"); if (o[0]) await o[0].click() }
  for (const t of await p.$$("#qc textarea")) await t.fill("El dosímetro mide el ruido discontinuo y el sonómetro el continuo; el nivel de acción es 80 dB.");
  await p.click("#submit"); if (await p.$("#cYes")) await p.click("#cYes");
  await p.waitForSelector(".grade");
  return (await p.$$eval("#corr .q .fb", (fs) => fs.map((f) => f.textContent))).slice(-2);
}
require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: "es-ES" });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(90000); const errores = []; p.on("pageerror", (e) => errores.push(e.message));
  await p.goto(APP + "/app"); await p.waitForSelector("#enviar");
  await p.fill("#email", `corr${Date.now()}@test.local`); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar"); await p.waitForSelector("#analyze");
  paso(`1ª IA con respuesta cortada → comentarios: ${JSON.stringify(await examen(p))} · nota ${await p.textContent(".grade")}`);
  // 2) Todas las IAs fallan: la corrección por ideas da nota parcial
  await ctx.route("**/api/corregir", (r) => r.fulfill({ status: 200, contentType: "text/plain", body: "\n[[ERROR:ia]]" }));
  await p.click("#again"); await p.goto(APP + "/app"); await p.waitForSelector("#analyze");
  const fb = await examen(p);
  const notas = await p.$$eval("#corr .verdict", (v) => v.map((x) => x.textContent).filter((t) => /\/ 10/.test(t)));
  paso(`todas fallan → notas cortas ${JSON.stringify(notas)} · "${fb[0]}"`);
  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS"); await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
