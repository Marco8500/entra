-- Pase de examen: 7 días de Pro con un pago único (sin suscripción)

alter table public.perfiles add column if not exists pro_hasta timestamptz;

-- Pagos de pase ya aplicados (Stripe puede repetir el webhook: así no se suma dos veces)
create table if not exists public.pases (
  session_id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  dias int not null,
  creado_at timestamptz not null default now()
);
alter table public.pases enable row level security;

/** Suma días de Pro a partir de hoy o de cuando acabe el pase actual. Devuelve la nueva fecha (o null si ya se aplicó). */
create or replace function public.activar_pase(p_user uuid, p_session text, p_dias int default 7) returns timestamptz
language plpgsql security definer set search_path = public as $$
declare hasta timestamptz;
begin
  insert into public.pases (session_id, user_id, dias) values (p_session, p_user, p_dias) on conflict do nothing;
  if not found then return null; end if;
  update public.perfiles set pro_hasta = greatest(coalesce(pro_hasta, now()), now()) + make_interval(days => p_dias)
  where id = p_user returning pro_hasta into hasta;
  return hasta;
end $$;
revoke execute on function public.activar_pase(uuid, text, int) from public, anon, authenticated;
