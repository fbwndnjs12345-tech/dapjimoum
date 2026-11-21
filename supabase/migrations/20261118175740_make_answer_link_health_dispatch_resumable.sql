CREATE TABLE IF NOT EXISTS private.answer_link_health_dispatch_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  request_id bigint,
  last_dispatched_at timestamptz,
  failure_count integer NOT NULL DEFAULT 0
);
INSERT INTO private.answer_link_health_dispatch_state(singleton)
VALUES (true) ON CONFLICT (singleton) DO NOTHING;

CREATE OR REPLACE FUNCTION private.invoke_answer_health_edge()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_project_url text;
  v_service_role_key text;
  v_request_id bigint;
  v_previous_request_id bigint;
  v_status_code integer;
  v_error_msg text;
  v_timed_out boolean;
  v_failure_count integer;
  v_remaining bigint;
  v_job_id bigint;
BEGIN
  SELECT jobid INTO v_job_id FROM cron.job
  WHERE jobname = 'dapjimoum-answer-link-health-check' LIMIT 1;

  SELECT request_id, failure_count INTO v_previous_request_id, v_failure_count
  FROM private.answer_link_health_dispatch_state WHERE singleton = true FOR UPDATE;

  IF v_previous_request_id IS NOT NULL THEN
    SELECT status_code, error_msg, timed_out INTO v_status_code, v_error_msg, v_timed_out
    FROM net._http_response WHERE id = v_previous_request_id;
    IF NOT FOUND THEN RETURN NULL; END IF;
    IF v_timed_out OR v_error_msg IS NOT NULL OR v_status_code IS NULL OR v_status_code < 200 OR v_status_code >= 300 THEN
      v_failure_count := v_failure_count + 1;
    ELSE
      v_failure_count := 0;
    END IF;
    UPDATE private.answer_link_health_dispatch_state SET request_id = NULL, failure_count = v_failure_count WHERE singleton = true;
    IF v_failure_count >= 3 THEN
      IF v_job_id IS NOT NULL THEN PERFORM cron.alter_job(job_id := v_job_id, schedule := '30 19 * * *', active := true); END IF;
      UPDATE public.answer_link_search_settings
      SET scheduler_configured = true,
          scheduler_last_error = '답지 링크 검사 Edge Function이 3회 연속 실패했습니다. HTTP=' || coalesce(v_status_code::text, 'null') || ', error=' || coalesce(v_error_msg, 'none'),
          scheduler_last_tick_at = now()
      WHERE singleton = true;
      RETURN NULL;
    END IF;
  END IF;

  SELECT count(*) INTO v_remaining FROM public.answer_links WHERE health_checked_at IS NULL;
  IF v_remaining = 0 THEN
    IF v_job_id IS NOT NULL THEN PERFORM cron.alter_job(job_id := v_job_id, schedule := '30 19 * * *', active := true); END IF;
    UPDATE private.answer_link_health_dispatch_state SET request_id = NULL, failure_count = 0 WHERE singleton = true;
    UPDATE public.answer_link_search_settings SET scheduler_configured = true, scheduler_last_error = NULL, scheduler_last_tick_at = now() WHERE singleton = true;
    RETURN NULL;
  END IF;

  SELECT decrypted_secret INTO v_project_url FROM vault.decrypted_secrets WHERE name = 'dapjimoum_project_url' LIMIT 1;
  SELECT decrypted_secret INTO v_service_role_key FROM vault.decrypted_secrets WHERE name = 'dapjimoum_service_role_key' LIMIT 1;
  IF coalesce(v_project_url, '') = '' OR coalesce(v_service_role_key, '') = '' THEN
    IF v_job_id IS NOT NULL THEN PERFORM cron.alter_job(job_id := v_job_id, schedule := '30 19 * * *', active := true); END IF;
    UPDATE public.answer_link_search_settings
    SET scheduler_configured = false,
        scheduler_last_error = 'Supabase Vault secrets are missing: dapjimoum_project_url / dapjimoum_service_role_key',
        scheduler_last_tick_at = now()
    WHERE singleton = true;
    RETURN NULL;
  END IF;

  SELECT net.http_post(
    url := rtrim(v_project_url, '/') || '/functions/v1/answer-link-health-check',
    headers := jsonb_build_object('Content-Type', 'application/json', 'apikey', v_service_role_key, 'Authorization', 'Bearer ' || v_service_role_key),
    body := jsonb_build_object('limit', 10),
    timeout_milliseconds := 120000
  ) INTO v_request_id;

  UPDATE private.answer_link_health_dispatch_state
  SET request_id = v_request_id, last_dispatched_at = now(), failure_count = v_failure_count
  WHERE singleton = true;
  UPDATE public.answer_link_search_settings SET scheduler_configured = true, scheduler_last_error = NULL, scheduler_last_tick_at = now() WHERE singleton = true;
  RETURN v_request_id;
END;
$function$;

SELECT cron.alter_job(job_id := (
  SELECT jobid FROM cron.job WHERE jobname = 'dapjimoum-answer-link-health-check' LIMIT 1
), schedule := '* * * * *', active := true);
