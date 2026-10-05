create table if not exists public.dua_v2_state (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.dua_v2_state enable row level security;

drop policy if exists "dua_v2_state_select_own" on public.dua_v2_state;
create policy "dua_v2_state_select_own"
on public.dua_v2_state
for select
to authenticated
using (auth.uid() = owner_id);

drop policy if exists "dua_v2_state_insert_own" on public.dua_v2_state;
create policy "dua_v2_state_insert_own"
on public.dua_v2_state
for insert
to authenticated
with check (auth.uid() = owner_id);

drop policy if exists "dua_v2_state_update_own" on public.dua_v2_state;
create policy "dua_v2_state_update_own"
on public.dua_v2_state
for update
to authenticated
using (auth.uid() = owner_id)
with check (auth.uid() = owner_id);

drop policy if exists "dua_v2_state_delete_own" on public.dua_v2_state;
create policy "dua_v2_state_delete_own"
on public.dua_v2_state
for delete
to authenticated
using (auth.uid() = owner_id);
