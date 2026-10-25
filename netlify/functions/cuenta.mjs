// GET /api/cuenta · plan y uso del mes para mostrar en la app
import { admin, error, json, LIMITES, mesActual } from "../lib/entra.mjs";

export default async (req) => {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const db = admin();
  const { data } = await db.auth.getUser(token);
  const user = data?.user;
  if (!user) return error("no_auth", "Inicia sesión para continuar.", 401);
  const { data: perfil } = await db.from("perfiles").select("plan, acepto_terminos_at").eq("id", user.id).maybeSingle();
  const { data: uso } = await db.from("uso").select("simulacros, paginas").eq("user_id", user.id).eq("mes", mesActual()).maybeSingle();
  const plan = perfil?.plan === "pro" ? "pro" : "free";
  return json({
    email: user.email,
    plan,
    terminos: !!perfil?.acepto_terminos_at,
    uso: uso || { simulacros: 0, paginas: 0 },
    limite: LIMITES[plan],
  });
};

export const config = { path: "/api/cuenta" };
