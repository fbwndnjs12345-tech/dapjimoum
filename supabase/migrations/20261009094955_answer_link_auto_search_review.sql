CREATE TABLE public.answer_link_search_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'paused', 'completed', 'failed')),
  book_ids uuid[] NOT NULL DEFAULT '{}',
  next_index integer NOT NULL DEFAULT 0 CHECK (next_index >= 0),
  processed_books integer NOT NULL DEFAULT 0 CHECK (processed_books >= 0),
  candidate_count integer NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  api_requests integer NOT NULL DEFAULT 0 CHECK (api_requests >= 0),
  error_count integer NOT NULL DEFAULT 0 CHECK (error_count >= 0),
  failed_book_ids uuid[] NOT NULL DEFAULT '{}',
  last_error text,
  lock_token uuid,
  locked_until timestamptz,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE public.answer_link_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id uuid REFERENCES public.answer_link_search_runs(id) ON DELETE SET NULL,
  book_id uuid NOT NULL REFERENCES public.books(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  url_identity text NOT NULL,
  source_name text,
  link_type text NOT NULL DEFAULT 'unknown',
  source_type text NOT NULL DEFAULT 'unknown' CHECK (source_type IN ('official', 'general', 'unknown')),
  query text NOT NULL,
  snippet text,
  match_status text NOT NULL DEFAULT 'uncertain' CHECK (match_status IN ('likely', 'uncertain', 'mismatch')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'duplicate', 'unverified')),
  review_note text,
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX answer_link_candidates_book_url_unique
  ON public.answer_link_candidates (book_id, url_identity);
CREATE INDEX answer_link_candidates_review_idx
  ON public.answer_link_candidates (status, created_at DESC);
CREATE INDEX answer_link_candidates_book_idx
  ON public.answer_link_candidates (book_id);
CREATE INDEX answer_link_search_runs_created_idx
  ON public.answer_link_search_runs (started_at DESC);

ALTER TABLE public.answer_link_search_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_link_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.answer_link_search_runs, public.answer_link_candidates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.answer_link_search_runs TO authenticated;
GRANT SELECT ON TABLE public.answer_link_candidates TO authenticated;
GRANT ALL ON TABLE public.answer_link_search_runs, public.answer_link_candidates TO service_role;

CREATE POLICY "Admins can read answer link search runs"
  ON public.answer_link_search_runs FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));
CREATE POLICY "Admins can read answer link candidates"
  ON public.answer_link_candidates FOR SELECT TO authenticated
  USING ((SELECT public.is_admin_user()));

