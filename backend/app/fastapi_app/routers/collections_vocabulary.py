"""
Vocabulary endpoints (FastAPI).

Controlled vocabulary management including Getty AAT integration.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import VocabularyTerm
from app.permissions import Permission
from app.services.vocabulary_service import VocabularyService
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.collections_vocabulary import (
    VocabularyTermOut,
    VocabularySearchResponse,
    VocabularyExpandResponse,
    VocabularySyncResponse,
    VocabularyImportQueuedResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-vocabulary"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_vocabulary_term(term: VocabularyTerm) -> dict:
    """Serialize a VocabularyTerm to JSON."""
    return {
        "term_id": str(term.term_id),
        "organization_id": str(term.organization_id) if term.organization_id else None,
        "vocabulary": term.vocabulary,
        "external_id": term.external_id,
        "external_uri": term.external_uri,
        "preferred_term": term.preferred_term,
        "alternate_terms": term.alternate_terms,
        "scope_note": term.scope_note,
        "term_type": term.term_type,
        "hierarchy_path": term.hierarchy_path,
        "broader_term": term.broader_term,
        "applicable_fields": term.applicable_fields,
        "usage_count": term.usage_count,
        "status": term.status,
        "is_custom": term.is_custom,
        "facet": term.facet,
        "hierarchy_fetched_at": term.hierarchy_fetched_at.isoformat() if term.hierarchy_fetched_at else None,
        "getty_modified_at": term.getty_modified_at.isoformat() if term.getty_modified_at else None,
    }


# ============================================================================
# VOCABULARY ROUTES
# ============================================================================


@router.get("/api/organizations/{organization_id}/collections/vocabulary/search", response_model=VocabularySearchResponse, summary="Search vocabulary")
def search_vocabulary(
    organization_id: UUID,
    q: str = Query(""),
    vocabulary: str | None = Query(None),
    field: str | None = Query(None),
    facet: str | None = Query(None),
    limit: int = Query(20, le=100),
    include_remote: str = Query("true"),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Search vocabulary terms for autocomplete.

    Searches local cache first, then Getty APIs (AAT, ULAN, TGN) for additional results.
    """
    query_text = q.strip()

    if len(query_text) < 2:
        return {"terms": [], "total": 0}

    vocab_service = VocabularyService(db, str(organization_id))
    results = vocab_service.search(
        query=query_text,
        vocabulary=vocabulary,
        applicable_field=field,
        facet=facet,
        limit=limit,
        include_remote=include_remote.lower() == "true",
    )

    return {
        "terms": [r.to_dict() for r in results],
        "total": len(results),
    }


@router.post("/api/organizations/{organization_id}/collections/vocabulary/terms", status_code=201, response_model=VocabularyTermOut, summary="Create vocabulary term")
def create_vocabulary_term(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """
    Create a custom vocabulary term for this organization.
    """
    if not data.get("preferred_term"):
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_FIELDS",
            "message": "Missing: preferred_term",
        })

    vocab_service = VocabularyService(db, str(organization_id))
    term = vocab_service.create_custom_term(
        preferred_term=data["preferred_term"],
        scope_note=data.get("scope_note"),
        applicable_fields=data.get("applicable_fields"),
    )

    db.commit()

    return _serialize_vocabulary_term(term)


@router.get("/api/organizations/{organization_id}/collections/vocabulary/terms/{term_id}", response_model=VocabularyTermOut, summary="Get vocabulary term")
def get_vocabulary_term(
    organization_id: UUID,
    term_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a vocabulary term by ID."""
    term = db.query(VocabularyTerm).filter(
        VocabularyTerm.term_id == term_id,
    ).first()

    if not term:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Term not found",
        })

    return _serialize_vocabulary_term(term)


@router.get("/api/organizations/{organization_id}/collections/vocabulary/lookup", response_model=VocabularyTermOut, summary="Lookup vocabulary term")
def lookup_vocabulary_term(
    organization_id: UUID,
    external_id: str | None = Query(None),
    vocabulary: str | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Look up a vocabulary term by external ID (e.g., Getty AAT ID).
    """
    if not external_id or not vocabulary:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_PARAMS",
            "message": "external_id and vocabulary required",
        })

    if vocabulary not in ("aat", "ulan", "tgn"):
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_VOCABULARY",
            "message": "vocabulary must be aat, ulan, or tgn",
        })

    vocab_service = VocabularyService(db, str(organization_id))
    result = vocab_service.get_term_by_external_id(external_id, vocabulary)

    if not result:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Term not found",
        })

    return result.to_dict()


