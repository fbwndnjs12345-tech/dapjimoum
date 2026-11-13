import csv
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from finder import run_search


BOOK_TITLE = "오투 중등 과학 2-1"


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/robots.txt":
            body = b"User-agent: *\\nAllow: /\\n"
            status = 200
            content_type = "text/plain; charset=utf-8"
        elif self.path == "/sitemap.xml":
            body = b'<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>' + f"http://127.0.0.1:{self.server.server_port}/resources".encode() + b"</loc></url></urlset>"
            status = 200
            content_type = "application/xml"
        elif self.path == "/resources":
            body = f"""<!doctype html><html><head><title>{BOOK_TITLE} 정답과 해설</title>
<meta name="description" content="{BOOK_TITLE} 정답과 해설 자료"></head>
<body><h1>{BOOK_TITLE}</h1><p>정답과 해설 및 답지 자료를 확인할 수 있습니다.</p>
<a href="/answer">정답과 해설 PDF</a></body></html>""".encode("utf-8")
            status = 200
            content_type = "text/html; charset=utf-8"
        elif self.path == "/answer":
            body = f"""<!doctype html><html><head><title>{BOOK_TITLE} 정답과 해설</title></head>
<body><h1>{BOOK_TITLE}</h1><p>정답과 해설 답지</p></body></html>""".encode("utf-8")
            status = 200
            content_type = "text/html; charset=utf-8"
        else:
            body = b"not found"
            status = 404
            content_type = "text/plain"
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


class FinderEndToEndTests(unittest.TestCase):
    def test_source_crawl_google_bing_and_candidate_csv_pipeline(self):
        server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = f"http://127.0.0.1:{server.server_port}"
            search_result = {
                "url": base + "/answer",
                "title": BOOK_TITLE + " 정답과 해설",
                "snippet": BOOK_TITLE + " 답지 정답과 해설",
            }
            with tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                books = root / "books.csv"
                with books.open("w", encoding="utf-8-sig", newline="") as handle:
                    writer = csv.DictWriter(handle, fieldnames=[
                        "id", "title", "publisher", "subject", "grade", "semester", "series"
                    ])
                    writer.writeheader()
                    writer.writerow({
                        "id": "fixture-book-1", "title": BOOK_TITLE, "publisher": "비상교육",
                        "subject": "과학", "grade": "중2", "semester": "1학기", "series": "오투"
                    })
                config = root / "sources.json"
                config.write_text(json.dumps({
                    "sources": [{"publisher": "비상교육", "start_urls": [base + "/resources"]}],
                    "max_sitemap_urls_per_source": 10,
                    "request_delay_seconds": 1,
                    "page_timeout_ms": 10000,
                    "answer_keywords": ["정답과 해설", "답지"],
                    "web_search": {
                        "enabled": True, "engines": ["google", "bing"],
                        "results_per_engine": 5, "max_queries_per_book": 1
                    }
                }, ensure_ascii=False), encoding="utf-8")
                output = root / "answer-link-candidates.csv"
                with patch("finder.search_google_page", return_value=[search_result]) as google, \\
                     patch("finder.search_bing_rss", return_value=[search_result]) as bing:
                    count = run_search(books, output, config, False, 10, lambda _line: None)
                self.assertGreaterEqual(count, 1)
                self.assertTrue(output.is_file())
                with output.open("r", encoding="utf-8-sig", newline="") as handle:
                    rows = list(csv.DictReader(handle))
                self.assertTrue(rows)
                self.assertTrue(any(row["url"].endswith("/resources") for row in rows))
                self.assertTrue(any(row["url"].endswith("/answer") for row in rows))
                self.assertTrue(all(row["book_id"] == "fixture-book-1" for row in rows))
                self.assertTrue(all(row["match_status"] in ("likely", "uncertain") for row in rows))
                google.assert_called_once()
                bing.assert_called_once()
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
