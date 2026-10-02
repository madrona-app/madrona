"""
Collections Relations API endpoints (FastAPI).

Provides CRUD for:
- Object Relationships (CDWA Category 20) — 4 routes
- Citations / Bibliography (CDWA Category 27) — 5 routes
- Object-Citation Links — 4 routes
- Critical Responses (CDWA Category 19) — 5 routes
- Cataloging History (CDWA Category 25) — 3 routes (append-only)
- Object Contexts (CDWA Category 17) — 4 routes

Migrated from app/api/collections_cdwa_procedure.py (Domains 3-7).

Field mapping notes (Flask serializer → actual model column):
  ObjectRelationship:
    external_work_title → related_work_title
    external_work_creator → related_work_creator
    external_work_date → relationship_date_display (Flask had no model column for this)
    external_work_location → related_work_location
    notes → relationship_note
  Citation:
    publication_place → place_published
    notes → citation_note
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    ObjectRelationship,
    Citation,
    ObjectCitation,
    CriticalResponse,
    CatalogingHistory,
    ObjectContext,
    CollectionObject,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.validation_utils import parse_uuid_or_raise
from app.fastapi_app.schemas.collections_relations import (
    ObjectRelationshipOut,
    ObjectRelationshipsResponse,
    CitationOut,
    CitationListResponse,
    ObjectCitationOut,
    ObjectCitationListResponse,
    CriticalResponseOut,
    CriticalResponseListResponse,
    CatalogingHistoryOut,
    CatalogingHistoryListResponse,
    ObjectContextOut,
    ObjectContextListResponse,
)
from app.fastapi_app.schemas.common import MessageResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-relations"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _get_object_thumbnail(obj, db) -> str | None:
    """Get primary image thumbnail URL for a collection object."""
    try:
        from app.models.media import CollectionObjectMedia
        from sqlalchemy.orm import joinedload
        from app.services.uploads import get_org_media_url

        primary_link = db.query(CollectionObjectMedia).options(
            joinedload(CollectionObjectMedia.media)
        ).filter(
            CollectionObjectMedia.object_id == obj.object_id,
            CollectionObjectMedia.is_primary == True,  # noqa: E712
        ).first()

        if not primary_link:
            primary_link = db.query(CollectionObjectMedia).options(
                joinedload(CollectionObjectMedia.media)
            ).filter(
                CollectionObjectMedia.object_id == obj.object_id,
            ).order_by(CollectionObjectMedia.sort_order).first()

        if primary_link and primary_link.media:
            return get_org_media_url(
                primary_link.media.s3_key,
                organization_id=str(obj.organization_id),
                db_session=db,
                expiry_seconds=3600,
            )
    except Exception:
        pass
    return None


def _serialize_object_relationship(rel: ObjectRelationship, db=None) -> dict:
    """Serialize an ObjectRelationship to JSON.

    Maps model column names to API field names for backwards compat:
      related_work_title → external_work_title
      related_work_creator → external_work_creator
      related_work_location → external_work_location
      relationship_note → notes

    For internal relationships, includes related object summary from the
    related_object ORM relationship (title, object_number, thumbnail).
    """
    result = {
        "relationship_id": str(rel.relationship_id),
        "organization_id": str(rel.organization_id),
        "source_object_id": str(rel.source_object_id),
        "related_object_id": str(rel.related_object_id) if rel.related_object_id else None,
        "external_work_title": rel.related_work_title,
        "external_work_creator": rel.related_work_creator,
        "external_work_date": rel.relationship_date_display,
        "external_work_location": rel.related_work_location,
        "relationship_type": rel.relationship_type,
        "relationship_direction": rel.relationship_direction,
        "sequence_number": rel.sequence_number,
        "external_work_identifier": rel.related_work_identifier,
        "external_work_thumbnail_url": rel.related_work_description,
        "notes": rel.relationship_note,
        "created_at": rel.created_at.isoformat() if rel.created_at else None,
    }

    # Enrich internal relationships with related object details
    if rel.related_object_id:
        obj = rel.related_object if rel.related_object else (
            db.query(CollectionObject).filter(
                CollectionObject.object_id == rel.related_object_id
            ).first() if db else None
        )
        if obj:
            title = obj.object_name
            if hasattr(obj, 'title_links') and obj.title_links:
                primary = next((t for t in obj.title_links if t.is_preferred), None)
                tl = primary or obj.title_links[0]
                title = tl.title or title
            result["related_object_summary"] = {
                "title": title,
                "object_number": obj.object_number,
                "object_type": obj.object_type,
                "creation_date": obj.creation_date_display,
                "thumbnail_url": _get_object_thumbnail(obj, db) if db else None,
            }

    return result


def _serialize_citation(c: Citation) -> dict:
    """Serialize a Citation to JSON.

    Maps model column names to API field names:
      place_published → publication_place
      citation_note → notes
    """
    return {
        "citation_id": str(c.citation_id),
        "organization_id": str(c.organization_id),
        "citation_type": c.citation_type,
        "brief_citation": c.brief_citation,
        "full_citation": c.full_citation,
        "author": c.author,
        "title": c.title,
        "publication": c.publication,
        "publisher": c.publisher,
        "publication_place": c.place_published,
        "publication_year": c.publication_year,
        "volume": c.volume,
        "issue": c.issue,
        "pages": c.pages,
        "url": c.url,
        "doi": c.doi,
        "isbn": c.isbn,
        "works_cited": c.works_cited,
        "works_illustrated": c.works_illustrated,
        "notes": c.citation_note,
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _serialize_object_citation(link: ObjectCitation) -> dict:
    """Serialize an ObjectCitation link to JSON, embedding citation details."""
    citation = link.citation
    return {
        "link_id": str(link.link_id),
        "organization_id": str(link.organization_id),
        "object_id": str(link.object_id),
        "citation_id": str(link.citation_id),
        "page_reference": link.page_reference,
        "figure_reference": link.figure_reference,
        "plate_reference": link.plate_reference,
        "catalog_number": link.catalog_number,
        "works_cited": link.works_cited,
        "works_illustrated": link.works_illustrated,
        "is_primary": link.is_primary,
        "display_order": link.display_order,
        "link_note": link.link_note,
        "created_at": link.created_at.isoformat() if link.created_at else None,
        "citation": _serialize_citation(citation) if citation else None,
    }


def _serialize_critical_response(cr: CriticalResponse) -> dict:
    return {
        "response_id": str(cr.response_id),
        "organization_id": str(cr.organization_id),
        "object_id": str(cr.object_id),
        "comment_text": cr.comment_text,
        "comment_summary": cr.comment_summary,
        "document_type": cr.document_type,
        "author_name": cr.author_name,
        "author_authority_id": str(cr.author_authority_id) if cr.author_authority_id else None,
        "comment_date_display": cr.comment_date_display,
        "comment_date_earliest": cr.comment_date_earliest.isoformat() if cr.comment_date_earliest else None,
        "comment_date_latest": cr.comment_date_latest.isoformat() if cr.comment_date_latest else None,
        "circumstances": cr.circumstances,
        "publication_info": cr.publication_info,
        "citation_id": str(cr.citation_id) if cr.citation_id else None,
        "source_page": cr.source_page,
        "notes": cr.notes,
        "created_at": cr.created_at.isoformat() if cr.created_at else None,
        "updated_at": cr.updated_at.isoformat() if cr.updated_at else None,
    }


def _serialize_cataloging_history(ch: CatalogingHistory) -> dict:
    return {
        "history_id": str(ch.history_id),
        "organization_id": str(ch.organization_id),
        "object_id": str(ch.object_id),
        "cataloger_name": ch.cataloger_name,
        "cataloger_id": str(ch.cataloger_id) if ch.cataloger_id else None,
        "institution": ch.institution,
        "catalog_date": ch.catalog_date.isoformat() if ch.catalog_date else None,
        "catalog_language": ch.catalog_language,
        "record_type": ch.record_type,
        "fields_modified": ch.fields_modified,
        "change_summary": ch.change_summary,
        "previous_values": ch.previous_values,
        "notes": ch.notes,
        "created_at": ch.created_at.isoformat() if ch.created_at else None,
    }


def _serialize_object_context(oc: ObjectContext) -> dict:
    return {
        "context_id": str(oc.context_id),
        "organization_id": str(oc.organization_id),
        "object_id": str(oc.object_id),
        "context_type": oc.context_type,
        "building_name": oc.building_name,
        "site_name": oc.site_name,
        "part_placement": oc.part_placement,
        "architectural_date_display": oc.architectural_date_display,
        "architectural_date_earliest": oc.architectural_date_earliest.isoformat() if oc.architectural_date_earliest else None,
        "architectural_date_latest": oc.architectural_date_latest.isoformat() if oc.architectural_date_latest else None,
        "historical_place_id": str(oc.historical_place_id) if oc.historical_place_id else None,
        "historical_date_display": oc.historical_date_display,
        "historical_date_earliest": oc.historical_date_earliest.isoformat() if oc.historical_date_earliest else None,
        "historical_date_latest": oc.historical_date_latest.isoformat() if oc.historical_date_latest else None,
        "event_id": str(oc.event_id) if oc.event_id else None,
        "event_description": oc.event_description,
        "notes": oc.notes,
        "display_order": oc.display_order,
        "created_at": oc.created_at.isoformat() if oc.created_at else None,
        "updated_at": oc.updated_at.isoformat() if oc.updated_at else None,
    }


# ============================================================================
# OBJECT RELATIONSHIPS (CDWA Category 20) — 4 routes
# ============================================================================

# API field → model column mapping for ObjectRelationship
_REL_API_TO_MODEL = {
    "external_work_title": "related_work_title",
    "external_work_creator": "related_work_creator",
    "external_work_date": "relationship_date_display",
    "external_work_location": "related_work_location",
    "external_work_identifier": "related_work_identifier",
    "external_work_thumbnail_url": "related_work_description",
    "notes": "relationship_note",
}


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/relationships", response_model=ObjectRelationshipsResponse, summary="Get object relationships")
def get_object_relationships(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get object relationships."""
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    outgoing = db.query(ObjectRelationship).filter(
        ObjectRelationship.source_object_id == object_id,
        ObjectRelationship.organization_id == org_id,
    ).all()

    incoming = db.query(ObjectRelationship).filter(
        ObjectRelationship.related_object_id == object_id,
        ObjectRelationship.organization_id == org_id,
    ).all()

    return {
        "outgoing": [_serialize_object_relationship(r, db=db) for r in outgoing],
        "incoming": [_serialize_object_relationship(r, db=db) for r in incoming],
    }


