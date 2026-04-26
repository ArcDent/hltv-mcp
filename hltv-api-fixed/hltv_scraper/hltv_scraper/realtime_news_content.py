from typing import Any


SECTION_LABELS = {
    "today's news": "today",
    "today news": "today",
    "today": "today",
    "yesterday's news": "yesterday",
    "yesterday news": "yesterday",
    "yesterday": "yesterday",
    "previous news": "previous",
    "previous": "previous",
}


def extract_realtime_news(response) -> list[dict[str, Any]]:
    parsed_items: list[dict[str, Any]] = []
    current_section = "latest"

    for node in response.css("body *"):
        section = _section_from_node(node)
        if section:
            current_section = section
            continue

        if not _is_article_link(node):
            continue

        item = _parse_article(node, response, current_section)
        if item:
            parsed_items.append(item)

    return _dedupe_by_link_and_title(parsed_items)


def _section_from_node(node) -> str | None:
    text = _clean(" ".join(node.css("::text").getall()))
    if not text:
        return None

    normalized = text.lower().replace("’", "'")
    if normalized in SECTION_LABELS:
        return SECTION_LABELS[normalized]

    return None


def _is_article_link(node) -> bool:
    href = node.css("::attr(href)").get()
    if not href or "/news/" not in href:
        return False

    tag_name = getattr(getattr(node, "root", None), "tag", "")
    if tag_name != "a":
        return False

    classes = (node.css("::attr(class)").get() or "").lower()
    if "article" in classes or "news" in classes:
        return True

    return bool(_extract_title(node))


def _parse_article(node, response, section: str) -> dict[str, Any] | None:
    title = _extract_title(node)
    href = node.css("::attr(href)").get()

    if not title:
        return None

    return {
        "section": section,
        "category": _first_text(
            node,
            [
                ".newsitemCategory::text",
                ".news-category::text",
                ".category::text",
                ".flagAlign span::text",
                ".newsflag::attr(title)",
                "img.newsflag::attr(title)",
                "img.newsflag::attr(alt)",
            ],
        ),
        "title": title,
        "relative_time": _first_text(
            node,
            [
                ".newsrecent::text",
                ".news-time::text",
                "time::text",
                "time::attr(datetime)",
            ],
        ),
        "comments": _extract_comments(node),
        "link": response.urljoin(href) if href else None,
        "summary_hint": _first_text(
            node,
            [
                ".news-preview::text",
                ".news-summary::text",
                ".summary::text",
                ".teaser::text",
                "p::text",
            ],
        ),
    }


def _extract_title(node) -> str | None:
    return _first_text(
        node,
        [
            ".newstext::text",
            ".newslineText::text",
            ".featured-article-title::text",
            ".article-title::text",
            ".headline::text",
            ".title::text",
            ".news-title::text",
            "h2::text",
            "h3::text",
            "h4::text",
        ],
    )


def _extract_comments(node) -> str | None:
    for selector in [
        ".newstc div:nth-child(2)::text",
        ".newstc::text",
        ".comments::text",
        ".comment-count::text",
    ]:
        for value in node.css(selector).getall():
            cleaned = _clean(value)
            if cleaned and ("comment" in cleaned.lower() or cleaned.isdigit()):
                return cleaned
    return None


def _first_text(node, selectors: list[str]) -> str | None:
    for selector in selectors:
        for value in node.css(selector).getall():
            cleaned = _clean(value)
            if cleaned:
                return cleaned
    return None


def _dedupe_by_link_and_title(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    seen: set[tuple[str | None, str | None]] = set()
    deduped: list[dict[str, Any]] = []

    for item in items:
        key = (item.get("link"), item.get("title"))
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)

    return deduped


def _clean(value: Any) -> str | None:
    if value is None:
        return None

    if not isinstance(value, str):
        value = str(value)

    normalized = " ".join(value.split())
    return normalized or None
