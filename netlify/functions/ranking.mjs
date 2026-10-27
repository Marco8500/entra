// GET /api/ranking · top 5 del mes para la portada (público, en caché 5 minutos)
import { admin, json } from "../lib/entra.mjs";

export default async () => {
  const { data, error } = await admin().rpc("ranking_publico");
  if (error) console.error("ranking_publico", error.message);
  const r = json({ mes: new Date().toLocaleDateString("es-ES", { month: "long" }), top: data || [] });
  r.headers.set("cache-control", "public, max-age=300");
  return r;
};

export const config = { path: "/api/ranking" };
