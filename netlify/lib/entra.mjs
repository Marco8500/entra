// Utilidades compartidas por las funciones de Entra
import { createClient } from "@supabase/supabase-js";
import { AsyncLocalStorage } from "node:async_hooks";
import Stripe from "stripe";

export const LIMITES = {
  free: { simulacros: 3, paginas: 25, bloques: 20, mensajes: 20, correcciones: 40 },
  pro: { simulacros: 60, paginas: 300, bloques: 400, mensajes: 200, correcciones: 800 },
};

// Variables de entorno: en Netlify vienen en process.env; en Cloudflare las pasa functions/_lib.js
export const env = (k) => globalThis.__ENTRA_ENV?.[k] ?? (typeof process !== "undefined" ? process.env?.[k] : undefined);

// Contexto de la petición (Cloudflare): permite dejar trabajo en segundo plano (registros) sin retrasar la respuesta
export const peticion = new AsyncLocalStorage();
/** Ejecuta `p` sin esperar a que termine; en Cloudflare con waitUntil para que no se corte al responder */
export function enSegundoPlano(p) {
  const ctx = peticion.getStore();
  const seguro = Promise.resolve(p).catch((e) => console.error("segundo plano", e?.message || e));
  if (ctx?.waitUntil) ctx.waitUntil(seguro);
  return seguro;
}
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

/**
 * Aprende de los fallos: cuenta los errores de cada proveedor/modelo en los últimos 15 minutos (tabla ia_errores,
 * compartida por todos los servidores) y manda al final de la cola a los que fallan mucho. Se refresca cada minuto.
 */
const salud = { ts: 0, fallos: new Map() };
async function cargarSalud() {
  if (Date.now() - salud.ts < 60_000) return;
  salud.ts = Date.now();
  try {
    const { data } = await admin().from("ia_errores").select("proveedor, modelo").eq("ok", false)
      .gte("creado_at", new Date(Date.now() - 15 * 60_000).toISOString()).limit(1000);
    const f = new Map();
    for (const r of data || []) f.set(r.proveedor + r.modelo, (f.get(r.proveedor + r.modelo) || 0) + 1);
    salud.fallos = f;
  } catch {}
}
const FALLOS_PARA_RELEGAR = 3;

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
  const lista = libres.length ? libres : intentos; // si todos están enfriando, se prueban igual
  // Los que más han fallado últimamente, al final (sort es estable: el resto mantiene el orden de IA_ORDEN)
  const malo = (i) => (salud.fallos.get(i.p.nombre + i.m) || 0) >= FALLOS_PARA_RELEGAR;
  return [...lista].sort((a, b) => malo(a) - malo(b));
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

// Modo de Stripe según la clave secreta: con sk_live se usan los precios *_LIVE y la clave pública real
export const stripeReal = () => /^(sk|rk)_live_/.test(env("STRIPE_SECRET_KEY") || "");
export const precioStripe = (nombre) => (stripeReal() && env(nombre + "_LIVE")) || env(nombre);
export const clavePublicaStripe = () => env(stripeReal() ? "STRIPE_PK_LIVE" : "STRIPE_PK_TEST") || null;

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
  // Perfil y uso del mes a la vez (antes iban uno detrás de otro)
  const [{ data: perfil, error: e1 }, { data: uso, error: e2 }] = await Promise.all([
    db.from("perfiles").select("plan, pro_hasta, acepto_terminos_at, extra_simulacros, extra_paginas").eq("id", user.id).maybeSingle(),
    db.from("uso").select("simulacros, paginas, bloques, mensajes, correcciones").eq("user_id", user.id).eq("mes", mesActual()).maybeSingle(),
  ]);
  if (e1 || e2) throw new Error("autenticar: " + (e1 || e2).message);
  if (!perfil?.acepto_terminos_at) return { fallo: error("terminos", "Acepta los términos para usar Entra.", 403) };
  const plan = planDe(user, perfil);
  return { user, plan, db, uso: { simulacros: 0, paginas: 0, bloques: 0, mensajes: 0, correcciones: 0, ...uso }, limite: limiteDe(plan, perfil) };
}

export async function sumarUso(db, userId, { simulacros = 0, paginas = 0, bloques = 0 }) {
  const { error: e } = await db.rpc("sumar_uso", { p_user: userId, p_mes: mesActual(), p_sim: simulacros, p_pag: paginas, p_blo: bloques });
  if (e) console.error("sumar_uso", userId, e.message);
}

