---
tipo: error
fecha: 2026-10-29
commit: 1624487
---
# rls auth uid lento

Siete políticas RLS usaban `auth.uid()` sin `(select ...)` y Postgres lo recalculaba por fila (aviso `auth_rls_initplan`).
**Solución**: `(select auth.uid())` con `alter policy` (sin DROP) e índices en las claves foráneas que faltaban.
**Regla**: en políticas nuevas, escribir siempre `(select auth.uid())`.

Relacionado: [[migraciones]]
