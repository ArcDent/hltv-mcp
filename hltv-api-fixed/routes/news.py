from flask import Blueprint, Response, jsonify, request
from typing import Optional
from flasgger import swag_from

from hltv_scraper import HLTVScraper
from hltv_scraper.errors import (
    NewsScrapeContentError,
    NewsScrapeFetchError,
    NewsScrapeOutputError,
    NewsScrapeProcessError,
)

news_bp = Blueprint("news", __name__, url_prefix="/api/v1/news")


@news_bp.route("/realtime")
def realtime_news() -> Response | tuple[Response, int]:
    """Get realtime/latest news from HLTV's live news feed."""
    try:
        data = HLTVScraper.get_realtime_news()
        return jsonify(data)
    except NewsScrapeProcessError as e:
        return (
            jsonify(
                {
                    "error": "news_scrape_failed",
                    "reason": e.reason,
                    "message": str(e),
                    "scope": "realtime",
                }
            ),
            500,
        )
    except (
        NewsScrapeOutputError,
        NewsScrapeContentError,
        NewsScrapeFetchError,
    ) as e:
        return (
            jsonify(
                {
                    "error": "news_scrape_failed",
                    "reason": e.reason,
                    "message": str(e),
                    "scope": "realtime",
                }
            ),
            502,
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@news_bp.route("", defaults={"year": None, "month": None})
@news_bp.route("/<int:year>/<string:month>/")
@swag_from("../swagger_specs/news_list.yml")
def news(
    year: Optional[int] = None, month: Optional[str] = None
) -> Response | tuple[Response, int]:
    """Get news from HLTV."""
    if year is None or month is None:
        from datetime import datetime

        now = datetime.now()
        year = now.year
        month = now.strftime("%B")

    try:
        is_paginated_mode = "limit" in request.args or "offset" in request.args

        if is_paginated_mode:
            limit_raw = request.args.get("limit", "50")
            try:
                limit = int(limit_raw)
                if limit <= 0:
                    raise ValueError
            except (TypeError, ValueError):
                return (
                    jsonify(
                        {
                            "error": "invalid_pagination",
                            "message": "Query parameter 'limit' must be a positive integer.",
                        }
                    ),
                    400,
                )

            offset_raw = request.args.get("offset", "0")
            try:
                offset = int(offset_raw)
                if offset < 0:
                    raise ValueError
            except (TypeError, ValueError):
                return (
                    jsonify(
                        {
                            "error": "invalid_pagination",
                            "message": "Query parameter 'offset' must be a non-negative integer.",
                        }
                    ),
                    400,
                )

            data = HLTVScraper.get_news_page(
                year=year,
                month=month,
                limit=limit,
                offset=offset,
            )
        else:
            data = HLTVScraper.get_news(year, month)

        return jsonify(data)
    except NewsScrapeProcessError as e:
        return (
            jsonify(
                {
                    "error": "news_scrape_failed",
                    "reason": e.reason,
                    "message": str(e),
                    "year": year,
                    "month": month,
                }
            ),
            500,
        )
    except (
        NewsScrapeOutputError,
        NewsScrapeContentError,
        NewsScrapeFetchError,
    ) as e:
        return (
            jsonify(
                {
                    "error": "news_scrape_failed",
                    "reason": e.reason,
                    "message": str(e),
                    "year": year,
                    "month": month,
                }
            ),
            502,
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500
