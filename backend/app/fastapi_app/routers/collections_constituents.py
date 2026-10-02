"""
Constituents API (FastAPI) - Unified person/organization management.

Replaces person_authorities.py and procedure_contacts.py with a single
API following the TMS Constituents + ConXrefs pattern.
"""

import logging
from datetime import datetime
from uuid import UUID

import requests as http_requests

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import or_, func, select, text
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import Constituent, ConstituentXref, ConstituentRelation
from app.models.contacts import ConstituentMedia
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.constituent_service import (
    ConstituentService,
    fetch_ulan_search,
    fetch_ulan_full_record,
)
from app.services.constituent_role_service import (
    validate_role,
    get_role_label,
    get_valid_roles,
    ENTITY_TYPE_LABELS,
)
from app.fastapi_app.schemas.collections_constituents import (
    ConstituentListResponse,
    ConstituentOut,
    ConstituentSearchResponse,
    UlanSearchResponse,
    AuthoritySearchResponse,
    ConstituentEnumsResponse,
    UlanRecordOut,
    ImportUlanResponse,
    ConstituentUpdateResponse,
    ConstituentXrefOut,
    ObjectConstituentsResponse,
    GenericXrefListResponse,
    ConstituentRelationsResponse,
    ConstituentRelationOut,
    MergeConstituentsResponse,
    VerifyConstituentResponse,
    ConstituentRolesResponse,
)
from app.fastapi_app.schemas.common import SuccessResponse

def _constituent_media_url(media):
    """Rendition for images; the file itself for everything else."""
    from app.serializers.media import _display_key_for_image
    from app.services.uploads import get_org_media_url

    if getattr(media, "media_type", None) == "image":
        key = _display_key_for_image(media, None) or media.thumbnail_s3_key
        return get_org_media_url(key) if key else None
    return get_org_media_url(media.s3_key) if media.s3_key else None



logger = logging.getLogger(__name__)


def _org_scoped_constituent_media(
    db: Session, org_id: UUID, constituent_id: UUID, media_id: UUID
) -> "ConstituentMedia":
    """Load a constituent↔media link, proving the CONSTITUENT belongs to `org_id`.

    `constituent_media` has no organization_id of its own, so filtering on
    (constituent_id, media_id) alone reaches another institution's row.
    add_constituent_media already loads the parent with organization_id==org_id;
    the delete and set-primary paths did not. Backed by the
    constituent_media_via_parent RLS policy; this is the app-layer half.
    """
    link = (
        db.query(ConstituentMedia)
        .join(Constituent, Constituent.constituent_id == ConstituentMedia.constituent_id)
        .filter(
            ConstituentMedia.constituent_id == constituent_id,
            ConstituentMedia.media_id == media_id,
            Constituent.organization_id == org_id,
        )
        .first()
    )
    if not link:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Media link not found"})
    return link



def _constituent_reference_blockers(db: Session, constituent_id: UUID) -> list[str]:
    """Every table still pointing at this constituent, as "table.column".

    Derived from the mapper metadata rather than a hand-maintained list, so a
    new foreign key is covered the day it is added.

    This exists because the delete guard used to count ConstituentXref rows
    and nothing else, while 37 other foreign keys reference constituents with
    ON DELETE SET NULL. Deleting therefore silently erased — with no audit
    trail, since the nulling happens in Postgres rather than through the ORM —
    the acquisition source, the lender, the deaccession recipient, the
    condition-report examiner, the valuator, the movement handler and
    authorizer, and, with no name-fallback column of any kind, the NAGPRA
    repatriation recipient and cultural-affiliation determination.
    """
    from app.models import Base

    target = {"collections.constituents.constituent_id", "constituents.constituent_id"}
    blockers: list[str] = []
    for table in Base.metadata.sorted_tables:
        for col in table.columns:
            for fk in col.foreign_keys:
                if fk.target_fullname not in target:
                    continue
                exists = db.execute(
                    text(
                        f'SELECT 1 FROM {table.fullname} '  # noqa: S608 - identifiers from metadata
                        f'WHERE "{col.name}" = :cid LIMIT 1'
                    ),
                    {"cid": constituent_id},
                ).first()
                if exists:
                    blockers.append(f"{table.fullname}.{col.name}")
    return blockers


router = APIRouter(tags=["collections-constituents"])


# =============================================================================
# HELPERS
# =============================================================================


def _normalize_variant_names(variant_names):
    """Convert variant_names to simple string array for API responses."""
    if not variant_names:
        return None
    result = []
    for item in variant_names:
        if isinstance(item, dict):
            result.append(item.get("name", ""))
        elif isinstance(item, str):
            result.append(item)
    return result if result else None


def _normalize_life_roles(life_roles):
    """Convert life_roles to simple string array for API responses."""
    if not life_roles:
        return None
    result = []
    for item in life_roles:
        if isinstance(item, dict):
            result.append(item.get("role", ""))
        elif isinstance(item, str):
            result.append(item)
    return result if result else None


def _normalize_external_uris(external_uris):
    """Convert external_uris to simple string array for API responses."""
    if not external_uris:
        return None
    result = []
    for item in external_uris:
        if isinstance(item, dict):
            result.append(item.get("uri", ""))
        elif isinstance(item, str):
            result.append(item)
    return result if result else None


# =============================================================================
# SERIALIZERS
# =============================================================================


