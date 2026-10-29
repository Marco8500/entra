// Un trozo del documento falla con 500 en el servidor: se reintenta y no se pierde lo demás
const { chromium } = require("playwright");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", APP = "http://localhost:8888";
const paso = (m) => console.log("✔", m);
require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: "es-ES", viewport: { width: 420, height: 900 } });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", (r) => r.fulfill({ path: PROJ + "/node_modules/pdfjs-dist/build/pdf.min.js", contentType: "text/javascript" }));
  await ctx.route("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js", (r) => r.fulfill({ path: PROJ + "/node_modules/pdfjs-dist/build/pdf.worker.min.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, (r) => r.fulfill({ body: "" }));
  // El primer /api/leer devuelve 500 (como cuando Cloudflare corta la función); los demás pasan
  let n = 0, fallados = 0;
  await ctx.route("**/api/leer", (r) => { n++; if (n === 1) { fallados++; return r.fulfill({ status: 500, body: "error code: 1102" }) } return r.continue() });
  const p = await ctx.newPage(); p.setDefaultTimeout(120000); const errores = []; p.on("pageerror", (e) => errores.push(e.message));
  await p.goto(APP + "/app"); await p.waitForSelector("#enviar");
  await p.fill("#email", `lote${Date.now()}@test.local`); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#analyze");
  await p.setInputFiles("#file", [FIX + "/escaneado.pdf", FIX + "/apuntes.jpg", FIX + "/apuntes.jpg"]);
  const t0 = Date.now(); await p.click("#analyze");
  await p.waitForFunction(() => /Reintento/.test(document.querySelector("#busySub")?.textContent || ""), null, { timeout: 30000 });
  paso(`tras el 500: "${await p.textContent("#busySub")}"`);
  await p.waitForSelector(".topic");
  paso(`apuntes leídos igualmente en ${Math.round((Date.now() - t0) / 1000)} s: ${(await p.$$(".topic")).length} temas · peticiones a /api/leer: ${n} (falló ${fallados} y se reintentó)`);
  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS");
  await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
