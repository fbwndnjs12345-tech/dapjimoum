-- Recovered scheduler bootstrap for the resumable answer-link health audit.
-- The dispatch function is installed by the following migration; the job is
-- scheduled at a low-frequency window until the hourly policy migration runs.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM cron.job
    WHERE jobname = 'dapjimoum-answer-link-health-check'
  ) THEN
    PERFORM cron.schedule(
      'dapjimoum-answer-link-health-check',
      '30 19 * * *',
      'SELECT private.invoke_answer_health_edge();'
    );
  END IF;
END
$$;