def _serialize_constituent(c: Constituent) -> dict:
    """Full serialization of a Constituent for detail views."""
    return {
        "constituent_id": str(c.constituent_id),
        "organization_id": str(c.organization_id),
        "constituent_type": c.constituent_type,

        # Operational fields
        "name": c.name,
        "first_name": c.first_name,
        "last_name": c.last_name,
        "title": c.title,
        "role": c.role,
        "organization_name": c.organization_name,
        "department": c.department,
        "email": c.email,
        "phone": c.phone,
        "phone_secondary": c.phone_secondary,
        "website": c.website,
        "address": c.address,
        "contact_categories": c.contact_categories,

        # CDWA Identity (28.1)
        "sort_name": c.sort_name,
        "display_name": c.display_name,
        "given_name": c.given_name,
        "family_name": c.family_name,
        "name_prefix": c.name_prefix,
        "name_suffix": c.name_suffix,
        "name_type": c.name_type,
        "variant_names": _normalize_variant_names([vt.term for vt in c.variant_names_list]) if c.variant_names_list else None,
        "nationality": c.nationality,
        "nationalities": c.nationalities,
        "culture": c.culture,
        "life_roles": _normalize_life_roles(c.life_roles),
        "gender": c.gender,

        # CDWA Existence (28.2)
        "birth_date_display": c.birth_date_display,
        "birth_date_earliest": c.birth_date_earliest.isoformat() if c.birth_date_earliest else None,
        "birth_date_latest": c.birth_date_latest.isoformat() if c.birth_date_latest else None,
        "birth_place": c.birth_place,
        "birth_place_tgn_id": c.birth_place_tgn_id,
        "death_date_display": c.death_date_display,
        "death_date_earliest": c.death_date_earliest.isoformat() if c.death_date_earliest else None,
        "death_date_latest": c.death_date_latest.isoformat() if c.death_date_latest else None,
        "death_place": c.death_place,
        "death_place_tgn_id": c.death_place_tgn_id,
        "active_date_display": c.active_date_display,
        "active_date_earliest": c.active_date_earliest.isoformat() if c.active_date_earliest else None,
        "active_date_latest": c.active_date_latest.isoformat() if c.active_date_latest else None,

        # CDWA Biography (28.4)
        "biography": c.biography,
        "biography_source": c.biography_source,

        # External authorities (28.5)
        "ulan_id": c.ulan_id,
        "viaf_id": c.viaf_id,
        "wikidata_id": c.wikidata_id,
        "loc_id": c.loc_id,
        "external_uris": _normalize_external_uris(c.external_uris),

        # Status
        "is_active": c.is_active,
        "status": c.status,
        "is_verified": c.is_verified,
        "verified_at": c.verified_at.isoformat() if c.verified_at else None,

        # Notes
        "notes": c.notes,
        "internal_notes": c.internal_notes,
        "cataloger_notes": c.cataloger_notes,

        # Audit
        "created_at": c.created_at.isoformat() if c.created_at else None,
        "updated_at": c.updated_at.isoformat() if c.updated_at else None,
    }


def _serialize_constituent_brief(c: Constituent) -> dict:
    """Brief serialization of a Constituent for list views."""
    dates = None
    if c.birth_date_display or c.death_date_display:
        dates = f"{c.birth_date_display or '?'}-{c.death_date_display or ''}"

    return {
        "constituent_id": str(c.constituent_id),
        "constituent_type": c.constituent_type,
        "name": c.name,
        "display_name": c.display_name,
        "sort_name": c.sort_name,
        "dates": dates,
        "nationality": c.nationality,
        "email": c.email,
        "phone": c.phone,
        "organization_name": c.organization_name,
        "ulan_id": c.ulan_id,
        "is_verified": c.is_verified,
        "status": c.status,
    }


def _serialize_xref(x: ConstituentXref) -> dict:
    """Serialize a ConstituentXref to dict, including constituent data if loaded."""
    result = {
        "xref_id": str(x.xref_id),
        "organization_id": str(x.organization_id),
        "constituent_id": str(x.constituent_id),
        "entity_type": x.entity_type,
        "entity_id": str(x.entity_id),
        "role": x.role,
        "role_qualifier": x.role_qualifier,
        "attribution_certainty": x.attribution_certainty,
        "attribution_note": x.attribution_note,
        "display_order": x.display_order,
        "display_name_override": x.display_name_override,
        "is_primary": x.is_primary,
        "start_date": x.start_date,
        "end_date": x.end_date,
        "location": x.location,
        "notes": x.notes,
        "created_at": x.created_at.isoformat() if x.created_at else None,
        "updated_at": x.updated_at.isoformat() if x.updated_at else None,
    }

    if x.constituent:
        result["constituent"] = {
            "constituent_id": str(x.constituent.constituent_id),
            "constituent_type": x.constituent.constituent_type,
            "name": x.constituent.name,
            "display_name": x.constituent.display_name,
            "email": x.constituent.email,
            "phone": x.constituent.phone,
            "organization_name": x.constituent.organization_name,
        }

    return result


def _serialize_relation(r: ConstituentRelation) -> dict:
    """Serialize a ConstituentRelation to dict."""
    result = {
        "relation_id": str(r.relation_id),
        "organization_id": str(r.organization_id),
        "from_constituent_id": str(r.from_constituent_id),
        "to_constituent_id": str(r.to_constituent_id),
        "relationship_type": r.relationship_type,
        "relationship_note": r.relationship_note,
        "start_date": r.start_date,
        "end_date": r.end_date,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }

    if r.from_constituent:
        result["from_constituent"] = {
            "constituent_id": str(r.from_constituent.constituent_id),
            "name": r.from_constituent.name,
            "constituent_type": r.from_constituent.constituent_type,
        }

    if r.to_constituent:
        result["to_constituent"] = {
            "constituent_id": str(r.to_constituent.constituent_id),
            "name": r.to_constituent.name,
            "constituent_type": r.to_constituent.constituent_type,
        }

    return result


# =============================================================================
# CRUD ENDPOINTS
# =============================================================================


@router.get("/api/organizations/{organization_id}/collections/constituents", response_model=ConstituentListResponse, summary="List constituents")
def list_constituents(
    organization_id: UUID,
    type: str | None = Query(None, alias="type"),
    constituent_type: str | None = Query(None),
    status: str | None = Query(None),
    q: str = Query(""),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    List constituents for the organization with optional filters.
    """
    effective_type = type or constituent_type

    query = (
        select(Constituent)
        .where(Constituent.organization_id == organization_id)
    )

    if effective_type:
        query = query.where(Constituent.constituent_type == effective_type)

    if status:
        query = query.where(Constituent.status == status)

    search_q = q.strip()
    if search_q:
        pattern = f"%{escape_ilike(search_q)}%"
        query = query.where(
            or_(
                Constituent.name.ilike(pattern, escape="\\"),
                Constituent.display_name.ilike(pattern, escape="\\"),
                Constituent.sort_name.ilike(pattern, escape="\\"),
                Constituent.email.ilike(pattern, escape="\\"),
            )
        )

    # Get total count before pagination
    count_query = select(func.count()).select_from(query.subquery())
    total = db.execute(count_query).scalar()

    # Apply ordering and pagination
    query = query.order_by(Constituent.name).offset(offset).limit(limit)
    constituents = db.execute(query).scalars().all()

    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [_serialize_constituent_brief(c) for c in constituents],
    }


@router.post("/api/organizations/{organization_id}/collections/constituents", status_code=201, response_model=ConstituentOut, summary="Create constituent")
def create_constituent(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Create a new constituent.
    """
    name = data.get("name")
    constituent_type = data.get("constituent_type")

    if not name or not constituent_type:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_REQUIRED_FIELDS",
            "message": "name and constituent_type are required",
        })

    valid_types = [
        "person", "organization", "corporate_body", "family",
        "department", "estate", "dealer", "auction_house", "unknown",
    ]
    if constituent_type not in valid_types:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_TYPE",
            "message": f"constituent_type must be one of: {', '.join(valid_types)}",
        })

    # Create via the shared service — the same code the draft applier runs (it
    # owns the variant-name child aggregate). This router is the thin adapter:
    # validate, create, commit, serialize.
    from app.services.collections.creation.constituent import (
        create_constituent as _create_constituent,
    )

    constituent = _create_constituent(db, organization_id, data, auth.user_id, open_approval=True)
    db.commit()

    return _serialize_constituent(constituent)


