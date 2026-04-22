from dataclasses import dataclass

from selenium import webdriver
from selenium.common.exceptions import TimeoutException, WebDriverException
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from .browser_config import BrowserRuntimeConfig, get_browser_runtime_config
from .errors import NewsScrapeFetchError


@dataclass(frozen=True)
class BrowserFetchResult:
    final_url: str
    html: str


class BrowserHTMLFetcher:
    def __init__(self, config: BrowserRuntimeConfig | None = None) -> None:
        self.config = config or get_browser_runtime_config()

    def _build_driver(self):
        options = Options()
        if self.config.headless:
            options.add_argument("--headless=new")
        options.add_argument("--disable-dev-shm-usage")
        if self.config.disable_sandbox:
            options.add_argument("--no-sandbox")
        options.add_argument(
            "--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36"
        )
        if self.config.chrome_binary_path:
            options.binary_location = self.config.chrome_binary_path

        service = (
            Service(executable_path=self.config.chromedriver_path)
            if self.config.chromedriver_path
            else Service()
        )
        driver = webdriver.Chrome(service=service, options=options)
        driver.set_page_load_timeout(self.config.page_load_timeout_seconds)
        return driver

    def _build_wait(self, driver):
        return WebDriverWait(driver, self.config.timeout_seconds)

    def _wait_until_ready(self, driver, wait) -> None:
        wait.until(
            lambda current_driver: (
                len(current_driver.find_elements(By.CSS_SELECTOR, "a.newsline.article"))
                > 0
                or len(
                    current_driver.find_elements(
                        By.CSS_SELECTOR,
                        'script[type="application/ld+json"]',
                    )
                )
                > 0
            )
        )

    def fetch(self, url: str) -> BrowserFetchResult:
        try:
            driver = self._build_driver()
        except WebDriverException as exc:
            raise NewsScrapeFetchError(
                "Browser fetch setup failed for the news archive page.",
                reason="browser_fetch_failed",
            ) from exc

        try:
            driver.get(url)
            wait = self._build_wait(driver)
            self._wait_until_ready(driver, wait)
            return BrowserFetchResult(
                final_url=driver.current_url,
                html=driver.page_source,
            )
        except TimeoutException as exc:
            raise NewsScrapeFetchError(
                "Browser fetch timed out while waiting for the news archive page.",
                reason="browser_timeout",
            ) from exc
        except WebDriverException as exc:
            raise NewsScrapeFetchError(
                "Browser fetch failed for the news archive page.",
                reason="browser_fetch_failed",
            ) from exc
        finally:
            driver.quit()
