"""
Search API — FastAPI router.

3 routes for entity search:
- Full-text search (OpenSearch + PG fallback)
- Autocomplete suggestions
- Similar entity recommendations (MLT)
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission, get_authorized_org_id
from app.permissions import Permission
from app.services.api_security import escape_ilike, sanitize_error_message
from app.search.client import get_opensearch_client, is_opensearch_available
from app.search.query_builder import SearchQueryBuilder
from app.search.schemas import (
    SearchRequest,
    SearchResponse,
    SearchHit,
    Facet,
    FacetBucket,
    AutocompleteResponse,
    AutocompleteSuggestion,
    SimilarResponse,
    SimilarEntity,
)
from app.fastapi_app.schemas.search import (
    SearchResponse as SearchResponseSchema,
    AutocompleteResponse as AutocompleteResponseSchema,
    SimilarResponse as SimilarResponseSchema,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["search"])

query_builder = SearchQueryBuilder()


# =============================================================================
# Helper functions
# =============================================================================


def _transform_aggregations(aggs: dict) -> list[Facet]:
    """Transform OpenSearch aggregations to facets."""
    facets = []

    for field in ["entity_types", "datasets", "on_display"]:
        if field in aggs:
            facets.append(Facet(
                field=field.replace("_", " ").title(),
                buckets=[
                    FacetBucket(key=str(b["key"]), doc_count=b["doc_count"])
                    for b in aggs[field]["buckets"]
                ]
            ))

    if "creators" in aggs:
        facets.append(Facet(
            field="Creators",
            buckets=[
                FacetBucket(key=b["key"], doc_count=b["doc_count"])
                for b in aggs["creators"]["names"]["buckets"]
            ]
        ))

    if "date_range" in aggs:
        facets.append(Facet(
            field="Date Range",
            buckets=[
                FacetBucket(
                    key=b["key_as_string"],
                    doc_count=b["doc_count"],
                    label=f"{b['key_as_string'][:4]}s"
                )
                for b in aggs["date_range"]["buckets"]
            ]
        ))

    return facets


def _postgres_fallback_search(
    db: Session, organization_id: str, search_request: SearchRequest
) -> dict:
    """Fallback to PostgreSQL when OpenSearch is unavailable."""
    from app.models import EntityField, EntityCurrent

    # EntityField has no dataset_id; dataset association lives on EntityCurrent.
    # Join through (organization_id, entity_key) so we can both filter and return it.
    query = db.query(EntityField, EntityCurrent.dataset_id).join(
        EntityCurrent,
        (EntityField.organization_id == EntityCurrent.organization_id)
        & (EntityField.entity_key == EntityCurrent.entity_key),
    ).filter(EntityField.organization_id == organization_id)

    if search_request.query and search_request.query.q:
        search_pattern = f"%{escape_ilike(search_request.query.q)}%"
        query = query.filter(
            or_(
                EntityField.title.ilike(search_pattern, escape="\\"),
                EntityField.object_number.ilike(search_pattern, escape="\\")
            )
        )

    if search_request.filters:
        if search_request.filters.dataset_id:
            query = query.filter(EntityCurrent.dataset_id.in_(search_request.filters.dataset_id))
        if search_request.filters.entity_type:
            query = query.filter(EntityField.entity_type.in_(search_request.filters.entity_type))

    total = query.count()

    query = query.order_by(EntityField.title.asc())
    query = query.limit(search_request.limit).offset(search_request.offset)
    results = query.all()

    hits = [
        SearchHit(
            entity_key=r.entity_key,
            entity_type=r.entity_type,
            dataset_id=str(dataset_id) if dataset_id else None,
            title=r.title,
            object_number=r.object_number,
            description=None,
            thumbnail_url=r.thumbnail_url,
            creators=None,
            dates=None,
            score=1.0,
            highlights=None,
        )
        for r, dataset_id in results
    ]

    result = SearchResponse(
        hits=hits,
        total=total,
        facets=None,
        took_ms=0,
        next_offset=(
            search_request.offset + search_request.limit
            if search_request.offset + search_request.limit < total
            else None
        ),
    )

    return result.model_dump()


def _postgres_autocomplete_fallback(
    db: Session, organization_id: str, query_text: str, field: str, limit: int
) -> dict:
    """Fallback autocomplete using PostgreSQL."""
    from app.models import EntityField

    search_pattern = f"{escape_ilike(query_text)}%"

    db_query = db.query(EntityField).filter(
        EntityField.organization_id == organization_id
    )

    if field == "title":
        db_query = db_query.filter(EntityField.title.ilike(search_pattern, escape="\\"))
    elif field == "object_number":
        db_query = db_query.filter(EntityField.object_number.ilike(search_pattern, escape="\\"))
    else:
        db_query = db_query.filter(EntityField.title.ilike(search_pattern, escape="\\"))

    db_query = db_query.limit(limit)
    results = db_query.all()

    suggestions = []
    seen = set()
    for r in results:
        value = getattr(r, field, r.title)
        if value and value not in seen:
            seen.add(value)
            suggestions.append(AutocompleteSuggestion(
                value=value,
                entity_key=r.entity_key,
                highlight=value,
            ))

    result = AutocompleteResponse(suggestions=suggestions)
    return result.model_dump()


# =============================================================================
# Routes
# =============================================================================


@router.post("/api/search", response_model=SearchResponseSchema, summary="Search entities")
async def search_entities(
    request: Request,
    organization_id: str = Query(...),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Full-text entity search (OpenSearch + PG fallback)."""
    org_id = str(get_authorized_org_id(request, auth, query_org_id=organization_id))

    try:
        body = await request.body()
        data = await request.json() if body else {}
        search_request = SearchRequest(**data)
    except Exception as e:
        logger.error(f"Invalid search request: {e}")
        raise HTTPException(status_code=400, detail=f"Invalid request: {sanitize_error_message(e)}")

    if not is_opensearch_available():
        logger.info("OpenSearch not available, falling back to PostgreSQL search")
        return _postgres_fallback_search(db, org_id, search_request)

    client = get_opensearch_client()
    if not client:
        return _postgres_fallback_search(db, org_id, search_request)

    os_query = query_builder.build(search_request, org_id)

    try:
        response = client.search(
            index="madrona-entities-read",
            body=os_query,
            routing=org_id,
        )
    except Exception as e:
        logger.error(f"OpenSearch search failed: {e}")
        return _postgres_fallback_search(db, org_id, search_request)

    hits = []
    for hit in response["hits"]["hits"]:
        source = hit["_source"]
        search_hit = SearchHit(
            entity_key=source["entity_key"],
            entity_type=source.get("entity_type"),
            dataset_id=source.get("dataset_id"),
            title=source.get("title"),
            object_number=source.get("object_number"),
            description=source.get("description"),
            thumbnail_url=source.get("thumbnail_url"),
            creators=source.get("creators"),
            dates=source.get("dates"),
            score=hit["_score"] or 0,
            highlights=hit.get("highlight"),
        )
        hits.append(search_hit.model_dump())

    facets = None
    if search_request.include_facets and "aggregations" in response:
        facets = _transform_aggregations(response["aggregations"])

    total = response["hits"]["total"]
    total_count = total["value"] if isinstance(total, dict) else total

    result = SearchResponse(
        hits=[SearchHit(**h) for h in hits],
        total=total_count,
        facets=facets,
        took_ms=response["took"],
        next_offset=(
            search_request.offset + search_request.limit
            if search_request.offset + search_request.limit < total_count
            else None
        ),
    )

    return result.model_dump()


