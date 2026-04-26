# Realtime News Selenium Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `hltv_local_hltv_realtime_news({ limit: 25 })` return fresh HLTV realtime news from the current HLTV homepage and validate it against browser snapshot/OCR evidence.

**Architecture:** Keep the public MCP schema unchanged (`limit`, `page`, `offset`; no `tag`). Fix the bundled Python upstream so its realtime spider fetches `https://www.hltv.org/`, Selenium waits for real news DOM rather than generic JSON-LD/challenge pages, candidate validation accepts realtime homepage article structures, and the parser extracts homepage feature cards plus news rows. Use the connected browser MCP only as an independent validation source, not as a runtime dependency.

**Tech Stack:** Python Scrapy/Selenium/pytest in `hltv-api-fixed/`; TypeScript MCP server with Node test runner in the root package; Chrome DevTools MCP and OCR for final live validation.

**No-commit rule for this session:** Do not create git commits, do not amend commits, and do not change git config. Record changed files and command output instead.

---

## Working Directory

All implementation work happens only in this isolated worktree:

```text
/home/arcdent/.config/superpowers/worktrees/hltv-mcp/realtime-news-browser-validation
```

Do not edit the original checkout at `/home/arcdent/github/hltv-mcp`.

---

## File Structure

- Modify `hltv-api-fixed/hltv_scraper/hltv_scraper/spiders/hltv_realtime_news.py`
  - Responsibility: choose the live realtime-news URL and pass it through the existing challenge-aware fetcher.
- Modify `hltv-api-fixed/tests/test_news_pipeline.py`
  - Responsibility: pipeline-level tests for spider URL choice and strict realtime scrape behavior.
- Modify `hltv-api-fixed/hltv_scraper/browser_fetcher.py`
  - Responsibility: Selenium Chrome setup and readiness detection for HLTV news pages.
- Modify `hltv-api-fixed/tests/test_browser_fetcher.py`
  - Responsibility: unit tests for browser readiness and challenge/candidate validation fallback behavior.
- Modify `hltv-api-fixed/hltv_scraper/challenge_fetcher.py`
  - Responsibility: HTTP/browser/retry orchestration and parseability validation for both archive and realtime news pages.
- Modify `hltv-api-fixed/hltv_scraper/news_page_detection.py`
  - Responsibility: challenge/content marker helpers used by fetch validation.
- Modify `hltv-api-fixed/hltv_scraper/realtime_news_content.py`
  - Responsibility: extract normalized realtime-news items from homepage feature cards and row links.
- Modify `hltv-api-fixed/tests/test_realtime_news_parser.py`
  - Responsibility: parser contract tests for homepage feature cards, row links, sections, and dedupe.
- No root TypeScript runtime files are expected to change. Run root TS tests to prove the MCP schema/tool behavior did not regress.

---

## Task 1: Point realtime spider at the current HLTV homepage

**Files:**
- Modify: `hltv-api-fixed/tests/test_news_pipeline.py`
- Modify: `hltv-api-fixed/hltv_scraper/hltv_scraper/spiders/hltv_realtime_news.py`

- [ ] **Step 1: Write the failing test**

Replace the existing `test_hltv_realtime_news_spider_fetches_live_news_page` in `hltv-api-fixed/tests/test_news_pipeline.py` with this version:

```python
def test_hltv_realtime_news_spider_fetches_homepage_live_news_page():
    from hltv_scraper.hltv_scraper.spiders.hltv_realtime_news import HltvRealtimeNewsSpider

    response = HtmlResponse(
        url="https://www.hltv.org/",
        request=Request(url="https://www.hltv.org/"),
        body=(
            b"<html><body><h2>Today's news</h2>"
            b"<a class='newsline article' href='/news/1/live'>"
            b"<div class='newstext'>Live title</div>"
            b"<div class='newsrecent'>15 minutes ago</div>"
            b"</a></body></html>"
        ),
        encoding="utf-8",
    )

    spider = HltvRealtimeNewsSpider()

    with patch(
        "hltv_scraper.hltv_scraper.spiders.hltv_realtime_news.fetch_hltv_page",
        return_value=response,
    ) as mock_fetch:
        items = list(spider.start_requests())

    mock_fetch.assert_called_once_with("https://www.hltv.org/")
    assert items == [
        {
            "section": "today",
            "category": None,
            "title": "Live title",
            "relative_time": "15 minutes ago",
            "comments": None,
            "link": "https://www.hltv.org/news/1/live",
            "summary_hint": None,
        }
    ]
```

