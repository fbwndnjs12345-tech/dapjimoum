-- Allow the backend service role to operate the scheduled answer-search workers.
-- These grants are additive and do not change existing rows or RLS policies.
grant select, insert, update on table public.answer_link_search_queue to service_role;
grant select, insert, update on table public.answer_link_search_attempts to service_role;
grant select on table public.answer_link_search_settings to service_role;
grant update on table public.answer_links to service_role;
