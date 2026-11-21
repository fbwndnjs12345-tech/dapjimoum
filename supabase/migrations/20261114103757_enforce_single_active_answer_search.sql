create unique index if not exists answer_link_search_runs_single_active
on public.answer_link_search_runs ((status))
where status = 'running';