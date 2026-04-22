from scrapy.http import HtmlResponse


def test_browser_runtime_config_reads_environment(monkeypatch):
    monkeypatch.setenv("HLTV_BROWSER_HEADLESS", "false")
    monkeypatch.setenv("HLTV_BROWSER_TIMEOUT_SECONDS", "25")
    monkeypatch.setenv("HLTV_BROWSER_PAGELOAD_TIMEOUT_SECONDS", "35")
    monkeypatch.setenv("HLTV_CHROME_BINARY_PATH", "/opt/chrome")
    monkeypatch.setenv("HLTV_CHROMEDRIVER_PATH", "/opt/chromedriver")
    monkeypatch.setenv("HLTV_BROWSER_DISABLE_SANDBOX", "false")

    from hltv_scraper.browser_config import get_browser_runtime_config

    config = get_browser_runtime_config()

    assert config.headless is False
    assert config.timeout_seconds == 25
    assert config.page_load_timeout_seconds == 35
    assert config.chrome_binary_path == "/opt/chrome"
    assert config.chromedriver_path == "/opt/chromedriver"
    assert config.disable_sandbox is False


def test_news_http_fetcher_uses_firefox_windows_profile_for_better_archive_access(monkeypatch):
    from hltv_scraper.news_http_fetcher import fetch_news_archive_with_http_session

    captured_kwargs = {}

    class _FakeScraper:
        def __init__(self):
            self.headers = {}

        def get(self, url, timeout):
            response = Mock()
            response.url = url
            response.text = (
                "<html><body>"
                "<a class='newsline article' href='/news/555/http-profile-success'>"
                "<div class='newstext'>HTTP profile title</div>"
                "</a></body></html>"
            )
            return response

    def fake_create_scraper(**kwargs):
        captured_kwargs.update(kwargs)
        return _FakeScraper()

    monkeypatch.setattr(
        "hltv_scraper.news_http_fetcher.cloudscraper.create_scraper",
        fake_create_scraper,
    )

    response = fetch_news_archive_with_http_session(
        "https://www.hltv.org/news/archive/2026/April"
    )

    assert captured_kwargs == {
        "browser": {
            "browser": "firefox",
            "platform": "windows",
            "mobile": False,
        }
    }
    assert isinstance(response, HtmlResponse)
    assert "http-profile-success" in response.text


def test_news_http_fetcher_preserves_profile_user_agent(monkeypatch):
    from hltv_scraper.news_http_fetcher import fetch_news_archive_with_http_session

    class _FakeScraper:
        def __init__(self):
            self.headers = {
                "User-Agent": "profile-firefox-ua",
            }

        def get(self, url, timeout):
            response = Mock()
            response.url = url
            response.text = (
                "<html><body>"
                "<a class='newsline article' href='/news/556/http-profile-ua'>"
                "<div class='newstext'>HTTP profile UA title</div>"
                "</a></body></html>"
            )
            return response

    scraper = _FakeScraper()

    monkeypatch.setattr(
        "hltv_scraper.news_http_fetcher.cloudscraper.create_scraper",
        lambda **kwargs: scraper,
    )

    response = fetch_news_archive_with_http_session(
        "https://www.hltv.org/news/archive/2026/April"
    )

    assert scraper.headers["User-Agent"] == "profile-firefox-ua"
    assert scraper.headers["Accept-Language"] == "en-US,en;q=0.9"
    assert isinstance(response, HtmlResponse)
    assert "http-profile-ua" in response.text


def test_html_response_factory_builds_scrapy_html_response():
    from hltv_scraper.response_factory import build_html_response

    response = build_html_response(
        url="https://www.hltv.org/news/archive/2026/April",
        html="<html><body><a class='newsline article'>ok</a></body></html>",
    )

    assert isinstance(response, HtmlResponse)
    assert response.url == "https://www.hltv.org/news/archive/2026/April"
    assert "newsline article" in response.text


