// Avisos de últimos simulacros, muro al llegar al límite con la fecha del examen, pase de examen de 7 días
const { chromium } = require("playwright");
const fs = require("fs");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", S = "http://127.0.0.1:54321", APP = "http://localhost:8888";
const K = fs.readFileSync(PROJ + "/.dev.vars", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: K, authorization: `Bearer ${K}`, "content-type": "application/json", prefer: "resolution=merge-duplicates" };
const paso = (m) => console.log("✔", m);
const limpio = (t) => t.replace(/\s+/g, " ").trim();
const mes = new Date().toISOString().slice(0, 7);
const enDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) };
require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: "es-ES", viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(40000); const errores = []; p.on("pageerror", (e) => errores.push(e.message));
  await p.goto(APP + "/app"); await p.waitForSelector("#enviar");
  await p.fill("#email", `pase${Date.now()}@test.local`); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#analyze");
  const uid = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("auth-token")))).user.id);
  await fetch(`${S}/rest/v1/examenes`, { method: "POST", headers: H, body: JSON.stringify({ user_id: uid, asignatura: "Historia", fecha: enDias(5) }) });
  const ponerUso = (n) => fetch(`${S}/rest/v1/uso`, { method: "POST", headers: H, body: JSON.stringify({ user_id: uid, mes, simulacros: n }) });
  const simulacro = async () => {
    await p.fill("#paste", "Tema 1 ✱ Entra. El ruido continuo se mide con sonómetro y el discontinuo con dosímetro.");
    await p.click("#analyze"); await p.waitForSelector(".topic"); await p.click("#next"); await p.click("text=Rápido"); await p.click("#gen");
  };
  // 1. Penúltimo simulacro → "te queda 1"
  await ponerUso(1); await p.reload(); await p.waitForSelector("#analyze");
  await simulacro(); await p.waitForSelector("#submit"); await p.click("#submit"); if (await p.$("#cYes")) await p.click("#cYes");
  await p.waitForSelector("#avisoPro .muro"); paso(`tras el 2.º simulacro: "${limpio(await p.textContent("#avisoPro"))}"`);
  await p.screenshot({ path: OUT + "/aviso-ultimo.png" });
  // 2. Sin simulacros → muro con el examen
  await ponerUso(3); await p.goto(APP + "/app"); await p.waitForSelector("#analyze");
  await simulacro(); await p.waitForSelector(".muro"); paso(`al llegar al límite: "${limpio(await p.textContent(".muro"))}"`);
  await p.screenshot({ path: OUT + "/muro.png", fullPage: true });
  // 3. Pase de examen → pagar → Pro 7 días
  await p.click("#mPase"); await p.waitForSelector("#stripe-embedded");
  paso(`pantalla de pago: opción marcada "${limpio(await p.textContent(".opcion.on"))}"`);
  await p.screenshot({ path: OUT + "/pago-pase.png", fullPage: true });
  const f = p.frameLocator("#stripe-embedded");
  await f.locator("#name").fill("Alumna Prueba"); await f.locator("#address").fill("Calle Mayor 1"); await f.locator("#card").fill("4242424242424242"); await f.locator("#paybtn").click();
  await p.waitForFunction(() => /Pro · hasta/.test(document.querySelector("#account")?.textContent || ""), null, { timeout: 40000 });
  paso(`tras pagar: "${limpio(await p.textContent("#account"))}"`);
  const perf = (await (await fetch(`${S}/rest/v1/perfiles?id=eq.${uid}&select=plan,pro_hasta`, { headers: H })).json())[0];
  const pases = await (await fetch(`${S}/rest/v1/pases?user_id=eq.${uid}&select=session_id`, { headers: H })).json();
  paso(`base de datos: plan=${perf.plan}, pro_hasta dentro de ${Math.round((new Date(perf.pro_hasta) - Date.now()) / 864e5)} días, pases=${pases.length}`);
  // 4. Ahora puede hacer simulacros
  await simulacro(); await p.waitForSelector("#submit"); paso("con el pase vuelve a poder hacer simulacros");
  // 5. Con pase activo, la pantalla de pago solo ofrece Pro mensual
  await p.click("#avatar"); await p.click("#pmPro"); await p.waitForSelector(".opcion");
  paso(`opciones con pase activo: ${(await p.$$(".opcion")).length} → "${limpio(await p.textContent(".opcion.on"))}"`);
  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS");
  await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
