CHALLENGE_MARKERS = (
    "window.__cf$cv$params",
    "/cdn-cgi/challenge-platform/",
    "just a moment...",
    "checking your browser before accessing",
    "cf-browser-verification",
    "attention required! | cloudflare",
)


def has_challenge_markers(html: str) -> bool:
    normalized = (html or "").lower()
    return any(marker in normalized for marker in CHALLENGE_MARKERS)


def has_archive_content_markers(html: str) -> bool:
    normalized = (html or "").lower()
    has_news_jsonld = (
        "application/ld+json" in normalized
        and '"@type"' in normalized
        and "newsarticle" in normalized
    )
    return (
        "a.newsline.article" in normalized
        or "newsline article" in normalized
        or "featured-article-title" in normalized
        or "today's news" in normalized
        or has_news_jsonld
    )


def is_blocked_archive_page(html: str) -> bool:
    return has_challenge_markers(html) and not has_archive_content_markers(html)
