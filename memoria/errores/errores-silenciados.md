---
tipo: error
fecha: 2026-10-29
commit: 1624487
---
# errores silenciados

Guardados "dispara y olvida": `guardarSimulacro`, `guardarApuntes`, `sumar_uso`, `premiar_invitacion`, `sumar_mensaje` no miraban el error. Un simulacro podía no contar para racha ni ranking sin que nadie lo supiera.
**Solución**: comprobar siempre `error` de Supabase, reintentar una vez y avisar al alumno o al log.
**Regla**: toda llamada a Supabase mira su `error`.

Relacionado: [[doble-entrega-examen]] · [[webhook-perdia-pagos]]
