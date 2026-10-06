create table if not exists public.dua_v2_todos (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  source_type text not null default 'dua',
  listening_type text,
  video_id text,
  preset_id text,
  dua_id text,
  segment_index integer,
  title text not null default '',
  scope_label text,
  description text,
  target integer not null default 1 check (target >= 1),
  schedule jsonb not null default '{}'::jsonb,
  history jsonb not null default '{}'::jsonb,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (owner_id, id)
);

create table if not exists public.dua_v2_counter_events (
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_id text not null,
  event_at timestamptz not null default now(),
  action text not null,
  counter_type text not null,
  dua_id text,
  dua_title text,
  segment_index integer,
  content_label text,
  todo_id text,
  todo_title text,
  delta integer not null default 0,
  value integer not null default 0,
  target integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  primary key (owner_id, event_id)
);
create index if not exists dua_v2_counter_events_owner_time_idx
  on public.dua_v2_counter_events(owner_id, event_at desc);
create index if not exists dua_v2_counter_events_content_idx
  on public.dua_v2_counter_events(owner_id, dua_id, segment_index, event_at desc);

create table if not exists public.dua_v2_listening_videos (
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_id text not null,
  title text,
  url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (owner_id, video_id)
);

create table if not exists public.dua_v2_listening_sections (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null,
  video_id text not null,
  section_number integer,
  start_seconds numeric not null default 0,
  end_seconds numeric not null default 0,
  repeats integer not null default 1 check (repeats >= 1),
  playback_rate numeric not null default 1,
  pause_seconds numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (owner_id, id)
);
create index if not exists dua_v2_listening_sections_video_idx
  on public.dua_v2_listening_sections(owner_id, video_id, section_number);

create table if not exists public.dua_v2_listening_links (
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_id text not null,
  dua_id text,
  linked_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (owner_id, video_id)
);

create table if not exists public.dua_v2_listening_history (
  owner_id uuid not null references auth.users(id) on delete cascade,
  video_id text not null,
  title text,
  last_played_at timestamptz not null default now(),
  payload jsonb not null default '{}'::jsonb,
  primary key (owner_id, video_id)
);

alter table public.dua_v2_todos enable row level security;
alter table public.dua_v2_counter_events enable row level security;
alter table public.dua_v2_listening_videos enable row level security;
alter table public.dua_v2_listening_sections enable row level security;
alter table public.dua_v2_listening_links enable row level security;
alter table public.dua_v2_listening_history enable row level security;

do $$
declare
  tbl text;
begin
  foreach tbl in array array[
    'dua_v2_todos',
    'dua_v2_counter_events',
    'dua_v2_listening_videos',
    'dua_v2_listening_sections',
    'dua_v2_listening_links',
    'dua_v2_listening_history'
  ]
  loop
    execute format('drop policy if exists %I on public.%I', tbl || '_own_all', tbl);
    execute format(
      'create policy %I on public.%I for all to authenticated using (auth.uid() = owner_id) with check (auth.uid() = owner_id)',
      tbl || '_own_all', tbl
    );
  end loop;
end $$;
