-- ============================================================
-- Entra · esquema de base de datos (pegar en Supabase → SQL Editor → Run)
-- ============================================================

-- Perfil de cada usuario: plan y datos de Stripe
create table if not exists public.perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','pro')),
  stripe_customer_id text,
  acepto_terminos_at timestamptz,
  creado_at timestamptz not null default now()
);

-- Uso mensual (lo escriben solo las funciones del servidor)
create table if not exists public.uso (
  user_id uuid not null references auth.users(id) on delete cascade,
  mes text not null,                       -- 'YYYY-MM'
  simulacros int not null default 0,
  paginas int not null default 0,
  bloques int not null default 0,          -- bloques de preguntas generados (anti-abuso)
  primary key (user_id, mes)
);

-- Temas leídos de los apuntes (sin fotos: las fotos no se guardan nunca)
create table if not exists public.apuntes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asignatura text not null default '',
  temas jsonb not null default '[]',
  creado_at timestamptz not null default now(),
  actualizado_at timestamptz not null default now()
);

-- Simulacros hechos y su resultado
create table if not exists public.simulacros (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  apuntes_id uuid references public.apuntes(id) on delete set null,
  asignatura text not null default '',
  examen jsonb not null,
  resultado jsonb,
  nota numeric(4,2),
  creado_at timestamptz not null default now()
);

create index if not exists apuntes_user_idx on public.apuntes(user_id, actualizado_at desc);
create index if not exists simulacros_user_idx on public.simulacros(user_id, creado_at desc);

-- Crear perfil automáticamente al registrarse
create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id) values (new.id) on conflict do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.crear_perfil();
-- Solo la usa el trigger: que no se pueda llamar desde la API
revoke execute on function public.crear_perfil() from public, anon, authenticated;

-- Seguridad: cada usuario solo ve lo suyo
alter table public.perfiles enable row level security;
alter table public.uso enable row level security;
alter table public.apuntes enable row level security;
alter table public.simulacros enable row level security;

drop policy if exists "perfil propio lectura" on public.perfiles;
create policy "perfil propio lectura" on public.perfiles for select using (auth.uid() = id);
drop policy if exists "perfil propio terminos" on public.perfiles;
create policy "perfil propio terminos" on public.perfiles for update using (auth.uid() = id);
-- El usuario solo puede tocar acepto_terminos_at; plan y stripe los cambia el servidor
revoke update on public.perfiles from authenticated;
grant update (acepto_terminos_at) on public.perfiles to authenticated;

drop policy if exists "uso propio lectura" on public.uso;
create policy "uso propio lectura" on public.uso for select using (auth.uid() = user_id);

drop policy if exists "apuntes propios" on public.apuntes;
create policy "apuntes propios" on public.apuntes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "simulacros propios" on public.simulacros;
create policy "simulacros propios" on public.simulacros for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Suma de uso atómica (la llaman las funciones con la service key)
create or replace function public.sumar_uso(p_user uuid, p_mes text, p_sim int, p_pag int, p_blo int default 0)
returns void language sql security definer set search_path = public as $$
  insert into public.uso (user_id, mes, simulacros, paginas, bloques) values (p_user, p_mes, p_sim, p_pag, p_blo)
  on conflict (user_id, mes) do update
    set simulacros = public.uso.simulacros + excluded.simulacros,
        paginas = public.uso.paginas + excluded.paginas,
        bloques = public.uso.bloques + excluded.bloques;
$$;
revoke execute on function public.sumar_uso(uuid, text, int, int, int) from public, anon, authenticated;

-- Mensajes al tutor (chat) por mes
alter table public.uso add column if not exists mensajes int not null default 0;
create or replace function public.sumar_mensaje(p_user uuid, p_mes text)
returns void language sql security definer set search_path = public as $$
  insert into public.uso (user_id, mes, mensajes) values (p_user, p_mes, 1)
  on conflict (user_id, mes) do update set mensajes = public.uso.mensajes + 1;
$$;
revoke execute on function public.sumar_mensaje(uuid, text) from public, anon, authenticated;
-- Prepárate para tu examen: fechas de exámenes y resultado del test de método de estudio
create table if not exists public.examenes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asignatura text not null default '',
  fecha date not null,
  creado_at timestamptz not null default now()
);
create index if not exists examenes_user_idx on public.examenes(user_id, fecha);
alter table public.examenes enable row level security;
drop policy if exists "examenes propios" on public.examenes;
create policy "examenes propios" on public.examenes for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.estilo_estudio (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  metodo text not null,
  puntos jsonb not null default '{}',
  hecho_at timestamptz not null default now()
);
alter table public.estilo_estudio enable row level security;
drop policy if exists "estilo propio" on public.estilo_estudio;
create policy "estilo propio" on public.estilo_estudio for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
