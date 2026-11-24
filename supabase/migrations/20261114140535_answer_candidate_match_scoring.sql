alter table public.answer_link_candidates
  add column if not exists match_score integer not null default 0,
  add column if not exists match_evidence jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'answer_link_candidates_match_score_check') then
    alter table public.answer_link_candidates add constraint answer_link_candidates_match_score_check
      check (match_score between 0 and 100);
  end if;
end $$;

create index if not exists answer_link_candidates_match_score_idx
  on public.answer_link_candidates(match_score desc, created_at desc);
