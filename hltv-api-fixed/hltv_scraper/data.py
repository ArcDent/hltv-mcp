from abc import ABC, abstractmethod
import json
import os

from .errors import NewsScrapeOutputError


class DataLoader(ABC):
    @abstractmethod
    def load(self, file: str) -> dict:
        pass


class JsonDataLoader(DataLoader):
    def load(self, file: str, strict: bool = False) -> dict:
        try:
            if not os.path.exists(file):
                if strict:
                    raise NewsScrapeOutputError(
                        "News scrape produced no output for the requested archive period."
                    )
                return {}

            with open(file, "r") as json_file:
                return json.load(json_file)
        except Exception as e:
            if strict:
                raise NewsScrapeOutputError(
                    "News scrape produced no output for the requested archive period."
                ) from e
            print(f"Error loading JSON file {file}: {e}")
            return {}
