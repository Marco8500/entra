---
tipo: error
fecha: 2026-10-27
commit: 43eb89a
---
# cliente stripe de otro modo

Al pasar de test a live, el `customer` de Stripe guardado en el perfil era del otro modo y el pago fallaba.
**Solución**: si el cliente guardado no existe en el modo actual, se crea uno nuevo.

Relacionado: [[stripe-modo-por-clave]]
