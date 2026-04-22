class NewsScrapeProcessError(Exception):
    def __init__(self, message: str, reason: str = "process_failed") -> None:
        super().__init__(message)
        self.reason = reason


class NewsScrapeOutputError(Exception):
    def __init__(self, message: str, reason: str = "missing_output") -> None:
        super().__init__(message)
        self.reason = reason


class NewsScrapeContentError(Exception):
    def __init__(self, message: str, reason: str = "empty_content") -> None:
        super().__init__(message)
        self.reason = reason


class NewsScrapeFetchError(Exception):
    def __init__(
        self,
        message: str,
        reason: str = "browser_fetch_failed",
    ) -> None:
        super().__init__(message)
        self.reason = reason