def test_browser_helpers_import_from_scrapy_cwd_package_layout():
    import os
    import subprocess
    import sys
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[1]
    scrapy_cwd = project_root / "hltv_scraper"
    subprocess_env = dict(os.environ)
    subprocess_env.update(
        {
            "HLTV_BROWSER_HEADLESS": "false",
            "HLTV_BROWSER_TIMEOUT_SECONDS": "25",
            "HLTV_BROWSER_PAGELOAD_TIMEOUT_SECONDS": "35",
            "HLTV_CHROME_BINARY_PATH": "/opt/chrome",
            "HLTV_CHROMEDRIVER_PATH": "/opt/chromedriver",
            "HLTV_BROWSER_DISABLE_SANDBOX": "false",
        }
    )

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from hltv_scraper.browser_config import get_browser_runtime_config; "
                "from hltv_scraper.response_factory import build_html_response; "
                "config = get_browser_runtime_config(); "
                "response = build_html_response("
                "url='https://www.hltv.org/news/archive/2026/April', "
                "html=\"<html><body><a class='newsline article'>ok</a></body></html>\""
                "); "
                "print('|'.join(["
                "str(config.headless), "
                "str(config.timeout_seconds), "
                "str(config.page_load_timeout_seconds), "
                "str(config.chrome_binary_path), "
                "str(config.chromedriver_path), "
                "str(config.disable_sandbox), "
                "response.url, "
                "str('newsline article' in response.text)"
                "]))"
            ),
        ],
        cwd=scrapy_cwd,
        env=subprocess_env,
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == (
        "False|25|35|/opt/chrome|/opt/chromedriver|False|"
        "https://www.hltv.org/news/archive/2026/April|True"
    )


def test_browser_fetcher_imports_from_scrapy_cwd_package_layout():
    import os
    import subprocess
    import sys
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[1]
    scrapy_cwd = project_root / "hltv_scraper"

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from hltv_scraper.browser_fetcher import BrowserHTMLFetcher; "
                "print(BrowserHTMLFetcher.__name__)"
            ),
        ],
        cwd=scrapy_cwd,
        env=dict(os.environ),
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "BrowserHTMLFetcher"


def test_challenge_fetcher_imports_from_scrapy_cwd_package_layout():
    import os
    import subprocess
    import sys
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[1]
    scrapy_cwd = project_root / "hltv_scraper"

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from hltv_scraper.challenge_fetcher import fetch_hltv_page; "
                "print(fetch_hltv_page.__name__)"
            ),
        ],
        cwd=scrapy_cwd,
        env=dict(os.environ),
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "fetch_hltv_page"


def test_challenge_fetcher_from_scrapy_cwd_rejects_generic_json_ld_browser_html():
    import os
    import subprocess
    import sys
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[1]
    scrapy_cwd = project_root / "hltv_scraper"
    script = """
from types import SimpleNamespace
import hltv_scraper.challenge_fetcher as challenge_fetcher
from hltv_scraper.errors import NewsScrapeFetchError


def fake_fetch(self, url):
    return SimpleNamespace(
        final_url=url,
        html=(
            '<html><head><script type="application/ld+json">'
            '{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[]}'
            '</script></head><body><h1>Access denied</h1></body></html>'
        ),
    )


def fake_http(url):
    raise NewsScrapeFetchError(
        "HTTP session hit a challenge page.",
        reason="challenge_detected",
    )


challenge_fetcher.fetch_news_archive_with_http_session = fake_http
challenge_fetcher.BrowserHTMLFetcher.fetch = fake_fetch

try:
    challenge_fetcher.fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")
except NewsScrapeFetchError as exc:
    print(f"ERR:{exc.reason}")
else:
    print("OK")
"""

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            script,
        ],
        cwd=scrapy_cwd,
        env=dict(os.environ),
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "ERR:challenge_detected"


