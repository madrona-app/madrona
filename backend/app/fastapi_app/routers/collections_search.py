"""
Collection search endpoints (FastAPI) - OpenSearch integration.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.permissions import Permission
from app.services.api_security import sanitize_error_message
from app.fastapi_app.schemas.collections_search import (
    CollectionSearchResponse,
    AutocompleteResponse,
    ReindexResponse,
    EnableSemanticSearchResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-search"])


@router.post("/api/organizations/{organization_id}/collections/search", response_model=CollectionSearchResponse, summary="Search collection objects")
def search_collection_objects(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Search collection objects using OpenSearch.

    Supports:
    - Full-text search across procedure fields
    - Advanced search with field-specific operators
    - Faceted filtering by object type, creator, material, date, etc.
    - Sorting and pagination

    Request body:
    {
        "query": {"q": "search terms"},
        "filters": {
            "object_type": ["painting"],
            "creator_name": "Picasso",
            "date_from": "1900",
            "date_to": "1950"
        },
        "advanced_criteria": [
            {"field": "title", "operator": "contains", "value": "blue"}
        ],
        "sort": {"field": "creation_date", "order": "desc"},
        "limit": 20,
        "offset": 0,
        "include_facets": true
    }
    """
    from app.search.collections.service import (
        CollectionsSearchService,
        get_collections_search_service,
    )
    from app.search.collections.schemas import CollectionsSearchRequest

    # Check if OpenSearch is available
    if not CollectionsSearchService.is_available():
        raise HTTPException(status_code=503, detail={
            "code": "SEARCH_UNAVAILABLE",
            "message": "Search service is not available",
        })

    # Parse request
    search_request = CollectionsSearchRequest(**data)

    # Get service and ensure index exists
    service = get_collections_search_service()
    try:
        service.setup_index()
    except Exception as e:
        # error, not warning: if this fails the search below has nothing to
        # read from and returns a 500 with no explanation. This line is the
        # only place the actual reason is recorded.
        logger.error(
            f"Could not setup collections index: {e}. "
            f"Search will fail until this is resolved."
        )

    # Execute search with db_session for vocabulary expansion
    response = service.search(search_request, organization_id, db_session=db)

    return response.model_dump()


@router.get("/api/organizations/{organization_id}/collections/search/autocomplete", response_model=AutocompleteResponse, summary="Autocomplete collection objects")
def autocomplete_collection_objects(
    organization_id: UUID,
    q: str = Query(""),
    field: str = Query("title"),
    limit: int = Query(10),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Get autocomplete suggestions for collection objects.

    Query parameters:
    - q: Partial search query (required)
    - field: Field to autocomplete (title, object_number) - default: title
    - limit: Max suggestions (default: 10)
    """
    from app.search.collections.service import (
        CollectionsSearchService,
        get_collections_search_service,
    )

    if not CollectionsSearchService.is_available():
        raise HTTPException(status_code=503, detail={
            "code": "SEARCH_UNAVAILABLE",
            "message": "Search service is not available",
        })

    query = q.strip()
    limit = min(limit, 50)

    if len(query) < 2:
        return {"suggestions": []}

    if field not in ("title", "object_number"):
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_FIELD",
            "message": "Field must be 'title' or 'object_number'",
        })

    service = get_collections_search_service()
    try:
        service.setup_index()
    except Exception as e:
        # error, not warning: if this fails the search below has nothing to
        # read from and returns a 500 with no explanation. This line is the
        # only place the actual reason is recorded.
        logger.error(
            f"Could not setup collections index: {e}. "
            f"Search will fail until this is resolved."
        )

    response = service.autocomplete(query, field, organization_id, limit)

    return response.model_dump()


@router.post("/api/organizations/{organization_id}/collections/search/reindex", response_model=ReindexResponse, summary="Reindex collection objects")
def reindex_collection_objects(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Trigger a full reindex of collection objects for this organization.

    This is an admin operation that rebuilds the search index from the database.
    """
    from app.search.collections.service import (
        CollectionsSearchService,
        get_collections_search_service,
    )

    if not CollectionsSearchService.is_available():
        raise HTTPException(status_code=503, detail={
            "code": "SEARCH_UNAVAILABLE",
            "message": "Search service is not available",
        })

    service = get_collections_search_service()
    result = service.reindex_organization(db, organization_id)

    return {
        "success": True,
        "total": result["total"],
        "indexed": result["indexed"],
        "errors": len(result["errors"]),
        "debug_all_objects": result.get("debug_all_objects"),
    }


@router.post("/api/organizations/{organization_id}/collections/search/enable-semantic", response_model=EnableSemanticSearchResponse, summary="Enable semantic search")
def enable_semantic_search(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Enable semantic search for this organization's collections index.

    Adds the knn_vector field mapping to the existing index and dispatches
    a background task to backfill embeddings for all objects.
    """
    from app.config import get_settings
    from app.search.collections.service import (
        CollectionsSearchService,
        get_collections_search_service,
    )

    settings = get_settings()
    if not settings.semantic_search_enabled:
        raise HTTPException(status_code=400, detail={
            "code": "SEMANTIC_SEARCH_DISABLED",
            "message": "Semantic search is not enabled. Set SEMANTIC_SEARCH_ENABLED=true.",
        })

    if not CollectionsSearchService.is_available():
        raise HTTPException(status_code=503, detail={
            "code": "SEARCH_UNAVAILABLE",
            "message": "Search service is not available",
        })

    # Update the index mapping to add the vector field
    service = get_collections_search_service()
    try:
        service.index_manager.update_mapping_for_semantic_search()
    except Exception as e:
        logger.error("Failed to update index mapping for semantic search: %s", e)
        raise HTTPException(status_code=500, detail={
            "code": "MAPPING_UPDATE_FAILED",
            "message": sanitize_error_message(str(e)),
        })

    # Dispatch backfill task
    from app.tasks.semantic_search import backfill_embeddings
    task = backfill_embeddings.delay(organization_id=str(organization_id))

    return {
        "success": True,
        "message": "Semantic search enabled. Embedding backfill started.",
        "task_id": task.id,
    }
