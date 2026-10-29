# Auditoría técnica de Entra — 29 de octubre de 2026

Informe de la auditoría y reparación. Todo lo que aparece como "verificado" se ha comprobado con una prueba que se indica; lo que no se ha podido comprobar se dice expresamente. Este informe no contiene secretos.

**Tipos de prueba usados en este informe**

- **[local]**: contra el entorno local (Supabase en Docker, Worker en `wrangler dev`) con datos de prueba.
- **[mock]**: la IA y Stripe están simulados (`dev/mocks.mjs`); se prueba nuestro código, no el servicio externo.
- **[prod]**: consulta o cambio real en la base de datos de producción (Supabase, mediante su conector oficial).
- **No hay pruebas reales contra Groq, Gemini, Workers AI, Stripe real ni Make en esta auditoría** (ver D).

---

## A. Estado inicial

### Arquitectura detectada

```
Navegador (public/: index.html, app.html, assets/app.js de una sola pieza, sin framework)
   │  supabase-js 2.45.4 (CDN) → Supabase Auth + tablas con RLS (apuntes, simulacros, examenes…)
   │  fetch /api/* (JSON o texto en streaming)
   ▼
Cloudflare Worker "entra" (worker.js) → entraia.workers.dev
   ├─ /api/* → netlify/functions/*.mjs (formato Request→Response, heredado de Netlify)
   │     ├─ netlify/lib/entra.mjs: autenticación, límites, cadena de IAs (streamIA), Stripe
   │     ├─ IA: Groq → Groq visión → Gemini → Workers AI (Mistral y Anthropic solo si tienen clave)
   │     ├─ Stripe (Checkout integrado, webhook firmado)  ·  Make (tutor del chat)
   │     └─ Supabase con service_role (uso, perfiles, pases, ia_errores, RPC)
   └─ resto → archivos estáticos (env.ASSETS)
Despliegue: Workers Builds conectado a GitHub (cada push a main despliega).
```

### Tecnologías

- **Backend**: JavaScript (ESM) en Cloudflare Workers con `nodejs_compat`. Dependencias: `@supabase/supabase-js` 2.45.4 y `stripe` 16.12.0.
- **Base de datos**: Supabase (Postgres 17) en eu-central-1. Usa RLS y funciones SECURITY DEFINER.
- **Frontend**: HTML, CSS y JS sin compilación. pdf.js 3.11.174 y jsPDF 2.5.1 se cargan desde cdnjs.
- **Sin pruebas automatizadas, lint ni tipos** antes de la auditoría. Solo había flujos Playwright sueltos, fuera del repositorio.

### Problemas principales encontrados

Causas raíz confirmadas leyendo el código y, cuando se pudo, reproduciendo el fallo. Prioridades: **P0** pérdida de datos, fallo crítico de seguridad o caída; **P1** algo principal roto o incorrecto; **P2** rendimiento o fallo secundario; **P3** mejora no crítica.

