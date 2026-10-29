// Pago Pro integrado + webhook de Stripe (simulado) en el servidor de Cloudflare
const { chromium } = require("playwright");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas";
require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: "es-ES" });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs/, (r) => r.fulfill({ body: "" }));
  const page = await ctx.newPage(); page.setDefaultTimeout(40000);
  const errores = []; page.on("pageerror", (e) => errores.push(e.message));
  await page.goto("http://localhost:8888/app"); await page.waitForSelector("#enviar");
  await page.fill("#email", `pago${Date.now()}@test.local`); await page.fill("#clave", "MiClave2026"); await page.check("#acepto"); await page.click("#enviar");
  await page.waitForSelector("#analyze");
  await page.click("#avatar"); await page.click("#perfilMenu >> text=Pasarme a Pro"); await page.waitForSelector("#stripe-embedded");
  const f = page.frameLocator("#stripe-embedded");
  await f.locator("#name").fill("Alumna Prueba"); await f.locator("#address").fill("Calle Mayor 1"); await f.locator("#card").fill("4242424242424242"); await f.locator("#paybtn").click();
  await page.waitForSelector("#account .pill.pro", { timeout: 60000 });
  console.log("✔ pago integrado → webhook → cuenta Pro:", (await page.textContent("#account")).replace(/\s+/g, " ").trim());
  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS"); await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
