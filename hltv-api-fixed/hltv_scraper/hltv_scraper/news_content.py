import json
from typing import Any


def extract_news_articles(response) -> list[dict[str, Any]]:
    css_articles = _parse_css_articles(response)
    if css_articles:
        return css_articles

    jsonld_articles = _parse_jsonld_articles(response)
    if jsonld_articles:
        return jsonld_articles

    return []


def _parse_css_articles(response) -> list[dict[str, Any]]:
    parsed_articles: list[dict[str, Any]] = []

    for article in response.css("a.newsline.article"):
        title = _clean(article.css(".newstext::text").get())
        link = article.css("::attr(href)").get()

        if not title and not link:
            continue

        parsed_articles.append(
            {
                "title": title,
                "img": article.css("img.newsflag::attr(src)").get(),
                "date": _clean(article.css("div.newsrecent::text").get()),
                "comments": _clean(
                    article.css("div.newstc div:nth-child(2)::text").get()
                ),
                "link": response.urljoin(link) if link else None,
            }
        )

    return parsed_articles


def _parse_jsonld_articles(response) -> list[dict[str, Any]]:
    parsed_articles: list[dict[str, Any]] = []

    for script in response.css('script[type="application/ld+json"]::text').getall():
        if not script or not script.strip():
            continue

        try:
            payload = json.loads(script)
        except json.JSONDecodeError:
            continue

        for item in _walk_json(payload):
            if not _is_news_article(item):
                continue

            image = item.get("image")
            if isinstance(image, list):
                image = image[0] if image else None
                if isinstance(image, dict):
                    image = image.get("url")
            elif isinstance(image, dict):
                image = image.get("url")

            link = item.get("url")
            if isinstance(link, dict):
                link = link.get("@id") or link.get("url")

            parsed_articles.append(
                {
                    "title": _clean(item.get("headline") or item.get("name")),
                    "img": image,
                    "date": item.get("datePublished") or item.get("dateCreated"),
                    "comments": item.get("commentCount"),
                    "link": link,
                }
            )

    return [
        article
        for article in parsed_articles
        if article.get("title") or article.get("link")
    ]


def _walk_json(data):
    if isinstance(data, list):
        for item in data:
            yield from _walk_json(item)
        return

    if not isinstance(data, dict):
        return

    yield data

    for nested_key in ("@graph", "itemListElement", "item"):
        nested = data.get(nested_key)
        if nested is not None:
            yield from _walk_json(nested)


def _is_news_article(item: dict[str, Any]) -> bool:
    item_type = item.get("@type")
    if isinstance(item_type, list):
        return "NewsArticle" in item_type
    return item_type == "NewsArticle"


def _clean(value: Any) -> Any:
    if isinstance(value, str):
        return value.strip()
    return value
