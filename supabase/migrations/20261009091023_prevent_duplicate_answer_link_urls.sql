-- Serialize answer-link inserts by URL identity and reject new duplicates.
-- Existing rows are left untouched so legacy duplicate data does not block migration.
CREATE OR REPLACE FUNCTION public.answer_link_url_identity(p_url text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
DECLARE
  cleaned text := btrim(coalesce(p_url, ''));
  parts text[];
  scheme text;
  authority text;
  suffix text;
BEGIN
  parts := pg_catalog.regexp_match(cleaned, '^([A-Za-z][A-Za-z0-9+.-]*://)([^/?#]*)(.*)$');
  IF parts IS NULL THEN
    RETURN cleaned;
  END IF;

  scheme := pg_catalog.lower(parts[1]);
  authority := pg_catalog.lower(parts[2]);
  suffix := parts[3];

  IF scheme = 'https://' THEN
    authority := pg_catalog.regexp_replace(authority, ':443$', '', 'i');
  ELSIF scheme = 'http://' THEN
    authority := pg_catalog.regexp_replace(authority, ':80$', '', 'i');
  END IF;

  -- Match WHATWG URL serialization for an empty path while preserving path
  -- case, trailing slashes, query parameters, and fragments.
  IF suffix = '' OR pg_catalog.left(suffix, 1) IN ('?', '#') THEN
    suffix := '/' || suffix;
  END IF;

  RETURN scheme || authority || suffix;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_duplicate_answer_link_url()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  normalized_url text;
BEGIN
  NEW.url := btrim(coalesce(NEW.url, ''));
  IF NEW.url = '' THEN
    RETURN NEW;
  END IF;

  normalized_url := public.answer_link_url_identity(NEW.url);
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(normalized_url, 0));

  IF EXISTS (
    SELECT 1
    FROM public.answer_links AS existing
    WHERE existing.id IS DISTINCT FROM NEW.id
      AND public.answer_link_url_identity(existing.url) = normalized_url
  ) THEN
    RAISE EXCEPTION 'An answer link with this URL is already registered.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS answer_links_reject_duplicate_url ON public.answer_links;
CREATE TRIGGER answer_links_reject_duplicate_url
  BEFORE INSERT OR UPDATE OF url
  ON public.answer_links
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_duplicate_answer_link_url();