- [ ] **Step 2: Run the focused test and verify it fails for the URL mismatch**

Run from `hltv-api-fixed/`:

```bash
./env/bin/python -m pytest tests/test_news_pipeline.py::test_hltv_realtime_news_spider_fetches_homepage_live_news_page -v
```

Expected: FAIL with an assertion showing `fetch_hltv_page` was called with `https://www.hltv.org/news` instead of `https://www.hltv.org/`.

- [ ] **Step 3: Implement the minimal spider URL change**

In `hltv-api-fixed/hltv_scraper/hltv_scraper/spiders/hltv_realtime_news.py`, change only the realtime spider URL:

```python
class HltvRealtimeNewsSpider(scrapy.Spider):
    name = "hltv_realtime_news"
    allowed_domains = ["www.hltv.org"]
    news_url = "https://www.hltv.org/"
    start_urls = [news_url]
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run from `hltv-api-fixed/`:

```bash
./env/bin/python -m pytest tests/test_news_pipeline.py::test_hltv_realtime_news_spider_fetches_homepage_live_news_page -v
```

Expected: PASS.

- [ ] **Step 5: Run nearby pipeline tests**

Run from `hltv-api-fixed/`:

```bash
./env/bin/python -m pytest tests/test_news_pipeline.py -v
```

Expected: all tests in `test_news_pipeline.py` pass. If older archive tests fail due message text only, keep archive behavior intact and update wording only where it now says “news page” for shared fetch helpers.

---

## Task 2: Make Selenium readiness require real news DOM

**Files:**
- Modify: `hltv-api-fixed/tests/test_browser_fetcher.py`
- Modify: `hltv-api-fixed/hltv_scraper/browser_fetcher.py`

- [ ] **Step 1: Add a failing generic JSON-LD readiness test**

Add this test after `test_browser_html_fetcher_succeeds_when_newsline_marker_is_present` in `hltv-api-fixed/tests/test_browser_fetcher.py`:

```python
def test_browser_html_fetcher_does_not_accept_generic_json_ld_without_news_links():
    from selenium.common.exceptions import TimeoutException
    from selenium.webdriver.common.by import By
    from hltv_scraper.browser_fetcher import BrowserHTMLFetcher
    from hltv_scraper.errors import NewsScrapeFetchError

    url = "https://www.hltv.org/"
    driver = Mock()
    driver.current_url = url
    driver.page_source = (
        "<html><head>"
        "<script type='application/ld+json'>{}</script>"
        "</head><body><h1>Access denied</h1></body></html>"
    )

    def _find_elements(by, selector):
        if by == By.CSS_SELECTOR and selector == 'script[type="application/ld+json"]':
            return [Mock()]
        return []

    driver.find_elements.side_effect = _find_elements

    class _SingleCheckWait:
        def __init__(self, current_driver):
            self.current_driver = current_driver
            self.condition_result = None

        def until(self, condition):
            self.condition_result = condition(self.current_driver)
            if not self.condition_result:
                raise TimeoutException("timed out")
            return True

    wait = _SingleCheckWait(driver)
    fetcher = BrowserHTMLFetcher()

    with patch.object(fetcher, "_build_driver", return_value=driver):
        with patch.object(fetcher, "_build_wait", return_value=wait):
            with pytest.raises(NewsScrapeFetchError) as exc_info:
                fetcher.fetch(url)

    assert wait.condition_result is False
    assert exc_info.value.reason == "browser_timeout"
    driver.quit.assert_called_once()
