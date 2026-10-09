-- Public catalog data: allow read-only access through the Supabase Data API.
CREATE TABLE public.books (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  publisher text,
  subject text,
  grade text,
  semester text,
  series text,
  thumbnail_url text,
  description text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE public.answer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  book_id uuid REFERENCES public.books(id) ON DELETE CASCADE,
  title text NOT NULL,
  url text NOT NULL,
  source_name text,
  link_type text,
  verified boolean DEFAULT false,
  last_checked_at timestamptz,
  click_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Support catalog filters, latest-first sorting, and per-book answer-link lookup.
CREATE INDEX books_publisher_idx ON public.books (publisher);
CREATE INDEX books_subject_idx ON public.books (subject);
CREATE INDEX books_grade_idx ON public.books (grade);
CREATE INDEX books_semester_idx ON public.books (semester);
CREATE INDEX books_created_at_idx ON public.books (created_at DESC);
CREATE INDEX answer_links_book_id_idx ON public.answer_links (book_id);

ALTER TABLE public.books ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.answer_links ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.books, public.answer_links FROM anon, authenticated;
GRANT SELECT ON TABLE public.books, public.answer_links TO anon, authenticated;

CREATE POLICY "Public can read books"
  ON public.books
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can read answer links"
  ON public.answer_links
  FOR SELECT
  TO anon, authenticated
  USING (true);
