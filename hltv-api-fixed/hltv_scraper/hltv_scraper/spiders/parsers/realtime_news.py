from typing import Any

from hltv_scraper.errors import NewsScrapeContentError
from ...realtime_news_content import extract_realtime_news
from .parser import Parser


class RealtimeNewsParser(Parser):
    @staticmethod
    def parse(response) -> list[dict[str, Any]]:
        items = extract_realtime_news(response)
        if items:
            return items

        raise NewsScrapeContentError(
            "Realtime news page contained no parsable live news entries."
        )