```

- [ ] **Step 2: Add a homepage feature-card readiness test**

Add this test next to the generic JSON-LD test:

```python
def test_browser_html_fetcher_succeeds_when_homepage_feature_news_link_is_present():
    from selenium.common.exceptions import TimeoutException
    from selenium.webdriver.common.by import By
    from hltv_scraper.browser_fetcher import BrowserHTMLFetcher

    url = "https://www.hltv.org/"
    driver = Mock()
    driver.current_url = url
    driver.page_source = (
        "<html><body>"
        "<a class='featured-article' href='/news/43010/stat-check'>"
        "<div class='featured-article-title'>Stat Check: MOUZ go anchorless with another big bet on youth</div>"
        "</a></body></html>"
    )

    def _find_elements(by, selector):
        if by != By.CSS_SELECTOR:
            return []
        if selector == "a[href*='/news/'] .featured-article-title":
            return [Mock()]
        return []

    driver.find_elements.side_effect = _find_elements

    class _SingleCheckWait:
        def __init__(self, current_driver):
            self.current_driver = current_driver
            self.condition_result = None

        def until(self, condition):
            self.condition_result = condition(self.current_driver)
            if not self.condition_result:
                raise TimeoutException("timed out")
            return True

    wait = _SingleCheckWait(driver)
    fetcher = BrowserHTMLFetcher()

    with patch.object(fetcher, "_build_driver", return_value=driver):
        with patch.object(fetcher, "_build_wait", return_value=wait):
            result = fetcher.fetch(url)

    assert wait.condition_result is True
    assert result.final_url == url
    assert "Stat Check: MOUZ" in result.html
    driver.quit.assert_called_once()
```

- [ ] **Step 3: Run both new tests and verify the generic JSON-LD test fails before implementation**

Run from `hltv-api-fixed/`:

```bash
./env/bin/python -m pytest tests/test_browser_fetcher.py::test_browser_html_fetcher_does_not_accept_generic_json_ld_without_news_links tests/test_browser_fetcher.py::test_browser_html_fetcher_succeeds_when_homepage_feature_news_link_is_present -v
```

Expected before implementation: the generic JSON-LD test FAILS because current readiness accepts JSON-LD. The feature-card test may fail because there is no feature-title readiness selector.

- [ ] **Step 4: Implement real news selectors in `browser_fetcher.py`**

Update `hltv-api-fixed/hltv_scraper/browser_fetcher.py` to define real news selectors and wait for them instead of generic JSON-LD:

```python
NEWS_CONTENT_SELECTORS = (
    "a.newsline.article",
    "a[href*='/news/'] .newstext",
    "a[href*='/news/'] .newslineText",
    "a[href*='/news/'] .featured-article-title",
    "a[href*='/news/'] .article-title",
    "a[href*='/news/'] .news-title",
    "a[href*='/news/'] .headline",
    "a[href*='/news/'] h2",
    "a[href*='/news/'] h3",
    "a[href*='/news/'] h4",
)
```

Then replace `_wait_until_ready` with:

```python
    def _wait_until_ready(self, driver, wait) -> None:
        wait.until(lambda current_driver: self._has_news_content(current_driver))

    def _has_news_content(self, driver) -> bool:
        for selector in NEWS_CONTENT_SELECTORS:
            if driver.find_elements(By.CSS_SELECTOR, selector):
                return True
        return False
