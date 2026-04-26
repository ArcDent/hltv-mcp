import sys
import scrapy
from typing import Any, Generator

from hltv_scraper.challenge_fetcher import fetch_hltv_page
from hltv_scraper.errors import NewsScrapeFetchError

from .parsers import ParsersFactory as PF


class HltvRealtimeNewsSpider(scrapy.Spider):
    name = "hltv_realtime_news"
    allowed_domains = ["www.hltv.org"]
    news_url = "https://www.hltv.org/news"
    start_urls = [news_url]

    def start_requests(self) -> Generator[Any, Any, None]:
        try:
            response = fetch_hltv_page(self.news_url)
        except NewsScrapeFetchError as exc:
            marker = f"HLTV_NEWS_FETCH_REASON:{exc.reason}:{str(exc)}"
            print(marker, file=sys.stderr)
            raise RuntimeError(marker) from exc
        yield from self.parse(response)

    def parse(self, response) -> Generator[Any, Any, None]:
        data = PF.get_parser("realtime_news").parse(response)
        yield from data or []
