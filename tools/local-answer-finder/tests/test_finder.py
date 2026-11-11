import csv
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from finder import ALIASES, allowed_host, assess, build_queries, norm, parse_sitemap, read_books, robots_for, search_bing_rss, USER_AGENT


class FinderUnitTests(unittest.TestCase):
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

    def test_build_queries_includes_blog_platforms(self):
        book = {"title": "오투 중등 과학 1-2", "series": "오투", "subject": "과학",
                "grade": "중1", "semester": "2학기"}
        queries = build_queries(book, 5)
        self.assertGreaterEqual(len(queries), 4)
        self.assertTrue(any("tistory.com" in q and "blog.naver.com" in q for q in queries))

    def test_missing_robots_file_is_treated_as_no_published_rules(self):
        error = HTTPError("https://example.com/robots.txt", 404, "Not Found", {}, None)
        with patch("finder.fetch", side_effect=error):
            parser, sitemaps = robots_for("https://example.com/resources")
        self.assertEqual(sitemaps, [])
        self.assertTrue(parser.can_fetch(USER_AGENT, "https://example.com/resources"))

    def test_bing_rss_search_result_parsing(self):
        rss = """<?xml version="1.0"?><rss><channel><item><title>오투 과학 정답과 해설</title><link>https://example.com/answer</link><description>정답과 해설 자료</description></item></channel></rss>""".encode("utf-8")
        with patch("finder.fetch", return_value=rss):
            results = search_bing_rss("오투 과학 답지", 5)
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["url"], "https://example.com/answer")
        self.assertIn("정답과 해설", results[0]["title"])
        self.assertIn("자료", results[0]["snippet"])

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
