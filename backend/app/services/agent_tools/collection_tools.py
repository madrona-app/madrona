"""
Collection search and detail tools for the agent.
"""

import logging
from uuid import UUID

from app.services.agent_tools import AgentContext, ToolRegistry

logger = logging.getLogger(__name__)


def search_collection(args: dict, ctx: AgentContext) -> dict:
    """Search collection objects using OpenSearch."""
    from app.search.collections.service import get_collections_search_service
    from app.search.collections.schemas import (
        CollectionsSearchRequest,
        CollectionsSearchQuery,
        CollectionsSearchFilters,
    )

    service = get_collections_search_service()
    if not service.is_available():
        return {"error": "Collection search is currently unavailable"}

    query_text = args.get("query", "")
    max_limit = 10 if ctx.persona == "visitor" else 20
    limit = min(args.get("limit", 10), max_limit)

    filters = CollectionsSearchFilters()
    if args.get("object_type"):
        if ctx.persona == "visitor":
            # Visitors speak colloquially — "painting" means anything on a
            # wall, while the catalog is procedure-precise (print, woodblock
            # print, watercolor...). A hard term filter silently excludes the
            # very object they're describing (e.g. The Great Wave is a print).
            # Fold the type into the text query as a ranking signal instead.
            query_text = f"{query_text} {args['object_type']}".strip()
        else:
            filters.object_type = [args["object_type"]]
    if args.get("creator"):
        filters.creator_name = args["creator"]
    if args.get("date_from"):
        filters.date_from = args["date_from"]
    if args.get("date_to"):
        filters.date_to = args["date_to"]
    if args.get("condition_rating"):
        filters.condition_rating = [args["condition_rating"]]
    # Visitors: hard enforcement — always discoverable, ignore include_private
    if ctx.persona == "visitor":
        filters.is_discoverable = True
        args.pop("include_private", None)

    request = CollectionsSearchRequest(
        query=CollectionsSearchQuery(q=query_text) if query_text else None,
        filters=filters,
        limit=limit,
        offset=0,
        include_facets=False,
        highlight=False,
    )

    response = service.search(request, ctx.organization_id, db_session=ctx.db_session)

    results = []
    for hit in response.hits:
        if ctx.persona == "visitor" and ctx.org_slug:
            url = f"/c/{ctx.org_slug}/objects/{hit.object_id}"
        else:
            url = f"/organizations/{ctx.organization_id}/collections/objects/{hit.object_id}"
        parts = [f"[{hit.title or 'Untitled'}]({url})"]
        if hit.object_number:
            parts[0] += f" ({hit.object_number})"
        meta = []
        if hit.object_type:
            meta.append(hit.object_type)
        if hit.creators:
            names = [c.get("name", "") for c in hit.creators if c.get("name")]
            if names:
                meta.append("by " + ", ".join(names))
        if hit.creation_date:
            date = hit.creation_date.get("display_date", "")
            if date:
                meta.append(date)
        if meta:
            parts.append(" — ".join(meta))
        if hit.materials:
            mat_names = [m.get("name", "") for m in hit.materials if m.get("name")]
            if mat_names:
                meta.append("materials: " + ", ".join(mat_names[:5]))
        if hit.condition:
            rating = hit.condition.get("rating", "")
            if rating:
                meta.append(f"condition: {rating}")
        if hit.current_location:
            loc_name = hit.current_location.get("name", "")
            if loc_name:
                meta.append(f"location: {loc_name}")
        if hit.object_status:
            meta.append(f"status: {hit.object_status}")
        if hit.brief_description:
            parts.append(hit.brief_description)
        results.append(". ".join(parts))

    # Return as pre-formatted prose so the LLM doesn't reformat into bullet lists
    prose = f"Found {response.total} results. "
    prose += " | ".join(results)
    prose += "\n\nIMPORTANT: Present these objects in flowing prose paragraphs. Do NOT use numbered lists, bullet points, or bold labels. Weave them into natural sentences with the markdown links as provided above."

    out = {"summary": prose}
    cards = _visitor_object_cards(response.hits, ctx)
    if cards:
        out["_ui"] = cards
    return out


def _visitor_object_cards(hits, ctx: AgentContext) -> dict | None:
    """Build the object_cards UI hint for visitor chat.

    Visitors shouldn't be bounced out to the Discover record UI mid-
    conversation — the chat renders these as inline cards (image, title,
    maker/date) with an in-chat detail expansion. Capped small: cards
    accompany the prose, they don't replace it.
    """
    if ctx.persona != "visitor" or not ctx.org_slug or not hits:
        return None

    from app.services.discovery_service import get_object_card_thumbnails

    top = hits[:4]
    try:
        thumbs = get_object_card_thumbnails(
            [h.object_id for h in top], ctx.organization_id, ctx.db_session,
        )
    except Exception:
        thumbs = {}

    cards = []
    for h in top:
        creators = [c.get("name", "") for c in (h.creators or []) if c.get("name")]
        date = (h.creation_date or {}).get("display") or (h.creation_date or {}).get("display_date")
        cards.append({
            "object_id": str(h.object_id),
            "object_number": h.object_number,
            "title": h.title or "Untitled",
            "creator": ", ".join(creators) if creators else None,
            "date": date,
            "path": f"/c/{ctx.org_slug}/objects/{h.object_id}",
            "thumbnail_url": thumbs.get(str(h.object_id)),
        })
    return {"kind": "object_cards", "objects": cards}


