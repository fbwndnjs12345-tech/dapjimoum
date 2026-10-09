BEGIN;

INSERT INTO public.books (
  id, title, publisher, subject, grade, semester, series, thumbnail_url, description
) VALUES
  ('10000000-0000-4000-8000-000000000001', '테스트 수학 기본서', '테스트 출판사', '수학', '초등5', '1학기', '기본 개념', NULL, 'Supabase seed 확인용 수학 교재입니다.'),
  ('10000000-0000-4000-8000-000000000002', '테스트 국어 독해', '테스트 출판사', '국어', '중1', '공통', '독해 연습', NULL, 'Supabase seed 확인용 국어 교재입니다.'),
  ('10000000-0000-4000-8000-000000000003', '테스트 영어 문법', '예시 교육사', '영어', '중2', '2학기', '문법 완성', NULL, 'Supabase seed 확인용 영어 교재입니다.'),
  ('10000000-0000-4000-8000-000000000004', '테스트 과학 탐구', '예시 교육사', '과학', '고1', '공통', '탐구 노트', NULL, 'Supabase seed 확인용 과학 교재입니다.'),
  ('10000000-0000-4000-8000-000000000005', '테스트 한국사 핵심', '샘플 학습사', '한국사', '고2', '1학기', '핵심 정리', NULL, 'Supabase seed 확인용 한국사 교재입니다.')
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  publisher = EXCLUDED.publisher,
  subject = EXCLUDED.subject,
  grade = EXCLUDED.grade,
  semester = EXCLUDED.semester,
  series = EXCLUDED.series,
  thumbnail_url = EXCLUDED.thumbnail_url,
  description = EXCLUDED.description,
  updated_at = now();

INSERT INTO public.answer_links (
  id, book_id, title, url, source_name, link_type, verified, last_checked_at, click_count
) VALUES
  ('20000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000001', '테스트 수학 정답과 해설', 'https://example.com/answers/math-basic', '예시 링크', '해설지', false, NULL, 0),
  ('20000000-0000-4000-8000-000000000002', '10000000-0000-4000-8000-000000000001', '테스트 수학 빠른 정답', 'https://example.com/answers/math-basic/quick', '예시 링크', '빠른정답', false, NULL, 0),
  ('20000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000002', '테스트 국어 정답과 해설', 'https://example.com/answers/korean-reading', '예시 링크', '해설지', false, NULL, 0),
  ('20000000-0000-4000-8000-000000000004', '10000000-0000-4000-8000-000000000003', '테스트 영어 정답과 해설', 'https://example.com/answers/english-grammar', '예시 링크', '해설지', false, NULL, 0),
  ('20000000-0000-4000-8000-000000000005', '10000000-0000-4000-8000-000000000003', '테스트 영어 빠른 정답', 'https://example.com/answers/english-grammar/quick', '예시 링크', '빠른정답', false, NULL, 0),
  ('20000000-0000-4000-8000-000000000006', '10000000-0000-4000-8000-000000000004', '테스트 과학 정답과 해설', 'https://example.com/answers/science-inquiry', '예시 링크', '해설지', false, NULL, 0),
  ('20000000-0000-4000-8000-000000000007', '10000000-0000-4000-8000-000000000005', '테스트 한국사 정답과 해설', 'https://example.com/answers/history-core', '예시 링크', '해설지', false, NULL, 0)
ON CONFLICT (id) DO UPDATE SET
  book_id = EXCLUDED.book_id,
  title = EXCLUDED.title,
  url = EXCLUDED.url,
  source_name = EXCLUDED.source_name,
  link_type = EXCLUDED.link_type,
  verified = EXCLUDED.verified,
  last_checked_at = EXCLUDED.last_checked_at,
  click_count = EXCLUDED.click_count,
  updated_at = now();

COMMIT;
