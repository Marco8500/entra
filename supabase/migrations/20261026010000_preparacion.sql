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
