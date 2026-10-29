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

-- ============ Invitaciones y ranking (migración 20261027000000_comunidad) ============
-- Invitaciones (código por usuario, recompensa al hacer el primer simulacro) y ranking mensual

alter table public.perfiles add column if not exists codigo text unique;
alter table public.perfiles add column if not exists invitado_por uuid references auth.users(id) on delete set null;
alter table public.perfiles add column if not exists invitacion_premiada boolean not null default false;
alter table public.perfiles add column if not exists extra_simulacros int not null default 0;
alter table public.perfiles add column if not exists extra_paginas int not null default 0;
alter table public.perfiles add column if not exists alias text check (alias is null or char_length(alias) between 2 and 20);
alter table public.perfiles add column if not exists en_ranking boolean not null default false;

-- Código de invitación corto (sin letras que se confunden)
create or replace function public.nuevo_codigo() returns text
language plpgsql set search_path = public as $$
declare c text;
begin
  loop
    c := (select string_agg(substr('abcdefghjkmnpqrstuvwxyz23456789', 1 + floor(random() * 31)::int, 1), '') from generate_series(1, 6));
    exit when not exists (select 1 from public.perfiles where codigo = c);
  end loop;
  return c;
end $$;
revoke execute on function public.nuevo_codigo() from public, anon, authenticated;

update public.perfiles set codigo = public.nuevo_codigo() where codigo is null;

create or replace function public.crear_perfil() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.perfiles (id, codigo) values (new.id, public.nuevo_codigo()) on conflict do nothing;
  return new;
end $$;
revoke execute on function public.crear_perfil() from public, anon, authenticated;

-- Apodos únicos (sin distinguir mayúsculas) para que nadie se haga pasar por otro
create unique index if not exists perfiles_alias_unico on public.perfiles (lower(alias)) where alias is not null;

-- El usuario puede elegir su apodo y si sale en el ranking
grant update (alias, en_ranking) on public.perfiles to authenticated;

-- Notas válidas (el navegador guarda el resultado)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'simulacros_nota_rango') then
    alter table public.simulacros add constraint simulacros_nota_rango check (nota is null or (nota >= 0 and nota <= 10)) not valid;
  end if;
end $$;

/** Apunta quién te invitó. Solo cuentas nuevas (menos de 7 días), una vez, y no a ti mismo. */
create or replace function public.usar_invitacion(p_codigo text) returns text
language plpgsql security definer set search_path = public as $$
declare yo uuid := auth.uid(); quien uuid; creado timestamptz;
begin
  if yo is null then return 'no_auth'; end if;
  select id into quien from public.perfiles where codigo = lower(trim(p_codigo));
  if quien is null then return 'no_existe'; end if;
  if quien = yo then return 'propio'; end if;
  select created_at into creado from auth.users where id = yo;
  if creado < now() - interval '7 days' then return 'antigua'; end if;
  update public.perfiles set invitado_por = quien where id = yo and invitado_por is null;
  return 'ok';
end $$;
revoke execute on function public.usar_invitacion(text) from public, anon;
grant execute on function public.usar_invitacion(text) to authenticated;

