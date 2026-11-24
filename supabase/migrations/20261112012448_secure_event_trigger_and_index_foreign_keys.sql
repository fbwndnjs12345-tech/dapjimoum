-- Harden the event-trigger function and cover foreign-key lookups.
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated;

CREATE INDEX IF NOT EXISTS answer_link_candidates_reviewed_by_idx
  ON public.answer_link_candidates (reviewed_by);
CREATE INDEX IF NOT EXISTS answer_link_candidates_run_id_idx
  ON public.answer_link_candidates (run_id);
CREATE INDEX IF NOT EXISTS answer_link_click_events_answer_link_id_idx
  ON public.answer_link_click_events (answer_link_id);
CREATE INDEX IF NOT EXISTS answer_link_search_runs_created_by_idx
  ON public.answer_link_search_runs (created_by);
