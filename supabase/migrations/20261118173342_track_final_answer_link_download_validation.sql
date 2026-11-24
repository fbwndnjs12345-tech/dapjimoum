ALTER TABLE public.answer_links
  ADD COLUMN IF NOT EXISTS health_final_url text,
  ADD COLUMN IF NOT EXISTS health_is_download boolean,
  ADD COLUMN IF NOT EXISTS health_file_name text;

CREATE INDEX IF NOT EXISTS answer_links_health_status_checked_idx
  ON public.answer_links (health_status, health_checked_at);

COMMENT ON COLUMN public.answer_links.health_final_url IS 'Final safe HTTP(S) URL after following redirects during health validation.';
COMMENT ON COLUMN public.answer_links.health_is_download IS 'True when the response is verified as a direct downloadable file, including PDF signature validation.';
COMMENT ON COLUMN public.answer_links.health_file_name IS 'Filename inferred from Content-Disposition or final URL during link validation.';
