import cloudscraper
from scrapy.http import HtmlResponse

from .errors import NewsScrapeFetchError
from .response_factory import build_html_response


_BROWSER_LIKE_HEADERS = {
    "Accept": (
        "text/html,application/xhtml+xml,application/xml;q=0.9,"
        "image/avif,image/webp,image/apng,*/*;q=0.8"
    ),
    "Accept-Language": "en-US,en;q=0.9",
    "Referer": "https://www.hltv.org/",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
    "Cache-Control": "no-cache",
    "Pragma": "no-cache",
}


def fetch_news_archive_with_http_session(url: str) -> HtmlResponse:
    scraper = cloudscraper.create_scraper(
        browser={
            "browser": "firefox",
            "platform": "windows",
            "mobile": False,
        }
    )
    scraper.headers.update(_BROWSER_LIKE_HEADERS)

    try:
        scraper.get("https://www.hltv.org/", timeout=20)
        response = scraper.get(url, timeout=20)
    except Exception as exc:
        raise NewsScrapeFetchError(
            "HTTP-session fetch failed for the news archive page.",
            reason="fallback_failed",
        ) from exc

    return build_html_response(response.url, response.text)