@router.post("/api/organizations/{organization_id}/collections/vocabulary/cache", status_code=201, response_model=VocabularyTermOut, summary="Cache vocabulary term")
def cache_vocabulary_term(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """
    Cache a Getty vocabulary term locally for faster access.

    Used when a user selects a term from Getty search results.
    """
    required_fields = ["vocabulary", "external_id", "preferred_term"]
    missing_fields = [f for f in required_fields if f not in data]
    if missing_fields:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_FIELDS",
            "message": f"Missing: {', '.join(missing_fields)}",
        })

    vocab_service = VocabularyService(db, str(organization_id))

    from app.services.vocabulary_service import VocabularyTermResult
    result = VocabularyTermResult(
        term_id=None,
        vocabulary=data["vocabulary"],
        external_id=data["external_id"],
        external_uri=data.get("external_uri"),
        preferred_term=data["preferred_term"],
        alternate_terms=data.get("alternate_terms"),
        scope_note=data.get("scope_note"),
        broader_term=data.get("broader_term"),
        hierarchy_path=data.get("hierarchy_path"),
        is_local=False,
        usage_count=0,
    )

    term = vocab_service.cache_term(result, data.get("applicable_fields"))
    db.commit()

    # Trigger hierarchy sync in background for Getty terms
    if term.external_id and term.vocabulary in ("aat", "ulan", "tgn"):
        from app.tasks.vocabulary import sync_term_hierarchy_task
        sync_term_hierarchy_task.delay(term.external_id, term.vocabulary)

    return _serialize_vocabulary_term(term)


@router.post("/api/organizations/{organization_id}/collections/vocabulary/terms/{term_id}/usage", response_model=SuccessResponse, summary="Record vocabulary usage")
def record_vocabulary_usage(
    organization_id: UUID,
    term_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Record that a vocabulary term was used (for popularity ranking).

    Called when a term is selected/applied to an object.
    """
    vocab_service = VocabularyService(db, str(organization_id))
    vocab_service.record_usage(term_id)
    db.commit()

    return {"success": True}


@router.get("/api/organizations/{organization_id}/collections/vocabulary/terms/{term_id}/hierarchy", response_model=None, summary="Get vocabulary term hierarchy")
def get_vocabulary_term_hierarchy(
    organization_id: UUID,
    term_id: UUID,
    sync: str = Query("false"),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Get the full hierarchy for a vocabulary term.

    Returns the term with its broader (ancestor) terms, narrower (descendant) terms,
    and related (associative) terms.

    If hierarchy data is stale or missing, triggers a background sync.
    """
    from app.services.vocabulary_hierarchy_service import VocabularyHierarchyService

    term = db.query(VocabularyTerm).filter(
        VocabularyTerm.term_id == term_id,
    ).first()

    if not term:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Term not found",
        })

    service = VocabularyHierarchyService(db)

    # Check if we need to sync hierarchy
    if service.is_hierarchy_stale(term):
        sync_param = sync.lower() == "true"

        if sync_param and term.external_id and term.vocabulary in ("aat", "ulan", "tgn"):
            # Synchronous fetch (slower but complete)
            service.fetch_term_with_hierarchy(term.external_id, term.vocabulary)
        else:
            # Queue background sync
            vocab_service = VocabularyService(db, str(organization_id))
            vocab_service.trigger_hierarchy_sync(term_id)

    # Get hierarchy data
    hierarchy = service.get_term_hierarchy(term_id)

    return hierarchy


@router.get("/api/organizations/{organization_id}/collections/vocabulary/browse", response_model=None, summary="Browse vocabulary")
def browse_vocabulary(
    organization_id: UUID,
    vocabulary: str = Query("aat"),
    facet: str | None = Query(None),
    limit: int = Query(50, le=200),
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Browse vocabulary terms by facet.

    Returns top-level facets for hierarchical browsing of vocabulary terms.
    """
    from app.services.vocabulary_hierarchy_service import VocabularyHierarchyService

    if vocabulary not in ("aat", "ulan", "tgn", "local"):
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_VOCABULARY",
            "message": "vocabulary must be aat, ulan, tgn, or local",
        })

    service = VocabularyHierarchyService(db)

    if facet:
        # Get terms in a specific facet
        terms = db.query(VocabularyTerm).filter(
            VocabularyTerm.vocabulary == vocabulary,
            VocabularyTerm.facet == facet,
            VocabularyTerm.status == "active",
        ).order_by(
            VocabularyTerm.usage_count.desc(),
            VocabularyTerm.preferred_term,
        ).limit(limit).all()

        return {
            "vocabulary": vocabulary,
            "facet": facet,
            "terms": [_serialize_vocabulary_term(t) for t in terms],
        }
    else:
        # Get list of facets
        facets = service.get_top_level_facets(vocabulary)

        return {
            "vocabulary": vocabulary,
            "facets": facets,
        }


@router.post("/api/organizations/{organization_id}/collections/vocabulary/expand", response_model=VocabularyExpandResponse, summary="Expand vocabulary terms")
def expand_vocabulary_terms(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Expand vocabulary terms to include narrower terms.

    Used for search expansion - given a set of term IDs, returns an expanded
    list that includes all narrower (more specific) terms.
    """
    from app.services.vocabulary_hierarchy_service import VocabularyHierarchyService

    term_ids_str = data.get("term_ids", [])
    include_narrower = data.get("include_narrower", True)
    max_depth = min(int(data.get("max_depth", 2)), 5)

    if not term_ids_str:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_PARAMS",
            "message": "term_ids is required",
        })

    term_ids = [UUID(tid) for tid in term_ids_str]

    service = VocabularyHierarchyService(db)
    expanded_ids = service.expand_search_terms(
        term_ids,
        include_narrower=include_narrower,
        max_depth=max_depth,
    )

    # Get term info for expanded IDs
    terms = db.query(VocabularyTerm).filter(
        VocabularyTerm.term_id.in_(expanded_ids),
    ).all()

    return {
        "original_count": len(term_ids),
        "expanded_count": len(expanded_ids),
        "terms": [
            {
                "term_id": str(t.term_id),
                "vocabulary": t.vocabulary,
                "external_id": t.external_id,
                "preferred_term": t.preferred_term,
            }
            for t in terms
        ],
    }