@router.get("/api/organizations/{organization_id}/collections/constituents/search", response_model=ConstituentSearchResponse, summary="Search constituents")
def search_constituents(
    organization_id: UUID,
    q: str = Query(""),
    include_ulan: str = Query("true"),
    limit: int = Query(10, le=50),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Combined search across local constituents and ULAN.
    """
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail={
            "code": "QUERY_TOO_SHORT",
            "message": "Query must be at least 2 characters",
        })

    ulan_flag = include_ulan.lower() == "true"

    service = ConstituentService(db, organization_id)
    results = service.search(query, include_ulan=ulan_flag, limit=limit)

    return {
        "query": query,
        "results": [
            {
                "id": r.id,
                "source": r.source,
                "label": r.label,
                "description": r.description,
                "dates": r.dates,
                "nationality": r.nationality,
                "roles": r.roles,
                "ulan_id": r.ulan_id,
                "constituent_id": str(r.constituent_id) if r.constituent_id else None,
                "uri": r.uri,
            }
            for r in results
        ],
    }


@router.get("/api/organizations/{organization_id}/collections/constituents/ulan-search", response_model=UlanSearchResponse, summary="Search ulan only")
def search_ulan_only(
    organization_id: UUID,
    q: str = Query(""),
    limit: int = Query(10, le=50),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Search ULAN only (not local records).
    """
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail={
            "code": "QUERY_TOO_SHORT",
            "message": "Query must be at least 2 characters",
        })

    results = fetch_ulan_search(query, limit)

    return {
        "query": query,
        "results": [
            {
                "id": r.id,
                "source": r.source,
                "label": r.label,
                "description": r.description,
                "dates": r.dates,
                "nationality": r.nationality,
                "ulan_id": r.ulan_id,
                "uri": r.uri,
            }
            for r in results
        ],
    }


AUTHORITY_TIMEOUT = 5.0


@router.get("/api/organizations/{organization_id}/collections/constituents/viaf-search", response_model=AuthoritySearchResponse, summary="Search viaf")
def search_viaf(
    organization_id: UUID,
    q: str = Query(""),
    limit: int = Query(10, le=50),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Search VIAF (Virtual International Authority File)."""
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail={
            "code": "QUERY_TOO_SHORT",
            "message": "Query must be at least 2 characters",
        })

    try:
        response = http_requests.get(
            "https://viaf.org/viaf/AutoSuggest",
            params={"query": query},
            headers={"Accept": "application/json", "User-Agent": "Madrona/1.0 (collections management)"},
            timeout=AUTHORITY_TIMEOUT,
        )
        if response.status_code != 200:
            return {"query": query, "results": []}

        data = response.json()
        results = []
        for item in (data.get("result") or [])[:limit]:
            viaf_id = item.get("viafid", "")
            label = item.get("displayForm", "")
            if viaf_id and label:
                results.append({
                    "id": f"viaf-{viaf_id}",
                    "label": label,
                    "description": item.get("nametype", ""),
                    "authority_id": viaf_id,
                    "uri": f"https://viaf.org/viaf/{viaf_id}",
                })
        return {"query": query, "results": results}
    except Exception as e:
        logger.warning(f"VIAF search failed: {e}")
        return {"query": query, "results": []}


@router.get("/api/organizations/{organization_id}/collections/constituents/wikidata-search", response_model=AuthoritySearchResponse, summary="Search wikidata constituents")
def search_wikidata_constituents(
    organization_id: UUID,
    q: str = Query(""),
    limit: int = Query(10, le=50),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Search Wikidata for person/organization entities."""
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail={
            "code": "QUERY_TOO_SHORT",
            "message": "Query must be at least 2 characters",
        })

    try:
        response = http_requests.get(
            "https://www.wikidata.org/w/api.php",
            params={
                "action": "wbsearchentities",
                "search": query,
                "language": "en",
                "format": "json",
                "limit": limit,
                "type": "item",
            },
            headers={"User-Agent": "Madrona/1.0 (collections management; https://madrona.io)"},
            timeout=AUTHORITY_TIMEOUT,
        )
        if response.status_code != 200:
            return {"query": query, "results": []}

        data = response.json()
        results = []
        for item in data.get("search", []):
            qid = item.get("id", "")
            label = item.get("label", "")
            if qid and label:
                results.append({
                    "id": f"wd-{qid}",
                    "label": label,
                    "description": item.get("description", ""),
                    "authority_id": qid,
                    "uri": f"https://www.wikidata.org/wiki/{qid}",
                })
        return {"query": query, "results": results}
    except Exception as e:
        logger.warning(f"Wikidata search failed: {e}")
        return {"query": query, "results": []}


