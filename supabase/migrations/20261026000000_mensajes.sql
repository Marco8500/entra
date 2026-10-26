-- Mensajes al tutor (chat) por mes
alter table public.uso add column if not exists mensajes int not null default 0;
create or replace function public.sumar_mensaje(p_user uuid, p_mes text)
returns void language sql security definer set search_path = public as $$
  insert into public.uso (user_id, mes, mensajes) values (p_user, p_mes, 1)
  on conflict (user_id, mes) do update set mensajes = public.uso.mensajes + 1;
$$;
revoke execute on function public.sumar_mensaje(uuid, text) from public, anon, authenticated;
