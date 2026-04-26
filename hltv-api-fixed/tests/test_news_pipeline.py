import subprocess
import sys
from pathlib import Path
from unittest.mock import Mock, patch

import pytest
from scrapy.http import HtmlResponse, Request

from hltv_scraper import HLTVScraper
from hltv_scraper.cache_config import CACHE_HOURS_NEWS
from hltv_scraper.data import JsonDataLoader
from hltv_scraper.process import SpiderProcess
from hltv_scraper.spider_manager import SpiderManager


def test_spider_process_execute_strict_uses_current_python_and_raises_on_non_zero_exit():
    from hltv_scraper.errors import NewsScrapeProcessError

    process = Mock()
    process.communicate.return_value = ("", "")
    process.returncode = 1

    with patch(
        "hltv_scraper.process.subprocess.Popen", return_value=process
    ) as mock_popen:
        with pytest.raises(NewsScrapeProcessError) as exc_info:
            SpiderProcess().execute(
                "hltv_news",
                "/tmp",
                "-a year=2026 -a month=April -o data/news/news_2026_April.json",
                strict=True,
            )

    assert exc_info.value.reason == "process_failed"

    args, _kwargs = mock_popen.call_args
    assert args[0][0] == sys.executable


def test_spider_process_execute_strict_raises_fetch_error_from_subprocess_traceback():
    from hltv_scraper.errors import NewsScrapeFetchError

    process = Mock()
    process.communicate.return_value = (
        "",
        (
            "Traceback (most recent call last):\n"
            "  File '.../hltv_news.py', line 20, in start_requests\n"
            "RuntimeError: HLTV_NEWS_FETCH_REASON:browser_timeout:"
            "Browser fetch timed out while waiting for the news archive page.\n"
        ),
    )
    process.returncode = 0

    with patch(
        "hltv_scraper.process.subprocess.Popen", return_value=process
    ) as mock_popen:
        with pytest.raises(NewsScrapeFetchError) as exc_info:
            SpiderProcess().execute(
                "hltv_news",
                "/tmp",
                "-a year=2026 -a month=April -o data/news/news_2026_April.json",
                strict=True,
            )

    assert exc_info.value.reason == "browser_timeout"
    assert (
        str(exc_info.value)
        == "Browser fetch timed out while waiting for the news archive page."
    )

    args, kwargs = mock_popen.call_args
    assert args[0][0] == sys.executable
    assert kwargs["stdout"] == subprocess.PIPE
    assert kwargs["stderr"] == subprocess.PIPE
    assert kwargs["text"] is True


def test_spider_process_execute_strict_raises_fetch_error_from_plain_marker_line():
    from hltv_scraper.errors import NewsScrapeFetchError

    process = Mock()
    process.communicate.return_value = (
        "",
        "HLTV_NEWS_FETCH_REASON:challenge_detected:"
        "News archive fetch is still blocked by a challenge page.\n",
    )
    process.returncode = 0

    with patch("hltv_scraper.process.subprocess.Popen", return_value=process):
        with pytest.raises(NewsScrapeFetchError) as exc_info:
            SpiderProcess().execute(
                "hltv_news",
                "/tmp",
                "-a year=2026 -a month=April -o data/news/news_2026_April.json",
                strict=True,
            )

    assert exc_info.value.reason == "challenge_detected"
    assert (
        str(exc_info.value)
        == "News archive fetch is still blocked by a challenge page."
    )


def test_json_data_loader_load_strict_raises_when_output_file_missing(tmp_path):
    from hltv_scraper.errors import NewsScrapeOutputError

    missing_output = tmp_path / "news_2026_April.json"

    with pytest.raises(NewsScrapeOutputError) as exc_info:
        JsonDataLoader().load(str(missing_output), strict=True)

    assert exc_info.value.reason == "missing_output"


def test_hltv_scraper_get_news_raises_content_error_when_manager_returns_empty_list():
    from hltv_scraper.errors import NewsScrapeContentError

    mock_manager = Mock()
    mock_manager.execute.return_value = None
    mock_manager.get_result.return_value = []

    with patch("hltv_scraper.HLTVScraper._get_manager", return_value=mock_manager):
        with pytest.raises(NewsScrapeContentError) as exc_info:
            HLTVScraper.get_news(2026, "April")

    assert exc_info.value.reason == "empty_content"


def test_news_scrape_fetch_error_defaults_to_browser_fetch_failed_reason():
    from hltv_scraper.errors import NewsScrapeFetchError

    error = NewsScrapeFetchError("browser fetch failed")

    assert str(error) == "browser fetch failed"
    assert error.reason == "browser_fetch_failed"


