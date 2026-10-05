create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.library_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  parent_id uuid references public.library_items(id) on delete cascade,
  kind text not null check (kind in ('collection','folder','document')),
  title text not null,
  subtitle text,
  sort_order integer not null default 0,
  is_favorite boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_nodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.library_items(id) on delete cascade,
  parent_id uuid references public.content_nodes(id) on delete cascade,
  kind text not null check (kind in ('volume','part','chapter','section','page','heading','paragraph','sentence','phrase','verse','note','custom')),
  sort_order integer not null default 0,
  title text,
  text_content text,
  secondary_text text,
  translation text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_sources (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid references public.library_items(id) on delete cascade,
  provider text not null,
  external_id text,
  source_url text,
  title text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_segments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  media_source_id uuid not null references public.media_sources(id) on delete cascade,
  content_node_id uuid references public.content_nodes(id) on delete set null,
  label text,
  start_seconds numeric(12,3) not null check (start_seconds >= 0),
  end_seconds numeric(12,3) not null check (end_seconds > start_seconds),
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.reading_state (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  document_id uuid not null references public.library_items(id) on delete cascade,
  last_content_node_id uuid references public.content_nodes(id) on delete set null,
  scroll_anchor text,
  font_scale numeric(5,2) not null default 1.0,
  last_opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, document_id)
);

create table if not exists public.memorization_state (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  content_node_id uuid not null references public.content_nodes(id) on delete cascade,
  repeat_count integer not null default 0 check (repeat_count >= 0),
  repeat_target integer not null default 10 check (repeat_target > 0),
  playback_rate numeric(4,2) not null default 1.0 check (playback_rate > 0),
  is_memorized boolean not null default false,
  last_practiced_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (owner_id, content_node_id)
);

create table if not exists public.todos (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  notes text,
  is_completed boolean not null default false,
  due_at timestamptz,
  sort_order integer not null default 0,
  related_library_item_id uuid references public.library_items(id) on delete set null,
  related_content_node_id uuid references public.content_nodes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_preferences (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists idx_library_items_owner_parent on public.library_items(owner_id, parent_id, sort_order);
create index if not exists idx_content_nodes_document on public.content_nodes(owner_id, document_id, parent_id, sort_order);
create index if not exists idx_media_segments_source on public.media_segments(owner_id, media_source_id, sort_order);
create index if not exists idx_todos_owner_status on public.todos(owner_id, is_completed, sort_order);

drop trigger if exists library_items_set_updated_at on public.library_items;
create trigger library_items_set_updated_at before update on public.library_items
for each row execute function public.set_updated_at();

drop trigger if exists content_nodes_set_updated_at on public.content_nodes;
create trigger content_nodes_set_updated_at before update on public.content_nodes
for each row execute function public.set_updated_at();

drop trigger if exists media_sources_set_updated_at on public.media_sources;
create trigger media_sources_set_updated_at before update on public.media_sources
for each row execute function public.set_updated_at();

drop trigger if exists media_segments_set_updated_at on public.media_segments;
create trigger media_segments_set_updated_at before update on public.media_segments
for each row execute function public.set_updated_at();

drop trigger if exists reading_state_set_updated_at on public.reading_state;
create trigger reading_state_set_updated_at before update on public.reading_state
for each row execute function public.set_updated_at();

drop trigger if exists memorization_state_set_updated_at on public.memorization_state;
create trigger memorization_state_set_updated_at before update on public.memorization_state
for each row execute function public.set_updated_at();

drop trigger if exists todos_set_updated_at on public.todos;
create trigger todos_set_updated_at before update on public.todos
for each row execute function public.set_updated_at();

drop trigger if exists user_preferences_set_updated_at on public.user_preferences;
create trigger user_preferences_set_updated_at before update on public.user_preferences
for each row execute function public.set_updated_at();

alter table public.library_items enable row level security;
alter table public.content_nodes enable row level security;
alter table public.media_sources enable row level security;
alter table public.media_segments enable row level security;
alter table public.reading_state enable row level security;
alter table public.memorization_state enable row level security;
alter table public.todos enable row level security;
alter table public.user_preferences enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'library_items','content_nodes','media_sources','media_segments',
    'reading_state','memorization_state','todos','user_preferences'
  ]
  loop
    execute format('drop policy if exists "%s_owner_all" on public.%I', t, t);
    execute format(
      'create policy "%s_owner_all" on public.%I for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid())',
      t, t
    );
  end loop;
end $$;

grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.library_items,
  public.content_nodes,
  public.media_sources,
  public.media_segments,
  public.reading_state,
  public.memorization_state,
  public.todos,
  public.user_preferences
to authenticated;
