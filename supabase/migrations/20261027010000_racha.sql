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