@router.get("/api/organizations/{organization_id}/collections/constituents/loc-search", response_model=AuthoritySearchResponse, summary="Search loc")
def search_loc(
    organization_id: UUID,
    q: str = Query(""),
    limit: int = Query(10, le=50),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Search Library of Congress Name Authority File."""
    query = q.strip()
    if len(query) < 2:
        raise HTTPException(status_code=400, detail={
            "code": "QUERY_TOO_SHORT",
            "message": "Query must be at least 2 characters",
        })

    try:
        response = http_requests.get(
            "https://id.loc.gov/authorities/names/suggest2",
            params={"q": query},
            timeout=AUTHORITY_TIMEOUT,
        )
        if response.status_code != 200:
            return {"query": query, "results": []}

        data = response.json()
        results = []
        for hit in (data.get("hits") or [])[:limit]:
            uri = hit.get("uri", "")
            label = hit.get("aLabel", "")
            # Extract the ID from the URI (last segment)
            loc_id = uri.rsplit("/", 1)[-1] if uri else ""
            if loc_id and label:
                results.append({
                    "id": f"loc-{loc_id}",
                    "label": label,
                    "description": hit.get("vLabel", ""),
                    "authority_id": loc_id,
                    "uri": uri,
                })
        return {"query": query, "results": results}
    except Exception as e:
        logger.warning(f"LoC search failed: {e}")
        return {"query": query, "results": []}


@router.get("/api/organizations/{organization_id}/collections/constituents/enums", response_model=ConstituentEnumsResponse, summary="Get constituent enums")
def get_constituent_enums(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Return valid enumeration values for constituent fields.
    """
    return {
        "constituent_types": [
            "person", "organization", "corporate_body", "family",
            "department", "estate", "dealer", "auction_house", "unknown",
        ],
        "statuses": [
            "active", "deprecated", "merged", "deleted",
        ],
        "entity_types": [
            "collection_object", "acquisition", "valuation", "movement",
            "loan_in", "loan_out", "shipment", "object_entry", "object_exit",
            "conservation_treatment", "condition_report", "deaccession",
            "exhibition", "exhibition_loan", "event", "right",
            "reproduction_request", "use_request",
        ],
        "roles_by_entity_type": {
            "collection_object": [
                "creator", "maker", "artist", "author", "architect",
                "designer", "engraver", "photographer", "publisher",
                "printer", "patron", "commissioner", "donor", "collector",
                "previous_owner", "sitter", "subject",
                "attributed_to", "workshop_of", "circle_of",
                "school_of", "follower_of", "manner_of", "after",
            ],
            "acquisition": [
                "seller", "donor", "agent", "appraiser",
                "executor", "heir", "intermediary",
            ],
            "valuation": [
                "valuator", "appraiser", "reviewer",
            ],
            "movement": [
                "handler", "courier", "shipper", "receiver",
                "authorizer", "packer",
            ],
            "loan_in": [
                "lender", "lender_contact", "courier",
                "registrar", "approver",
            ],
            "loan_out": [
                "borrower", "borrower_contact", "courier",
                "registrar", "approver",
            ],
            "shipment": [
                "shipper", "carrier", "courier", "receiver",
                "customs_broker", "insurer",
            ],
            "conservation_treatment": [
                "conservator", "examiner", "supervisor", "consultant",
            ],
            "condition_report": [
                "examiner", "reviewer",
            ],
            "exhibition": [
                "curator", "designer", "organizer", "sponsor",
                "lender", "collaborator",
            ],
            "event": [
                "organizer", "participant", "speaker", "sponsor",
            ],
        },
        "relationship_types": [
            "teacher_of", "student_of", "master_of", "apprentice_of",
            "parent_of", "child_of", "spouse_of", "sibling_of",
            "collaborator_with", "influenced", "influenced_by",
            "employed", "employed_by", "member_of", "other",
        ],
        "attribution_certainty": [
            "certain", "probable", "possible", "doubtful",
        ],
    }


@router.get("/api/organizations/{organization_id}/collections/constituents/ulan/{ulan_id}", response_model=UlanRecordOut, summary="Get ulan record")
def get_ulan_record(
    organization_id: UUID,
    ulan_id: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Fetch full ULAN record details.
    Use this to preview before importing.
    """
    record = fetch_ulan_full_record(ulan_id)
    if not record:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"ULAN record {ulan_id} not found",
        })

    return {
        "ulan_id": record.ulan_id,
        "uri": record.uri,
        "preferred_name": record.preferred_name,
        "display_name": record.display_name,
        "sort_name": record.sort_name,
        "given_name": record.given_name,
        "family_name": record.family_name,
        "variant_names": record.variant_names,
        "birth_date_display": record.birth_date_display,
        "birth_place": record.birth_place,
        "death_date_display": record.death_date_display,
        "death_place": record.death_place,
        "nationality": record.nationality,
        "nationalities": record.nationalities,
        "gender": record.gender,
        "life_roles": record.life_roles,
        "biography": record.biography,
    }


@router.post("/api/organizations/{organization_id}/collections/constituents/import-ulan", status_code=201, response_model=ImportUlanResponse, summary="Import ulan record")
def import_ulan_record(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Import a ULAN record into the local database as a Constituent.
    """
    ulan_id = data.get("ulan_id")

    if not ulan_id:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_ULAN_ID",
            "message": "ulan_id is required",
        })

    service = ConstituentService(db, organization_id)
    constituent = service.import_from_ulan(ulan_id, created_by=auth.user_id)

    if not constituent:
        raise HTTPException(status_code=400, detail={
            "code": "IMPORT_FAILED",
            "message": f"Could not import ULAN record {ulan_id}",
        })

    db.commit()

    return {
        "constituent_id": str(constituent.constituent_id),
        "name": constituent.name,
        "display_name": constituent.display_name,
        "ulan_id": constituent.ulan_id,
        "is_new": True,
    }


@router.get("/api/organizations/{organization_id}/collections/constituents/{constituent_id}", response_model=ConstituentOut, summary="Get constituent")
def get_constituent(
    organization_id: UUID,
    constituent_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single constituent with full details including linked records count."""
    constituent = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == constituent_id,
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not constituent:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Person or organization not found",
        })

    # Get count of cross-references
    linked_records_count = db.execute(
        select(func.count())
        .select_from(ConstituentXref)
        .where(ConstituentXref.constituent_id == constituent.constituent_id)
    ).scalar()

    result = _serialize_constituent(constituent)
    result["linked_records_count"] = linked_records_count

    return result


@router.put("/api/organizations/{organization_id}/collections/constituents/{constituent_id}", response_model=ConstituentUpdateResponse, summary="Update constituent")
def update_constituent(
    organization_id: UUID,
    constituent_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Update a constituent.
    """
    constituent = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == constituent_id,
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not constituent:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Person or organization not found",
        })

    updateable_fields = [
        "name", "first_name", "last_name", "title", "role",
        "organization_name", "department", "email", "phone",
        "phone_secondary", "website", "address", "contact_categories",
        "sort_name", "display_name", "given_name", "family_name",
        "name_prefix", "name_suffix", "name_type",
        "nationality", "nationalities", "culture", "life_roles", "gender",
        "birth_date_display", "birth_date_earliest", "birth_date_latest",
        "birth_place", "birth_place_tgn_id",
        "death_date_display", "death_date_earliest", "death_date_latest",
        "death_place", "death_place_tgn_id",
        "active_date_display", "active_date_earliest", "active_date_latest",
        "biography", "biography_source",
        "ulan_id", "viaf_id", "wikidata_id", "loc_id", "external_uris",
        "is_active", "status",
        "notes", "internal_notes", "cataloger_notes",
        "constituent_type",
    ]

    from app.services.coerce import coerce_value_for_column
    for field in updateable_fields:
        if field in data:
            setattr(constituent, field, coerce_value_for_column(Constituent, field, data[field]))

    constituent.updated_by = auth.user_id
    db.commit()

    return {
        "success": True,
        "constituent_id": str(constituent.constituent_id),
    }


