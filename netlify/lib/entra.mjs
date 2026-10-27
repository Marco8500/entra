// Utilidades compartidas por las funciones de Entra
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

export const LIMITES = {
  free: { simulacros: 3, paginas: 25, bloques: 20, mensajes: 20 },
  pro: { simulacros: 60, paginas: 300, bloques: 400, mensajes: 200 },
};

// Variables de entorno: en Netlify vienen en process.env; en Cloudflare las pasa functions/_lib.js
export const env = (k) => globalThis.__ENTRA_ENV?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);
const lista = (v) => (v || "").split(",").map((x) => x.trim()).filter(Boolean);

// Modelo "normal" (leer apuntes, examen) o "rápido" (corregir, repaso)
export const MODELO = "normal";
export const MODELO_RAPIDO = "rapido";

/**
 * Proveedores de IA, en orden de preferencia (IA_ORDEN, separado por comas). Solo se usan los que tienen clave.
 * Todos menos Anthropic y Cloudflare hablan el formato de OpenAI. Si uno está saturado o sin cupo, se pasa al
 * siguiente al momento; así un pico en uno no deja la web parada.
 */
function proveedores() {
  const todos = {
    mistral: { url: env("MISTRAL_API_URL") || "https://api.mistral.ai/v1", clave: env("MISTRAL_API_KEY"), vision: true, imagenComoTexto: true,
      normal: lista(env("MISTRAL_MODELOS") || "mistral-medium-latest,mistral-small-latest"),
      rapido: lista(env("MISTRAL_MODELOS_RAPIDO") || "mistral-small-latest") },
    groq: { url: env("GROQ_API_URL") || "https://api.groq.com/openai/v1", clave: env("GROQ_API_KEY"), vision: false, razonamiento: "low",
      normal: lista(env("GROQ_MODELOS") || "openai/gpt-oss-120b"),
      rapido: lista(env("GROQ_MODELOS_RAPIDO") || "openai/gpt-oss-20b,openai/gpt-oss-120b") },
    groqVision: { url: env("GROQ_API_URL") || "https://api.groq.com/openai/v1", clave: env("GROQ_API_KEY"), vision: true, soloFotos: true,
      normal: lista(env("GROQ_MODELOS_VISION") || "meta-llama/llama-4-scout-17b-16e-instruct"), rapido: [] },
    gemini: { url: env("GEMINI_API_URL") || "https://generativelanguage.googleapis.com/v1beta/openai", clave: env("GEMINI_API_KEY"), vision: true,
      razonamiento: env("IA_RAZONAMIENTO") ?? "low",
      normal: lista(env("GEMINI_MODELOS") || "gemini-3.5-flash,gemini-3-flash-preview,gemini-flash-lite-latest"),
      rapido: lista(env("GEMINI_MODELOS_RAPIDO") || "gemini-flash-lite-latest,gemini-3.1-flash-lite") },
    // IA de Cloudflare (Workers AI): sin clave, va por el enlace "AI" del proyecto. 10.000 "neuronas" gratis al día.
    cloudflare: { workersAI: globalThis.__ENTRA_AI, clave: globalThis.__ENTRA_AI ? "enlace" : "", vision: true,
      normal: lista(env("CF_MODELOS") || "@cf/meta/llama-4-scout-17b-16e-instruct"),
      rapido: lista(env("CF_MODELOS_RAPIDO") || "@cf/meta/llama-4-scout-17b-16e-instruct") },
    anthropic: { anthropic: true, url: env("ANTHROPIC_API_URL") || "https://api.anthropic.com", clave: env("ANTHROPIC_API_KEY"), vision: true,
      normal: lista(env("ANTHROPIC_MODEL") || "claude-sonnet-5-5"), rapido: lista(env("ANTHROPIC_MODEL_FAST") || "claude-haiku-5-5") },
  };
  const orden = lista(env("IA_ORDEN") || "mistral,groq,groqVision,gemini,cloudflare,anthropic");
  return orden.map((n) => todos[n] && { nombre: n, ...todos[n] }).filter((p) => p && p.clave);
}

