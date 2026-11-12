#!/usr/bin/env python3
"""Discover answer-link candidates from configured sites and public search result pages.
Search result access is best-effort; the crawler never bypasses robots, logins,
CAPTCHAs, paywalls, or other access controls.
"""
from __future__ import annotations

import argparse
import csv
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
          "match_score", "match_status", "matched_answer_terms", "link_type", "search_query"]


def log(callback, message: str):
    callback(message)


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
        host = parsed.hostname.rstrip(".").lower()
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
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
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if not is_safe_public_url(newurl, resolve_dns=True):
            raise HTTPError(req.full_url, code, "Unsafe redirect target blocked", headers, fp)
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def fetch(url: str, timeout: int = 15) -> bytes:
    if not is_safe_public_url(url, resolve_dns=True):
        raise ValueError("공개 HTTP(S) 주소만 요청할 수 있습니다.")
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xml,text/xml,*/*"})
    opener = build_opener(SafeRedirectHandler())
    with opener.open(req, timeout=timeout) as response:
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


def search_google_page(page, query: str, limit: int = 10, allow_manual: bool = False,
                      callback: Callable[[str], None] = print, challenge_timeout: int = 180):
    """Read Google results. If visible, let the user solve a challenge manually."""
    url = "https://www.google.com/search?" + urlencode({"q": query, "num": str(limit), "hl": "ko"})
    log(callback, f"[Google 접속] {url}")
    try:
        response = page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except PlaywrightTimeoutError as exc:
        raise RuntimeError(f"Google 페이지 이동 시간 초과: {page.url or 'about:blank'} ({exc})") from exc
    except Exception as exc:
        raise RuntimeError(f"Google 페이지 이동 실패: {type(exc).__name__}: {exc}; 현재 주소={page.url or 'about:blank'}") from exc
    if page.url == "about:blank":
        raise RuntimeError("Google 페이지 이동 후에도 about:blank입니다. Chromium 네트워크/프록시 설정을 확인하세요.")
    if response and response.status >= 400:
        raise RuntimeError(f"Google 검색 응답 HTTP {response.status}")
    def page_text():
        try: return (page.locator("body").inner_text(timeout=3000) or "").lower()
        except Exception: return ""
    def challenged(text: str) -> bool:
        text_hit = any(x in text for x in ("unusual traffic","자동화된 요청","비정상적인 트래픽","captcha","recaptcha","로봇이 아닙니다","verify you are human"))
        try:
            frame_hit = page.locator("iframe[src*=recaptcha], #captcha-form, form[action*=sorry]").count() > 0
        except Exception:
            frame_hit = False
        return text_hit or frame_hit
    if challenged(page_text()):
        if not allow_manual:
            raise RuntimeError("Google이 인증을 요구합니다. '브라우저 창 표시'를 켜고 다시 실행하면 직접 인증할 수 있습니다.")
        log(callback, f"[Google 사용자 인증 필요] 브라우저에서 직접 인증하세요. 최대 {challenge_timeout}초 기다립니다.")
        deadline = time.monotonic() + challenge_timeout
        while time.monotonic() < deadline:
            try:
                if page.locator("a:has(h3)").count() > 0 and not challenged(page_text()):
                    log(callback, "[Google 인증 완료] 검색을 이어갑니다.")
                    break
            except Exception: pass
            page.wait_for_timeout(1000)
        else:
            raise RuntimeError("Google 직접 인증 대기 시간이 끝났습니다. Bing 및 다른 검색 결과는 계속 처리합니다.")
    found = page.locator("a:has(h3)").evaluate_all("""els => els.map(a => {
      const card = a.closest('div.MjjYud') || a.parentElement?.parentElement;
      return {url:a.href, title:(a.querySelector('h3')?.innerText || a.innerText || '').trim(),
              snippet:(card?.innerText || '').trim()};
    }).filter(x => /^https?:/.test(x.url) &&
      !/(google\\.com|accounts\\.google|support\\.google|policies\\.google)/i.test(new URL(x.url).hostname) &&
      x.title.length > 2).slice(0, 50)""")
    results, seen = [], set()
    for item in found:
        target=item["url"].split("#",1)[0]
        if target not in seen:
            seen.add(target); results.append({"url":target,"title":item["title"][:500],"snippet":item["snippet"][:1500]})
        if len(results)>=limit: break
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
    identity = [x for x in (series, subject, grade, semester, edition) if x]
    identity = list(dict.fromkeys(identity))
    full_identity = " ".join(identity) if identity else title
    publisher_identity = " ".join(x for x in (publisher, *identity) if x)
    platform_clause = "(site:tistory.com OR site:blog.naver.com OR site:blogspot.com OR site:brunch.co.kr OR site:velog.io OR site:wordpress.com OR site:cafe.naver.com)"

    # Each query combines the distinctive book identity with answer intent.
    # Platform-restricted searches are separate so one large OR expression
    # cannot cause the search engine to silently ignore individual platforms.
    variants = [
        f'"{title}" "답지"',
        f'"{title}" "정답과 해설"',
        f'"{full_identity}" "답지"',
        f'"{full_identity}" "정답" "해설"',
        f'"{publisher_identity}" "답지"' if publisher else f'"{full_identity}" "해설"',
        f'"{title}" {platform_clause} 답지',
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
    return urlunsplit((parts.scheme.lower(),parts.netloc.lower(),parts.path or "/",urlencode(query),""))


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
    elif score >= 75 and (exact_title or (series_hit and subject_hit and edition_hit)):
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


def run_search(input_path: Path, output_path: Path, config_path: Path, headed: bool,
               max_pages_override: int, callback: Callable[[str], None] = print, stop_event=None) -> int:
    books=read_books(input_path); config=json.loads(config_path.read_text(encoding="utf-8"))
    sources=config.get("sources",[]); web_cfg=config.get("web_search",{})
    web_enabled=bool(web_cfg.get("enabled",True)); engines=web_cfg.get("engines",["google","bing"])
    if not sources and not web_enabled: raise ValueError("공식 자료실 또는 공개 웹 검색 중 하나 이상을 활성화하세요.")
    terms=config.get("answer_keywords") or ["정답과 해설","정답 해설","정답 및 해설","답지"]
    delay=max(1.0,float(config.get("request_delay_seconds",2.0))); timeout=int(config.get("page_timeout_ms",20000))
    limit=max_pages_override or int(config.get("max_sitemap_urls_per_source",500))
    search_limit=max(1,min(20,int(web_cfg.get("results_per_engine",8))))
    query_limit=max(1,min(10,int(web_cfg.get("max_queries_per_book",8))))
    candidates={}; robots_cache={}
    log(callback,f"교재 {len(books)}권 · 공식 출처 {len(sources)}곳 · 공개 검색엔진 {', '.join(engines) if web_enabled else '사용 안 함'}")
    log(callback,f"검색 전략: 교재당 최대 {query_limit}개 검색어 · 엔진별 검색 결과 최대 {search_limit}개")
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=not headed); context=browser.new_context(locale="ko-KR")
        page=context.new_page(); page.set_default_navigation_timeout(timeout)
        def guard_browser_request(route):
            # Chromium can use its own DNS/proxy configuration. Re-resolving every
            # Google subresource through Python's socket resolver can reject valid
            # requests on school networks, VPNs, or systems using a proxy and leave
            # page.goto() on about:blank. Validate URL syntax/host here; untrusted
            # result destinations are DNS-checked separately before navigation by
            # robots_for_target()/fetch(), including redirect targets.
            request_url = route.request.url
            if is_safe_public_url(request_url, resolve_dns=False):
                route.continue_()
            else:
                log(callback, f"[비공개/로컬 네트워크 요청 차단] {request_url[:200]}")
                route.abort("blockedbyclient")
        page.route("**/*", guard_browser_request)
        def robots_for_target(target):
            parsed=urlparse(target); key=(parsed.scheme,parsed.netloc)
            if key not in robots_cache:
                try: robots_cache[key]=robots_for(target)[0]
                except Exception as exc:
                    robots_cache[key]=None; log(callback,f"  [robots 확인 불가, 안전상 건너뜀] {parsed.netloc}: {exc}")
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
            key=(book.get("id") or book["title"],target)
            row={"book_id":book.get("id",""),"book_title":book.get("title",""),"publisher":book.get("publisher",""),
                 "subject":book.get("subject",""),"grade":book.get("grade",""),"semester":book.get("semester",""),
                 "series":book.get("series",""),"candidate_title":title or host,"url":target,"source_name":host,
                 "source_type":source_label,"snippet":str(snippet or "")[:1200],"match_score":score,
                 "match_status":status,"matched_answer_terms":matched,
                 "link_type":"PDF" if parsed.path.lower().endswith(".pdf") else "웹페이지","search_query":query}
            if key not in candidates or score>int(candidates[key].get("match_score",0)): candidates[key]=row
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
                    log(callback,f"[공식 자료실 탐색] {publisher or host}: {len(pages)}개 공개 페이지")
                    for index,url in enumerate(pages,1):
                        if stop_event is not None and stop_event.is_set(): break
                        if not allowed_host(url,host) or not robots.can_fetch(USER_AGENT,url): continue
                        try:
                            response=page.goto(url,wait_until="domcontentloaded")
                            if response and response.status>=400: continue
                            if not allowed_host(page.url,host): continue
                            title,description,body=extract_page(page); combined=" ".join([title,description,body])
                            links=page.locator("a[href]").evaluate_all("""els => els.map(a => ({
                              href:a.href,text:(a.innerText||a.getAttribute('aria-label')||'').trim()
                            })).filter(x => /정답|해설|답지|pdf/i.test(x.text+' '+x.href)).slice(0,20)""")
                            targets=[]
                            if any(norm(term) in norm(combined) for term in terms): targets.append((url,title," ".join([description,body])))
                            for link in links:
                                target=link.get("href","")
                                if allowed_host(target,host) and robots.can_fetch(USER_AGENT,target):
                                    targets.append((target,link.get("text") or "정답과 해설"," ".join([description,body])))
                            for book in books:
                                bp,sp=norm(book.get("publisher","")),norm(publisher)
                                if bp and sp and bp not in sp and sp not in bp: continue
                                for target,target_title,snippet in targets: add_candidate(book,target,target_title,snippet,"publisher")
                        except PlaywrightTimeoutError: log(callback,f"[시간 초과] {url}")
                        except Exception as exc: log(callback,f"[오류] {url}: {exc}")
                        if index%20==0: log(callback,f"  공식 자료실 진행 {index}/{len(pages)} · 후보 {len(candidates)}개")
                        time.sleep(delay)
            if web_enabled and not (stop_event is not None and stop_event.is_set()):
                for book in books:
                    if stop_event is not None and stop_event.is_set(): break
                    queries=build_queries(book,query_limit); log(callback,f"[검색어 구성] {book['title']}: {len(queries)}개")
                    seen_urls=set(); google_blocked=False
                    for qi,query in enumerate(queries,1):
                        if stop_event is not None and stop_event.is_set(): break
                        results=[]
                        if "bing" in engines:
                            try:
                                got=search_bing_rss(query,search_limit); results.extend(got)
                                log(callback,f"[Bing {qi}/{len(queries)}] {len(got)}개 · {query}")
                            except Exception as exc: log(callback,f"[Bing 검색 건너뜀] {book['title']}: {exc}")
                        if "google" in engines and not google_blocked:
                            try:
                                got=search_google_page(page,query,search_limit,allow_manual=headed,callback=callback)
                                results.extend(got); log(callback,f"[Google {qi}/{len(queries)}] {len(got)}개")
                            except Exception as exc:
                                log(callback,f"[Google 검색 건너뜀] {book['title']}: {exc}")
                                if "대기 시간이 끝났습니다" in str(exc) or "인증을 요구합니다" in str(exc): google_blocked=True
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
                                response=page.goto(target,wait_until="domcontentloaded")
                                if response and response.status>=400:
                                    log(callback,f"  [HTTP {response.status}, 검증 제외] {target}"); continue
                                if (urlparse(page.url).hostname or "").lower()!=parsed.hostname.lower():
                                    log(callback,f"  외부 리디렉션 건너뜀: {target}"); continue
                                pt,desc,body=extract_page(page)
                                verified=" ".join(x for x in (title,snippet,desc,body) if x)
                                add_candidate(book,target,pt or title,verified,"web-search",query)
                            except PlaywrightTimeoutError: log(callback,f"  [시간 초과, 검증 제외] {target}")
                            except Exception as exc: log(callback,f"  [페이지 확인 실패] {target}: {exc}")
                            time.sleep(delay)
                        time.sleep(delay)
                    log(callback,f"[웹 검색 완료] {book['title']} · 누적 후보 {len(candidates)}개")
        finally:
            context.close(); browser.close()
    output_path.parent.mkdir(parents=True,exist_ok=True)
    with output_path.open("w",encoding="utf-8-sig",newline="") as handle:
        writer=csv.DictWriter(handle,fieldnames=FIELDS); writer.writeheader()
        writer.writerows(sorted(candidates.values(),key=lambda row:(-int(row["match_score"]),row["book_title"])))
    if stop_event is not None and stop_event.is_set():
        log(callback,f"중지됨: 현재까지의 후보 {len(candidates)}개를 저장했습니다 → {output_path}")
    else:
        log(callback,f"완료: 후보 {len(candidates)}개 → {output_path}")
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
