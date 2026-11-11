#!/usr/bin/env python3
"""Find answer-key page candidates on configured, crawl-permitted publisher sites.

This tool deliberately does not scrape Google/Naver result pages and does not
bypass authentication, CAPTCHAs, robots rules, or access controls.
"""
from __future__ import annotations

import argparse
import csv
import json
import re
import sys
import time
import urllib.robotparser
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen

from bs4 import BeautifulSoup
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

USER_AGENT = "DapjiMoumLocalFinder/1.0 (+local user-run tool)"
COLUMN_ALIASES = {
    "id": ["id", "book_id", "교재 ID"],
    "title": ["title", "book_title", "교재명", "도서명", "책이름", "책 제목"],
    "publisher": ["publisher", "출판사", "발행사"],
    "subject": ["subject", "과목", "교과"],
    "grade": ["grade", "학년"],
    "semester": ["semester", "학기"],
    "series": ["series", "시리즈", "교재 시리즈"],
}
ANSWER_TERMS_DEFAULT = ["정답과 해설", "정답 해설", "정답 및 해설", "답지"]


def normalize(value: str) -> str:
    return re.sub(r"[\s·ㆍ_\-–—()[\]{}:：,.]+", "", value or "").casefold()


def fetch_bytes(url: str, timeout: int = 15) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xml,text/xml,*/*"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def read_csv(path: Path) -> list[dict[str, str]]:
    last_error: Exception | None = None
    for encoding in ("utf-8-sig", "cp949", "utf-8"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                reader = csv.DictReader(handle)
                if not reader.fieldnames:
                    raise ValueError("CSV 헤더 행을 찾을 수 없습니다.")
                mapped: dict[str, str] = {}
                for canonical, aliases in COLUMN_ALIASES.items():
                    found = next((name for name in reader.fieldnames if name.strip().casefold() in {a.casefold() for a in aliases}), None)
                    if found:
                        mapped[canonical] = found
                if "title" not in mapped:
                    raise ValueError("CSV에 title 또는 교재명 열이 필요합니다.")
                rows: list[dict[str, str]] = []
                for raw in reader:
                    row = {key: (raw.get(column) or "").strip() for key, column in mapped.items()}
                    if row.get("title"):
                        rows.append(row)
                return rows
        except (UnicodeDecodeError, ValueError) as exc:
            last_error = exc
    raise ValueError(f"CSV를 읽지 못했습니다: {last_error}")


def same_host(url: str, allowed_hosts: set[str]) -> bool:
    return (urlparse(url).hostname or "").lower() in allowed_hosts


def get_robots(start_url: str) -> tuple[urllib.robotparser.RobotFileParser | None, list[str]]:
    parsed = urlparse(start_url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(robots_url)
    try:
        text = fetch_bytes(robots_url).decode("utf-8", errors="replace")
        parser.parse(text.splitlines())
        sitemap_urls = re.findall(r"(?im)^\s*sitemap:\s*(\S+)", text)
        return parser, sitemap_urls
    except Exception as exc:
        print(f"[건너뜀] robots.txt를 확인할 수 없음: {robots_url} ({exc})", file=sys.stderr)
        return None, []


def sitemap_locations(xml_data: bytes) -> tuple[str, list[str]]:
    root = ET.fromstring(xml_data)
    root_name = root.tag.rsplit("}", 1)[-1].lower()
    locations = [
        (element.text or "").strip()
        for element in root.iter()
        if element.tag.rsplit("}", 1)[-1].lower() == "loc" and (element.text or "").strip()
    ]
    return root_name, locations


def collect_sitemap_urls(
    sitemap_urls: list[str],
    allowed_hosts: set[str],
    robots: urllib.robotparser.RobotFileParser,
    limit: int,
) -> list[str]:
    queue = list(dict.fromkeys(sitemap_urls))
    seen_sitemaps: set[str] = set()
    pages: list[str] = []
    while queue and len(pages) < limit:
        sitemap_url = queue.pop(0)
        if sitemap_url in seen_sitemaps or not same_host(sitemap_url, allowed_hosts):
            continue
        seen_sitemaps.add(sitemap_url)
        if not robots.can_fetch(USER_AGENT, sitemap_url):
            continue
        try:
            root_type, locations = sitemap_locations(fetch_bytes(sitemap_url))
        except Exception as exc:
            print(f"[경고] sitemap 읽기 실패: {sitemap_url} ({exc})", file=sys.stderr)
            continue
        if root_type == "sitemapindex":
            queue.extend(url for url in locations if same_host(url, allowed_hosts))
        else:
            for url in locations:
                if same_host(url, allowed_hosts) and robots.can_fetch(USER_AGENT, url):
                    pages.append(url)
                    if len(pages) >= limit:
                        break
    return list(dict.fromkeys(pages))


def page_text(page: Any) -> tuple[str, str, str]:
    title = (page.title() or "").strip()
    description = page.locator('meta[name="description"]').get_attribute("content", timeout=1500) or ""
    try:
        body = page.locator("body").inner_text(timeout=3000)
    except Exception:
        body = ""
    return title[:500], description[:1500], re.sub(r"\s+", " ", body)[:10000]


def score_candidate(book: dict[str, str], title: str, description: str, body: str, answer_terms: list[str]) -> tuple[int, str, str]:
    combined = normalize(" ".join([title, description, body]))
    book_title = normalize(book.get("title", ""))
    words = [normalize(token) for token in re.findall(r"[가-힣A-Za-z0-9]+", book.get("title", "")) if len(normalize(token)) >= 2]
    token_ratio = (sum(1 for token in words if token in combined) / len(words)) if words else 0
    exact_phrase = bool(book_title and book_title in combined)
    matched_terms = [term for term in answer_terms if normalize(term) in combined]
    metadata = normalize(" ".join([title, description]))
    metadata_hits = sum(1 for token in words if token in metadata)
    score = round(token_ratio * 65 + (20 if exact_phrase else 0) + min(15, metadata_hits * 5) + (10 if matched_terms else 0))
    if exact_phrase and matched_terms and token_ratio >= 0.6:
        status = "likely"
    elif matched_terms and token_ratio >= 0.4:
        status = "uncertain"
    else:
        status = "mismatch"
    return min(score, 100), status, ", ".join(matched_terms)


def discover_source_pages(source: dict[str, Any], config: dict[str, Any]) -> tuple[list[str], urllib.robotparser.RobotFileParser | None]:
    start_urls = source.get("start_urls") or []
    if not start_urls:
        return [], None
    parsed = [urlparse(url) for url in start_urls]
    allowed_hosts = {(item.hostname or "").lower() for item in parsed if item.hostname}
    if not allowed_hosts or any(item.scheme not in ("http", "https") for item in parsed):
        print(f"[경고] 올바른 http(s) start_urls가 없습니다: {source.get('publisher', '출처')}", file=sys.stderr)
        return [], None

    first_robots, robot_sitemaps = get_robots(start_urls[0])
    if first_robots is None:
        return [], None
    sitemap_candidates = robot_sitemaps + [
        urljoin(start_urls[0], "/sitemap.xml"),
        urljoin(start_urls[0], "/sitemap_index.xml"),
    ]
    max_urls = int(config.get("max_sitemap_urls_per_source", 500))
    pages = collect_sitemap_urls(sitemap_candidates, allowed_hosts, first_robots, max_urls)
    for url in start_urls:
        if same_host(url, allowed_hosts) and first_robots.can_fetch(USER_AGENT, url):
            pages.insert(0, url)
    return list(dict.fromkeys(pages))[: max_urls + len(start_urls)], first_robots


def main() -> int:
    parser = argparse.ArgumentParser(description="출판사 공식 사이트의 공개 페이지에서 답지 링크 후보 찾기")
    parser.add_argument("--input", required=True, help="교재 CSV 경로")
    parser.add_argument("--output", default="answer-link-candidates.csv", help="후보 CSV 출력 경로")
    parser.add_argument("--config", default="sources.json", help="출판사 출처 설정 JSON")
    parser.add_argument("--headed", action="store_true", help="Chromium 브라우저 창 표시")
    parser.add_argument("--max-pages", type=int, default=0, help="출처별 추가 페이지 제한(0이면 설정값 사용)")
    args = parser.parse_args()

    input_path = Path(args.input)
    config_path = Path(args.config)
    if not config_path.exists():
        example = Path(__file__).with_name("sources.example.json")
        raise SystemExit(f"설정 파일이 없습니다: {config_path}\n예시 파일을 복사하세요: {example}")

    books = read_csv(input_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    answer_terms = config.get("answer_keywords") or ANSWER_TERMS_DEFAULT
    delay = max(1.0, float(config.get("request_delay_seconds", 1.5)))
    timeout_ms = int(config.get("page_timeout_ms", 20000))
    candidates: dict[tuple[str, str], dict[str, str]] = {}

    print(f"교재 {len(books)}권을 읽었습니다. API 검색은 사용하지 않습니다.")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=not args.headed)
        context = browser.new_context(user_agent=USER_AGENT, locale="ko-KR")
        page = context.new_page()
        page.set_default_navigation_timeout(timeout_ms)

        for source in config.get("sources", []):
            publisher = (source.get("publisher") or "").strip()
            pages, robots = discover_source_pages(source, config)
            if args.max_pages > 0:
                pages = pages[:args.max_pages]
            if not pages or robots is None:
                print(f"[건너뜀] {publisher or '이름 없는 출처'}: 확인 가능한 공개 페이지가 없습니다.")
                continue
            allowed_hosts = {(urlparse(url).hostname or "").lower() for url in source.get("start_urls", [])}
            print(f"[탐색] {publisher}: 최대 {len(pages)}개 페이지")

            for index, url in enumerate(pages, start=1):
                if not same_host(url, allowed_hosts) or not robots.can_fetch(USER_AGENT, url):
                    continue
                try:
                    response = page.goto(url, wait_until="domcontentloaded")
                    if response and response.status >= 400:
                        continue
                    title, description, body = page_text(page)
                    combined = " ".join([title, description, body])
                    if not any(normalize(term) in normalize(combined) for term in answer_terms):
                        # A page may still link to a clearly-labelled resource page.
                        resource_links = page.locator("a[href]").evaluate_all(
                            """els => els.map(a => ({href: a.href, text: (a.innerText || a.getAttribute('aria-label') || '').trim()}))
                               .filter(x => /정답|해설|답지/.test(x.text + ' ' + x.href))"""
                        )
                    else:
                        resource_links = []

                    page_candidates = [(url, title, description, body)]
                    for link in resource_links[:10]:
                        target = link.get("href", "")
                        if same_host(target, allowed_hosts) and robots.can_fetch(USER_AGENT, target):
                            try:
                                page.goto(target, wait_until="domcontentloaded")
                                link_title, link_desc, link_body = page_text(page)
                                page_candidates.append((target, link_title, link_desc, link_body))
                            except Exception:
                                pass

                    for book in books:
                        book_publisher = normalize(book.get("publisher", ""))
                        source_publisher = normalize(publisher)
                        if book_publisher and source_publisher and book_publisher not in source_publisher and source_publisher not in book_publisher:
                            continue
                        for candidate_url, candidate_title, candidate_desc, candidate_body in page_candidates:
                            score, status, matched_terms = score_candidate(book, candidate_title, candidate_desc, candidate_body, answer_terms)
                            if status == "mismatch":
                                continue
                            key = (book["title"], candidate_url)
                            if key in candidates:
                                continue
                            host = urlparse(candidate_url).hostname or ""
                            candidates[key] = {
                                "book_id": book.get("id", ""),
                                "book_title": book.get("title", ""),
                                "publisher": book.get("publisher", publisher),
                                "subject": book.get("subject", ""),
                                "grade": book.get("grade", ""),
                                "semester": book.get("semester", ""),
                                "series": book.get("series", ""),
                                "candidate_title": candidate_title or host,
                                "url": candidate_url,
                                "source_name": host,
                                "source_type": "publisher_configured_domain",
                                "snippet": (candidate_desc or candidate_body)[:1200],
                                "match_score": str(score),
                                "match_status": status,
                                "matched_answer_terms": matched_terms,
                                "link_type": "PDF" if urlparse(candidate_url).path.lower().endswith(".pdf") else "웹페이지",
                            }
                except PlaywrightTimeoutError:
                    print(f"[시간 초과] {url}", file=sys.stderr)
                except Exception as exc:
                    print(f"[오류] {url}: {exc}", file=sys.stderr)
                if index % 25 == 0:
                    print(f"  진행 {index}/{len(pages)} · 후보 {len(candidates)}개")
                time.sleep(delay)

        context.close()
        browser.close()

    fieldnames = [
        "book_id", "book_title", "publisher", "subject", "grade", "semester", "series",
        "candidate_title", "url", "source_name", "source_type", "snippet",
        "match_score", "match_status", "matched_answer_terms", "link_type",
    ]
    output_path = Path(args.output)
    with output_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(candidates.values())

    print(f"완료: 후보 {len(candidates)}개 저장 → {output_path.resolve()}")
    print("후보는 자동 승인되지 않습니다. 실제 교재·판본과 답지 여부를 관리자 화면에서 확인하세요.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