// Proveedores/modelos que acaban de dar 429/503: se saltan un rato para no perder tiempo con ellos
const enfriando = new Map();
const ENFRIAR_MS = 60_000;

/** Lista de intentos {proveedor, modelo} para una petición */
function cadena(model, conFotos) {
  const intentos = [];
  for (const p of proveedores()) {
    if (conFotos && !p.vision) continue;
    if (!conFotos && p.soloFotos) continue;
    const k = model === MODELO_RAPIDO ? "rapido" : "normal";
    for (const m of p[k].length ? p[k] : p.normal) intentos.push({ p, m });
  }
  const ahora = Date.now();
  const libres = intentos.filter((i) => !(enfriando.get(i.p.nombre + i.m) > ahora));
  return libres.length ? libres : intentos; // si todos están enfriando, se prueban igual
}

export const admin = () =>
  createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

// Cliente de Stripe. STRIPE_API_URL solo se usa en local para apuntar a un simulador.
export const stripeClient = () => {
  const u = env("STRIPE_API_URL") ? new URL(env("STRIPE_API_URL")) : null;
  return new Stripe(env("STRIPE_SECRET_KEY"), u ? { host: u.hostname, port: u.port, protocol: u.protocol.replace(":", "") } : undefined);
};

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

export const error = (code, mensaje, status = 400) => json({ error: code, mensaje }, status);

export const mesActual = () => new Date().toISOString().slice(0, 7);

/** Límites del plan más lo ganado invitando a amigos */
export const limiteDe = (plan, perfil) => ({
  ...LIMITES[plan],
  simulacros: LIMITES[plan].simulacros + (perfil?.extra_simulacros || 0),
  paginas: LIMITES[plan].paginas + (perfil?.extra_paginas || 0),
});

/** Pro si tiene suscripción activa o un pase de examen que no ha caducado */
export const pasoActivo = (perfil) => !!perfil?.pro_hasta && new Date(perfil.pro_hasta) > new Date();
export const planDe = (user, perfil) => (perfil?.plan === "pro" || pasoActivo(perfil) ? "pro" : "free");

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
  const { data: perfil } = await db.from("perfiles").select("plan, pro_hasta, acepto_terminos_at, extra_simulacros, extra_paginas").eq("id", user.id).maybeSingle();
  if (!perfil?.acepto_terminos_at) return { fallo: error("terminos", "Acepta los términos para usar Entra.", 403) };
  const plan = planDe(user, perfil);
  const { data: uso } = await db.from("uso").select("simulacros, paginas, bloques, mensajes").eq("user_id", user.id).eq("mes", mesActual()).maybeSingle();
  return { user, plan, db, uso: uso || { simulacros: 0, paginas: 0, bloques: 0, mensajes: 0 }, limite: limiteDe(plan, perfil) };
}

export async function sumarUso(db, userId, { simulacros = 0, paginas = 0, bloques = 0 }) {
  await db.rpc("sumar_uso", { p_user: userId, p_mes: mesActual(), p_sim: simulacros, p_pag: paginas, p_blo: bloques });
}

/** Lanza la petición en streaming. `content` va en formato de Anthropic (bloques text/image). */
async function pedirIA({ p, m, content, maxTokens, signal }) {
  if (p.anthropic) {
    return fetch(p.url + "/v1/messages", {
      method: "POST", signal,
      headers: { "x-api-key": p.clave, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: m, max_tokens: maxTokens, stream: true, messages: [{ role: "user", content }] }),
    });
  }
  const parts = content.map((c) => c.type === "image"
    ? { type: "image_url", image_url: p.imagenComoTexto ? `data:${c.source.media_type};base64,${c.source.data}` : { url: `data:${c.source.media_type};base64,${c.source.data}` } }
    : { type: "text", text: c.text });
  const soloTexto = parts.every((x) => x.type === "text");
  const messages = [{ role: "user", content: soloTexto ? parts.map((x) => x.text).join("\n\n") : parts }];
  if (p.workersAI) {
    // Workers AI devuelve un stream SSE con {response:"..."}; lo envolvemos en una Response normal
    try {
      const stream = await p.workersAI.run(m, { messages, max_tokens: maxTokens, stream: true });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    } catch (e) {
      const t = String(e?.message || e);
      return new Response(t, { status: /capacity|limit|429|neuron/i.test(t) ? 429 : 500 });
    }
  }
  const extra = p.razonamiento ? { reasoning_effort: p.razonamiento } : {};
  return fetch(p.url + "/chat/completions", {
    method: "POST", signal,
    headers: { authorization: `Bearer ${p.clave}`, "content-type": "application/json" },
    body: JSON.stringify({ model: m, max_tokens: maxTokens, stream: true, messages, ...extra }),
  });
}

