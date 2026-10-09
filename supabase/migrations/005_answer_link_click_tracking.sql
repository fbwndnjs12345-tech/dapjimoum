-- Idempotency records let clients safely retry a click RPC without double-counting.
CREATE TABLE public.answer_link_click_events (
  click_id uuid PRIMARY KEY,
  answer_link_id uuid NOT NULL REFERENCES public.answer_links (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.answer_link_click_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.answer_link_click_events FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_answer_link_click(p_link_id uuid, p_click_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inserted_rows integer;
  resulting_count integer;
BEGIN
  INSERT INTO public.answer_link_click_events (click_id, answer_link_id)
  VALUES (p_click_id, p_link_id)
  ON CONFLICT (click_id) DO NOTHING;

  GET DIAGNOSTICS inserted_rows = ROW_COUNT;

  IF inserted_rows = 0 THEN
    SELECT links.click_count
      INTO resulting_count
      FROM public.answer_links AS links
      WHERE links.id = p_link_id;
    RETURN resulting_count;
  END IF;

  UPDATE public.answer_links AS links
    SET click_count = COALESCE(links.click_count, 0) + 1,
        updated_at = now()
    WHERE links.id = p_link_id
    RETURNING links.click_count INTO resulting_count;

  IF resulting_count IS NULL THEN
    RAISE EXCEPTION 'Answer link not found';
  END IF;

  RETURN resulting_count;
END;
$$;

REVOKE ALL ON FUNCTION public.record_answer_link_click(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_answer_link_click(uuid, uuid) TO anon, authenticated;
