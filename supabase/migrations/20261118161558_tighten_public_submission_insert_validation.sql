DROP POLICY IF EXISTS "Anyone can submit valid book requests and link reports"
  ON public.user_submissions;

CREATE POLICY "Anyone can submit valid book requests and link reports"
ON public.user_submissions
FOR INSERT
TO anon, authenticated
WITH CHECK (
  char_length(btrim(book_title)) >= 1
  AND char_length(btrim(book_title)) <= 200
  AND char_length(coalesce(publisher, '')) <= 120
  AND char_length(coalesce(answer_link_title, '')) <= 300
  AND char_length(coalesce(reason, '')) <= 120
  AND char_length(coalesce(details, '')) <= 1000
  AND (submitted_by IS NULL OR submitted_by = (SELECT auth.uid()))
  AND (
    (
      submission_type = 'book_request'
      AND answer_link_id IS NULL
      AND answer_link_title IS NULL
      AND reason IS NULL
      AND details IS NULL
    )
    OR
    (
      submission_type = 'link_report'
      AND publisher IS NULL
      AND answer_link_id IS NOT NULL
      AND answer_link_title IS NOT NULL
      AND char_length(btrim(answer_link_title)) >= 1
      AND char_length(btrim(answer_link_title)) <= 300
      AND reason = ANY (ARRAY[
        '깨진 링크 / 페이지 접속 불가',
        '다른 교재 답지가 연결됨',
        '광고나 이상한 사이트로 연결됨',
        '기타'
      ]::text[])
    )
  )
);
