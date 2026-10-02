"""
Playbook lookup — step-by-step "how do I do X in Madrona?" answers.

Thin wrapper over the existing `reference_chunks` pgvector search,
scoped to `source='playbook'`. On top of the raw chunk results, attaches:

  - **`playbook`**: the human-readable title of the best-matching
    playbook, e.g. "Accession a New Object". The model uses this to
    narrate its answer. The title is resolved from the filename stored
    in `reference_chunks.document` via `playbook_links.PLAYBOOKS`.

  - **`_ui`**: a navigation hint (same shape as `navigate_to`) pointing
    at the nav catalog entry for that playbook. The frontend lifts this
    onto the assistant message and renders a "Go there →" button, so
    asking "how do I accession a new object?" ends with the user one
    click from the right page.

Distinct from `lookup_reference` on purpose: that tool searches the
whole corpus and is the right call for "what does the procedure say
about X?". This tool is for "walk me through doing X in Madrona".

Best-match selection:
    Simple top-1 by similarity can pick the wrong playbook when an
    adjacent playbook mentions the target as a "next step". For
    example, "how do I accession a new object" top-ranks the
    *Receive an Object Entry* playbook because its "After the entry"
    section mentions accessioning as a downstream action.

    To avoid that, we aggregate by document: count how many of the
    top-K chunks come from each playbook, and pick the one with the
    most chunks (tie-break on max similarity). A playbook that has
    three of four top chunks is almost certainly the right answer.
"""

from __future__ import annotations

import logging
from collections import defaultdict

from app.services.agent_tools import AgentContext, ToolRegistry
from app.services.agent_tools.nav_catalog import load_nav_catalog
from app.services.agent_tools.playbook_links import (
    PlaybookMeta,
    get_playbook_meta,
)
from app.services.agent_tools.reference_tools import _embed_query, _search_chunks

logger = logging.getLogger(__name__)


def _pick_dominant_document(results: list[dict]) -> str | None:
    """
    Pick the `document` field that dominates the top results.

    Ranks by (chunk_count, sum_of_similarities). Chunk count is the
    primary signal — a playbook with more representation in the top-K
    almost always wins. When two playbooks tie on count (e.g. limit=4
    with 2 chunks each from two adjacent playbooks that genuinely
    discuss the same topic), the tie-break sums similarities across
    the playbook's chunks so the one with a *consistently* stronger
    match beats one with a single high-similarity outlier.
    """
    if not results:
        return None

    per_doc_count: dict[str, int] = defaultdict(int)
    per_doc_sum_sim: dict[str, float] = defaultdict(float)
    for item in results:
        doc = item.get("document")
        if not doc:
            continue
        per_doc_count[doc] += 1
        per_doc_sum_sim[doc] += float(item.get("similarity", 0.0))

    if not per_doc_count:
        return None

    ranked = sorted(
        per_doc_count.items(),
        key=lambda kv: (-kv[1], -per_doc_sum_sim[kv[0]]),
    )
    return ranked[0][0]


def _best_playbook_meta(results: list[dict]) -> tuple[str | None, PlaybookMeta | None]:
    """Return (filename, metadata) for the dominant playbook in the results."""
    document = _pick_dominant_document(results)
    if not document:
        return None, None
    return document, get_playbook_meta(document)


def _build_nav_hint(meta: PlaybookMeta) -> dict | None:
    """
    Resolve a playbook's nav_item to a `_ui` navigation hint.

    Returns None if the mapped nav catalog entry no longer exists
    (protects against nav_item_id drift — a pytest also guards this
    statically).
    """
    catalog = load_nav_catalog()
    entry = catalog.get(meta.nav_item)
    if not entry:
        logger.warning(
            "Playbook '%s' maps to nav id '%s' which is not in the catalog",
            meta.title, meta.nav_item,
        )
        return None
    return {
        "kind": "navigation",
        "target": {
            "id": entry.id,
            "path": entry.path_pattern,
            "label": entry.label,
            "breadcrumb": list(entry.breadcrumb),
        },
    }