-- Edge Functions use the service role only after validating the caller's user
-- token and membership in admin_users. The lock makes concurrent batch calls safe.
CREATE OR REPLACE FUNCTION public.claim_answer_link_search_batch(p_run_id uuid, p_lock_token uuid, p_batch_size integer DEFAULT 5)
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
  SET lock_token = p_lock_token, locked_until = now() + interval '3 minutes'
  WHERE id = p_run_id;

  RETURN jsonb_build_object('start_index', current_run.next_index, 'book_ids', coalesce(to_jsonb(batch_ids), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_answer_link_search_batch(
  p_run_id uuid,
  p_lock_token uuid,
  p_processed integer,
  p_candidates integer,
  p_api_requests integer,
  p_failed_book_ids uuid[] DEFAULT '{}',
  p_error text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_run public.answer_link_search_runs%ROWTYPE;
  next_cursor integer;
BEGIN
  SELECT * INTO current_run FROM public.answer_link_search_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND OR current_run.lock_token IS DISTINCT FROM p_lock_token THEN
    RAISE EXCEPTION 'Search batch lock expired or does not belong to this request.';
  END IF;

  next_cursor := current_run.next_index + GREATEST(0, p_processed);
  UPDATE public.answer_link_search_runs
  SET next_index = next_cursor,
      processed_books = processed_books + GREATEST(0, p_processed),
      candidate_count = candidate_count + GREATEST(0, p_candidates),
      api_requests = api_requests + GREATEST(0, p_api_requests),
      error_count = error_count + cardinality(coalesce(p_failed_book_ids, '{}')),
      failed_book_ids = (SELECT coalesce(array_agg(DISTINCT failed.failed_id), '{}')
                         FROM unnest(current_run.failed_book_ids || coalesce(p_failed_book_ids, '{}')) AS failed(failed_id)),
      last_error = coalesce(p_error, last_error),
      status = CASE WHEN next_cursor >= cardinality(current_run.book_ids) THEN 'completed' ELSE status END,
      finished_at = CASE WHEN next_cursor >= cardinality(current_run.book_ids) THEN now() ELSE NULL END,
      lock_token = NULL,
      locked_until = NULL
  WHERE id = p_run_id;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_answer_link_search_batch(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.finish_answer_link_search_batch(uuid, uuid, integer, integer, integer, uuid[], text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_answer_link_search_batch(uuid, uuid, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.finish_answer_link_search_batch(uuid, uuid, integer, integer, integer, uuid[], text) TO service_role;

CREATE OR REPLACE FUNCTION public.approve_answer_link_candidate(p_candidate_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  candidate public.answer_link_candidates%ROWTYPE;
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT public.is_admin_user()) THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO candidate FROM public.answer_link_candidates WHERE id = p_candidate_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Candidate not found.' USING ERRCODE = 'P0002'; END IF;
  IF candidate.status = 'approved' THEN RETURN 'approved'; END IF;
  IF candidate.status <> 'pending' AND candidate.status <> 'unverified' THEN
    RAISE EXCEPTION 'Only pending candidates can be approved.' USING ERRCODE = '22023';
  END IF;
  IF btrim(coalesce(candidate.url, '')) = '' OR candidate.url !~* '^https?://' THEN
    RAISE EXCEPTION 'Candidate URL must be a valid HTTP(S) URL.' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(candidate.url_identity, 0));
  IF EXISTS (
    SELECT 1 FROM public.answer_links links
    WHERE public.answer_link_url_identity(links.url) = candidate.url_identity
  ) THEN
    UPDATE public.answer_link_candidates
    SET status = 'duplicate', reviewed_by = (SELECT auth.uid()), reviewed_at = now()
    WHERE id = p_candidate_id;
    RETURN 'duplicate';
  END IF;

  INSERT INTO public.answer_links (book_id, title, url, source_name, link_type, verified, click_count)
  VALUES (candidate.book_id, candidate.title, btrim(candidate.url), candidate.source_name, candidate.link_type, false, 0);

  UPDATE public.answer_link_candidates
  SET status = 'approved', reviewed_by = (SELECT auth.uid()), reviewed_at = now()
  WHERE id = p_candidate_id;
  RETURN 'approved';
END;
$$;

REVOKE ALL ON FUNCTION public.approve_answer_link_candidate(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.approve_answer_link_candidate(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.reject_answer_link_candidate(p_candidate_id uuid, p_review_note text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT public.is_admin_user()) THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  UPDATE public.answer_link_candidates
  SET status = 'rejected',
      review_note = nullif(left(btrim(coalesce(p_review_note, '')), 1000), ''),
      reviewed_by = (SELECT auth.uid()),
      reviewed_at = now()
  WHERE id = p_candidate_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate is missing or is no longer pending.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.reject_answer_link_candidate(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reject_answer_link_candidate(uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.set_answer_link_candidate_source_type(p_candidate_id uuid, p_source_type text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.uid()) IS NULL OR NOT (SELECT public.is_admin_user()) THEN
    RAISE EXCEPTION 'Administrator access is required.' USING ERRCODE = '42501';
  END IF;
  IF p_source_type NOT IN ('official', 'general', 'unknown') THEN
    RAISE EXCEPTION 'Invalid source type.' USING ERRCODE = '22023';
  END IF;
  UPDATE public.answer_link_candidates
  SET source_type = p_source_type
  WHERE id = p_candidate_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Candidate is missing or is no longer pending.' USING ERRCODE = 'P0002';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.set_answer_link_candidate_source_type(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_answer_link_candidate_source_type(uuid, text) TO authenticated;
