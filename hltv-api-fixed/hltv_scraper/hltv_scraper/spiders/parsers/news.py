from typing import Any

from hltv_scraper.errors import NewsScrapeContentError
from ...news_content import extract_news_articles
from ...news_page_detection import is_blocked_archive_page
from .parser import Parser


class NewsParser(Parser):
    @staticmethod
    def parse(response) -> list[dict[str, Any]]:
        NewsParser._raise_if_challenge_page(response)

        articles = extract_news_articles(response)
        if articles:
            return articles

        raise NewsScrapeContentError(
            "News archive page contained no parsable articles for the requested period."
        )

    @staticmethod
    def _raise_if_challenge_page(response) -> None:
        if is_blocked_archive_page(response.text):
            raise NewsScrapeContentError(
                "News archive page is a challenge page and cannot be parsed."
            )