@router.patch("/api/organizations/{organization_id}/collections/constituents/{constituent_id}", response_model=ConstituentUpdateResponse, summary="Patch constituent")
def patch_constituent(
    organization_id: UUID,
    constituent_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Partial update a constituent (same logic as PUT).
    """
    return update_constituent(organization_id, constituent_id, data, auth, db)


@router.delete("/api/organizations/{organization_id}/collections/constituents/{constituent_id}", response_model=SuccessResponse, summary="Delete constituent")
def delete_constituent(
    organization_id: UUID,
    constituent_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Delete a constituent.
    Fails if the constituent has any cross-references (xrefs) linking it to other entities.
    """
    constituent = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == constituent_id,
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not constituent:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Person or organization not found",
        })

    # Check for linked records — ALL of them, not just cross-references.
    blockers = _constituent_reference_blockers(db, constituent.constituent_id)
    if blockers:
        raise HTTPException(status_code=400, detail={
            "code": "HAS_LINKS",
            "message": (
                "Cannot delete: this record is still referenced by "
                f"{len(blockers)} table(s). Remove those references first."
            ),
            "references": sorted(blockers),
        })

    db.delete(constituent)
    db.commit()

    return {"success": True}


# =============================================================================
# CONXREF MANAGEMENT - OBJECT CONTEXT
# =============================================================================


@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}/constituents", response_model=ObjectConstituentsResponse, summary="List object constituents")
def list_object_constituents(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    List all constituent cross-references for a collection object.
    """
    query = (
        select(ConstituentXref)
        .options(joinedload(ConstituentXref.constituent))
        .where(
            ConstituentXref.organization_id == organization_id,
            ConstituentXref.entity_type == "collection_object",
            ConstituentXref.entity_id == object_id,
        )
        .order_by(ConstituentXref.display_order, ConstituentXref.role)
    )

    xrefs = db.execute(query).scalars().all()

    return {
        "object_id": str(object_id),
        "constituents": [_serialize_xref(x) for x in xrefs],
    }


@router.post("/api/organizations/{organization_id}/collections/objects/{object_id}/constituents", status_code=201, response_model=ConstituentXrefOut, summary="Add object constituent")
def add_object_constituent(
    organization_id: UUID,
    object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Add a constituent cross-reference to a collection object.
    """
    constituent_id = data.get("constituent_id")
    role = data.get("role")

    if not role:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_REQUIRED_FIELDS",
            "message": "Role is required",
        })
    if not validate_role(organization_id, "collection_object", role, db=db):
        valid = get_valid_roles(organization_id, "collection_object", db=db)
        valid_keys = [r["value"] for r in valid]
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_ROLE",
            "message": f"Role '{role}' is not valid for collection objects. Valid roles: {', '.join(valid_keys)}",
        })
    if not constituent_id:
        role_label = get_role_label(organization_id, "collection_object", role, db=db)
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_REQUIRED_FIELDS",
            "message": f"{role_label} is required",
        })

    # Verify constituent exists and belongs to org
    constituent = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == UUID(constituent_id),
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not constituent:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Person or organization not found",
        })

    # Check for duplicate
    existing = db.execute(
        select(ConstituentXref.xref_id).where(
            ConstituentXref.organization_id == organization_id,
            ConstituentXref.constituent_id == UUID(constituent_id),
            ConstituentXref.entity_type == "collection_object",
            ConstituentXref.entity_id == object_id,
            ConstituentXref.role == role,
        )
    ).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "DUPLICATE",
            "message": f"This person is already linked with the role '{role}'",
        })

    xref = ConstituentXref(
        organization_id=organization_id,
        constituent_id=UUID(constituent_id),
        entity_type="collection_object",
        entity_id=object_id,
        role=role,
        role_qualifier=data.get("role_qualifier"),
        attribution_certainty=data.get("attribution_certainty"),
        attribution_note=data.get("attribution_note"),
        display_order=data.get("display_order", 0),
        display_name_override=data.get("display_name_override"),
        is_primary=data.get("is_primary", True),
        start_date=data.get("start_date"),
        end_date=data.get("end_date"),
        location=data.get("location"),
        notes=data.get("notes"),
        created_by=auth.user_id,
    )

    db.add(xref)
    db.commit()

    # Reload with constituent relationship
    xref = db.execute(
        select(ConstituentXref)
        .options(joinedload(ConstituentXref.constituent))
        .where(ConstituentXref.xref_id == xref.xref_id)
    ).scalar_one()

    return _serialize_xref(xref)


@router.put("/api/organizations/{organization_id}/collections/objects/{object_id}/constituents/{xref_id}", response_model=ConstituentXrefOut, summary="Update object constituent")
def update_object_constituent(
    organization_id: UUID,
    object_id: UUID,
    xref_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Update a constituent cross-reference on a collection object.
    """
    xref = db.execute(
        select(ConstituentXref)
        .where(
            ConstituentXref.xref_id == xref_id,
            ConstituentXref.organization_id == organization_id,
            ConstituentXref.entity_type == "collection_object",
            ConstituentXref.entity_id == object_id,
        )
    ).scalar_one_or_none()

    if not xref:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Link not found",
        })

    updateable_fields = [
        "role", "role_qualifier", "attribution_certainty", "attribution_note",
        "display_order", "display_name_override", "is_primary",
        "start_date", "end_date", "location", "notes",
    ]

    for field in updateable_fields:
        if field in data:
            setattr(xref, field, data[field])

    db.commit()

    # Reload with constituent relationship
    xref = db.execute(
        select(ConstituentXref)
        .options(joinedload(ConstituentXref.constituent))
        .where(ConstituentXref.xref_id == xref.xref_id)
    ).scalar_one()

    return _serialize_xref(xref)


@router.delete("/api/organizations/{organization_id}/collections/objects/{object_id}/constituents/{xref_id}", response_model=SuccessResponse, summary="Remove object constituent")
def remove_object_constituent(
    organization_id: UUID,
    object_id: UUID,
    xref_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Remove a constituent cross-reference from a collection object.
    """
    xref = db.execute(
        select(ConstituentXref)
        .where(
            ConstituentXref.xref_id == xref_id,
            ConstituentXref.organization_id == organization_id,
            ConstituentXref.entity_type == "collection_object",
            ConstituentXref.entity_id == object_id,
        )
    ).scalar_one_or_none()

    if not xref:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Link not found",
        })

    db.delete(xref)
    db.commit()

    return {"success": True}