def test_challenge_fetcher_from_scrapy_cwd_rejects_cloudflare_script_only_browser_html():
    import os
    import subprocess
    import sys
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[1]
    scrapy_cwd = project_root / "hltv_scraper"
    script = """
from types import SimpleNamespace
import hltv_scraper.challenge_fetcher as challenge_fetcher
from hltv_scraper.errors import NewsScrapeFetchError


def fake_fetch(self, url):
    return SimpleNamespace(
        final_url=url,
        html=(
            '<html><head>'
            '<script>window.__CF$cv$params = {r: "abc111", m: "token"};</script>'
            '<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'
            '</head><body><h1>Access denied</h1></body></html>'
        ),
    )


def fake_http(url):
    raise NewsScrapeFetchError(
        "HTTP session hit a challenge page.",
        reason="challenge_detected",
    )


challenge_fetcher.fetch_news_archive_with_http_session = fake_http
challenge_fetcher.BrowserHTMLFetcher.fetch = fake_fetch

try:
    challenge_fetcher.fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")
except NewsScrapeFetchError as exc:
    print(f"ERR:{exc.reason}")
else:
    print("OK")
"""

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            script,
        ],
        cwd=scrapy_cwd,
        env=dict(os.environ),
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "ERR:challenge_detected"


def test_challenge_fetcher_from_scrapy_cwd_accepts_mixed_content_with_cloudflare_script_markers():
    import os
    import subprocess
    import sys
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[1]
    scrapy_cwd = project_root / "hltv_scraper"
    script = """
from types import SimpleNamespace
import hltv_scraper.challenge_fetcher as challenge_fetcher
from hltv_scraper.errors import NewsScrapeFetchError


def fake_fetch(self, url):
    return SimpleNamespace(
        final_url=url,
        html=(
            '<html><head>'
            '<script>window.__CF$cv$params = {r: "def222", m: "token"};</script>'
            '<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>'
            '</head><body>'
            '<a class="newsline article" href="/news/999/mixed-content-ok">'
            '<div class="newstext">Mixed content title</div>'
            '</a>'
            '</body></html>'
        ),
    )


def fake_http(url):
    raise NewsScrapeFetchError(
        "HTTP session hit a challenge page.",
        reason="challenge_detected",
    )


challenge_fetcher.fetch_news_archive_with_http_session = fake_http
challenge_fetcher.BrowserHTMLFetcher.fetch = fake_fetch

try:
    response = challenge_fetcher.fetch_hltv_page(
        "https://www.hltv.org/news/archive/2026/April"
    )
except NewsScrapeFetchError as exc:
    print(f"ERR:{exc.reason}")
else:
    print(f"OK:{'newsline article' in response.text}")
"""

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            script,
        ],
        cwd=scrapy_cwd,
        env=dict(os.environ),
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "OK:True"


from unittest.mock import Mock, patch

import pytest


def test_browser_html_fetcher_returns_page_source_and_final_url():
    from hltv_scraper.browser_fetcher import BrowserHTMLFetcher

    driver = Mock()
    driver.current_url = "https://www.hltv.org/news/archive/2026/April"
    driver.page_source = "<html><body><a class='newsline article'>ok</a></body></html>"

    wait = Mock()
    wait.until.return_value = True

    fetcher = BrowserHTMLFetcher()

    with patch.object(fetcher, "_build_driver", return_value=driver):
        with patch.object(fetcher, "_build_wait", return_value=wait):
            result = fetcher.fetch("https://www.hltv.org/news/archive/2026/April")

    assert result.final_url == driver.current_url
    assert "newsline article" in result.html
    driver.get.assert_called_once_with("https://www.hltv.org/news/archive/2026/April")
    driver.quit.assert_called_once()


test_browser_html_fetcher_returns_page_source_and_final_url.BrowserHTMLFetcher = True


def test_browser_html_fetcher_raises_browser_timeout_on_wait_timeout():
    from selenium.common.exceptions import TimeoutException
    from hltv_scraper.browser_fetcher import BrowserHTMLFetcher
    from hltv_scraper.errors import NewsScrapeFetchError

    driver = Mock()
    driver.current_url = "https://www.hltv.org/news/archive/2026/April"
    driver.page_source = "<html><body>Just a moment...</body></html>"

    wait = Mock()
    wait.until.side_effect = TimeoutException("timed out")

    fetcher = BrowserHTMLFetcher()

    with patch.object(fetcher, "_build_driver", return_value=driver):
        with patch.object(fetcher, "_build_wait", return_value=wait):
            with pytest.raises(NewsScrapeFetchError) as exc_info:
                fetcher.fetch("https://www.hltv.org/news/archive/2026/April")

    assert exc_info.value.reason == "browser_timeout"
    driver.quit.assert_called_once()


