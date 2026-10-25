// Utilidades compartidas por las funciones de Entra
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const LIMITES = {
  free: { simulacros: 3, paginas: 15, bloques: 20 },
  pro: { simulacros: 60, paginas: 300, bloques: 400 },
};

export const MODELO = process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";
export const MODELO_RAPIDO = process.env.ANTHROPIC_MODEL_FAST || "claude-haiku-5-5";

export const admin = () =>
  createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

// Cliente de Stripe. STRIPE_API_URL solo se usa en local para apuntar a un simulador.
export const stripeClient = () => {
  const u = process.env.STRIPE_API_URL ? new URL(process.env.STRIPE_API_URL) : null;
  return new Stripe(process.env.STRIPE_SECRET_KEY, u ? { host: u.hostname, port: u.port, protocol: u.protocol.replace(":", "") } : undefined);
};

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const error = (code, mensaje, status = 400) => json({ error: code, mensaje }, status);

export const mesActual = () => new Date().toISOString().slice(0, 7);

export const planDe = (user, perfil) => (perfil?.plan === "pro" ? "pro" : "free");

/** Mensaje y código de error cuando se acaba el cupo del mes */
export function errorLimite(plan, que, n, nombre = que) {
  if (plan === "pro") return error(`limite_${que}`, `Has llegado al máximo de ${nombre} de este mes.`, 402);
  return error(`limite_${que}`, `El plan gratis incluye ${n} ${nombre} al mes. Pásate a Pro para seguir.`, 402);
}

/** Comprueba el token de Supabase y devuelve {user, plan, uso, limite} o una Response de error */
export async function autenticar(req) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return { fallo: error("no_auth", "Inicia sesión para continuar.", 401) };
  const db = admin();
  const { data, error: e } = await db.auth.getUser(token);
  if (e || !data?.user) return { fallo: error("no_auth", "Tu sesión ha caducado. Vuelve a entrar.", 401) };
  const user = data.user;
  const { data: perfil } = await db.from("perfiles").select("plan, acepto_terminos_at").eq("id", user.id).maybeSingle();
  if (!perfil?.acepto_terminos_at) return { fallo: error("terminos", "Acepta los términos para usar Entra.", 403) };
  const plan = planDe(user, perfil);
  const { data: uso } = await db.from("uso").select("simulacros, paginas, bloques").eq("user_id", user.id).eq("mes", mesActual()).maybeSingle();
  return { user, plan, db, uso: uso || { simulacros: 0, paginas: 0, bloques: 0 }, limite: LIMITES[plan] };
}

export async function sumarUso(db, userId, { simulacros = 0, paginas = 0, bloques = 0 }) {
  await db.rpc("sumar_uso", { p_user: userId, p_mes: mesActual(), p_sim: simulacros, p_pag: paginas, p_blo: bloques });
}

/**
 * Llama a la API de Claude en streaming y devuelve una Response que va
 * enviando el texto al navegador según se escribe (evita los límites de
 * tiempo de las funciones normales).
 */
export function streamClaude({ content, model = MODELO, maxTokens = 8000, onDone }) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        const r = await fetch((process.env.ANTHROPIC_API_URL || "https://api.anthropic.com") + "/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({ model, max_tokens: maxTokens, stream: true, messages: [{ role: "user", content }] }),
        });
        if (!r.ok || !r.body) {
          const t = await r.text().catch(() => "");
          console.error("Anthropic error", r.status, t.slice(0, 500));
          controller.enqueue(enc.encode(`\n[[ERROR:${r.status === 429 || r.status === 529 ? "ocupado" : "ia"}]]`));
          controller.close();
          return;
        }
        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "", ok = false;
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const evt = buf.slice(0, i); buf = buf.slice(i + 2);
            const line = evt.split("\n").find((l) => l.startsWith("data:"));
            if (!line) continue;
            let d; try { d = JSON.parse(line.slice(5)); } catch { continue; }
            if (d.type === "content_block_delta" && d.delta?.type === "text_delta") {
              ok = true;
              controller.enqueue(enc.encode(d.delta.text));
            } else if (d.type === "error") {
              controller.enqueue(enc.encode(`\n[[ERROR:ia]]`));
            }
          }
        }
        if (ok && onDone) await onDone().catch((e) => console.error("onDone", e));
        controller.close();
      } catch (e) {
        console.error(e);
        try { controller.enqueue(enc.encode(`\n[[ERROR:ia]]`)); controller.close(); } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

export const texto = (s, max = 60000) => String(s ?? "").slice(0, max);
