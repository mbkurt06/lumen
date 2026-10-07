create table if not exists public.calendar_event_state (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null,
  calendar_id text not null,
  event_id text not null,
  occurrence_date date not null,
  is_completed boolean not null default false,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, account_id, calendar_id, event_id, occurrence_date)
);

create index if not exists idx_calendar_event_state_owner_date
  on public.calendar_event_state(owner_id, occurrence_date);

drop trigger if exists calendar_event_state_set_updated_at on public.calendar_event_state;
create trigger calendar_event_state_set_updated_at
before update on public.calendar_event_state
for each row execute function public.set_updated_at();

alter table public.calendar_event_state enable row level security;

drop policy if exists "calendar_event_state_owner_all" on public.calendar_event_state;
create policy "calendar_event_state_owner_all"
on public.calendar_event_state
for all to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

grant select, insert, update, delete on public.calendar_event_state to authenticated;
