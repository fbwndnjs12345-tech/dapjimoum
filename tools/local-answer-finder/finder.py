#!/usr/bin/env python3
"""Discover answer-link candidates from configured publisher sites and official search APIs.
The crawler never bypasses robots, logins, CAPTCHAs, paywalls, or other access controls.
"""
from __future__ import annotations

import argparse
import csv
import html
from collections import OrderedDict, deque
import json
import ipaddress
import socket
import os
import re
import sys
import time
import urllib.robotparser
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Callable
from urllib.parse import urlparse, urljoin, urlencode, urlsplit, urlunsplit, parse_qsl
from urllib.request import Request, HTTPRedirectHandler, build_opener
from urllib.error import HTTPError

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

USER_AGENT = "DapjiMoumLocalFinder/2.3 (+local user-run tool)"
ALIASES = {
    "id": ["id", "book_id", "교재 ID"],
    "title": ["title", "book_title", "교재명", "도서명", "책이름", "책 제목"],
    "publisher": ["publisher", "출판사", "발행사"],
    "subject": ["subject", "과목", "교과"],
    "grade": ["grade", "학년"],
    "semester": ["semester", "학기"],
    "series": ["series", "시리즈", "교재 시리즈"],
    "edition": ["edition", "판본", "개정판", "쇄"],
    "curriculum_revision": ["curriculum_revision", "교육과정", "개정 교육과정"],
    "isbn13": ["isbn13", "isbn", "ISBN", "ISBN13"],
}
FIELDS = ["book_id", "book_title", "publisher", "subject", "grade", "semester", "series", "edition", "curriculum_revision", "isbn13",
          "candidate_title", "url", "source_name", "source_type", "snippet",
          "match_score", "match_status", "matched_answer_terms", "link_type", "search_query"]


def log(callback, message: str):
    callback(message)


def launch_browser(playwright, headless: bool):
    """Use an installed Windows browser instead of shipping a second 400MB browser."""
    errors = []
    for channel in ("msedge", "chrome"):
        try:
            return playwright.chromium.launch(channel=channel, headless=headless)
        except Exception as exc:
            errors.append(f"{channel}: {exc}")
    raise RuntimeError(
        "Microsoft Edge 또는 Google Chrome이 설치되어 있어야 합니다. "
        "Windows에 포함된 Edge를 먼저 실행해 업데이트한 뒤 다시 시도하세요. "
        + " | ".join(errors[-2:])
    )


def norm(value: str) -> str:
    return re.sub(r"[\s·ㆍ_\-–—()[\]{}:：,.]+", "", value or "").casefold()


def is_safe_public_url(value: str, resolve_dns: bool = False) -> bool:
    """Reject non-web schemes, credentials, local names and non-public DNS/IP targets."""
    try:
        parsed = urlsplit(value.strip())
        if parsed.scheme.lower() not in ("http", "https") or not parsed.hostname:
            return False
        if parsed.username or parsed.password:
            return False
        if parsed.port is not None and parsed.port not in (80, 443):
            return False
        host = parsed.hostname.rstrip(".").lower()
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal", ".test", ".invalid", ".example", ".onion")):
            return False
        try:
            address = ipaddress.ip_address(host)
            return address.is_global
        except ValueError:
            if not resolve_dns:
                return True
        if resolve_dns:
            port = parsed.port or (443 if parsed.scheme.lower() == "https" else 80)
            records = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
            addresses = {ipaddress.ip_address(record[4][0].split("%", 1)[0]) for record in records}
            return bool(addresses) and all(address.is_global for address in addresses)
        return True
    except (ValueError, TypeError, OSError):
        return False


