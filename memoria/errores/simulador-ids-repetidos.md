---
tipo: error
fecha: 2026-10-29
commit: 1624487
---
# simulador ids repetidos

La prueba del pase fallaba a veces: el Stripe simulado repetía ids de sesión tras reiniciarse y `activar_pase` los daba por cobrados.
Era un fallo del simulador (`dev/mocks.mjs`), no de la app. Ahora los ids son únicos entre reinicios.

Relacionado: [[webhook-perdia-pagos]] · [[pruebas]]
