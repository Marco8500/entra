-- Auditoría técnica: límite de correcciones, lista ligera de apuntes, índices y políticas RLS más rápidas.
-- Sin DROP ni borrado de datos: solo añade columnas, funciones e índices y ajusta las políticas existentes.

-- 1. Correcciones y repasos con la IA: tienen su propio cupo mensual (antes no tenían límite)
alter table public.uso add column if not exists correcciones int not null default 0;

create or replace function public.sumar_correccion(p_user uuid, p_mes text)
returns void language sql security definer set search_path = public as $$
  insert into public.uso (user_id, mes, correcciones) values (p_user, p_mes, 1)
  on conflict (user_id, mes) do update set correcciones = public.uso.correcciones + 1;
$$;
revoke execute on function public.sumar_correccion(uuid, text) from public, anon, authenticated;

-- 2. Lista de mis apuntes sin el texto de los temas (la pantalla de inicio solo necesita el título y cuántos temas entran)
create or replace function public.mis_apuntes(p_limite int default 8)
returns table (id uuid, asignatura text, actualizado_at timestamptz, temas_entran int)
language sql stable security invoker set search_path = public as $$
  select a.id, a.asignatura, a.actualizado_at,
    (select count(*)::int from jsonb_array_elements(case when jsonb_typeof(a.temas) = 'array' then a.temas else '[]'::jsonb end) t
     where coalesce(t->>'entra', '') <> 'false')
  from public.apuntes a
  where a.user_id = (select auth.uid())
  order by a.actualizado_at desc
  limit least(greatest(p_limite, 1), 50);
$$;
revoke execute on function public.mis_apuntes(int) from public, anon;
grant execute on function public.mis_apuntes(int) to authenticated;

-- 3. Índices para las claves foráneas que no tenían (aviso del asesor de rendimiento de Supabase)
create index if not exists pases_user_idx on public.pases (user_id);
create index if not exists perfiles_invitado_por_idx on public.perfiles (invitado_por) where invitado_por is not null;
create index if not exists simulacros_apuntes_idx on public.simulacros (apuntes_id) where apuntes_id is not null;

-- 4. RLS: (select auth.uid()) se calcula una vez por consulta, no una vez por fila (aviso auth_rls_initplan)
alter policy "perfil propio lectura" on public.perfiles using ((select auth.uid()) = id);
alter policy "perfil propio terminos" on public.perfiles using ((select auth.uid()) = id);
alter policy "uso propio lectura" on public.uso using ((select auth.uid()) = user_id);
alter policy "apuntes propios" on public.apuntes using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "simulacros propios" on public.simulacros using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "examenes propios" on public.examenes using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
alter policy "estilo propio" on public.estilo_estudio using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
