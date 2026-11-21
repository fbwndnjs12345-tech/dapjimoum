DO $$
DECLARE
  definition text;
BEGIN
  SELECT pg_get_functiondef('private.invoke_answer_health_edge()'::regprocedure)
  INTO definition;
  definition := replace(definition, '''30 19 * * *''', '''0 * * * *''');
  EXECUTE definition;
END
$$;

SELECT cron.alter_job(job_id := (
  SELECT jobid FROM cron.job WHERE jobname = 'dapjimoum-answer-link-health-check' LIMIT 1
), schedule := '* * * * *', active := true);
