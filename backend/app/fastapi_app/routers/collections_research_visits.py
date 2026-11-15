"""Research visit log (FastAPI).

Records in-person use of objects by researchers: the visit itself and the
objects handled during it. A use request records permission to use the
collection; a research visit records what happened, so the endpoints share
the use-request permissions:

  view    -> use_requests.view
  create  -> use_requests.create
  edit, add/remove objects, delete -> use_requests.edit

Routes:
  GET    /api/organizations/{org_id}/collections/research-visits
  POST   /api/organizations/{org_id}/collections/research-visits
  GET    /api/organizations/{org_id}/collections/research-visits/{visit_id}
  PATCH  /api/organizations/{org_id}/collections/research-visits/{visit_id}
  DELETE /api/organizations/{org_id}/collections/research-visits/{visit_id}
  POST   /api/organizations/{org_id}/collections/research-visits/{visit_id}/objects
  PATCH  /api/organizations/{org_id}/collections/research-visits/{visit_id}/objects/{object_id}
  DELETE /api/organizations/{org_id}/collections/research-visits/{visit_id}/objects/{object_id}
  GET    /api/organizations/{org_id}/collections/objects/{object_id}/research-visits
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.fastapi_app.integrity_errors import integrity_http_error
from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.fastapi_app.schemas.collections_research_visits import (
    ObjectResearchVisitsResponse,
    ResearchVisitCreate,
    ResearchVisitListResponse,
    ResearchVisitObjectAdd,
    ResearchVisitObjectOut,
    ResearchVisitObjectUpdate,
    ResearchVisitOut,
    ResearchVisitUpdate,
)
from app.fastapi_app.schemas.common import MessageResponse
from app.models import (
    CollectionObject,
    Constituent,
    OrganizationMembership,
    ResearchVisit,
    ResearchVisitObject,
    UseRequest,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.validation_utils import parse_uuid_or_raise

router = APIRouter(tags=["collections-research-visits"])

_BASE = "/api/organizations/{org_id}/collections/research-visits"


# ============================================================================
# Serializers
# ============================================================================

def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _serialize_visit_object(link: ResearchVisitObject) -> dict:
    obj = link.object
    return {
        "visit_object_id": str(link.visit_object_id),
        "visit_id": str(link.visit_id),
        "object_id": str(link.object_id),
        "object_number": obj.object_number if obj is not None else None,
        "object_name": obj.object_name if obj is not None else None,
        "handling_note": link.handling_note,
        "condition_on_return": link.condition_on_return,
        "created_at": _iso(link.created_at),
    }


def _serialize_visit(
    db: Session,
    visit: ResearchVisit,
    *,
    include_objects: bool = False,
    object_count: int | None = None,
) -> dict:
    constituent_name = None
    if visit.researcher_constituent_id:
        constituent_name = db.query(Constituent.name).filter(
            Constituent.constituent_id == visit.researcher_constituent_id,
        ).scalar()
    use_request_number = None
    if visit.use_request_id:
        use_request_number = db.query(UseRequest.request_number).filter(
            UseRequest.request_id == visit.use_request_id,
        ).scalar()

    result = {
        "visit_id": str(visit.visit_id),
        "organization_id": str(visit.organization_id),
        "researcher_constituent_id": str(visit.researcher_constituent_id) if visit.researcher_constituent_id else None,
        "researcher_constituent_name": constituent_name,
        "researcher_name": visit.researcher_name,
        "researcher_affiliation": visit.researcher_affiliation,
        "visit_date": visit.visit_date.isoformat(),
        "arrival_time": visit.arrival_time.strftime("%H:%M") if visit.arrival_time else None,
        "departure_time": visit.departure_time.strftime("%H:%M") if visit.departure_time else None,
        "location": visit.location,
        "research_topic": visit.research_topic,
        "purpose": visit.purpose,
        "supervised_by_user_id": str(visit.supervised_by_user_id) if visit.supervised_by_user_id else None,
        "supervised_by_name": visit.supervised_by_name,
        "use_request_id": str(visit.use_request_id) if visit.use_request_id else None,
        "use_request_number": use_request_number,
        "notes": visit.notes,
        "created_at": _iso(visit.created_at),
        "updated_at": _iso(visit.updated_at),
    }
    if include_objects:
        links = sorted(
            visit.objects,
            key=lambda l: ((l.object.object_number if l.object else "") or "", l.created_at or datetime.min),
        )
        result["objects"] = [_serialize_visit_object(l) for l in links]
        result["object_count"] = len(links)
    else:
        result["object_count"] = object_count if object_count is not None else len(visit.objects)
    return result


# ============================================================================
# Helpers
# ============================================================================

def _get_visit(db: Session, org_id: UUID, visit_id: UUID, *, with_objects: bool = False) -> ResearchVisit:
    query = db.query(ResearchVisit)
    if with_objects:
        query = query.options(joinedload(ResearchVisit.objects).joinedload(ResearchVisitObject.object))
    visit = query.filter(
        ResearchVisit.visit_id == visit_id,
        ResearchVisit.organization_id == org_id,
    ).first()
    if not visit:
        raise HTTPException(status_code=404, detail="Research visit not found")
    return visit


def _resolve_references(db: Session, org_id: UUID, values: dict) -> dict:
    """Turn id strings into UUIDs, checking each belongs to this organization.

    A reference into another organization is reported as not found, the same
    as a reference that does not exist, so the response never confirms that
    another tenant's id is real.
    """
    out = dict(values)

    if out.get("researcher_constituent_id"):
        cid = parse_uuid_or_raise(out["researcher_constituent_id"], "researcher_constituent_id")
        exists = db.query(Constituent.constituent_id).filter(
            Constituent.constituent_id == cid,
            Constituent.organization_id == org_id,
        ).first()
        if not exists:
            raise HTTPException(status_code=400, detail="Linked person record not found")
        out["researcher_constituent_id"] = cid

    if out.get("use_request_id"):
        rid = parse_uuid_or_raise(out["use_request_id"], "use_request_id")
        exists = db.query(UseRequest.request_id).filter(
            UseRequest.request_id == rid,
            UseRequest.organization_id == org_id,
        ).first()
        if not exists:
            raise HTTPException(status_code=400, detail="Use request not found")
        out["use_request_id"] = rid

    if out.get("supervised_by_user_id"):
        uid = parse_uuid_or_raise(out["supervised_by_user_id"], "supervised_by_user_id")
        member = db.query(OrganizationMembership.user_id).filter(
            OrganizationMembership.user_id == uid,
            OrganizationMembership.organization_id == org_id,
        ).first()
        if not member:
            raise HTTPException(status_code=400, detail="Supervising staff member not found in this organization")
        out["supervised_by_user_id"] = uid

    return out


def _check_times(visit: ResearchVisit) -> None:
    if visit.arrival_time and visit.departure_time and visit.departure_time < visit.arrival_time:
        raise HTTPException(
            status_code=422,
            detail="Departure time must be the same as or later than arrival time",
        )


# ============================================================================
# Visits
# ============================================================================

@router.get(_BASE, response_model=ResearchVisitListResponse, summary="List research visits")
def list_research_visits(
    org_id: UUID,
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    q: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List research visits, most recent first."""
    query = db.query(ResearchVisit).filter(ResearchVisit.organization_id == org_id)
    if q:
        term = f"%{escape_ilike(q)}%"
        query = query.filter(or_(
            ResearchVisit.researcher_name.ilike(term, escape="\\"),
            ResearchVisit.researcher_affiliation.ilike(term, escape="\\"),
            ResearchVisit.research_topic.ilike(term, escape="\\"),
            ResearchVisit.location.ilike(term, escape="\\"),
        ))

    total = query.count()
    visits = (
        query.order_by(ResearchVisit.visit_date.desc(), ResearchVisit.arrival_time.desc().nulls_last(), ResearchVisit.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    counts: dict = {}
    if visits:
        rows = db.query(ResearchVisitObject.visit_id, func.count()).filter(
            ResearchVisitObject.visit_id.in_([v.visit_id for v in visits]),
        ).group_by(ResearchVisitObject.visit_id).all()
        counts = {vid: n for vid, n in rows}

    return {
        "items": [_serialize_visit(db, v, object_count=counts.get(v.visit_id, 0)) for v in visits],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post(_BASE, status_code=201, response_model=ResearchVisitOut, summary="Create research visit")
def create_research_visit(
    org_id: UUID,
    body: ResearchVisitCreate,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_CREATE)),
    db: Session = Depends(get_db),
):
    """Log a research visit."""
    values = _resolve_references(db, org_id, body.model_dump())
    visit = ResearchVisit(
        organization_id=org_id,
        created_by_id=auth.user_id,
        updated_by_id=auth.user_id,
        **values,
    )
    db.add(visit)
    db.commit()
    db.refresh(visit)
    return _serialize_visit(db, visit, include_objects=True)


@router.get(_BASE + "/{visit_id}", response_model=ResearchVisitOut, summary="Get research visit")
def get_research_visit(
    org_id: UUID,
    visit_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get one research visit with the objects used."""
    visit = _get_visit(db, org_id, visit_id, with_objects=True)
    return _serialize_visit(db, visit, include_objects=True)


@router.patch(_BASE + "/{visit_id}", response_model=ResearchVisitOut, summary="Update research visit")
def update_research_visit(
    org_id: UUID,
    visit_id: UUID,
    body: ResearchVisitUpdate,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Change the fields sent; leave the rest as they are."""
    visit = _get_visit(db, org_id, visit_id)
    changes = body.model_dump(exclude_unset=True)
    if "researcher_name" in changes and not changes["researcher_name"]:
        raise HTTPException(status_code=422, detail="Researcher name is required")
    if "visit_date" in changes and changes["visit_date"] is None:
        raise HTTPException(status_code=422, detail="Visit date is required")

    for key, value in _resolve_references(db, org_id, changes).items():
        setattr(visit, key, value)
    _check_times(visit)

    visit.updated_by_id = auth.user_id
    visit.updated_at = datetime.now(timezone.utc)
    db.commit()
    visit = _get_visit(db, org_id, visit_id, with_objects=True)
    return _serialize_visit(db, visit, include_objects=True)


@router.delete(_BASE + "/{visit_id}", response_model=MessageResponse, summary="Delete research visit")
def delete_research_visit(
    org_id: UUID,
    visit_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a research visit and its object links (not the objects)."""
    visit = _get_visit(db, org_id, visit_id)
    db.delete(visit)
    db.commit()
    return {"message": "Research visit deleted"}


# ============================================================================
# Objects used during a visit
# ============================================================================

@router.post(_BASE + "/{visit_id}/objects", status_code=201, response_model=ResearchVisitObjectOut, summary="Add object to research visit")
def add_research_visit_object(
    org_id: UUID,
    visit_id: UUID,
    body: ResearchVisitObjectAdd,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Record that an object was used during the visit."""
    object_uuid = parse_uuid_or_raise(body.object_id, "object_id")
    _get_visit(db, org_id, visit_id)

    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_uuid,
        CollectionObject.organization_id == org_id,
        CollectionObject.is_deleted.is_(False),
    ).first()
    if not obj:
        raise HTTPException(status_code=404, detail="Object not found")

    link = ResearchVisitObject(
        visit_id=visit_id,
        organization_id=org_id,
        object_id=object_uuid,
        handling_note=body.handling_note,
        condition_on_return=body.condition_on_return,
        created_by_id=auth.user_id,
    )
    db.add(link)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise integrity_http_error(exc, "This object is already recorded for this visit") from None

    db.refresh(link)
    return _serialize_visit_object(link)


def _get_link(db: Session, org_id: UUID, visit_id: UUID, object_id: UUID) -> ResearchVisitObject:
    link = db.query(ResearchVisitObject).filter(
        ResearchVisitObject.visit_id == visit_id,
        ResearchVisitObject.object_id == object_id,
        ResearchVisitObject.organization_id == org_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Object is not recorded for this visit")
    return link


@router.patch(_BASE + "/{visit_id}/objects/{object_id}", response_model=ResearchVisitObjectOut, summary="Update object notes on research visit")
def update_research_visit_object(
    org_id: UUID,
    visit_id: UUID,
    object_id: UUID,
    body: ResearchVisitObjectUpdate,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Change the handling note or condition-on-return note for one object."""
    link = _get_link(db, org_id, visit_id, object_id)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(link, key, value)
    db.commit()
    db.refresh(link)
    return _serialize_visit_object(link)


@router.delete(_BASE + "/{visit_id}/objects/{object_id}", response_model=MessageResponse, summary="Remove object from research visit")
def remove_research_visit_object(
    org_id: UUID,
    visit_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove an object from the visit record (the object itself is untouched)."""
    link = _get_link(db, org_id, visit_id, object_id)
    db.delete(link)
    db.commit()
    return {"message": "Object removed from research visit"}


# ============================================================================
# Visits for one object
# ============================================================================

@router.get(
    "/api/organizations/{org_id}/collections/objects/{object_id}/research-visits",
    response_model=ObjectResearchVisitsResponse,
    summary="List research visits that used an object",
)
def list_object_research_visits(
    org_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.USE_REQUESTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Every research visit during which this object was used, newest first."""
    rows = (
        db.query(ResearchVisit, ResearchVisitObject)
        .join(ResearchVisitObject, ResearchVisitObject.visit_id == ResearchVisit.visit_id)
        .filter(
            ResearchVisitObject.object_id == object_id,
            ResearchVisitObject.organization_id == org_id,
            ResearchVisit.organization_id == org_id,
        )
        .order_by(ResearchVisit.visit_date.desc(), ResearchVisit.created_at.desc())
        .all()
    )
    return {
        "items": [
            {
                "visit_id": str(visit.visit_id),
                "visit_date": visit.visit_date.isoformat(),
                "researcher_name": visit.researcher_name,
                "researcher_affiliation": visit.researcher_affiliation,
                "research_topic": visit.research_topic,
                "handling_note": link.handling_note,
                "condition_on_return": link.condition_on_return,
            }
            for visit, link in rows
        ],
    }
