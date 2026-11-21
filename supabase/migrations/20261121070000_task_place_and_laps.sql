-- Görevin kendi yeri (kütüphane ayracı yerine) ve tamamlanan turlar
alter table public.todos add column if not exists place jsonb;
alter table public.todos add column if not exists laps jsonb not null default '[]'::jsonb;
