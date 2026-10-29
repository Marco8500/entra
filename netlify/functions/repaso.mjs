// POST /api/repaso · hoja de repaso de los temas flojos con trucos y búsquedas de YouTube
// body: { asignatura, temas:[{titulo, contenido}], fallos:[texto] }
import { autenticar, error, streamIA, texto, MODELO_RAPIDO } from "../lib/entra.mjs";

export default async (req) => {
  if (req.method !== "POST") return error("metodo", "Usa POST.", 405);
  const a = await autenticar(req);
  if (a.fallo) return a.fallo;
  let b;
  try { b = await req.json(); } catch { return error("json", "Petición mal formada."); }
  const temas = (Array.isArray(b.temas) ? b.temas : []).slice(0, 12);
  if (!temas.length) return error("vacio", "No hay temas flojos.");
  const fallos = (Array.isArray(b.fallos) ? b.fallos : []).slice(0, 40).map((f) => "- " + texto(f, 400)).join("\n");

  const prompt = `Eres el tutor de Entra. El alumno ha flojeado en estos temas de "${texto(b.asignatura, 200)}". Prepara un repaso corto usando solo el contenido dado.

${temas.map((t) => `TEMA: ${texto(t.titulo, 200)}\n${texto(t.contenido, 4000)}`).join("\n\n")}

Preguntas que falló:
${fallos || "(solo respuestas cortas flojas)"}

Para cada tema: "resumen" de 60-110 palabras centrado en lo que falló; "claves": 3 trucos o reglas para memorizar (cortos, tipo "Discontinuo → Dosímetro"); "busquedas": 2 búsquedas de YouTube en español que den vídeos explicativos de ese tema a nivel FP/bachillerato.
Responde SOLO con JSON: [{"tema":"...","resumen":"...","claves":["..."],"busquedas":["..."]}]`;

  return streamIA({ ruta: "repaso", content: [{ type: "text", text: prompt }], maxTokens: 5000, model: MODELO_RAPIDO,
    validar: (r) => Array.isArray(r) && r.length > 0 && r.every((x) => x?.tema && x?.resumen) });
};

export const config = { path: "/api/repaso" };