@router.post("/api/organizations/{organization_id}/collections/vocabulary/terms/{term_id}/sync", response_model=VocabularySyncResponse, summary="Sync vocabulary term hierarchy")
def sync_vocabulary_term_hierarchy(
    organization_id: UUID,
    term_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DATA_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Trigger a hierarchy sync for a vocabulary term.

    Forces a refresh of the term's hierarchy data from Getty, even if
    the existing data is not stale.

    Returns immediately - sync happens in background.
    """
    term = db.query(VocabularyTerm).filter(
        VocabularyTerm.term_id == term_id,
    ).first()

    if not term:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Term not found",
        })

    if not term.external_id:
        raise HTTPException(status_code=400, detail={
            "code": "validation_error",
            "message": "Local terms cannot be synced",
        })

    if term.vocabulary not in ("aat", "ulan", "tgn"):
        raise HTTPException(status_code=400, detail={
            "code": "validation_error",
            "message": "Only Getty terms can be synced",
        })

    # Queue the sync task
    from app.tasks.vocabulary import sync_term_hierarchy_task
    task = sync_term_hierarchy_task.delay(
        external_id=term.external_id,
        vocabulary=term.vocabulary,
    )

    return {
        "status": "queued",
        "task_id": task.id,
        "term_id": str(term_id),
        "vocabulary": term.vocabulary,
        "external_id": term.external_id,
    }


@router.post("/api/organizations/{organization_id}/collections/vocabulary/import", status_code=202, response_model=VocabularyImportQueuedResponse, summary="Import getty term")
def import_getty_term(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DATA_MANAGE)),
    db: Session = Depends(get_db),
):
    """
    Import a Getty vocabulary term as a global cached term.

    Used by the Vocabulary Explorer to import terms. Unlike /vocabulary/cache,
    this creates a global term (organization_id=None) that is shared across
    all organizations using the platform.

    The import is queued as a background task that will:
    1. Create the term if it doesn't exist
    2. Fetch full hierarchy data from Getty

    Returns immediately with queued status.
    """
    required_fields = ["vocabulary", "external_id", "preferred_term"]
    missing_fields = [f for f in required_fields if f not in data]
    if missing_fields:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_FIELDS",
            "message": f"Missing: {', '.join(missing_fields)}",
        })

    vocabulary = data["vocabulary"]
    if vocabulary not in ("aat", "ulan", "tgn"):
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_VOCABULARY",
            "message": "Must be aat, ulan, or tgn",
        })

    external_id = data["external_id"]

    # Check if term already exists globally
    existing = db.query(VocabularyTerm).filter(
        VocabularyTerm.vocabulary == vocabulary,
        VocabularyTerm.external_id == external_id,
        VocabularyTerm.organization_id.is_(None),  # Global term
    ).first()

    if existing:
        return {
            "status": "already_exists",
            "term_id": str(existing.term_id),
            "vocabulary": vocabulary,
            "external_id": external_id,
            "preferred_term": existing.preferred_term,
        }

    # Queue the import task
    from app.tasks.vocabulary import import_getty_term_task
    task = import_getty_term_task.delay(
        external_id=external_id,
        vocabulary=vocabulary,
        preferred_term=data["preferred_term"],
        facet=data.get("facet"),
        scope_note=data.get("scope_note"),
        broader_term=data.get("broader_term"),
        external_uri=data.get("external_uri"),
    )

    return {
        "status": "queued",
        "task_id": task.id,
        "vocabulary": vocabulary,
        "external_id": external_id,
        "preferred_term": data["preferred_term"],
    }
