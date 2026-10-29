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
  // 5xx: el servidor o la IA han fallado o tardado demasiado → se reintenta como "saturada" (no es un error de la cuenta)
  if (r.status >= 500) throw new ApiError("ocupado", "La IA está saturada ahora mismo. Prueba en un minuto.");
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
const soloIA = (e) => { if (e?.name === "AbortError" || [401, 402, 403].includes(e?.status)) throw e; return null };

async function refreshCuenta(){
  try { S.cuenta = await api("/api/cuenta") } catch (e) { S.cuenta = null }
  drawAccount();
}
function drawAccount(){
  const box = $("#account"); const c = S.cuenta;
  drawPerfil();
  if (!c || !S.session) { box.hidden = true; return }
  box.hidden = false;
  box.innerHTML = `<span class="pill ${c.plan === "pro" ? "pro" : ""}">${etiquetaPlan(c)}</span>
    <span>Simulacros <b>${c.uso.simulacros}/${c.limite.simulacros}</b></span>
    <span>Páginas <b>${c.uso.paginas}/${c.limite.paginas}</b></span>
    ${c.suscrito ? `<button class="btn btn-ghost btn-sm" id="portal">Gestionar suscripción</button>`
      : `<button class="btn btn-hl btn-sm" id="goPro">${c.plan === "pro" ? "Hazte Pro mensual" : "Pasarme a Pro"}</button>`}`;
  const gp = $("#goPro"); if (gp) gp.onclick = () => pagar("suscribir");
  const pt = $("#portal"); if (pt) pt.onclick = () => pagar("portal");
}
// "Pro" (suscripción), "Pro · hasta 3 nov." (pase de examen) o "Gratis"
const etiquetaPlan = (c) => c?.suscrito ? "Pro" : c?.proHasta ? `Pro · hasta ${new Date(c.proHasta).toLocaleDateString("es-ES", { day: "numeric", month: "short" })}` : c?.plan === "pro" ? "Pro" : "Gratis";
// Próximo examen apuntado en el planificador (para los avisos de Pro)
const proximoExamen = () => (S.examenes || []).map(e => ({ ...e, d: diasHasta(e.fecha) })).find(e => e.d >= 0);
async function pagar(accion){
  if ((accion === "suscribir" || accion === "pase") && CFG.STRIPE_PUBLISHABLE_KEY) { S.pagoTipo = accion === "pase" ? "pase" : (S.pagoTipo || null); return go("pago") }
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
  const V = { testEstudio: vTestEstudio, metodo: vMetodo, login: vLogin, clave: vClave, terms: vTerms, pago: vPago, home: vHome, topics: vTopics, format: vFormat, exam: vExam, results: vResults, review: vReview, busy: vBusy, invitar: vInvitar, ranking: vRanking }[S.view];
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
    if (isLimit && S.cuenta?.plan !== "pro" && CFG.STRIPE_PUBLISHABLE_KEY) muroPro(e);
    else flash(e?.message || "Algo ha fallado.");
    refreshCuenta();
  });
}

// Se ha acabado el plan gratis: explica qué ha pasado y ofrece el pase de examen o Pro mensual
function muroPro(e){
  const c = S.cuenta || {}, ex = proximoExamen(), que = /pagina/.test(e?.code || "") ? "páginas" : /mensaje/.test(e?.code || "") ? "mensajes al tutor" : "simulacros";
  const n = que === "páginas" ? c.limite?.paginas : que === "simulacros" ? c.limite?.simulacros : c.limite?.mensajes;
  const box = $("#msg") || $("#view");
  box.innerHTML = `<div class="muro">
    <b>Has usado tus ${n || ""} ${que} gratis de este mes.</b>
    ${ex ? `<p>Tu examen de <b>${esc(ex.asignatura)}</b> es ${ex.d === 0 ? "<b>hoy</b>" : ex.d === 1 ? "<b>mañana</b>" : `en <b>${ex.d} días</b>`}. No te quedes sin practicar ahora.</p>` : `<p>Sigue practicando sin esperar al mes que viene.</p>`}
    <div class="opciones-pro">
      <button class="opcion ${ex && ex.d <= 10 ? "rec" : ""}" id="mPase"><b>Pase de examen · ${esc(CFG.PRECIO_PASE || "1,99 €")}</b><span>Todo Pro durante 7 días. Pago único, sin suscripción.</span></button>
      <button class="opcion ${ex && ex.d <= 10 ? "" : "rec"}" id="mPro"><b>Pro · ${esc(CFG.PRECIO_PRO || "")}</b><span>${c.limite ? "60 simulacros y 300 páginas al mes" : "Mucho más cada mes"}. Cancela cuando quieras.</span></button>
    </div>
    <button class="btn btn-ghost btn-sm" id="mInvitar">🎁 O invita a un amigo y ganad 1 simulacro cada uno</button>
  </div>`;
  $("#mPase").onclick = () => pagar("pase");
  $("#mPro").onclick = () => { S.pagoTipo = "suscribir"; pagar("suscribir") };
  $("#mInvitar").onclick = () => go("invitar");
  box.scrollIntoView({ behavior: "smooth", block: "center" });
}

