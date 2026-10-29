// Círculo de perfil (inicial o foto de Google), menú con plan y cerrar sesión; tutor por chat (Make) con límite
const { chromium } = require("playwright");
const fs = require("fs");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", S = "http://127.0.0.1:54321";
const K = fs.readFileSync(PROJ + "/.dev.vars", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const H = { apikey: K, authorization: `Bearer ${K}`, "content-type": "application/json" };
const paso = (m) => console.log("✔", m);
// foto de perfil de prueba (PNG 1x1 azul servido por la ruta simulada)
const FOTO = "https://lh3.googleusercontent.com/a/foto-prueba";

require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: "es-ES", viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs/, (r) => r.fulfill({ body: "" }));
  await ctx.route(FOTO, (r) => r.fulfill({ path: FIX + "/apuntes.jpg", contentType: "image/jpeg" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(30000);
  const errores = []; p.on("pageerror", (e) => errores.push("JS " + e.message));

  // 1. Usuario con email y contraseña → círculo con la inicial
  const email = `maria${Date.now()}@test.local`;
  await p.goto("http://localhost:8888/app"); await p.waitForSelector("#enviar");
  if (await p.isVisible("#perfil") || await p.isVisible("#chatBtn")) throw new Error("perfil/chat visibles sin sesión");
  await p.fill("#email", email); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#analyze"); await p.waitForSelector("#avatar:visible");
  paso(`círculo con la inicial: "${(await p.textContent("#avatar")).trim()}"`);
  await p.click("#avatar"); await p.waitForSelector("#perfilMenu:visible");
  paso(`menú: ${(await p.textContent("#perfilMenu")).replace(/\s+/g, " ").trim()}`);
  await p.screenshot({ path: OUT + "/perfil-menu.png" });
  await p.click("main"); if (await p.isVisible("#perfilMenu")) throw new Error("el menú no se cierra al pulsar fuera");
  paso("el menú se cierra al pulsar fuera");

  // 2. Tutor: con apuntes de contexto y con historial
  await p.fill("#paste", "UD2 Ruido ✱ Entra. El ruido discontinuo se mide con dosímetro.");
  await p.click("#analyze"); await p.waitForSelector(".topic");
  await p.click("#chatBtn"); await p.waitForSelector("#chat:visible");
  await p.fill("#chatInput", "¿Con qué se mide el ruido discontinuo?"); await p.press("#chatInput", "Enter");
  await p.waitForSelector(".chat-msgs .m.tutor >> nth=1"); await p.waitForSelector("#escribiendo", { state: "detached" });
  await p.fill("#chatInput", "¿Y el continuo?"); await p.press("#chatInput", "Enter");
  await p.waitForSelector("#escribiendo", { state: "detached" }); await p.waitForSelector(".chat-msgs .m.tutor >> nth=2");
  const msgs = await p.$$eval(".chat-msgs .m", (m) => m.map((x) => x.className.split(" ")[1] + ": " + x.textContent));
  paso("tutor:\n     " + msgs.join("\n     ") + `\n     contador: ${await p.textContent("#chatUso")}`);
  await p.screenshot({ path: OUT + "/chat.png" });
  const uid = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("auth-token")))).user.id);
  const uso = (await (await fetch(`${S}/rest/v1/uso?user_id=eq.${uid}&select=mensajes`, { headers: H })).json())[0];
  paso(`mensajes contados en la base de datos: ${uso.mensajes}`);

  // 3. Límite del plan gratis
  await fetch(`${S}/rest/v1/uso?user_id=eq.${uid}`, { method: "PATCH", headers: H, body: '{"mensajes":20}' });
  await p.fill("#chatInput", "Otra pregunta"); await p.press("#chatInput", "Enter");
  await p.waitForSelector(".chat-msgs .m.aviso");
  paso(`al llegar al límite: "${await p.textContent(".chat-msgs .m.aviso")}"`);

  // 4. Cerrar sesión desde el menú
  await p.click("#chatCerrar"); await p.click("#avatar"); await p.click("#logout"); await p.waitForSelector("#enviar");
  paso(`cerrar sesión desde el círculo → pantalla de entrada; chat oculto: ${!(await p.isVisible("#chatBtn"))}`);

  // 5. Usuario de Google (con foto) y Pro → foto en el círculo y "Pro" en el menú
  const g = `pepe${Date.now()}@gmail.com`;
  const u = await (await fetch(`${S}/auth/v1/admin/users`, { method: "POST", headers: H, body: JSON.stringify({ email: g, password: "Clave-12345", email_confirm: true, user_metadata: { full_name: "Pepe Pérez", avatar_url: FOTO } }) })).json();
  await fetch(`${S}/rest/v1/perfiles?id=eq.${u.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ plan: "pro", acepto_terminos_at: new Date().toISOString() }) });
  await p.click("#tEntrar"); await p.fill("#email", g); await p.fill("#clave", "Clave-12345"); await p.click("#enviar");
  await p.waitForSelector("#avatar img");
  await p.waitForFunction(() => document.querySelector("#avatar img")?.naturalWidth > 0);
  await p.click("#avatar"); await p.waitForSelector("#perfilMenu .pill.pro");
  paso(`usuario de Google: foto en el círculo ✓; menú: ${(await p.textContent("#perfilMenu")).replace(/\s+/g, " ").trim()}`);
  await p.screenshot({ path: OUT + "/perfil-pro.png" });

  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS");
  await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