@router.get("/api/search/autocomplete", response_model=AutocompleteResponseSchema, summary="Autocomplete")
def autocomplete(
    request: Request,
    organization_id: str = Query(...),
    q: str = Query(..., min_length=2),
    field: str = Query("title"),
    limit: int = Query(10, ge=1, le=50),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Autocomplete suggestions from OpenSearch."""
    org_id = str(get_authorized_org_id(request, auth, query_org_id=organization_id))

    if not is_opensearch_available():
        return _postgres_autocomplete_fallback(db, org_id, q, field, limit)

    client = get_opensearch_client()
    if not client:
        return _postgres_autocomplete_fallback(db, org_id, q, field, limit)

    os_query = query_builder.build_autocomplete_query(q, field, org_id, limit)

    try:
        response = client.search(
            index="madrona-entities-read",
            body=os_query,
            routing=org_id,
        )
    except Exception as e:
        logger.error(f"Autocomplete search failed: {e}")
        return _postgres_autocomplete_fallback(db, org_id, q, field, limit)

    suggestions = []
    seen = set()
    for hit in response["hits"]["hits"]:
        value = hit["_source"].get(field)
        if value and value not in seen:
            seen.add(value)
            highlight = hit.get("highlight", {}).get(f"{field}.autocomplete", [value])[0]
            suggestions.append(AutocompleteSuggestion(
                value=value,
                entity_key=hit["_source"]["entity_key"],
                highlight=highlight,
            ))

    result = AutocompleteResponse(suggestions=suggestions)
    return result.model_dump()


@router.get("/api/search/similar/{entity_key}", response_model=SimilarResponseSchema, summary="Find similar")
def find_similar(
    request: Request,
    entity_key: str,
    organization_id: str = Query(...),
    limit: int = Query(10, ge=1, le=50),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Find entities similar to the given entity using MLT."""
    org_id = str(get_authorized_org_id(request, auth, query_org_id=organization_id))

    if not is_opensearch_available():
        return {"similar": []}

    client = get_opensearch_client()
    if not client:
        return {"similar": []}

    os_query = query_builder.build_similar_query(entity_key, org_id, limit)

    try:
        response = client.search(
            index="madrona-entities-read",
            body=os_query,
            routing=org_id,
        )
    except Exception as e:
        logger.error(f"Similar search failed: {e}")
        return {"similar": []}

    similar = [
        SimilarEntity(
            entity_key=hit["_source"]["entity_key"],
            title=hit["_source"].get("title"),
            thumbnail_url=hit["_source"].get("thumbnail_url"),
            score=hit["_score"] or 0,
        )
        for hit in response["hits"]["hits"]
    ]

    result = SimilarResponse(similar=similar)
    return result.model_dump()
