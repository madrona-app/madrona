"""Validation for external links on records (e.g. a Wikipedia page).

Links are rendered as anchors in the staff interface and the public portal, so
only absolute http(s) URLs are accepted: a ``javascript:`` or ``data:`` URL
stored here would run script when clicked.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlparse

MAX_LINKS = 50
MAX_URL_LENGTH = 2000
MAX_LABEL_LENGTH = 300

# Suggested kinds; any short string is accepted so organizations can add their own.
LINK_TYPES = ("wikipedia", "wikidata", "authority", "finding_aid", "catalog", "website", "other")


class ExternalLinkError(ValueError):
    pass


def _clean_url(raw: Any, index: int) -> str:
    if not isinstance(raw, str) or not raw.strip():
        raise ExternalLinkError(f"Link {index + 1}: a URL is required")
    url = raw.strip()
    if len(url) > MAX_URL_LENGTH:
        raise ExternalLinkError(f"Link {index + 1}: the URL is longer than {MAX_URL_LENGTH} characters")
    parsed = urlparse(url)
    if parsed.scheme.lower() not in ("http", "https") or not parsed.netloc:
        raise ExternalLinkError(
            f"Link {index + 1}: enter a full web address starting with https:// or http://"
        )
    return url


def normalize_external_links(value: Any) -> list[dict[str, str]] | None:
    """Return a clean list of {url, label, link_type}, or None when empty.

    Accepts a list of dicts or bare URL strings. Blank rows (no URL and no
    label) are dropped, since forms submit them while a row is being added.
    """
    if value is None:
        return None
    if not isinstance(value, list):
        raise ExternalLinkError("External links must be a list")
    if len(value) > MAX_LINKS:
        raise ExternalLinkError(f"An object can have at most {MAX_LINKS} external links")

    cleaned: list[dict[str, str]] = []
    for i, item in enumerate(value):
        if isinstance(item, str):
            item = {"url": item}
        if not isinstance(item, dict):
            raise ExternalLinkError(f"Link {i + 1}: expected an object with a url")
        url_raw = item.get("url")
        label = (item.get("label") or "").strip() if isinstance(item.get("label"), str) else ""
        if (not isinstance(url_raw, str) or not url_raw.strip()) and not label:
            continue
        url = _clean_url(url_raw, i)
        if len(label) > MAX_LABEL_LENGTH:
            raise ExternalLinkError(f"Link {i + 1}: the label is longer than {MAX_LABEL_LENGTH} characters")
        link_type = item.get("link_type")
        link_type = link_type.strip()[:50] if isinstance(link_type, str) and link_type.strip() else "other"
        cleaned.append({"url": url, "label": label, "link_type": link_type})
    return cleaned or None
