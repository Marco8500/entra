// Cambios de la auditoría: texto pegado largo en lotes, lista ligera de apuntes, jsPDF bajo demanda,
// un solo guardado por simulacro y límite de correcciones. Necesita el entorno local (Supabase, mocks y wrangler dev).
const { chromium } = require("playwright");
const fs = require("fs");
const PROJ = require("path").resolve(__dirname, "../.."), S = "http://127.0.0.1:54321", APP = "http://localhost:8888";
const K = fs.readFileSync(PROJ + "/.dev.vars", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: K, authorization: `Bearer ${K}`, "content-type": "application/json" };
const paso = (m) => console.log("✔", m);
const falla = (m) => { throw new Error(m) };

(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: "es-ES", acceptDownloads: true });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  let pidioJsPdf = 0;
  await ctx.route("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/**", (r) => { pidioJsPdf++; r.fulfill({ path: PROJ + "/node_modules/jspdf/dist/jspdf.umd.min.js", contentType: "text/javascript" }) });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(90000);
  const errores = []; p.on("pageerror", (e) => errores.push(e.message));
  const leer = []; p.on("request", (r) => { if (r.url().endsWith("/api/leer")) leer.push(JSON.parse(r.postData() || "{}")) });

  await p.goto(APP + "/app"); await p.waitForSelector("#enviar");
  await p.fill("#email", `audit${Date.now()}@test.local`); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#analyze");
  if (pidioJsPdf) falla("jsPDF se descarga al abrir la app");
  paso("al abrir la app no se descarga jsPDF");

  // 1. Texto pegado de ~75.000 caracteres: antes el servidor lo cortaba en 60.000; ahora va en lotes de ≤12.000
  const parrafo = (i) => `Tema ${i} ✱ Entra\n` + `El concepto ${i} se explica con detalle: la prevención de riesgos laborales exige evaluar, planificar y formar. `.repeat(12);
  const largo = Array.from({ length: 60 }, (_, i) => parrafo(i + 1)).join("\n");
  await p.fill("#paste", largo); await p.click("#analyze"); await p.waitForSelector(".topic");
  const tam = leer.map((l) => (l.texto || "").length);
  if (leer.length < 6) falla(`pocos lotes: ${leer.length}`);
  if (Math.max(...tam) > 60000) falla("un lote supera lo que acepta el servidor");
  const recibido = leer.flatMap((l) => (l.texto || "").split("\n").map((x) => x.replace(/^\d+\| /, ""))).join("\n");
  if (!recibido.includes("Tema 60 ✱ Entra")) falla("el final del texto pegado no llega a la IA");
  paso(`texto pegado de ${largo.length} caracteres → ${leer.length} lotes (máx. ${Math.max(...tam)} caracteres con numeración); llega hasta el final`);
  const temas = (await p.$$(".topic")).length;

  // 2. Inicio: la lista de apuntes viene de mis_apuntes (sin el texto) y al abrir se cargan los temas
  let bajoTemas = false;
  p.on("request", (r) => { if (/\/rest\/v1\/apuntes\?select=id%2C.*temas/.test(r.url())) bajoTemas = true });
  await p.goto(APP + "/app"); await p.waitForSelector("#hist .item");
  const fila = (await p.textContent("#hist .item")).replace(/\s+/g, " ");
  if (bajoTemas) falla("el inicio sigue bajando los temas completos");
  await p.click("#hist .item"); await p.waitForSelector(".topic");
  const abiertos = (await p.$$(".topic")).length;
  if (abiertos !== temas) falla(`al abrir hay ${abiertos} temas y se guardaron ${temas}`);
  paso(`inicio ligero: "${fila.trim()}" · al abrir: ${abiertos} temas`);

  // 3. Simulacro: se guarda una sola vez aunque se entregue dos veces (reloj + botón)
  await p.click("#next"); await p.click("text=Rápido"); await p.click("#gen"); await p.waitForSelector("#submit");
  for (const q of await p.$$("#qt .q")) { const o = await q.$$(".opt"); if (o[1]) await o[1].click() }
  const uid = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("auth-token")))).user.id);
  await p.click("#submit"); if (await p.$("#cYes")) await p.click("#cYes");
  await p.waitForSelector(".grade");
  await p.waitForTimeout(1500);
  const sims = await (await fetch(`${S}/rest/v1/simulacros?user_id=eq.${uid}&select=id`, { headers: H })).json();
  if (sims.length !== 1) falla(`simulacros guardados: ${sims.length}`);
  paso("simulacro guardado una vez");

  // 4. PDF de repaso: jsPDF se descarga solo ahora
  if (await p.$("#rev")) {
    await p.click("#rev"); await p.waitForSelector("#pdf");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("#pdf")]);
    paso(`PDF de repaso descargado (${dl.suggestedFilename()}); peticiones a jsPDF: ${pidioJsPdf}`);
    if (pidioJsPdf !== 1) falla("jsPDF no se ha cargado al pedir el PDF");
  } else paso("sin temas flojos: no hay PDF de repaso que probar");

  // 5. Límite de correcciones: con el cupo gastado, /api/corregir responde 402
  const mes = new Date().toISOString().slice(0, 7);
  await fetch(`${S}/rest/v1/uso?on_conflict=user_id,mes`, { method: "POST", headers: { ...H, prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ user_id: uid, mes, correcciones: 40 }) });
  const token = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("auth-token")))).access_token);
  const r = await fetch(APP + "/api/corregir", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ preguntas: [{ pregunta: "¿?", respuestaModelo: "x", puntosClave: ["x"], respuesta: "x" }] }) });
  const d = await r.json();
  if (r.status !== 402 || d.error !== "limite_correcciones") falla(`corregir con cupo gastado: ${r.status} ${JSON.stringify(d)}`);
  paso(`cupo de correcciones gastado → ${r.status}: "${d.mensaje}"`);

  console.log(errores.length ? "Errores de JS: " + errores.join(" | ") : "Sin errores de JS");
  await b.close();
  if (errores.length) process.exit(1);
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
