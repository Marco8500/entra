// Portada: se entiende el concepto (apuntes → simulacro → nota), los botones llevan a su sitio y "Comprar el pase" abre el pago del pase
const { chromium } = require("playwright");
const PROJ = require("path").resolve(__dirname, "../.."), APP = "http://localhost:8888";
const paso = (m) => console.log("✔", m), falla = (m) => { throw new Error(m) };
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: "es-ES", viewport: { width: 390, height: 844 } });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(40000); const errores = []; p.on("pageerror", (e) => errores.push(e.message));
  await p.goto(APP + "/");
  for (const t of ["Tus apuntes", "Tu simulacro", "Cómo funciona", "Pase de examen", "Precios"]) if (!(await p.textContent("main")).includes(t)) falla(`falta "${t}" en la portada`);
  if (await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) falla("la portada desborda en móvil");
  paso(`portada en móvil: concepto, pasos y 3 precios (${(await p.textContent("#precioPase")).trim()} / ${(await p.textContent("#precio")).trim()}) sin desbordar`);
  await p.click("text=Comprar el pase");
  await p.waitForSelector("#enviar");
  await p.fill("#email", `portada${Date.now()}@test.local`); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  // Venía de "Comprar el pase" (/app?pase=1): al registrarse va directo al pago del pase
  await p.waitForSelector("#stripe-embedded, .opcion.on", { timeout: 20000 }).catch(async () => { await p.screenshot({ path: PROJ + "/tests/e2e/capturas/portada-fallo.png" }); falla("no se abre el pago; url: " + p.url()) });
  const marcada = (await p.textContent(".opcion.on")).replace(/\s+/g, " ");
  if (!/Pase de examen/.test(marcada)) falla(`opción marcada: ${marcada}`);
  paso(`"Comprar el pase" → registro → pago con "${marcada.slice(0, 40)}…" marcado`);
  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS"); await b.close();
  if (errores.length) process.exit(1);
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
