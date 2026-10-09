-- Official publisher/product page URL imported from the book CSV.
-- Keep this as catalog metadata; it does not change public or admin RLS policies.
ALTER TABLE public.books
  ADD COLUMN IF NOT EXISTS book_url text;

COMMENT ON COLUMN public.books.book_url IS 'Official product page URL for the book; imported from administrator CSV.';