/* ============ login y términos ============ */
const msgAuth = (e) => {
  const m = e?.message || "";
  if (/already registered|already exists/i.test(m)) return "Ese email ya tiene cuenta. Pulsa \"Ya tengo cuenta\" y entra con tu contraseña.";
  if (/invalid login credentials/i.test(m)) return "Email o contraseña incorrectos.";
  if (/email not confirmed/i.test(m)) return "Antes de entrar, confirma tu email con el enlace que te hemos enviado.";
  if (/password/i.test(m) && /least|short|weak/i.test(m)) return "La contraseña es demasiado corta o débil. Usa al menos 8 caracteres.";
  if (/rate limit|seconds/i.test(m)) return "Demasiados intentos seguidos. Espera un minuto y vuelve a probar.";
  return m || "Algo ha fallado. Vuelve a intentarlo.";
};
function vLogin(){
  const nuevo = S.loginModo !== "entrar";
  const para = { metodo: "descubre tu método de estudio", planificador: "planifica tu examen" }[new URLSearchParams(location.search).get("ir")] || "haz tu primer simulacro";
  const el = h(`<section class="sheet">
    <span class="eyebrow">${nuevo ? "Empieza gratis" : "Entrar"}</span>
    <h2 style="font-size:28px">${nuevo ? `Crea tu cuenta y ${para}` : "Entra en tu cuenta"}</h2>
    <div class="presets" role="tablist"><button class="chip ${nuevo ? "on" : ""}" id="tNuevo">Crear cuenta</button><button class="chip ${nuevo ? "" : "on"}" id="tEntrar">Ya tengo cuenta</button></div>
    ${CFG.GOOGLE ? `<button class="btn btn-ghost" id="google">Continuar con Google</button><div class="sep">o con tu email</div>` : ""}
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
  return el;
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
// El servidor dice qué clave pública usar (prueba o real, según su clave secreta)
let stripeJs = null; const stripes = {};
const cargarStripeJs = () => stripeJs ??= new Promise((ok, ko) => {
  const s = document.createElement("script"); s.src = CFG.STRIPE_JS || "https://js.stripe.com/v3/";
  s.onload = () => ok(); s.onerror = () => { stripeJs = null; ko(new Error("No se ha podido cargar el pago.")) };
  document.head.append(s);
});
const cargarStripe = async (pk = CFG.STRIPE_PUBLISHABLE_KEY) => { await cargarStripeJs(); return stripes[pk] ??= window.Stripe(pk) };
function vPago(){
  const c = S.cuenta || {}, ex = proximoExamen();
  if (c.plan === "pro" && !c.suscrito) S.pagoTipo = "suscribir"; // con pase activo, lo que queda es la suscripción
  S.pagoTipo ||= ex && ex.d <= 10 ? "pase" : "suscribir";
  const pase = S.pagoTipo === "pase";
  const el = h(`<section class="sheet">
    <span class="eyebrow">Entra Pro</span>
    <h2 style="font-size:26px">${ex && ex.d <= 10 ? `Prepara ${esc(ex.asignatura)} sin límites` : "Pásate a Pro"}</h2>
    <div class="opciones-pro">
      ${c.plan === "pro" && !c.suscrito ? "" : `<button class="opcion ${pase ? "on" : ""}" data-p="pase"><b>Pase de examen · ${esc(CFG.PRECIO_PASE || "1,99 €")}</b><span>7 días de Pro. Pago único, sin suscripción. Ideal para la semana del examen.</span></button>`}
      <button class="opcion ${pase ? "" : "on"}" data-p="suscribir"><b>Pro mensual · ${esc(CFG.PRECIO_PRO || "")}</b><span>Para todo el curso. Cancela cuando quieras.</span></button>
    </div>
    <table class="comparativa">
      <thead><tr><th></th><th>Gratis</th><th>Pro</th></tr></thead>
      <tbody>
        <tr><td>Simulacros al mes</td><td>3</td><td><b>60</b></td></tr>
        <tr><td>Páginas de apuntes</td><td>25</td><td><b>300</b></td></tr>
        <tr><td>Mensajes al tutor</td><td>20</td><td><b>200</b></td></tr>
        <tr><td>Repaso de fallos, racha y ranking</td><td>✓</td><td>✓</td></tr>
      </tbody>
    </table>
    <p class="muted small">Pago seguro con Stripe.${pase ? " No se renueva solo." : ` Cancela cuando quieras desde "Gestionar suscripción".`}</p>
    <div id="checkout" style="min-height:420px"><div class="loading"><div class="pen" aria-hidden="true"></div><p class="muted">Cargando el pago…</p></div></div>
    <div id="msg"></div>
    <button class="btn btn-ghost" id="back">Volver</button>
  </section>`);
  el.querySelectorAll("[data-p]").forEach(b => b.onclick = () => { if (S.pagoTipo === b.dataset.p) return; S.pagoTipo = b.dataset.p; if (S.checkout) { S.checkout.destroy(); S.checkout = null } render() });
  $("#back", el).onclick = () => go("home");
  (async () => {
    try {
      ctl = null;
      const [, { clientSecret, publishableKey }] = await Promise.all([cargarStripeJs(), api("/api/pago", { accion: S.pagoTipo, embebido: true })]);
      const stripe = await cargarStripe(publishableKey || CFG.STRIPE_PUBLISHABLE_KEY);
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
/* ============ prepárate para tu examen + test de método de estudio ============ */
const METODOS = {
  pomodoro: { nombre: "Pomodoro", icono: "🍅",
    por: "Te cuesta mantener la concentración mucho rato y el móvil te tira. Trabajar en bloques cortos con descansos te mantiene enfocado sin agotarte.",
    como: ["25 minutos de estudio sin móvil (en otra habitación o en modo avión).", "5 minutos de descanso de verdad: levántate, bebe agua.", "Cada 4 pomodoros, un descanso largo de 15-30 minutos.", "Antes de empezar, apunta qué vas a hacer en ese pomodoro."],
    entra: "Un simulacro Rápido (10 test + 2 cortas) cabe en un pomodoro. Repasa los fallos en el siguiente.",
    sesion: (d) => d > 14 ? "3 pomodoros al día" : d > 3 ? "4-6 pomodoros al día" : "6-8 pomodoros al día, con descansos" },
  espaciada: { nombre: "Repetición espaciada", icono: "🔁",
    por: "Recuerdas mejor cuando repasas poco y a menudo, y te van las asignaturas con mucho que memorizar. Repasar justo antes de olvidar fija los datos a largo plazo.",
    como: ["Estudia un tema y repásalo al día siguiente, a los 3 días y a la semana.", "Haz tarjetas pregunta-respuesta con los datos clave (fechas, cifras, definiciones).", "Repasa primero las tarjetas que fallas.", "Mejor 30 minutos cada día que 4 horas un solo día."],
    entra: "Repite simulacros cortos en días distintos y usa \"Examinarme solo de mis fallos\" como tus tarjetas.",
    sesion: (d) => d > 14 ? "30-45 minutos al día" : d > 3 ? "1 hora al día en 2 tandas" : "2 tandas de 1 hora al día" },
  feynman: { nombre: "Técnica Feynman", icono: "🗣️",
    por: "Aprendes cuando entiendes el porqué y lo puedes contar. Explicarlo con tus palabras te enseña enseguida qué no sabes.",
    como: ["Elige un concepto y explícalo en voz alta como si se lo contaras a alguien de 12 años.", "Donde te atasques, vuelve a los apuntes: ahí está tu hueco.", "Simplifica y usa ejemplos propios.", "Si puedes, explícaselo a un compañero."],
    entra: "Responde las preguntas cortas en voz alta antes de escribirlas y pregúntale al Tutor lo que no entiendas.",
    sesion: (d) => d > 14 ? "un tema explicado al día" : d > 3 ? "2-3 temas explicados al día" : "explica en voz alta todos los temas que entran" },
  esquemas: { nombre: "Esquemas y mapas mentales", icono: "🗺️",
    por: "Recuerdas lo que ves y te ayuda tener una visión de conjunto. Ordenar el temario en un esquema te dice por dónde empezar y cómo se relaciona todo.",
    como: ["Haz un mapa por tema: idea central en medio y ramas con lo importante.", "Usa colores: uno para definiciones, otro para cifras, otro para ejemplos.", "Pocas palabras por rama; dibuja si te ayuda.", "Repasa mirando solo el mapa e intenta reconstruirlo sin mirar."],
    entra: "Usa \"Qué entra\" para ver los temas de un vistazo y la hoja de repaso en PDF como esquema final.",
    sesion: (d) => d > 14 ? "un esquema nuevo cada día" : d > 3 ? "repasa 2-3 esquemas al día" : "repasa todos los esquemas cada día" },
  simulacros: { nombre: "Práctica con exámenes", icono: "📝",
    por: "Aprendes poniéndote a prueba y corrigiendo tus errores. Releer te aburre; hacer preguntas te activa y te dice exactamente qué te falta.",
    como: ["Estudia un tema rápido y ponte a prueba enseguida.", "Haz simulacros con el formato y el tiempo del examen real.", "Después de cada simulacro, repasa solo lo que fallaste.", "Repite hasta que saques más de un 8."],
    entra: "Es justo lo que hace Entra: simulacro con el formato de tu profe, nota y repaso de fallos. Úsalo mucho.",
    sesion: (d) => d > 14 ? "un simulacro cada 3 días" : d > 3 ? "un simulacro al día" : "un simulacro completo al día y repaso de fallos" },
  bloques: { nombre: "Bloques de estudio profundo", icono: "🎯",
    por: "Cuando te pones, aguantas mucho rato concentrado y te cunde. Bloques largos sin interrupciones te permiten avanzar temas enteros de una vez.",
    como: ["Bloques de 60-90 minutos con un objetivo concreto (\"terminar el tema 3\").", "Fuera todo: móvil lejos, notificaciones apagadas.", "Descanso de 15 minutos entre bloques.", "No más de 3-4 bloques al día para no quemarte."],
    entra: "Haz el simulacro \"Como mi profe (39+5)\" de una sentada, con el tiempo real.",
    sesion: (d) => d > 14 ? "1 bloque al día" : d > 3 ? "2 bloques al día" : "3 bloques al día" },
};
const TEST = [
  { p: "¿Cuánto aguantas estudiando concentrado sin mirar el móvil?", o: [["Menos de 20 minutos", { pomodoro: 2 }], ["Entre 20 y 45 minutos", { pomodoro: 1, espaciada: 1 }], ["Más de una hora", { bloques: 2 }]] },
  { p: "¿Qué es lo que mejor te funciona al estudiar?", o: [["Hacer esquemas y dibujos", { esquemas: 2 }], ["Explicarlo en voz alta", { feynman: 2 }], ["Hacerme preguntas tipo examen", { simulacros: 2 }], ["Repasar un poco cada día", { espaciada: 2 }]] },
  { p: "¿Cómo recuerdas mejor algo?", o: [["Si lo veo: colores, diagramas", { esquemas: 2 }], ["Si lo entiendo y sé contarlo", { feynman: 2 }], ["Si lo repito varias veces", { espaciada: 2 }], ["Si me equivoco y lo corrijo", { simulacros: 2 }]] },
  { p: "¿Cuándo sueles empezar a estudiar para un examen?", o: [["Semanas antes", { espaciada: 2 }], ["Unos días antes", { pomodoro: 1, simulacros: 1 }], ["La noche anterior", { simulacros: 1, bloques: 1 }]] },
  { p: "¿Qué te frena más cuando estudias?", o: [["El móvil y las distracciones", { pomodoro: 2 }], ["Aburrirme de leer lo mismo", { simulacros: 1, feynman: 1 }], ["No saber por dónde empezar", { esquemas: 2 }], ["Nada: si me pongo, me pongo", { bloques: 2 }]] },
  { p: "¿Cómo prefieres estudiar?", o: [["Con alguien, explicándonos cosas", { feynman: 2 }], ["Solo, a mi ritmo", { bloques: 1, espaciada: 1 }], ["Con alguien que me pregunte", { simulacros: 2 }]] },
  { p: "¿Qué te cuesta más de una asignatura?", o: [["Memorizar datos, fechas, cifras", { espaciada: 2 }], ["Entender los conceptos", { feynman: 2 }], ["Relacionar unos temas con otros", { esquemas: 2 }], ["Aplicarlo en ejercicios o preguntas", { simulacros: 2 }]] },
  { p: "Después de una hora estudiando…", o: [["Estoy frito, necesito parar", { pomodoro: 2 }], ["Bien, si cambio de tarea", { pomodoro: 1, esquemas: 1 }], ["Podría seguir un buen rato", { bloques: 2 }]] },
];
const hoyISO = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10) };
const diasHasta = (f) => Math.round((new Date(f + "T00:00:00") - new Date(hoyISO() + "T00:00:00")) / 86400000);
const fechaLarga = (f) => new Date(f + "T00:00:00").toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" });
async function loadPrep(){
  const [ex, es] = await Promise.all([
    sb.from("examenes").select("id, asignatura, fecha").gte("fecha", hoyISO()).order("fecha").limit(10),
    sb.from("estilo_estudio").select("metodo, hecho_at").maybeSingle(),
  ]);
  S.examenes = ex.data || []; S.estilo = es.data || null;
}
// Racha de días seguidos con simulacro y top 3 del ranking (para el inicio)
async function loadComunidad(){
  const [ra, rk] = await Promise.all([sb.rpc("mi_racha"), sb.rpc("ranking", { p_tipo: "simulacros" })]);
  S.racha = (Array.isArray(ra.data) ? ra.data[0] : ra.data) || { actual: 0, mejor: 0, hoy: false };
  S.top = rk.data || [];
}
const dias = (n) => `${n} día${n === 1 ? "" : "s"}`;
function htmlComunidad(){
  const r = S.racha || { actual: 0, mejor: 0, hoy: false }, top = (S.top || []).filter(f => f.puesto <= 3), yo = (S.top || []).find(f => f.yo);
  const medalla = (p) => ["🥇", "🥈", "🥉"][p - 1] || p;
  return `<section class="sheet comunidad">
    <div class="racha ${r.actual ? "viva" : ""}">
      <span class="fuego" aria-hidden="true">🔥</span>
      <div><b>${r.actual ? `Racha de ${dias(r.actual)}` : "Empieza tu racha"}</b>
      <span class="small muted">${r.actual ? (r.hoy ? "¡Hoy ya has estudiado! Vuelve mañana para seguir." : "Haz un simulacro hoy para no perderla.") : "Haz un simulacro cada día y súmala."}${r.mejor > r.actual ? ` · Tu récord: ${dias(r.mejor)}` : ""}</span></div>
    </div>
    <div class="mini-rank">
      <span class="eyebrow">🏆 Ranking de ${new Date().toLocaleDateString("es-ES", { month: "long" })}</span>
      ${top.length ? top.map(f => `<div class="rfila ${f.yo ? "yo" : ""}"><span class="puesto">${medalla(f.puesto)}</span><span class="alias">${esc(f.alias)}</span><span class="dato"><b>${f.simulacros}</b> sim.</span></div>`).join("")
        : `<p class="small muted">Aún no hay nadie este mes. ¡Puedes ser el primero!</p>`}
      ${yo && yo.puesto > 3 ? `<p class="small">Vas el <b>${yo.puesto}.º</b> con ${yo.simulacros} simulacros.</p>` : ""}
      <button class="btn btn-ghost btn-sm" id="hRanking">${S.cuenta?.enRanking ? "Ver ranking completo" : "Apuntarme al ranking"}</button>
    </div>
  </section>`;
}
function planExamen(d, metodo){
  const m = METODOS[metodo];
  const fase = d === 0 ? "¡Hoy es tu examen! Repasa la hoja de repaso 15 minutos, desayuna bien y confía en lo que has trabajado. ¡Mucha suerte!"
    : d === 1 ? "Mañana es el examen: haz solo un simulacro corto, repasa tus fallos con la hoja de repaso y duerme 8 horas."
    : d <= 7 ? "Última semana: un simulacro con el formato real cada día y repaso de lo que falles. Nada de temas nuevos los dos últimos días."
    : d <= 21 ? "Faltan unas semanas: termina de estudiar los temas que entran y haz un simulacro cada 2-3 días para ver qué flojea."
    : "Tienes tiempo: estudia un tema cada pocos días y haz un simulacro corto a la semana para no olvidar lo anterior.";
  return { fase, sesion: m && d > 0 ? `Con tu método (${m.nombre}): ${m.sesion(d)}.` : "" };
}
function htmlPrep(){
  const ex = S.examenes || [], e = ex[0], est = S.estilo && METODOS[S.estilo.metodo];
  const cab = `<span class="eyebrow">Prepárate para tu examen</span>`;
  const testBtn = `<button class="btn ${est ? "btn-ghost" : "btn-hl"} btn-sm" id="pTest">${est ? "Repetir el test de estudio" : "🧠 Test: ¿cuál es tu forma ideal de estudiar?"}</button>`;
  const metodo = est ? `<div class="metodo-mini"><span>${est.icono}</span><div><b>Tu método: ${esc(est.nombre)}</b><br><button class="linklike small" id="pVerMetodo">Ver cómo aplicarlo</button></div></div>` : "";
  if (!e) return `<section class="sheet prep">${cab}
    <h2 style="font-size:24px">¿Cuándo es tu próximo examen?</h2>
    <form id="pForm" class="prep-form">
      <label class="field" for="pAsig">Asignatura<input type="text" id="pAsig" maxlength="80" placeholder="Ej.: PRL" value="${esc(S.subject || "")}"></label>
      <label class="field" for="pFecha">Fecha<input type="date" id="pFecha" min="${hoyISO()}"></label>
      <button class="btn btn-primary" type="submit">Empezar la cuenta atrás</button>
    </form>${metodo}<div class="row">${testBtn}</div><div id="pMsg"></div></section>`;
  const d = diasHasta(e.fecha), plan = planExamen(d, S.estilo?.metodo);
  return `<section class="sheet prep">${cab}
    <div class="cuenta"><div class="dias">${d === 0 ? "¡Hoy!" : d}</div><div><b>${d === 0 ? "es tu examen" : d === 1 ? "día para tu examen" : "días para tu examen"}</b><br><span class="muted">${esc(e.asignatura || "Examen")} · ${esc(fechaLarga(e.fecha))}</span></div></div>
    <p>${esc(plan.fase)}</p>${plan.sesion ? `<p class="small"><b>${esc(plan.sesion)}</b></p>` : ""}
    ${metodo}
    ${ex.length > 1 ? `<div class="small muted">Después: ${ex.slice(1, 4).map((x) => `${esc(x.asignatura || "Examen")} en ${diasHasta(x.fecha)} días`).join(" · ")}</div>` : ""}
    <div class="row">${testBtn}<button class="btn btn-ghost btn-sm" id="pOtro">Añadir otro examen</button><button class="btn btn-ghost btn-sm" id="pBorrar">Quitar este</button></div>
    <form id="pForm" class="prep-form" hidden>
      <label class="field" for="pAsig">Asignatura<input type="text" id="pAsig" maxlength="80" placeholder="Ej.: Historia"></label>
      <label class="field" for="pFecha">Fecha<input type="date" id="pFecha" min="${hoyISO()}"></label>
      <button class="btn btn-primary" type="submit">Guardar examen</button>
    </form><div id="pMsg"></div></section>`;
}
function montarPrep(el){
  const q = (s) => $(s, el);
  if (!q("#pTest")) return;
  q("#pTest").onclick = () => { S.testResp = []; go("testEstudio") };
  const vm = q("#pVerMetodo"); if (vm) vm.onclick = () => go("metodo");
  const otro = q("#pOtro"); if (otro) otro.onclick = () => { q("#pForm").hidden = false; q("#pAsig").focus() };
  const borrar = q("#pBorrar"); if (borrar) borrar.onclick = async () => {
    await sb.from("examenes").delete().eq("id", S.examenes[0].id); await loadPrep(); render();
  };
  q("#pForm").onsubmit = async (e) => {
    e.preventDefault();
    const fecha = q("#pFecha").value, asignatura = q("#pAsig").value.trim();
    if (!fecha || fecha < hoyISO()) return q("#pMsg").innerHTML = `<div class="error">Elige una fecha de hoy en adelante.</div>`;
    const { error } = await sb.from("examenes").insert({ asignatura, fecha });
    if (error) return q("#pMsg").innerHTML = `<div class="error">No se ha podido guardar. Vuelve a intentarlo.</div>`;
    await loadPrep(); render();
  };
}
function vTestEstudio(){
  const i = S.testResp.length, t = TEST[i];
  const el = h(`<section class="sheet">
    <span class="eyebrow">Test de estudio · ${i + 1} de ${TEST.length}</span>
    <div class="progress" aria-hidden="true"><i style="width:${i / TEST.length * 100}%"></i></div>
    <h2 style="font-size:24px">${esc(t.p)}</h2>
    <div class="opts" id="tOpts"></div>
    <div class="row">${i ? `<button class="btn btn-ghost" id="tAtras">Atrás</button>` : `<button class="btn btn-ghost" id="tSalir">Salir</button>`}</div>
  </section>`);
  t.o.forEach(([txt], j) => {
    const b = h(`<button class="opt test-opt"><span class="letter">${LET[j]})</span><span>${esc(txt)}</span></button>`);
    b.onclick = async () => { S.testResp.push(j); if (S.testResp.length < TEST.length) return render(); await terminarTest() };
    $("#tOpts", el).append(b);
  });
  const at = $("#tAtras", el); if (at) at.onclick = () => { S.testResp.pop(); render() };
  const sa = $("#tSalir", el); if (sa) sa.onclick = () => go("home");
  return el;
}
// Botones de la portada: /app?ir=metodo | planificador | simulacro
function irA(destino){
  if (destino === "metodo") { S.testResp = []; return go("testEstudio") }
  if (destino === "ranking" || destino === "invitar") return go(destino);
  const objetivo = destino === "planificador" ? ".prep" : destino === "simulacro" ? "#drop" : null;
  if (!objetivo) return;
  requestAnimationFrame(() => {
    const el = $(objetivo); if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    if (destino === "planificador") { const f = $("#pForm"); if (f?.hidden) $("#pOtro")?.click(); else $("#pAsig")?.focus() }
  });
}
async function terminarTest(){
  const puntos = Object.fromEntries(Object.keys(METODOS).map((k) => [k, 0]));
  S.testResp.forEach((j, i) => { for (const [k, v] of Object.entries(TEST[i].o[j][1])) puntos[k] += v });
  const metodo = Object.keys(METODOS).reduce((a, b) => puntos[b] > puntos[a] ? b : a);
  S.estilo = { metodo, hecho_at: new Date().toISOString() }; S.estiloPuntos = puntos;
  await sb.from("estilo_estudio").upsert({ user_id: S.session.user.id, metodo, puntos, hecho_at: S.estilo.hecho_at });
  go("metodo");
}
function vMetodo(){
  const m = METODOS[S.estilo?.metodo]; if (!m) { go("home"); return h("<div></div>") }
  const e = (S.examenes || [])[0], d = e ? diasHasta(e.fecha) : null;
  const otros = S.estiloPuntos ? Object.entries(S.estiloPuntos).sort((a, b) => b[1] - a[1]).slice(1, 3).filter(([, v]) => v > 0).map(([k]) => METODOS[k].nombre) : [];
  const el = h(`<section class="sheet">
    <span class="eyebrow">Tu forma ideal de estudiar</span>
    <div class="metodo-cab"><span>${m.icono}</span><h2 style="font-size:28px">${esc(m.nombre)}</h2></div>
    <p>${esc(m.por)}</p>
    <div><span class="eyebrow">Cómo aplicarlo</span><ul>${m.como.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div>
    <div class="notice"><b>Con Entra:</b> ${esc(m.entra)}</div>
    ${d != null && d > 0 ? `<p><b>Para tu examen de ${esc(e.asignatura || "")} (faltan ${d} días):</b> ${esc(m.sesion(d))}.</p>` : ""}
    ${otros.length ? `<p class="small muted">También te pueden ir bien: ${esc(otros.join(" y "))}.</p>` : ""}
    <div class="row"><button class="btn btn-primary" id="mVolver">Volver</button><button class="btn btn-ghost" id="mRepetir">Repetir el test</button></div>
  </section>`);
  $("#mVolver", el).onclick = () => go("home");
  $("#mRepetir", el).onclick = () => { S.testResp = []; go("testEstudio") };
  return el;
}
async function loadHistorial(){
  const { data } = await sb.from("apuntes").select("id, asignatura, temas, actualizado_at").order("actualizado_at", { ascending: false }).limit(8);
  S.historial = data || [];
}
function vHome(){
  const el = h(`<div style="display:flex;flex-direction:column;gap:18px">
    ${htmlPrep()}
    ${htmlComunidad()}
    ${S.historial.length ? `<section class="sheet"><span class="eyebrow">Tus apuntes</span><div class="list" id="hist"></div></section>` : ""}
    <section class="sheet">
      <span class="eyebrow">Nuevos apuntes</span>
      <h2 style="font-size:26px">Sube lo que entra en tu examen</h2>
      <label class="field" for="subj">Asignatura o examen<input type="text" id="subj" placeholder="Ej.: PRL · Unidades 1 y 2" value="${esc(S.subject)}"></label>
      <label class="drop" id="drop" for="file">
        <input type="file" id="file" accept="image/jpeg,image/png,image/webp,image/gif,application/pdf,.pdf" multiple>
        <strong>📷 Haz fotos o sube capturas o PDF</strong>
        <span class="muted small">Lee tus anotaciones: "entra", "no entra", "test", "pregunta corta"</span>
      </label>
      <div class="thumbs" id="thumbs"></div>
      <label class="field" for="paste">O pega el texto de tus apuntes<textarea id="paste" placeholder="Pega aquí apuntes en texto…">${esc(S.pasted)}</textarea></label>
      <div id="msg"></div>
      <button class="btn btn-primary" id="analyze">Leer mis apuntes</button>
    </section>
  </div>`);
  $("#hRanking", el).onclick = () => go("ranking");
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
      const pdf = esPdf(f);
      const fig = h(pdf
        ? `<figure class="pdf" title="${esc(f.name)}"><span>PDF</span><small>${esc(f.name)}</small><button aria-label="Quitar ${esc(f.name)}">×</button></figure>`
        : `<figure><img alt="Página ${i + 1}"><button aria-label="Quitar página ${i + 1}">×</button></figure>`);
      if (!pdf) fig.querySelector("img").src = URL.createObjectURL(f);
      fig.querySelector("button").onclick = (e) => { e.preventDefault(); S.files.splice(i, 1); drawThumbs() };
      box.append(fig);
    });
  };
  drawThumbs();
  const add = (list) => { for (const f of list) if (/^image\//.test(f.type) || esPdf(f)) S.files.push(f); drawThumbs() };
  $("#file", el).onchange = (e) => add(e.target.files);
  const drop = $("#drop", el);
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add("over") };
  drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove("over"); add(e.dataTransfer.files) };
  $("#subj", el).oninput = (e) => S.subject = e.target.value;
  $("#paste", el).oninput = (e) => S.pasted = e.target.value;
  montarPrep(el);
  $("#analyze", el).onclick = analyze;
  return el;
}

/* reduce cada foto a ≤1400 px en JPEG para que viaje ligera */
/* PDF: se lee en el navegador con pdf.js. Si una página trae texto se usa el texto (más rápido y barato);
   si es una página escaneada (sin texto) se convierte en imagen como una foto. */
const MAX_PAGINAS_SUBIDA = 60;
const esPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
let pdfjs = null;
const cargarPdfjs = () => pdfjs ??= new Promise((ok, ko) => {
  const base = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/";
  const s = document.createElement("script"); s.src = base + "pdf.min.js";
  s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.js"; ok(window.pdfjsLib) };
  s.onerror = () => { pdfjs = null; ko(new ApiError("pdf", "No se ha podido abrir el lector de PDF. Revisa tu conexión.")) };
  document.head.append(s);
});
async function leerPdf(file, fotos, textos, progreso){
  const lib = await cargarPdfjs();
  let doc;
  try { doc = await lib.getDocument({ data: await file.arrayBuffer() }).promise }
  catch (e) { throw new ApiError("pdf", /password/i.test(e?.name + e?.message) ? `${file.name} tiene contraseña. Quítasela y vuelve a subirlo.` : `No se ha podido abrir ${file.name}.`) }
  if (doc.numPages + fotos.length + textos.length > MAX_PAGINAS_SUBIDA)
    throw new ApiError("pdf", `${file.name} tiene ${doc.numPages} páginas. Sube como mucho ${MAX_PAGINAS_SUBIDA} páginas cada vez (solo lo que entra en el examen).`);
  for (let n = 1; n <= doc.numPages; n++) {
    progreso(n, doc.numPages);
    const page = await doc.getPage(n);
    const txt = (await page.getTextContent()).items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join("").replace(/[ \t]+/g, " ").trim();
    if (txt.length >= 80) { textos.push(`[${file.name} · página ${n}]\n${txt}`); continue }
    // página escaneada → imagen
    const vp1 = page.getViewport({ scale: 1 }), k = Math.min(2.5, 1400 / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale: k }), c = document.createElement("canvas");
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    fotos.push({ tipo: "image/jpeg", base64: c.toDataURL("image/jpeg", 0.78).split(",")[1] });
  }
}
async function comprimir(file){
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" }).catch(() => null);
  if (!bmp) throw new ApiError("foto", `No se ha podido abrir ${file.name}.`);
  const k = Math.min(1, 1400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL("image/jpeg", 0.78);
  return { tipo: "image/jpeg", base64: url.split(",")[1] };
}
async function analyze(){
  if (!S.files.length && !S.pasted.trim()) return flash("Sube al menos una foto, un PDF o pega texto de tus apuntes.", "notice");
  ctl = new AbortController();
  busy("Leyendo tus apuntes…", "Preparando los archivos");
  try {
    // Fotos → imágenes comprimidas. PDF → texto de cada página (o imagen si la página está escaneada)
    const fotos = [], textos = [];
    for (let i = 0; i < S.files.length; i++) {
      const f = S.files[i];
      if (esPdf(f)) await leerPdf(f, fotos, textos, (n, t) => setBusySub(`Abriendo ${f.name}: página ${n} de ${t}`));
      else { setBusySub(`Preparando foto ${i + 1} de ${S.files.length}`); fotos.push(await comprimir(f)) }
    }
    if (fotos.length + textos.length > MAX_PAGINAS_SUBIDA) throw new ApiError("pdf", `Son ${fotos.length + textos.length} páginas. Sube como mucho ${MAX_PAGINAS_SUBIDA} cada vez (solo lo que entra en el examen).`);
    // Lotes: 2 imágenes, u 8 páginas de texto (el texto pegado va con el primer lote de texto)
    const lotes = [];
    for (let i = 0; i < fotos.length; i += 2) lotes.push({ fotos: fotos.slice(i, i + 2), texto: "", paginas: 0 });
    // Texto: modo índice, con las líneas numeradas; la IA solo dice dónde empieza cada tema
    const conPegado = S.pasted.trim() ? [S.pasted.trim()] : [];
    for (let i = 0; i < textos.length || (i === 0 && conPegado.length); i += 8) {
      const trozo = textos.slice(i, i + 8);
      const lineas = [...(i === 0 ? conPegado : []), ...trozo].join("\n\n").split("\n").map(l => l.trim()).filter(Boolean);
      lotes.push({ fotos: [], texto: lineas.map((l, n) => `${n + 1}| ${l}`).join("\n"), paginas: trozo.length, indice: true, lineas });
    }
    let hechos = 0, sinLeer = 0, ultimoError = null; setBusySub(`Leyendo ${fotos.length + textos.length || "el texto"}${fotos.length + textos.length ? " páginas" : ""}…`);
    const outs = await enParalelo(lotes.map(({ lineas, ...lote }) => () => apiIA("/api/leer", lote)
      .then(r => { hechos++; setBusySub(`Leído ${hechos} de ${lotes.length} bloques`); return lineas ? temasDeIndice(r, lineas) : r },
        e => { ultimoError = e; soloIA(e); sinLeer += lote.fotos.length || lote.paginas || 1; return null })), 4);
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
    if (sinLeer) flash(`No he podido leer ${sinLeer} ${sinLeer === 1 ? "página" : "páginas"} porque la IA iba saturada. Puedes subirlas otra vez dentro de un minuto.`, "notice");
  } catch (e) { fail("home", e) }
}
// Convierte la respuesta del modo índice ({temas:[{linea,titulo,…}]}) en temas con el texto original de cada tramo
function temasDeIndice(r, lineas){
  const marcas = (r?.temas || []).map(t => ({ ...t, linea: parseInt(t.linea) }))
    .filter(t => t.linea >= 1 && t.linea <= lineas.length && t.titulo).sort((a, b) => a.linea - b.linea)
    .filter((t, i, arr) => !i || t.linea !== arr[i - 1].linea);
  const limpiar = (ls) => ls.filter(l => !/^\[.+ · página \d+\]$/.test(l)).join("\n").trim();
  if (!marcas.length) return { asignatura: r?.asignatura || "", temas: [{ titulo: "Apuntes", unidad: "", entra: null, notas: "", contenido: limpiar(lineas) }] };
  const temas = marcas.map((t, i) => ({ titulo: String(t.titulo), unidad: String(t.unidad || ""), entra: t.entra, notas: String(t.notas || ""),
    contenido: limpiar(lineas.slice(t.linea - 1, i + 1 < marcas.length ? marcas[i + 1].linea - 1 : lineas.length)) })).filter(t => t.contenido.length > 40);
  return { asignatura: r?.asignatura || "", temas };
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
  const antes = S.racha?.hoy;
  sb.from("simulacros").insert({ user_id: S.session.user.id, apuntes_id: S.apuntesId, asignatura: S.subject || "", examen: { ...S.exam, respuestas: S.answers }, resultado: S.result, nota })
    .then(() => loadComunidad()).then(() => pintarRacha(!antes), () => {});
  refreshCuenta().then(avisoUltimos);
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
    <div id="rachaRes"></div>
    <div id="avisoPro"></div>
    <section class="sheet compartir">
      <div><b>📸 Comparte tu nota</b><p class="small muted">Súbela a tu story o mándala por WhatsApp. Si un amigo entra con tu enlace y hace su primer simulacro, ganáis los dos 1 simulacro y 10 páginas extra.</p></div>
      <div class="row"><button class="btn btn-primary" id="share">Compartir mi nota</button><button class="btn btn-ghost" id="verRanking">🏆 Ranking</button></div>
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
  $("#share", el).onclick = () => compartirNota(R.nota);
  $("#verRanking", el).onclick = () => go("ranking");
  return el;
}

// Tras un simulacro en el plan gratis: avisa cuando queda 1 o ninguno
function avisoUltimos(){
  const c = S.cuenta, box = $("#avisoPro"); if (!c || !box || c.plan === "pro" || !CFG.STRIPE_PUBLISHABLE_KEY) return;
  const quedan = c.limite.simulacros - c.uso.simulacros, ex = proximoExamen();
  if (quedan > 1) return;
  box.innerHTML = `<div class="muro">
    <b>${quedan === 1 ? "Te queda 1 simulacro gratis este mes." : "Has usado todos tus simulacros gratis de este mes."}</b>
    ${ex ? `<p>Tu examen de <b>${esc(ex.asignatura)}</b> es ${ex.d === 0 ? "hoy" : ex.d === 1 ? "mañana" : `en ${ex.d} días`}. Con el pase de examen practicas sin límite toda la semana.</p>` : `<p>Con Pro sigues practicando sin esperar al mes que viene.</p>`}
    <div class="row"><button class="btn btn-hl" id="aPase">Pase de examen · ${esc(CFG.PRECIO_PASE || "1,99 €")}</button><button class="btn btn-ghost" id="aPro">Pro · ${esc(CFG.PRECIO_PRO || "")}</button></div>
  </div>`;
  $("#aPase").onclick = () => pagar("pase");
  $("#aPro").onclick = () => { S.pagoTipo = "suscribir"; pagar("suscribir") };
}
function pintarRacha(nueva){
  const box = $("#rachaRes"), r = S.racha; if (!box || !r?.actual) return;
  box.innerHTML = `<div class="racha viva sheet"><span class="fuego" aria-hidden="true">🔥</span><div><b>${nueva && r.actual > 1 ? `¡Racha de ${dias(r.actual)}!` : nueva ? "¡Racha empezada!" : `Racha de ${dias(r.actual)}`}</b>
    <span class="small muted">${r.actual >= r.mejor && r.actual > 1 ? "¡Es tu récord! " : ""}Vuelve mañana para seguir sumando.</span></div></div>`;
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

/* ============ invitaciones, compartir y ranking ============ */
// El enlace de invitación es /?r=CODIGO (o /app?r=CODIGO): se guarda hasta que la persona entra
try { const r = new URLSearchParams(location.search).get("r"); if (r && /^[a-z0-9]{4,12}$/i.test(r)) localStorage.setItem("entra.ref", r.toLowerCase()) } catch {}
const enlaceInvitacion = () => `${location.origin}/?r=${S.cuenta?.codigo || ""}`;
async function aplicarInvitacion(){
  let r = null; try { r = localStorage.getItem("entra.ref") } catch {}
  if (!r) return false;
  try { localStorage.removeItem("entra.ref") } catch {}
  if (r === S.cuenta?.codigo) return false;
  const { data } = await sb.rpc("usar_invitacion", { p_codigo: r });
  return data === "ok";
}
async function compartir(texto, archivo){
  const url = enlaceInvitacion();
  try {
    if (archivo && navigator.canShare?.({ files: [archivo] })) return await navigator.share({ files: [archivo], text: `${texto} ${url}` });
    if (!archivo && navigator.share) return await navigator.share({ text: texto, url });
  } catch (e) { if (e?.name === "AbortError") return }
  if (archivo) { const a = document.createElement("a"); a.href = URL.createObjectURL(archivo); a.download = archivo.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000) }
  try { await navigator.clipboard.writeText(`${texto} ${url}`); flash(archivo ? "Imagen descargada y enlace copiado. ¡Súbela a tu story!" : "Enlace copiado. Pégalo donde quieras.", "notice") }
  catch { flash(`Copia tu enlace: ${url}`, "notice") }
}
// El ✱ del logo (mismos trazos que /assets/asterisco.svg, en una caja de 100×100)
function dibujarAsterisco(ctx, x, y, size, color){
  ctx.save(); ctx.translate(x, y); ctx.scale(size / 100, size / 100);
  ctx.strokeStyle = color; ctx.lineWidth = 15; ctx.lineCap = "round";
  for (const d of ["M50 10 C51 38 49 62 51 90", "M15 29 C40 42 62 56 86 70", "M84 27 C60 41 39 57 16 72"]) ctx.stroke(new Path2D(d));
  ctx.restore();
}
async function imagenNota(nota){
  await document.fonts?.ready;
  const W = 1080, H = 1920, c = document.createElement("canvas"); c.width = W; c.height = H;
  const x = c.getContext("2d"), disp = (px, w = 800) => `${w} ${px}px "Bricolage Grotesque", "Arial Black", sans-serif`;
  const azul = "#2346c8", tinta = "#16213d", rojo = "#e5484d", pasa = nota >= 5;
  x.fillStyle = "#f7f8fb"; x.fillRect(0, 0, W, H);
  // hoja de cuaderno con margen rojo
  x.fillStyle = "#fff"; x.beginPath(); x.roundRect(90, 330, W - 180, 1180, 44); x.fill();
  x.strokeStyle = "#dfe5f1"; x.lineWidth = 3; for (let ly = 470; ly < 1460; ly += 74) { x.beginPath(); x.moveTo(170, ly); x.lineTo(W - 130, ly); x.stroke() }
  x.strokeStyle = rojo; x.lineWidth = 4; x.beginPath(); x.moveTo(170, 330); x.lineTo(170, 1510); x.stroke();
  // logo
  x.fillStyle = tinta; x.font = disp(120); x.textBaseline = "alphabetic"; x.fillText("Entra", 110, 230);
  dibujarAsterisco(x, 110 + x.measureText("Entra").width + 10, 110, 80, rojo);
  // nota
  x.textAlign = "center"; x.fillStyle = "#4a5677"; x.font = disp(54, 700); x.fillText("He sacado un", W / 2 + 40, 520);
  // nota y "/10" centrados como un bloque
  x.font = disp(300); const nw = x.measureText(num(nota)).width; x.font = disp(90, 700); const dw = x.measureText("/10").width;
  const x0 = W / 2 + 40 - (nw + 16 + dw) / 2; x.textAlign = "left";
  x.fillStyle = pasa ? azul : rojo; x.font = disp(300); x.fillText(num(nota), x0, 870);
  x.fillStyle = "#4a5677"; x.font = disp(90, 700); x.fillText("/10", x0 + nw + 16, 870); x.textAlign = "center";
  // sello
  const sello = pasa ? (nota >= 9 ? "¡Sobresaliente!" : nota >= 7 ? "Notable" : "Aprobado") : "¡A repasar!";
  x.save(); x.translate(W / 2 + 40, 1040); x.rotate(-0.06); x.font = disp(70); const sw = x.measureText(sello).width + 80;
  x.strokeStyle = pasa ? "#1f8a4c" : rojo; x.fillStyle = pasa ? "#1f8a4c" : rojo; x.lineWidth = 8; x.beginPath(); x.roundRect(-sw / 2, -70, sw, 110, 22); x.stroke(); x.fillText(sello, 0, 12); x.restore();
  x.fillStyle = tinta; x.font = `700 46px "Atkinson Hyperlegible", sans-serif`;
  const asig = (S.subject || "mi simulacro").slice(0, 34); x.fillText(`en ${asig}`, W / 2 + 40, 1200, W - 340);
  x.fillStyle = "#4a5677"; x.font = `400 40px "Atkinson Hyperlegible", sans-serif`; x.fillText("Simulacro hecho con mis apuntes", W / 2 + 40, 1290, W - 340);
  if (S.racha?.actual > 1) { x.fillStyle = "#c2410c"; x.font = disp(52, 800); x.fillText(`🔥 ${S.racha.actual} días seguidos estudiando`, W / 2 + 40, 1410, W - 340) }
  // llamada a la acción
  x.fillStyle = "#ffe14a"; x.beginPath(); x.roundRect(140, 1600, W - 280, 150, 75); x.fill();
  x.fillStyle = "#3d3300"; x.font = disp(52); x.fillText("Haz el tuyo gratis 👇", W / 2, 1693);
  x.fillStyle = tinta; x.font = disp(46, 700); x.fillText(location.host, W / 2, 1840);
  return new Promise((ok) => c.toBlob((b) => ok(new File([b], "mi-nota-entra.png", { type: "image/png" })), "image/png"));
}
async function compartirNota(nota){
  try { await compartir(`He sacado un ${num(nota)} en mi simulacro de ${S.subject || "examen"} con Entra ✱ Hazte uno gratis con tus apuntes:`, await imagenNota(nota)) }
  catch (e) { flash("No se ha podido crear la imagen. Vuelve a intentarlo.") }
}
function vInvitar(){
  const c = S.cuenta || {}, url = enlaceInvitacion();
  const wa = "https://wa.me/?text=" + encodeURIComponent(`Mira esto: subes tus apuntes y te hace un simulacro del examen. Con mi enlace ganamos los dos simulacros extra 👉 ${url}`);
  const el = h(`<section class="sheet">
    <span class="eyebrow">Invita a un amigo</span>
    <h2 style="font-size:26px">🎁 Ganad los dos</h2>
    <p class="muted">Cuando un amigo se registre con tu enlace y haga su <b>primer simulacro</b>, os lleváis <b>1 simulacro y 10 páginas extra</b> cada uno. Para siempre, hasta 20 amigos.</p>
    <div class="enlace"><input id="iUrl" readonly value="${esc(url)}" aria-label="Tu enlace de invitación"><button class="btn btn-primary" id="iCopiar">Copiar</button></div>
    <div class="row"><a class="btn btn-hl" id="iWa" href="${esc(wa)}" target="_blank" rel="noopener">Mandar por WhatsApp</a><button class="btn btn-ghost" id="iShare">Compartir…</button></div>
    <div class="notice" id="iCuenta">Cargando tus invitaciones…</div>
    <div id="msg"></div>
    <button class="btn btn-ghost" id="iVolver">Volver</button>
  </section>`);
  $("#iCopiar", el).onclick = async () => { try { await navigator.clipboard.writeText(url); flash("Enlace copiado ✓", "notice") } catch { $("#iUrl").select() } };
  $("#iShare", el).onclick = () => compartir("Te paso Entra: subes tus apuntes y te hace un simulacro del examen. Con mi enlace ganamos los dos simulacros extra 👉");
  $("#iVolver", el).onclick = () => go("home");
  sb.rpc("mis_invitaciones").then(({ data }) => {
    const d = Array.isArray(data) ? data[0] : data, box = $("#iCuenta"); if (!box) return;
    const ex = c.extra || {};
    box.innerHTML = `Amigos apuntados: <b>${d?.apuntados || 0}</b> · ya han hecho su simulacro: <b>${d?.premiados || 0}</b><br>Tienes de regalo: <b>+${ex.simulacros || 0} simulacros</b> y <b>+${ex.paginas || 0} páginas</b> al mes.`;
  });
  return el;
}
function vRanking(){
  S.rankTipo ||= "simulacros";
  const c = S.cuenta || {}, nombre = (c.nombre || "").split(" ")[0];
  const el = h(`<section class="sheet">
    <span class="eyebrow">Ranking de ${new Date().toLocaleDateString("es-ES", { month: "long" })}</span>
    <h2 style="font-size:26px">🏆 Los que más estudian</h2>
    <div class="tabs" role="tablist"><button role="tab" data-t="simulacros" class="${S.rankTipo === "simulacros" ? "on" : ""}">Más simulacros</button><button role="tab" data-t="notas" class="${S.rankTipo === "notas" ? "on" : ""}">Mejores notas</button></div>
    <p class="small muted">${S.rankTipo === "notas" ? "Nota media del mes. Cuenta a partir de 3 simulacros." : "Simulacros hechos este mes."} Se reinicia el día 1.</p>
    <div id="rLista" class="ranking"><p class="muted small">Cargando…</p></div>
    <div class="unirse">${c.enRanking
      ? `<p class="small muted">Sales como <b>${esc(c.alias || "")}</b>.</p><button class="btn btn-ghost btn-sm" id="rSalir">No quiero salir en el ranking</button>`
      : `<b>¿Quieres salir en el ranking?</b><p class="small muted">Solo se ve tu apodo, nunca tu nombre ni tu email.</p>
         <div class="enlace"><input id="rAlias" maxlength="20" placeholder="Tu apodo" value="${esc(c.alias || nombre)}" aria-label="Apodo"><button class="btn btn-primary" id="rUnirme">Apuntarme</button></div>`}</div>
    <div id="msg"></div>
    <button class="btn btn-ghost" id="rVolver">Volver</button>
  </section>`);
  el.querySelectorAll("[data-t]").forEach(b => b.onclick = () => { S.rankTipo = b.dataset.t; render() });
  $("#rVolver", el).onclick = () => go("home");
  const guardar = async (cambios) => {
    const { error } = await sb.from("perfiles").update(cambios).eq("id", S.session.user.id);
    if (error) return flash(error.code === "23505" ? "Ese apodo ya lo usa otra persona. Prueba con otro." : error.message.includes("alias") ? "El apodo tiene que tener entre 2 y 20 letras." : "No se ha podido guardar. Vuelve a intentarlo.");
    await refreshCuenta(); render();
  };
  const un = $("#rUnirme", el); if (un) un.onclick = () => {
    const alias = $("#rAlias").value.replace(/\s+/g, " ").trim();
    if (alias.length < 2) return flash("Pon un apodo de al menos 2 letras.");
    guardar({ alias, en_ranking: true });
  };
  const sa = $("#rSalir", el); if (sa) sa.onclick = () => guardar({ en_ranking: false });
  sb.rpc("ranking", { p_tipo: S.rankTipo }).then(({ data, error }) => {
    const box = $("#rLista"); if (!box) return;
    const filas = error ? [] : data || [];
    if (!filas.length) { box.innerHTML = `<p class="muted small">Aún no hay nadie este mes. ¡Haz un simulacro y sé el primero!</p>`; return }
    const medalla = (p) => ["🥇", "🥈", "🥉"][p - 1] || p;
    box.innerHTML = filas.map(f => `<div class="rfila ${f.yo ? "yo" : ""}"><span class="puesto">${medalla(f.puesto)}</span><span class="alias">${esc(f.alias)}${f.yo ? " (tú)" : ""}</span>
      <span class="dato">${S.rankTipo === "notas" ? `<b>${num(+f.media)}</b> de media` : `<b>${f.simulacros}</b> simulacro${f.simulacros === 1 ? "" : "s"}`}</span></div>`).join("");
  });
  return el;
}

/* ============ arranque ============ */
async function afterLogin(){
  if (S.recuperando) return go("clave");
  const quien = S.session?.user?.id; if (!quien) return;
  const sigue = () => S.session?.user?.id === quien; // si cierra sesión mientras cargamos, no seguimos
  $("#delAcc").hidden = false; $("#chatBtn").hidden = !$("#chat").hidden;
  if (!S.cuenta) await refreshCuenta();
  if (S.cuenta && !S.cuenta.terminos) {
    // Si marcó la casilla al pedir el código con este mismo email, no volvemos a preguntar
    let ac = null; try { ac = JSON.parse(localStorage.getItem("entra.acepto")) } catch {}
    if (ac?.email && ac.email === S.session.user.email?.toLowerCase()) {
      const { error } = await sb.from("perfiles").update({ acepto_terminos_at: ac.at }).eq("id", S.session.user.id);
      if (!error) await refreshCuenta();
    }
    if (!sigue()) return;
    if (!S.cuenta?.terminos) return go("terms");
  }
  const q = new URLSearchParams(location.search);
  const invitado = await aplicarInvitacion();
  await Promise.all([loadHistorial(), loadPrep().catch(() => {}), loadComunidad().catch(() => {})]);
  if (!sigue()) return;
  go("home");
  if (q.get("pago") === "ok") { flash("¡Ya eres Pro! Puede tardar unos segundos en aparecer.", "notice"); esperarPro() }
  if (q.get("pro") === "1" && S.cuenta?.plan !== "pro") pagar("suscribir");
  if (invitado) flash("Te ha invitado un amigo 🎁 Cuando hagas tu primer simulacro, ganáis los dos 1 simulacro y 10 páginas extra.", "notice");
  irA(q.get("ir"));
  if (q.has("pago") || q.has("pro") || q.has("ir") || q.has("r")) history.replaceState(null, "", "/app");
}
// El webhook de Stripe puede llegar unos segundos después de volver del pago
async function esperarPro(){
  for (let i = 0; i < 10 && S.cuenta?.plan !== "pro"; i++) { await new Promise(r => setTimeout(r, 2000)); await refreshCuenta() }
}
// ============ círculo de perfil ============
function drawPerfil(){
  const caja = $("#perfil"), c = S.cuenta, u = S.session?.user;
  if (!u) { caja.hidden = true; $("#perfilMenu").hidden = true; return }
  caja.hidden = false;
  const foto = c?.avatar || u.user_metadata?.avatar_url || u.user_metadata?.picture;
  const nombre = c?.nombre || u.user_metadata?.full_name || "";
  const av = $("#avatar");
  av.innerHTML = foto ? `<img src="${esc(foto)}" alt="" referrerpolicy="no-referrer">` : esc((nombre || u.email || "?").trim()[0].toUpperCase());
  const img = av.querySelector("img"); if (img) img.onerror = () => { av.textContent = (nombre || u.email || "?").trim()[0].toUpperCase() };
  const pro = c?.plan === "pro";
  $("#perfilMenu").innerHTML = `<div class="quien">${nombre ? `<b>${esc(nombre)}</b>` : ""}<span class="small muted">${esc(u.email || "")}</span></div>
    <div><span class="pill ${pro ? "pro" : ""}">${esc(etiquetaPlan(c))}</span></div>
    ${c ? (c.suscrito ? `<button class="btn btn-ghost btn-sm" id="pmPortal">Gestionar suscripción</button>` : `<button class="btn btn-hl btn-sm" id="pmPro">${pro ? "Hazte Pro mensual" : "Pasarme a Pro"}</button>`) : ""}
    <button class="btn btn-ghost btn-sm" id="pmInvitar">🎁 Invita a un amigo</button>
    <button class="btn btn-ghost btn-sm" id="pmRanking">🏆 Ranking</button>
    <button class="btn btn-ghost btn-sm" id="logout">Cerrar sesión</button>`;
  const cerrar = () => { $("#perfilMenu").hidden = true; av.setAttribute("aria-expanded", "false") };
  const pp = $("#pmPro"); if (pp) pp.onclick = () => { cerrar(); pagar("suscribir") };
  const pt = $("#pmPortal"); if (pt) pt.onclick = () => { cerrar(); pagar("portal") };
  $("#pmInvitar").onclick = () => { cerrar(); go("invitar") };
  $("#pmRanking").onclick = () => { cerrar(); go("ranking") };
  $("#logout").onclick = () => { cerrar(); sb.auth.signOut() };
}
$("#avatar").onclick = (e) => {
  e.stopPropagation();
  const m = $("#perfilMenu"); m.hidden = !m.hidden; $("#avatar").setAttribute("aria-expanded", String(!m.hidden));
};
document.addEventListener("click", (e) => { if (!$("#perfil").contains(e.target)) { $("#perfilMenu").hidden = true; $("#avatar").setAttribute("aria-expanded", "false") } });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") $("#perfilMenu").hidden = true });

// ============ tutor (chat con Make) ============
S.chat = [];
function pintarChat(){
  const box = $("#chatMsgs");
  box.innerHTML = "";
  box.append(h(`<div class="m tutor">¡Hola! Soy tu tutor. Pregúntame dudas de tus apuntes o cómo usar Entra.</div>`));
  for (const m of S.chat) box.append(h(`<div class="m ${m.de}">${esc(m.texto)}</div>`));
  box.scrollTop = box.scrollHeight;
  const c = S.cuenta; $("#chatUso").textContent = c?.limite?.mensajes ? `${c.uso.mensajes || 0}/${c.limite.mensajes} este mes` : "";
}
function contextoChat(){
  const temas = (S.topics || []).filter((t) => t.entra !== false);
  if (!temas.length) return "";
  return (`Asignatura: ${S.subject || ""}\n` + temas.map((t) => `TEMA: ${t.titulo}\n${t.contenido}`).join("\n\n")).slice(0, 4000);
}
$("#chatBtn").onclick = () => { $("#chat").hidden = false; $("#chatBtn").hidden = true; pintarChat(); $("#chatInput").focus() };
$("#chatCerrar").onclick = () => { $("#chat").hidden = true; $("#chatBtn").hidden = !S.session };
$("#chatForm").onsubmit = async (e) => {
  e.preventDefault();
  const inp = $("#chatInput"), mensaje = inp.value.trim();
  if (!mensaje || S.chatOcupado) return;
  const historial = S.chat.filter((m) => m.de !== "aviso").slice(-8);
  S.chat.push({ de: "alumno", texto: mensaje }); inp.value = ""; S.chatOcupado = true; pintarChat();
  $("#chatMsgs").append(h(`<div class="m tutor" id="escribiendo">Escribiendo…</div>`)); $("#chatMsgs").scrollTop = 1e9;
  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${S.session?.access_token}` },
      body: JSON.stringify({ mensaje, historial, contexto: contextoChat() }),
    });
    const r = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(r.mensaje || "El tutor no está disponible ahora mismo.");
    S.chat.push({ de: "tutor", texto: r.respuesta });
    if (S.cuenta?.uso) S.cuenta.uso.mensajes = (S.cuenta.uso.mensajes || 0) + 1;
  } catch (err) {
    S.chat.push({ de: "aviso", texto: err.message });
  }
  S.chatOcupado = false; pintarChat();
};
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
  if (!session) { S.cuenta = null; S.chat = []; drawAccount(); $("#delAcc").hidden = true; $("#chatBtn").hidden = true; $("#chat").hidden = true; go("login") }
});
sb.auth.getSession().then(({ data }) => { if (!data.session) go("login") });
})();
