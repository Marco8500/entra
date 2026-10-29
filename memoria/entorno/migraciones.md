---
tipo: entorno
fecha: 2026-10-29
---
# migraciones

- Cada cambio de base de datos va en `supabase/migrations/AAAAMMDDhhmmss_nombre.sql` **y** en `supabase/schema.sql`.
- En local: `supabase db reset`.
- En producción se aplican con el conector de Supabase. Preferir cambios aditivos (`alter policy`, columnas nuevas), sin DROP.
- Las funciones que solo usa el servidor (`sumar_*`, `activar_pase`, `premiar_invitacion`) sin permiso para `anon` ni `authenticated`.

Relacionado: [[rls-auth-uid-lento]]
