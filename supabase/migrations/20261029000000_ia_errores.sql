-- Registro de fallos de la IA (proveedor, modelo, código y mensaje) para poder diagnosticar sin acceso a los logs del servidor
create table if not exists public.ia_errores (
  id bigint generated always as identity primary key,
  creado_at timestamptz not null default now(),
  ruta text,
  proveedor text,
  modelo text,
  status int,
  detalle text
);
alter table public.ia_errores enable row level security;
create index if not exists ia_errores_fecha_idx on public.ia_errores (creado_at desc);
