import csv
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError

from finder import (
    SafeRedirectHandler, _csv_safe, _write_candidates, build_queries,
    canonicalize_url, collect_pages, is_captcha_provider_url,
    is_human_verification_page, is_safe_public_url, parse_sitemap,
    search_kakao_api, wait_for_manual_verification,
)


class FinderDeepSafetyTests(unittest.TestCase):
    def test_rejects_non_http_schemes_and_credentials(self):
        for value in ("javascript:alert(1)", "file:///C:/Windows/win.ini",
                      "data:text/html,hello", "https://user:pass@example.com/path",
                      "ftp://example.com/file"):
            with self.subTest(value=value):
                self.assertFalse(is_safe_public_url(value))

    def test_rejects_local_and_reserved_hostnames(self):
        for host in ("localhost", "printer.local", "intranet.internal",
                     "test.example", "demo.invalid", "service.onion"):
            with self.subTest(host=host):
                self.assertFalse(is_safe_public_url("https://" + host + "/"))

    def test_rejects_private_loopback_link_local_and_reserved_ip_ranges(self):
        for address in ("127.0.0.1", "10.0.0.5", "172.16.0.1", "192.168.1.1",
                        "169.254.10.20", "0.0.0.0", "224.0.0.1", "100.64.0.1"):
            with self.subTest(address=address):
                self.assertFalse(is_safe_public_url("http://" + address + "/"))

    def test_accepts_public_https_hostname_without_dns_resolution(self):
        self.assertTrue(is_safe_public_url("https://example.com/answers"))

    def test_rejects_unapproved_ports(self):
        self.assertFalse(is_safe_public_url("https://example.com:8080/"))
        self.assertTrue(is_safe_public_url("https://example.com:443/"))
        self.assertTrue(is_safe_public_url("http://example.com:80/"))

    def test_dns_resolution_rejects_host_with_any_private_address(self):
        public = (None, None, None, None, ("93.184.216.34", 443))
        private = (None, None, None, None, ("192.168.1.20", 443))
        with patch("finder.socket.getaddrinfo", return_value=[public, private]):
            self.assertFalse(is_safe_public_url("https://mixed.example/", resolve_dns=True))

    def test_dns_resolution_accepts_only_public_addresses(self):
        public = (None, None, None, None, ("93.184.216.34", 443))
        with patch("finder.socket.getaddrinfo", return_value=[public]):
            self.assertTrue(is_safe_public_url("https://public.example/", resolve_dns=True))

    def test_dns_resolution_failure_fails_closed(self):
        with patch("finder.socket.getaddrinfo", side_effect=OSError("DNS unavailable")):
            self.assertFalse(is_safe_public_url("https://unresolvable.example/", resolve_dns=True))

    def test_canonical_url_preserves_query_and_removes_trackers(self):
        result = canonicalize_url(
            "HTTPS://Example.COM:443/download?z=last&utm_campaign=spring&a=first&fbclid=abc#page"
        )
        self.assertEqual(result, "https://example.com/download?a=first&z=last")

    def test_canonical_url_rejects_private_network_targets(self):
        with self.assertRaises(ValueError):
            canonicalize_url("http://192.168.0.1/admin")

    def test_kakao_search_clamps_limit_and_filters_unsafe_schemes(self):
        payload = {"documents": [
            {"url": "https://example.com/good", "title": "정답", "contents": "해설"},
            {"url": "javascript:alert(1)", "title": "bad", "contents": "bad"},
            {"url": "file:///etc/passwd", "title": "bad", "contents": "bad"},
            {"url": "", "title": "empty", "contents": ""},
        ]}
        with patch("finder.fetch_json", return_value=payload) as request:
            results = search_kakao_api("오투 답지", "kakao_web", "key", 999)
        self.assertEqual([item["url"] for item in results], ["https://example.com/good"])
        query = urllib.parse.urlparse(request.call_args.args[0]).query
        self.assertEqual(urllib.parse.parse_qs(query)["size"], ["50"])

    def test_kakao_search_rejects_unknown_provider(self):
        with self.assertRaisesRegex(ValueError, "지원하지 않는"):
            search_kakao_api("답지", "unknown", "key", 5)

    def test_kakao_search_handles_empty_document_list(self):
        with patch("finder.fetch_json", return_value={"documents": []}):
            self.assertEqual(search_kakao_api("답지", "kakao_blog", "key", 5), [])

    def test_query_builder_returns_no_queries_for_missing_title(self):
        self.assertEqual(build_queries({"title": "  "}, 8), [])

    def test_query_builder_caps_count_and_includes_isbn(self):
        book = {"title": "오투 중등 과학 2-1", "publisher": "비상교육",
                "series": "오투", "subject": "과학", "grade": "중2",
                "semester": "1학기", "isbn13": "9781234567890"}
        queries = build_queries(book, 999)
        self.assertLessEqual(len(queries), 10)
        self.assertTrue(any("9781234567890" in query for query in queries))

    def test_query_builder_clamps_zero_limit_to_one(self):
        self.assertEqual(len(build_queries({"title": "오투 중등 과학 2-1"}, 0)), 1)

    def test_csv_formula_prefixes_are_neutralized(self):
        for value in ("=1+1", "+cmd", "-1+2", "@SUM(A1:A2)", "\tformula", "\rformula"):
            with self.subTest(value=value):
                self.assertTrue(_csv_safe(value).startswith("'"))
        self.assertEqual(_csv_safe("일반 답지"), "일반 답지")
        self.assertEqual(_csv_safe(None), "")

    def test_candidate_csv_write_is_atomic_and_keeps_utf8_bom(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "candidates.csv"
            output.write_text("old content", encoding="utf-8")
            _write_candidates(output, {("book-1", "https://example.com/a"): {
                "book_id": "book-1", "book_title": "오투 과학",
                "candidate_title": "=HYPERLINK(1)", "url": "https://example.com/a",
                "match_score": 90}})
            self.assertTrue(output.read_bytes().startswith(b"\xef\xbb\xbf"))
            with output.open("r", encoding="utf-8-sig", newline="") as handle:
                rows = list(csv.DictReader(handle))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]["candidate_title"], "'=HYPERLINK(1)")
            self.assertFalse(output.with_name(output.name + ".tmp").exists())

    def test_sitemap_parser_rejects_malformed_xml(self):
        with self.assertRaises(Exception):
            parse_sitemap(b"<urlset><url><loc>https://example.com")

    def test_sitemap_collection_discards_external_hosts_and_duplicates(self):
        xml = (b"<urlset><url><loc>https://example.com/a</loc></url>"
               b"<url><loc>https://example.com/a</loc></url>"
               b"<url><loc>https://attacker.example/steal</loc></url></urlset>")
        class Robots:
            def can_fetch(self, _agent, _url):
                return True
        def fake_fetch(url, allowed_host=None):
            if url.endswith("/sitemap.xml"):
                return xml
            raise ValueError("no sitemap")
        with patch("finder.fetch", side_effect=fake_fetch):
            pages = collect_pages("https://example.com/start", Robots(), [], 20, lambda _message: None)
        self.assertEqual(pages, ["https://example.com/start", "https://example.com/a"])
        self.assertFalse(any("attacker.example" in url for url in pages))

    def test_redirect_handler_rejects_private_network_redirect(self):
        handler = SafeRedirectHandler()
        request = __import__("urllib.request", fromlist=["Request"]).Request("https://example.com/start")
        with patch("finder.is_safe_public_url", return_value=False):
            with self.assertRaises(HTTPError):
                handler.redirect_request(request, None, 302, "Found", {}, "http://127.0.0.1/admin")

    def test_captcha_provider_matching_requires_exact_host_and_path(self):
        self.assertTrue(is_captcha_provider_url("https://www.google.com/recaptcha/api2/anchor"))
        self.assertFalse(is_captcha_provider_url("https://www.google.com.evil.test/recaptcha/api2/anchor"))
        self.assertFalse(is_captcha_provider_url("https://www.google.com/search?q=recaptcha"))
        self.assertFalse(is_captcha_provider_url("https://evil.test/turnstile/api.js"))

    def test_human_verification_detection_recognizes_normal_content(self):
        class Body:
            def inner_text(self, timeout=None):
                return "오투 중등 과학 정답과 해설 자료입니다."
        class Page:
            frames = []
            def title(self):
                return "오투 정답과 해설"
            def locator(self, _selector):
                return Body()
        self.assertFalse(is_human_verification_page(Page()))

    def test_manual_verification_stops_when_stop_event_is_set(self):
        class Stop:
            def is_set(self):
                return True
        class Body:
            def inner_text(self, timeout=None):
                return "로봇이 아닙니다"
        class Page:
            frames = []
            def title(self):
                return "보안 확인"
            def locator(self, _selector):
                return Body()
        messages = []
        self.assertFalse(wait_for_manual_verification(
            Page(), messages.append, True, stop_event=Stop(), timeout_seconds=30))
        self.assertTrue(any("사용자가 탐색 중지" in message for message in messages))

    def test_manual_verification_times_out_without_claiming_success(self):
        class Body:
            def inner_text(self, timeout=None):
                return "로봇이 아닙니다"
        class Page:
            frames = []
            def title(self):
                return "보안 확인"
            def locator(self, _selector):
                return Body()
        messages = []
        with patch("finder.time.monotonic", side_effect=[0, 0, 2]), patch("finder.time.sleep"):
            result = wait_for_manual_verification(Page(), messages.append, True, timeout_seconds=1)
        self.assertFalse(result)
        self.assertTrue(any("시간 초과" in message for message in messages))
        self.assertFalse(any("인증 완료" in message for message in messages))


if __name__ == "__main__":
    unittest.main(verbosity=2)
