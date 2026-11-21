ALTER TABLE public.answer_links
  ADD COLUMN IF NOT EXISTS health_match_status text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS health_match_note text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.answer_links'::regclass
      AND conname = 'answer_links_health_match_status_check'
  ) THEN
    ALTER TABLE public.answer_links
      ADD CONSTRAINT answer_links_health_match_status_check
      CHECK (health_match_status = ANY (ARRAY['unknown','matched','mismatch','uncertain','not_applicable']::text[]));
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS answer_links_health_match_status_idx
  ON public.answer_links (health_match_status, health_status);
