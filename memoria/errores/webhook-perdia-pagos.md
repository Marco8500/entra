---
tipo: error
fecha: 2026-10-29
commit: 1624487
---
# webhook perdia pagos

El webhook de Stripe respondía 200 aunque fallase la base de datos: alguien podía pagar y quedarse sin Pro, y Stripe no reintentaba.
**Solución**: comprobar el `error` de cada operación y responder **500** para que Stripe reintente. Es seguro porque `activar_pase` es idempotente (5 avisos iguales → 1 pase).
**Regla**: en un webhook, 200 solo cuando todo se ha guardado.

Relacionado: [[pase-de-examen]] · [[simulador-ids-repetidos]]
