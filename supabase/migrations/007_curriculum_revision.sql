-- Store curriculum revision separately from the book's edition/printing.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS curriculum_revision text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.books'::regclass
      AND conname = 'books_curriculum_revision_check'
  ) THEN
    ALTER TABLE public.books
      ADD CONSTRAINT books_curriculum_revision_check
      CHECK (curriculum_revision IS NULL OR curriculum_revision IN ('2015 개정', '2022 개정'));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS books_curriculum_revision_idx
  ON public.books (curriculum_revision)
  WHERE curriculum_revision IS NOT NULL;
