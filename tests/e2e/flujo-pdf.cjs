// Subir PDF: con texto (se envía el texto), escaneado (se envían imágenes), mezcla con foto, y PDF demasiado largo
const { chromium } = require("playwright");
const fs = require("fs");
const PROJ = require("path").resolve(__dirname, "../.."), FIX = PROJ + "/tests/fixtures", OUT = PROJ + "/tests/e2e/capturas", S = "http://127.0.0.1:54321";
const K = fs.readFileSync(PROJ + "/.dev.vars", "utf8").match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)[1].trim();
const paso = (m) => console.log("✔", m);

require("fs").mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ locale: "es-ES", viewport: { width: 420, height: 860 }, deviceScaleFactor: 2 });
  await ctx.route("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/**", (r) => r.fulfill({ path: PROJ + "/node_modules/@supabase/supabase-js/dist/umd/supabase.js", contentType: "text/javascript" }));
  await ctx.route("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", (r) => r.fulfill({ path: PROJ + "/node_modules/pdfjs-dist/build/pdf.min.js", contentType: "text/javascript" }));
  await ctx.route("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js", (r) => r.fulfill({ path: PROJ + "/node_modules/pdfjs-dist/build/pdf.worker.min.js", contentType: "text/javascript" }));
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|cdnjs\.cloudflare\.com\/ajax\/libs\/jspdf/, (r) => r.fulfill({ body: "" }));
  const p = await ctx.newPage(); p.setDefaultTimeout(60000);
  const errores = []; p.on("pageerror", (e) => errores.push("JS " + e.message));
  let lotes = []; p.on("request", (r) => { if (r.url().endsWith("/api/leer")) { const j = JSON.parse(r.postData()); lotes.push({ fotos: j.fotos.length, paginas: j.paginas, texto: j.texto.length, muestra: j.texto.slice(0, 60).replace(/\n/g, " ") }) } });

  await p.goto("http://localhost:8888/app"); await p.waitForSelector("#enviar");
  await p.fill("#email", `pdf${Date.now()}@test.local`); await p.fill("#clave", "MiClave2026"); await p.check("#acepto"); await p.click("#enviar");
  await p.waitForSelector("#analyze");
  const uid = await p.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => k.includes("auth-token")))).user.id);
  const usoPag = async () => ((await (await fetch(`${S}/rest/v1/uso?user_id=eq.${uid}&select=paginas`, { headers: { apikey: K, authorization: `Bearer ${K}` } })).json())[0]?.paginas || 0);

  // 1. PDF con texto (3 páginas)
  await p.setInputFiles("#file", FIX + "/texto.pdf");
  paso(`miniatura del PDF: "${(await p.textContent("#thumbs")).replace(/×/g, "").trim()}"`);
  await p.screenshot({ path: OUT + "/pdf-miniatura.png" });
  await p.click("#analyze"); await p.waitForSelector(".topic");
  paso(`PDF con texto → enviado como texto: ${JSON.stringify(lotes)}; páginas contadas: ${await usoPag()}`);

  // 2. PDF escaneado (2 páginas de imagen) + una foto
  lotes = []; await p.click("#back"); await p.waitForSelector("#analyze");
  await p.setInputFiles("#file", [FIX + "/escaneado.pdf", FIX + "/apuntes.jpg"]);
  await p.click("#analyze"); await p.waitForSelector(".topic");
  paso(`PDF escaneado + foto → enviados como imágenes: ${JSON.stringify(lotes.map((l) => ({ fotos: l.fotos, texto: l.texto })))}; páginas contadas: ${await usoPag()}`);

  // 3. PDF de 70 páginas → aviso, sin llamar a la IA
  lotes = []; await p.click("#back"); await p.waitForSelector("#analyze");
  await p.setInputFiles("#file", FIX + "/largo.pdf"); await p.click("#analyze");
  await p.waitForSelector("#msg .error, #view .error");
  paso(`PDF de 70 páginas: "${await p.textContent("#msg")}" (peticiones a la IA: ${lotes.length})`);

  console.log(errores.length ? "Errores: " + errores.join(" | ") : "Sin errores de JS");
  await b.close();
})().catch((e) => { console.error("✘", e.message); process.exit(1) });