test_browser_html_fetcher_raises_browser_timeout_on_wait_timeout.BrowserHTMLFetcher = (
    True
)


def test_browser_html_fetcher_succeeds_when_newsline_marker_is_present():
    from selenium.common.exceptions import TimeoutException
    from selenium.webdriver.common.by import By
    from hltv_scraper.browser_fetcher import BrowserHTMLFetcher

    url = "https://www.hltv.org/news/archive/2026/April"
    driver = Mock()
    driver.current_url = url
    driver.page_source = "<html><body><a class='newsline article'>ok</a></body></html>"

    def _find_elements(by, selector):
        if by == By.CSS_SELECTOR and selector == "a.newsline.article":
            return [Mock()]
        if by == By.CSS_SELECTOR and selector == 'script[type="application/ld+json"]':
            return []
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
    assert "newsline article" in result.html
    driver.quit.assert_called_once()


test_browser_html_fetcher_succeeds_when_newsline_marker_is_present.BrowserHTMLFetcher = True


def test_browser_html_fetcher_times_out_when_challenge_text_disappears_without_content_markers():
    from selenium.common.exceptions import TimeoutException
    from hltv_scraper.browser_fetcher import BrowserHTMLFetcher
    from hltv_scraper.errors import NewsScrapeFetchError

    url = "https://www.hltv.org/news/archive/2026/April"
    driver = Mock()
    driver.current_url = url
    driver.page_source = "<html><body><h1>Access denied</h1></body></html>"
    driver.find_elements.return_value = []

    class _SingleCheckWait:
        def __init__(self, current_driver):
            self.current_driver = current_driver

        def until(self, condition):
            if not condition(self.current_driver):
                raise TimeoutException("timed out")
            return True

    fetcher = BrowserHTMLFetcher()

    with patch.object(fetcher, "_build_driver", return_value=driver):
        with patch.object(
            fetcher, "_build_wait", return_value=_SingleCheckWait(driver)
        ):
            with pytest.raises(NewsScrapeFetchError) as exc_info:
                fetcher.fetch(url)

    assert exc_info.value.reason == "browser_timeout"
    driver.quit.assert_called_once()


test_browser_html_fetcher_times_out_when_challenge_text_disappears_without_content_markers.BrowserHTMLFetcher = True


def test_http_first_short_circuits_browser_when_http_content_is_parseable():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.response_factory import build_html_response

    http_response = build_html_response(
        url="https://www.hltv.org/news/archive/2026/April",
        html="""
        <html>
          <body>
            <a class="newsline article" href="/news/321/http-first-success">
              <div class="newstext">HTTP first title</div>
            </a>
          </body>
        </html>
        """,
    )

    with patch(
        "hltv_scraper.challenge_fetcher.fetch_news_archive_with_http_session",
        return_value=http_response,
        create=True,
    ) as mock_http_fetch:
        with patch(
            "hltv_scraper.challenge_fetcher.BrowserHTMLFetcher.fetch",
            side_effect=AssertionError(
                "Browser fetch must not run when HTTP content is parseable."
            ),
        ):
            response = fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert response.url == "https://www.hltv.org/news/archive/2026/April"
    assert "http-first-success" in response.text
    mock_http_fetch.assert_called_once_with(
        "https://www.hltv.org/news/archive/2026/April"
    )


