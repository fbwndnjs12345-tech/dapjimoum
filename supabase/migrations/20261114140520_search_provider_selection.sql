alter table public.answer_link_search_runs
  add column if not exists provider_mode text not null default 'combined';

alter table public.answer_link_search_runs
  drop constraint if exists answer_link_search_runs_provider_mode_check;

alter table public.answer_link_search_runs
  add constraint answer_link_search_runs_provider_mode_check
  check (provider_mode in ('naver', 'kakao', 'web', 'combined'));

comment on column public.answer_link_search_runs.provider_mode is
  'Search provider selection used by this run; retained for resume and retry.';