# =============================================================================
# CONXREF MANAGEMENT - GENERIC (any entity type)
# =============================================================================


@router.get("/api/organizations/{organization_id}/collections/constituent-xrefs", response_model=GenericXrefListResponse, summary="List constituent xrefs")
def list_constituent_xrefs(
    organization_id: UUID,
    entity_type: str | None = Query(None),
    entity_id: str | None = Query(None),
    role: str | None = Query(None),
    constituent_id: str | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    List constituent cross-references with filters.
    """
    if not entity_type or not entity_id:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_PARAMS",
            "message": "entity_type and entity_id query params are required",
        })

    query = (
        select(ConstituentXref)
        .options(joinedload(ConstituentXref.constituent))
        .where(
            ConstituentXref.organization_id == organization_id,
            ConstituentXref.entity_type == entity_type,
            ConstituentXref.entity_id == UUID(entity_id),
        )
    )

    if role:
        query = query.where(ConstituentXref.role == role)

    if constituent_id:
        query = query.where(ConstituentXref.constituent_id == UUID(constituent_id))

    query = query.order_by(ConstituentXref.display_order, ConstituentXref.role)

    xrefs = db.execute(query).scalars().all()

    return {
        "entity_type": entity_type,
        "entity_id": entity_id,
        "xrefs": [_serialize_xref(x) for x in xrefs],
    }


@router.post("/api/organizations/{organization_id}/collections/constituent-xrefs", status_code=201, response_model=ConstituentXrefOut, summary="Create constituent xref")
def create_constituent_xref(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Create a generic constituent cross-reference.
    """
    constituent_id = data.get("constituent_id")
    entity_type = data.get("entity_type")
    entity_id = data.get("entity_id")
    role = data.get("role")

    missing = []
    if not constituent_id:
        missing.append("Constituent")
    if not entity_type:
        missing.append("Entity type")
    if not entity_id:
        missing.append("Entity")
    if not role:
        missing.append("Role")
    if missing:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_REQUIRED_FIELDS",
            "message": f"{', '.join(missing)} {'is' if len(missing) == 1 else 'are'} required",
        })

    if not validate_role(organization_id, entity_type, role, db=db):
        entity_label = ENTITY_TYPE_LABELS.get(entity_type, entity_type)
        valid = get_valid_roles(organization_id, entity_type, db=db)
        valid_keys = [r["value"] for r in valid]
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_ROLE",
            "message": f"Role '{role}' is not valid for {entity_label}. Valid roles: {', '.join(valid_keys)}",
        })

    # Verify constituent exists and belongs to org
    constituent = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == UUID(constituent_id),
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not constituent:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Person or organization not found",
        })

    xref = ConstituentXref(
        organization_id=organization_id,
        constituent_id=UUID(constituent_id),
        entity_type=entity_type,
        entity_id=UUID(entity_id),
        role=role,
        role_qualifier=data.get("role_qualifier"),
        attribution_certainty=data.get("attribution_certainty"),
        attribution_note=data.get("attribution_note"),
        display_order=data.get("display_order", 0),
        display_name_override=data.get("display_name_override"),
        is_primary=data.get("is_primary", True),
        start_date=data.get("start_date"),
        end_date=data.get("end_date"),
        location=data.get("location"),
        notes=data.get("notes"),
        created_by=auth.user_id,
    )

    db.add(xref)
    db.commit()

    # Reload with constituent relationship
    xref = db.execute(
        select(ConstituentXref)
        .options(joinedload(ConstituentXref.constituent))
        .where(ConstituentXref.xref_id == xref.xref_id)
    ).scalar_one()

    return _serialize_xref(xref)


