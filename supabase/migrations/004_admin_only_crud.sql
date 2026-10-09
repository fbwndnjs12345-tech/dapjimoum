-- Admin membership is managed by a trusted operator, never by a browser client.
CREATE TABLE public.admin_users (
  user_id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.admin_users FROM PUBLIC, anon, authenticated;

-- SECURITY DEFINER lets the policy check membership while admin_users stays private.
CREATE OR REPLACE FUNCTION public.is_admin_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.admin_users AS admins
    WHERE admins.user_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_admin_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_user() TO authenticated;

-- Remove the earlier policy that granted writes to every authenticated user,
-- plus the broad policy names used by the original schema setup screen.
DROP POLICY IF EXISTS "Authenticated users can insert books" ON public.books;
DROP POLICY IF EXISTS "Authenticated users can update books" ON public.books;
DROP POLICY IF EXISTS "Authenticated users can delete books" ON public.books;
DROP POLICY IF EXISTS "Authenticated users can insert answer links" ON public.answer_links;
DROP POLICY IF EXISTS "Authenticated users can update answer links" ON public.answer_links;
DROP POLICY IF EXISTS "Authenticated users can delete answer links" ON public.answer_links;
DROP POLICY IF EXISTS "Admin Full Books" ON public.books;
DROP POLICY IF EXISTS "Admin Full Links" ON public.answer_links;

REVOKE INSERT, UPDATE, DELETE ON TABLE public.books, public.answer_links FROM PUBLIC, anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.books, public.answer_links TO authenticated;

CREATE POLICY "Admins can insert books"
  ON public.books FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin_user()));

CREATE POLICY "Admins can update books"
  ON public.books FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin_user()))
  WITH CHECK ((SELECT public.is_admin_user()));

CREATE POLICY "Admins can delete books"
  ON public.books FOR DELETE TO authenticated
  USING ((SELECT public.is_admin_user()));

CREATE POLICY "Admins can insert answer links"
  ON public.answer_links FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.is_admin_user()));

CREATE POLICY "Admins can update answer links"
  ON public.answer_links FOR UPDATE TO authenticated
  USING ((SELECT public.is_admin_user()))
  WITH CHECK ((SELECT public.is_admin_user()));

CREATE POLICY "Admins can delete answer links"
  ON public.answer_links FOR DELETE TO authenticated
  USING ((SELECT public.is_admin_user()));

-- First admin bootstrap (run after creating the user in Supabase Auth):
-- INSERT INTO public.admin_users (user_id)
-- SELECT id FROM auth.users WHERE email = 'admin@example.com'
-- ON CONFLICT (user_id) DO NOTHING;
