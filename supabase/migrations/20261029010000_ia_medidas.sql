-- ia_errores también guarda las respuestas buenas (ok = true) con lo que tardaron, para medir la velocidad real
alter table public.ia_errores add column if not exists ok boolean not null default false;
alter table public.ia_errores add column if not exists ms int;
