#!/usr/bin/env python3
"""Discover answer-link candidates from configured sites and public search result pages.
Search result access is best-effort; the crawler never bypasses robots, logins,
CAPTCHAs, paywalls, or other access controls.
"""
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import time
import urllib.robotparser
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse, urljoin, urlencode
from urllib.request import Request, urlopen
from urllib.error import HTTPError

if getattr(sys, "frozen", False):
    os.environ["PLAYWRIGHT_BROWSERS_PATH"] = str(Path(sys.executable).resolve().parent / "ms-playwright")

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
    try:
        text = fetch(robots_url).decode("utf-8", errors="replace")
    except HTTPError as exc:
        if exc.code in (404, 410):
            # RFC 9309: a missing robots file means no rules were published.
            text = ""
        else:
            raise
    parser.parse(text.splitlines())
    sitemaps = re.findall(r"(?im)^\s*sitemap:\s*(\S+)", text)
    return parser, sitemaps


def search_bing_rss(query: str, limit: int = 10):
    """Read publicly accessible Bing RSS search results; no API key is used."""
    url = "https://www.bing.com/search?" + urlencode({"q": query, "format": "rss", "count": str(limit)})
    root = ET.fromstring(fetch(url))
    results = []
    for item in root.iter():
        if item.tag.rsplit("}", 1)[-1].lower() != "item":
            continue
        fields = {child.tag.rsplit("}", 1)[-1].lower(): (child.text or "").strip() for child in item}
        link = fields.get("link", "")
        if link.startswith(("http://", "https://")):
            results.append({"url": link, "title": fields.get("title", ""), "snippet": fields.get("description", "")})
        if len(results) >= limit:
            break
    return results