def test_news_scrape_fetch_error_accepts_explicit_reason():
    from hltv_scraper.errors import NewsScrapeFetchError

    error = NewsScrapeFetchError(
        "browser timed out",
        reason="browser_timeout",
    )

    assert error.reason == "browser_timeout"


def test_hltv_scraper_get_news_reraises_manager_execute_process_error():
    from hltv_scraper.errors import NewsScrapeProcessError

    mock_manager = Mock()
    mock_manager.execute.side_effect = NewsScrapeProcessError(
        "process failed",
        reason="process_failed",
    )

    with patch("hltv_scraper.HLTVScraper._get_manager", return_value=mock_manager):
        with pytest.raises(NewsScrapeProcessError) as exc_info:
            HLTVScraper.get_news(2026, "April")

    assert exc_info.value.reason == "process_failed"


def test_hltv_scraper_get_news_reraises_manager_get_result_output_error():
    from hltv_scraper.errors import NewsScrapeOutputError

    mock_manager = Mock()
    mock_manager.execute.return_value = None
    mock_manager.get_result.side_effect = NewsScrapeOutputError(
        "output missing",
        reason="missing_output",
    )

    with patch("hltv_scraper.HLTVScraper._get_manager", return_value=mock_manager):
        with pytest.raises(NewsScrapeOutputError) as exc_info:
            HLTVScraper.get_news(2026, "April")

    assert exc_info.value.reason == "missing_output"


def test_hltv_scraper_get_news_propagates_strict_mode_to_manager_calls():
    mock_manager = Mock()

    with patch("hltv_scraper.HLTVScraper._get_manager", return_value=mock_manager):
        HLTVScraper.get_news(2026, "April")

    path = "news/news_2026_April"
    args = "-a year=2026 -a month=April -o data/news/news_2026_April.json"

    mock_manager.execute.assert_called_once_with(
        "hltv_news",
        path,
        args,
        CACHE_HOURS_NEWS,
        strict=True,
    )
    mock_manager.get_result.assert_called_once_with(path, strict=True)


def test_spider_manager_execute_forwards_strict_mode_to_spider_process(tmp_path):
    manager = SpiderManager(str(tmp_path))
    path = "news/news_2026_April"
    args = "-a year=2026 -a month=April -o data/news/news_2026_April.json"

    with patch.object(manager, "__should_run__", return_value=True):
        with patch("hltv_scraper.spider_manager.CF.get") as mock_cf_get:
            with patch(
                "hltv_scraper.spider_manager.SpiderProcess.execute"
            ) as mock_execute:
                condition = Mock()
                condition.check.return_value = False
                mock_cf_get.return_value = condition

                manager.execute("hltv_news", path, args, strict=True)

    mock_execute.assert_called_once_with("hltv_news", str(tmp_path), args, strict=True)


def test_spider_manager_get_result_forwards_strict_mode_to_json_loader(tmp_path):
    manager = SpiderManager(str(tmp_path))
    manager.loader = Mock(spec=JsonDataLoader)
    manager.loader.load.return_value = []

    manager.get_result("news/news_2026_April", strict=True)

    manager.loader.load.assert_called_once_with(
        manager.path.generate("news/news_2026_April"),
        strict=True,
    )


def test_news_parser_imports_from_scrapy_cwd_package_layout():
    repo_root = Path(__file__).resolve().parents[1]
    scrapy_cwd = repo_root / "hltv_scraper"

    import_result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from hltv_scraper.spiders.parsers.news "
                "import NewsParser; "
                "from hltv_scraper.errors import NewsScrapeContentError; "
                "print(NewsParser.__name__, NewsScrapeContentError.__name__)"
            ),
        ],
        cwd=scrapy_cwd,
        capture_output=True,
        text=True,
        check=False,
    )

    assert import_result.returncode == 0, import_result.stderr


def test_news_scrape_fetch_error_imports_from_scrapy_cwd_package_layout():
    repo_root = Path(__file__).resolve().parents[1]
    scrapy_cwd = repo_root / "hltv_scraper"

    import_result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from hltv_scraper.errors import NewsScrapeFetchError; "
                "print(NewsScrapeFetchError.__name__)"
            ),
        ],
        cwd=scrapy_cwd,
        capture_output=True,
        text=True,
        check=False,
    )

    assert import_result.returncode == 0, import_result.stderr


