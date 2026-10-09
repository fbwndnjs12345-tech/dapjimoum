-- Keep answer-link writes unavailable to anonymous visitors.
REVOKE INSERT, UPDATE, DELETE ON TABLE public.answer_links FROM anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON TABLE public.answer_links TO authenticated;

CREATE POLICY "Authenticated users can insert answer links"
  ON public.answer_links
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

CREATE POLICY "Authenticated users can update answer links"
  ON public.answer_links
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE POLICY "Authenticated users can delete answer links"
  ON public.answer_links
  FOR DELETE
  TO authenticated
  USING (true);
