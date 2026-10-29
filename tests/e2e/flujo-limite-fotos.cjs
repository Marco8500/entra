const { chromium } = require("playwright");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", APP = "http://localhost:8888";
require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: "es-ES" });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); let llamadas = 0; p.on("request", (r) => { if (r.url().endsWith("/api/leer")) llamadas++ });
  await p.goto(APP + "/app"); await p.waitForSelector("#enviar");
  await p.fill("#email", `lim${Date.now()}@test.local`); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#analyze");
  console.log("✔ aviso en la caja:", (await p.textContent("#drop")).replace(/\s+/g, " ").trim());
  const fs = require("fs"); const dir = OUT + "/16fotos"; fs.mkdirSync(dir, { recursive: true }); const fotos = [];
  for (let i = 0; i < 16; i++) { const f = `${dir}/f${i}.jpg`; fs.copyFileSync(FIX + "/apuntes.jpg", f); fotos.push(f) }
  await p.setInputFiles("#file", fotos); await p.click("#analyze"); await p.waitForSelector("#msg .error, #view .error");
  console.log(`✔ 16 fotos: "${await p.textContent("#msg")}" (peticiones a la IA: ${llamadas})`);
  await p.reload(); await p.waitForSelector("#analyze"); // las fotos se acumulan: empezamos de cero
  await p.setInputFiles("#file", fotos.slice(0, 3)); await p.click("#analyze"); await p.waitForSelector(".topic");
  console.log("✔ 3 fotos se leen bien");
  await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
