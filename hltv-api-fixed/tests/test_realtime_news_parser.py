import pytest
from scrapy.http import HtmlResponse, Request

from hltv_scraper.errors import NewsScrapeContentError
from hltv_scraper.hltv_scraper.realtime_news_content import extract_realtime_news
from hltv_scraper.hltv_scraper.spiders.parsers.realtime_news import RealtimeNewsParser


def _response_from_html(
    html: str,
    url: str = "https://www.hltv.org/news",
) -> HtmlResponse:
    request = Request(url=url)
    return HtmlResponse(
        url=url,
        request=request,
        body=html.encode("utf-8"),
        encoding="utf-8",
    )


def test_extract_realtime_news_parses_grouped_live_rows():
    response = _response_from_html(
        """
        <html>
          <body>
            <h2>Today's news</h2>
            <a class="newsline article" href="/news/43001/bcg-masters-championship-2">
              <span class="newsitemCategory">Portugal</span>
              <div class="newstext">BCG Masters Championship 2 to be held in Vila Nova de Gaia</div>
              <div class="newsrecent">15 minutes ago</div>
              <div class="newstc"><div></div><div>7 comments</div></div>
            </a>
            <a class="newsline article" href="/news/43000/valve-release-more-animgraph-2-tweaks">
              <span class="newsitemCategory">Game update</span>
              <div class="newstext">Short: Valve release more Animgraph 2 tweaks</div>
              <div class="newsrecent">an hour ago</div>
              <div class="newstc"><div></div><div>24 comments</div></div>
            </a>
            <h2>Yesterday's news</h2>
            <a class="newsline article" href="/news/42990/valve-tease-cache-addition">
              <span class="newsitemCategory">Counter-Strike</span>
              <div class="newstext">Valve tease Cache addition</div>
              <div class="newsrecent">20 hours ago</div>
              <div class="newstc"><div></div><div>52 comments</div></div>
            </a>
          </body>
        </html>
        """
    )

    assert extract_realtime_news(response) == [
        {
            "section": "today",
            "category": "Portugal",
            "title": "BCG Masters Championship 2 to be held in Vila Nova de Gaia",
            "relative_time": "15 minutes ago",
            "comments": "7 comments",
            "link": "https://www.hltv.org/news/43001/bcg-masters-championship-2",
            "summary_hint": None,
        },
        {
            "section": "today",
            "category": "Game update",
            "title": "Short: Valve release more Animgraph 2 tweaks",
            "relative_time": "an hour ago",
            "comments": "24 comments",
            "link": "https://www.hltv.org/news/43000/valve-release-more-animgraph-2-tweaks",
            "summary_hint": None,
        },
        {
            "section": "yesterday",
            "category": "Counter-Strike",
            "title": "Valve tease Cache addition",
            "relative_time": "20 hours ago",
            "comments": "52 comments",
            "link": "https://www.hltv.org/news/42990/valve-tease-cache-addition",
            "summary_hint": None,
        },
    ]


def test_realtime_news_parser_returns_extracted_live_rows():
    response = _response_from_html(
        """
        <html>
          <body>
            <h2>Today's news</h2>
            <a class="newsline article" href="/news/43001/bcg-masters-championship-2">
              <span class="newsitemCategory">Portugal</span>
              <div class="newstext">BCG Masters Championship 2 to be held in Vila Nova de Gaia</div>
              <div class="newsrecent">15 minutes ago</div>
            </a>
          </body>
        </html>
        """
    )

    assert RealtimeNewsParser.parse(response) == [
        {
            "section": "today",
            "category": "Portugal",
            "title": "BCG Masters Championship 2 to be held in Vila Nova de Gaia",
            "relative_time": "15 minutes ago",
            "comments": None,
            "link": "https://www.hltv.org/news/43001/bcg-masters-championship-2",
            "summary_hint": None,
        }
    ]