```

Keep `fetch()` exception mapping unchanged: readiness timeout still raises `NewsScrapeFetchError(..., reason="browser_timeout")`.

- [ ] **Step 5: Run the browser fetcher tests**

Run from `hltv-api-fixed/`:

```bash
./env/bin/python -m pytest tests/test_browser_fetcher.py -v
```

Expected: all tests in `test_browser_fetcher.py` pass. If `test_browser_html_fetcher_succeeds_when_newsline_marker_is_present` still references JSON-LD in its fake `find_elements`, leave that branch harmless; readiness no longer calls the JSON-LD selector.

---

## Task 3: Validate realtime homepage content, not archive-only rows

**Files:**
- Modify: `hltv-api-fixed/tests/test_browser_fetcher.py`
- Modify: `hltv-api-fixed/hltv_scraper/challenge_fetcher.py`
- Modify: `hltv-api-fixed/hltv_scraper/news_page_detection.py`

- [ ] **Step 1: Add a failing candidate-validation test for homepage feature cards**

Add this test near `test_fetch_hltv_page_returns_html_response_from_browser_result` in `hltv-api-fixed/tests/test_browser_fetcher.py`:

```python
def test_fetch_hltv_page_accepts_realtime_homepage_feature_card_from_browser_result():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.browser_fetcher import BrowserFetchResult
    from hltv_scraper.errors import NewsScrapeFetchError

    browser_result = BrowserFetchResult(
        final_url="https://www.hltv.org/",
        html="""
        <html>
          <body>
            <h2>Today's news</h2>
            <a class="featured-article" href="/news/43010/stat-check-mouz-go-anchorless">
              <div class="featured-article-title">Stat Check: MOUZ go anchorless with another big bet on youth</div>
              <p>siuhy has found another way to trust young riflers.</p>
            </a>
          </body>
        </html>
        """,
    )

    with patch(
        "hltv_scraper.challenge_fetcher.fetch_news_archive_with_http_session",
        side_effect=NewsScrapeFetchError(
            "HTTP session hit a challenge page.",
            reason="challenge_detected",
        ),
    ):
        with patch(
            "hltv_scraper.challenge_fetcher.BrowserHTMLFetcher.fetch",
            return_value=browser_result,
        ):
            response = fetch_hltv_page("https://www.hltv.org/")

    assert response.url == "https://www.hltv.org/"
    assert "Stat Check: MOUZ" in response.text
```

- [ ] **Step 2: Run the new candidate-validation test and verify it fails before implementation**

Run from `hltv-api-fixed/`:

```bash
./env/bin/python -m pytest tests/test_browser_fetcher.py::test_fetch_hltv_page_accepts_realtime_homepage_feature_card_from_browser_result -v
```

Expected before implementation: FAIL with `NewsScrapeFetchError(reason="challenge_detected")` because `challenge_fetcher._validate_candidate()` only accepts archive-style `extract_news_articles()` output.

- [ ] **Step 3: Implement shared archive-or-realtime validation**

In `hltv-api-fixed/hltv_scraper/challenge_fetcher.py`, add the realtime parser import:

```python
from .realtime_news_content import extract_realtime_news
```

Then replace `_validate_candidate` with this version:

```python
def _validate_candidate(
    response: HtmlResponse, *, source: str
) -> NewsScrapeFetchError | None:
    if is_blocked_archive_page(response.text):
        return NewsScrapeFetchError(
            f"{source} reached a challenge page instead of the HLTV news page.",
            reason="challenge_detected",
        )

    if not extract_news_articles(response) and not extract_realtime_news(response):
        return NewsScrapeFetchError(
            f"{source} did not return parseable HLTV news content.",
            reason="challenge_detected",
        )

    return None
```

- [ ] **Step 4: Broaden page content markers without accepting generic JSON-LD**

In `hltv-api-fixed/hltv_scraper/news_page_detection.py`, update `has_archive_content_markers` so challenge detection recognizes real homepage article markers while still treating generic JSON-LD as insufficient:

```python
def has_archive_content_markers(html: str) -> bool:
    normalized = (html or "").lower()
    has_news_jsonld = (
        "application/ld+json" in normalized
        and '"@type"' in normalized
        and "newsarticle" in normalized
    )
    return (
        "a.newsline.article" in normalized
        or "newsline article" in normalized
        or "featured-article-title" in normalized
        or "today's news" in normalized
        or has_news_jsonld
    )