@router.patch("/api/organizations/{organization_id}/collections/constituent-xrefs/{xref_id}", response_model=ConstituentXrefOut, summary="Update constituent xref")
def update_constituent_xref(
    organization_id: UUID,
    xref_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Update a constituent cross-reference.
    """
    xref = db.execute(
        select(ConstituentXref)
        .where(
            ConstituentXref.xref_id == xref_id,
            ConstituentXref.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not xref:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Link not found",
        })

    updateable_fields = [
        "role", "role_qualifier", "attribution_certainty", "attribution_note",
        "display_order", "display_name_override", "is_primary",
        "start_date", "end_date", "location", "notes",
    ]

    for field in updateable_fields:
        if field in data:
            setattr(xref, field, data[field])

    db.commit()

    # Reload with constituent relationship
    xref = db.execute(
        select(ConstituentXref)
        .options(joinedload(ConstituentXref.constituent))
        .where(ConstituentXref.xref_id == xref.xref_id)
    ).scalar_one()

    return _serialize_xref(xref)


@router.delete("/api/organizations/{organization_id}/collections/constituent-xrefs/{xref_id}", response_model=SuccessResponse, summary="Delete constituent xref")
def delete_constituent_xref(
    organization_id: UUID,
    xref_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Delete a constituent cross-reference.
    """
    xref = db.execute(
        select(ConstituentXref)
        .where(
            ConstituentXref.xref_id == xref_id,
            ConstituentXref.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not xref:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Link not found",
        })

    db.delete(xref)
    db.commit()

    return {"success": True}


# =============================================================================
# RELATIONS
# =============================================================================


@router.get("/api/organizations/{organization_id}/collections/constituents/{constituent_id}/relations", response_model=ConstituentRelationsResponse, summary="List constituent relations")
def list_constituent_relations(
    organization_id: UUID,
    constituent_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    List all relations for a constituent (both directions).
    """
    # Verify constituent exists
    constituent = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == constituent_id,
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not constituent:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Person or organization not found",
        })

    # Get relations in both directions
    query = (
        select(ConstituentRelation)
        .options(
            joinedload(ConstituentRelation.from_constituent),
            joinedload(ConstituentRelation.to_constituent),
        )
        .where(
            ConstituentRelation.organization_id == organization_id,
            or_(
                ConstituentRelation.from_constituent_id == constituent_id,
                ConstituentRelation.to_constituent_id == constituent_id,
            ),
        )
        .order_by(ConstituentRelation.relationship_type)
    )

    relations = db.execute(query).scalars().all()

    return {
        "constituent_id": str(constituent_id),
        "relations": [_serialize_relation(r) for r in relations],
    }


@router.post("/api/organizations/{organization_id}/collections/constituents/{constituent_id}/relations", status_code=201, response_model=ConstituentRelationOut, summary="Create constituent relation")
def create_constituent_relation(
    organization_id: UUID,
    constituent_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Create a relation between two constituents.
    """
    # Verify from-constituent exists
    from_constituent = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == constituent_id,
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not from_constituent:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Person or organization not found",
        })

    to_constituent_id = data.get("to_constituent_id")
    relationship_type = data.get("relationship_type")

    if not to_constituent_id:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_REQUIRED_FIELDS",
            "message": "Related person is required",
        })
    if not relationship_type:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_REQUIRED_FIELDS",
            "message": "Relationship type is required",
        })

    # Verify to-constituent exists
    to_constituent = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == UUID(to_constituent_id),
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not to_constituent:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Target constituent not found",
        })

    # Prevent self-relation
    if str(constituent_id) == to_constituent_id:
        raise HTTPException(status_code=400, detail={
            "code": "SELF_RELATION",
            "message": "A constituent cannot have a relation with itself",
        })

    valid_relationship_types = [
        "teacher_of", "student_of", "master_of", "apprentice_of",
        "parent_of", "child_of", "spouse_of", "sibling_of",
        "collaborator_with", "influenced", "influenced_by",
        "employed", "employed_by", "member_of", "other",
    ]

    if relationship_type not in valid_relationship_types:
        raise HTTPException(status_code=400, detail={
            "code": "INVALID_RELATIONSHIP_TYPE",
            "message": f"relationship_type must be one of: {', '.join(valid_relationship_types)}",
        })

    relation = ConstituentRelation(
        organization_id=organization_id,
        from_constituent_id=constituent_id,
        to_constituent_id=UUID(to_constituent_id),
        relationship_type=relationship_type,
        relationship_note=data.get("relationship_note"),
        start_date=data.get("start_date"),
        end_date=data.get("end_date"),
        created_by=auth.user_id,
    )

    db.add(relation)
    db.commit()

    # Reload with constituent relationships
    relation = db.execute(
        select(ConstituentRelation)
        .options(
            joinedload(ConstituentRelation.from_constituent),
            joinedload(ConstituentRelation.to_constituent),
        )
        .where(ConstituentRelation.relation_id == relation.relation_id)
    ).scalar_one()

    return _serialize_relation(relation)


@router.delete("/api/organizations/{organization_id}/collections/constituents/{constituent_id}/relations/{relation_id}", response_model=SuccessResponse, summary="Delete constituent relation")
def delete_constituent_relation(
    organization_id: UUID,
    constituent_id: UUID,
    relation_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Delete a constituent relation.
    """
    relation = db.execute(
        select(ConstituentRelation)
        .where(
            ConstituentRelation.relation_id == relation_id,
            ConstituentRelation.organization_id == organization_id,
            or_(
                ConstituentRelation.from_constituent_id == constituent_id,
                ConstituentRelation.to_constituent_id == constituent_id,
            ),
        )
    ).scalar_one_or_none()

    if not relation:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Constituent relation not found",
        })

    db.delete(relation)
    db.commit()

    return {"success": True}


# =============================================================================
# ACTIONS
# =============================================================================


@router.post("/api/organizations/{organization_id}/collections/constituents/{constituent_id}/merge", response_model=MergeConstituentsResponse, summary="Merge constituents")
def merge_constituents(
    organization_id: UUID,
    constituent_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Merge a secondary constituent into this (primary) constituent.

    All xrefs and relations from the secondary constituent are reassigned to
    the primary. The secondary constituent is marked with status 'merged'.
    """
    # Verify primary constituent exists
    primary = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == constituent_id,
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not primary:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Primary constituent not found",
        })

    secondary_id_str = data.get("secondary_id")

    if not secondary_id_str:
        raise HTTPException(status_code=400, detail={
            "code": "MISSING_REQUIRED_FIELDS",
            "message": "secondary_id is required",
        })

    secondary_id = UUID(secondary_id_str)

    if constituent_id == secondary_id:
        raise HTTPException(status_code=400, detail={
            "code": "SELF_MERGE",
            "message": "Cannot merge a constituent with itself",
        })

    # Verify secondary constituent exists
    secondary = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == secondary_id,
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not secondary:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Secondary constituent not found",
        })

    # Reassign xrefs from secondary to primary
    secondary_xrefs = db.execute(
        select(ConstituentXref)
        .where(ConstituentXref.constituent_id == secondary_id)
    ).scalars().all()

    reassigned_count = 0
    skipped_count = 0

    for xref in secondary_xrefs:
        # Check if primary already has this exact link
        existing = db.execute(
            select(ConstituentXref)
            .where(
                ConstituentXref.constituent_id == constituent_id,
                ConstituentXref.entity_type == xref.entity_type,
                ConstituentXref.entity_id == xref.entity_id,
                ConstituentXref.role == xref.role,
            )
        ).scalar_one_or_none()

        if existing:
            # Duplicate - remove the secondary's xref
            db.delete(xref)
            skipped_count += 1
        else:
            xref.constituent_id = constituent_id
            reassigned_count += 1

    # Reassign relations from secondary to primary
    secondary_relations_from = db.execute(
        select(ConstituentRelation)
        .where(ConstituentRelation.from_constituent_id == secondary_id)
    ).scalars().all()

    for rel in secondary_relations_from:
        if rel.to_constituent_id == constituent_id:
            # Would become self-relation, remove it
            db.delete(rel)
        else:
            rel.from_constituent_id = constituent_id

    secondary_relations_to = db.execute(
        select(ConstituentRelation)
        .where(ConstituentRelation.to_constituent_id == secondary_id)
    ).scalars().all()

    for rel in secondary_relations_to:
        if rel.from_constituent_id == constituent_id:
            # Would become self-relation, remove it
            db.delete(rel)
        else:
            rel.to_constituent_id = constituent_id

    # Mark secondary as merged
    secondary.status = "merged"
    secondary.is_active = False
    secondary.internal_notes = (
        f"{secondary.internal_notes or ''}\n"
        f"Merged into {primary.name} ({constituent_id}) by user {auth.user_id}"
    ).strip()
    secondary.updated_by = auth.user_id

    db.commit()

    return {
        "success": True,
        "primary_id": str(constituent_id),
        "secondary_id": str(secondary_id),
        "xrefs_reassigned": reassigned_count,
        "xrefs_skipped_duplicate": skipped_count,
    }