/** Texto nuevo de un evento del stream ("" si no trae texto), o null si es un error */
function textoDe(p, d) {
  if (p.anthropic) {
    if (d.type === "error") return null;
    return d.type === "content_block_delta" && d.delta?.type === "text_delta" ? d.delta.text : "";
  }
  if (d.error) return null;
  if (typeof d.response === "string") return d.response; // Workers AI
  return d.choices?.[0]?.delta?.content || "";
}

/**
 * Llama a la IA en streaming y devuelve una Response que va
 * enviando el texto al navegador según se escribe (evita los límites de
 * tiempo de las funciones normales).
 */
export function streamIA({ content, model = MODELO, maxTokens = 8000, onDone }) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Netlify corta con 504 si pasan ~30 s sin enviar nada: mientras la IA piensa o cambiamos de proveedor,
      // mandamos un espacio cada 8 s (el cliente lo ignora al leer el JSON)
      let latido = setInterval(() => { try { controller.enqueue(enc.encode(" ")) } catch {} }, 8000);
      const parar = () => { clearInterval(latido); latido = null };
      controller.enqueue(enc.encode(" "));
      try {
        const conFotos = content.some((c) => c.type === "image");
        const intentos = cadena(model, conFotos);
        let agotado = 0, ultimo = 0, ok = false;
        for (const { p, m } of intentos) {
          // Si un proveedor no contesta en 25 s, pasamos al siguiente
          const ac = new AbortController();
          const reloj = setTimeout(() => ac.abort(), 25_000);
          let r;
          try { r = await pedirIA({ p, m, content, maxTokens, signal: ac.signal }) }
          catch (e) { r = new Response(String(e?.message || e), { status: 504 }) }
          clearTimeout(reloj);
          if (!r.ok || !r.body) {
            const t = await r.text().catch(() => "");
            console.error("Error de la IA", p.nombre, m, r.status, t.slice(0, 300));
            ultimo = r.status;
            if (/per day|perday|quota/i.test(t)) agotado++;
            if ([429, 500, 502, 503, 504, 529].includes(r.status)) enfriando.set(p.nombre + m, Date.now() + ENFRIAR_MS);
            continue;
          }
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = "", fallo = false;
          while (!fallo) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true }).replace(/\r/g, "");
            let i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              const evt = buf.slice(0, i); buf = buf.slice(i + 2);
              const line = evt.split("\n").find((l) => l.startsWith("data:"));
              if (!line || line.trim() === "data: [DONE]") continue;
              let d; try { d = JSON.parse(line.slice(5)) } catch { continue }
              const t = textoDe(p, d);
              if (t === null) { console.error("Error en el stream", p.nombre, m, line.slice(0, 300)); fallo = true; break }
              if (t) { if (!ok) parar(); ok = true; controller.enqueue(enc.encode(t)) }
            }
          }
          if (ok) {
            if (fallo) controller.enqueue(enc.encode(`\n[[ERROR:ia]]`));
            break;
          }
          // No llegó a escribir nada: probamos con el siguiente
          reader.cancel().catch(() => {});
          ultimo = 500;
        }
        parar();
        if (!ok) {
          // "cuota": todos sin cupo gratuito hoy; "ocupado": saturación puntual
          const codigo = agotado && agotado === intentos.length ? "cuota" : [429, 503, 504, 529].includes(ultimo) ? "ocupado" : "ia";
          controller.enqueue(enc.encode(`\n[[ERROR:${codigo}]]`));
        } else if (onDone) await onDone().catch((e) => console.error("onDone", e));
        controller.close();
      } catch (e) {
        parar();
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
