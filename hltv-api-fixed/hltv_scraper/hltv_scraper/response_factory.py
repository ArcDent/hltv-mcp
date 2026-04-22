from scrapy.http import HtmlResponse, Request


def build_html_response(url: str, html: str) -> HtmlResponse:
    return HtmlResponse(
        url=url,
        request=Request(url=url),
        body=html.encode("utf-8"),
        encoding="utf-8",
    )
