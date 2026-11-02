---
tipo: decision
fecha: 2026-10-26
commit: dd53816
---
# registro sin emails

Registro con email + contraseña y **"Confirm email" desactivado** en Supabase: la cuenta se crea al momento sin mandar correo.

- Se quitó el login por código / enlace mágico porque el correo por defecto de Supabase tiene límite bajo y no deja editar la plantilla.
- Solo se manda email en "He olvidado mi contraseña" → hace falta SMTP propio antes de abrir al público.

Relacionado: [[supabase-email-por-defecto]] · [[sin-modo-invitado]] · [[boton-google-clasico]]