**P0**
- No se encontró ningún P0 confirmado. Lo más cercano es el riesgo de pagos perdidos del webhook (#1), que no llegó a ocurrir.

**P1**

1. El webhook de Stripe ignoraba los errores de la base de datos y respondía siempre 200. Un fallo puntual de Supabase dejaba a alguien que había pagado sin Pro, y Stripe no reintentaba.
2. Errores silenciados:
   - El guardado del simulacro era "dispara y olvida": si fallaba no contaba para la racha ni el ranking, y nadie se enteraba.
   - `guardarApuntes` no comprobaba errores, así que los apuntes podían no guardarse en la cuenta sin avisar.
   - `sumar_uso`, `premiar_invitacion` y `sumar_mensaje` también ignoraban sus errores.
3. El texto pegado de más de 60.000 caracteres se cortaba en silencio en el servidor (`texto(…, 60000)`):
   - Se perdía el final de los apuntes.
   - Además, los lotes de texto se hacían por número de páginas (8), no por tamaño, así que algunos lotes eran enormes para el cupo gratuito por minuto de la IA.
4. `api()` en el navegador convertía cualquier 5xx en "La IA está saturada", también en rutas sin IA (pago, borrar cuenta, chat). Se perdía el mensaje real.
5. `api()` no tenía tiempo máximo: una conexión colgada dejaba la pantalla de "cargando" para siempre.
6. Entregar el examen podía ejecutarse dos veces, por el reloj y el botón a la vez: doble corrección y doble guardado.
7. Textos legales:
   - La política de privacidad nombraba proveedores que ya no se usan (Netlify, Anthropic) y omitía los reales (Cloudflare, Groq, Google Gemini, Make).
   - Decía "No usamos tus apuntes para entrenar modelos" sin aclarar que el nivel gratuito de Gemini puede usar el contenido para mejorar sus servicios.
   - Faltaban la fecha y el email de contacto, y no se mencionaba el pase de examen.

**P2**

8. `/api/corregir` y `/api/repaso` no tenían límite de uso: se podía abusar de la IA gratuita sin tope.
9. `autenticar()` (usado en cada petición de IA) y `/api/cuenta` hacían 3 viajes seguidos a la base de datos. Perfil y uso podían ir en paralelo.
10. El registro de cada llamada a la IA en `ia_errores` se esperaba con `await`. Cada fallo de un proveedor retrasaba el paso al siguiente un viaje a la base de datos, y cada respuesta buena retrasaba el cierre.
11. Inicio de la app:
    - Descargaba el texto completo de los últimos 8 apuntes solo para mostrar título y número de temas.
    - **Medido [prod]**: 33.521 bytes para los 4 apuntes que hay.
12. jsPDF (115.150 bytes comprimido, medido del paquete npm) se descargaba de forma síncrona en cada visita a la app, aunque solo se usa al pedir el PDF de repaso.
13. Un PDF con muchas páginas escaneadas se convertía entero a imágenes antes de comprobar el límite de 15. Era trabajo inútil en móviles lentos.
14. Siete políticas RLS usaban `auth.uid()` sin `(select …)`: Postgres lo recalcula por cada fila. Aviso `auth_rls_initplan` del asesor de Supabase.
15. Faltaban índices en tres claves foráneas: `pases.user_id`, `perfiles.invitado_por` y `simulacros.apuntes_id`.
16. Las esperas al reintentar en el navegador eran largas (20, 40 y 60 s), aunque el servidor ya prueba varias IAs antes de rendirse.

**P3**

17. Las URLs de las miniaturas de fotos (`URL.createObjectURL`) no se liberaban.
18. El campo del chat no tenía etiqueta accesible.
19. **Seguridad**: pdf.js 3.11.174 es vulnerable a GHSA-wgrm-67xf-hhpq (CVE-2024-4367): un PDF malicioso puede ejecutar JavaScript en la página. Ver F.
20. **Pruebas**: la prueba del pase fallaba de forma intermitente. Causa confirmada: el Stripe simulado repetía los ids de sesión tras reiniciarse, y `activar_pase` (idempotente) los daba por ya cobrados. Es un fallo del simulador, no de la app: Stripe real no repite ids.

### Problemas que no se han podido confirmar

- **Lentitud real en producción**: no se ha podido medir. Desde este entorno no hay acceso a `entraia.workers.dev`, a la API de Cloudflare, a Groq ni a Stripe (bloqueo de red del contenedor).
  - La tabla `ia_errores` de producción tenía 0 filas al empezar, así que tampoco hay datos reales de tiempos de las IAs todavía.
- **Calidad real de lectura y corrección de cada IA**: depende de los modelos externos; aquí solo se prueba con respuestas simuladas.

---

## B. Problemas corregidos

| # | Qué fallaba | Archivos | Solución | Prueba que lo demuestra |
|---|---|---|---|---|
| 1 | Webhook respondía 200 aunque la BD fallase | `netlify/functions/stripe-webhook.mjs` | Se comprueba el `error` de cada operación. Si falla: registro y **500**, y Stripe reintenta. Los avisos repetidos ya eran inofensivos (`activar_pase` es idempotente). | `tests/unit/entra.test.mjs` "webhook: si la base de datos falla responde 500" **[mock]**. Falla con el código anterior (comprobado) y pasa con el nuevo. `flujo-webhook-doble.cjs` **[local]**: 5 avisos iguales a la vez dan 1 pase de 7,00 días. |
| 2a | Simulacro guardado sin comprobar | `public/assets/app.js` (`guardarSimulacro`) | Comprueba el error, reintenta una vez y avisa al alumno si no se puede. | `flujo-auditoria.cjs` **[local]** (se guarda exactamente 1 fila); `flujo-racha.cjs` y `flujo-comunidad.cjs` |
| 2b | Apuntes guardados sin comprobar | `app.js` (`guardarApuntes`, `guardarLuego`) | Los errores se lanzan. Si falla al leer, se sigue con los temas en pantalla y se avisa. Si falla el autoguardado, también se avisa. | Flujos de lectura **[local]** (camino correcto). El aviso de error no tiene prueba automática. |
| 2c | `sumar_uso`, `premiar_invitacion`, `sumar_mensaje` sin comprobar | `netlify/lib/entra.mjs`, `examen.mjs`, `chat.mjs` | Se registra el error en el log del Worker. | Revisión de código; los flujos `comunidad` y `perfil-chat` siguen pasando **[local]**. |
| 3 | Texto pegado cortado a 60.000 caracteres; lotes por páginas | `app.js` (`lotesDeTexto`, `MAX_CHARS_LOTE = 12000`) | El texto pegado y el de los PDF se reparten en lotes de hasta 12.000 caracteres sin partir líneas. Las páginas se siguen contando igual para el límite. | `flujo-auditoria.cjs` **[local+mock]**: 80.102 caracteres en 8 lotes (máximo 11.989), y llega hasta el último tema. `flujo-pdf.cjs` sigue contando 3 páginas. |
| 4, 5 | 5xx siempre "IA saturada"; sin tiempo máximo | `app.js` (`api`, `apiIA`) | Un 5xx con mensaje del servidor se muestra tal cual. Si no hay mensaje, se trata como saturación y se reintenta. Si en 90 s no llega ningún byte (el servidor manda un espacio cada 8 s), se corta y se reintenta. Sin conexión aparece "Sin conexión con Entra". | `flujo-fallo-lote.cjs` **[local+mock]**: un 500 se reintenta y los apuntes se leen. El caso de los 90 s no tiene prueba automática. |
| 6 | Doble entrega del examen | `app.js` (`submit`, `WeakSet entregados`) | Cada examen se entrega una sola vez. | `flujo-auditoria.cjs` (1 fila) **[local]**. La entrega simultánea real (reloj + clic) no se ha forzado en la prueba. |
| 7 | Textos legales desfasados | `public/privacidad.html`, `public/terminos.html` | Proveedores reales, aviso honesto sobre las IAs gratuitas, fecha, contacto `infoentraia@gmail.com`, pase de examen y límite de correcciones. | Revisión manual. **Siguen pendientes**: nombre o razón social, NIF y dirección (ver G). |
| 8 | Corregir y repaso sin límite | `entra.mjs` (`LIMITES.correcciones`: gratis 40, Pro 800; `sumarCorreccion`), `corregir.mjs`, `repaso.mjs`, migración `20261029020000_auditoria.sql` | Nuevo contador `uso.correcciones` y RPC `sumar_correccion`, solo para el servidor. Si se agota, el navegador corrige "por ideas" y el alumno sigue viendo su nota. | `flujo-auditoria.cjs` **[local]**: con el cupo gastado, 402 `limite_correcciones`. |
| 9 | Consultas en serie | `entra.mjs` (`autenticar`), `cuenta.mjs` | Perfil y uso con `Promise.all`. Ahora también se comprueban sus errores. | Medición en C **[local]**; las pruebas unitarias y todos los flujos pasan. |
| 10 | Registros que retrasan | `entra.mjs` (`enSegundoPlano`, `AsyncLocalStorage`), `worker.js` | Los registros de `ia_errores` van con `ctx.waitUntil`: no retrasan la respuesta ni el cambio de IA, y Cloudflare no los corta. | Unitaria "streamIA … apunta el fallo" **[mock]**: los registros se siguen guardando. |
| 11 | Inicio descargaba los temas completos | `app.js` (`loadHistorial`, `abrirApuntes`), RPC `mis_apuntes` (SECURITY INVOKER, respeta RLS) | El inicio pide solo título, fecha y número de temas; el contenido se carga al abrir. | `flujo-auditoria.cjs` **[local]**: el inicio no pide `temas` y al abrir aparecen los 53 temas guardados. Tamaño medido en C. |
| 12 | jsPDF en cada visita | `public/app.html`, `app.js` (`cargarJsPdf`) | Se descarga al pulsar "Descargar PDF de repaso". | `flujo-auditoria.cjs` **[local]**: 0 descargas al abrir la app y 1 al pedir el PDF, que se genera. |
| 13 | Límite de imágenes tardío | `app.js` (`leerPdf`) | Se para en cuanto se pasaría de 15 imágenes. | `flujo-limite-fotos.cjs` y `flujo-pdf.cjs` **[local]** |
| 14, 15 | RLS lenta e índices que faltaban | migración `20261029020000_auditoria.sql` (con `alter policy`, sin DROP) | `(select auth.uid())` en las 7 políticas, más 3 índices. | **[prod]** aplicada. Asesor de rendimiento después: 0 avisos `auth_rls_initplan` (antes 7). Solo quedan 3 avisos INFO de "índice aún sin usar", lógicos porque son nuevos. La prueba de aislamiento entre usuarios de `flujo-prep.cjs` sigue pasando **[local]**. |
| 16 | Reintentos largos | `app.js` (`apiIA`) | Esperas de 8, 15 y 30 s cuando la IA está saturada, y 3 s y un solo reintento para errores de IA, JSON, servidor o red. | `flujo-fallo-lote.cjs` muestra "Reintento en 8 s" **[local]** |
| 17 | URLs de miniaturas sin liberar | `app.js` (`drawThumbs`) | `URL.revokeObjectURL` al redibujar. | Revisión de código |
| 18 | Chat sin etiqueta | `public/app.html` | `aria-label`. | Script de comprobación a 360 y 1280 px: 0 campos sin etiqueta y sin desbordamiento horizontal en `/`, `/app`, `/terminos.html` y `/privacidad.html` |
| 19 | pdf.js vulnerable | `app.js` (`getDocument({ …, isEvalSupported: false })`) | Mitigación oficial del aviso para la rama 3.x. | `flujo-pdf.cjs` y `flujo-indice.cjs` siguen leyendo PDF **[local]**. No se ha probado con un PDF malicioso real. |
| 20 | Prueba del pase intermitente | `dev/mocks.mjs` | Ids del simulador únicos entre reinicios. | 14/14 flujos justo después de reiniciar el simulador |

**Repaso final del diff**: se revisó línea a línea y no se ha quitado ninguna funcionalidad. Dos efectos secundarios encontrados y corregidos:

- El script `test:unit` no funcionaba en Node 22 porque `node --test` no acepta una carpeta.
- Añadir pdf.js como devDependency habría hecho que el build de Cloudflare intentase compilar `canvas`, un módulo nativo opcional. Se descartó: las dependencias de prueba se instalan con `npm run test:deps` (`--no-save`).

---

## C. Rendimiento

| Medida | Antes | Después | Cómo |
|---|---|---|---|
| `GET /api/cuenta` (mediana / p90, N=20) | 32 / 58 ms | 19 / 21 ms (2.ª tanda: 19 / 23) | `npm run perf` **[local]** |
| `POST /api/leer` con IA simulada | 43 / 50 ms | 29 / 32 ms (2.ª: 34 / 39) | ídem **[local+mock]** |
| `POST /api/corregir` con IA simulada | 35 / 40 ms | 29 / 37 ms (2.ª: 31 / 36) | ídem **[local+mock]** |
| `GET /api/ranking` | 16 / 19 ms | 13 / 17 ms | ídem **[local]** (no se tocó; sirve de referencia del ruido) |
| Datos de "Tus apuntes" en el inicio, todos los apuntes de producción (4) | 33.521 bytes | 602 bytes | SQL que reproduce las dos consultas **[prod]** |
| Ídem, el usuario local con más texto | 76.490 bytes | 146 bytes | **[local]** |
| JavaScript al abrir la app | +115.150 bytes gzip de jsPDF | 0 (solo bajo demanda) | tamaño medido del paquete; petición contada en el flujo |
| Bundle del Worker | — | 541,87 KiB (106,83 KiB gzip) | `wrangler deploy --dry-run` |

**Cómo leer estas cifras**

- En local la base de datos está a menos de 1 ms, así que ahorrar un viaje vale poco.
- En producción el Worker y Supabase (Frankfurt) están más lejos: cada viaje ahorrado en `autenticar` debería valer más. **No se ha podido medir en producción** (ver D).
- La parte más lenta con diferencia es la IA externa, de segundos. Las mejoras sobre ella son:
  - El cambio de proveedor ya no espera al registro.
  - Lotes de texto más pequeños, que caben en el cupo por minuto de Groq.
  - Reintentos más cortos.
- Ninguna de estas tres mejoras se ha medido contra las IAs reales.

**Pendiente de rendimiento**

- Medir en producción con datos reales de `ia_errores`, que ya registra los ms de cada respuesta buena.
- La consulta `ranking` filtra con `to_char(creado_at)` y no aprovecharía un índice. Con los datos actuales (6 simulacros) no importa; habría que revisarla con miles.
- Varias peticiones `/api/examen` en paralelo hacen cada una su `autenticar` (getUser y 2 consultas). Es aceptable, pero se podría cachear por token unos segundos.

---

## D. Conectores e infraestructura

| Integración | Revisado | Pruebas | Estado y pendiente |
|---|---|---|---|
| **Supabase** (auth, tablas, RPC, RLS) | Esquema, políticas, funciones, asesores | **[prod]**: migración aplicada y verificada (columna, 2 funciones, 7 políticas); asesores. **[local]**: todos los flujos. | OK. Falta activar en el panel "leaked password protection" (ver F). |
| **Stripe** (Checkout integrado, webhook, portal) | Firma (`constructEventAsync`), idempotencia del pase, modos test/live según la clave, errores | **[mock]** y **[local]**: suscripción, pase, portal, firma falsa (400), BD caída (500), 5 avisos simultáneos (1 pase) | **No probado contra Stripe real** (red bloqueada aquí). Recomendado: una compra real de 1,99 € y, en el panel de Stripe → Webhooks, comprobar que el endpoint responde 200. |
| **IAs** (Groq, Gemini, Workers AI) | Cadena con salto al siguiente proveedor, enfriamiento, validación de JSON, registro, keepalive cada 8 s, tiempo máximo de 25 s por proveedor | **[mock]**: unitarias (503 → siguiente; respuesta cortada → siguiente; todas fallan → `[[ERROR]]`) y flujos | **No probadas contra los servicios reales** desde aquí. Cupos gratuitos: si todos se agotan, el alumno ve "Hoy se ha agotado la IA gratuita". |
| **Make** (tutor del chat) | Tiempo máximo 40 s, escenario apagado ("Accepted"), límite de mensajes | **[mock]**: `flujo-perfil-chat.cjs` | No probado contra Make real en esta auditoría. |
| **Cloudflare Workers** (despliegue, assets, `[ai]`, observabilidad) | `wrangler.toml`, `worker.js`, `_headers`, build | `wrangler deploy --dry-run` OK | **Sin acceso** a la API de Cloudflare ni a `entraia.workers.dev` desde este entorno: no se han visto logs, métricas ni el estado del despliegue. El plan gratuito limita la CPU a 10 ms por petición; el streaming espera a la red y no gasta CPU, pero conviene vigilar "Exceeded CPU" en los logs. |
| **CDN** (supabase-js en jsdelivr, pdf.js y jsPDF en cdnjs) | Versiones fijadas | En las pruebas se sirven desde node_modules | Sin SRI (`integrity`). Recomendado añadirlo o servirlos desde `public/`. |

**Necesita acceso o intervención manual**

- Comprobar en el panel de Cloudflare (Workers → entra → Logs) que no hay errores tras el despliegue.
- Comprobar el webhook en el panel de Stripe en modo live.

---

## E. Resultados de las pruebas

| Comando | Resultado | Tipo |
|---|---|---|
| `npm run test:unit` (`node --test tests/unit/*.test.mjs`) | **10/10 superadas** | unitarias con fetch simulado |
| `npm run test:e2e` (`node tests/e2e/correr.mjs`) | **14/14 flujos superados**: auditoria, clave, comunidad, corregir, fallo-lote, indice, limite-fotos, pago, pase, pdf, perfil-chat, prep, racha, webhook-doble | Playwright **[local+mock]** |
| `npm run perf` | Ejecutado 1 vez antes y 2 después (cifras en C) | **[local+mock]** |
| `node --check public/assets/app.js` | OK | sintaxis |
| `npx wrangler deploy --dry-run` | OK, el bundle se genera | build |
| Script responsive y accesibilidad (360 y 1280 px) | OK tras añadir el `aria-label` | **[local]** |
| Asesores de Supabase (rendimiento y seguridad) | Ver B #14 y F | **[prod]**, solo lectura |
| `npm audit` | 8 avisos (detalle en F) | dependencias |

**Fallos durante la auditoría** (todos resueltos):

- `flujo-limite-fotos`: la prueba asumía que las fotos no se acumulaban; se corrigió la prueba.
- `flujo-comunidad`: chocaba con apodos repetidos de ejecuciones anteriores; la prueba ahora los libera.
- `flujo-pase`: ver B #20.
- Tras un reinicio del contenedor hubo que volver a levantar Docker, Supabase, el simulador y wrangler.

**No ejecutadas o bloqueadas**

- Pruebas contra los servicios reales (IAs, Stripe, Make, Cloudflare): red bloqueada.
- Pruebas de carga: no tiene sentido hacerlas contra las IAs gratuitas reales, y en local solo medirían el simulador.
- Lint y tipos: el proyecto no los tiene. No se ha añadido ESLint ni TypeScript para no meter dependencias sin necesidad.

---

## F. Seguridad

**Revisado y correcto**

- Autenticación: cada endpoint con IA o datos exige el token y lo verifica con `auth.getUser`.
- Términos: se exige haberlos aceptado.
- Límites por plan comprobados en el servidor.
- RLS: activa en todas las tablas.
  - `ia_errores` y `pases` no tienen políticas a propósito: solo el servidor las usa (aviso INFO del asesor, esperado).
  - Aislamiento entre usuarios probado en `flujo-prep.cjs`: otro usuario ve 0 exámenes ajenos.
- RPC SECURITY DEFINER:
  - Las que puede llamar un usuario (`ranking`, `mi_racha`, `mis_invitaciones`, `usar_invitacion`) solo usan `auth.uid()` y no exponen datos de otros. El aviso WARN del asesor es intencionado.
  - Las del servidor (`sumar_*`, `activar_pase`, `premiar_invitacion`) tienen el permiso retirado a `anon` y `authenticated`.
- Webhook: firma verificada; pase idempotente, también con avisos simultáneos (probado).
- XSS: todo lo que viene del usuario o de la IA pasa por `esc()` antes de entrar en `innerHTML` (revisado en `app.js`).
- Las respuestas del alumno van delimitadas en el prompt y con la instrucción de ignorar órdenes dentro de ellas.
- Cabeceras de seguridad en `public/_headers`. Sin CORS abierto: la API es del mismo origen.
- Logs: los registros de la IA guardan proveedor, modelo, código y mensaje del proveedor, no los apuntes del alumno.
  - El webhook registra el tipo e id del evento, no datos de tarjeta.
  - Los errores de uso registran el id de usuario (un UUID), no el email.

**Corregido**

- pdf.js (CVE-2024-4367) mitigado con `isEvalSupported: false` (B #19).
- Abuso de IA sin límite en corregir y repaso (B #8).

**Secretos**

- **Repositorio**: búsqueda en los archivos y en todo el historial de git de claves de Stripe, Groq, Gemini, secretos de webhook, claves privadas y JWT con rol `service_role`. Solo aparecen:
  - la clave `anon` de producción (pública por diseño);
  - las claves de demostración del Supabase local (públicas por diseño).
- `.dev.vars` y `.env` están en `.gitignore`.
- `wrangler.toml` solo tiene valores públicos (ids de precio y claves publicables).
- **En conversaciones anteriores se pegaron claves en el chat.** No están en el repositorio, pero conviene **rotarlas**:
  - Groq
  - Gemini
  - Stripe test (sk)
  - Supabase service_role
  - token de la API de Cloudflare
  - secretos de webhook de Stripe

  Después de rotarlas, actualízalas en Cloudflare → Workers → entra → Settings → Variables and Secrets.

**Pendiente o recomendado**

1. Supabase → Authentication → Password security: activar **Leaked password protection**. Es un ajuste del panel que no se ha cambiado aquí.
2. Dependencias (`npm audit`):
   - `@supabase/auth-js` (GHSA-8r88-6cj9-9fh5): afecta a rutas de la API de administración construidas con datos del usuario. Aquí solo se usa `deleteUser(user.id)` con el id del token ya verificado, así que **no es explotable en este código**. Aun así, conviene actualizar supabase-js dentro de la versión 2 y repetir las pruebas.
   - `jspdf` 2.5.1 a través de `dompurify`: solo afecta al método `html()`, que no se usa (solo `text()`). Conviene subir a jsPDF 4 cuando se pueda probar el PDF.
   - `pdfjs-dist`, `canvas` y `tar`: solo afectan al entorno de pruebas (`--no-save`), no a producción.
3. Añadir SRI (`integrity`) a los scripts de CDN, o servirlos desde `public/`.
4. Pasar a pdf.js 4.x (ESM) para dejar de depender de la mitigación.
5. **Limitación de peticiones por IP**: no existe. Los límites son por cuenta y por mes, y crear cuentas es gratis. Se recomienda una regla de rate limiting de Cloudflare sobre `/api/*`, en el panel.
6. **Notas del ranking**: las calcula el navegador, así que un usuario técnico podría falsearlas. Ya están limitadas a 0–10 por una restricción en la base de datos. Solución completa: corregir y guardar en el servidor.

---

## G. Estado final

**Funciona y está verificado** (local, con la IA y Stripe simulados):

- Registro, inicio de sesión y recuperación de contraseña.
- Lectura de fotos, PDF con texto, PDF escaneado y texto pegado largo.
- Selección de temas, simulacro, corrección (también cuando la IA falla), repaso y PDF.
- Racha, ranking, invitaciones, preparación de examen, chat con límite.
- Suscripción, pase de examen (también con avisos repetidos), portal y límites por plan.
- Migración aplicada en producción y asesores de Supabase revisados.

**No se ha podido verificar**

- Comportamiento y tiempos reales en `entraia.workers.dev`.
- Respuestas reales de Groq, Gemini, Workers AI y Make.
- Pago real con Stripe live.
- Logs de Cloudflare.

**Riesgos abiertos**

- Calidad de las IAs gratuitas y sus cupos diarios: si se agotan, la app avisa, pero no hay alternativa de pago configurada.
- Datos legales incompletos: nombre o razón social, NIF y dirección en `terminos.html` y `privacidad.html`. Son obligatorios para vender (LSSI), y los textos deberían revisarse con un profesional.
- Recomendaciones de seguridad de F pendientes.

**Siguientes pasos recomendados**

1. Desplegar (push a main) y, en los 15 minutos siguientes, hacer un simulacro completo en la web real. Revisar Cloudflare → Logs y la tabla `ia_errores`, por ejemplo con `select proveedor, modelo, ok, count(*), avg(ms) from ia_errores group by 1,2,3`.
2. Rellenar los datos legales, rotar las claves y activar "leaked password protection".
3. Una compra real del pase (1,99 €) para validar Stripe live de extremo a extremo.
4. Regla de rate limiting en Cloudflare para `/api/*`.
5. Actualizar supabase-js, jsPDF y pdf.js y repetir `npm run test:e2e`.

**Comandos para reproducir**: ver `tests/README.md`.