/** Premia a los dos cuando el invitado hace su primer simulacro (lo llama el servidor). Máx. 20 premios por persona. */
create or replace function public.premiar_invitacion(p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
declare quien uuid;
begin
  update public.perfiles set invitacion_premiada = true,
    extra_simulacros = extra_simulacros + 1, extra_paginas = extra_paginas + 10
  where id = p_user and invitado_por is not null and not invitacion_premiada
  returning invitado_por into quien;
  if quien is not null then
    update public.perfiles set extra_simulacros = extra_simulacros + 1, extra_paginas = extra_paginas + 10
    where id = quien and (select count(*) from public.perfiles where invitado_por = quien and invitacion_premiada) <= 20;
  end if;
end $$;
revoke execute on function public.premiar_invitacion(uuid) from public, anon, authenticated;

/** Mis invitaciones: cuántos amigos se han apuntado y cuántos ya han hecho su simulacro */
create or replace function public.mis_invitaciones() returns table (apuntados int, premiados int)
language sql security definer set search_path = public as $$
  select count(*)::int, count(*) filter (where invitacion_premiada)::int from public.perfiles where invitado_por = auth.uid();
$$;
revoke execute on function public.mis_invitaciones() from public, anon;
grant execute on function public.mis_invitaciones() to authenticated;

/**
 * Ranking del mes. Solo quien se ha apuntado (en_ranking) y con apodo.
 * "simulacros": los que cuenta el servidor; "notas": media de los simulacros del mes (mínimo 3).
 * Devuelve el top 20 y, aparte, mi fila (yo = true) aunque no esté en el top.
 */
create or replace function public.ranking(p_tipo text) returns table (puesto int, alias text, simulacros int, media numeric, mejor numeric, yo boolean)
language sql security definer set search_path = public as $$
  with mes as (select to_char(now() at time zone 'utc', 'YYYY-MM') m),
  notas as (
    select s.user_id, count(*)::int n, round(avg(s.nota), 1) media, max(s.nota) mejor
    from public.simulacros s, mes
    where to_char(s.creado_at at time zone 'utc', 'YYYY-MM') = mes.m and s.nota is not null
    group by s.user_id
  ),
  base as (
    select p.id, p.alias, coalesce(u.simulacros, 0) simulacros, n.media, n.mejor, coalesce(n.n, 0) hechos
    from public.perfiles p
    cross join mes
    left join public.uso u on u.user_id = p.id and u.mes = mes.m
    left join notas n on n.user_id = p.id
    where p.en_ranking and p.alias is not null
  ),
  orden as (
    select b.*, (row_number() over (order by
      case when p_tipo = 'notas' then b.media end desc nulls last,
      b.simulacros desc, b.mejor desc nulls last, b.alias))::int puesto
    from base b
    where case when p_tipo = 'notas' then b.hechos >= 3 else b.simulacros > 0 end
  )
  select puesto, alias, simulacros, media, mejor, id = auth.uid() from orden
  where puesto <= 20 or id = auth.uid()
  order by puesto;
$$;
revoke execute on function public.ranking(text) from public, anon;
grant execute on function public.ranking(text) to authenticated;

-- ============ Racha y top de la portada (migración 20261027010000_racha) ============
-- Racha de estudio (días seguidos con algún simulacro, hora de España) y top público para la portada

/** Racha de un usuario: la actual (cuenta si hizo simulacro hoy o ayer), la mejor y si ya ha estudiado hoy */
create or replace function public.racha_de(p_user uuid) returns table (actual int, mejor int, hoy boolean)
language sql stable security definer set search_path = public as $$
  with d as (select distinct (creado_at at time zone 'Europe/Madrid')::date dia from public.simulacros where user_id = p_user),
  g as (select dia, dia - (row_number() over (order by dia))::int grp from d),
  r as (select max(dia) fin, count(*)::int n from g group by grp),
  h as (select (now() at time zone 'Europe/Madrid')::date dia)
  select coalesce((select r.n from r, h where r.fin >= h.dia - 1 order by r.fin desc limit 1), 0),
         coalesce((select max(n) from r), 0),
         exists (select 1 from d, h where d.dia = h.dia);
$$;
revoke execute on function public.racha_de(uuid) from public, anon, authenticated;

create or replace function public.mi_racha() returns table (actual int, mejor int, hoy boolean)
language sql stable security definer set search_path = public as $$
  select * from public.racha_de(auth.uid());
$$;
revoke execute on function public.mi_racha() from public, anon;
grant execute on function public.mi_racha() to authenticated;

/** Top 5 del mes para la portada (solo apodos de quien se ha apuntado al ranking). Lo llama el servidor. */
create or replace function public.ranking_publico() returns table (puesto int, alias text, simulacros int, racha int)
language sql stable security definer set search_path = public as $$
  with mes as (select to_char(now() at time zone 'utc', 'YYYY-MM') m)
  select (row_number() over (order by u.simulacros desc, p.alias))::int, p.alias, u.simulacros, (select actual from public.racha_de(p.id))
  from public.perfiles p join public.uso u on u.user_id = p.id, mes
  where u.mes = mes.m and u.simulacros > 0 and p.en_ranking and p.alias is not null
  order by u.simulacros desc, p.alias
  limit 5;
$$;
revoke execute on function public.ranking_publico() from public, anon, authenticated;

-- ============ Pase de examen (migración 20261027020000_pase) ============
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

-- ============ Fallos de la IA (migración 20261029000000_ia_errores) ============
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

-- ============ Medidas de la IA (migración 20261029010000_ia_medidas) ============
-- ia_errores también guarda las respuestas buenas (ok = true) con lo que tardaron, para medir la velocidad real
alter table public.ia_errores add column if not exists ok boolean not null default false;
alter table public.ia_errores add column if not exists ms int;
