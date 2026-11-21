-- Görev türü: zorunlu (süresi geçen dönem tamamlanana kadar kalır) ya da takip
alter table public.todos add column if not exists strict boolean not null default false;

-- Okundu işaretleri gün gün tutulur (geçmiş ve zorunlu görevlerde gecikmişi kapatmak için)
alter table public.page_reads drop constraint if exists page_reads_owner_doc_page_context_key;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'page_reads_owner_doc_page_context_day_key' and conrelid = 'public.page_reads'::regclass) then
    alter table public.page_reads add constraint page_reads_owner_doc_page_context_day_key unique (owner_id, doc_key, page, context_key, day);
  end if;
end $$;
