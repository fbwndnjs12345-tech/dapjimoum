-- Catalog identity and curation metadata for production book records.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS edition text;

-- Keep the generated key expression immutable. jsonb_build_array is not
-- classified IMMUTABLE by PostgreSQL, so encode each normalized value as hex
-- and delimit the resulting hex-only fields.
CREATE OR REPLACE FUNCTION public.book_catalog_identity(
  p_title text,
  p_publisher text,
  p_subject text,
  p_grade text,
  p_semester text,
  p_series text,
  p_edition text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
SET search_path = ''
AS $$
  SELECT
    encode(convert_to(lower(regexp_replace(btrim(coalesce(p_title, '')), '\s+', ' ', 'g')), 'UTF8'), 'hex') || '.' ||
    encode(convert_to(lower(regexp_replace(btrim(coalesce(p_publisher, '')), '\s+', ' ', 'g')), 'UTF8'), 'hex') || '.' ||
    encode(convert_to(lower(regexp_replace(btrim(coalesce(p_subject, '')), '\s+', ' ', 'g')), 'UTF8'), 'hex') || '.' ||
    encode(convert_to(lower(regexp_replace(btrim(coalesce(p_grade, '')), '\s+', ' ', 'g')), 'UTF8'), 'hex') || '.' ||
    encode(convert_to(lower(regexp_replace(btrim(coalesce(p_semester, '')), '\s+', ' ', 'g')), 'UTF8'), 'hex') || '.' ||
    encode(convert_to(lower(regexp_replace(btrim(coalesce(p_series, '')), '\s+', ' ', 'g')), 'UTF8'), 'hex') || '.' ||
    encode(convert_to(lower(regexp_replace(btrim(coalesce(p_edition, '')), '\s+', ' ', 'g')), 'UTF8'), 'hex');
$$;

REVOKE ALL ON FUNCTION public.book_catalog_identity(text, text, text, text, text, text, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.book_catalog_identity(text, text, text, text, text, text, text)
  TO anon, authenticated, service_role;

ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS catalog_key text GENERATED ALWAYS AS (
    public.book_catalog_identity(title, publisher, subject, grade, semester, series, edition)
  ) STORED;

-- Existing duplicates are retained and reported; the unique index is installed
-- only when identity conflicts have been reviewed and resolved by an operator.
CREATE OR REPLACE VIEW public.book_catalog_duplicate_candidates AS
SELECT catalog_key, array_agg(id ORDER BY created_at, id) AS book_ids, count(*) AS row_count
FROM public.books
GROUP BY catalog_key
HAVING count(*) > 1;
REVOKE ALL ON TABLE public.book_catalog_duplicate_candidates FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.book_catalog_duplicate_candidates) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS books_catalog_key_unique_idx ON public.books (catalog_key);
  ELSE
    CREATE INDEX IF NOT EXISTS books_catalog_key_idx ON public.books (catalog_key);
    RAISE NOTICE 'Duplicate catalog identities exist. Review public.book_catalog_duplicate_candidates, resolve them manually, then create books_catalog_key_unique_idx.';
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS books_series_idx ON public.books (series);
CREATE INDEX IF NOT EXISTS books_edition_idx ON public.books (edition);

-- Even if legacy duplicate identities prevent the unique index above, prevent
-- new duplicates from being added and serialize simultaneous inserts by key.
CREATE OR REPLACE FUNCTION public.reject_duplicate_book_catalog_key()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  normalized_key text;
BEGIN
  normalized_key := public.book_catalog_identity(
    NEW.title, NEW.publisher, NEW.subject, NEW.grade,
    NEW.semester, NEW.series, NEW.edition
  );
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(normalized_key));
  IF EXISTS (
    SELECT 1 FROM public.books AS existing
    WHERE existing.catalog_key = normalized_key
      AND existing.id IS DISTINCT FROM NEW.id
  ) THEN
    RAISE EXCEPTION 'A book with the same normalized catalog identity already exists.'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS books_reject_duplicate_catalog_key ON public.books;
CREATE TRIGGER books_reject_duplicate_catalog_key
  BEFORE INSERT OR UPDATE OF title, publisher, subject, grade, semester, series, edition
  ON public.books
  FOR EACH ROW EXECUTE FUNCTION public.reject_duplicate_book_catalog_key();

CREATE OR REPLACE FUNCTION public.set_answer_link_verification_timestamp()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.verified IS TRUE THEN
      NEW.last_checked_at := now();
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.verified IS TRUE AND (
    OLD.verified IS DISTINCT FROM TRUE OR NEW.url IS DISTINCT FROM OLD.url
  ) THEN
    NEW.last_checked_at := now();
  ELSIF NEW.verified IS FALSE AND OLD.verified IS DISTINCT FROM FALSE THEN
    NEW.last_checked_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS answer_links_verification_timestamp ON public.answer_links;
CREATE TRIGGER answer_links_verification_timestamp
  BEFORE INSERT OR UPDATE OF verified, url ON public.answer_links
  FOR EACH ROW EXECUTE FUNCTION public.set_answer_link_verification_timestamp();

-- Anonymous users can continue to read links, but only verified links with a
-- recent manual check are exposed in public catalog/detail queries.
CREATE INDEX IF NOT EXISTS answer_links_verified_checked_idx
  ON public.answer_links (book_id, last_checked_at DESC)
  WHERE verified IS TRUE;