class SafeRedirectHandler(HTTPRedirectHandler):
    def __init__(self, allowed_host: str | None = None):
        super().__init__()
        self.allowed_host = (allowed_host or "").lower().rstrip(".") or None

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_safe_public_url(newurl, resolve_dns=True):
            raise HTTPError(req.full_url, code, "Unsafe redirect target blocked", headers, fp)
        if self.allowed_host:
            redirected_host = (urlsplit(newurl).hostname or "").lower().rstrip(".")
            if redirected_host != self.allowed_host:
                raise HTTPError(req.full_url, code, "Cross-host redirect blocked", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url: str, timeout: int = 15, allowed_host: str | None = None,
          max_bytes: int = 10 * 1024 * 1024) -> bytes:
    if not is_safe_public_url(url, resolve_dns=True):
        raise ValueError("공개 HTTP(S) 주소만 요청할 수 있습니다.")
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xml,text/xml,*/*"})
    opener = build_opener(SafeRedirectHandler(allowed_host=allowed_host))
    with opener.open(req, timeout=timeout) as response:
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise ValueError(f"응답 크기가 제한을 초과했습니다 ({max_bytes} bytes).")
        return body


def fetch_json(url: str, headers: dict[str, str], timeout: int = 15,
              allowed_host: str | None = None, max_bytes: int = 5 * 1024 * 1024):
    if not is_safe_public_url(url, resolve_dns=True):
        raise ValueError("공개 HTTP(S) API 주소만 요청할 수 있습니다.")
    request_headers = {"User-Agent": USER_AGENT, "Accept": "application/json"}
    request_headers.update(headers)
    req = Request(url, headers=request_headers)
    opener = build_opener(SafeRedirectHandler(allowed_host=allowed_host))
    with opener.open(req, timeout=timeout) as response:
        body = response.read(max_bytes + 1)
        if len(body) > max_bytes:
            raise ValueError(f"API 응답 크기가 제한을 초과했습니다 ({max_bytes} bytes).")
    return json.loads(body.decode("utf-8"))


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
        text = fetch(robots_url, allowed_host=parsed.hostname).decode("utf-8", errors="replace")
    except HTTPError as exc:
        if exc.code in (404, 410):
            # RFC 9309: a missing robots file means no rules were published.
            text = ""
        else:
            raise
    parser.parse(text.splitlines())
    sitemaps = re.findall(r"(?im)^\s*sitemap:\s*(\S+)", text)
    return parser, sitemaps


def search_kakao_api(query: str, engine: str, api_key: str, limit: int = 10):
    """Use Kakao's documented REST search APIs; never scrape blocked search result pages."""
    endpoints = {
        "kakao_web": "https://dapi.kakao.com/v2/search/web",
        "kakao_blog": "https://dapi.kakao.com/v2/search/blog",
        "kakao_cafe": "https://dapi.kakao.com/v2/search/cafe",
    }
    endpoint = endpoints.get(engine)
    if not endpoint:
        raise ValueError(f"지원하지 않는 검색 제공자: {engine}")
    url = endpoint + "?" + urlencode({
        "query": query,
        "size": str(max(1, min(50, limit))),
        "sort": "accuracy",
    })
    payload = fetch_json(url, {"Authorization": "KakaoAK " + api_key},
                         allowed_host="dapi.kakao.com")
    results = []
    for document in payload.get("documents", []):
        target = str(document.get("url") or "").strip()
        if not target or not target.startswith(("https://", "http://")):
            continue
        title = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(document.get("title") or "")))).strip()
        snippet = re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", str(document.get("contents") or "")))).strip()
        results.append({"url": target, "title": title, "snippet": snippet})
    return results


def build_queries(book: dict[str, str], max_queries: int = 8) -> list[str]:
    """Build combined, book-specific queries rather than searching generic fragments."""
    title = (book.get("title") or "").strip()
    if not title:
        return []

    series = (book.get("series") or "").strip()
    publisher = (book.get("publisher") or "").strip()
    subject = (book.get("subject") or "").strip()
    grade = (book.get("grade") or "").strip()
    semester = (book.get("semester") or "").strip()

    # Keep the edition in the query even when the CSV metadata is incomplete.
    edition_match = re.search(r"(?<![0-9])([1-3])\s*[-–]\s*([12])(?![0-9])", title)
    edition = f"{edition_match.group(1)}-{edition_match.group(2)}" if edition_match else ""
    edition = (book.get("edition") or edition).strip()
    curriculum = (book.get("curriculum_revision") or "").strip()
    isbn = re.sub(r"[^0-9Xx]", "", book.get("isbn13") or "")
    identity = [x for x in (series, subject, grade, semester, edition, curriculum, isbn) if x]
    identity = list(dict.fromkeys(identity))
    full_identity = " ".join(identity) if identity else title
    publisher_identity = " ".join(x for x in (publisher, *identity) if x)
    platform_clause = "블로그 카페 웹문서"

    # Each query combines the distinctive book identity with answer intent.
    # Platform-restricted searches are separate so one large OR expression
    # cannot cause the search engine to silently ignore individual platforms.
    variants = [
        f'"{title}" "답지"',
        f'"{publisher_identity}" "정답과 해설"' if publisher else f'"{full_identity}" "정답과 해설"',
        f'"{title}" {publisher_identity} {platform_clause} 답지',
        f'"{full_identity}" "정답" "해설"',
        f'"{title}" "정답과 해설"',
        f'"{full_identity}" site:tistory.com 답지',
        f'"{full_identity}" site:blog.naver.com 답지',
        f'"{full_identity}" site:blogspot.com 답지',
        f'"{full_identity}" site:cafe.naver.com 답지',
    ]
    result = []
    for query in variants:
        query = " ".join(query.split())
        if query and query not in result:
            result.append(query)
        if len(result) >= max(1, min(10, max_queries)):
            break
    return result

def canonicalize_url(value: str) -> str:
    if not is_safe_public_url(value):
        raise ValueError("안전하지 않은 URL은 후보로 등록할 수 없습니다.")
    parts=urlsplit(value.strip())
    query=[(k,v) for k,v in parse_qsl(parts.query,keep_blank_values=True)
           if not k.lower().startswith("utm_") and k.lower() not in {"fbclid","gclid","ref","ref_src"}]
    query.sort(key=lambda pair: (pair[0].casefold(), pair[1]))
    scheme = parts.scheme.lower()
    host = (parts.hostname or "").lower()
    port = parts.port
    netloc = host if port is None or (scheme == "https" and port == 443) or (scheme == "http" and port == 80) else f"{host}:{port}"
    return urlunsplit((scheme,netloc,parts.path or "/",urlencode(query),""))


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
    queue = deque(dict.fromkeys(sitemap_urls + [urljoin(start_url, "/sitemap.xml"), urljoin(start_url, "/sitemap_index.xml")]))
    visited, pages = set(), []
    while queue and len(pages) < limit:
        sitemap = queue.popleft()
        if sitemap in visited or not allowed_host(sitemap, host) or not robots.can_fetch(USER_AGENT, sitemap):
            continue
        visited.add(sitemap)
        try:
            kind, locations = parse_sitemap(fetch(sitemap, allowed_host=host))
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
    """Require book-specific identity and answer evidence; generic check/icon pages must fail."""
    page_title = str(title or "")
    evidence = str(snippet or "")
    raw = page_title + " " + evidence
    combined = norm(raw)
    title_norm = norm(book.get("title", ""))
    series = norm(book.get("series", ""))
    subject = norm(book.get("subject", ""))
    publisher = norm(book.get("publisher", ""))
    grade = norm(book.get("grade", ""))
    semester = norm(book.get("semester", ""))

    # A distinctive series name must appear as a complete normalized string.
    # This rejects generic "체크", check-mark emoji, and unrelated icon pages for "체크체크".
    series_hit = bool(series and series in combined)
    subject_hit = bool(subject and subject in combined)
    publisher_hit = bool(publisher and publisher in combined)
    grade_hit = bool(grade and grade in combined)
    semester_hit = bool(semester and semester in combined)

    expected_pair = re.search(r"(?<![0-9])([1-3])\s*[-–]\s*([12])(?![0-9])", book.get("title", ""))
    actual_pairs = set(re.findall(r"(?<![0-9])([1-3])\s*[-–]\s*([12])(?![0-9])", raw))
    edition_hit = bool(expected_pair and expected_pair.groups() in actual_pairs)
    edition_conflict = bool(expected_pair and actual_pairs and expected_pair.groups() not in actual_pairs)

    expected_grade = re.search(r"중\s*([1-3])", book.get("grade", ""))
    actual_grades = set(re.findall(r"중\s*([1-3])", raw))
    if expected_grade and actual_grades and expected_grade.group(1) not in actual_grades:
        edition_conflict = True
    expected_semester = re.search(r"([12])\s*학기", book.get("semester", ""))
    actual_semesters = set(re.findall(r"([12])\s*학기", raw))
    if expected_semester and actual_semesters and expected_semester.group(1) not in actual_semesters:
        edition_conflict = True

    expected_years = set(re.findall(r"20(?:15|22)", " ".join((book.get("edition", ""), book.get("curriculum_revision", "")))))
    actual_years = set(re.findall(r"20(?:15|22)", raw))
    if expected_years and actual_years and not (expected_years & actual_years):
        edition_conflict = True
    expected_isbn = re.sub(r"[^0-9Xx]", "", book.get("isbn13", ""))
    actual_isbns = set(re.findall(r"(?<![0-9])[0-9]{13}(?![0-9])", raw))
    if expected_isbn and actual_isbns and expected_isbn not in actual_isbns:
        edition_conflict = True

    answer_signal = any(word in combined for word in ("정답", "해설", "답지"))
    matched = [term for term in terms if norm(term) and norm(term) in combined]
    tokens = [norm(token) for token in re.findall(r"[가-힣A-Za-z]+|[0-9]+", book.get("title", ""))
              if norm(token) and norm(token) not in {"중등", "중학", "중학교", "교재"}]
    token_hits = sum(1 for token in tokens if token in combined)
    ratio = token_hits / len(tokens) if tokens else 0.0
    exact_title = bool(title_norm and title_norm in combined)

    # Do not accept a candidate based only on a generic word such as "체크".
    # When the CSV supplies series/subject/edition, all are required for a match.
    identity_ok = True
    if series:
        identity_ok = identity_ok and series_hit
    if subject:
        identity_ok = identity_ok and subject_hit
    if expected_pair:
        # If no edition is stated on the result, keep it for manual review only.
        # A different explicit edition remains a hard mismatch above.
        identity_ok = identity_ok and (edition_hit or not actual_pairs)
    elif grade:
        identity_ok = identity_ok and grade_hit

    score = round(ratio * 30 + (30 if exact_title else 0) + (25 if answer_signal else 0)
                  + (8 if series_hit else 0) + (6 if subject_hit else 0)
                  + (3 if publisher_hit else 0) + (2 if grade_hit else 0)
                  + (1 if semester_hit else 0) + (5 if edition_hit else 0))
    if edition_conflict:
        score -= 50
    score = max(0, min(100, score))

    if edition_conflict or not identity_ok or not answer_signal:
        status = "mismatch"
    elif (score >= 75 and (exact_title or (series_hit and subject_hit and edition_hit)) and
              all(not (book.get(key) or "").strip() or norm(book.get(key, "")) in combined
                  for key in ("edition", "curriculum_revision", "isbn13"))):
        status = "likely"
    elif score >= 60 and series_hit and subject_hit and (edition_hit or not expected_pair):
        status = "uncertain"
    elif (not edition_conflict and answer_signal and token_hits >= 2
          and (not series or series_hit) and (not subject or subject_hit)):
        # Missing edition evidence may be shown for manual review, never as likely.
        status = "uncertain"
    else:
        status = "mismatch"
    return score, status, ", ".join(matched or (["답지/정답/해설"] if answer_signal else []))


def _csv_safe(value):
    text = "" if value is None else str(value)
    if text.startswith(("=", "+", "-", "@", "\t", "\r")):
        return "'" + text
    return text


def _write_candidates(output_path: Path, candidates: dict):
    """Write a complete checkpoint and atomically replace the last valid CSV."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = output_path.with_name(output_path.name + ".tmp")
    rows = sorted(candidates.values(), key=lambda row: (-int(row["match_score"]), row["book_title"]))
    try:
        with temporary_path.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=FIELDS)
            writer.writeheader()
            writer.writerows({key: _csv_safe(value) for key, value in row.items()} for row in rows)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, output_path)
    finally:
        try:
            temporary_path.unlink(missing_ok=True)
        except OSError:
            pass


def run_search(input_path: Path, output_path: Path, config_path: Path, headed: bool,
               max_pages_override: int, callback: Callable[[str], None] = print, stop_event=None,
               provider_credentials: dict | None = None) -> int:
    books=read_books(input_path); config=json.loads(config_path.read_text(encoding="utf-8"))
    sources=config.get("sources",[]); web_cfg=config.get("web_search",{})
    web_enabled=bool(web_cfg.get("enabled",True)); engines=web_cfg.get("engines",["kakao_web","kakao_blog","kakao_cafe"])
    if not sources and not web_enabled: raise ValueError("공식 자료실 또는 공식 검색 API 중 하나 이상을 활성화하세요.")
    terms=config.get("answer_keywords") or ["정답과 해설","정답 해설","정답 및 해설","답지"]
    delay=max(1.0,float(config.get("request_delay_seconds",2.0))); timeout=int(config.get("page_timeout_ms",20000))
    limit=max_pages_override or int(config.get("max_sitemap_urls_per_source",500))
    allowed_engines = {"kakao_web", "kakao_blog", "kakao_cafe"}
    legacy_engines = [engine for engine in engines if engine in ("google", "bing")]
    if legacy_engines:
        log(callback, "[검색 정책] Google/Bing 검색 결과 HTML 수집은 robots.txt에서 /search가 차단되거나 API가 종료되어 사용하지 않습니다.")
    engines = [engine for engine in engines if engine in allowed_engines]
    unsupported = [engine for engine in web_cfg.get("engines", []) if engine not in allowed_engines and engine not in ("google", "bing")]
    if unsupported:
        log(callback, f"[지원하지 않는 검색 제공자 제외] {', '.join(unsupported)}")
    search_limit=max(1,min(50,int(web_cfg.get("results_per_engine",8))))
    credentials = provider_credentials or {}
    kakao_api_key = (credentials.get("kakao_rest_api_key") or os.environ.get("KAKAO_REST_API_KEY", "")).strip()
    if web_enabled and not kakao_api_key:
        log(callback, "[검색 API 키 없음] Kakao REST API 키를 입력하지 않아 공식 검색 API는 실행하지 않습니다. 공식 자료실 탐색은 계속합니다.")
    if not sources and not (web_enabled and kakao_api_key and engines):
        raise ValueError("공식 자료실이 없고 Kakao 검색 API 키도 없습니다. 자료실을 설정하거나 API 키를 입력하세요.")
    query_limit=max(1,min(10,int(web_cfg.get("max_queries_per_book",8))))
    candidates={}; robots_cache=OrderedDict(); page_content_cache=OrderedDict(); search_result_cache=OrderedDict()
    checkpoint_every = max(25, min(1000, int(config.get("checkpoint_every_candidates", 50))))
    early_stop_likely = max(1, min(10, int(web_cfg.get("early_stop_likely_candidates_per_book", 3))))
    max_candidates_per_book = max(1, min(50, int(web_cfg.get("max_candidates_per_book", 5))))
    candidate_counts = {}
    last_checkpoint = time.monotonic()
    log(callback,f"교재 {len(books)}권 · 공식 출처 {len(sources)}곳 · 공개 검색엔진 {', '.join(engines) if web_enabled else '사용 안 함'}")
    log(callback,f"검색 전략: 교재당 최대 {query_limit}개 검색어 · 엔진별 검색 결과 최대 {search_limit}개")
    with sync_playwright() as p:
        browser=launch_browser(p, headless=not headed); context=browser.new_context(locale="ko-KR", service_workers="block", accept_downloads=False)
        page=context.new_page(); page.set_default_navigation_timeout(timeout); page.set_default_timeout(8000)
        if headed:
            page.set_content("""<!doctype html><html lang="ko"><meta charset="utf-8"><title>답지모음 탐색 준비 중</title>
            <style>body{font-family:'Malgun Gothic','Segoe UI',sans-serif;background:#f4f6fa;color:#172033;margin:0;padding:48px}
            main{max-width:760px;margin:8vh auto;background:white;border:1px solid #e2e7ef;border-radius:18px;padding:36px;box-shadow:0 12px 36px #17203312}
            h1{font-size:26px;margin:0 0 12px}p{font-size:16px;line-height:1.7;color:#5d687a}</style>
            <main><h1>답지모음 로컬 탐색기</h1><p>검색 작업을 준비하고 있습니다. 접근 정책과 공개 검색 결과를 확인한 뒤 대상 페이지로 이동합니다.</p></main></html>""")
        navigation_host_guard = None
        dns_safety_cache = OrderedDict()
        def guard_browser_request(route):
            request_url = route.request.url
            parsed_request = urlparse(request_url)
            if parsed_request.scheme in ("data", "blob", "about"):
                route.continue_()
                return
            if route.request.resource_type in ("image", "media", "font"):
                route.abort("blockedbyclient")
                return
            navigation = route.request.is_navigation_request()
            host_key = (parsed_request.hostname or "").lower()
            cached_dns = dns_safety_cache.get(host_key)
            if cached_dns is None or cached_dns[0] <= time.monotonic():
                dns_safety_cache[host_key] = (time.monotonic() + 60, is_safe_public_url(request_url, resolve_dns=True))
            dns_safety_cache.move_to_end(host_key)
            while len(dns_safety_cache) > 2000:
                dns_safety_cache.popitem(last=False)
            safe = dns_safety_cache[host_key][1] and is_safe_public_url(request_url, resolve_dns=False)
            if not safe:
                log(callback, f"[비공개/로컬 네트워크 요청 차단] {request_url[:200]}")
                route.abort("blockedbyclient")
                return
            if navigation and navigation_host_guard:
                host = (urlparse(request_url).hostname or "").lower()
                if host != navigation_host_guard:
                    log(callback, f"[동일 호스트 외부 리디렉션 차단] {request_url[:200]}")
                    route.abort("blockedbyclient")
                    return
            policy = robots_for_target(request_url)
            if policy is None or not policy.can_fetch(USER_AGENT, request_url):
                log(callback, f"[robots 정책으로 탐색 차단] {request_url[:200]}")
                route.abort("blockedbyclient")
                return
            route.continue_()
        page.route("**/*", guard_browser_request)
        def remember_cache(cache, key, value, max_items):
            cache[key] = value
            cache.move_to_end(key)
            while len(cache) > max_items:
                cache.popitem(last=False)
        def robots_for_target(target):
            parsed=urlparse(target); key=(parsed.scheme,parsed.netloc)
            if key not in robots_cache:
                try: robots_cache[key]=robots_for(target)[0]
                except Exception as exc:
                    robots_cache[key]=None; log(callback,f"  [robots 확인 불가, 안전상 건너뜀] {parsed.netloc}: {exc}")
            else:
                robots_cache.move_to_end(key)
            while len(robots_cache) > 2000:
                robots_cache.popitem(last=False)
            return robots_cache[key]
        def add_candidate(book,target,title,snippet,source_label,query=""):
            target=canonicalize_url(target); score,status,matched=assess(book,title,snippet,terms)
            if status=="mismatch": return
            parsed=urlparse(target); host=(parsed.hostname or "").lower()
            blog_domains = ("tistory.com", "blog.naver.com", "blogspot.com", "brunch.co.kr", "velog.io", "wordpress.com", "cafe.naver.com")
            if any(host == domain or host.endswith("." + domain) for domain in blog_domains):
                source_label = "blog-search"
            # Search snippets do not prove PDF contents. Keep PDF hits review-only.
            if parsed.path.lower().endswith(".pdf") and status == "likely":
                status = "uncertain"
                score = min(score, 59)
            book_key = book.get("id") or book["title"]
            key=(book_key,target)
            if key not in candidates and candidate_counts.get(book_key, 0) >= max_candidates_per_book:
                return
            row={"book_id":book.get("id",""),"book_title":book.get("title",""),"publisher":book.get("publisher",""),
                 "subject":book.get("subject",""),"grade":book.get("grade",""),"semester":book.get("semester",""),
                 "series":book.get("series",""),"edition":book.get("edition",""),"curriculum_revision":book.get("curriculum_revision",""),"isbn13":book.get("isbn13",""),"candidate_title":title or host,"url":target,"source_name":host,
                 "source_type":source_label,"snippet":str(snippet or "")[:1200],"match_score":score,
                 "match_status":status,"matched_answer_terms":matched,
                 "link_type":"PDF" if parsed.path.lower().endswith(".pdf") else "웹페이지","search_query":query}
            if key not in candidates or score>int(candidates[key].get("match_score",0)):
                if key not in candidates:
                    candidate_counts[book_key] = candidate_counts.get(book_key, 0) + 1
                candidates[key]=row
                nonlocal last_checkpoint
                now = time.monotonic()
                if len(candidates) % checkpoint_every == 0 or now - last_checkpoint >= 30:
                    try:
                        _write_candidates(output_path, candidates)
                        last_checkpoint = now
                        log(callback, f"  [체크포인트 저장] 후보 {len(candidates)}개")
                    except OSError as exc:
                        log(callback, f"  [체크포인트 저장 실패] {exc}")
        try:
            for source in sources:
                if stop_event is not None and stop_event.is_set(): break
                publisher=(source.get("publisher") or "").strip()
                for start_url in source.get("start_urls") or []:
                    parsed=urlparse(start_url)
                    if not is_safe_public_url(start_url, resolve_dns=True):
                        log(callback,f"[건너뜀] 올바르지 않은 URL: {start_url}"); continue
                    host=parsed.hostname.lower()
                    try: robots,sitemaps=robots_for(start_url)
                    except Exception as exc:
                        log(callback,f"[건너뜀] robots.txt를 확인할 수 없음: {start_url} ({exc})"); continue
                    pages=collect_pages(start_url,robots,sitemaps,limit,callback)
                    source_books = []
                    for candidate_book in books:
                        book_publisher = norm(candidate_book.get("publisher", ""))
                        source_publisher = norm(publisher)
                        if not book_publisher or not source_publisher or book_publisher in source_publisher or source_publisher in book_publisher:
                            source_books.append(candidate_book)
                    log(callback,f"[공식 자료실 탐색] {publisher or host}: {len(pages)}개 공개 페이지 · 대상 교재 {len(source_books)}권")
                    for index,url in enumerate(pages,1):
                        if stop_event is not None and stop_event.is_set(): break
                        if not allowed_host(url,host) or not robots.can_fetch(USER_AGENT,url): continue
                        try:
                            navigation_host_guard = host
                            try:
                                response=page.goto(url,wait_until="domcontentloaded", timeout=timeout)
                            finally:
                                navigation_host_guard = None
                            if response and response.status>=400: continue
                            if not allowed_host(page.url,host) or not is_safe_public_url(page.url, resolve_dns=True): continue
                            final_robots = robots_for_target(page.url)
                            if final_robots is None or not final_robots.can_fetch(USER_AGENT, page.url): continue
                            title,description,body=extract_page(page); combined=" ".join([title,description,body])
                            remember_cache(page_content_cache, canonicalize_url(page.url), (title, description, body), 1000)
                            links=page.locator("a[href]").evaluate_all("""els => els.map(a => ({
                              href:a.href,text:(a.innerText||a.getAttribute('aria-label')||'').trim()
                            })).filter(x => /정답|해설|답지|pdf/i.test(x.text+' '+x.href)).slice(0,20)""")
                            targets=[]
                            if any(norm(term) in norm(combined) for term in terms): targets.append((url,title," ".join([description,body])))
                            for link in links:
                                target=link.get("href","")
                                if allowed_host(target,host) and robots.can_fetch(USER_AGENT,target):
                                    targets.append((target,link.get("text") or "정답과 해설"," ".join([description,body])))
                            for book in source_books:
                                for target,target_title,snippet in targets:
                                    add_candidate(book,target,target_title,snippet,"publisher")
                        except PlaywrightTimeoutError: log(callback,f"[시간 초과] {url}")
                        except Exception as exc: log(callback,f"[오류] {url}: {exc}")
                        if index == 1 or index % 10 == 0 or index == len(pages):
                            log(callback, f"[진행] {index}/{len(pages)} · {publisher or host} 자료실 · 후보 {len(candidates)}개")
                        time.sleep(delay)
            if web_enabled and kakao_api_key and engines and not (stop_event is not None and stop_event.is_set()):
                blocked_engines = set()
                for book_index, book in enumerate(books, 1):
                    if stop_event is not None and stop_event.is_set(): break
                    log(callback, f"[진행] {book_index}/{len(books)} · {book['title']}")
                    queries=build_queries(book,query_limit); log(callback,f"[검색어 구성] {book['title']}: {len(queries)}개")
                    seen_urls=set()
                    for qi,query in enumerate(queries,1):
                        if stop_event is not None and stop_event.is_set(): break
                        results=[]
                        for engine in engines:
                            if engine in blocked_engines:
                                continue
                            cache_key = (engine, query, search_limit)
                            try:
                                if cache_key in search_result_cache:
                                    got = search_result_cache[cache_key]
                                    search_result_cache.move_to_end(cache_key)
                                    log(callback, f"[{engine} 캐시] {len(got)}개 재사용")
                                else:
                                    got=search_kakao_api(query,engine,kakao_api_key,search_limit)
                                    remember_cache(search_result_cache, cache_key, got, 2000)
                                results.extend(got)
                                log(callback,f"[{engine} {qi}/{len(queries)}] {len(got)}개 · {query}")
                            except HTTPError as exc:
                                log(callback,f"[{engine} API 실패] HTTP {exc.code}: {exc.reason}")
                                if exc.code in (401,403,429):
                                    blocked_engines.add(engine)
                                    log(callback,f"[{engine} 중단] 인증·권한·쿼터 응답으로 이번 실행의 해당 검색 경로를 중단합니다.")
                            except Exception as exc:
                                log(callback,f"[{engine} API 실패] {type(exc).__name__}: {exc}")
                        for item in results:
                            if stop_event is not None and stop_event.is_set(): break
                            raw=item.get("url","").strip(); parsed=urlparse(raw)
                            if not is_safe_public_url(raw):
                                log(callback, f"[안전하지 않은 URL 제외] {raw[:200]}"); continue
                            target=canonicalize_url(raw)
                            if target in seen_urls: continue
                            seen_urls.add(target); policy=robots_for_target(target)
                            if policy is None or not policy.can_fetch(USER_AGENT,target): continue
                            title=item.get("title",""); snippet=item.get("snippet","")
                            try:
                                if parsed.path.lower().endswith(".pdf"):
                                    add_candidate(book,target,title,snippet,"web-search",query); continue
                                cached = page_content_cache.get(target)
                                if cached is not None:
                                    page_content_cache.move_to_end(target)
                                fetched_now = False
                                if cached is None:
                                    navigation_host_guard = (urlparse(target).hostname or "").lower()
                                    try:
                                        response=page.goto(target,wait_until="domcontentloaded", timeout=timeout)
                                    finally:
                                        navigation_host_guard = None
                                    if response and response.status>=400:
                                        log(callback,f"  [HTTP {response.status}, 검증 제외] {target}"); continue
                                    final_url = canonicalize_url(page.url)
                                    if (urlparse(final_url).hostname or "").lower()!=parsed.hostname.lower():
                                        log(callback,f"  외부 리디렉션 건너뜀: {target}"); continue
                                    final_policy = robots_for_target(final_url)
                                    if final_policy is None or not final_policy.can_fetch(USER_AGENT, final_url):
                                        log(callback,f"  [리디렉션 최종 주소 robots 차단] {final_url}"); continue
                                    pt,desc,body=extract_page(page)
                                    remember_cache(page_content_cache, target, (pt, desc, body), 1000)
                                    remember_cache(page_content_cache, final_url, (pt, desc, body), 1000)
                                    target = final_url
                                    seen_urls.add(final_url)
                                    fetched_now = True
                                else:
                                    pt,desc,body = cached
                                verified=" ".join(x for x in (title,snippet,desc,body) if x)
                                add_candidate(book,target,pt or title,verified,"web-search",query)
                                if fetched_now:
                                    time.sleep(delay)
                            except PlaywrightTimeoutError: log(callback,f"  [시간 초과, 검증 제외] {target}")
                            except Exception as exc: log(callback,f"  [페이지 확인 실패] {target}: {exc}")
                        likely_for_book = sum(1 for row in candidates.values()
                            if (row.get("book_id") or row.get("book_title")) == (book.get("id") or book.get("title"))
                            and row.get("match_status") == "likely")
                        if likely_for_book >= early_stop_likely:
                            log(callback, f"[조기 종료] {book['title']}: likely 후보 {likely_for_book}개 확보")
                            break
                        time.sleep(delay)
                    likely_for_book = sum(1 for row in candidates.values()
                        if (row.get("book_id") or row.get("book_title")) == (book.get("id") or book.get("title"))
                        and row.get("match_status") == "likely")
                    if likely_for_book >= early_stop_likely:
                        log(callback, f"[조기 종료] {book['title']}: likely 후보 {likely_for_book}개 확보")
                    log(callback,f"[웹 검색 완료] {book['title']} · 누적 후보 {len(candidates)}개")
        finally:
            # Persist all collected candidates even when navigation or parsing raises.
            try:
                output_path.parent.mkdir(parents=True, exist_ok=True)
                _write_candidates(output_path, candidates)
                log(callback, f"[최종 체크포인트 저장] 후보 {len(candidates)}개")
            except Exception as save_error:
                log(callback, f"[최종 체크포인트 저장 실패] {save_error}")
            try:
                context.close()
            finally:
                browser.close()
    output_path.parent.mkdir(parents=True,exist_ok=True)
    _write_candidates(output_path, candidates)
    if stop_event is not None and stop_event.is_set():
        log(callback,f"중지됨: 현재까지의 후보 {len(candidates)}개를 저장했습니다 → {output_path}")
    else:
        log(callback,f"완료: 후보 {len(candidates)}개 → {output_path}")
    return len(candidates)


def main():
    parser = argparse.ArgumentParser(description="공식 자료실과 Kakao 검색 API에서 답지 링크 후보 탐색")
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", default="answer-link-candidates.csv")
    parser.add_argument("--config", default="sources.json")
    parser.add_argument("--headed", action="store_true")
    parser.add_argument("--max-pages", type=int, default=0)
    args = parser.parse_args()
    run_search(Path(args.input), Path(args.output), Path(args.config), args.headed, args.max_pages)


if __name__ == "__main__":
    main()
