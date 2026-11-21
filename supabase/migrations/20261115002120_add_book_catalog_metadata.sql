-- Recovered book-catalog metadata required by the local finder and search ranking.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS series text,
  ADD COLUMN IF NOT EXISTS edition text,
  ADD COLUMN IF NOT EXISTS catalog_key text,
  ADD COLUMN IF NOT EXISTS curriculum_revision text,
  ADD COLUMN IF NOT EXISTS book_url text,
  ADD COLUMN IF NOT EXISTS isbn13 text,
  ADD COLUMN IF NOT EXISTS author text,
  ADD COLUMN IF NOT EXISTS published_at date,
  ADD COLUMN IF NOT EXISTS page_count integer,
  ADD COLUMN IF NOT EXISTS list_price integer,
  ADD COLUMN IF NOT EXISTS cover_image_source text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.books'::regclass
      AND conname = 'books_curriculum_revision_check'
  ) THEN
    ALTER TABLE public.books
      ADD CONSTRAINT books_curriculum_revision_check
      CHECK (curriculum_revision IS NULL OR curriculum_revision IN ('2015 개정', '2022 개정'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS books_catalog_key_unique_idx
  ON public.books (catalog_key);
CREATE INDEX IF NOT EXISTS books_created_at_idx
  ON public.books (created_at DESC);
CREATE INDEX IF NOT EXISTS books_curriculum_revision_idx
  ON public.books (curriculum_revision) WHERE curriculum_revision IS NOT NULL;
CREATE INDEX IF NOT EXISTS books_edition_idx ON public.books (edition);
CREATE INDEX IF NOT EXISTS books_grade_idx ON public.books (grade);
CREATE INDEX IF NOT EXISTS books_isbn13_idx ON public.books (isbn13);
CREATE INDEX IF NOT EXISTS books_publisher_idx ON public.books (publisher);
CREATE INDEX IF NOT EXISTS books_semester_idx ON public.books (semester);
CREATE INDEX IF NOT EXISTS books_series_idx ON public.books (series);
CREATE INDEX IF NOT EXISTS books_subject_idx ON public.books (subject);
