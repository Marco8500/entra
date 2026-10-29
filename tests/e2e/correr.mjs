// Ejecuta todos los flujos de navegador (Playwright) uno detrás de otro y resume el resultado.
// Requisitos: `npx supabase start`, `npm run mocks` y `npx wrangler dev --port 8888` (ver tests/README.md).
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const solo = process.argv.slice(2);
const flujos = readdirSync(dir).filter((f) => /^flujo-.*\.cjs$/.test(f) && (!solo.length || solo.some((s) => f.includes(s)))).sort();
const fallos = [];
for (const f of flujos) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [dir + f], { encoding: "utf8", timeout: 300_000 });
  const ok = r.status === 0;
  console.log(`${ok ? "✔" : "✘"} ${f} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (!ok) { fallos.push(f); console.log((r.stdout + r.stderr).split("\n").slice(-6).map((l) => "    " + l).join("\n")) }
}
console.log(`\n${flujos.length - fallos.length}/${flujos.length} flujos correctos`);
process.exit(fallos.length ? 1 : 0);
