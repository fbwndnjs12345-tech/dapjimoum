-- Only signed-in users may manage books; anonymous public writes remain revoked.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.books FROM anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.books TO authenticated;

CREATE POLICY "Authenticated users can insert books"
  ON public.books
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update books"
  ON public.books
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete books"
  ON public.books
  FOR DELETE
  TO authenticated
  USING (true);