def get_object_detail(args: dict, ctx: AgentContext) -> dict:
    """Get detailed information about a specific collection object."""
    from app.models import CollectionObject

    object_id = args.get("object_id")
    object_number = args.get("object_number")

    if not object_id and not object_number:
        return {"error": "Provide either object_id or object_number"}

    query = ctx.db_session.query(CollectionObject).filter(
        CollectionObject.organization_id == ctx.organization_id,
    )

    if object_id:
        try:
            query = query.filter(CollectionObject.object_id == UUID(object_id))
        except (ValueError, TypeError):
            return {"error": "Invalid object_id format"}
    else:
        query = query.filter(CollectionObject.object_number == object_number)

    # Visitors can only see discoverable objects
    if ctx.persona == "visitor":
        query = query.filter(CollectionObject.is_discoverable == True)  # noqa: E712

    obj = query.first()
    if not obj:
        return {"error": "Object not found"}

    result = {
        "object_id": str(obj.object_id),
        "object_number": obj.object_number,
        "object_name": obj.object_name,
        "brief_description": obj.brief_description,
        "object_type": getattr(obj, "object_type", None),
        "classification": getattr(obj, "classification", None),
        "object_status": getattr(obj, "object_status", None),
    }

    # Storytelling fields (all personas)
    if obj.creators:
        from app.serializers.discover import _extract_creators_list
        result["creators"] = _extract_creators_list(obj.creators)
    if obj.creation_date_display:
        result["creation_date"] = obj.creation_date_display
    if obj.creation_place:
        result["creation_place"] = obj.creation_place
    if obj.style_period:
        result["style_period"] = obj.style_period
    if hasattr(obj, "subjects") and obj.subjects:
        result["subjects"] = obj.subjects
    if hasattr(obj, "credit_line") and obj.credit_line:
        result["credit_line"] = obj.credit_line
    if hasattr(obj, "content_description") and obj.content_description:
        result["content_description"] = obj.content_description[:1000]

    # Titles
    if obj.title_links:
        result["titles"] = [
            {"title": t.title, "title_type": t.title_type, "language": t.language, "is_preferred": t.is_preferred}
            for t in obj.title_links
        ]

    # Production info
    if hasattr(obj, "full_description") and obj.full_description:
        result["full_description"] = obj.full_description[:2000]
    if hasattr(obj, "materials") and obj.materials:
        result["materials"] = obj.materials
    if hasattr(obj, "techniques") and obj.techniques:
        result["techniques"] = obj.techniques
    if hasattr(obj, "dimensions") and obj.dimensions:
        result["dimensions"] = obj.dimensions
    if obj.inscription_links:
        result["inscriptions"] = [i.content for i in obj.inscription_links]

    # Staff gets extra fields
    if ctx.persona == "staff":
        if hasattr(obj, "comments") and obj.comments:
            result["comments"] = obj.comments[:1000]
        if hasattr(obj, "provenance") and obj.provenance:
            result["provenance"] = obj.provenance[:1000]
        result["is_discoverable"] = obj.is_discoverable

    return result


