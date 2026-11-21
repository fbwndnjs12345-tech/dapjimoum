import csv
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from unittest.mock import patch
from urllib.error import HTTPError

from finder import (
    SafeRedirectHandler, _candidate_rank, _csv_safe, _upsert_top_candidate,
    _write_candidates, build_queries, canonicalize_url, collect_pages,
    discover_site_search_urls, extract_answer_links, is_captcha_provider_url, is_human_verification_page,
    is_safe_public_url, parse_sitemap, search_kakao_api, upgrade_search_config,
    wait_for_manual_verification, wait_for_page_content,
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
            self.assertFalse(is_safe_public_url("https://mixed.testdomain.com/", resolve_dns=True))

    def test_dns_resolution_accepts_only_public_addresses(self):
        public = (None, None, None, None, ("93.184.216.34", 443))
        with patch("finder.socket.getaddrinfo", return_value=[public]):
            self.assertTrue(is_safe_public_url("https://public.testdomain.com/", resolve_dns=True))

    def test_dns_resolution_failure_fails_closed(self):
        with patch("finder.socket.getaddrinfo", side_effect=OSError("DNS unavailable")):
            self.assertFalse(is_safe_public_url("https://unresolvable.testdomain.com/", resolve_dns=True))

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
        params = urllib.parse.parse_qs(query)
        self.assertEqual(params["size"], ["50"])
        self.assertEqual(params["page"], ["1"])


    def test_kakao_search_page_parameter_is_clamped_and_sent(self):
        with patch("finder.fetch_json", return_value={"documents": []}) as request:
            search_kakao_api("오투 답지", "kakao_web", "key", 12, page=999)
        query = urllib.parse.urlparse(request.call_args.args[0]).query
        self.assertEqual(urllib.parse.parse_qs(query)["page"], ["50"])

    def test_legacy_search_config_is_upgraded_to_higher_recall_once(self):
        config = {"web_search": {
            "max_queries_per_book": 3,
            "results_per_engine": 5,
            "max_candidates_per_book": 5,
        }}
        upgraded, changed = upgrade_search_config(config)
        self.assertTrue(changed)
        self.assertEqual(upgraded["web_search"]["max_queries_per_book"], 8)
        self.assertEqual(upgraded["web_search"]["results_per_engine"], 12)
        self.assertEqual(upgraded["web_search"]["max_candidates_per_book"], 20)
        self.assertEqual(upgraded["web_search"]["max_search_pages_per_query"], 2)
        self.assertEqual(upgraded["max_pages_to_verify_per_book"], 80)
        upgraded_again, changed_again = upgrade_search_config(upgraded)
        self.assertFalse(changed_again)
        self.assertEqual(upgraded_again, upgraded)

    def test_source_catalog_migration_preserves_custom_sources_and_adds_official_defaults(self):
        custom = {"publisher": "내가 추가한 출판사",
                  "start_urls": ["https://custom.example/resources"]}
        config = {"sources": [custom], "web_search": {"strategy_version": 3}}
        upgraded, changed = upgrade_search_config(config)
        self.assertTrue(changed)
        publishers = {source["publisher"] for source in upgraded["sources"]}
        self.assertIn("내가 추가한 출판사", publishers)
        self.assertTrue({"비상교육", "지학사", "천재교육", "NE능률", "좋은책신사고"}.issubset(publishers))
        self.assertEqual(upgraded["sources"][0]["start_urls"], ["https://custom.example/resources"])
        again, changed_again = upgrade_search_config(upgraded)
        self.assertFalse(changed_again)
        self.assertEqual(again, upgraded)

    def test_catalog_v1_migrates_to_v4_and_adds_mirae(self):
        config = {"source_catalog_version": 1,
                  "sources": [{"publisher": "사용자 출처",
                               "start_urls": ["https://custom.example/"]}],
                  "web_search": {"strategy_version": 3}}
        upgraded, changed = upgrade_search_config(config)
        self.assertTrue(changed)
        self.assertEqual(upgraded["source_catalog_version"], 4)
        self.assertIn("미래엔", {item["publisher"] for item in upgraded["sources"]})
        self.assertIn("사용자 출처", {item["publisher"] for item in upgraded["sources"]})

    def test_catalog_v2_migrates_to_v4_official_portal_urls(self):
        config = {"source_catalog_version": 2,
                  "sources": [{"publisher": "천재교육", "start_urls": ["https://book.chunjae.co.kr/"]}],
                  "web_search": {"strategy_version": 3}}
        upgraded, changed = upgrade_search_config(config)
        self.assertTrue(changed)
        self.assertEqual(upgraded["source_catalog_version"], 4)
        chunjae = next(item for item in upgraded["sources"] if item["publisher"] == "천재교육")
        self.assertIn("https://brand_check.chunjae.co.kr/", chunjae["start_urls"])
        ne = next(item for item in upgraded["sources"] if item["publisher"] == "NE능률")
        self.assertIn("https://www.nebooks.co.kr/pages/service/", ne["start_urls"])

    def test_catalog_v3_migrates_to_v4_and_adds_donga_resources(self):
        config = {"source_catalog_version": 3,
                  "sources": [{"publisher": "사용자 출처",
                               "start_urls": ["https://custom.example/"]}],
                  "web_search": {"strategy_version": 3}}
        upgraded, changed = upgrade_search_config(config)
        self.assertTrue(changed)
        self.assertEqual(upgraded["source_catalog_version"], 4)
        donga = next(item for item in upgraded["sources"] if item["publisher"] == "동아출판")
        self.assertIn("https://www.bookdonga.com/middle/extradata_list.donga", donga["start_urls"])
        self.assertIn("https://www.bookdonga.com/high/extradata_list.donga", donga["start_urls"])

    def test_v2_search_config_is_upgraded_to_v3_once(self):
        config = {"web_search": {"strategy_version": 2,
                                 "max_candidates_per_book": 12},
                  "max_pages_to_verify_per_book": 40}
        upgraded, changed = upgrade_search_config(config)
        self.assertTrue(changed)
        self.assertEqual(upgraded["web_search"]["strategy_version"], 3)
        self.assertEqual(upgraded["web_search"]["max_candidates_per_book"], 20)
        self.assertEqual(upgraded["max_pages_to_verify_per_book"], 80)
        again, changed_again = upgrade_search_config(upgraded)
        self.assertFalse(changed_again)
        self.assertEqual(again, upgraded)

    def test_top_candidate_limit_replaces_weak_early_result(self):
        candidates = {}
        weak = {"match_score": 18, "match_status": "uncertain"}
        strong = {"match_score": 91, "match_status": "likely"}
        self.assertEqual(_upsert_top_candidate(candidates, "book-1", "https://example.com/weak", weak, 1), "added")
        self.assertEqual(_upsert_top_candidate(candidates, "book-1", "https://example.com/strong", strong, 1), "replaced")
        self.assertNotIn(("book-1", "https://example.com/weak"), candidates)
        self.assertIn(("book-1", "https://example.com/strong"), candidates)

    def test_top_candidate_limit_does_not_replace_likely_with_uncertain(self):
        candidates = {}
        likely = {"match_score": 70, "match_status": "likely"}
        uncertain = {"match_score": 99, "match_status": "uncertain"}
        _upsert_top_candidate(candidates, "book-1", "https://example.com/likely", likely, 1)
        result = _upsert_top_candidate(candidates, "book-1", "https://example.com/uncertain", uncertain, 1)
        self.assertEqual(result, "rejected")
        self.assertEqual(len(candidates), 1)
        self.assertEqual(_candidate_rank(likely), (2, 70))

    def test_top_candidate_limit_updates_same_url_only_when_better(self):
        candidates = {}
        _upsert_top_candidate(candidates, "book-1", "https://example.com/a",
                              {"match_score": 50, "match_status": "uncertain"}, 2)
        result = _upsert_top_candidate(candidates, "book-1", "https://example.com/a",
                                       {"match_score": 80, "match_status": "likely"}, 2)
        self.assertEqual(result, "updated")
        self.assertEqual(candidates[("book-1", "https://example.com/a")]["match_score"], 80)

    def test_dynamic_content_wait_is_bounded_and_tolerates_timeout(self):
        class FakePage:
            def __init__(self):
                self.wait_timeout = None
                self.pause = None
            def wait_for_function(self, _script, timeout):
                self.wait_timeout = timeout
                raise PlaywrightTimeoutError("wait timeout")
            def wait_for_timeout(self, value):
                self.pause = value
        page = FakePage()
        wait_for_page_content(page, timeout_ms=99999)
        self.assertEqual(page.wait_timeout, 6000)
        self.assertEqual(page.pause, 350)

    def test_publisher_native_search_uses_same_host_get_forms_without_api(self):
        class Locator:
            def evaluate_all(self, _script):
                return [
                    {"action": "https://publisher.testdomain.com/search", "name": "keyword",
                     "hidden": [["category", "answer"]]},
                    {"action": "https://other.testdomain.com/search", "name": "q", "hidden": []},
                    {"action": "https://other.testdomain.com/private", "name": "q", "hidden": []},
                ]
        class Page:
            def locator(self, selector):
                self.selector = selector
                return Locator()
        page = Page()
        urls = discover_site_search_urls(page, "오투 과학 정답과 해설", "publisher.testdomain.com")
        self.assertEqual(len(urls), 1)
        parsed = urllib.parse.urlparse(urls[0])
        self.assertEqual(parsed.netloc, "publisher.testdomain.com")
        params = urllib.parse.parse_qs(parsed.query)
        self.assertEqual(params["keyword"], ["오투 과학 정답과 해설"])
        self.assertEqual(params["category"], ["answer"])

    def test_publisher_native_search_rejects_non_public_or_cross_host_forms(self):
        class Locator:
            def evaluate_all(self, _script):
                return [
                    {"action": "http://127.0.0.1/search", "name": "q", "hidden": []},
                    {"action": "https://evil.testdomain.com/search", "name": "q", "hidden": []},
                ]
        class Page:
            def locator(self, _selector):
                return Locator()
        self.assertEqual(discover_site_search_urls(Page(), "답지", "publisher.testdomain.com"), [])

    def test_answer_link_extraction_requests_nearby_context(self):
        class Locator:
            def __init__(self):
                self.selector = None
                self.args = None
            def evaluate_all(self, script, limit):
                self.selector = script
                self.args = limit
                return [{"href": "https://example.com/answer.pdf",
                         "text": "다운로드", "context": "오투 과학 정답과 해설"}]
        class Page:
            def __init__(self):
                self.loc = Locator()
            def locator(self, selector):
                self.selector = selector
                return self.loc
        page = Page()
        result = extract_answer_links(page, 40)
        self.assertEqual(page.selector, "a[href], area[href], [data-href], [data-url], [onclick]")
        self.assertEqual(page.loc.args, 40)
        self.assertIn("context", result[0])

    def test_answer_link_extraction_includes_data_attribute_downloads(self):
        class Locator:
            def evaluate_all(self, script, limit):
                self.script = script
                return [{"href": "https://cdn.publisher.testdomain.com/files/answer.pdf",
                         "text": "정답과 해설 다운로드", "context": "오투 과학 정답과 해설"}]
        class Page:
            def __init__(self): self.locator_result = Locator()
            def locator(self, selector):
                self.selector = selector
                return self.locator_result
        page = Page()
        links = extract_answer_links(page, 20)
        self.assertIn("[data-href]", page.selector)
        self.assertEqual(links[0]["href"], "https://cdn.publisher.testdomain.com/files/answer.pdf")

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