@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/relationships", status_code=201, response_model=ObjectRelationshipOut, summary="Create object relationship")
def create_object_relationship(
    org_id: UUID,
    object_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.OBJECT_RELATIONSHIPS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create object relationship."""
    if not body.get("relationship_type"):
        raise HTTPException(status_code=400, detail="Missing: relationship_type")

    has_internal = body.get("related_object_id")
    has_external = body.get("external_work_title")
    if not has_internal and not has_external:
        raise HTTPException(status_code=400, detail="Must provide either related_object_id or external_work_title")

    source = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == org_id,
    ).first()
    if not source:
        raise HTTPException(status_code=404, detail="Source object not found")

    related_uuid = None
    if has_internal:
        related_uuid = parse_uuid_or_raise(body["related_object_id"])
        related = db.query(CollectionObject).filter(
            CollectionObject.object_id == related_uuid,
            CollectionObject.organization_id == org_id,
        ).first()
        if not related:
            raise HTTPException(status_code=404, detail="Related object not found")

    relationship = ObjectRelationship(
        organization_id=org_id,
        source_object_id=object_id,
        related_object_id=related_uuid,
        related_work_title=body.get("external_work_title"),
        related_work_creator=body.get("external_work_creator"),
        relationship_date_display=body.get("external_work_date"),
        related_work_location=body.get("external_work_location"),
        related_work_identifier=body.get("external_work_identifier"),
        related_work_description=body.get("external_work_thumbnail_url"),
        relationship_type=body["relationship_type"],
        relationship_direction=body.get("relationship_direction", "forward"),
        sequence_number=body.get("sequence_number"),
        relationship_note=body.get("notes"),
        created_by=auth.user_id,
    )

    db.add(relationship)
    db.commit()

    return _serialize_object_relationship(relationship)


@router.put("/api/organizations/{org_id}/collections/relationships/{relationship_id}", response_model=ObjectRelationshipOut, summary="Update object relationship")
def update_object_relationship(
    org_id: UUID,
    relationship_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.OBJECT_RELATIONSHIPS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update object relationship."""
    relationship = db.query(ObjectRelationship).filter(
        ObjectRelationship.relationship_id == relationship_id,
        ObjectRelationship.organization_id == org_id,
    ).first()
    if not relationship:
        raise HTTPException(status_code=404, detail="Relationship not found")

    updateable_api = [
        'relationship_type', 'relationship_direction', 'sequence_number',
        'external_work_title', 'external_work_creator', 'external_work_date',
        'external_work_location', 'external_work_identifier',
        'external_work_thumbnail_url', 'notes',
    ]
    for api_key in updateable_api:
        if api_key in body:
            model_key = _REL_API_TO_MODEL.get(api_key, api_key)
            setattr(relationship, model_key, body[api_key])

    db.commit()
    return _serialize_object_relationship(relationship)


@router.delete("/api/organizations/{org_id}/collections/relationships/{relationship_id}", response_model=MessageResponse, summary="Delete object relationship")
def delete_object_relationship(
    org_id: UUID,
    relationship_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.OBJECT_RELATIONSHIPS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete object relationship."""
    relationship = db.query(ObjectRelationship).filter(
        ObjectRelationship.relationship_id == relationship_id,
        ObjectRelationship.organization_id == org_id,
    ).first()
    if not relationship:
        raise HTTPException(status_code=404, detail="Relationship not found")

    db.delete(relationship)
    db.commit()
    return {"message": "Relationship deleted successfully"}


@router.get("/api/organizations/{org_id}/collections/relationships/wikidata-artwork-search", summary="Search wikidata artworks endpoint")
def search_wikidata_artworks_endpoint(
    org_id: UUID,
    q: str = Query(""),
    limit: int = Query(10, le=20),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
):
    """Search Wikidata for artworks to link as external related objects."""
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail={
            "code": "QUERY_TOO_SHORT",
            "message": "Query must be at least 2 characters",
        })

    from app.services.external_lookups import search_wikidata_artworks
    results = search_wikidata_artworks(query, limit=limit)
    return {"query": query, "results": results}


# ============================================================================
# CITATIONS (CDWA Category 27) — 5 routes
# ============================================================================

# API field → model column mapping for Citation
_CITATION_API_TO_MODEL = {
    "publication_place": "place_published",
    "notes": "citation_note",
}


@router.get("/api/organizations/{org_id}/collections/citations", response_model=CitationListResponse, summary="List citations")
def list_citations(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CITATIONS_VIEW)),
    db: Session = Depends(get_db),
    limit: int = Query(50, le=500),
    offset: int = Query(0, ge=0),
    q: str | None = Query(None),
    search: str | None = Query(None),
    citation_type: str | None = Query(None),
):
    """List citations."""
    search_term = (q or search or "").strip()

    query = db.query(Citation).filter(Citation.organization_id == org_id)

    if search_term:
        pattern = f"%{escape_ilike(search_term)}%"
        query = query.filter(
            or_(
                Citation.brief_citation.ilike(pattern, escape="\\"),
                Citation.author.ilike(pattern, escape="\\"),
                Citation.title.ilike(pattern, escape="\\"),
            )
        )

    if citation_type:
        query = query.filter(Citation.citation_type == citation_type)

    total = query.count()
    citations = query.order_by(Citation.brief_citation).offset(offset).limit(limit).all()

    return {
        "items": [_serialize_citation(c) for c in citations],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post("/api/organizations/{org_id}/collections/citations", status_code=201, response_model=CitationOut, summary="Create citation")
def create_citation(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.CITATIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Create citation."""
    if not body.get("brief_citation"):
        raise HTTPException(status_code=400, detail="Missing: brief_citation")

    citation = Citation(
        organization_id=org_id,
        citation_type=body.get("citation_type", "book"),
        brief_citation=body["brief_citation"],
        full_citation=body.get("full_citation", ""),
        author=body.get("author"),
        title=body.get("title"),
        publication=body.get("publication"),
        publisher=body.get("publisher"),
        place_published=body.get("publication_place"),
        publication_year=body.get("publication_year"),
        volume=body.get("volume"),
        issue=body.get("issue"),
        pages=body.get("pages"),
        url=body.get("url"),
        doi=body.get("doi"),
        isbn=body.get("isbn"),
        works_cited=body.get("works_cited", False),
        works_illustrated=body.get("works_illustrated", False),
        citation_note=body.get("notes"),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )

    db.add(citation)
    db.commit()

    return _serialize_citation(citation)


@router.get("/api/organizations/{org_id}/collections/citations/{citation_id}", response_model=CitationOut, summary="Get citation")
def get_citation(
    org_id: UUID,
    citation_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CITATIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get citation."""
    citation = db.query(Citation).filter(
        Citation.citation_id == citation_id,
        Citation.organization_id == org_id,
    ).first()
    if not citation:
        raise HTTPException(status_code=404, detail="Citation not found")

    return _serialize_citation(citation)


@router.put("/api/organizations/{org_id}/collections/citations/{citation_id}", response_model=CitationOut, summary="Update citation")
def update_citation(
    org_id: UUID,
    citation_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.CITATIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update citation."""
    citation = db.query(Citation).filter(
        Citation.citation_id == citation_id,
        Citation.organization_id == org_id,
    ).first()
    if not citation:
        raise HTTPException(status_code=404, detail="Citation not found")

    protected = {'citation_id', 'organization_id', 'created_at', 'created_by', 'updated_by'}
    for api_key, value in body.items():
        if api_key in protected:
            continue
        model_key = _CITATION_API_TO_MODEL.get(api_key, api_key)
        if hasattr(citation, model_key):
            setattr(citation, model_key, value)

    citation.updated_by = auth.user_id
    citation.updated_at = datetime.now(timezone.utc)

    db.commit()
    return _serialize_citation(citation)


@router.delete("/api/organizations/{org_id}/collections/citations/{citation_id}", response_model=MessageResponse, summary="Delete citation")
def delete_citation(
    org_id: UUID,
    citation_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CITATIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete citation."""
    citation = db.query(Citation).filter(
        Citation.citation_id == citation_id,
        Citation.organization_id == org_id,
    ).first()
    if not citation:
        raise HTTPException(status_code=404, detail="Citation not found")

    db.delete(citation)
    db.commit()
    return {"message": "Citation deleted successfully"}


# ============================================================================
# OBJECT-CITATION LINKS — 4 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/citations", response_model=ObjectCitationListResponse, summary="Get object citations")
def get_object_citations(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CITATIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get object citations."""
    links = db.query(ObjectCitation).filter(
        ObjectCitation.organization_id == org_id,
        ObjectCitation.object_id == object_id,
    ).order_by(ObjectCitation.display_order, ObjectCitation.created_at).all()

    return {
        "citations": [_serialize_object_citation(link) for link in links],
        "total": len(links),
    }


@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/citations", status_code=201, response_model=ObjectCitationOut, summary="Link object citation")
def link_object_citation(
    org_id: UUID,
    object_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.CITATIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link object citation."""
    if not body.get("citation_id"):
        raise HTTPException(status_code=400, detail="Missing: citation_id")

    citation_uuid = parse_uuid_or_raise(body["citation_id"])

    citation = db.query(Citation).filter(
        Citation.citation_id == citation_uuid,
        Citation.organization_id == org_id,
    ).first()
    if not citation:
        raise HTTPException(status_code=404, detail="Citation not found")

    existing = db.query(ObjectCitation).filter(
        ObjectCitation.object_id == object_id,
        ObjectCitation.citation_id == citation_uuid,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail="Citation already linked to this object")

    link = ObjectCitation(
        organization_id=org_id,
        object_id=object_id,
        citation_id=citation_uuid,
        page_reference=body.get("page_reference"),
        figure_reference=body.get("figure_reference"),
        plate_reference=body.get("plate_reference"),
        catalog_number=body.get("catalog_number"),
        works_cited=body.get("works_cited", True),
        works_illustrated=body.get("works_illustrated", False),
        is_primary=body.get("is_primary", False),
        display_order=body.get("display_order", 0),
        link_note=body.get("link_note"),
        created_by=auth.user_id,
    )

    db.add(link)
    db.commit()

    return _serialize_object_citation(link)


@router.put("/api/organizations/{org_id}/collections/objects/{object_id}/citations/{link_id}", response_model=ObjectCitationOut, summary="Update object citation link")
def update_object_citation_link(
    org_id: UUID,
    object_id: UUID,
    link_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.CITATIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update object citation link."""
    link = db.query(ObjectCitation).filter(
        ObjectCitation.link_id == link_id,
        ObjectCitation.organization_id == org_id,
        ObjectCitation.object_id == object_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Citation link not found")

    for field in ['page_reference', 'figure_reference', 'plate_reference', 'catalog_number',
                  'works_cited', 'works_illustrated', 'is_primary', 'display_order', 'link_note']:
        if field in body:
            setattr(link, field, body[field])

    db.commit()
    return _serialize_object_citation(link)


@router.delete("/api/organizations/{org_id}/collections/objects/{object_id}/citations/{link_id}", response_model=MessageResponse, summary="Unlink object citation")
def unlink_object_citation(
    org_id: UUID,
    object_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CITATIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Unlink object citation."""
    link = db.query(ObjectCitation).filter(
        ObjectCitation.link_id == link_id,
        ObjectCitation.organization_id == org_id,
        ObjectCitation.object_id == object_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Citation link not found")

    db.delete(link)
    db.commit()
    return {"message": "Citation unlinked successfully"}


# ============================================================================
# CRITICAL RESPONSES (CDWA Category 19) — 5 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/critical-responses", response_model=CriticalResponseListResponse, summary="List critical responses")
def list_critical_responses(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CRITICAL_RESPONSES_VIEW)),
    db: Session = Depends(get_db),
):
    """List critical responses."""
    responses = db.query(CriticalResponse).filter(
        CriticalResponse.object_id == object_id,
        CriticalResponse.organization_id == org_id,
    ).order_by(CriticalResponse.comment_date_earliest.desc().nullslast()).all()

    return {"critical_responses": [_serialize_critical_response(cr) for cr in responses]}


@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/critical-responses", status_code=201, response_model=CriticalResponseOut, summary="Create critical response")
def create_critical_response(
    org_id: UUID,
    object_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.CRITICAL_RESPONSES_CREATE)),
    db: Session = Depends(get_db),
):
    """Create critical response."""
    if not body.get("comment_text"):
        raise HTTPException(status_code=400, detail="Missing: comment_text")

    try:
        cr = CriticalResponse(
            organization_id=org_id,
            object_id=object_id,
            comment_text=body["comment_text"],
            comment_summary=body.get("comment_summary"),
            document_type=body.get("document_type", "essay"),
            author_name=body.get("author_name"),
            author_authority_id=UUID(body["author_authority_id"]) if body.get("author_authority_id") else None,
            comment_date_display=body.get("comment_date_display"),
            comment_date_earliest=body.get("comment_date_earliest"),
            comment_date_latest=body.get("comment_date_latest"),
            circumstances=body.get("circumstances"),
            publication_info=body.get("publication_info"),
            citation_id=UUID(body["citation_id"]) if body.get("citation_id") else None,
            source_page=body.get("source_page"),
            notes=body.get("notes"),
            created_by=auth.user_id,
            updated_by=auth.user_id,
        )

        db.add(cr)
        db.commit()

        return _serialize_critical_response(cr)

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Invalid reference")


@router.get("/api/organizations/{org_id}/collections/critical-responses/{response_id}", response_model=CriticalResponseOut, summary="Get critical response")
def get_critical_response(
    org_id: UUID,
    response_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CRITICAL_RESPONSES_VIEW)),
    db: Session = Depends(get_db),
):
    """Get critical response."""
    cr = db.query(CriticalResponse).filter(
        CriticalResponse.response_id == response_id,
        CriticalResponse.organization_id == org_id,
    ).first()
    if not cr:
        raise HTTPException(status_code=404, detail="Critical response not found")

    return _serialize_critical_response(cr)


@router.put("/api/organizations/{org_id}/collections/critical-responses/{response_id}", response_model=CriticalResponseOut, summary="Update critical response")
def update_critical_response(
    org_id: UUID,
    response_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.CRITICAL_RESPONSES_EDIT)),
    db: Session = Depends(get_db),
):
    """Update critical response."""
    cr = db.query(CriticalResponse).filter(
        CriticalResponse.response_id == response_id,
        CriticalResponse.organization_id == org_id,
    ).first()
    if not cr:
        raise HTTPException(status_code=404, detail="Critical response not found")

    protected = {'response_id', 'organization_id', 'object_id', 'created_at', 'created_by', 'updated_by'}
    for key, value in body.items():
        if key in protected:
            continue
        if hasattr(cr, key):
            if key in ('author_authority_id', 'citation_id') and value:
                value = UUID(value)
            setattr(cr, key, value)

    cr.updated_by = auth.user_id
    cr.updated_at = datetime.now(timezone.utc)

    db.commit()
    return _serialize_critical_response(cr)


@router.delete("/api/organizations/{org_id}/collections/critical-responses/{response_id}", response_model=MessageResponse, summary="Delete critical response")
def delete_critical_response(
    org_id: UUID,
    response_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CRITICAL_RESPONSES_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete critical response."""
    cr = db.query(CriticalResponse).filter(
        CriticalResponse.response_id == response_id,
        CriticalResponse.organization_id == org_id,
    ).first()
    if not cr:
        raise HTTPException(status_code=404, detail="Critical response not found")

    db.delete(cr)
    db.commit()
    return {"message": "Critical response deleted successfully"}


# ============================================================================
# CATALOGING HISTORY (CDWA Category 25) — 3 routes (append-only)
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/cataloging-history", response_model=CatalogingHistoryListResponse, summary="List cataloging history")
def list_cataloging_history(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CATALOGING_HISTORY_VIEW)),
    db: Session = Depends(get_db),
):
    """List cataloging history."""
    history = db.query(CatalogingHistory).filter(
        CatalogingHistory.object_id == object_id,
        CatalogingHistory.organization_id == org_id,
    ).order_by(CatalogingHistory.catalog_date.desc()).all()

    return {"cataloging_history": [_serialize_cataloging_history(ch) for ch in history]}


@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/cataloging-history", status_code=201, response_model=CatalogingHistoryOut, summary="Create cataloging history")
def create_cataloging_history(
    org_id: UUID,
    object_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.CATALOGING_HISTORY_CREATE)),
    db: Session = Depends(get_db),
):
    """Create cataloging history."""
    try:
        ch = CatalogingHistory(
            organization_id=org_id,
            object_id=object_id,
            cataloger_name=body.get("cataloger_name"),
            cataloger_id=auth.user_id,
            institution=body.get("institution"),
            catalog_language=body.get("catalog_language"),
            record_type=body.get("record_type", "update"),
            fields_modified=body.get("fields_modified"),
            change_summary=body.get("change_summary"),
            previous_values=body.get("previous_values"),
            notes=body.get("notes"),
        )

        db.add(ch)
        db.commit()

        return _serialize_cataloging_history(ch)

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Invalid reference")


@router.get("/api/organizations/{org_id}/collections/cataloging-history/{history_id}", response_model=CatalogingHistoryOut, summary="Get cataloging history")
def get_cataloging_history(
    org_id: UUID,
    history_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CATALOGING_HISTORY_VIEW)),
    db: Session = Depends(get_db),
):
    """Get cataloging history."""
    ch = db.query(CatalogingHistory).filter(
        CatalogingHistory.history_id == history_id,
        CatalogingHistory.organization_id == org_id,
    ).first()
    if not ch:
        raise HTTPException(status_code=404, detail="Cataloging history entry not found")

    return _serialize_cataloging_history(ch)


# ============================================================================
# OBJECT CONTEXTS (CDWA Category 17) — 4 routes
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/objects/{object_id}/contexts", response_model=ObjectContextListResponse, summary="List object contexts")
def list_object_contexts(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.OBJECT_CONTEXTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List object contexts."""
    contexts = db.query(ObjectContext).filter(
        ObjectContext.object_id == object_id,
        ObjectContext.organization_id == org_id,
    ).order_by(ObjectContext.display_order).all()

    return {"contexts": [_serialize_object_context(oc) for oc in contexts]}


@router.post("/api/organizations/{org_id}/collections/objects/{object_id}/contexts", status_code=201, response_model=ObjectContextOut, summary="Create object context")
def create_object_context(
    org_id: UUID,
    object_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.OBJECT_CONTEXTS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create object context."""
    if not body.get("context_type"):
        raise HTTPException(status_code=400, detail="Missing: context_type")

    try:
        oc = ObjectContext(
            organization_id=org_id,
            object_id=object_id,
            context_type=body["context_type"],
            building_name=body.get("building_name"),
            site_name=body.get("site_name"),
            part_placement=body.get("part_placement"),
            architectural_date_display=body.get("architectural_date_display"),
            architectural_date_earliest=body.get("architectural_date_earliest"),
            architectural_date_latest=body.get("architectural_date_latest"),
            historical_place_id=UUID(body["historical_place_id"]) if body.get("historical_place_id") else None,
            historical_date_display=body.get("historical_date_display"),
            historical_date_earliest=body.get("historical_date_earliest"),
            historical_date_latest=body.get("historical_date_latest"),
            event_id=UUID(body["event_id"]) if body.get("event_id") else None,
            event_description=body.get("event_description"),
            notes=body.get("notes"),
            display_order=body.get("display_order", 0),
            created_by=auth.user_id,
            updated_by=auth.user_id,
        )

        db.add(oc)
        db.commit()

        return _serialize_object_context(oc)

    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail="Invalid reference")


@router.put("/api/organizations/{org_id}/collections/contexts/{context_id}", response_model=ObjectContextOut, summary="Update object context")
def update_object_context(
    org_id: UUID,
    context_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.OBJECT_CONTEXTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update object context."""
    oc = db.query(ObjectContext).filter(
        ObjectContext.context_id == context_id,
        ObjectContext.organization_id == org_id,
    ).first()
    if not oc:
        raise HTTPException(status_code=404, detail="Object context not found")

    protected = {'context_id', 'organization_id', 'object_id', 'created_at', 'created_by', 'updated_by'}
    for key, value in body.items():
        if key in protected:
            continue
        if hasattr(oc, key):
            if key in ('historical_place_id', 'event_id') and value:
                value = UUID(value)
            setattr(oc, key, value)

    oc.updated_by = auth.user_id
    oc.updated_at = datetime.now(timezone.utc)

    db.commit()
    return _serialize_object_context(oc)


@router.delete("/api/organizations/{org_id}/collections/contexts/{context_id}", response_model=MessageResponse, summary="Delete object context")
def delete_object_context(
    org_id: UUID,
    context_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.OBJECT_CONTEXTS_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete object context."""
    oc = db.query(ObjectContext).filter(
        ObjectContext.context_id == context_id,
        ObjectContext.organization_id == org_id,
    ).first()
    if not oc:
        raise HTTPException(status_code=404, detail="Object context not found")

    db.delete(oc)
    db.commit()
    return {"message": "Object context deleted successfully"}