def lookup_playbook(args: dict, ctx: AgentContext) -> dict:
    """Search the Madrona workflow playbooks for a step-by-step answer."""
    query = (args.get("query") or "").strip()
    if not query:
        return {"error": "query is required"}

    query_vec = _embed_query(query)
    if not query_vec:
        return {"error": "Embedding service unavailable"}

    # Default limit is 6, not 4: playbooks legitimately overlap (an entry
    # playbook mentions accessioning as a downstream step), so a small top-K
    # leaves dominant-document selection vulnerable to single-outlier chunks
    # from an adjacent playbook. 6 gives every playbook with genuine
    # coverage room to show up with multiple chunks.
    raw = _search_chunks(
        query_vec,
        ctx,
        org_only=False,
        source="playbook",
        limit=min(args.get("limit", 6), 8),
    )

    if "error" in raw:
        return raw

    results = raw.get("results", [])
    if not results:
        return {
            "query": query,
            "results": [],
            "message": (
                "No Madrona playbook matches that question. The user may be "
                "asking about something outside the standard workflows — "
                "try lookup_reference for the institution's own documents, or "
                "ask the user to clarify what they're trying to do."
            ),
        }

    document, meta = _best_playbook_meta(results)
    # Reorder results so chunks from the dominant playbook come first — the
    # model reads top-down and we want it to lead with the right content.
    if document:
        dominant = [r for r in results if r.get("document") == document]
        other = [r for r in results if r.get("document") != document]
        results = dominant + other

    response: dict = {
        "query": query,
        "playbook": meta.title if meta else document,
        "results": results,
    }

    # Attach a navigation hint when the dominant playbook maps to a nav
    # catalog entry. The frontend's SSE parser lifts `_ui` onto the
    # assistant message and renders a "Go there →" button (same code
    # path as `navigate_to`).
    if meta:
        hint = _build_nav_hint(meta)
        if hint:
            response["_ui"] = hint

    return response


def register_playbook_tools(registry: ToolRegistry) -> None:
    """Register the playbook lookup tool for staff + guide personas."""
    registry.register(
        name="lookup_playbook",
        description=(
            "Madrona's step-by-step workflow playbooks — the first tool to "
            "reach for any time the user is trying to DO something in the "
            "museum, whether they phrase it as a question or not. Covers "
            "receiving an object entry, accessioning new objects, incoming "
            "and outgoing loans, condition reports, conservation treatments, "
            "movements, incidents, and deaccessions.\n\n"
            "Call this tool FIRST when the user says anything like:\n"
            "  • 'how do I X' / 'walk me through X' / 'steps to X'\n"
            "  • 'someone just dropped off / brought in / delivered…'\n"
            "  • 'I need to / we have to / we should…'\n"
            "  • 'what do I do when / first / next / after…'\n"
            "  • 'an object arrived / needs treatment / is going out…'\n"
            "  • Any 'I want to [verb]' framing where the verb is a workflow\n"
            "Indirect phrasings count. If the user is describing a real-world "
            "situation that implies a museum procedure, this tool is the "
            "answer — do not guess or paraphrase from memory.\n\n"
            "MULTI-TURN DISCIPLINE (important): Every new user message is "
            "a FRESH intent. When the user introduces a new topic mid-"
            "conversation, focus only on the new topic — do NOT re-hash or "
            "re-list previous questions you already answered, and do NOT "
            "call this tool again for earlier topics unless the user "
            "explicitly asks. Each turn gets one clear action; chaining "
            "prior context into a summary is the wrong shape. If the user "
            "just asked about loan returns and now asks about moving a "
            "sculpture, answer only about moving the sculpture.\n\n"
            "The tool result carries a `_ui` navigation hint the frontend "
            "renders as a one-click button to the right page. You MUST NOT "
            "paste the URL or the full step list in your text reply; "
            "narrate the first step or two and let the button do the rest. "
            "One workflow question → one lookup_playbook call → one button.\n\n"
            "Use `lookup_reference` ONLY for standards questions ('what does "
            "procedure say about X', 'what are the NAGPRA requirements for Y') "
            "that aren't about performing a task. Use `lookup_madrona_field` "
            "ONLY when the user is asking about a specific field on a "
            "specific record they're already looking at — not for 'how do I "
            "start this workflow' questions. When in doubt between "
            "lookup_playbook and either of those, prefer lookup_playbook."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": (
                        "Natural language question about a workflow. "
                        "Examples: 'how do I accession a new object', "
                        "'walk me through an incoming loan', 'what's needed "
                        "to file a condition report'."
                    ),
                },
                "limit": {
                    "type": "integer",
                    "description": "Max chunks to return (1-8, default 6).",
                },
            },
            "required": ["query"],
        },
        handler=lookup_playbook,
        personas=["staff", "guide"],
    )
