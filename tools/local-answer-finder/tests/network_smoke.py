"""Live network smoke test for the exact browser/search path used by the finder.

This test does not solve or bypass CAPTCHA. A Google challenge is reported as
reachable-but-challenged; navigation to about:blank or a navigation exception
fails the test. Bing RSS must return parseable XML over the same public fetch()
path used by production.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from finder import search_google_page, search_bing_rss, sync_playwright

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

messages = []
def log(message):
    messages.append(message)
    print(message, flush=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    context = browser.new_context(locale="ko-KR")
    page = context.new_page()
    def guard(route):
        from finder import is_safe_public_url
        if is_safe_public_url(route.request.url, resolve_dns=False):
            route.continue_()
        else:
            route.abort("blockedbyclient")
    page.route("**/*", guard)
    try:
        try:
            results = search_google_page(
                page, '"오투 중등 과학 2-1" 답지', limit=5,
                allow_manual=False, callback=log
            )
            if page.url == "about:blank":
                raise AssertionError("Google navigation ended at about:blank")
            log(f"[PASS] Google navigation succeeded; extracted {len(results)} results")
        except RuntimeError as exc:
            if page.url == "about:blank":
                raise AssertionError(f"Google remained at about:blank: {exc}") from exc
            message = str(exc)
            if "인증을 요구합니다" in message:
                log(f"[PASS] Google reachable; CAPTCHA/challenge detected (not bypassed): {message}")
            else:
                raise
    finally:
        context.close()
        browser.close()

bing_results = search_bing_rss('"오투 중등 과학 2-1" 답지', limit=5)
if not isinstance(bing_results, list):
    raise AssertionError("Bing RSS parser did not return a list")
if any(not item.get("url", "").startswith(("http://", "https://")) for item in bing_results):
    raise AssertionError("Bing returned an invalid result URL")
log(f"[PASS] Bing RSS reachable and parsed; {len(bing_results)} results")
