-- Multi-query searches may take longer than a single short request.
-- Keep the batch lease long enough for bounded sequential provider calls.
CREATE OR REPLACE FUNCTION public.claim_answer_link_search_batch(
  p_run_id uuid,
  p_lock_token uuid,
  p_batch_size integer DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_run public.answer_link_search_runs%ROWTYPE;
  batch_ids uuid[];
BEGIN
  SELECT * INTO current_run
  FROM public.answer_link_search_runs
  WHERE id = p_run_id
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND OR current_run.status <> 'running' THEN
    RETURN NULL;
  END IF;
  IF current_run.locked_until IS NOT NULL AND current_run.locked_until > now() THEN
    RETURN NULL;
  END IF;

  batch_ids := current_run.book_ids[
    current_run.next_index + 1:
    LEAST(current_run.next_index + GREATEST(1, LEAST(p_batch_size, 10)), cardinality(current_run.book_ids))
  ];
  UPDATE public.answer_link_search_runs
  SET lock_token = p_lock_token, locked_until = now() + interval '30 minutes'
  WHERE id = p_run_id;

  RETURN jsonb_build_object('start_index', current_run.next_index, 'book_ids', coalesce(to_jsonb(batch_ids), '[]'::jsonb));
END;
$$;

REVOKE ALL ON FUNCTION public.claim_answer_link_search_batch(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_answer_link_search_batch(uuid, uuid, integer) TO service_role;
