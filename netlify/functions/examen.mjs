// POST /api/examen · genera un bloque de preguntas (el navegador pide varios bloques en paralelo)
// body: { temas:[{titulo,contenido,notas}], test:n, cortas:n, opciones:n, bloque:i, nuevo:bool, evitar:[preguntas] }
import { autenticar, error, errorLimite, streamIA, sumarUso, texto } from "../lib/entra.mjs";

export default async (req) => {
  if (req.method !== "POST") return error("metodo", "Usa POST.", 405);
  const a = await autenticar(req);
  if (a.fallo) return a.fallo;
  let b;
  try { b = await req.json(); } catch { return error("json", "Petición mal formada."); }

  const temas = (Array.isArray(b.temas) ? b.temas : []).slice(0, 40)
    .map((t) => ({ titulo: texto(t.titulo, 200), contenido: texto(t.contenido, 8000), notas: texto(t.notas, 300) }))
    .filter((t) => t.titulo && t.contenido);
  const test = Math.max(0, Math.min(15, parseInt(b.test) || 0));
  const cortas = Math.max(0, Math.min(10, parseInt(b.cortas) || 0));
  const opciones = Math.max(3, Math.min(5, parseInt(b.opciones) || 4));
  if (!temas.length) return error("temas", "No hay temas que entren.");
  if (!test && !cortas) return error("vacio", "Pide al menos una pregunta.");

  // Cuenta un simulacro solo con el primer bloque de un examen nuevo
  const cuenta = b.nuevo === true;
  if (cuenta && a.uso.simulacros >= a.limite.simulacros)
    return errorLimite(a.plan, "simulacros", a.limite.simulacros);

  if (a.uso.bloques >= a.limite.bloques)
    return error("limite_simulacros", "Has llegado al máximo de preguntas de este mes.", 402);

  const evitar = (Array.isArray(b.evitar) ? b.evitar : []).slice(0, 60).map((x) => "- " + texto(x, 200)).join("\n");
  const lista = temas.map((t, i) => `TEMA ${i + 1}: ${t.titulo}${t.notas ? ` [anotación del alumno: ${t.notas}]` : ""}\n${t.contenido}`).join("\n\n");

  const prompt = `Eres el profesor que prepara simulacros en Entra. Crea preguntas de examen en español usando SOLO el contenido de estos temas (no añadas datos de fuera).

${lista}

Pide exactamente:
- ${test} preguntas tipo test, cada una con ${opciones} opciones y UNA correcta. Distractores plausibles (cifras cercanas, conceptos que se confunden). Varía la posición de la correcta.
- ${cortas} preguntas de respuesta corta que se respondan en 2-4 líneas.
- Reparte entre los temas; más peso a los anotados como "importante", "test" o "pregunta corta" (estas, mejor como corta).
- Sin la respuesta en el enunciado.${evitar ? `\n- NO repitas ni parafrasees estas preguntas ya hechas:\n${evitar}` : ""}
Responde SOLO con JSON:
{"test":[{"pregunta":"...","opciones":["..."],"correcta":0,"tema":"título exacto del tema","explicacion":"una frase"}],
 "cortas":[{"pregunta":"...","tema":"título exacto del tema","respuestaModelo":"...","puntosClave":["..."]}]}`;

  return streamIA({ ruta: "examen",
    content: [{ type: "text", text: prompt }],
    maxTokens: 7000,
    onDone: async () => {
      await sumarUso(a.db, a.user.id, { simulacros: cuenta ? 1 : 0, bloques: 1 });
      // Primer simulacro de alguien invitado: premio para los dos (la función ignora el resto de casos)
      if (cuenta) {
        const { error: e } = await a.db.rpc("premiar_invitacion", { p_user: a.user.id });
        if (e) console.error("premiar_invitacion", a.user.id, e.message);
      }
    },
  });
};

export const config = { path: "/api/examen" };
