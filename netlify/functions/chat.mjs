// POST /api/chat · tutor de Entra: reenvía la pregunta al escenario de Make (webhook → IA → respuesta)
// body: { mensaje, historial:[{de:"alumno"|"tutor", texto}], contexto }
import { autenticar, error, json, texto } from "../lib/entra.mjs";

export default async (req) => {
  if (req.method !== "POST") return error("metodo", "Usa POST.", 405);
  if (!process.env.MAKE_CHAT_URL) return error("chat_off", "El tutor no está disponible ahora mismo.", 503);
  const a = await autenticar(req);
  if (a.fallo) return a.fallo;
  let b;
  try { b = await req.json(); } catch { return error("json", "Petición mal formada."); }
  const mensaje = texto(b.mensaje, 1000).trim();
  if (!mensaje) return error("vacio", "Escribe tu pregunta.");
  if (a.uso.mensajes >= a.limite.mensajes)
    return error("limite_mensajes", a.plan === "pro"
      ? "Has llegado al máximo de mensajes al tutor de este mes."
      : `El plan gratis incluye ${a.limite.mensajes} mensajes al tutor al mes. Pásate a Pro para seguir.`, 402);

  const historial = (Array.isArray(b.historial) ? b.historial : []).slice(-8)
    .map((m) => `${m?.de === "tutor" ? "Tutor" : "Alumno"}: ${texto(m?.texto, 600)}`).join("\n");
  try {
    const r = await fetch(process.env.MAKE_CHAT_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mensaje, historial, contexto: texto(b.contexto, 4000), plan: a.plan === "pro" ? "Pro" : "Gratis" }),
      signal: AbortSignal.timeout(40000),
    });
    const respuesta = (await r.text()).trim();
    // "Accepted" = el escenario de Make está apagado y la petición se ha quedado en cola
    if (!r.ok || !respuesta || respuesta === "Accepted") {
      console.error("Make chat", r.status, respuesta.slice(0, 200));
      return error("chat_off", "El tutor no está disponible ahora mismo. Prueba más tarde.", 503);
    }
    await a.db.rpc("sumar_mensaje", { p_user: a.user.id, p_mes: new Date().toISOString().slice(0, 7) });
    return json({ respuesta });
  } catch (e) {
    console.error("Make chat", e);
    return error("chat_off", "El tutor tarda demasiado en responder. Prueba otra vez.", 504);
  }
};

export const config = { path: "/api/chat" };