@router.post("/api/organizations/{organization_id}/collections/constituents/{constituent_id}/verify", response_model=VerifyConstituentResponse, summary="Verify constituent")
def verify_constituent(
    organization_id: UUID,
    constituent_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Mark a constituent as verified by the current user.
    """
    constituent = db.execute(
        select(Constituent)
        .where(
            Constituent.constituent_id == constituent_id,
            Constituent.organization_id == organization_id,
        )
    ).scalar_one_or_none()

    if not constituent:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Person or organization not found",
        })

    constituent.is_verified = True
    constituent.verified_by = auth.user_id
    constituent.verified_at = datetime.utcnow()
    constituent.updated_by = auth.user_id

    db.commit()

    return {
        "success": True,
        "constituent_id": str(constituent.constituent_id),
        "is_verified": True,
        "verified_at": constituent.verified_at.isoformat(),
    }


# =============================================================================
# CONSTITUENT ROLES (Lookup-driven)
# =============================================================================


@router.get("/api/organizations/{organization_id}/collections/constituent-roles/{entity_type}", response_model=ConstituentRolesResponse, summary="Get constituent roles for entity")
def get_constituent_roles_for_entity(
    organization_id: UUID,
    entity_type: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Get valid constituent roles for a specific entity type.
    """
    roles = get_valid_roles(organization_id, entity_type, db=db)

    return {
        "entity_type": entity_type,
        "roles": roles,
    }


# ============================================================================
# CONSTITUENT MEDIA
# ============================================================================


@router.get("/api/organizations/{org_id}/collections/constituents/{constituent_id}/media", response_model=dict, summary="List constituent media")
def list_constituent_media(
    org_id: UUID,
    constituent_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONSTITUENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List media linked to a constituent."""
    from app.models import Media

    links = (
        db.query(ConstituentMedia)
        .join(Media, ConstituentMedia.media_id == Media.media_id)
        .filter(ConstituentMedia.constituent_id == constituent_id)
        .order_by(ConstituentMedia.is_primary.desc(), ConstituentMedia.sort_order)
        .all()
    )

    media_items = []
    for link in links:
        media = db.query(Media).filter_by(media_id=link.media_id).first()
        if not media:
            continue
        from app.services.uploads import get_org_media_url
        media_items.append({
            "media_id": str(link.media_id),
            "constituent_id": str(link.constituent_id),
            "is_primary": link.is_primary,
            "sort_order": link.sort_order,
            "caption_override": link.caption_override,
            "usage_type": link.usage_type,
            "filename": media.filename,
            "media_type": media.media_type,
            "mime_type": media.mime_type,
            "thumbnail_url": get_org_media_url(media.thumbnail_s3_key) if media.thumbnail_s3_key else None,
            "preview_url": get_org_media_url(media.preview_s3_key) if hasattr(media, 'preview_s3_key') and media.preview_s3_key else None,
            # Display URL: a rendition for images, so the master is not
            # handed out with the constituent's attached media.
            "url": _constituent_media_url(media),
            "title": media.title,
        })

    return {"media": media_items, "count": len(media_items)}


@router.post("/api/organizations/{org_id}/collections/constituents/{constituent_id}/media", response_model=dict, status_code=201, summary="Link media to constituent")
def add_constituent_media(
    org_id: UUID,
    constituent_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.CONSTITUENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Link a media item to a constituent."""
    media_id = data.get("media_id")
    if not media_id:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "media_id is required"})

    # Check constituent exists
    constituent = db.query(Constituent).filter_by(constituent_id=constituent_id, organization_id=org_id).first()
    if not constituent:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Person or organization not found"})

    # Check not already linked
    existing = db.query(ConstituentMedia).filter_by(constituent_id=constituent_id, media_id=UUID(media_id)).first()
    if existing:
        raise HTTPException(status_code=409, detail={"code": "conflict", "message": "Media already linked"})

    is_primary = data.get("is_primary", False)
    if is_primary:
        db.query(ConstituentMedia).filter_by(constituent_id=constituent_id, is_primary=True).update({"is_primary": False})

    link = ConstituentMedia(
        constituent_id=constituent_id,
        media_id=UUID(media_id),
        is_primary=is_primary,
        sort_order=data.get("sort_order", 0),
        caption_override=data.get("caption_override"),
        usage_type=data.get("usage_type"),
        created_by=auth.user_id,
    )
    db.add(link)
    db.commit()

    return {"message": "Media linked", "data": {"media_id": media_id, "is_primary": link.is_primary}}


@router.delete("/api/organizations/{org_id}/collections/constituents/{constituent_id}/media/{media_id}", summary="Unlink media from constituent")
def remove_constituent_media(
    org_id: UUID,
    constituent_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONSTITUENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Unlink a media item from a constituent."""
    link = _org_scoped_constituent_media(db, org_id, constituent_id, media_id)

    was_primary = link.is_primary
    db.delete(link)

    # Auto-promote next if primary was removed
    if was_primary:
        next_link = db.query(ConstituentMedia).filter_by(constituent_id=constituent_id).order_by(ConstituentMedia.sort_order).first()
        if next_link:
            next_link.is_primary = True

    db.commit()
    return {"message": "Media unlinked"}


@router.put("/api/organizations/{org_id}/collections/constituents/{constituent_id}/media/{media_id}/primary", response_model=dict, summary="Set primary media")
def set_constituent_primary_media(
    org_id: UUID,
    constituent_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.CONSTITUENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Set a media item as the primary for a constituent."""
    link = _org_scoped_constituent_media(db, org_id, constituent_id, media_id)

    db.query(ConstituentMedia).filter_by(constituent_id=constituent_id, is_primary=True).update({"is_primary": False})
    link.is_primary = True
    db.commit()

    return {"message": "Primary media updated", "media_id": str(media_id)}