def find_related_objects(args: dict, ctx: AgentContext) -> dict:
    """Find objects related to a given object for cross-object storytelling."""
    from app.models import CollectionObject
    from app.serializers.discover import _build_related_should_clauses, _extract_creators_list
    from app.search.collections.service import CollectionsSearchService, get_collections_search_service

    object_id = args.get("object_id")

    # Fall back to conversation context if no object_id provided
    if not object_id and ctx.context_entity_type == "collection_object" and ctx.context_entity_id:
        object_id = str(ctx.context_entity_id)

    if not object_id:
        return {"error": "No object_id provided and no object context available"}

    try:
        obj_uuid = UUID(object_id)
    except (ValueError, TypeError):
        return {"error": "Invalid object_id format"}

    query = ctx.db_session.query(CollectionObject).filter(
        CollectionObject.object_id == obj_uuid,
        CollectionObject.organization_id == ctx.organization_id,
    )
    if ctx.persona == "visitor":
        query = query.filter(CollectionObject.is_discoverable == True)  # noqa: E712
    obj = query.first()
    if not obj:
        return {"error": "Object not found"}

    if not CollectionsSearchService.is_available():
        return {"error": "Search service is currently unavailable"}

    relationship_type = args.get("relationship_type", "all")
    should_clauses = _build_related_should_clauses(obj, relationship_type)
    if not should_clauses:
        return {"summary": "No related objects found — the source object lacks the attributes needed to find connections."}

    os_query = {
        "size": 6,
        "_source": [
            "object_id", "object_number", "title", "creators",
            "creation_date", "classification", "style_period",
        ],
        "query": {
            "bool": {
                "must_not": [
                    {"term": {"object_id": str(obj.object_id)}}
                ],
                "filter": [
                    {"term": {"is_discoverable": True}},
                    {"term": {"organization_id": str(ctx.organization_id)}},
                ],
                "should": should_clauses,
                "minimum_should_match": 1,
            }
        }
    }

    service = get_collections_search_service()
    try:
        response = service.index_manager.search(os_query, str(ctx.organization_id))
    except Exception as e:
        logger.warning("Related objects search failed: %s", e)
        return {"error": "Search failed"}

    os_hits = response.get("hits", {}).get("hits", [])
    if not os_hits:
        return {"summary": "No related objects found in the collection."}

    # Format as prose with markdown links (same pattern as search_collection)
    results = []
    for h in os_hits:
        src = h["_source"]
        oid = src["object_id"]
        if ctx.persona == "visitor" and ctx.org_slug:
            url = f"/c/{ctx.org_slug}/objects/{oid}"
        else:
            url = f"/organizations/{ctx.organization_id}/collections/objects/{oid}"
        title = src.get("title") or "Untitled"
        parts = [f"[{title}]({url})"]
        if src.get("object_number"):
            parts[0] += f" ({src['object_number']})"
        meta = []
        creators_raw = src.get("creators") or []
        creator_names = [c.get("name") for c in creators_raw if isinstance(c, dict) and c.get("name")]
        if creator_names:
            meta.append("by " + ", ".join(creator_names))
        creation_date = src.get("creation_date")
        if creation_date and isinstance(creation_date, dict):
            display = creation_date.get("display") or creation_date.get("display_date")
            if display:
                meta.append(display)
        if src.get("style_period"):
            meta.append(src["style_period"])
        if meta:
            parts.append(" — ".join(meta))
        results.append(". ".join(parts))

    source_name = obj.object_name or obj.object_number or "the object"
    prose = f"Found {len(results)} objects related to {source_name}. "
    prose += " | ".join(results)
    prose += "\n\nIMPORTANT: Present these related objects in flowing prose. Weave them into natural sentences with the markdown links as provided. Suggest connections — shared artists, periods, techniques, or themes."

    return {"summary": prose}


def register_collection_tools(registry: ToolRegistry) -> None:
    """Register collection tools with the registry."""
    registry.register(
        name="search_collection",
        description=(
            "Search the museum's collection objects using semantic search. "
            "The query field supports natural language (e.g. 'musical instruments', "
            "'Japanese armor', 'impressionist landscapes'). Returns matching objects "
            "with titles, types, creators, dates, and thumbnail images. "
            "Prefer using the query field over filters for broad or conceptual searches."
        ),
        parameters={
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Natural language search query (e.g. 'landscape painting', 'bronze sculpture', 'musical instruments'). Supports semantic matching — doesn't need exact terms.",
                },
                "object_type": {
                    "type": "string",
                    "description": "Filter by exact object type name (e.g. 'Painting', 'Sculpture', 'Photograph'). Must match exactly — use the query field instead for broad or conceptual searches.",
                },
                "creator": {
                    "type": "string",
                    "description": "Filter by creator/artist name",
                },
                "date_from": {
                    "type": "string",
                    "description": "Earliest creation date (YYYY or YYYY-MM-DD)",
                },
                "date_to": {
                    "type": "string",
                    "description": "Latest creation date (YYYY or YYYY-MM-DD)",
                },
                "condition_rating": {
                    "type": "string",
                    "description": "Filter by condition rating (e.g. 'excellent', 'good', 'fair', 'poor')",
                },
                "limit": {
                    "type": "integer",
                    "description": "Max results to return (1-20, default 10)",
                },
            },
            "required": ["query"],
        },
        handler=search_collection,
        personas=["staff", "visitor"],
    )

    registry.register(
        name="get_object_detail",
        description=(
            "Get detailed information about a specific collection object by its ID or "
            "accession number. Returns full cataloging data including descriptions, "
            "materials, dimensions, and provenance."
        ),
        parameters={
            "type": "object",
            "properties": {
                "object_id": {
                    "type": "string",
                    "description": "The UUID of the object",
                },
                "object_number": {
                    "type": "string",
                    "description": "The accession/object number (e.g. '2024.001')",
                },
            },
        },
        handler=get_object_detail,
        personas=["staff", "visitor"],
    )

    registry.register(
        name="find_related_objects",
        description=(
            "Find objects in the collection related to a specific object. "
            "Discovers connections through shared artists, style periods, materials, "
            "creation places, and classifications. Great for suggesting 'if you liked this, "
            "you might also enjoy...' recommendations. If no object_id is provided, uses "
            "the object the user is currently viewing."
        ),
        parameters={
            "type": "object",
            "properties": {
                "object_id": {
                    "type": "string",
                    "description": "UUID of the object to find related works for. Optional — defaults to the object the user is currently viewing.",
                },
                "relationship_type": {
                    "type": "string",
                    "enum": ["all", "same_artist", "same_period", "same_materials", "same_place"],
                    "description": "Type of relationship to search for. Defaults to 'all' which uses weighted scoring across all relationship types.",
                },
            },
        },
        handler=find_related_objects,
        personas=["staff", "visitor"],
    )
