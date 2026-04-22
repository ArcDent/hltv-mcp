import subprocess
import sys
import re
from abc import ABC, abstractmethod

from .errors import NewsScrapeFetchError, NewsScrapeProcessError


class Process(ABC):
    @abstractmethod
    def execute(self, *args, **kwargs) -> None:
        pass


class SpiderProcess(Process):
    _FETCH_REASON_PATTERN = re.compile(
        r"HLTV_NEWS_FETCH_REASON:(?P<reason>[a-z_]+):(?P<message>.+)"
    )

    @classmethod
    def _extract_fetch_error(cls, output: str) -> NewsScrapeFetchError | None:
        if not output:
            return None

        for line in output.splitlines():
            if "HLTV_NEWS_FETCH_REASON:" not in line:
                continue

            marker_start = line.find("HLTV_NEWS_FETCH_REASON:")
            marker_text = line[marker_start:]
            match = cls._FETCH_REASON_PATTERN.search(marker_text)
            if not match:
                continue

            reason = match.group("reason").strip()
            message = match.group("message").strip()
            if not message:
                continue

            return NewsScrapeFetchError(message, reason=reason)

        return None

    def execute(
        self, spider_name: str, dir: str, args: str, strict: bool = False
    ) -> None:
        if strict:
            process = subprocess.Popen(
                [sys.executable, "-m", "scrapy", "crawl", spider_name] + args.split(),
                cwd=dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
            stdout, stderr = process.communicate()
            fetch_error = self._extract_fetch_error(f"{stderr or ''}\n{stdout or ''}")
            if fetch_error:
                raise fetch_error

            if process.returncode != 0:
                raise NewsScrapeProcessError(
                    "Scrapy execution failed for the news archive scrape."
                )
            return

        process = subprocess.Popen(
            [sys.executable, "-m", "scrapy", "crawl", spider_name] + args.split(),
            cwd=dir,
        )
        process.wait()
