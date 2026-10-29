// POST /api/leer · lee fotos y/o texto de apuntes y devuelve los temas (JSON en streaming)
import { autenticar, error, errorLimite, streamIA, sumarUso, texto } from "../lib/entra.mjs";

const MAX_FOTOS = 4;
const TIPOS = ["image/jpeg", "image/png", "image/webp", "image/gif"];

const PROMPT = (pegado) => `Eres el lector de apuntes de Entra, una web de simulacros para estudiantes españoles (FP, bachillerato, universidad, oposiciones).
Te paso fotos de apuntes${pegado ? " y/o texto (pegado o sacado de un PDF)" : ""}. Extrae cada apartado o tema con contenido estudiable.
Reglas:
- Ignora portadas e índices, pero úsalos para saber la unidad.
- "entra": true si el alumno anotó que entra (p. ej. "✱ Entra", "Entra (test)"), false si anotó "No entra", null si no hay anotación.
- Si un apartado ocupa varias páginas con la misma anotación, júntalo en un solo tema.
- "contenido": resumen fiel y completo de 60-220 palabras con TODOS los datos examinables: definiciones, cifras, listas, clasificaciones, ejemplos y las anotaciones a mano. No inventes nada.
- "notas": anotaciones sobre el examen ("pregunta corta", "test", "importante", "no lo ha preguntado") o "".
- Si las imágenes no son apuntes, devuelve "temas": [].
Responde SOLO con JSON:
{"asignatura":"...","temas":[{"titulo":"...","unidad":"...","entra":true,"contenido":"...","notas":"..."}]}
${pegado ? "\nTexto de los apuntes del alumno:\n" + pegado : ""}`;

// Modo índice (solo texto): las líneas llegan numeradas ("12| ...") y la IA solo dice dónde empieza cada tema.
// El contenido lo corta el navegador del propio texto: mucho más rápido y sin resumir nada.
const PROMPT_INDICE = (lineas) => `Eres el lector de apuntes de Entra, una web de simulacros para estudiantes españoles.
Te paso el texto de unos apuntes con cada línea numerada ("N| texto"). Divide el texto en sus apartados o temas estudiables.
Reglas:
- "linea": número de la línea donde EMPIEZA cada tema (su título). En orden, sin repetir.
- Ignora portadas, índices y bibliografía: no los pongas como tema.
- Si un apartado es muy corto, únelo al tema anterior (no lo pongas).
- "titulo": título corto del tema. "unidad": la unidad o bloque si aparece, si no "".
- "entra": true si el texto dice que entra en el examen (p. ej. "✱ Entra", "Entra (test)"), false si dice "No entra", null si no dice nada.
- "notas": indicaciones sobre el examen que aparezcan ("pregunta corta", "test", "importante") o "".
Responde SOLO con JSON, sin el contenido de los temas:
{"asignatura":"...","temas":[{"linea":12,"titulo":"...","unidad":"...","entra":null,"notas":""}]}

Texto:
${lineas}`;

export default async (req) => {
  if (req.method !== "POST") return error("metodo", "Usa POST.", 405);
  const a = await autenticar(req);
  if (a.fallo) return a.fallo;
  let body;
  try { body = await req.json(); } catch { return error("json", "Petición mal formada."); }

  const fotos = Array.isArray(body.fotos) ? body.fotos.slice(0, MAX_FOTOS) : [];
  const pegado = texto(body.texto, 60000).trim();
  if (!fotos.length && !pegado) return error("vacio", "Sube una foto o pega texto.");
  for (const f of fotos) {
    if (!TIPOS.includes(f?.tipo) || typeof f?.base64 !== "string" || f.base64.length > 2_500_000)
      return error("foto", "Alguna foto no es válida o es demasiado grande.");
  }
  // Páginas que cuentan para el límite: fotos, páginas de PDF que vienen como texto (máx. 8 por lote)
  // y, para texto pegado largo, una página por cada 5.000 caracteres
  const paginas = Math.max(1, fotos.length, Math.min(8, parseInt(body.paginas) || 0), Math.ceil(pegado.length / 5000));
  if (a.uso.paginas + paginas > a.limite.paginas)
    return errorLimite(a.plan, "paginas", a.limite.paginas, "páginas");

  const indice = body.indice === true && !fotos.length;
  const content = indice ? [{ type: "text", text: PROMPT_INDICE(pegado) }] : [
    ...fotos.map((f) => ({ type: "image", source: { type: "base64", media_type: f.tipo, data: f.base64 } })),
    { type: "text", text: PROMPT(pegado) },
  ];
  return streamIA({ ruta: indice ? "leer-indice" : "leer",
    content,
    maxTokens: indice ? 2000 : 6000,
    onDone: () => sumarUso(a.db, a.user.id, { paginas }),
  });
};

export const config = { path: "/api/leer" };
