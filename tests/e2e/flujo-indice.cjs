// PDF con texto → modo índice: la IA da las líneas de inicio y el contenido sale literal del PDF
const { chromium } = require("playwright");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", APP = "http://localhost:8888";
const paso = (m) => console.log("✔", m);
require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(); const ctx = await b.newContext({ locale: "es-ES", viewport: { width: 420, height: 900 } });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", (r) => r.fulfill({ path: PROJ + "/node_modules/pdfjs-dist/build/pdf.min.js", contentType: "text/javascript" }));
  await ctx.route("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js", (r) => r.fulfill({ path: PROJ + "/node_modules/pdfjs-dist/build/pdf.worker.min.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(60000); const errores = []; p.on("pageerror", (e) => errores.push(e.message));
  let enviado = null; p.on("request", (r) => { if (r.url().endsWith("/api/leer")) enviado = JSON.parse(r.postData()) });
  await p.goto(APP + "/app"); await p.waitForSelector("#enviar");
  await p.fill("#email", `indice${Date.now()}@test.local`); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#analyze");
  await p.setInputFiles("#file", FIX + "/texto.pdf"); const t0 = Date.now(); await p.click("#analyze"); await p.waitForSelector(".topic");
  paso(`enviado: indice=${enviado.indice}, primeras líneas: ${JSON.stringify(enviado.texto.split("\n").slice(0, 3))}`);
  const temas = await p.$$eval(".topic", (ts) => ts.map((t) => t.querySelector("input[type=text], .titulo, b, h3")?.value || t.textContent.replace(/\s+/g, " ").slice(0, 120)));
  paso(`${temas.length} temas en ${((Date.now() - t0) / 1000).toFixed(1)} s:\n   ` + temas.join("\n   "));
  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS"); await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