def test_extract_realtime_news_parses_feature_cards_with_summary_hint():
    response = _response_from_html(
        """
        <html>
          <body>
            <div class="standard-box">
              <div class="newsheader">Previous news</div>
              <a class="newsline article" href="/news/42900/hltv-prospects-april-2026">
                <div class="newstext">HLTV Prospects: April 2026</div>
                <div class="newsrecent">2 days ago</div>
                <p class="news-preview">dziugss moves up to #1 after an excellent month.</p>
              </a>
            </div>
          </body>
        </html>
        """
    )

    assert extract_realtime_news(response) == [
        {
            "section": "previous",
            "category": None,
            "title": "HLTV Prospects: April 2026",
            "relative_time": "2 days ago",
            "comments": None,
            "link": "https://www.hltv.org/news/42900/hltv-prospects-april-2026",
            "summary_hint": "dziugss moves up to #1 after an excellent month.",
        }
    ]


def test_extract_realtime_news_parses_homepage_feature_card_and_live_rows():
    response = _response_from_html(
        """
        <html>
          <body>
            <h2>Today's news</h2>
            <a class="featured-article" href="/news/43010/stat-check-mouz-go-anchorless">
              <div class="featured-article-title">Stat Check: MOUZ go anchorless with another big bet on youth</div>
              <p>siuhy has found another way to trust young riflers.</p>
            </a>
            <a class="newsline article" href="/news/43001/bcg-masters-championship-2">
              <span class="newsitemCategory">Portugal</span>
              <div class="newstext">BCG Masters Championship 2 to be held in Vila Nova de Gaia</div>
              <div class="newsrecent">15 hours ago</div>
              <div class="newstc"><div></div><div>27 comments</div></div>
            </a>
            <a class="newsline article" href="/news/43000/valve-release-more-animgraph-2-tweaks">
              <span class="newsitemCategory">Other</span>
              <div class="newstext">Short: Valve release more Animgraph 2 tweaks</div>
              <div class="newsrecent">16 hours ago</div>
              <div class="newstc"><div></div><div>583 comments</div></div>
            </a>
            <h2>Yesterday's news</h2>
            <a class="newsline article" href="/news/42990/valve-tease-cache-addition">
              <span class="newsitemCategory">Counter-Strike</span>
              <div class="newstext">Valve tease Cache addition: &quot;What are you doing next week?&quot;</div>
              <div class="newsrecent">a day ago</div>
            </a>
          </body>
        </html>
        """,
        url="https://www.hltv.org/",
    )

    assert extract_realtime_news(response) == [
        {
            "section": "today",
            "category": None,
            "title": "Stat Check: MOUZ go anchorless with another big bet on youth",
            "relative_time": None,
            "comments": None,
            "link": "https://www.hltv.org/news/43010/stat-check-mouz-go-anchorless",
            "summary_hint": "siuhy has found another way to trust young riflers.",
        },
        {
            "section": "today",
            "category": "Portugal",
            "title": "BCG Masters Championship 2 to be held in Vila Nova de Gaia",
            "relative_time": "15 hours ago",
            "comments": "27 comments",
            "link": "https://www.hltv.org/news/43001/bcg-masters-championship-2",
            "summary_hint": None,
        },
        {
            "section": "today",
            "category": "Other",
            "title": "Short: Valve release more Animgraph 2 tweaks",
            "relative_time": "16 hours ago",
            "comments": "583 comments",
            "link": "https://www.hltv.org/news/43000/valve-release-more-animgraph-2-tweaks",
            "summary_hint": None,
        },
        {
            "section": "yesterday",
            "category": "Counter-Strike",
            "title": 'Valve tease Cache addition: "What are you doing next week?"',
            "relative_time": "a day ago",
            "comments": None,
            "link": "https://www.hltv.org/news/42990/valve-tease-cache-addition",
            "summary_hint": None,
        },
    ]


def test_realtime_news_parser_raises_content_error_when_no_rows_are_found():
    response = _response_from_html("<html><body><main>No live news here</main></body></html>")

    with pytest.raises(NewsScrapeContentError) as exc_info:
        RealtimeNewsParser.parse(response)

    assert exc_info.value.reason == "empty_content"
    assert str(exc_info.value) == "Realtime news page contained no parsable live news entries."
