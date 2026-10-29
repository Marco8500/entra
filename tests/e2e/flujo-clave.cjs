// Registro con email + contraseña (sin email de confirmación), entrar, olvidé la contraseña, simulacro y pago
const { chromium } = require("playwright");
const fs = require("fs");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", MAILPIT = "http://127.0.0.1:54324", S = "http://127.0.0.1:54321";
const K = fs.readFileSync(PROJ + "/.dev.vars", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const email = `clave${Date.now()}@test.local`, clave = "MiClave2026", nueva = "OtraClave2026";
const paso = (m) => console.log("✔", m);
const correos = async () => ((await (await fetch(`${MAILPIT}/api/v1/search?query=to:${encodeURIComponent(email)}`)).json()).messages || []);

require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: "es-ES", viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(40000);
  const errores = []; p.on("pageerror", (e) => errores.push("JS " + e.message));
  const msg = async () => (await p.textContent("#msg")).trim();

  // 1. Crear cuenta
  await p.goto("http://localhost:8888/app"); await p.waitForSelector("#enviar");
  await p.screenshot({ path: OUT + "/registro-clave.png" });
  if (await p.$("#google")) throw new Error("Google visible sin configurar");
  await p.fill("#email", email); await p.fill("#clave", "123"); await p.click("#enviar");
  paso(`contraseña corta: "${await msg()}"`);
  await p.fill("#clave", clave); await p.click("#enviar");
  paso(`sin casilla: "${await msg()}"`);
  await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#analyze");
  const uid = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("auth-token")))).user.id);
  const perfil = (await (await fetch(`${S}/rest/v1/perfiles?id=eq.${uid}&select=acepto_terminos_at`, { headers: { apikey: K, authorization: `Bearer ${K}` } })).json())[0];
  paso(`cuenta creada y dentro al momento; emails enviados: ${(await correos()).length}; términos guardados: ${perfil.acepto_terminos_at ? "✓" : "✗"}`);

  // 2. Simulacro rápido
  await p.fill("#paste", "Tema 1 ✱ Entra. El ruido continuo se mide con sonómetro y el discontinuo con dosímetro.");
  await p.click("#analyze"); await p.waitForSelector(".topic"); await p.click("#next"); await p.click("text=Rápido"); await p.click("#gen");
  await p.waitForSelector("#submit"); paso(`simulacro creado (${(await p.$$("#qt .q")).length} test)`);

  // 3. Salir y volver a entrar
  await p.click("#avatar"); await p.click("#logout"); await p.waitForSelector("#enviar");
  await p.click("#tEntrar"); await p.fill("#email", email); await p.fill("#clave", "Equivocada1"); await p.click("#enviar");
  await p.waitForSelector("#msg .error"); paso(`contraseña mal: "${await msg()}"`);
  await p.fill("#clave", clave); await p.click("#enviar"); await p.waitForSelector("#analyze");
  paso(`entra con su contraseña; ve sus apuntes: ${(await p.$$("#hist .item")).length}`);

  // 4. Registrarse otra vez con el mismo email
  await p.click("#avatar"); await p.click("#logout"); await p.waitForSelector("#enviar");
  await p.click("#tNuevo"); await p.fill("#email", email); await p.fill("#clave", "OtraCosa123"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#msg .error, #msg .notice"); paso(`registro repetido: "${await msg()}"`);

  // 5. He olvidado mi contraseña
  await p.click("#tEntrar"); await p.fill("#email", email); await p.click("#olvido");
  await p.waitForSelector("#msg .notice"); paso(`olvido: "${await msg()}"`);
  let link; for (let i = 0; i < 30 && !link; i++) { await new Promise((r) => setTimeout(r, 500)); const ms = await correos(); if (ms.length) link = (await (await fetch(`${MAILPIT}/api/v1/message/${ms[0].ID}`)).json()).HTML.match(/href="([^"]+verify[^"]+)"/)?.[1]?.replace(/&amp;/g, "&") }
  await p.goto(link); await p.waitForSelector("text=Pon tu contraseña nueva");
  await p.fill("#clave", nueva); await p.click("text=Guardar"); await p.waitForSelector("#analyze");
  paso("contraseña nueva guardada desde el email"); console.log("   perfil visible:", await p.isVisible("#perfil"), "avatar:", await p.isVisible("#avatar"), "menu:", await p.isVisible("#perfilMenu")); await p.screenshot({ path: OUT + "/dbg-clave.png" });
  await p.click("#avatar"); await p.click("#logout"); await p.waitForSelector("#enviar"); await p.click("#tEntrar");
  await p.fill("#email", email); await p.fill("#clave", nueva); await p.click("#enviar"); await p.waitForTimeout(3000); console.log("   vista:", (await p.textContent("#view")).replace(/\s+/g, " ").slice(0, 200)); await p.waitForSelector("#analyze");
  paso("entra con la contraseña nueva");

  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS");
  await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
