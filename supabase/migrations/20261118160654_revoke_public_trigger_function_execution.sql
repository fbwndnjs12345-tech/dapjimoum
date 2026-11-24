-- Recovered from the deployed function ACLs. SECURITY DEFINER trigger functions
-- are callable by the database owner only; trigger invocation itself is unaffected.
REVOKE ALL ON FUNCTION public.assign_default_admin_role() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.capture_admin_audit_event() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_answer_search_for_book() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enqueue_answer_search_for_submission() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_answer_search_queue_items() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.set_answer_search_run_terminal_reason() FROM PUBLIC, anon, authenticated;
