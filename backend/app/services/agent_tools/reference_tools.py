"""
RAG retrieval tools for reference documents.

Two tools with different scopes:
- lookup_reference (staff): Searches the global professional corpus (procedures,
  NAGPRA, etc.) AND the org's own uploaded documents.
- lookup_museum_info (visitor): Searches ONLY the org's own uploaded documents.
  Visitors don't need cultural heritage standards — they need the museum's
  policies, FAQs, and visitor-facing information.
"""

import logging

from sqlalchemy import text

from app.services.agent_tools import AgentContext, ToolRegistry
from app.services.embedding_service import get_embedding

logger = logging.getLogger(__name__)

# Display labels for the LLM. Sources are Madrona's own playbooks plus
# per-organization uploads, which carry a "guide:<filename>" source and fall
# through to their raw value.
SOURCE_LABELS = {
    "playbook": "Madrona Playbook",
}

# Minimum cosine similarity to include a result. Avoids returning irrelevant
# chunks when the query doesn't match anything in the corpus well.
SIMILARITY_THRESHOLD = 0.4


def _embed_query(query: str) -> list[float] | None:
    """Embed a query string via the configured provider. Returns None on failure."""
    return get_embedding(query, task="search_query")


def _search_chunks(
    query_vec: list[float],
    ctx: AgentContext,
    *,
    org_only: bool = False,
    public_only: bool = False,
    include_conversation: bool = False,
    source: str | None = None,
    limit: int = 4,
) -> dict:
    """
    Cosine similarity search via pgvector HNSW index.

    Args:
        org_only: If True, only search chunks belonging to this org
                  (tenant uploads). If False, include global corpus too.
        public_only: If True, restrict to visibility='public' chunks.
                     Used for visitor persona to exclude internal docs.
    """
    where_clause = "WHERE embedding_vec IS NOT NULL"
    params: dict = {"vec": str(query_vec), "lim": limit}

    # Cast to the actual query-vector dimension so it always matches the literal
    # we pass (and the embedding_vec column). Hardcoding 768 here caused an
    # "expected 768 dimensions, not 1024" DataException after the Voyage migration.
    vec_cast = f"cast(:vec as vector({len(query_vec)}))"

    org_id = ctx.organization_id
    params["org_id"] = str(org_id)

    # Corpus/global scope (org + visibility). Personal conversation attachments
    # are layered on separately below — this condition matches corpus rows only.
    if org_only:
        corpus_cond = "organization_id = :org_id"
        if public_only:
            # Visitor scope: only docs the museum has marked as visitor-safe.
            # Internal docs (HR policies, security procedures, board minutes, etc.)
            # are never surfaced to visitors.
            corpus_cond += " AND visibility = 'public'"
    else:
        # Staff/guide scope: global corpus + all of the org's uploads (public + internal)
        corpus_cond = "(organization_id IS NULL OR organization_id = :org_id)"

    # ISOLATION: personal conversation attachments (conversation_id NOT NULL) must
    # NEVER appear in corpus/widget search. Default = corpus only. When the
    # in-conversation assistant opts in, ALSO include this conversation's own
    # attachments (scoped to the org) — but never another conversation's.
    conv_id = getattr(ctx, "conversation_id", None)
    if include_conversation and conv_id is not None:
        where_clause += (
            f" AND ((conversation_id IS NULL AND {corpus_cond})"
            " OR (conversation_id = :conv_id AND organization_id = :org_id))"
        )
        params["conv_id"] = str(conv_id)
    else:
        where_clause += f" AND conversation_id IS NULL AND {corpus_cond}"

    if source:
        where_clause += " AND source = :source"
        params["source"] = source

    # Filter out low-relevance results at the database level
    where_clause += f" AND 1 - (embedding_vec <=> {vec_cast}) >= :threshold"
    params["threshold"] = SIMILARITY_THRESHOLD

    sql = f"""
        SELECT source, document, section, content,
               1 - (embedding_vec <=> {vec_cast}) AS similarity
        FROM reference_chunks
        {where_clause}
        ORDER BY embedding_vec <=> {vec_cast}
        LIMIT :lim
    """

    try:
        rows = ctx.db_session.execute(text(sql), params).fetchall()
    except Exception as e:
        logger.warning("Reference search query failed: %s", e)
        return {"error": "Reference search unavailable"}

    if not rows:
        return {"results": [], "message": "No matching information found."}

    results = []
    for row in rows:
        label = SOURCE_LABELS.get(row.source, row.source)
        results.append({
            "source": label,
            "document": row.document,
            "section": row.section,
            "content": row.content,
            "similarity": round(row.similarity, 3),
        })

    return {"results": results}


def lookup_reference(args: dict, ctx: AgentContext) -> dict:
    """Search org documents + Madrona playbooks (staff tool)."""
    query = args.get("query", "").strip()
    if not query:
        return {"error": "query is required"}

    query_vec = _embed_query(query)
    if not query_vec:
        return {"error": "Embedding service unavailable"}

    return _search_chunks(
        query_vec,
        ctx,
        org_only=False,
        include_conversation=ctx.persona != "visitor",
        source=args.get("source"),
        # Default 8 (was 4): procedure docs chunk into header/body/cross-ref
        # pieces, so the chunk with the actual steps can rank ~8th behind
        # boilerplate. A wider window surfaces it for synthesis.
        limit=min(args.get("limit", 8), 12),
    )


def lookup_museum_info(args: dict, ctx: AgentContext) -> dict:
    """Search this museum's own documents."""
    query = args.get("query", "").strip()
    if not query:
        return {"error": "query is required"}

    query_vec = _embed_query(query)
    if not query_vec:
        return {"error": "Embedding service unavailable"}

    # Visitors only see public docs; guide and staff see everything
    is_visitor = ctx.persona == "visitor"

    return _search_chunks(
        query_vec,
        ctx,
        org_only=True,
        public_only=is_visitor,
        include_conversation=not is_visitor,
        limit=min(args.get("limit", 6), 8),
    )


def register_reference_tools(registry: ToolRegistry) -> None:
    """Register reference lookup tools for staff and visitors."""

    # Staff: playbooks + this organization's own uploads
    registry.register(
        name="lookup_reference",
        description=(
            "Search this organization's uploaded documents and the Madrona "
            "workflow playbooks. Use this when a question involves the "
            "institution's own policies or procedures and you want to cite the "
            "source. Madrona ships no corpus of external standards, so do not "
            "expect procedures, NAGPRA or conservation publications here unless "
            "the institution has uploaded them itself."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural language query about procedures or standards.",
                },
                # No enum: sources are not a fixed set. "playbook" is the only
                # shipped one; an organization's uploads carry a per-file
                # "guide:<filename>" source, which the model learns from the
                # labels on earlier results.
                "source": {
                    "type": "string",
                    "description": (
                        "Limit to a specific source, as shown on an earlier "
                        "result (e.g. 'playbook')."
                    ),
                },
                "limit": {
                    "type": "integer",
                    "description": "Max chunks to return (1-8, default 4).",
                },
            },
            "required": ["query"],
        },
        handler=lookup_reference,
        personas=["staff", "guide"],
    )

    # Visitor: only this museum's own uploaded documents
    registry.register(
        name="lookup_museum_info",
        description=(
            "Search this museum's own documents — visitor policies, FAQs, "
            "accessibility information, program guides, and other materials the "
            "museum has published. Use this when a visitor asks about the museum's "
            "policies, hours, services, programs, or any institution-specific information."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural language query about the museum.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results to return (1-6, default 4).",
                },
            },
            "required": ["query"],
        },
        handler=lookup_museum_info,
        personas=["visitor", "guide"],
    )
