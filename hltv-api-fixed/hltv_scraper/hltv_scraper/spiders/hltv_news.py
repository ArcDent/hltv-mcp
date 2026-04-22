import sys
import scrapy
from typing import Any, Generator

from hltv_scraper.challenge_fetcher import fetch_hltv_page
from hltv_scraper.errors import NewsScrapeFetchError

from .parsers import ParsersFactory as PF


class HltvNewsSpider(scrapy.Spider):
    name = "hltv_news"
    allowed_domains = ["www.hltv.org"]

    def __init__(self, year: str, month: str, **kwargs: Any) -> None:
        self.date = f"{year}/{month}"
        self.archive_url = f"https://www.hltv.org/news/archive/{self.date}"
        self.start_urls = [self.archive_url]
        super().__init__(**kwargs)

    def start_requests(self) -> Generator[Any, Any, None]:
        try:
            response = fetch_hltv_page(self.archive_url)
        except NewsScrapeFetchError as exc:
            marker = f"HLTV_NEWS_FETCH_REASON:{exc.reason}:{str(exc)}"
            print(marker, file=sys.stderr)
            raise RuntimeError(marker) from exc
        yield from self.parse(response)

    def parse(self, response) -> Generator[Any, Any, None]:
        data = PF.get_parser("news").parse(response)
        yield from data or []
