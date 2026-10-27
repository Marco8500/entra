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
