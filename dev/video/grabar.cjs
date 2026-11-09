// Graba dev/video/promo.html en MP4 vertical (1080×1920, 30 fps) para TikTok.
// Uso: node dev/video/grabar.cjs <salida.mp4>            → vídeo
//      node dev/video/grabar.cjs <carpeta> 1 4.6 8.6 11.5 → solo esos segundos en PNG (para revisar)
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");
const DIR = __dirname, FPS = 30;
const [,, salida, ...momentos] = process.argv;
const tipos = { ".html": "text/html", ".svg": "image/svg+xml" };
const srv = http.createServer((q, r) => {
  const f = path.join(DIR, path.basename(new URL(q.url, "http://x").pathname) || "promo.html");
  if (!fs.existsSync(f)) { r.writeHead(404); return r.end() }
  r.writeHead(200, { "content-type": tipos[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(r);
}).listen(0);
(async () => {
  const b = await chromium.launch();
  const pg = await (await b.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
  await pg.goto(`http://127.0.0.1:${srv.address().port}/promo.html`, { waitUntil: "networkidle" });
  await pg.evaluate(() => document.fonts.ready);
  if (momentos.length) {
    fs.mkdirSync(salida, { recursive: true });
    for (const s of momentos) { await pg.evaluate((t) => pintar(t), +s); await pg.screenshot({ path: `${salida}/t${s}.png` }) }
  } else {
    const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "entra-video-"));
    const n = Math.round((await pg.evaluate(() => DURACION)) * FPS);
    for (let i = 0; i < n; i++) {
      await pg.evaluate((t) => pintar(t), i / FPS);
      await pg.screenshot({ path: `${tmp}/f${String(i).padStart(4, "0")}.png` });
    }
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FPS), "-i", `${tmp}/f%04d.png`,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "18", "-preset", "slow", "-movflags", "+faststart", salida]);
    fs.rmSync(tmp, { recursive: true });
    console.log(`${salida}: ${n} fotogramas, ${n / FPS} s`);
  }
  await b.close(); srv.close();
})().catch((e) => { console.error(e); process.exit(1) });
