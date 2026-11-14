alter table public.answer_links
  add column if not exists health_status text not null default 'unknown',
  add column if not exists health_checked_at timestamptz,
  add column if not exists health_http_status integer,
  add column if not exists health_content_type text,
  add column if not exists health_error text,
  add column if not exists health_file_size_bytes bigint;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'answer_links_health_status_check') then
    alter table public.answer_links add constraint answer_links_health_status_check
      check (health_status in ('unknown','healthy','broken','redirected','invalid_pdf','rate_limited','temporary_error'));
  end if;
end $$;

create index if not exists answer_links_health_due_idx
  on public.answer_links(health_checked_at asc nulls first);
