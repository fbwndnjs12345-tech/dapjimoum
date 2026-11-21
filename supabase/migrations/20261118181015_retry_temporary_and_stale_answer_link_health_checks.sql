DO $$
DECLARE
  definition text;
  old_query text := 'WHERE health_checked_at IS NULL;';
  new_query text := 'WHERE health_checked_at IS NULL OR health_checked_at < now() - interval ''7 days'' OR (health_status IN (''temporary_error'', ''rate_limited'') AND health_checked_at < now() - interval ''1 hour'');';
BEGIN
  SELECT pg_get_functiondef('private.invoke_answer_health_edge()'::regprocedure)
  INTO definition;
  IF position(old_query in definition) = 0 THEN
    RAISE EXCEPTION 'Expected answer health pending-count query was not found';
  END IF;
  definition := replace(definition, old_query, new_query);
  EXECUTE definition;
END
$$;
