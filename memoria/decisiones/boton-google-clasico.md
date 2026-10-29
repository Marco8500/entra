---
tipo: decision
fecha: 2026-10-26
commit: 6e5c187
---
# boton google clasico

Se probó el botón oficial de Google (Google Identity Services + `signInWithIdToken`) y **se revirtió**.
Se mantiene el botón clásico que pasa por Supabase OAuth. Si Google no está activado en Supabase, la app avisa en vez de ir a una página de error.

Relacionado: [[registro-sin-emails]]
