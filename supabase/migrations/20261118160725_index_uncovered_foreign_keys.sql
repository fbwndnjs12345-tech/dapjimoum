-- Recovered FK indexes from the deployed schema. IF NOT EXISTS keeps this safe
-- when the same index was already created by an earlier baseline migration.
CREATE INDEX IF NOT EXISTS admin_user_roles_assigned_by_idx
  ON public.admin_user_roles (assigned_by);
CREATE INDEX IF NOT EXISTS admin_user_roles_role_key_idx
  ON public.admin_user_roles (role_key);
CREATE INDEX IF NOT EXISTS answer_link_candidates_reviewed_by_idx
  ON public.answer_link_candidates (reviewed_by);
CREATE INDEX IF NOT EXISTS answer_link_candidates_run_id_idx
  ON public.answer_link_candidates (run_id);
CREATE INDEX IF NOT EXISTS answer_link_click_events_answer_link_id_idx
  ON public.answer_link_click_events (answer_link_id);
CREATE INDEX IF NOT EXISTS answer_link_search_attempts_run_idx
  ON public.answer_link_search_attempts (run_id, started_at DESC);
CREATE INDEX IF NOT EXISTS answer_link_search_queue_book_id_idx
  ON public.answer_link_search_queue (book_id);
CREATE INDEX IF NOT EXISTS answer_link_search_queue_requested_by_idx
  ON public.answer_link_search_queue (requested_by);
CREATE INDEX IF NOT EXISTS answer_link_search_queue_run_id_idx
  ON public.answer_link_search_queue (run_id);
CREATE INDEX IF NOT EXISTS answer_link_search_runs_created_by_idx
  ON public.answer_link_search_runs (created_by);
CREATE INDEX IF NOT EXISTS answer_link_search_settings_updated_by_idx
  ON public.answer_link_search_settings (updated_by);
CREATE INDEX IF NOT EXISTS site_pages_updated_by_idx
  ON public.site_pages (updated_by);
