from scrapy.http import HtmlResponse

from .browser_fetcher import BrowserHTMLFetcher
from .errors import NewsScrapeFetchError
from .news_content import extract_news_articles
from .news_http_fetcher import fetch_news_archive_with_http_session
from .news_page_detection import is_blocked_archive_page
from .realtime_news_content import extract_realtime_news
from .response_factory import build_html_response


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


def _fetch_with_browser(url: str) -> HtmlResponse:
    browser_result = BrowserHTMLFetcher().fetch(url)
    return build_html_response(browser_result.final_url, browser_result.html)


def fetch_hltv_page(url: str) -> HtmlResponse:
    fetch_attempts = (
        ("HTTP-session fetch", lambda: fetch_news_archive_with_http_session(url)),
        ("Browser fetch", lambda: _fetch_with_browser(url)),
        ("HTTP-session retry fetch", lambda: fetch_news_archive_with_http_session(url)),
    )

    last_error: NewsScrapeFetchError | None = None

    for source, fetch_attempt in fetch_attempts:
        try:
            response = fetch_attempt()
        except NewsScrapeFetchError as exc:
            last_error = exc
            continue

        validation_error = _validate_candidate(response, source=source)
        if validation_error is not None:
            last_error = validation_error
            continue

        return response

    if last_error is not None:
        raise last_error

    raise NewsScrapeFetchError(
        "Unable to fetch parseable HLTV news content.",
        reason="challenge_detected",
    )
