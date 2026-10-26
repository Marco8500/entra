/* Entra · app */
(() => {
const CFG = window.ENTRA_CONFIG || {};
const sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);

/* ============ estado ============ */
const S = {
  view: "boot", session: null, cuenta: null,
  files: [], pasted: "", subject: "", apuntesId: null,
  topics: [], fmt: { test: 20, cortas: 3, opciones: 4, minutos: 30 },
  exam: null, examFmt: null, examFocus: null, answers: { test: {}, cortas: {} },
  result: null, review: null, timer: null, endsAt: 0,
  busyTitle: "", busySub: "", historial: [],
};
const $ = (s, r = document) => r.querySelector(s);
const esc = (t) => String(t ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const LET = "abcdefgh";
const num = (n) => n.toFixed(1).replace(".", ",");
function h(html){ const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild }
function saveLocal(){ try{ localStorage.setItem("entra.fmt", JSON.stringify(S.fmt)) }catch(e){} }
try{ Object.assign(S.fmt, JSON.parse(localStorage.getItem("entra.fmt") || "{}")) }catch(e){}

/* ============ API ============ */
class ApiError extends Error { constructor(code, mensaje, status){ super(mensaje); this.code = code; this.status = status } }
let ctl = null;

async function api(path, body, onText){
  const token = S.session?.access_token;
  const r = await fetch(path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
    signal: ctl?.signal,
  });
  const ct = r.headers.get("content-type") || "";
  if (!r.ok) {
    let d = {}; try { d = await r.json() } catch {}
    throw new ApiError(d.error || "http", d.mensaje || "Algo ha fallado. Vuelve a intentarlo.", r.status);
  }
  if (ct.includes("application/json")) return r.json();
  // streaming de texto
  const reader = r.body.getReader(); const dec = new TextDecoder(); let text = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    text += dec.decode(value, { stream: true });
    onText?.(text);
  }
  const m = text.match(/\[\[ERROR:(\w+)\]\]/);
  if (m) throw new ApiError(m[1], { ocupado: "La IA está saturada ahora mismo. Prueba en un minuto.", cuota: "Hoy se ha agotado la IA gratuita. Vuelve a probar mañana." }[m[1]] || "La IA ha fallado. Vuelve a intentarlo.");
  return text;
}
function parseJSON(text){
  const s = String(text).trim();
  try { return JSON.parse(s) } catch {}
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (fence) { try { return JSON.parse(fence[1]) } catch {} }
  const a = Math.min(...["{","["].map(c => s.indexOf(c)).filter(i => i >= 0));
  const b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)) } catch {} }
  throw new ApiError("json", "La respuesta ha salido mal formada. Vuelve a intentarlo.");
}
async function apiJSON(path, body, onText){ return parseJSON(await api(path, body, onText)) }
// La IA gratuita limita las peticiones por minuto: si está saturada, esperamos y reintentamos
const dormir = (ms) => new Promise((ok, ko) => {
  const t = setTimeout(ok, ms);
  ctl?.signal.addEventListener("abort", () => { clearTimeout(t); ko(new DOMException("Cancelado", "AbortError")) }, { once: true });
});
async function apiIA(path, body, onText){
  for (let intento = 0; ; intento++) {
    try { return await apiJSON(path, body, onText) }
    catch (e) {
      const saturada = e.code === "ocupado" && intento < 3, fallo = (e.code === "ia" || e.code === "json") && intento < 1;
      if (!saturada && !fallo) throw e;
      for (let s = saturada ? 20 * (intento + 1) : 3; s > 0; s--) { setBusySub(`La IA va saturada. Reintento en ${s} s…`); await dormir(1000) }
    }
  }
}
// Ejecuta las tareas con un máximo de n a la vez (en orden de inicio)
async function enParalelo(tareas, n){
  const res = new Array(tareas.length); let sig = 0;
  await Promise.all(Array.from({ length: Math.min(n, tareas.length) }, async () => { while (sig < tareas.length) { const i = sig++; res[i] = await tareas[i]() } }));
  return res;
}
// Los errores de cuenta (límites, sesión) paran todo; los de la IA solo pierden ese trozo
const soloIA = (e) => { if (e?.name === "AbortError" || e?.status) throw e; return null };

async function refreshCuenta(){
  try { S.cuenta = await api("/api/cuenta") } catch (e) { S.cuenta = null }
  drawAccount();
}
function drawAccount(){
  const box = $("#account"); const c = S.cuenta;
  if (!c || !S.session) { box.hidden = true; return }
  box.hidden = false;
  box.innerHTML = `<span class="pill ${c.plan === "pro" ? "pro" : ""}">${c.plan === "pro" ? "Pro" : "Gratis"}</span>
    <span>Simulacros <b>${c.uso.simulacros}/${c.limite.simulacros}</b></span>
    <span>Páginas <b>${c.uso.paginas}/${c.limite.paginas}</b></span>
    ${c.plan === "pro" ? `<button class="btn btn-ghost btn-sm" id="portal">Gestionar suscripción</button>`
      : `<button class="btn btn-hl btn-sm" id="goPro">Pasarme a Pro · ${esc(CFG.PRECIO_PRO || "")}</button>`}`;
  const gp = $("#goPro"); if (gp) gp.onclick = () => pagar("suscribir");
  const pt = $("#portal"); if (pt) pt.onclick = () => pagar("portal");
}
async function pagar(accion){
  if (accion === "suscribir" && CFG.STRIPE_PUBLISHABLE_KEY) return go("pago");
  try { ctl = null; const { url } = await api("/api/pago", { accion }); location.href = url }
  catch (e) { flash(e.message) }
}
function flash(msg, kind = "error"){
  const box = $("#msg"); if (box) box.innerHTML = `<div class="${kind}">${esc(msg)}</div>`;
  else { const v = $("#view"); v.prepend(h(`<div class="${kind}" style="margin-bottom:12px">${esc(msg)}</div>`)) }
}