def test_hltv_news_spider_start_requests_uses_challenge_fetcher():
    from hltv_scraper.hltv_scraper.spiders.hltv_news import HltvNewsSpider

    response = HtmlResponse(
        url="https://www.hltv.org/news/archive/2026/April",
        request=Request(url="https://www.hltv.org/news/archive/2026/April"),
        body=(
            b"<html><body><a class='newsline article' href='/news/123/test'>"
            b"<div class='newstext'>Title</div></a></body></html>"
        ),
        encoding="utf-8",
    )

    spider = HltvNewsSpider(year="2026", month="April")

    with patch(
        "hltv_scraper.hltv_scraper.spiders.hltv_news.fetch_hltv_page",
        return_value=response,
    ) as mock_fetch:
        items = list(spider.start_requests())

    mock_fetch.assert_called_once_with("https://www.hltv.org/news/archive/2026/April")
    assert items == [
        {
            "title": "Title",
            "img": None,
            "date": None,
            "comments": None,
            "link": "https://www.hltv.org/news/123/test",
        }
    ]


def test_hltv_news_spider_start_requests_wraps_fetch_error_with_marker():
    from hltv_scraper.errors import NewsScrapeFetchError
    from hltv_scraper.hltv_scraper.spiders.hltv_news import HltvNewsSpider

    spider = HltvNewsSpider(year="2026", month="April")

    with patch(
        "hltv_scraper.hltv_scraper.spiders.hltv_news.fetch_hltv_page",
        side_effect=NewsScrapeFetchError(
            "Browser fetch timed out while waiting for the news archive page.",
            reason="browser_timeout",
        ),
    ):
        with pytest.raises(RuntimeError) as exc_info:
            list(spider.start_requests())

    assert (
        str(exc_info.value) == "HLTV_NEWS_FETCH_REASON:browser_timeout:"
        "Browser fetch timed out while waiting for the news archive page."
    )


def test_hltv_news_spider_start_requests_prints_fetch_marker_before_raising(capsys):
    from hltv_scraper.errors import NewsScrapeFetchError
    from hltv_scraper.hltv_scraper.spiders.hltv_news import HltvNewsSpider

    spider = HltvNewsSpider(year="2026", month="April")

    with patch(
        "hltv_scraper.hltv_scraper.spiders.hltv_news.fetch_hltv_page",
        side_effect=NewsScrapeFetchError(
            "Browser fetch reached a challenge page instead of the news archive page.",
            reason="challenge_detected",
        ),
    ):
        with pytest.raises(RuntimeError):
            list(spider.start_requests())

    captured = capsys.readouterr()
    assert (
        captured.err.strip() == "HLTV_NEWS_FETCH_REASON:challenge_detected:"
        "Browser fetch reached a challenge page instead of the news archive page."
    )


def test_hltv_scraper_get_news_propagates_fetch_error_reason():
    from hltv_scraper.errors import NewsScrapeFetchError

    mock_manager = Mock()
    mock_manager.execute.side_effect = NewsScrapeFetchError(
        "blocked by challenge",
        reason="challenge_detected",
    )

    with patch("hltv_scraper.HLTVScraper._get_manager", return_value=mock_manager):
        with pytest.raises(NewsScrapeFetchError) as exc_info:
            HLTVScraper.get_news(2026, "April")

    assert exc_info.value.reason == "challenge_detected"


def test_hltv_scraper_get_realtime_news_uses_short_cache_and_strict_mode():
    from hltv_scraper.cache_config import CACHE_HOURS_REALTIME_NEWS

    mock_manager = Mock()
    mock_manager.get_result.return_value = [
        {"title": "Realtime item", "section": "today", "relative_time": "15 minutes ago"}
    ]

    with patch("hltv_scraper.HLTVScraper._get_manager", return_value=mock_manager):
        result = HLTVScraper.get_realtime_news()

    assert result == [
        {"title": "Realtime item", "section": "today", "relative_time": "15 minutes ago"}
    ]
    mock_manager.execute.assert_called_once_with(
        "hltv_realtime_news",
        "news/realtime_news",
        "-o data/news/realtime_news.json",
        CACHE_HOURS_REALTIME_NEWS,
        strict=True,
    )
    mock_manager.get_result.assert_called_once_with("news/realtime_news", strict=True)


def test_hltv_scraper_get_realtime_news_raises_content_error_when_empty():
    from hltv_scraper.errors import NewsScrapeContentError

    mock_manager = Mock()
    mock_manager.execute.return_value = None
    mock_manager.get_result.return_value = []

    with patch("hltv_scraper.HLTVScraper._get_manager", return_value=mock_manager):
        with pytest.raises(NewsScrapeContentError) as exc_info:
            HLTVScraper.get_realtime_news()

    assert exc_info.value.reason == "empty_content"
    assert str(exc_info.value) == "Realtime news scrape returned empty content."


def test_hltv_realtime_news_spider_fetches_live_news_page():
    from hltv_scraper.hltv_scraper.spiders.hltv_realtime_news import HltvRealtimeNewsSpider

    response = HtmlResponse(
        url="https://www.hltv.org/news",
        request=Request(url="https://www.hltv.org/news"),
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

    mock_fetch.assert_called_once_with("https://www.hltv.org/news")
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