```

Do not add generic `application/ld+json` as a content marker without `NewsArticle`.

- [ ] **Step 5: Run the candidate-validation tests**

Run from `hltv-api-fixed/`:

```bash
./env/bin/python -m pytest tests/test_browser_fetcher.py -v
```

Expected: all tests pass, including the existing tests that reject generic JSON-LD and Cloudflare-only browser HTML.

---

## Task 4: Calibrate realtime parser for homepage feature cards and row links

**Files:**
- Modify: `hltv-api-fixed/tests/test_realtime_news_parser.py`
- Modify: `hltv-api-fixed/hltv_scraper/realtime_news_content.py`

- [ ] **Step 1: Add a failing parser test based on the live homepage shape**

Add this test before `test_realtime_news_parser_raises_content_error_when_no_rows_are_found` in `hltv-api-fixed/tests/test_realtime_news_parser.py`:

```python
def test_extract_realtime_news_parses_homepage_feature_card_and_live_rows():
    response = _response_from_html(
        """
        <html>
          <body>
            <h2>Today's news</h2>
            <a class="featured-article" href="/news/43010/stat-check-mouz-go-anchorless">
              <div class="featured-article-title">Stat Check: MOUZ go anchorless with another big bet on youth</div>
              <p>siuhy has found another way to trust young riflers.</p>
            </a>
            <a class="newsline article" href="/news/43001/bcg-masters-championship-2">
              <span class="newsitemCategory">Portugal</span>
              <div class="newstext">BCG Masters Championship 2 to be held in Vila Nova de Gaia</div>
              <div class="newsrecent">15 hours ago</div>
              <div class="newstc"><div></div><div>27 comments</div></div>
            </a>
            <a class="newsline article" href="/news/43000/valve-release-more-animgraph-2-tweaks">
              <span class="newsitemCategory">Other</span>
              <div class="newstext">Short: Valve release more Animgraph 2 tweaks</div>
              <div class="newsrecent">16 hours ago</div>
              <div class="newstc"><div></div><div>583 comments</div></div>
            </a>
            <h2>Yesterday's news</h2>
            <a class="newsline article" href="/news/42990/valve-tease-cache-addition">
              <span class="newsitemCategory">Counter-Strike</span>
              <div class="newstext">Valve tease Cache addition: &quot;What are you doing next week?&quot;</div>
              <div class="newsrecent">a day ago</div>
            </a>
          </body>
        </html>
        """,
        url="https://www.hltv.org/",
    )

    assert extract_realtime_news(response) == [
        {
            "section": "today",
            "category": None,
            "title": "Stat Check: MOUZ go anchorless with another big bet on youth",
            "relative_time": None,
            "comments": None,
            "link": "https://www.hltv.org/news/43010/stat-check-mouz-go-anchorless",
            "summary_hint": "siuhy has found another way to trust young riflers.",
        },
        {
            "section": "today",
            "category": "Portugal",
            "title": "BCG Masters Championship 2 to be held in Vila Nova de Gaia",
            "relative_time": "15 hours ago",
            "comments": "27 comments",
            "link": "https://www.hltv.org/news/43001/bcg-masters-championship-2",
            "summary_hint": None,
        },
        {
            "section": "today",
            "category": "Other",
            "title": "Short: Valve release more Animgraph 2 tweaks",
            "relative_time": "16 hours ago",
            "comments": "583 comments",
            "link": "https://www.hltv.org/news/43000/valve-release-more-animgraph-2-tweaks",
            "summary_hint": None,
        },
        {
            "section": "yesterday",
            "category": "Counter-Strike",
            "title": 'Valve tease Cache addition: "What are you doing next week?"',
            "relative_time": "a day ago",
            "comments": None,
            "link": "https://www.hltv.org/news/42990/valve-tease-cache-addition",
            "summary_hint": None,
        },
    ]
