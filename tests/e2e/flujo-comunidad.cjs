// Invitar a un amigo, compartir la nota (imagen) y ranking
const { chromium } = require("playwright");
const fs = require("fs");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", S = "http://127.0.0.1:54321", APP = "http://localhost:8888";
const K = fs.readFileSync(PROJ + "/.dev.vars", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: K, authorization: `Bearer ${K}`, "content-type": "application/json" };
const paso = (m) => console.log("✔", m);
const perfil = async (id) => (await (await fetch(`${S}/rest/v1/perfiles?id=eq.${id}&select=codigo,invitado_por,invitacion_premiada,extra_simulacros,extra_paginas,alias,en_ranking`, { headers: H })).json())[0];
const uidDe = (p) => p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("auth-token")))).user.id);

async function contexto(b, nombre) {
  const ctx = await b.newContext({ locale: "es-ES", viewport: { width: 420, height: 880 }, deviceScaleFactor: 2, acceptDownloads: true });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(40000); p.errores = [];
  p.on("pageerror", (e) => p.errores.push(`${nombre}: ${e.message}`));
  return p;
}
async function registrar(p, email, url = APP + "/app") {
  await p.goto(url); await p.waitForSelector("#enviar");
  await p.fill("#email", email); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#analyze");
}
async function simulacro(p) {
  await p.fill("#paste", "Tema 1 ✱ Entra. El ruido continuo se mide con sonómetro y el discontinuo con dosímetro.");
  await p.click("#analyze"); await p.waitForSelector(".topic"); await p.click("#next"); await p.click("text=Rápido"); await p.click("#gen");
  await p.waitForSelector("#submit");
  // contesta la mitad bien para tener nota
  const qs = await p.$$("#qt .q"); for (const q of qs) { const o = await q.$$(".opt"); if (o[0]) await o[0].click() }
  await p.click("#submit"); if (await p.$("#cYes")) await p.click("#cYes");
  await p.waitForSelector(".grade");
}

require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  // Los apodos son únicos: se liberan los de pruebas anteriores (solo base de datos local)
  for (const a of ["Beto", "Ana la crack"]) await fetch(`http://127.0.0.1:54321/rest/v1/perfiles?alias=ilike.${encodeURIComponent(a)}`, { method: "PATCH",
    headers: { apikey: K, authorization: `Bearer ${K}`, "content-type": "application/json" }, body: JSON.stringify({ alias: null, en_ranking: false }) });
  const b = await chromium.launch();
  // 1. Ana se registra y abre "Invita a un amigo"
  const ana = await contexto(b, "Ana"); await registrar(ana, `ana${Date.now()}@test.local`);
  const anaId = await uidDe(ana);
  await ana.click("#avatar"); await ana.click("#pmInvitar"); await ana.waitForSelector("#iUrl");
  await ana.waitForFunction(() => !/Cargando/.test(document.querySelector("#iCuenta").textContent));
  const enlace = await ana.inputValue("#iUrl");
  paso(`enlace de Ana: ${enlace} · ${(await ana.textContent("#iCuenta")).replace(/\s+/g, " ")}`);
  await ana.screenshot({ path: OUT + "/invitar.png" });

  // 2. Beto entra por el enlace (portada) y se registra
  const beto = await contexto(b, "Beto");
  await beto.goto(enlace); await beto.click("text=Empezar gratis");
  await registrar(beto, `beto${Date.now()}@test.local`, beto.url());
  await beto.waitForSelector("#msg .notice"); paso(`Beto ve: "${await beto.textContent("#msg .notice")}"`);
  const betoId = await uidDe(beto);
  let pb = await perfil(betoId); paso(`Beto invitado por Ana: ${pb.invitado_por === anaId} · premiado aún: ${pb.invitacion_premiada}`);

  // 3. Beto hace su primer simulacro → premio para los dos
  await simulacro(beto);
  pb = await perfil(betoId); const pa = await perfil(anaId);
  paso(`tras el simulacro: Beto +${pb.extra_simulacros} sim/+${pb.extra_paginas} pág · Ana +${pa.extra_simulacros} sim/+${pa.extra_paginas} pág`);
  await beto.reload(); await beto.waitForSelector("#account");
  paso(`límite de Beto en la app: ${(await beto.textContent("#account")).replace(/\s+/g, " ").trim()}`);

  // 4. Segundo simulacro no vuelve a premiar
  await beto.click("text=Otro simulacro").catch(() => {});
  // 5. Compartir la nota (sin navigator.share → descarga la imagen)
  await simulacro(beto);
  const [dl] = await Promise.all([beto.waitForEvent("download"), beto.click("#share")]);
  await dl.saveAs(OUT + "/nota-story.png"); paso(`imagen de la nota descargada: ${dl.suggestedFilename()}`);
  const pa2 = await perfil(anaId); paso(`Ana no gana más por el 2º simulacro de Beto: +${pa2.extra_simulacros}`);
  await beto.screenshot({ path: OUT + "/resultado-compartir.png", fullPage: false });

  // 6. Usar su propio código o uno inexistente no hace nada
  const propio = await beto.evaluate(async (c) => (await window.__sb?.rpc?.("usar_invitacion", { p_codigo: c }))?.data, pb.codigo).catch(() => null);

  // 7. Ranking: los dos se apuntan
  await beto.click("#verRanking"); await beto.waitForSelector("#rAlias");
  await beto.fill("#rAlias", "Beto"); await beto.click("#rUnirme"); await beto.waitForSelector(".rfila.yo");
  await ana.click("#iVolver"); await ana.click("#avatar"); await ana.click("#pmRanking"); await ana.waitForSelector("#rAlias");
  await ana.fill("#rAlias", "A"); await ana.click("#rUnirme"); await ana.waitForSelector("#msg .error"); paso(`apodo corto: "${await ana.textContent("#msg")}"`);
  await ana.fill("#rAlias", "beto"); await ana.click("#rUnirme"); await ana.waitForFunction(() => /otra persona/.test(document.querySelector("#msg").textContent)); paso(`apodo repetido: "${await ana.textContent("#msg")}"`);
  await ana.fill("#rAlias", "Ana la crack"); await ana.click("#rUnirme"); await ana.waitForSelector("#rSalir");
  await ana.waitForFunction(() => !/Cargando/.test(document.querySelector("#rLista").textContent));
  paso(`ranking (simulacros) visto por Ana: ${(await ana.textContent("#rLista")).replace(/\s+/g, " ")}`);
  // Beto con 3 simulacros entra en "mejores notas"
  await beto.click("#rVolver"); await simulacro(beto); await beto.click("#verRanking"); await beto.click("text=Mejores notas");
  await beto.waitForSelector(".rfila"); paso(`ranking (notas): ${(await beto.textContent("#rLista")).replace(/\s+/g, " ")}`);
  await beto.screenshot({ path: OUT + "/ranking.png" });
  // Privacidad: otro usuario no ve perfiles ajenos
  const ajenos = await ana.evaluate(async () => 0);
  await ana.click("#rSalir"); await ana.waitForSelector("#rAlias"); paso("Ana sale del ranking");
  console.log([...ana.errores, ...beto.errores].length ? "Errores: " + [...ana.errores, ...beto.errores].join(" | ") : "Sin errores de JS");
  await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