/** Corrección o repaso hecho por la IA (límite propio para que no se abuse de la IA gratis) */
export async function sumarCorreccion(db, userId) {
  const { error: e } = await db.rpc("sumar_correccion", { p_user: userId, p_mes: mesActual() });
  if (e) console.error("sumar_correccion", userId, e.message);
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
/** Lee JSON aunque venga con ```json, texto alrededor o espacios del latido. Devuelve null si no se puede. */
export function jsonDe(t) {
  const s = String(t || "").trim();
  try { return JSON.parse(s) } catch {}
  const f = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) { try { return JSON.parse(f[1]) } catch {} }
  const a = Math.min(...["{", "["].map((c) => s.indexOf(c)).filter((i) => i >= 0)), b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)) } catch {} }
  return null;
}

/** Apunta una respuesta buena (proveedor, modelo y milisegundos) para medir la velocidad real */
function anotarAcierto(ruta, p, m, ms) {
  enSegundoPlano(admin().from("ia_errores").insert({ ruta, proveedor: p, modelo: m, status: 200, ok: true, ms, detalle: "ok" }));
}

/** Apunta un fallo de la IA en ia_errores (sin datos del alumno: solo proveedor, modelo, código y mensaje) */
// No se espera a la base de datos: el registro no debe retrasar el paso a la siguiente IA
function anotarFallo(ruta, p, m, status, detalle) {
  console.error("Error de la IA", ruta, p, m, status, String(detalle).slice(0, 300));
  enSegundoPlano(admin().from("ia_errores").insert({ ruta, proveedor: p, modelo: m, status, detalle: String(detalle).slice(0, 500) }));
}

/**
 * Con `validar(json)`, la respuesta no se envía en directo: se junta entera, se comprueba y, si viene cortada o mal
 * formada, se apunta como fallo y se pide a la siguiente IA. Para respuestas cortas (corregir, repaso, leer).
 */
export function streamIA({ content, model = MODELO, maxTokens = 8000, onDone, ruta = "", validar = null }) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Netlify corta con 504 si pasan ~30 s sin enviar nada: mientras la IA piensa o cambiamos de proveedor,
      // mandamos un espacio cada 8 s (el cliente lo ignora al leer el JSON)
      let latido = setInterval(() => { try { controller.enqueue(enc.encode(" ")) } catch {} }, 8000);
      const parar = () => { clearInterval(latido); latido = null };
      controller.enqueue(enc.encode(" "));
      try {
        await cargarSalud();
        const conFotos = content.some((c) => c.type === "image");
        const intentos = cadena(model, conFotos);
        let agotado = 0, ultimo = 0, ok = false;
        const inicio = Date.now();
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
            anotarFallo(ruta, p.nombre, m, r.status, t);
            ultimo = r.status;
            if (/per day|perday|quota/i.test(t)) agotado++;
            if ([429, 500, 502, 503, 504, 529].includes(r.status)) enfriando.set(p.nombre + m, Date.now() + ENFRIAR_MS);
            continue;
          }
          const reader = r.body.getReader();
          const dec = new TextDecoder();
          let buf = "", fallo = false, junto = "";
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
              if (t === null) { anotarFallo(ruta, p.nombre, m, 200, "stream: " + line); fallo = true; break }
              if (t && validar) { junto += t; ok = true }
              else if (t) { if (!ok) parar(); ok = true; controller.enqueue(enc.encode(t)) }
            }
          }
          if (ok && validar) {
            let valido = false; try { valido = !fallo && !!validar(jsonDe(junto)) } catch {}
            if (!valido) { reader.cancel().catch(() => {}); anotarFallo(ruta, p.nombre, m, 200, "respuesta no válida: " + junto.slice(-300)); ok = false; ultimo = 500; continue }
            parar(); controller.enqueue(enc.encode(junto));
          }
          if (ok) {
            if (fallo) controller.enqueue(enc.encode(`\n[[ERROR:ia]]`));
            else anotarAcierto(ruta, p.nombre, m, Date.now() - inicio);
            break;
          }
          // No llegó a escribir nada: probamos con el siguiente
          if (!fallo) anotarFallo(ruta, p.nombre, m, 200, "respuesta vacía");
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
        anotarFallo(ruta, "-", "-", 0, e?.stack || e);
        try { controller.enqueue(enc.encode(`\n[[ERROR:ia]]`)); controller.close(); } catch {}
      }
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}

export const texto = (s, max = 60000) => String(s ?? "").slice(0, max);