```

- [ ] **Step 2: Run the new parser test and verify it fails before implementation**

Run from `hltv-api-fixed/`:

```bash
./env/bin/python -m pytest tests/test_realtime_news_parser.py::test_extract_realtime_news_parses_homepage_feature_card_and_live_rows -v
```

Expected before implementation: FAIL because the feature-card title is not extracted as `featured-article-title`.

- [ ] **Step 3: Implement homepage title selectors**

In `hltv-api-fixed/hltv_scraper/realtime_news_content.py`, update `_extract_title` selectors to include homepage feature-card and common article-title classes before heading tags:

```python
def _extract_title(node) -> str | None:
    return _first_text(
        node,
        [
            ".newstext::text",
            ".newslineText::text",
            ".featured-article-title::text",
            ".article-title::text",
            ".news-title::text",
            ".headline::text",
            ".title::text",
            "h2::text",
            "h3::text",
            "h4::text",
        ],
    )
```

Leave `_is_article_link()` restricted to anchors whose `href` contains `/news/` so generic page headings are not parsed as articles.

- [ ] **Step 4: Run parser tests**

Run from `hltv-api-fixed/`:

```bash
./env/bin/python -m pytest tests/test_realtime_news_parser.py -v
```

Expected: all parser tests pass.

- [ ] **Step 5: Run Python upstream focused tests together**

Run from `hltv-api-fixed/`:

```bash
./env/bin/python -m pytest tests/test_realtime_news_parser.py tests/test_browser_fetcher.py tests/test_news_pipeline.py -v
```

Expected: all selected Python tests pass.

---

## Task 5: Root TypeScript regression checks

**Files:**
- No expected file changes.

- [ ] **Step 1: Run TypeScript typecheck**

Run from the worktree root:

```bash
npm run check
```

Expected: `tsc --noEmit -p tsconfig.json` exits 0.

- [ ] **Step 2: Run realtime MCP flow tests**

Run from the worktree root:

```bash
node --import tsx --test src/realtimeNewsFlow.test.ts
```

Expected: all realtime news flow tests pass, proving schema still has no `tag`, client endpoint remains `/api/v1/news/realtime`, renderer still omits source, and `/news` defaults to `{ limit: 25 }` without tag.

- [ ] **Step 3: Build before match-command regression**

Run from the worktree root:

```bash
npm run build
```

Expected: `tsc -p tsconfig.json` exits 0 and refreshes `dist/` for tests that import built files.

- [ ] **Step 4: Run match-command regression**

Run from the worktree root:

```bash
node --import tsx --test src/matchCommandFlow.test.ts
```

Expected: all match command tests pass. This confirms `/match` today-only behavior did not regress even though no `/match` files were edited.

---

## Task 6: Fresh live API, browser snapshot/OCR, and MCP validation

**Files:**
- Runtime data file may be deleted/recreated: `hltv-api-fixed/hltv_scraper/data/news/realtime_news.json`
- No source-code changes expected.

- [ ] **Step 1: Confirm browser MCP sees current HLTV homepage news nodes**

Use Chrome DevTools MCP:

1. Navigate the selected page to `https://www.hltv.org/`.
2. Take a text snapshot.
3. Confirm the snapshot contains `Today's news` and at least three of these live titles, or their current same-page replacements if HLTV updates during validation:
   - `Stat Check: MOUZ go anchorless with another big bet on youth`
   - `BCG Masters Championship 2 to be held in Vila Nova de Gaia`
   - `Short: Valve release more Animgraph 2 tweaks`
   - `Parken Challenger Championship announce circuit expansion`
   - `RED Canids bench roster`

Record the snapshot title list in the final report.

- [ ] **Step 2: Take screenshot and OCR it**

Use Chrome DevTools MCP to save a screenshot of `https://www.hltv.org/` to a local file, then run OCR with `ocr2md_ocr_file`.

