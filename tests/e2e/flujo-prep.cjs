// Prepárate para tu examen (cuenta atrás + plan) y test del método de estudio
const { chromium } = require("playwright");
const fs = require("fs");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", S = "http://127.0.0.1:54321";
const K = fs.readFileSync(PROJ + "/.dev.vars", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: K, authorization: `Bearer ${K}` };
const paso = (m) => console.log("✔", m);
const enDias = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) };
const limpio = (t) => t.replace(/\s+/g, " ").trim();

require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: "es-ES", viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(30000);
  const errores = []; p.on("pageerror", (e) => errores.push("JS " + e.message));

  await p.goto("http://localhost:8888/app"); await p.waitForSelector("#enviar");
  await p.fill("#email", `prep${Date.now()}@test.local`); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector(".prep");
  paso(`al entrar: "${limpio(await p.textContent(".prep h2"))}"`);
  await p.screenshot({ path: OUT + "/prep-vacio.png" });

  // 1. Fecha en el pasado → aviso
  await p.fill("#pAsig", "Historia"); await p.evaluate(() => { const f = document.querySelector("#pFecha"); f.removeAttribute("min"); f.value = "2020-01-01" });
  await p.click(".prep-form button"); await p.waitForSelector("#pMsg .error"); paso(`fecha pasada: "${await p.textContent("#pMsg")}"`);

  // 2. Examen dentro de 12 días → cuenta atrás y plan
  await p.fill("#pFecha", enDias(12)); await p.click(".prep-form button");
  await p.waitForSelector(".cuenta");
  paso(`cuenta atrás: "${limpio(await p.textContent(".cuenta"))}" · plan: "${limpio(await p.textContent(".prep > p"))}"`);

  // 3. Otro examen dentro de 30 días
  await p.click("#pOtro"); await p.fill("#pAsig", "PRL"); await p.fill("#pFecha", enDias(30)); await p.click(".prep-form button");
  await p.waitForSelector("text=Después:"); paso(`dos exámenes: "${limpio(await p.textContent(".prep .small.muted"))}"`);

  // 4. Test: respuestas de alguien que se distrae → Pomodoro
  await p.click("#pTest");
  for (let i = 0; i < 8; i++) {
    await p.waitForSelector(`text=${i + 1} de 8`);
    if (i === 0) await p.screenshot({ path: OUT + "/test-pregunta.png" });
    const elegir = [0, 3, 2, 1, 0, 1, 0, 0][i];
    await p.click(`#tOpts .test-opt >> nth=${elegir}`);
  }
  await p.waitForSelector(".metodo-cab");
  paso(`resultado del test: "${limpio(await p.textContent(".metodo-cab"))}"; plan: "${limpio(await p.textContent("section > p >> nth=1"))}"`);
  await p.screenshot({ path: OUT + "/test-resultado.png", fullPage: true });
  const uid = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("auth-token")))).user.id);
  const fila = (await (await fetch(`${S}/rest/v1/estilo_estudio?user_id=eq.${uid}&select=metodo,puntos`, { headers: H })).json())[0];
  paso(`guardado en la base de datos: ${fila.metodo} ${JSON.stringify(fila.puntos)}`);

  // 5. Volver: el método aparece en la tarjeta y el plan se adapta
  await p.click("#mVolver"); await p.waitForSelector(".metodo-mini");
  paso(`tarjeta con método: "${limpio(await p.textContent(".metodo-mini"))}" · "${limpio(await p.textContent(".prep .small b"))}"`);
  await p.screenshot({ path: OUT + "/prep-lleno.png" });

  // 6. Recargar: se mantiene. Quitar el primero → pasa al siguiente
  await p.reload(); await p.waitForSelector(".cuenta");
  paso(`tras recargar: "${limpio(await p.textContent(".cuenta .dias"))} días" y método guardado: ${!!(await p.$(".metodo-mini"))}`);
  await p.click("#pBorrar"); await p.waitForFunction(() => document.querySelector(".cuenta .dias")?.textContent === "30");
  paso(`al quitar Historia queda: "${limpio(await p.textContent(".cuenta"))}"`);

  // 7. Examen hoy
  await p.click("#pOtro"); await p.fill("#pAsig", "Mates"); await p.fill("#pFecha", enDias(0)); await p.click(".prep-form button");
  await p.waitForFunction(() => document.querySelector(".cuenta .dias")?.textContent === "¡Hoy!");
  paso(`examen hoy: "${limpio(await p.textContent(".prep > p"))}"`);

  // 8. Otra persona no ve mis exámenes (RLS)
  const ajeno = await (await fetch(`${S}/rest/v1/examenes?select=id`, { headers: { apikey: H.apikey, authorization: "Bearer " + (await (await fetch(`${S}/auth/v1/signup`, { method: "POST", headers: { apikey: fs.readFileSync(PROJ + "/public/assets/config.js", "utf8").match(/SUPABASE_ANON_KEY: "(ey[^"]+)"/)[1], "content-type": "application/json" }, body: JSON.stringify({ email: `otro${Date.now()}@test.local`, password: "OtraClave2026" }) })).json()).access_token } })).json();
  paso(`otro usuario ve ${ajeno.length} exámenes ajenos`);

  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS");
  await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