/* ============ navegación ============ */
function go(v){ if (S.checkout && v !== "pago") { S.checkout.destroy(); S.checkout = null } S.view = v; render(); window.scrollTo({ top: 0, behavior: "instant" }) }
function render(){
  document.querySelectorAll("#steps span").forEach(s => s.classList.toggle("on", s.dataset.s === (S.view === "review" ? "results" : S.view)));
  const V = { login: vLogin, clave: vClave, terms: vTerms, pago: vPago, home: vHome, topics: vTopics, format: vFormat, exam: vExam, results: vResults, review: vReview, busy: vBusy }[S.view];
  if (!V) return;
  $("#view").innerHTML = ""; $("#view").append(V());
}
function busy(title, sub){ S.busyTitle = title; S.busySub = sub || ""; go("busy") }
function setBusySub(t){ const b = $("#busySub"); if (b) b.textContent = t }
function vBusy(){
  const el = h(`<section class="sheet"><div class="loading"><div class="pen" aria-hidden="true"></div>
    <h2 style="font-size:22px">${esc(S.busyTitle)}</h2><p class="muted small" id="busySub">${esc(S.busySub)}</p>
    <button class="btn btn-ghost" id="stop">Cancelar</button></div></section>`);
  $("#stop", el).onclick = () => ctl?.abort();
  return el;
}
function fail(where, e){
  if (e?.name === "AbortError") return go(where);
  go(where);
  if (e?.code === "terminos") return go("terms");
  if (e?.code === "no_auth") { sb.auth.signOut(); return }
  const isLimit = e?.status === 402;
  requestAnimationFrame(() => {
    flash(e?.message || "Algo ha fallado.");
    if (isLimit && S.cuenta?.plan !== "pro") { const m = $("#msg") || $("#view"); m.append(h(`<button class="btn btn-hl" style="margin-top:10px" id="limPro">Pasarme a Pro</button>`)); $("#limPro").onclick = () => pagar("suscribir") }
    refreshCuenta();
  });
}