def test_scrapy_cwd_runtime_path_short_circuits_browser_when_http_content_is_parseable():
    import os
    import subprocess
    import sys
    from pathlib import Path

    project_root = Path(__file__).resolve().parents[1]
    scrapy_cwd = project_root / "hltv_scraper"
    script = """
from scrapy.http import HtmlResponse
from hltv_scraper.response_factory import build_html_response
import hltv_scraper.challenge_fetcher as challenge_fetcher


def fake_http(url):
    return build_html_response(
        url=url,
        html=(
            '<html><body>'
            '<a class="newsline article" href="/news/777/scrapy-cwd-http-first">'
            '<div class="newstext">Scrapy cwd HTTP title</div>'
            '</a>'
            '</body></html>'
        ),
    )


def fake_browser(self, url):
    raise AssertionError(
        'Browser fetch must not run when Scrapy-cwd HTTP content is parseable.'
    )


challenge_fetcher.fetch_news_archive_with_http_session = fake_http
challenge_fetcher.BrowserHTMLFetcher.fetch = fake_browser

response = challenge_fetcher.fetch_hltv_page(
    'https://www.hltv.org/news/archive/2026/April'
)
print(f"OK:{isinstance(response, HtmlResponse)}:{'scrapy-cwd-http-first' in response.text}")
"""

    result = subprocess.run(
        [
            sys.executable,
            "-c",
            script,
        ],
        cwd=scrapy_cwd,
        env=dict(os.environ),
        capture_output=True,
        text=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == "OK:True:True"


def test_blocked_http_falls_back_to_browser_and_returns_parseable_html():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.browser_fetcher import BrowserFetchResult
    from hltv_scraper.errors import NewsScrapeFetchError

    browser_result = BrowserFetchResult(
        final_url="https://www.hltv.org/news/archive/2026/April",
        html="""
        <html>
          <body>
            <a class="newsline article" href="/news/654/browser-fallback-success">
              <div class="newstext">Browser fallback title</div>
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
        create=True,
    ) as mock_http_fetch:
        with patch(
            "hltv_scraper.challenge_fetcher.BrowserHTMLFetcher.fetch",
            return_value=browser_result,
        ) as mock_browser_fetch:
            response = fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert response.url == "https://www.hltv.org/news/archive/2026/April"
    assert "browser-fallback-success" in response.text
    mock_http_fetch.assert_called_once_with(
        "https://www.hltv.org/news/archive/2026/April"
    )
    mock_browser_fetch.assert_called_once_with(
        "https://www.hltv.org/news/archive/2026/April"
    )


def test_fetch_hltv_page_returns_html_response_from_browser_result():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.browser_fetcher import BrowserFetchResult
    from hltv_scraper.errors import NewsScrapeFetchError

    browser_result = BrowserFetchResult(
        final_url="https://www.hltv.org/news/archive/2026/April",
        html=(
            "<html><body>"
            "<a class='newsline article' href='/news/111/browser-success'>"
            "<div class='newstext'>Browser success</div>"
            "</a></body></html>"
        ),
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
            response = fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert response.url == "https://www.hltv.org/news/archive/2026/April"
    assert "newsline article" in response.text


def test_fetch_hltv_page_has_html_response_return_annotation():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page

    assert fetch_hltv_page.__annotations__.get("return") is HtmlResponse


def test_fetch_hltv_page_raises_challenge_detected_when_browser_result_is_still_blocked():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.browser_fetcher import BrowserFetchResult
    from hltv_scraper.errors import NewsScrapeFetchError

    browser_result = BrowserFetchResult(
        final_url="https://www.hltv.org/news/archive/2026/April",
        html="<html><head><title>Just a moment...</title></head></html>",
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
            with pytest.raises(NewsScrapeFetchError) as exc_info:
                fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert exc_info.value.reason == "challenge_detected"


def test_fetch_hltv_page_raises_challenge_detected_when_browser_result_has_generic_json_ld_only():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.browser_fetcher import BrowserFetchResult
    from hltv_scraper.errors import NewsScrapeFetchError

    browser_result = BrowserFetchResult(
        final_url="https://www.hltv.org/news/archive/2026/April",
        html="""
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": []
              }
            </script>
          </head>
          <body><h1>Access denied</h1></body>
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
            with pytest.raises(NewsScrapeFetchError) as exc_info:
                fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert exc_info.value.reason == "challenge_detected"


def test_fetch_hltv_page_raises_challenge_detected_when_browser_result_has_cloudflare_script_markers_only():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.browser_fetcher import BrowserFetchResult
    from hltv_scraper.errors import NewsScrapeFetchError

    browser_result = BrowserFetchResult(
        final_url="https://www.hltv.org/news/archive/2026/April",
        html="""
        <html>
          <head>
            <script>
              window.__CF$cv$params = {r: "abc999", m: "token"};
            </script>
            <script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>
          </head>
          <body><h1>Access denied</h1></body>
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
            with pytest.raises(NewsScrapeFetchError) as exc_info:
                fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert exc_info.value.reason == "challenge_detected"
    assert str(exc_info.value) == "HTTP session hit a challenge page."


def test_fetch_hltv_page_accepts_browser_html_when_articles_exist_alongside_cloudflare_markers():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.browser_fetcher import BrowserFetchResult
    from hltv_scraper.errors import NewsScrapeFetchError

    browser_result = BrowserFetchResult(
        final_url="https://www.hltv.org/news/archive/2026/April",
        html="""
        <html>
          <head>
            <script>
              window.__CF$cv$params = {r: "abc123", m: "token"};
            </script>
            <script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>
          </head>
          <body>
            <a class="newsline article" href="/news/123/mixed-content-ok">
              <div class="newstext">Mixed content title</div>
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
            response = fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert response.url == "https://www.hltv.org/news/archive/2026/April"
    assert "newsline article" in response.text


def test_fetch_hltv_page_accepts_fallback_html_when_articles_exist_alongside_cloudflare_markers():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.errors import NewsScrapeFetchError
    from hltv_scraper.response_factory import build_html_response

    fallback_response = build_html_response(
        url="https://www.hltv.org/news/archive/2026/April",
        html="""
        <html>
          <head>
            <script>
              window.__CF$cv$params = {r: "def456", m: "token"};
            </script>
            <script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>
          </head>
          <body>
            <a class="newsline article" href="/news/456/fallback-mixed-content-ok">
              <div class="newstext">Fallback mixed content title</div>
            </a>
          </body>
        </html>
        """,
    )

    with patch(
        "hltv_scraper.challenge_fetcher.fetch_news_archive_with_http_session",
        side_effect=[
            NewsScrapeFetchError("timed out", reason="browser_timeout"),
            fallback_response,
        ],
    ):
        with patch(
            "hltv_scraper.challenge_fetcher.BrowserHTMLFetcher.fetch",
            side_effect=NewsScrapeFetchError(
                "timed out",
                reason="browser_timeout",
            ),
        ):
            response = fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert response.url == "https://www.hltv.org/news/archive/2026/April"
    assert "newsline article" in response.text


def test_fetch_hltv_page_uses_cloudscraper_fallback_after_browser_timeout():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.errors import NewsScrapeFetchError
    from hltv_scraper.response_factory import build_html_response

    fallback_response = build_html_response(
        url="https://www.hltv.org/news/archive/2026/April",
        html=(
            "<html><body>"
            "<a class='newsline article' href='/news/222/http-retry-success'>"
            "<div class='newstext'>Retry success</div>"
            "</a></body></html>"
        ),
    )

    with patch(
        "hltv_scraper.challenge_fetcher.fetch_news_archive_with_http_session",
        side_effect=[
            NewsScrapeFetchError("timed out", reason="browser_timeout"),
            fallback_response,
        ],
    ) as mock_http_fetch:
        with patch(
            "hltv_scraper.challenge_fetcher.BrowserHTMLFetcher.fetch",
            side_effect=NewsScrapeFetchError(
                "timed out",
                reason="browser_timeout",
            ),
        ):
            response = fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert "http-retry-success" in response.text
    assert mock_http_fetch.call_count == 2


def test_fetch_hltv_page_uses_cloudscraper_fallback_after_browser_fetch_failed():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.errors import NewsScrapeFetchError
    from hltv_scraper.response_factory import build_html_response

    fallback_response = build_html_response(
        url="https://www.hltv.org/news/archive/2026/April",
        html=(
            "<html><body>"
            "<a class='newsline article' href='/news/333/http-retry-success'>"
            "<div class='newstext'>Retry success</div>"
            "</a></body></html>"
        ),
    )

    with patch(
        "hltv_scraper.challenge_fetcher.fetch_news_archive_with_http_session",
        side_effect=[
            NewsScrapeFetchError("timed out", reason="browser_timeout"),
            fallback_response,
        ],
    ) as mock_http_fetch:
        with patch(
            "hltv_scraper.challenge_fetcher.BrowserHTMLFetcher.fetch",
            side_effect=NewsScrapeFetchError(
                "browser error",
                reason="browser_fetch_failed",
            ),
        ):
            response = fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert "http-retry-success" in response.text
    assert mock_http_fetch.call_count == 2


def test_fetch_hltv_page_raises_fallback_failed_when_fallback_request_raises():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.errors import NewsScrapeFetchError

    with patch(
        "hltv_scraper.challenge_fetcher.fetch_news_archive_with_http_session",
        side_effect=NewsScrapeFetchError(
            "HTTP-session fetch failed for the news archive page.",
            reason="fallback_failed",
        ),
    ):
        with patch(
            "hltv_scraper.challenge_fetcher.BrowserHTMLFetcher.fetch",
            side_effect=NewsScrapeFetchError(
                "timed out",
                reason="browser_timeout",
            ),
        ):
            with pytest.raises(NewsScrapeFetchError) as exc_info:
                fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert exc_info.value.reason == "fallback_failed"


def test_fetch_hltv_page_raises_challenge_detected_when_fallback_is_still_blocked():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.errors import NewsScrapeFetchError
    from hltv_scraper.response_factory import build_html_response

    fallback_response = build_html_response(
        url="https://www.hltv.org/news/archive/2026/April",
        html="<html><head><title>Just a moment...</title></head></html>",
    )

    with patch(
        "hltv_scraper.challenge_fetcher.fetch_news_archive_with_http_session",
        side_effect=[
            NewsScrapeFetchError("timed out", reason="browser_timeout"),
            fallback_response,
        ],
    ):
        with patch(
            "hltv_scraper.challenge_fetcher.BrowserHTMLFetcher.fetch",
            side_effect=NewsScrapeFetchError(
                "timed out",
                reason="browser_timeout",
            ),
        ):
            with pytest.raises(NewsScrapeFetchError) as exc_info:
                fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert exc_info.value.reason == "challenge_detected"


def test_fetch_hltv_page_raises_challenge_detected_when_fallback_lacks_archive_markers():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.errors import NewsScrapeFetchError
    from hltv_scraper.response_factory import build_html_response

    fallback_response = build_html_response(
        url="https://www.hltv.org/news/archive/2026/April",
        html="<html><body><h1>Access denied</h1></body></html>",
    )

    with patch(
        "hltv_scraper.challenge_fetcher.fetch_news_archive_with_http_session",
        side_effect=[
            NewsScrapeFetchError("timed out", reason="browser_timeout"),
            fallback_response,
        ],
    ):
        with patch(
            "hltv_scraper.challenge_fetcher.BrowserHTMLFetcher.fetch",
            side_effect=NewsScrapeFetchError(
                "timed out",
                reason="browser_timeout",
            ),
        ):
            with pytest.raises(NewsScrapeFetchError) as exc_info:
                fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert exc_info.value.reason == "challenge_detected"


def test_fetch_hltv_page_raises_challenge_detected_when_fallback_has_generic_json_ld_only():
    from hltv_scraper.challenge_fetcher import fetch_hltv_page
    from hltv_scraper.errors import NewsScrapeFetchError
    from hltv_scraper.response_factory import build_html_response

    fallback_response = build_html_response(
        url="https://www.hltv.org/news/archive/2026/April",
        html="""
        <html>
          <head>
            <script type="application/ld+json">
              {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": []
              }
            </script>
          </head>
          <body><h1>Access denied</h1></body>
        </html>
        """,
    )

    with patch(
        "hltv_scraper.challenge_fetcher.fetch_news_archive_with_http_session",
        side_effect=[
            NewsScrapeFetchError("timed out", reason="browser_timeout"),
            fallback_response,
        ],
    ):
        with patch(
            "hltv_scraper.challenge_fetcher.BrowserHTMLFetcher.fetch",
            side_effect=NewsScrapeFetchError(
                "timed out",
                reason="browser_timeout",
            ),
        ):
            with pytest.raises(NewsScrapeFetchError) as exc_info:
                fetch_hltv_page("https://www.hltv.org/news/archive/2026/April")

    assert exc_info.value.reason == "challenge_detected"
