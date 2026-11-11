#!/usr/bin/env python3
"""Local, API-free crawler for configured publisher websites.

It does not scrape Google/Naver result pages or bypass robots, logins,
CAPTCHAs, paywalls, or other access controls.
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
from typing import Callable
from urllib.parse import urlparse, urljoin
from urllib.request import Request, urlopen

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

USER_AGENT = "DapjiMoumLocalFinder/1.0 (+local user-run tool)"
ALIASES = {
    "id": ["id", "book_id", "교재 ID"],
    "title": ["title", "book_title", "교재명", "도서명", "책이름", "책 제목"],
    "publisher": ["publisher", "출판사", "발행사"],
    "subject": ["subject", "과목", "교과"],
    "grade": ["grade", "학년"],
    "semester": ["semester", "학기"],
    "series": ["series", "시리즈", "교재 시리즈"],
}
FIELDS = ["book_id", "book_title", "publisher", "subject", "grade", "semester", "series",
          "candidate_title", "url", "source_name", "source_type", "snippet",
          "match_score", "match_status", "matched_answer_terms", "link_type"]


def log(callback, message: str):
    callback(message)


def norm(value: str) -> str:
    return re.sub(r"[\s·ㆍ_\-–—()[\]{}:：,.]+", "", value or "").casefold()


def fetch(url: str, timeout: int = 15) -> bytes:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xml,text/xml,*/*"})
    with urlopen(req, timeout=timeout) as response:
        return response.read()


def read_books(path: Path) -> list[dict[str, str]]:
    error = None
    for encoding in ("utf-8-sig", "cp949", "utf-8"):
        try:
            with path.open("r", encoding=encoding, newline="") as handle:
                reader = csv.DictReader(handle)
                if not reader.fieldnames:
                    raise ValueError("CSV 헤더 행이 없습니다.")
                mapping = {}
                for key, aliases in ALIASES.items():
                    col = next((x for x in reader.fieldnames if x.strip().casefold() in {a.casefold() for a in aliases}), None)
                    if col:
                        mapping[key] = col
                if "title" not in mapping:
                    raise ValueError("CSV에 title 또는 교재명 열이 필요합니다.")
                result = []
                for raw in reader:
                    row = {key: (raw.get(col) or "").strip() for key, col in mapping.items()}
                    if row.get("title"):
                        result.append(row)
                return result
        except (UnicodeDecodeError, ValueError) as exc:
            error = exc
    raise ValueError(f"CSV 읽기 실패: {error}")


def robots_for(start_url: str):
    parsed = urlparse(start_url)
    robots_url = f"{parsed.scheme}://{parsed.netloc}/robots.txt"
    parser = urllib.robotparser.RobotFileParser()
    parser.set_url(robots_url)
    text = fetch(robots_url).decode("utf-8", errors="replace")
    parser.parse(text.splitlines())
    sitemaps = re.findall(r"(?im)^\s*sitemap:\s*(\S+)", text)
    return parser, sitemaps


def parse_sitemap(data: bytes):
    root = ET.fromstring(data)
    kind = root.tag.rsplit("}", 1)[-1].lower()
    urls = [(x.text or "").strip() for x in root.iter()
            if x.tag.rsplit("}", 1)[-1].lower() == "loc" and (x.text or "").strip()]
    return kind, urls


def allowed_host(url: str, host: str) -> bool:
    return (urlparse(url).hostname or "").lower() == host


def collect_pages(start_url: str, robots, sitemap_urls: list[str], limit: int, callback):
    host = (urlparse(start_url).hostname or "").lower()
    queue = list(dict.fromkeys(sitemap_urls + [urljoin(start_url, "/sitemap.xml"), urljoin(start_url, "/sitemap_index.xml")]))
    visited, pages = set(), []
    while queue and len(pages) < limit:
        sitemap = queue.pop(0)
        if sitemap in visited or not allowed_host(sitemap, host) or not robots.can_fetch(USER_AGENT, sitemap):
            continue
        visited.add(sitemap)
        try:
            kind, locations = parse_sitemap(fetch(sitemap))
        except Exception as exc:
            log(callback, f"  sitemap 건너뜀: {sitemap} ({exc})")
            continue
        if kind == "sitemapindex":
            queue.extend(x for x in locations if allowed_host(x, host))
        else:
            for item in locations:
                if allowed_host(item, host) and robots.can_fetch(USER_AGENT, item):
                    pages.append(item)
                    if len(pages) >= limit:
                        break
    if robots.can_fetch(USER_AGENT, start_url):
        pages.insert(0, start_url)
    return list(dict.fromkeys(pages))


def extract_page(page):
    title = (page.title() or "").strip()
    try:
        description = page.locator('meta[name="description"]').get_attribute("content", timeout=1500) or ""
    except Exception:
        description = ""
    try:
        body = page.locator("body").inner_text(timeout=3000)
    except Exception:
        body = ""
    return title[:500], description[:1200], re.sub(r"\s+", " ", body)[:8000]


def assess(book, title, snippet, terms):
    combined = norm(" ".join([title, snippet]))
    raw_tokens = re.findall(r"[가-힣A-Za-z0-9]+", book.get("title", ""))
    tokens = [norm(t) for t in raw_tokens if len(norm(t)) >= 2]
    ratio = sum(1 for token in tokens if token in combined) / len(tokens) if tokens else 0
    exact = bool(norm(book.get("title", "")) and norm(book["title"]) in combined)
    matched = [term for term in terms if norm(term) in combined]
    score = min(100, round(ratio * 65 + (20 if exact else 0) + (10 if matched else 0)))
    if exact and matched and ratio >= 0.6:
        status = "likely"
    elif matched and ratio >= 0.4:
        status = "uncertain"
    else:
        status = "mismatch"
    return score, status, ", ".join(matched)


def run_search(input_path: Path, output_path: Path, config_path: Path, headed: bool,
               max_pages_override: int, callback: Callable[[str], None] = print) -> int:
    books = read_books(input_path)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    sources = config.get("sources", [])
    if not sources:
        raise ValueError("sources.json에 탐색할 공식 자료실 주소를 한 곳 이상 추가하세요.")
    terms = config.get("answer_keywords") or ["정답과 해설", "정답 해설", "정답 및 해설", "답지"]
    delay = max(1.0, float(config.get("request_delay_seconds", 1.5)))
    timeout = int(config.get("page_timeout_ms", 20000))
    limit = max_pages_override or int(config.get("max_sitemap_urls_per_source", 500))
    candidates = {}
    log(callback, f"교재 {len(books)}권 · 출처 {len(sources)}곳 · 검색 API 사용 안 함")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        context = browser.new_context(user_agent=USER_AGENT, locale="ko-KR")
        page = context.new_page()
        page.set_default_navigation_timeout(timeout)
        try:
            for source in sources:
                publisher = (source.get("publisher") or "").strip()
                starts = source.get("start_urls") or []
                for start in starts:
                    parsed = urlparse(start)
                    if parsed.scheme not in ("http", "https") or not parsed.hostname:
                        log(callback, f"[건너뜀] 올바르지 않은 URL: {start}")
                        continue
                    host = parsed.hostname.lower()
                    try:
                        robots, sitemaps = robots_for(start)
                    except Exception as exc:
                        log(callback, f"[건너뜀] robots.txt를 확인할 수 없음: {start} ({exc})")
                        continue
                    pages = collect_pages(start, robots, sitemaps, limit, callback)
                    log(callback, f"[탐색] {publisher or host}: {len(pages)}개 공개 페이지")
                    for index, url in enumerate(pages, 1):
                        if not allowed_host(url, host) or not robots.can_fetch(USER_AGENT, url):
                            continue
                        try:
                            response = page.goto(url, wait_until="domcontentloaded")
                            if response and response.status >= 400:
                                continue
                            title, description, body = extract_page(page)
                            combined = " ".join([title, description, body])
                            resource_links = []
                            if any(norm(term) in norm(combined) for term in terms):
                                resource_links = page.locator("a[href]").evaluate_all(
                                    """els => els.map(a => ({href:a.href,text:(a.innerText||a.getAttribute('aria-label')||'').trim()}))
                                    .filter(x => /정답|해설|답지/.test(x.text+' '+x.href)).slice(0,8)"""
                                )
                            targets = [(url, title, description, body)]
                            for link in resource_links:
                                target = link.get("href", "")
                                if not allowed_host(target, host) or not robots.can_fetch(USER_AGENT, target):
                                    continue
                                try:
                                    page.goto(target, wait_until="domcontentloaded")
                                    t, d, b = extract_page(page)
                                    targets.append((target, t, d, b))
                                except Exception:
                                    continue

                            for book in books:
                                bp = norm(book.get("publisher", ""))
                                sp = norm(publisher)
                                if bp and sp and bp not in sp and sp not in bp:
                                    continue
                                for candidate_url, candidate_title, candidate_desc, candidate_body in targets:
                                    snippet = candidate_desc or candidate_body
                                    score, status, matched = assess(book, candidate_title, snippet, terms)
                                    if status == "mismatch":
                                        continue
                                    key = (book["title"], candidate_url)
                                    if key in candidates:
                                        continue
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
                                        "source_type": "unknown",
                                        "snippet": snippet[:1200],
                                        "match_score": score,
                                        "match_status": status,
                                        "matched_answer_terms": matched,
                                        "link_type": "PDF" if urlparse(candidate_url).path.lower().endswith(".pdf") else "웹페이지",
                                    }
                        except PlaywrightTimeoutError:
                            log(callback, f"[시간 초과] {url}")
                        except Exception as exc:
                            log(callback, f"[오류] {url}: {exc}")
                        if index % 20 == 0:
                            log(callback, f"  진행 {index}/{len(pages)} · 후보 {len(candidates)}개")
                        time.sleep(delay)
        finally:
            context.close()
            browser.close()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(candidates.values())
    log(callback, f"완료: 후보 {len(candidates)}개 → {output_path}")
    return len(candidates)


def main():
    parser = argparse.ArgumentParser(description="출판사 공식 공개 페이지에서 답지 후보 탐색")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="answer-link-candidates.csv")
    parser.add_argument("--config", default="sources.json")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--max-pages", type=int, default=0)
    args = parser.parse_args()
    run_search(Path(args.input), Path(args.output), Path(args.config), args.headed, args.max_pages)


if __name__ == "__main__":
    main()
