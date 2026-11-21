import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from finder import (ALIASES, allowed_host, assess, build_queries, build_publisher_queries, publisher_matches_source, canonicalize_url, norm, parse_sitemap,
                    read_books, robots_for, run_search, search_kakao_api, SafeRedirectHandler, USER_AGENT,
                    is_captcha_provider_url, is_human_verification_page, wait_for_manual_verification)


class FinderUnitTests(unittest.TestCase):
    def test_detects_korean_and_english_human_verification(self):
        class FakeLocator:
            def __init__(self, text): self.text = text
            def inner_text(self, timeout=None): return self.text
        class FakePage:
            def __init__(self, title, body, frames=()):
                self._title, self._body = title, body
                class Frame:
                    def __init__(self, url): self.url = url
                    def locator(self, selector):
                        return type("Anchor", (), {"get_attribute": lambda self, name, timeout=None: "false"})()
                self.frames = [Frame(url) for url in frames]
            def title(self): return self._title
            def locator(self, selector): return FakeLocator(self._body)
        self.assertTrue(is_human_verification_page(FakePage("보안 확인", "로봇이 아닙니다 체크박스를 선택하세요")))
        self.assertTrue(is_human_verification_page(FakePage("Verify", "Please wait", ["https://www.google.com/recaptcha/api2/anchor"])))
        self.assertFalse(is_human_verification_page(FakePage("오투 답지", "정답과 해설 자료입니다.")))

    def test_solved_recaptcha_checkbox_is_not_treated_as_pending(self):
        class FakeLocator:
            def get_attribute(self, name, timeout=None): return "true"
        class FakeFrame:
            url = "https://www.google.com/recaptcha/api2/anchor"
            def locator(self, selector): return FakeLocator()
        class FakePage:
            frames = [FakeFrame()]
            def title(self): return "Search results"
            def locator(self, selector):
                return type("Body", (), {"inner_text": lambda self, timeout=None: "정상 검색 결과"})()
        self.assertFalse(is_human_verification_page(FakePage()))

    def test_hidden_browser_does_not_claim_manual_verification_is_available(self):
        class FakePage:
            frames = []
            def title(self): return "Verify"
            def locator(self, selector):
                return type("Body", (), {"inner_text": lambda self, timeout=None: "로봇이 아닙니다"})()
        messages = []
        self.assertFalse(wait_for_manual_verification(FakePage(), messages.append, False))
        self.assertTrue(any("브라우저 표시가 꺼져" in message for message in messages))

    def test_captcha_widget_allowlist_is_narrow(self):
        self.assertTrue(is_captcha_provider_url("https://www.google.com/recaptcha/api2/anchor"))
        self.assertTrue(is_captcha_provider_url("https://challenges.cloudflare.com/turnstile/v0/api.js"))
        self.assertTrue(is_captcha_provider_url("https://js.hcaptcha.com/1/api.js"))
        self.assertFalse(is_captcha_provider_url("https://www.google.com/search?q=answer"))
        self.assertFalse(is_captcha_provider_url("https://evil.example/recaptcha/"))

    def test_manual_verification_waits_until_human_clears_challenge(self):
        class FakeLocator:
            def __init__(self, page): self.page = page
            def inner_text(self, timeout=None): return "로봇이 아닙니다" if self.page.challenge else "인증 완료"
        class FakePage:
            def __init__(self): self.challenge = True; self.frames = []
            def title(self): return "Verify"
            def locator(self, selector): return FakeLocator(self)
        page = FakePage()
        messages = []
        def fake_sleep(_seconds): page.challenge = False
        with patch("finder.time.sleep", side_effect=fake_sleep):
            self.assertTrue(wait_for_manual_verification(page, messages.append, True, timeout_seconds=2))
        self.assertTrue(any("수동 인증 필요" in message for message in messages))
        self.assertTrue(any("수동 인증 완료" in message for message in messages))

    def test_normalization_ignores_spacing_and_punctuation(self):
        self.assertEqual(norm("오투 중등-과학 2·1"), norm("오투중등 과학 2-1"))

    def test_read_books_utf8_bom_and_korean_headers(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "books.csv"
            path.write_text("교재 ID,교재명,출판사\nB-01,오투 과학,비상교육\n", encoding="utf-8-sig")
            rows = read_books(path)
        self.assertEqual(rows[0]["id"], "B-01")
        self.assertEqual(rows[0]["title"], "오투 과학")
        self.assertEqual(rows[0]["publisher"], "비상교육")

    def test_read_books_supports_extended_korean_metadata_headers(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "books.csv"
            path.write_text(
                "교재명,출판사명,과목명,학교급,학기구분,ISBN-13\n"
                "체크체크 수학 2-1,천재교과서,수학,중2,1학기,9781234567890\n",
                encoding="utf-8"
            )
            row = read_books(path)[0]
        self.assertEqual(row["publisher"], "천재교과서")
        self.assertEqual(row["subject"], "수학")
        self.assertEqual(row["grade"], "중2")
        self.assertEqual(row["semester"], "1학기")
        self.assertEqual(row["isbn13"], "9781234567890")

    def test_read_books_cp949(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "books.csv"
            path.write_bytes("교재명,출판사\n오투 과학,비상교육\n".encode("cp949"))
            rows = read_books(path)
        self.assertEqual(rows[0]["title"], "오투 과학")

    def test_read_books_rejects_missing_title_column(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "books.csv"
            path.write_text("id,publisher\n1,비상교육\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "교재명"):
                read_books(path)

    def test_run_search_rejects_empty_textbook_csv_before_browser_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "books.csv"
            path.write_text("title,publisher\n", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "검색할 교재가 없습니다"):
                run_search(path, Path(directory) / "out.csv",
                           Path(directory) / "missing-config.json", False, 20)

    def test_read_books_skips_blank_titles(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "books.csv"
            path.write_text("id,title\n1,오투 과학\n2,\n", encoding="utf-8")
            self.assertEqual(len(read_books(path)), 1)

    def test_assess_exact_answer_page_as_likely(self):
        book = {"title": "오투 중등 과학 2-1"}
        score, status, matched = assess(book, "오투 중등 과학 2-1 정답과 해설", "정답과 해설", ["정답과 해설"])
        self.assertGreaterEqual(score, 90)
        self.assertEqual(status, "likely")
        self.assertIn("정답과 해설", matched)

    def test_assess_unrelated_page_as_mismatch(self):
        book = {"title": "오투 중등 과학 2-1"}
        _, status, _ = assess(book, "개인 블로그 여행 후기", "맛집 방문기", ["정답과 해설", "답지"])
        self.assertEqual(status, "mismatch")

    def test_assess_partial_answer_match_as_uncertain(self):
        book = {"title": "오투 중등 과학 2-1"}
        _, status, _ = assess(book, "오투 과학 정답과 해설", "정답과 해설", ["정답과 해설"])
        self.assertIn(status, ("likely", "uncertain"))

    def test_assess_rejects_wrong_edition(self):
        book = {"title": "오투 중등 과학 1-2"}
        _, status, _ = assess(book, "오투 중등 과학 2-1 정답과 해설", "정답과 해설", ["정답과 해설"])
        self.assertEqual(status, "mismatch")

    def test_assess_uses_exact_isbn_as_strong_book_identity(self):
        book = {"title": "오투 중등 과학 2-1", "isbn13": "9781234567890"}
        score, status, _ = assess(
            book, "정답과 해설 다운로드",
            "교재 자료 다운로드 https://publisher.example/files/9781234567890_answer.pdf",
            ["정답과 해설", "답지"])
        self.assertGreaterEqual(score, 75)
        self.assertEqual(status, "likely")

    def test_assess_rejects_wrong_isbn_even_when_title_is_similar(self):
        book = {"title": "오투 중등 과학 2-1", "isbn13": "9781234567890"}
        _, status, _ = assess(
            book, "오투 중등 과학 2-1 정답과 해설",
            "ISBN 9780987654321 정답과 해설", ["정답과 해설"])
        self.assertEqual(status, "mismatch")

    def test_assess_recognizes_answer_terms_in_file_url_evidence(self):
        book = {"title": "오투 중등 과학 2-1"}
        _, status, _ = assess(
            book, "오투 과학",
            "https://publisher.example/files/오투_과학_정답_solution.pdf",
            ["정답과 해설", "답지"])
        self.assertEqual(status, "uncertain")

    def test_assess_requires_answer_evidence(self):
        book = {"title": "오투 중등 과학 1-2"}
        _, status, _ = assess(book, "오투 중등 과학 1-2 목차", "교재 소개 및 목차", ["정답과 해설", "답지"])
        self.assertEqual(status, "mismatch")

    def test_assess_rejects_check_icon_page_for_checkcheck_textbook(self):
        book = {"title": "체크체크 중학 수학 2-1", "series": "체크체크",
                "subject": "수학", "grade": "중2", "semester": "1학기"}
        _, status, _ = assess(book, "체크 이모티콘 모음 - 체크 표시 아이콘",
                              "각종 체크 표시와 정답 해설 아이콘을 제공합니다.", ["정답과 해설", "답지"])
        self.assertEqual(status, "mismatch")

    def test_assess_accepts_exact_checkcheck_answer_page(self):
        book = {"title": "체크체크 중학 수학 2-1", "series": "체크체크",
                "subject": "수학", "grade": "중2", "semester": "1학기"}
        score, status, _ = assess(book, "체크체크 중학 수학 2-1 수학 정답과 해설",
                                  "중2 1학기 체크체크 수학 답지", ["정답과 해설", "답지"])
        self.assertGreaterEqual(score, 75)
        self.assertEqual(status, "likely")

    def test_assess_rejects_same_series_wrong_subject_or_edition(self):
        book = {"title": "체크체크 중학 수학 2-1", "series": "체크체크",
                "subject": "수학", "grade": "중2"}
        _, status, _ = assess(book, "체크체크 중학 과학 2-1 정답과 해설",
                              "체크체크 과학 답지", ["답지"])
        self.assertEqual(status, "mismatch")

    def test_publisher_aliases_match_common_csv_labels(self):
        self.assertTrue(publisher_matches_source("천재교과서(주)", "천재교육"))
        self.assertTrue(publisher_matches_source("비상", "비상교육"))
        self.assertTrue(publisher_matches_source("동아출판(주)", "동아출판"))
        self.assertFalse(publisher_matches_source("미래엔", "지학사"))
        self.assertTrue(publisher_matches_source("", "지학사"))

    def test_publisher_queries_use_plain_text_and_metadata(self):
        book = {"title": "체크체크 중학 수학 2-1", "series": "체크체크",
                "subject": "수학", "grade": "중2", "semester": "1학기",
                "isbn13": "9781234567890"}
        queries = build_publisher_queries(book, 4)
        self.assertIn("체크체크 중학 수학 2-1", queries)
        self.assertTrue(any("중2" in query and "1학기" in query for query in queries))
        self.assertIn("9781234567890", queries)
        self.assertFalse(any("site:" in query or '"' in query for query in queries))

    def test_publisher_query_builder_handles_missing_title(self):
        self.assertEqual(build_publisher_queries({"title": ""}), [])

    def test_build_queries_includes_blog_platforms(self):
        book = {"title": "오투 중등 과학 1-2", "series": "오투", "subject": "과학",
                "grade": "중1", "semester": "2학기"}
        queries = build_queries(book, 8)
        self.assertLessEqual(len(queries), 8)
        self.assertGreaterEqual(len(queries), 3)
        self.assertTrue(any("블로그" in q and "카페" in q for q in queries))

    def test_build_queries_combines_textbook_metadata_and_answer_intent(self):
        book = {"title": "체크체크 중학 수학 2-1", "publisher": "천재교육",
                "series": "체크체크", "subject": "수학", "grade": "중2",
                "semester": "1학기"}
        queries = build_queries(book, 8)
        self.assertTrue(any('"체크체크 중학 수학 2-1" "답지"' in q for q in queries))
        self.assertTrue(any('"천재교육 체크체크 수학 중2 1학기 2-1" "정답과 해설"' in q for q in queries))
        self.assertTrue(any("블로그" in q and "카페" in q for q in queries))

    def test_missing_robots_file_is_treated_as_no_published_rules(self):
        error = HTTPError("https://example.com/robots.txt", 404, "Not Found", {}, None)
        with patch("finder.fetch", side_effect=error):
            parser, sitemaps = robots_for("https://example.com/resources")
        self.assertEqual(sitemaps, [])
        self.assertTrue(parser.can_fetch(USER_AGENT, "https://example.com/resources"))

    def test_redirect_handler_rejects_cross_host_redirect(self):
        handler = SafeRedirectHandler("example.com")
        request = __import__("urllib.request", fromlist=["Request"]).Request("https://example.com/start")
        with self.assertRaises(HTTPError):
            handler.redirect_request(request, None, 302, "Found", {}, "https://other.example/target")

    def test_kakao_api_uses_official_endpoint_and_strips_result_markup(self):
        payload = {"documents": [{
            "url": "https://example.com/answer",
            "title": "<b>오투</b> 과학 정답과 해설",
            "contents": "<b>중2</b> 1학기 답지"
        }]}
        with patch("finder.fetch_json", return_value=payload) as fetch_json:
            results = search_kakao_api("오투 과학 답지", "kakao_blog", "test-key", 8)
        self.assertEqual(results[0]["title"], "오투 과학 정답과 해설")
        self.assertEqual(results[0]["snippet"], "중2 1학기 답지")
        self.assertIn("dapi.kakao.com/v2/search/blog", fetch_json.call_args.args[0])
        self.assertIn("query=", fetch_json.call_args.args[0])
        self.assertEqual(fetch_json.call_args.args[1]["Authorization"], "KakaoAK test-key")

    def test_canonicalize_url_removes_tracking_and_sorts_query(self):
        actual = canonicalize_url("https://Example.com/path?utm_source=x&z=2&a=1#section")
        self.assertEqual(actual, "https://example.com/path?a=1&z=2")

    def test_parse_sitemap_urlset(self):
        xml = b'<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/a</loc></url></urlset>'
        kind, urls = parse_sitemap(xml)
        self.assertEqual(kind, "urlset")
        self.assertEqual(urls, ["https://example.com/a"])

    def test_parse_sitemap_index(self):
        xml = b'<sitemapindex><sitemap><loc>https://example.com/sitemap-a.xml</loc></sitemap></sitemapindex>'
        kind, urls = parse_sitemap(xml)
        self.assertEqual(kind, "sitemapindex")
        self.assertEqual(len(urls), 1)

    def test_same_host_check_rejects_subdomain_and_external_host(self):
        self.assertTrue(allowed_host("https://example.com/a", "example.com"))
        self.assertFalse(allowed_host("https://sub.example.com/a", "example.com"))
        self.assertFalse(allowed_host("https://other.com/a", "example.com"))

    def test_all_expected_alias_groups_have_entries(self):
        for key in ("id", "title", "publisher", "subject", "grade", "semester", "series"):
            self.assertTrue(ALIASES[key])


if __name__ == "__main__":
    unittest.main(verbosity=2)
