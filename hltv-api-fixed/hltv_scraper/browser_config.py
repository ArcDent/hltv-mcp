import os
from dataclasses import dataclass


def _get_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _get_int(name: str, default: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    return int(raw)


@dataclass(frozen=True)
class BrowserRuntimeConfig:
    headless: bool
    timeout_seconds: int
    page_load_timeout_seconds: int
    chrome_binary_path: str | None
    chromedriver_path: str | None
    disable_sandbox: bool


def get_browser_runtime_config() -> BrowserRuntimeConfig:
    return BrowserRuntimeConfig(
        headless=_get_bool("HLTV_BROWSER_HEADLESS", True),
        timeout_seconds=_get_int("HLTV_BROWSER_TIMEOUT_SECONDS", 20),
        page_load_timeout_seconds=_get_int("HLTV_BROWSER_PAGELOAD_TIMEOUT_SECONDS", 30),
        chrome_binary_path=os.getenv("HLTV_CHROME_BINARY_PATH"),
        chromedriver_path=os.getenv("HLTV_CHROMEDRIVER_PATH"),
        disable_sandbox=_get_bool("HLTV_BROWSER_DISABLE_SANDBOX", True),
    )
