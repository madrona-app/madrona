"""
Navigation tool — turns natural-language destination requests into a concrete
route the user can click to reach.

The model calls `navigate_to(query, product?)`; the tool resolves the query
against the nav catalog (`nav_catalog.json`, in this package), filters by what
the current user can actually access (org app subscriptions + RBAC
permissions), and returns a best match plus alternatives. The frontend
renders a "Go there →" button from the `_ui` hint attached to the result.

This tool *proposes* navigation — it never auto-navigates. That keeps the
user in control during chat and avoids surprising redirects mid-conversation.
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.services.agent_tools import AgentContext, ToolRegistry
from app.services.agent_tools.nav_catalog import NavEntry, load_nav_catalog

logger = logging.getLogger(__name__)

# Minimal stop-word list. We want enough to strip conversational filler
# ("take me to", "how do i") without accidentally dropping meaningful tokens.
_STOP_WORDS = frozenset(
    {
        "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "for",
        "from", "get", "go", "have", "how", "i", "if", "in", "into", "is",
        "it", "me", "my", "of", "on", "or", "page", "screen", "show", "take",
        "that", "the", "this", "to", "want", "was", "we", "what", "where",
        "which", "with", "you", "your",
    }
)

# Minimum score for something to be considered "found". Anything below this
# is reported as low confidence so the model can apologize gracefully.
_MIN_SCORE = 25

# Cap alternative suggestions to avoid token bloat in the tool response.
_MAX_ALTERNATIVES = 3


def _tokenize(text: str) -> list[str]:
    """Lowercase, split on non-alphanumerics, drop stop words."""
    tokens = re.split(r"[^a-z0-9]+", text.lower())
    return [t for t in tokens if t and t not in _STOP_WORDS]


def _score_entry(entry: NavEntry, query_tokens: list[str], phrase: str) -> int:
    """
    Score one catalog entry against the tokenized query.

    Weights (tunable — captured as constants for test visibility):
      - 1000: exact nav-id tail match, e.g. query "conservation" → entry id
        ending in "conservation"
      - +100: phrase equals one of the entry's curated keywords/synonyms
      - +25 per matched label token
      - +15 per matched keyword token
      - +5 per matched breadcrumb token
      - +50 phrase substring appears in label
      - +20 phrase substring appears in any keyword
    """
    if not query_tokens:
        return 0

    # 1. Exact ID tail match — user typed the canonical slug.
    id_tail = entry.id.split(":", 1)[-1].replace("-", " ")
    if phrase == id_tail:
        return 1000

    # 2. Exact phrase equals a curated keyword/synonym.
    if phrase and phrase in entry.keywords:
        return 900

    label_lower = entry.label.lower()
    label_tokens = set(re.split(r"[^a-z0-9]+", label_lower))
    label_tokens.discard("")

    # Build a flat bag of keyword tokens (keywords already include full phrases
    # and individual tokens from label/breadcrumb/synonyms).
    keyword_bag: set[str] = set()
    for kw in entry.keywords:
        keyword_bag.add(kw)
        keyword_bag.update(kw.split())

    breadcrumb_lower = [crumb.lower() for crumb in entry.breadcrumb]

    matched_labels = sum(1 for t in query_tokens if t in label_tokens)
    matched_keywords = sum(1 for t in query_tokens if t in keyword_bag)
    matched_breadcrumb = sum(
        1 for t in query_tokens if any(t in crumb for crumb in breadcrumb_lower)
    )

    score = (
        matched_labels * 25
        + matched_keywords * 15
        + matched_breadcrumb * 5
    )

    if phrase:
        if phrase in label_lower:
            score += 50
        if any(phrase in kw for kw in entry.keywords):
            score += 20

    # Coverage bonus — reward entries that match every query token.
    if query_tokens and matched_labels + matched_keywords >= len(query_tokens):
        score += 20

    return score


def _resolve_access(ctx: AgentContext) -> tuple[set[str], set[str]]:
    """
    Return (permission_keys, enabled_app_keys) for the current user/org.

    Empty sets on failure — navigate_to will then only surface destinations
    that have no gating, which is the safer default.
    """
    permissions: set[str] = set()
    app_keys: set[str] = set()

    if ctx.user_id is None:
        return permissions, app_keys

    try:
        from app.services.rbac_service import get_user_permissions

        permissions = get_user_permissions(
            ctx.user_id, ctx.organization_id, session=ctx.db_session
        )
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("navigate_to: failed to load permissions: %s", e)

    try:
        from app.models import Application, OrganizationApplication

        rows = (
            ctx.db_session.query(Application.key)
            .join(
                OrganizationApplication,
                OrganizationApplication.application_id == Application.application_id,
            )
            .filter(
                OrganizationApplication.organization_id == ctx.organization_id,
                OrganizationApplication.enabled.is_(True),
            )
            .all()
        )
        app_keys = {row.key for row in rows}
    except Exception as e:  # pragma: no cover — defensive
        logger.warning("navigate_to: failed to load org apps: %s", e)

    return permissions, app_keys


def _entry_to_dict(entry: NavEntry) -> dict[str, Any]:
    return {
        "id": entry.id,
        "product": entry.product,
        "label": entry.label,
        "path": entry.path_pattern,
        "breadcrumb": list(entry.breadcrumb),
    }


def navigate_to(args: dict, ctx: AgentContext) -> dict:
    """
    Resolve a natural-language destination to a concrete route.

    Returns a shape with a `_ui` hint the frontend consumes to render a
    "Go there →" button. The model sees the same information in the
    top-level fields so it can narrate the resolution if it wants to.
    """
    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "query is required"}

    product_filter = (args.get("product") or "").strip().lower() or None

    catalog = load_nav_catalog()
    permissions, app_keys = _resolve_access(ctx)
    allowed = catalog.filter_by_access(
        permissions=permissions, app_keys=app_keys
    )

    # Product filter is applied after access — so an unknown product name
    # just returns an empty search space, not an error.
    if product_filter:
        allowed = tuple(e for e in allowed if e.product == product_filter)

    if not allowed:
        return {
            "query": query,
            "best_match": None,
            "alternatives": [],
            "note": (
                "No destinations are reachable with the current user's "
                "permissions and app subscriptions."
            ),
        }

    query_tokens = _tokenize(query)
    phrase = " ".join(query_tokens)

    scored: list[tuple[int, NavEntry]] = []
    for entry in allowed:
        score = _score_entry(entry, query_tokens, phrase)
        if score > 0:
            scored.append((score, entry))

    scored.sort(key=lambda pair: (-pair[0], pair[1].id))

    if not scored or scored[0][0] < _MIN_SCORE:
        # Still return the top few matches so the model can offer them as
        # "did you mean?" — but flag low confidence.
        low_conf = [
            _entry_to_dict(entry) for _, entry in scored[:_MAX_ALTERNATIVES]
        ]
        return {
            "query": query,
            "best_match": None,
            "alternatives": low_conf,
            "note": (
                "Low confidence — no strong match. Ask the user to clarify "
                "or try a different phrasing."
            ),
        }

    best_score, best_entry = scored[0]
    alternatives = [
        _entry_to_dict(entry) for _, entry in scored[1 : 1 + _MAX_ALTERNATIVES]
    ]
    best = _entry_to_dict(best_entry)

    return {
        "query": query,
        "best_match": best,
        "alternatives": alternatives,
        "note": (
            f"Found a strong match: {best_entry.label} "
            f"({best_entry.breadcrumb[-1] if best_entry.breadcrumb else best_entry.product})."
        ),
        # UI hint — the frontend's SSE parser lifts this onto the assistant
        # message so the chat UI can render a "Go there →" button. Path is
        # returned with the :orgId placeholder intact; the frontend
        # substitutes the current org slug before navigating.
        "_ui": {
            "kind": "navigation",
            "target": {
                "id": best_entry.id,
                "path": best_entry.path_pattern,
                "label": best_entry.label,
                "breadcrumb": list(best_entry.breadcrumb),
            },
        },
    }


def register_nav_tools(registry: ToolRegistry) -> None:
    """Register the navigation tool. Staff + guide only — visitors can't
    navigate the admin UI."""
    registry.register(
        name="navigate_to",
        description=(
            "Resolve a natural-language destination in Madrona and propose a "
            "one-click navigation for the user. Use this whenever the user "
            "asks where to find something in the app, asks you to take them "
            "somewhere, or asks 'how do I get to X?'. The UI will render a "
            "clickable button from the result — do NOT paste the raw URL in "
            "your text response. For object-specific destinations "
            "('open object ABC-123'), call search_collection first to resolve "
            "the object, then use its URL directly — do not call navigate_to "
            "for individual records."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "What the user wants to reach, in natural language. "
                        "Examples: 'conservation treatments', 'outgoing "
                        "loans', 'where do I manage roles', 'my tasks'."
                    ),
                },
                "product": {
                    "type": "string",
                    "description": (
                        "Optional filter when the user specified a product: "
                        "'collections', 'media', 'bridge', 'content', "
                        "'guide', 'admin'. Omit to search everywhere."
                    ),
                },
            },
            "required": ["query"],
        },
        handler=navigate_to,
        personas=["staff", "guide"],
    )
