---
tipo: error
fecha: 2026-10-25
commit: e306098
---
# supabase email por defecto

El correo por defecto de Supabase tiene un límite muy bajo, solo llega al equipo del proyecto y no deja editar la plantilla (no puede llevar un código).
**Solución**: no depender del email para registrarse. Antes de abrir al público: SMTP propio (Resend, Brevo o Gmail con contraseña de aplicación).

Relacionado: [[registro-sin-emails]]
