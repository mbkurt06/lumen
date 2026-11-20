alter table public.page_reads
  add column if not exists context_key text not null default 'global';

drop index if exists public.page_reads_owner_id_doc_key_page_key;
drop constraint if exists page_reads_owner_id_doc_key_page_key on public.page_reads;

alter table public.page_reads
  add constraint page_reads_owner_doc_page_context_key
  unique (owner_id, doc_key, page, context_key);

create index if not exists page_reads_owner_doc_context_idx
  on public.page_reads(owner_id, doc_key, context_key, page);
