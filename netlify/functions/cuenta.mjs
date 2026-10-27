// GET /api/cuenta · plan y uso del mes para mostrar en la app
import { admin, error, json, limiteDe, mesActual, pasoActivo, planDe } from "../lib/entra.mjs";

export default async (req) => {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const db = admin();
  const { data } = await db.auth.getUser(token);
  const user = data?.user;
  if (!user) return error("no_auth", "Inicia sesión para continuar.", 401);
  const { data: perfil } = await db.from("perfiles").select("plan, pro_hasta, acepto_terminos_at, extra_simulacros, extra_paginas, codigo, alias, en_ranking").eq("id", user.id).maybeSingle();
  const { data: uso } = await db.from("uso").select("simulacros, paginas, mensajes").eq("user_id", user.id).eq("mes", mesActual()).maybeSingle();
  const plan = planDe(user, perfil);
  return json({
    email: user.email,
    plan,
    suscrito: perfil?.plan === "pro",
    proHasta: pasoActivo(perfil) ? perfil.pro_hasta : null,
    terminos: !!perfil?.acepto_terminos_at,
    uso: uso || { simulacros: 0, paginas: 0, mensajes: 0 },
    avatar: user.user_metadata?.avatar_url || user.user_metadata?.picture || null,
    nombre: user.user_metadata?.full_name || user.user_metadata?.name || null,
    limite: limiteDe(plan, perfil),
    extra: { simulacros: perfil?.extra_simulacros || 0, paginas: perfil?.extra_paginas || 0 },
    codigo: perfil?.codigo || null,
    alias: perfil?.alias || null,
    enRanking: !!perfil?.en_ranking,
  });
};

export const config = { path: "/api/cuenta" };
