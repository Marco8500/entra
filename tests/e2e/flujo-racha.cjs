// Racha en el inicio y en la nota; top del ranking en la portada
const { chromium } = require("playwright");
const fs = require("fs");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", S = "http://127.0.0.1:54321", APP = "http://localhost:8888";
const K = fs.readFileSync(PROJ + "/.dev.vars", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: K, authorization: `Bearer ${K}`, "content-type": "application/json" };
const paso = (m) => console.log("✔", m);
const limpio = (t) => t.replace(/\s+/g, " ").trim();
require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: "es-ES", viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(40000); const errores = []; p.on("pageerror", (e) => errores.push(e.message));

  // Portada: recuadro del ranking
  await p.goto(APP + "/"); await p.waitForFunction(() => !/Cargando/.test(document.querySelector("#rkTop").textContent));
  paso(`portada: "${limpio(await p.textContent("#ranking h2"))}" → ${limpio(await p.textContent("#rkTop"))}`);
  await (await p.$("#ranking")).screenshot({ path: OUT + "/portada-ranking.png" });

  // Usuario nuevo: racha vacía
  await p.click("text=Apuntarme al ranking"); await p.waitForSelector("#enviar");
  await p.fill("#email", `racha${Date.now()}@test.local`); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#rAlias"); paso("desde la portada lleva directo a apuntarse al ranking");
  await p.fill("#rAlias", "Racha" + String(Date.now()).slice(-4)); await p.click("#rUnirme"); await p.waitForSelector("#rSalir");
  await p.click("#rVolver"); await p.waitForSelector(".comunidad");
  paso(`inicio sin racha: "${limpio(await p.textContent(".comunidad .racha"))}"`);
  // Simula 2 días anteriores con simulacros → al hacer uno hoy, racha de 3
  const uid = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("auth-token")))).user.id);
  for (const d of [1, 2]) await fetch(`${S}/rest/v1/simulacros`, { method: "POST", headers: H, body: JSON.stringify({ user_id: uid, examen: {}, nota: 6, creado_at: new Date(Date.now() - d * 864e5).toISOString() }) });
  await p.reload(); await p.waitForSelector(".comunidad");
  paso(`inicio con racha de ayer: "${limpio(await p.textContent(".comunidad .racha"))}"`);
  await p.fill("#paste", "Tema 1 ✱ Entra. El ruido continuo se mide con sonómetro y el discontinuo con dosímetro.");
  await p.click("#analyze"); await p.waitForSelector(".topic"); await p.click("#next"); await p.click("text=Rápido"); await p.click("#gen");
  await p.waitForSelector("#submit"); for (const q of await p.$$("#qt .q")) { const o = await q.$$(".opt"); if (o[0]) await o[0].click() }
  await p.click("#submit"); if (await p.$("#cYes")) await p.click("#cYes");
  await p.waitForSelector("#rachaRes .racha"); paso(`en la nota: "${limpio(await p.textContent("#rachaRes"))}"`);
  await p.screenshot({ path: OUT + "/nota-racha.png" });
  await p.click("#again"); await p.click("text=Volver").catch(() => {});
  await p.goto(APP + "/app"); await p.waitForSelector(".comunidad .rfila");
  paso(`inicio tras el simulacro: "${limpio(await p.textContent(".comunidad"))}"`);
  await (await p.$(".comunidad")).screenshot({ path: OUT + "/inicio-comunidad.png" });
  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS");
  await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