def search_google_page(page, query: str, limit: int = 10):
    """Best-effort ordinary Google results-page reading; blocked pages are not bypassed."""
    url = "https://www.google.com/search?" + urlencode({"q": query, "num": str(limit), "hl": "ko"})
    response = page.goto(url, wait_until="domcontentloaded")
    if response and response.status >= 400:
        raise RuntimeError(f"Google 검색 응답 HTTP {response.status}")
    text = (page.locator("body").inner_text(timeout=5000) or "").lower()
    if any(word in text for word in ("unusual traffic", "자동화된 요청", "비정상적인 트래픽", "captcha")):
        raise RuntimeError("Google이 자동 검색 요청을 제한했습니다. 차단을 우회하지 않고 Google 검색은 건너뜁니다.")
    found = page.locator("a:has(h3)").evaluate_all("""els => els.map(a => ({
      url:a.href, title:(a.innerText||'').trim()
    })).filter(x => /^https?:/.test(x.url) &&
      !/(google\\.com|accounts\\.google|support\\.google|policies\\.google)/i.test(new URL(x.url).hostname) &&
      x.title.length > 2).slice(0, 30)""")
    results, seen = [], set()
    for item in found:
        target = item["url"].split("#", 1)[0]
        if target not in seen:
            seen.add(target)
            results.append({"url": target, "title": item["title"][:500], "snippet": ""})
        if len(results) >= limit:
            break
    return results


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
    web_cfg = config.get("web_search", {})
    web_enabled = bool(web_cfg.get("enabled", True))
    engines = web_cfg.get("engines", ["google", "bing"])
    if not sources and not web_enabled:
        raise ValueError("공식 자료실 또는 공개 웹 검색 중 하나 이상을 활성화하세요.")
    terms = config.get("answer_keywords") or ["정답과 해설", "정답 해설", "정답 및 해설", "답지"]
    delay = max(1.0, float(config.get("request_delay_seconds", 2.0)))
    timeout = int(config.get("page_timeout_ms", 20000))
    limit = max_pages_override or int(config.get("max_sitemap_urls_per_source", 500))
    search_limit = max(1, min(20, int(web_cfg.get("results_per_engine", 8))))
    candidates, robots_cache = {}, {}
    log(callback, f"교재 {len(books)}권 · 공식 출처 {len(sources)}곳 · 공개 검색엔진 {', '.join(engines) if web_enabled else '사용 안 함'}")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not headed)
        context = browser.new_context(user_agent=USER_AGENT, locale="ko-KR")
        page = context.new_page()
        page.set_default_navigation_timeout(timeout)

        def robots_for_target(target_url):
            parsed = urlparse(target_url)
            host_key = (parsed.scheme, parsed.netloc)
            if host_key not in robots_cache:
                try:
                    robots_cache[host_key] = robots_for(target_url)[0]
                except Exception as exc:
                    robots_cache[host_key] = None
                    log(callback, f"  [robots 확인 불가, 건너뜀] {parsed.netloc}: {exc}")
            return robots_cache[host_key]

        def add_candidate(book, target_url, title, snippet, source_label):
            score, status, matched = assess(book, title, snippet, terms)
            if status == "mismatch":
                return
            key = (book["title"], target_url)
            if key in candidates:
                if score > candidates[key]["match_score"]:
                    candidates[key]["match_score"] = score
                    candidates[key]["match_status"] = status
                return
            host = (urlparse(target_url).hostname or "").lower()
            candidates[key] = {
                "book_id": book.get("id", ""), "book_title": book.get("title", ""),
                "publisher": book.get("publisher", ""), "subject": book.get("subject", ""),
                "grade": book.get("grade", ""), "semester": book.get("semester", ""),
                "series": book.get("series", ""), "candidate_title": title or host,
                "url": target_url, "source_name": host, "source_type": source_label,
                "snippet": snippet[:1200], "match_score": score, "match_status": status,
                "matched_answer_terms": matched,
                "link_type": "PDF" if urlparse(target_url).path.lower().endswith(".pdf") else "웹페이지",
            }

        try:
            # Configured publisher resource pages and their sitemaps.
            for source in sources:
                publisher = (source.get("publisher") or "").strip()
                for start_url in source.get("start_urls") or []:
                    parsed = urlparse(start_url)
                    if parsed.scheme not in ("http", "https") or not parsed.hostname:
                        log(callback, f"[건너뜀] 올바르지 않은 URL: {start_url}")
                        continue
                    host = parsed.hostname.lower()
                    try:
                        robots, sitemaps = robots_for(start_url)
                    except Exception as exc:
                        log(callback, f"[건너뜀] robots.txt를 확인할 수 없음: {start_url} ({exc})")
                        continue
                    pages = collect_pages(start_url, robots, sitemaps, limit, callback)
                    log(callback, f"[공식 자료실 탐색] {publisher or host}: {len(pages)}개 공개 페이지")
                    for index, url in enumerate(pages, 1):
                        if not allowed_host(url, host) or not robots.can_fetch(USER_AGENT, url):
                            continue
                        try:
                            response = page.goto(url, wait_until="domcontentloaded")
                            if response and response.status >= 400:
                                continue
                            if not allowed_host(page.url, host):
                                continue
                            title, description, body = extract_page(page)
                            combined = " ".join([title, description, body])
                            links = []
                            if any(norm(term) in norm(combined) for term in terms):
                                links = page.locator("a[href]").evaluate_all(
                                    """els => els.map(a => ({href:a.href,text:(a.innerText||a.getAttribute('aria-label')||'').trim()}))
                                    .filter(x => /정답|해설|답지/i.test(x.text+' '+x.href)).slice(0,8)"""
                                )
                            targets = [(url, title, description or body)]
                            for link in links:
                                target = link.get("href", "")
                                if allowed_host(target, host) and robots.can_fetch(USER_AGENT, target):
                                    targets.append((target, link.get("text") or "정답과 해설", description or body))
                            for book in books:
                                bp, sp = norm(book.get("publisher", "")), norm(publisher)
                                if bp and sp and bp not in sp and sp not in bp:
                                    continue
                                for target, target_title, snippet in targets:
                                    add_candidate(book, target, target_title, snippet, "publisher")
                        except PlaywrightTimeoutError:
                            log(callback, f"[시간 초과] {url}")
                        except Exception as exc:
                            log(callback, f"[오류] {url}: {exc}")
                        if index % 20 == 0:
                            log(callback, f"  공식 자료실 진행 {index}/{len(pages)} · 후보 {len(candidates)}개")
                        time.sleep(delay)

            # Broad public-web discovery through ordinary Google/Bing result pages.
            if web_enabled:
                for book in books:
                    query = f'"{book["title"]}" (정답과 해설 OR 답지 OR 정답)'
                    results = []
                    if "bing" in engines:
                        try:
                            bing_results = search_bing_rss(query, search_limit)
                            results.extend(bing_results)
                            log(callback, f"[Bing] {book['title']}: 검색 결과 {len(bing_results)}개")
                        except Exception as exc:
                            log(callback, f"[Bing 검색 건너뜀] {book['title']}: {exc}")
                    if "google" in engines:
                        try:
                            google_results = search_google_page(page, query, search_limit)
                            results.extend(google_results)
                            log(callback, f"[Google] {book['title']}: 검색 결과 {len(google_results)}개")
                        except Exception as exc:
                            log(callback, f"[Google 검색 건너뜀] {book['title']}: {exc}")
                    seen_urls = set()
                    for item in results:
                        target = item.get("url", "").strip()
                        parsed = urlparse(target)
                        if parsed.scheme not in ("http", "https") or not parsed.hostname or target in seen_urls:
                            continue
                        seen_urls.add(target)
                        target_robots = robots_for_target(target)
                        if target_robots is None or not target_robots.can_fetch(USER_AGENT, target):
                            continue
                        title, snippet = item.get("title", ""), item.get("snippet", "")
                        try:
                            if not parsed.path.lower().endswith(".pdf"):
                                response = page.goto(target, wait_until="domcontentloaded")
                                if response and response.status >= 400:
                                    add_candidate(book, target, title, snippet, "web-search")
                                    continue
                                if (urlparse(page.url).hostname or "").lower() != parsed.hostname.lower():
                                    log(callback, f"  외부 리디렉션 건너뜀: {target}")
                                    continue
                                page_title, description, body = extract_page(page)
                                title = page_title or title
                                snippet = " ".join(x for x in [snippet, description, body[:2500]] if x)
                            add_candidate(book, target, title, snippet, "web-search")
                        except PlaywrightTimeoutError:
                            add_candidate(book, target, title, snippet, "web-search")
                        except Exception as exc:
                            log(callback, f"  [페이지 확인 실패] {target}: {exc}")
                        time.sleep(delay)
                    log(callback, f"[웹 검색 완료] {book['title']} · 누적 후보 {len(candidates)}개")
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
    parser = argparse.ArgumentParser(description="공식 자료실과 공개 웹 검색 결과에서 답지 링크 후보 탐색")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="answer-link-candidates.csv")
    parser.add_argument("--config", default="sources.json")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--max-pages", type=int, default=0)
    args = parser.parse_args()
    run_search(Path(args.input), Path(args.output), Path(args.config), args.headed, args.max_pages)


if __name__ == "__main__":
    main()