/* ============ login y términos ============ */
const msgAuth = (e) => {
  const m = e?.message || "";
  if (/already registered|already exists/i.test(m)) return "Ese email ya tiene cuenta. Pulsa \"Ya tengo cuenta\" y entra con tu contraseña.";
  if (/invalid login credentials/i.test(m)) return "Email o contraseña incorrectos.";
  if (/email not confirmed/i.test(m)) return "Antes de entrar, confirma tu email con el enlace que te hemos enviado.";
  if (/password/i.test(m) && /least|short|weak/i.test(m)) return "La contraseña es demasiado corta o débil. Usa al menos 8 caracteres.";
  if (/rate limit|seconds/i.test(m)) return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
  if (/not enabled|unacceptable audience|nonce/i.test(m)) return "No se ha podido entrar con Google. Prueba otra vez o crea tu cuenta con email y contraseña.";
  return m || "Algo ha fallado. Vuelve a intentarlo.";
};
function vLogin(){
  const nuevo = S.loginModo !== "entrar";
  const el = h(`<section class="sheet">
    <span class="eyebrow">${nuevo ? "Empieza gratis" : "Entrar"}</span>
    <h2 style="font-size:28px">${nuevo ? "Crea tu cuenta y haz tu primer simulacro" : "Entra en tu cuenta"}</h2>
    <div class="presets" role="tablist"><button class="chip ${nuevo ? "on" : ""}" id="tNuevo">Crear cuenta</button><button class="chip ${nuevo ? "" : "on"}" id="tEntrar">Ya tengo cuenta</button></div>
    ${CFG.GOOGLE ? `<div id="gbox" style="display:flex;justify-content:center;min-height:44px"><button class="btn btn-ghost" id="google" style="width:100%">Continuar con Google</button></div><div class="sep">o con tu email</div>` : ""}
    <form id="f" style="display:flex;flex-direction:column;gap:12px" novalidate>
      <label class="field" for="email">Email<input type="email" id="email" required autocomplete="email" inputmode="email" placeholder="tu@email.com" value="${esc(S.loginEmail || "")}"></label>
      <label class="field" for="clave">Contraseña<input type="password" id="clave" required minlength="8" autocomplete="${nuevo ? "new-password" : "current-password"}" placeholder="${nuevo ? "Mínimo 8 caracteres" : "Tu contraseña"}"></label>
      ${nuevo ? `<label class="check" for="acepto"><input type="checkbox" id="acepto"><span>Tengo <b>16 años o más</b> y acepto los <a href="/terminos" target="_blank">términos</a> y la <a href="/privacidad" target="_blank">privacidad</a>.</span></label>` : ""}
      <button class="btn btn-primary" type="submit" id="enviar">${nuevo ? "Crear mi cuenta" : "Entrar"}</button>
    </form>
    ${nuevo ? "" : `<button class="btn btn-ghost btn-sm" id="olvido">He olvidado mi contraseña</button>`}
    <div id="msg"></div>
  </section>`);
  const msg = (t, k = "error") => $("#msg", el).innerHTML = `<div class="${k}">${esc(t)}</div>`;
  $("#tNuevo", el).onclick = () => { S.loginEmail = $("#email", el).value; S.loginModo = "nuevo"; render() };
  $("#tEntrar", el).onclick = () => { S.loginEmail = $("#email", el).value; S.loginModo = "entrar"; render() };
  $("#f", el).onsubmit = async (e) => {
    e.preventDefault();
    const email = $("#email", el).value.trim().toLowerCase(), password = $("#clave", el).value;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg("Escribe un email válido.");
    if (password.length < 8) return msg(nuevo ? "La contraseña tiene que tener al menos 8 caracteres." : "Escribe tu contraseña.");
    if (nuevo && !$("#acepto", el).checked) return msg("Marca la casilla para continuar.");
    const b = $("#enviar", el); b.disabled = true; b.textContent = nuevo ? "Creando tu cuenta…" : "Entrando…";
    if (nuevo) try { localStorage.setItem("entra.acepto", JSON.stringify({ email, at: new Date().toISOString() })) } catch {}
    const { data, error } = nuevo
      ? await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + "/app" } })
      : await sb.auth.signInWithPassword({ email, password });
    b.disabled = false; b.textContent = nuevo ? "Crear mi cuenta" : "Entrar";
    if (error) return msg(msgAuth(error));
    // Si Supabase pide confirmar el email, no hay sesión todavía
    if (nuevo && !data.session) {
      if (!data.user?.identities?.length) return msg(msgAuth({ message: "already registered" }));
      return msg(`Te hemos enviado un email a ${email}. Pulsa el enlace para activar tu cuenta.`, "notice");
    }
  };
  const ol = $("#olvido", el);
  if (ol) ol.onclick = async () => {
    const email = $("#email", el).value.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return msg("Escribe tu email arriba y vuelve a pulsar.");
    const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + "/app" });
    msg(error ? msgAuth(error) : `Si ${email} tiene cuenta, te llegará un email para poner una contraseña nueva.`, error ? "error" : "notice");
  };
  const g = $("#google", el);
  if (g) g.onclick = async () => {
    // Si Google no está activado en Supabase, avisamos en vez de mandar a una página de error
    const ok = await fetch(`${CFG.SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: CFG.SUPABASE_ANON_KEY } })
      .then((r) => r.json()).then((d) => d.external?.google).catch(() => true);
    if (!ok) return msg("El acceso con Google no está disponible ahora mismo. Crea tu cuenta con email y contraseña.");
    sb.auth.signInWithOAuth({ provider: "google", options: { redirectTo: location.origin + "/app" + location.search } });
  };
  if (g && CFG.GOOGLE_CLIENT_ID) requestAnimationFrame(() => botonGoogle($("#gbox", el), msg));
  return el;
}
/* Botón oficial de Google: inicia sesión en una ventana sobre la web, sin pasar por la dirección de Supabase.
   Si no carga, se queda el botón normal (que sí pasa por Supabase). */
let gsi = null;
const cargarGoogle = () => gsi ??= new Promise((ok, ko) => {
  const s = document.createElement("script"); s.src = "https://accounts.google.com/gsi/client";
  s.onload = () => window.google?.accounts?.id ? ok(window.google) : ko(); s.onerror = () => { gsi = null; ko() };
  document.head.append(s);
});
const sha256 = async (t) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)))].map((x) => x.toString(16).padStart(2, "0")).join("");
async function botonGoogle(box, msg){
  try {
    const g = await cargarGoogle();
    const nonce = crypto.randomUUID(); // Google recibe el hash; Supabase comprueba el original
    g.accounts.id.initialize({
      client_id: CFG.GOOGLE_CLIENT_ID, nonce: await sha256(nonce), ux_mode: "popup", use_fedcm_for_button: true,
      callback: async ({ credential }) => {
        const { error } = await sb.auth.signInWithIdToken({ provider: "google", token: credential, nonce });
        if (error) msg(msgAuth(error));
      },
    });
    if (!box.isConnected) return;
    box.innerHTML = "";
    g.accounts.id.renderButton(box, { theme: "outline", size: "large", text: "continue_with", shape: "pill", locale: "es", width: Math.min(box.clientWidth || 320, 400) });
  } catch {}
}
// Al volver del email de "he olvidado mi contraseña"
function vClave(){
  const el = h(`<section class="sheet">
    <span class="eyebrow">Contraseña nueva</span>
    <h2 style="font-size:26px">Pon tu contraseña nueva</h2>
    <form id="f" style="display:flex;flex-direction:column;gap:12px">
      <label class="field" for="clave">Contraseña<input type="password" id="clave" autocomplete="new-password" placeholder="Mínimo 8 caracteres"></label>
      <button class="btn btn-primary" type="submit">Guardar</button>
    </form>
    <div id="msg"></div>
  </section>`);
  $("#f", el).onsubmit = async (e) => {
    e.preventDefault();
    const password = $("#clave", el).value;
    if (password.length < 8) return $("#msg", el).innerHTML = `<div class="error">Mínimo 8 caracteres.</div>`;
    const { error } = await sb.auth.updateUser({ password });
    if (error) return $("#msg", el).innerHTML = `<div class="error">${esc(msgAuth(error))}</div>`;
    S.recuperando = false; await afterLogin(); flash("Contraseña cambiada.", "notice");
  };
  return el;
}
function vTerms(){
  const el = h(`<section class="sheet">
    <span class="eyebrow">Antes de empezar</span>
    <h2 style="font-size:26px">Un par de cosas</h2>
    <label class="check" for="edad"><input type="checkbox" id="edad"><span>Tengo <b>16 años o más</b>.</span></label>
    <label class="check" for="acepto"><input type="checkbox" id="acepto"><span>Acepto los <a href="/terminos" target="_blank">términos</a> y la <a href="/privacidad" target="_blank">política de privacidad</a>.</span></label>
    <p class="small muted">Las fotos de tus apuntes no se guardan. Solo guardamos el texto de los temas y tus resultados.</p>
    <div id="msg"></div>
    <button class="btn btn-primary" id="ok" disabled>Empezar</button>
  </section>`);
  const upd = () => $("#ok", el).disabled = !($("#edad", el).checked && $("#acepto", el).checked);
  $("#edad", el).onchange = upd; $("#acepto", el).onchange = upd;
  $("#ok", el).onclick = async () => {
    const { error } = await sb.from("perfiles").update({ acepto_terminos_at: new Date().toISOString() }).eq("id", S.session.user.id);
    if (error) return $("#msg", el).innerHTML = `<div class="error">No se ha podido guardar. Vuelve a intentarlo.</div>`;
    await refreshCuenta(); afterLogin();
  };
  return el;
}

/* ============ pago dentro de la web (Stripe Embedded Checkout) ============ */
let stripeJs = null;
const cargarStripe = () => stripeJs ??= new Promise((ok, ko) => {
  const s = document.createElement("script"); s.src = CFG.STRIPE_JS || "https://js.stripe.com/v3/";
  s.onload = () => ok(window.Stripe(CFG.STRIPE_PUBLISHABLE_KEY)); s.onerror = () => { stripeJs = null; ko(new Error("No se ha podido cargar el pago.")) };
  document.head.append(s);
});
function vPago(){
  const el = h(`<section class="sheet">
    <span class="eyebrow">Entra Pro · ${esc(CFG.PRECIO_PRO || "")}</span>
    <h2 style="font-size:26px">Pásate a Pro</h2>
    <p class="muted small">Pago seguro con Stripe. Cancela cuando quieras desde "Gestionar suscripción".</p>
    <div id="checkout" style="min-height:420px"><div class="loading"><div class="pen" aria-hidden="true"></div><p class="muted">Cargando el pago…</p></div></div>
    <div id="msg"></div>
    <button class="btn btn-ghost" id="back">Volver</button>
  </section>`);
  $("#back", el).onclick = () => go("home");
  (async () => {
    try {
      ctl = null;
      const [stripe, { clientSecret }] = await Promise.all([cargarStripe(), api("/api/pago", { accion: "suscribir", embebido: true })]);
      if (S.view !== "pago") return;
      S.checkout = await stripe.initEmbeddedCheckout({ fetchClientSecret: async () => clientSecret });
      $("#checkout", el).innerHTML = ""; S.checkout.mount($("#checkout", el));
    } catch (e) {
      $("#checkout", el).innerHTML = ""; $("#msg", el).innerHTML = `<div class="error">${esc(e.message)}</div>`;
    }
  })();
  return el;
}

/* ============ 1. apuntes ============ */
async function loadHistorial(){
  const { data } = await sb.from("apuntes").select("id, asignatura, temas, actualizado_at").order("actualizado_at", { ascending: false }).limit(8);
  S.historial = data || [];
}
function vHome(){
  const el = h(`<div style="display:flex;flex-direction:column;gap:18px">
    ${S.historial.length ? `<section class="sheet"><span class="eyebrow">Tus apuntes</span><div class="list" id="hist"></div></section>` : ""}
    <section class="sheet">
      <span class="eyebrow">Nuevos apuntes</span>
      <h2 style="font-size:26px">Sube lo que entra en tu examen</h2>
      <label class="field" for="subj">Asignatura o examen<input type="text" id="subj" placeholder="Ej.: PRL · Unidades 1 y 2" value="${esc(S.subject)}"></label>
      <label class="drop" id="drop" for="file">
        <input type="file" id="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple>
        <strong>📷 Haz fotos o sube capturas</strong>
        <span class="muted small">Lee tus anotaciones: "entra", "no entra", "test", "pregunta corta"</span>
      </label>
      <div class="thumbs" id="thumbs"></div>
      <label class="field" for="paste">O pega el texto de tus apuntes<textarea id="paste" placeholder="Pega aquí apuntes en texto…">${esc(S.pasted)}</textarea></label>
      <div id="msg"></div>
      <button class="btn btn-primary" id="analyze">Leer mis apuntes</button>
    </section>
  </div>`);
  const hist = $("#hist", el);
  if (hist) S.historial.forEach(a => {
    const n = (a.temas || []).filter(t => t.entra !== false).length;
    const b = h(`<button class="item"><span><b>${esc(a.asignatura || "Sin título")}</b><br><span class="small muted">${n} temas que entran · ${new Date(a.actualizado_at).toLocaleDateString("es-ES")}</span></span><span class="btn btn-ghost btn-sm">Abrir</span></button>`);
    b.onclick = () => { S.apuntesId = a.id; S.subject = a.asignatura; S.topics = (a.temas || []).map(t => ({ ...t, id: t.id || uid() })); go("topics") };
    hist.append(b);
  });
  const drawThumbs = () => {
    const box = $("#thumbs", el); box.innerHTML = "";
    S.files.forEach((f, i) => {
      const fig = h(`<figure><img alt="Página ${i + 1}"><button aria-label="Quitar página ${i + 1}">×</button></figure>`);
      fig.querySelector("img").src = URL.createObjectURL(f);
      fig.querySelector("button").onclick = (e) => { e.preventDefault(); S.files.splice(i, 1); drawThumbs() };
      box.append(fig);
    });
  };
  drawThumbs();
  const add = (list) => { for (const f of list) if (/^image\//.test(f.type)) S.files.push(f); drawThumbs() };
  $("#file", el).onchange = (e) => add(e.target.files);
  const drop = $("#drop", el);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over") };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); add(e.dataTransfer.files) };
  $("#subj", el).oninput = (e) => S.subject = e.target.value;
  $("#paste", el).oninput = (e) => S.pasted = e.target.value;
  $("#analyze", el).onclick = analyze;
  return el;
}

/* reduce cada foto a ≤1568 px en JPEG para que viaje ligera */
async function comprimir(file){
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) throw new ApiError("foto", `No se ha podido abrir ${file.name}.`);
  const k = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.82);
  return { tipo: "image/jpeg", base64: url.split(",")[1] };
}
async function analyze(){
  if (!S.files.length && !S.pasted.trim()) return flash("Sube al menos una foto o pega texto de tus apuntes.", "notice");
  ctl = new AbortController();
  busy("Leyendo tus apuntes…", "Preparando las fotos");
  try {
    const fotos = [];
    for (let i = 0; i < S.files.length; i++) { setBusySub(`Preparando foto ${i + 1} de ${S.files.length}`); fotos.push(await comprimir(S.files[i])) }
    const lotes = []; for (let i = 0; i < fotos.length; i += 4) lotes.push(fotos.slice(i, i + 4));
    if (!lotes.length) lotes.push([]);
    let hechos = 0, sinLeer = 0, ultimoError = null; setBusySub(`Leyendo ${fotos.length || "el texto"}${fotos.length ? " páginas" : ""}…`);
    const outs = await enParalelo(lotes.map((lote, i) => () => apiIA("/api/leer", { fotos: lote, texto: i === 0 ? S.pasted : "" })
      .then(r => { hechos++; setBusySub(`Leído ${hechos} de ${lotes.length} bloques`); return r }, e => { ultimoError = e; soloIA(e); sinLeer += lote.length || 1; return null })), 2);
    if (!outs.some(Boolean)) throw ultimoError || new ApiError("ia", "La IA ha fallado. Vuelve a intentarlo.");
    const map = new Map(); let asig = "";
    for (const out of outs) {
      if (out?.asignatura && !asig) asig = String(out.asignatura);
      for (const t of (out?.temas || [])) {
        const k = String(t.titulo || "").toLowerCase().trim(); if (!k) continue;
        if (map.has(k)) { const m = map.get(k); m.contenido += "\n" + (t.contenido || ""); if (m.entra == null) m.entra = t.entra ?? null; if (t.notas) m.notas = [m.notas, t.notas].filter(Boolean).join(" · ") }
        else map.set(k, { id: uid(), titulo: String(t.titulo), unidad: String(t.unidad || ""), entra: t.entra === false ? false : t.entra === true ? true : null, contenido: String(t.contenido || ""), notas: String(t.notas || "") });
      }
    }
    S.topics = [...map.values()];
    if (!S.topics.length) throw new ApiError("vacio", "No he encontrado temas estudiables. Prueba con fotos más nítidas.");
    if (!S.subject) S.subject = asig;
    S.apuntesId = null; S.files = []; S.pasted = "";
    await guardarApuntes();
    refreshCuenta();
    go("topics");
    if (sinLeer) flash(`No he podido leer ${sinLeer} ${sinLeer === 1 ? "foto" : "fotos"} porque la IA iba saturada. Puedes subirlas otra vez dentro de un minuto.`, "notice");
  } catch (e) { fail("home", e) }
}
async function guardarApuntes(){
  const fila = { user_id: S.session.user.id, asignatura: S.subject || "", temas: S.topics, actualizado_at: new Date().toISOString() };
  if (S.apuntesId) await sb.from("apuntes").update(fila).eq("id", S.apuntesId);
  else { const { data } = await sb.from("apuntes").insert(fila).select("id").single(); S.apuntesId = data?.id || null }
}
let saveT = null;
const guardarLuego = () => { clearTimeout(saveT); saveT = setTimeout(() => guardarApuntes().catch(() => {}), 800) };

/* ============ 2. qué entra ============ */
function vTopics(){
  const on = S.topics.filter(t => t.entra !== false).length;
  const el = h(`<section class="sheet">
    <span class="eyebrow">Paso 2 · Qué entra</span>
    <label class="field" for="subj2">Asignatura<input type="text" id="subj2" value="${esc(S.subject)}"></label>
    <p class="muted">${S.topics.length} temas. Solo pregunto de los marcados como <span class="stampmini">✱ Entra</span>. Cambia lo que haga falta.</p>
    <div id="tl" style="display:flex;flex-direction:column;gap:10px"></div>
    <div class="row"><button class="btn btn-ghost" id="back">Volver</button><button class="btn btn-primary" id="next" ${on ? "" : "disabled"}>Elegir formato (${on} temas)</button></div>
  </section>`);
  $("#subj2", el).oninput = (e) => { S.subject = e.target.value; guardarLuego() };
  const tl = $("#tl", el);
  S.topics.forEach(t => {
    const row = h(`<article class="topic ${t.entra === false ? "off" : ""}">
      <div class="topic-head"><div style="min-width:0">${t.unidad ? `<div class="unit">${esc(t.unidad)}</div>` : ""}<h3>${esc(t.titulo)}</h3></div>
        <div class="toggle" role="group" aria-label="¿Entra ${esc(t.titulo)}?"><button data-v="1" class="${t.entra !== false ? "on-yes" : ""}">Entra</button><button data-v="0" class="${t.entra === false ? "on-no" : ""}">No</button></div></div>
      ${t.notas ? `<div class="tags"><span class="tag">${esc(t.notas)}</span></div>` : ""}
      <details><summary>Ver lo que he leído</summary><p>${esc(t.contenido)}</p></details>
    </article>`);
    row.querySelectorAll(".toggle button").forEach(b => b.onclick = () => { t.entra = b.dataset.v === "1"; guardarLuego(); render() });
    tl.append(row);
  });
  $("#back", el).onclick = async () => { await loadHistorial(); go("home") };
  $("#next", el).onclick = () => go("format");
  return el;
}

/* ============ 3. formato ============ */
const PRESETS = [
  { n: "Rápido", test: 10, cortas: 2, minutos: 15 },
  { n: "Estándar", test: 20, cortas: 3, minutos: 30 },
  { n: "Como mi profe (39+5)", test: 39, cortas: 5, minutos: 60 },
];
function vFormat(){
  const f = S.fmt;
  const el = h(`<section class="sheet">
    <span class="eyebrow">Paso 3 · Formato del examen</span>
    <h2 style="font-size:26px">¿Cómo es tu examen real?</h2>
    <div class="presets" id="pre"></div>
    <div class="grid2">
      <label class="field" for="fTest">Preguntas tipo test<input type="number" id="fTest" min="0" max="60" value="${f.test}"></label>
      <label class="field" for="fCortas">Respuestas cortas<input type="number" id="fCortas" min="0" max="10" value="${f.cortas}"></label>
      <label class="field" for="fOpc">Opciones por pregunta<select id="fOpc">${[3, 4, 5].map(n => `<option ${n == f.opciones ? "selected" : ""}>${n}</option>`).join("")}</select></label>
      <label class="field" for="fMin">Tiempo (minutos, 0 = sin límite)<input type="number" id="fMin" min="0" max="240" value="${f.minutos}"></label>
    </div>
    <p class="muted small">Cada test vale 1 punto y cada corta 2. Nota final sobre 10.</p>
    <div id="msg"></div>
    <div class="row"><button class="btn btn-ghost" id="back">Volver</button><button class="btn btn-primary" id="gen">Crear simulacro</button></div>
  </section>`);
  const pre = $("#pre", el);
  PRESETS.forEach(p => {
    const c = h(`<button class="chip ${p.test == f.test && p.cortas == f.cortas ? "on" : ""}">${esc(p.n)}</button>`);
    c.onclick = () => { Object.assign(S.fmt, { test: p.test, cortas: p.cortas, minutos: p.minutos }); saveLocal(); render() };
    pre.append(c);
  });
  const bind = (id, k, max) => $(id, el).oninput = (e) => { S.fmt[k] = Math.max(0, Math.min(max, parseInt(e.target.value) || 0)); saveLocal() };
  bind("#fTest", "test", 60); bind("#fCortas", "cortas", 10); bind("#fMin", "minutos", 240);
  $("#fOpc", el).onchange = (e) => { S.fmt.opciones = parseInt(e.target.value); saveLocal() };
  $("#back", el).onclick = () => go("topics");
  $("#gen", el).onclick = () => generate();
  return el;
}

/* ============ generar examen (en bloques paralelos) ============ */
function shuffleTest(q){
  const idx = q.opciones.map((_, i) => i).sort(() => Math.random() - .5);
  return { ...q, opciones: idx.map(i => q.opciones[i]), correcta: idx.indexOf(q.correcta) };
}
function planBloques(topics, f){
  const nTest = Math.ceil(f.test / 13);
  const bloques = [];
  for (let k = 0; k < nTest; k++) {
    const n = Math.round(f.test / nTest * (k + 1)) - Math.round(f.test / nTest * k);
    let ts = nTest > 1 ? topics.filter((_, i) => i % nTest === k) : topics;
    if (ts.length < 2) ts = topics;
    bloques.push({ temas: ts, test: n, cortas: 0 });
  }
  if (f.cortas) bloques.push({ temas: topics, test: 0, cortas: f.cortas });
  return bloques;
}
async function generate(only){
  const topics = (only || S.topics.filter(t => t.entra !== false)).map(t => ({ titulo: t.titulo, contenido: t.contenido, notas: t.notas }));
  const f = only ? { test: Math.min(12, S.fmt.test || 12), cortas: Math.min(2, S.fmt.cortas), opciones: S.fmt.opciones, minutos: Math.min(20, S.fmt.minutos) } : { ...S.fmt };
  if (!f.test && !f.cortas) return flash("Pon al menos una pregunta.", "notice");
  S.examFmt = f; S.examFocus = only ? only.map(t => t.titulo) : null;
  const back = only ? "results" : "format";
  ctl = new AbortController();
  busy(only ? "Preparando repaso de tus fallos…" : "Creando tu simulacro…", "Escribiendo preguntas");
  try {
    const bloques = planBloques(topics, f);
    const total = f.test + f.cortas; const counts = bloques.map(() => 0);
    const show = () => setBusySub(`${Math.min(total, counts.reduce((a, b) => a + b, 0))} de ${total} preguntas`);
    // el primer bloque cuenta el simulacro; esperamos a que arranque para no gastar dos
    // el primero sale antes que los demás (es el que cuenta el simulacro); como mucho 3 a la vez
    let ultimoError = null;
    const pedir = (b, i) => apiIA("/api/examen", { ...b, opciones: f.opciones, nuevo: i === 0 },
      (txt) => { counts[i] = (txt.match(/"pregunta"/g) || []).length; show() }).catch(e => { ultimoError = e; return soloIA(e) });
    const outs = await enParalelo(bloques.map((b, i) => () => pedir(b, i)), 3);
    if (!outs.some(Boolean)) throw ultimoError || new ApiError("ia", "La IA ha fallado. Vuelve a intentarlo.");
    const test = [], cortas = [], vistas = new Set();
    for (const out of outs) {
      for (const q of (out?.test || [])) {
        if (!q || !Array.isArray(q.opciones) || q.opciones.length < 2 || !Number.isInteger(+q.correcta) || +q.correcta >= q.opciones.length) continue;
        const k = String(q.pregunta).toLowerCase().slice(0, 80); if (vistas.has(k)) continue; vistas.add(k);
        test.push(shuffleTest({ pregunta: String(q.pregunta), opciones: q.opciones.map(String), correcta: +q.correcta, tema: String(q.tema || ""), explicacion: String(q.explicacion || "") }));
      }
      for (const q of (out?.cortas || [])) if (q?.pregunta) cortas.push({ pregunta: String(q.pregunta), tema: String(q.tema || ""), respuestaModelo: String(q.respuestaModelo || ""), puntosClave: (q.puntosClave || []).map(String) });
    }
    if (!test.length && !cortas.length) throw new ApiError("json", "No se han podido crear preguntas. Vuelve a intentarlo.");
    S.exam = { test: test.slice(0, f.test), cortas: cortas.slice(0, f.cortas) };
    refreshCuenta();
    startExam(f);
  } catch (e) { fail(back, e) }
}

/* ============ 4. examen ============ */
function startExam(f){
  S.answers = { test: {}, cortas: {} };
  clearInterval(S.timer);
  S.endsAt = f.minutos ? Date.now() + f.minutos * 60000 : 0;
  go("exam");
  if (S.endsAt) S.timer = setInterval(tick, 1000);
}
const fmtTime = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` };
function tick(){
  const left = S.endsAt - Date.now(); const t = $("#timer");
  if (t) { t.textContent = fmtTime(left); t.classList.toggle("low", left < 60000) }
  if (left <= 0) { clearInterval(S.timer); submit(true) }
}
function contestadas(){ return Object.keys(S.answers.test).length + Object.values(S.answers.cortas).filter(v => v.trim()).length }
function updateProgress(){
  const total = S.exam.test.length + S.exam.cortas.length, done = contestadas();
  const p = $("#prog"); if (p) p.style.width = (total ? done / total * 100 : 0) + "%";
  const c = $("#progTxt"); if (c) c.textContent = `${done}/${total}`;
}
function vExam(){
  const { test, cortas } = S.exam;
  const el = h(`<div style="display:flex;flex-direction:column;gap:14px">
    <div class="exambar"><span class="timer" id="timer">${S.endsAt ? fmtTime(S.endsAt - Date.now()) : "Sin límite"}</span>
      <div class="progress" aria-hidden="true"><i id="prog"></i></div><span class="small muted" id="progTxt"></span></div>
    ${S.examFocus ? `<div class="notice">Repaso solo de tus temas flojos: ${esc(S.examFocus.join(", "))}</div>` : ""}
    ${test.length ? `<section class="sheet"><span class="eyebrow">Parte 1 · Tipo test (${test.length})</span><div id="qt"></div></section>` : ""}
    ${cortas.length ? `<section class="sheet"><span class="eyebrow">Parte 2 · Respuesta corta (${cortas.length})</span><div id="qc"></div></section>` : ""}
    <button class="btn btn-primary" id="submit">Entregar examen</button>
    <div id="confirm"></div>
  </div>`);
  const qt = $("#qt", el);
  test.forEach((q, i) => {
    const b = h(`<div class="q"><span class="qn">${i + 1}.</span><p class="qt">${esc(q.pregunta)}</p><div class="opts"></div></div>`);
    q.opciones.forEach((o, j) => {
      const id = `t${i}_${j}`;
      const lab = h(`<label class="opt" for="${id}"><input type="radio" name="t${i}" id="${id}" value="${j}"><span class="letter">${LET[j]})</span><span>${esc(o)}</span></label>`);
      lab.querySelector("input").onchange = () => { S.answers.test[i] = j; updateProgress() };
      b.querySelector(".opts").append(lab);
    });
    qt.append(b);
  });
  const qc = $("#qc", el);
  cortas.forEach((q, i) => {
    const b = h(`<div class="q"><span class="qn">${test.length + i + 1}.</span><label class="qt" for="c${i}">${esc(q.pregunta)}</label><textarea id="c${i}" placeholder="Tu respuesta…"></textarea></div>`);
    b.querySelector("textarea").oninput = (e) => { S.answers.cortas[i] = e.target.value; updateProgress() };
    qc.append(b);
  });
  $("#submit", el).onclick = () => {
    const total = test.length + cortas.length, done = contestadas();
    if (done < total) {
      $("#confirm").innerHTML = `<div class="notice" style="display:flex;flex-direction:column;gap:10px">Te faltan ${total - done} preguntas sin contestar. ¿Entregar igual?<div class="row"><button class="btn btn-ghost" id="cNo">Seguir</button><button class="btn btn-primary" id="cYes">Entregar</button></div></div>`;
      $("#cNo").onclick = () => $("#confirm").innerHTML = "";
      $("#cYes").onclick = () => submit(false);
    } else submit(false);
  };
  requestAnimationFrame(updateProgress);
  return el;
}

/* ============ 5. corrección ============ */
function porClaves(q, a){
  const txt = (a || "").toLowerCase(); const keys = q.puntosClave || [];
  const faltan = keys.filter(k => !txt.includes(String(k).toLowerCase()));
  return { nota: keys.length ? Math.round((keys.length - faltan.length) / keys.length * 10) : 0, comentario: faltan.length ? `Corregida por palabras clave. Te faltan: ${faltan.join(", ")}.` : "Corregida por palabras clave: completa." };
}
async function submit(auto){
  clearInterval(S.timer);
  const { test, cortas } = S.exam;
  const testRes = test.map((q, i) => ({ ok: S.answers.test[i] === q.correcta, given: S.answers.test[i] }));
  const resp = cortas.map((q, i) => (S.answers.cortas[i] || "").trim());
  let shortRes = cortas.map(() => ({ nota: 0, comentario: "Sin responder." }));
  if (resp.some(Boolean)) {
    ctl = new AbortController();
    busy("Corrigiendo tus respuestas…", auto ? "Se acabó el tiempo" : "Como lo haría tu profe");
    try {
      const out = await apiIA("/api/corregir", { preguntas: cortas.map((q, i) => ({ ...q, respuesta: resp[i] })) });
      shortRes = cortas.map((q, i) => { const r = (Array.isArray(out) ? out : []).find(x => +x.i === i); return resp[i] ? { nota: Math.max(0, Math.min(10, +r?.nota || 0)), comentario: String(r?.comentario || "") } : { nota: 0, comentario: "Sin responder." } });
    } catch (e) {
      shortRes = cortas.map((q, i) => resp[i] ? porClaves(q, resp[i]) : { nota: 0, comentario: "Sin responder." });
    }
  }
  const max = test.length + cortas.length * 2;
  const pts = testRes.filter(r => r.ok).length + shortRes.reduce((s, r) => s + r.nota / 5, 0);
  const nota = max ? Math.round(pts / max * 100) / 10 : 0;
  const byTema = {};
  test.forEach((q, i) => { const k = q.tema || "General"; byTema[k] ??= { got: 0, max: 0 }; byTema[k].max += 1; byTema[k].got += testRes[i].ok ? 1 : 0 });
  cortas.forEach((q, i) => { const k = q.tema || "General"; byTema[k] ??= { got: 0, max: 0 }; byTema[k].max += 2; byTema[k].got += shortRes[i].nota / 5 });
  const temas = Object.entries(byTema).map(([k, v]) => ({ tema: k, pct: Math.round(v.got / v.max * 100) })).sort((a, b) => a.pct - b.pct);
  S.result = { testRes, shortRes, nota, temas, auto };
  S.review = null;
  sb.from("simulacros").insert({ user_id: S.session.user.id, apuntes_id: S.apuntesId, asignatura: S.subject || "", examen: { ...S.exam, respuestas: S.answers }, resultado: S.result, nota }).then(() => {}, () => {});
  go("results");
}
function vResults(){
  const R = S.result, { test, cortas } = S.exam;
  const pass = R.nota >= 5, weak = R.temas.filter(t => t.pct < 70), okT = R.testRes.filter(r => r.ok).length;
  const el = h(`<div style="display:flex;flex-direction:column;gap:18px">
    <section class="sheet">
      <span class="eyebrow">Tu nota${R.auto ? " · tiempo agotado" : ""}</span>
      <div class="score"><div class="grade">${num(R.nota)}<small>/10</small></div><span class="stamp ${pass ? "pass" : "fail"}">${pass ? (R.nota >= 9 ? "¡Sobresaliente!" : R.nota >= 7 ? "Notable" : "Aprobado") : "Suspenso"}</span></div>
      <p class="muted">Test: <b>${okT}/${test.length}</b>${cortas.length ? ` · Cortas: <b>${num(R.shortRes.reduce((s, r) => s + r.nota, 0) / cortas.length)}</b> de media` : ""}</p>
    </section>
    <section class="sheet">
      <span class="eyebrow">Por temas</span>
      <div class="bars" id="bars"></div>
      ${weak.length ? `<div class="notice">Tienes que repasar: <b>${esc(weak.map(w => w.tema).join(", "))}</b></div>` : `<div class="notice">Ningún tema por debajo del 70 %. Buen trabajo.</div>`}
      <div id="msg"></div>
      <div class="row">${weak.length ? `<button class="btn btn-hl" id="rev">Ver repaso de lo que fallé</button>` : ""}<button class="btn btn-ghost" id="again">Otro simulacro</button></div>
    </section>
    <section class="sheet"><span class="eyebrow">Corrección pregunta a pregunta</span><div id="corr"></div></section>
  </div>`);
  const bars = $("#bars", el);
  R.temas.forEach(t => {
    const col = t.pct >= 70 ? "var(--ok)" : t.pct >= 50 ? "var(--warn)" : "var(--bad)";
    bars.append(h(`<div class="bar"><span style="min-width:0">${esc(t.tema)}</span><span class="pct" style="color:${col}">${t.pct} %</span><div class="track"><i style="width:${t.pct}%;background:${col}"></i></div></div>`));
  });
  const corr = $("#corr", el);
  test.forEach((q, i) => {
    const r = R.testRes[i];
    const b = h(`<div class="q"><div style="display:flex;justify-content:space-between;gap:10px"><span class="qn">${i + 1}.</span><span class="verdict ${r.ok ? "ok" : "bad"}">${r.ok ? "✓ Bien" : r.given == null ? "— Sin contestar" : "✗ Mal"}</span></div>
      <p class="qt">${esc(q.pregunta)}</p><div class="opts"></div>${q.explicacion ? `<p class="fb">${esc(q.explicacion)}</p>` : ""}</div>`);
    q.opciones.forEach((o, j) => b.querySelector(".opts").append(h(`<div class="opt ${j === q.correcta ? "right" : j === r.given ? "wrong" : ""}"><span class="letter">${LET[j]})</span><span>${esc(o)}</span></div>`)));
    corr.append(b);
  });
  cortas.forEach((q, i) => {
    const r = R.shortRes[i], cls = r.nota >= 7 ? "ok" : r.nota >= 5 ? "mid" : "bad";
    corr.append(h(`<div class="q"><div style="display:flex;justify-content:space-between;gap:10px"><span class="qn">${test.length + i + 1}.</span><span class="verdict ${cls}">${num(r.nota)} / 10</span></div>
      <p class="qt">${esc(q.pregunta)}</p><span class="eyebrow">Tu respuesta</span><p class="answer">${esc(S.answers.cortas[i] || "(sin responder)")}</p>
      <p class="fb">${esc(r.comentario)}</p><span class="eyebrow">Respuesta modelo</span><p class="answer">${esc(q.respuestaModelo)}</p></div>`));
  });
  const rv = $("#rev", el); if (rv) rv.onclick = buildReview;
  $("#again", el).onclick = () => go("format");
  return el;
}

/* ============ 6. repaso ============ */
const ytLink = (q) => "https://www.youtube.com/results?search_query=" + encodeURIComponent(q);
async function buildReview(){
  const weak = S.result.temas.filter(t => t.pct < 70).map(t => t.tema);
  const temas = weak.map(n => S.topics.find(t => t.titulo === n) || { titulo: n, contenido: "" }).map(t => ({ titulo: t.titulo, contenido: t.contenido }));
  const fallos = S.exam.test.map((q, i) => ({ q, r: S.result.testRes[i] })).filter(x => !x.r.ok)
    .map(x => `${x.q.pregunta} → correcta: ${x.q.opciones[x.q.correcta]}${x.r.given != null ? ` (puso: ${x.q.opciones[x.r.given]})` : ""}`);
  ctl = new AbortController();
  busy("Preparando tu repaso…", "Solo de lo que has fallado");
  try {
    const out = await apiIA("/api/repaso", { asignatura: S.subject, temas, fallos });
    S.review = (Array.isArray(out) ? out : []).map(r => ({ tema: String(r.tema || ""), resumen: String(r.resumen || ""), claves: (r.claves || []).map(String), busquedas: (r.busquedas || []).map(String).slice(0, 3) }));
    if (!S.review.length) throw new ApiError("json", "No se ha podido preparar el repaso. Vuelve a intentarlo.");
    go("review");
  } catch (e) { fail("results", e) }
}
function vReview(){
  const el = h(`<section class="sheet">
    <span class="eyebrow">Repaso · lo que has fallado</span>
    <h2 style="font-size:26px">Tu hoja de repaso</h2>
    <p class="muted">Léela, mira un vídeo de cada tema y vuelve a examinarte solo de esto.</p>
    <div id="rl" style="display:flex;flex-direction:column;gap:12px"></div>
    <div id="msg"></div>
    <div class="row"><button class="btn btn-hl" id="retry">Examinarme solo de mis fallos</button><button class="btn btn-ghost" id="pdf">Descargar PDF de repaso</button></div>
    <button class="btn btn-ghost" id="back">Volver a la nota</button>
  </section>`);
  const rl = $("#rl", el);
  S.review.forEach(r => rl.append(h(`<article class="rev"><h3>${esc(r.tema)}</h3><p>${esc(r.resumen)}</p>
    ${r.claves.length ? `<div><span class="eyebrow">Para que no se te olvide</span><ul>${r.claves.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div>` : ""}
    <div class="yt"><span class="eyebrow">Vídeos en YouTube</span>${r.busquedas.map(b => `<a href="${esc(ytLink(b))}" target="_blank" rel="noopener">${esc(b)}</a>`).join("")}</div></article>`)));
  $("#back", el).onclick = () => go("results");
  $("#retry", el).onclick = () => {
    const names = new Set(S.review.map(r => r.tema));
    const only = S.topics.filter(t => names.has(t.titulo));
    generate(only.length ? only : S.topics.filter(t => t.entra !== false));
  };
  $("#pdf", el).onclick = makePdf;
  return el;
}
function makePdf(){
  const { jsPDF } = window.jspdf; const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 18, maxW = 210 - M * 2; let y = 22;
  const line = (txt, size, style, color) => {
    doc.setFont("helvetica", style || "normal"); doc.setFontSize(size); doc.setTextColor(...(color || [22, 33, 61]));
    for (const l of doc.splitTextToSize(txt, maxW)) { if (y > 280) { doc.addPage(); y = 20 } doc.text(l, M, y); y += size * 0.45 }
  };
  doc.setDrawColor(229, 72, 77); doc.line(M - 6, 10, M - 6, 287);
  line("Entra · Hoja de repaso", 20, "bold", [35, 70, 200]); y += 2;
  line(`${S.subject} · Nota del simulacro: ${num(S.result.nota)}/10`, 11, "normal", [74, 86, 119]); y += 4;
  S.review.forEach(r => {
    line(r.tema, 14, "bold"); y += 1; line(r.resumen, 11); y += 2;
    r.claves.forEach(c => line("• " + c, 11)); y += 2;
    r.busquedas.forEach(b => line("YouTube: " + b, 10, "italic", [198, 47, 54])); y += 5;
  });
  doc.save(`repaso-${(S.subject || "entra").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.pdf`);
}

/* ============ arranque ============ */
async function afterLogin(){
  if (S.recuperando) return go("clave");
  $("#logout").hidden = false; $("#delAcc").hidden = false;
  if (!S.cuenta) await refreshCuenta();
  if (S.cuenta && !S.cuenta.terminos) {
    // Si marcó la casilla al pedir el código con este mismo email, no volvemos a preguntar
    let ac = null; try { ac = JSON.parse(localStorage.getItem("entra.acepto")) } catch {}
    if (ac?.email && ac.email === S.session.user.email?.toLowerCase()) {
      const { error } = await sb.from("perfiles").update({ acepto_terminos_at: ac.at }).eq("id", S.session.user.id);
      if (!error) await refreshCuenta();
    }
    if (!S.cuenta?.terminos) return go("terms");
  }
  const q = new URLSearchParams(location.search);
  await loadHistorial();
  go("home");
  if (q.get("pago") === "ok") { flash("¡Ya eres Pro! Puede tardar unos segundos en aparecer.", "notice"); esperarPro() }
  if (q.get("pro") === "1" && S.cuenta?.plan !== "pro") pagar("suscribir");
  if (q.has("pago") || q.has("pro")) history.replaceState(null, "", "/app");
}
// El webhook de Stripe puede llegar unos segundos después de volver del pago
async function esperarPro(){
  for (let i = 0; i < 10 && S.cuenta?.plan !== "pro"; i++) { await new Promise(r => setTimeout(r, 2000)); await refreshCuenta() }
}
$("#logout").onclick = () => sb.auth.signOut();
$("#delAcc").onclick = () => {
  const box = $("#delBox");
  box.innerHTML = `<div class="error" style="display:flex;flex-direction:column;gap:10px">Se borrarán tu cuenta, tus apuntes y tus resultados, y se cancelará Pro si lo tienes. No se puede deshacer.<div class="row"><button class="btn btn-ghost" id="dNo">Cancelar</button><button class="btn btn-primary" id="dYes">Borrar todo</button></div></div>`;
  $("#dNo").onclick = () => box.innerHTML = "";
  $("#dYes").onclick = async () => {
    try { ctl = null; await api("/api/borrar", {}); box.innerHTML = ""; await sb.auth.signOut() }
    catch (e) { box.innerHTML = `<div class="error">${esc(e.message)}</div>` }
  };
};
S.recuperando = /type=recovery/.test(location.hash); // viene del email de "he olvidado mi contraseña"
sb.auth.onAuthStateChange((evt, session) => {
  if (evt === "PASSWORD_RECOVERY") S.recuperando = true;
  const was = !!S.session; S.session = session;
  if (session && !was) { refreshCuenta().then(afterLogin) }
  if (S.recuperando && session) return go("clave");
  if (!session) { S.cuenta = null; drawAccount(); $("#logout").hidden = true; $("#delAcc").hidden = true; go("login") }
});
sb.auth.getSession().then(({ data }) => { if (!data.session) go("login") });
})();