Expected: OCR text contains visible realtime news titles that overlap with the browser snapshot. Record OCR evidence in the final report.

- [ ] **Step 3: Remove stale realtime cache before API validation**

Run from the worktree root:

```bash
rm -f hltv-api-fixed/hltv_scraper/data/news/realtime_news.json && date -Iseconds
```

Record the timestamp. The final API result must be generated after this timestamp.

- [ ] **Step 4: Call the direct Python upstream API with enough timeout to surface the real result**

Run from the worktree root:

```bash
curl --max-time 90 -sS -D /tmp/hltv-realtime-news.headers -o /tmp/hltv-realtime-news.json http://127.0.0.1:18020/api/v1/news/realtime
```

Then inspect status and a compact body summary:

```bash
python - <<'PY'
import json
from pathlib import Path

headers = Path('/tmp/hltv-realtime-news.headers').read_text()
body = json.loads(Path('/tmp/hltv-realtime-news.json').read_text())
print(headers.splitlines()[0])
if isinstance(body, list):
    print('items', len(body))
    for item in body[:5]:
        print(item.get('title'))
else:
    print(body)
PY
```

Expected success: HTTP 200, JSON list, non-empty items, no `challenge_detected`, and first five titles are realtime homepage news.

If the result is HTTP 502 with `reason: challenge_detected`, stop live-success claims and report that HLTV still blocked this environment after code fixes.

- [ ] **Step 5: Confirm fresh output file mtime**

Run from the worktree root:

```bash
python - <<'PY'
from pathlib import Path
import datetime as dt

path = Path('hltv-api-fixed/hltv_scraper/data/news/realtime_news.json')
print(path.exists())
if path.exists():
    print(dt.datetime.fromtimestamp(path.stat().st_mtime).isoformat())
PY
```

Expected: file exists and mtime is after the timestamp recorded in Step 3.

- [ ] **Step 6: Apply consistency rule B**

Compare the first five direct API titles against the browser snapshot text and OCR text.

Expected: at least 3 of the first 5 API titles appear in either the browser snapshot or OCR text. Matching is case-insensitive and allows minor whitespace/quote differences.

- [ ] **Step 7: Call the MCP realtime news tool**

Call MCP tool `hltv_local_hltv_realtime_news` with exactly:

```json
{ "limit": 25 }
```

Expected: Chinese-rendered realtime news output includes title, English title/original title as rendered by current renderer, relative time, category/comments/update time, pagination metadata when applicable, no source field, and no upstream error. If upstream returns an error, report it verbatim.

---

## Final Verification Checklist

- [ ] Python focused tests pass:

```bash
cd hltv-api-fixed && ./env/bin/python -m pytest tests/test_realtime_news_parser.py tests/test_browser_fetcher.py tests/test_news_pipeline.py -v
```

- [ ] Root typecheck passes:

```bash
npm run check
```

- [ ] Root realtime flow tests pass:

```bash
node --import tsx --test src/realtimeNewsFlow.test.ts
```

- [ ] Build passes:

```bash
npm run build
```

- [ ] Match command regression passes:

```bash
node --import tsx --test src/matchCommandFlow.test.ts
```

- [ ] Live validation either succeeds with HTTP 200 + fresh cache + 3/5 browser/OCR matches + MCP output, or reports the exact upstream error if HLTV still blocks the environment.

---

## Self-Review Notes

- Spec coverage: runtime remains Python Selenium/headless Chrome; MCP browser is validation only; schema remains unchanged; fresh-cache API validation, browser snapshot, screenshot OCR, and consistency rule B are covered in Task 6.
- Placeholder scan: every task has exact file paths, concrete test code, exact commands, and expected outcomes.
- Type consistency: new helper names are `NEWS_CONTENT_SELECTORS`, `_has_news_content`, and existing `BrowserFetchResult`/`NewsScrapeFetchError` signatures remain unchanged.
- Scope control: no unrelated TypeScript feature work; root checks only verify no regression.
