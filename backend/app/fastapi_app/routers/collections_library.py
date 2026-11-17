"""Library catalog (FastAPI): bibliographic records, holdings and items.

Records describe published works; holdings say what is held at a location;
items are the physical pieces with barcodes. Subjects and names link to the
subject authority file and to person/organization records.

Permissions reuse the collections permissions:

  view    -> collections.view
  create  -> collections.create (new record)
  edit    -> collections.edit (change a record, its holdings, items, links)
  delete  -> collections.delete (delete a record and everything under it)

Field-level write restrictions use the entity name ``bib_record`` in the
field access service, the same mechanism as object records.

Routes (all under /api/organizations/{org_id}/collections/library/records):
  GET    ""                                   list / search
  POST   ""                                   create
  GET    /{record_id}                         record with holdings, items, links
  PATCH  /{record_id}                         partial update
  DELETE /{record_id}
  POST   /{record_id}/holdings
  PATCH  /{record_id}/holdings/{holding_id}
  DELETE /{record_id}/holdings/{holding_id}
  POST   /{record_id}/holdings/{holding_id}/items
  PATCH  /{record_id}/holdings/{holding_id}/items/{item_id}
  DELETE /{record_id}/holdings/{holding_id}/items/{item_id}
  POST   /{record_id}/subjects
  DELETE /{record_id}/subjects/{link_id}
  POST   /{record_id}/names
  DELETE /{record_id}/names/{link_id}
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import exists, func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.fastapi_app.integrity_errors import integrity_http_error
from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.fastapi_app.schemas.collections_library import (
    BibHoldingCreate,
    BibHoldingOut,
    BibHoldingUpdate,
    BibItemCreate,
    BibItemOut,
    BibItemUpdate,
    BibNameAdd,
    BibNameOut,
    BibRecordCreate,
    BibRecordListResponse,
    BibRecordOut,
    BibRecordUpdate,
    BibSubjectAdd,
    BibSubjectOut,
    RecordType,
)
from app.fastapi_app.schemas.common import MessageResponse
from app.models import (
    BibHolding,
    BibItem,
    BibRecord,
    BibRecordConstituent,
    BibRecordSubject,
    CollectionObject,
    Constituent,
    Location,
    SubjectAuthority,
)
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.field_access_service import apply_field_access, get_write_restricted_fields
from app.services.validation_utils import parse_uuid_or_raise

router = APIRouter(tags=["collections-library"])

_BASE = "/api/organizations/{org_id}/collections/library/records"
_ENTITY = "bib_record"


# ============================================================================
# Serializers
# ============================================================================

def _iso(value) -> str | None:
    return value.isoformat() if value is not None else None


def _serialize_item(item: BibItem) -> dict:
    obj = item.collection_object
    return {
        "item_id": str(item.item_id),
        "holding_id": str(item.holding_id),
        "barcode": item.barcode,
        "copy_number": item.copy_number,
        "enumeration": item.enumeration,
        "chronology": item.chronology,
        "status": item.status,
        "condition_note": item.condition_note,
        "collection_object_id": str(item.collection_object_id) if item.collection_object_id else None,
        "collection_object_number": obj.object_number if obj is not None else None,
        "created_at": _iso(item.created_at),
        "updated_at": _iso(item.updated_at),
    }


def _item_sort_key(item: BibItem):
    return (item.enumeration or "", item.copy_number or "", item.barcode or "", item.created_at or datetime.min)


def _serialize_holding(holding: BibHolding) -> dict:
    loc = holding.location
    return {
        "holding_id": str(holding.holding_id),
        "bib_record_id": str(holding.bib_record_id),
        "location_id": str(holding.location_id) if holding.location_id else None,
        "location_name": loc.name if loc is not None else None,
        "call_number": holding.call_number,
        "holdings_statement": holding.holdings_statement,
        "shelving_notes": holding.shelving_notes,
        "public_note": holding.public_note,
        "staff_note": holding.staff_note,
        "items": [_serialize_item(i) for i in sorted(holding.items, key=_item_sort_key)],
        "created_at": _iso(holding.created_at),
        "updated_at": _iso(holding.updated_at),
    }


def _serialize_subject(link: BibRecordSubject) -> dict:
    subject = link.subject
    return {
        "link_id": str(link.link_id),
        "subject_authority_id": str(link.subject_authority_id),
        "preferred_term": subject.preferred_term if subject is not None else None,
        "lcsh_id": subject.lcsh_id if subject is not None else None,
        "display_order": link.display_order,
    }


def _serialize_name(link: BibRecordConstituent) -> dict:
    person = link.constituent
    return {
        "link_id": str(link.link_id),
        "constituent_id": str(link.constituent_id),
        "name": (person.display_name or person.name) if person is not None else None,
        "role": link.role,
        "display_order": link.display_order,
    }


_RECORD_COLUMNS = (
    "record_type", "title", "subtitle", "statement_of_responsibility", "edition",
    "place", "publisher", "date_display", "date_earliest", "date_latest", "extent",
    "series_statement", "language", "isbn", "issn", "lccn", "oclc_number",
    "call_number", "format_notes", "notes",
)


def _serialize_record(
    record: BibRecord,
    *,
    detail: bool = False,
    holding_count: int | None = None,
    item_count: int | None = None,
) -> dict:
    result = {
        "bib_record_id": str(record.bib_record_id),
        "organization_id": str(record.organization_id),
        **{col: getattr(record, col) for col in _RECORD_COLUMNS},
        "created_at": _iso(record.created_at),
        "updated_at": _iso(record.updated_at),
    }
    if detail:
        holdings = sorted(
            record.holdings,
            key=lambda h: (h.call_number or "", h.created_at or datetime.min),
        )
        result["holdings"] = [_serialize_holding(h) for h in holdings]
        result["holding_count"] = len(holdings)
        result["item_count"] = sum(len(h.items) for h in holdings)
        result["subjects"] = [
            _serialize_subject(l)
            for l in sorted(record.subject_links, key=lambda l: (l.display_order, l.created_at or datetime.min))
        ]
        result["names"] = [
            _serialize_name(l)
            for l in sorted(record.name_links, key=lambda l: (l.display_order, l.created_at or datetime.min))
        ]
    else:
        result["holding_count"] = holding_count or 0
        result["item_count"] = item_count or 0
    return result


def _with_field_access(data: dict, org_id: UUID, auth: AuthContext, db: Session) -> dict:
    return apply_field_access(
        data, _ENTITY, str(org_id), str(auth.user_id), session=db, role_override=auth.role_override,
    )


def _drop_write_restricted(values: dict, org_id: UUID, auth: AuthContext, db: Session) -> dict:
    restricted = get_write_restricted_fields(
        _ENTITY, str(org_id), str(auth.user_id), session=db, role_override=auth.role_override,
    )
    return {k: v for k, v in values.items() if k not in restricted}


# ============================================================================
# Lookups (scoped to the organization; another tenant's id is "not found")
# ============================================================================

def _get_record(db: Session, org_id: UUID, record_id: UUID, *, detail: bool = False) -> BibRecord:
    query = db.query(BibRecord)
    if detail:
        query = query.options(
            selectinload(BibRecord.holdings).selectinload(BibHolding.items).selectinload(BibItem.collection_object),
            selectinload(BibRecord.holdings).selectinload(BibHolding.location),
            selectinload(BibRecord.subject_links).selectinload(BibRecordSubject.subject),
            selectinload(BibRecord.name_links).selectinload(BibRecordConstituent.constituent),
        )
    record = query.filter(
        BibRecord.bib_record_id == record_id,
        BibRecord.organization_id == org_id,
    ).first()
    if not record:
        raise HTTPException(status_code=404, detail="Bibliographic record not found")
    return record


def _get_holding(db: Session, org_id: UUID, record_id: UUID, holding_id: UUID) -> BibHolding:
    holding = db.query(BibHolding).filter(
        BibHolding.holding_id == holding_id,
        BibHolding.bib_record_id == record_id,
        BibHolding.organization_id == org_id,
    ).first()
    if not holding:
        raise HTTPException(status_code=404, detail="Holding not found")
    return holding


def _get_item(db: Session, org_id: UUID, holding_id: UUID, item_id: UUID) -> BibItem:
    item = db.query(BibItem).filter(
        BibItem.item_id == item_id,
        BibItem.holding_id == holding_id,
        BibItem.organization_id == org_id,
    ).first()
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


def _resolve_location(db: Session, org_id: UUID, values: dict) -> dict:
    out = dict(values)
    if out.get("location_id"):
        lid = parse_uuid_or_raise(out["location_id"], "location_id")
        found = db.query(Location.location_id).filter(
            Location.location_id == lid, Location.organization_id == org_id,
        ).first()
        if not found:
            raise HTTPException(status_code=400, detail="Location not found")
        out["location_id"] = lid
    return out


def _resolve_object(db: Session, org_id: UUID, values: dict) -> dict:
    out = dict(values)
    if out.get("collection_object_id"):
        oid = parse_uuid_or_raise(out["collection_object_id"], "collection_object_id")
        found = db.query(CollectionObject.object_id).filter(
            CollectionObject.object_id == oid,
            CollectionObject.organization_id == org_id,
            CollectionObject.is_deleted.is_(False),
        ).first()
        if not found:
            raise HTTPException(status_code=400, detail="Linked object not found")
        out["collection_object_id"] = oid
    return out


def _touch(record: BibRecord, auth: AuthContext) -> None:
    record.updated_by_id = auth.user_id
    record.updated_at = datetime.now(timezone.utc)


def _commit_or_conflict(db: Session, message: str) -> None:
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise integrity_http_error(exc, message) from None


_BARCODE_CONFLICT = "Another item in this organization already has that barcode"


# ============================================================================
# Records
# ============================================================================

@router.get(_BASE, response_model_exclude_unset=True, response_model=BibRecordListResponse, summary="List library records")
def list_bib_records(
    org_id: UUID,
    q: str | None = Query(None, description="Matches title, subtitle, statement of responsibility, ISBN, ISSN, call number or item barcode"),
    record_type: RecordType | None = Query(None),
    limit: int = Query(25, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List and search bibliographic records, ordered by title."""
    query = db.query(BibRecord).filter(BibRecord.organization_id == org_id)
    if record_type:
        query = query.filter(BibRecord.record_type == record_type)
    if q and q.strip():
        term = f"%{escape_ilike(q.strip())}%"
        holding_call_number = exists().where(
            BibHolding.bib_record_id == BibRecord.bib_record_id,
            BibHolding.organization_id == org_id,
            BibHolding.call_number.ilike(term, escape="\\"),
        )
        barcode = exists().where(
            BibItem.holding_id == BibHolding.holding_id,
            BibHolding.bib_record_id == BibRecord.bib_record_id,
            BibItem.organization_id == org_id,
            BibItem.barcode == q.strip(),
        )
        query = query.filter(or_(
            BibRecord.title.ilike(term, escape="\\"),
            BibRecord.subtitle.ilike(term, escape="\\"),
            BibRecord.statement_of_responsibility.ilike(term, escape="\\"),
            BibRecord.isbn.ilike(term, escape="\\"),
            BibRecord.issn.ilike(term, escape="\\"),
            BibRecord.call_number.ilike(term, escape="\\"),
            holding_call_number,
            barcode,
        ))

    total = query.count()
    records = (
        query.order_by(func.lower(BibRecord.title), BibRecord.created_at)
        .offset(offset)
        .limit(limit)
        .all()
    )

    holding_counts: dict = {}
    item_counts: dict = {}
    if records:
        ids = [r.bib_record_id for r in records]
        holding_counts = dict(
            db.query(BibHolding.bib_record_id, func.count())
            .filter(BibHolding.bib_record_id.in_(ids), BibHolding.organization_id == org_id)
            .group_by(BibHolding.bib_record_id).all()
        )
        item_counts = dict(
            db.query(BibHolding.bib_record_id, func.count(BibItem.item_id))
            .join(BibItem, BibItem.holding_id == BibHolding.holding_id)
            .filter(BibHolding.bib_record_id.in_(ids), BibHolding.organization_id == org_id)
            .group_by(BibHolding.bib_record_id).all()
        )

    return {
        "items": [
            _with_field_access(
                _serialize_record(
                    r,
                    holding_count=holding_counts.get(r.bib_record_id, 0),
                    item_count=item_counts.get(r.bib_record_id, 0),
                ),
                org_id, auth, db,
            )
            for r in records
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.post(_BASE, status_code=201, response_model_exclude_unset=True, response_model=BibRecordOut, summary="Create library record")
def create_bib_record(
    org_id: UUID,
    body: BibRecordCreate,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a bibliographic record. Fields the caller may not write are ignored."""
    values = _drop_write_restricted(body.model_dump(), org_id, auth, db)
    if not values.get("title"):
        # Title is required; a role that may not write it cannot create records.
        raise HTTPException(status_code=403, detail="You may not set the title of library records")
    record = BibRecord(
        organization_id=org_id,
        created_by_id=auth.user_id,
        updated_by_id=auth.user_id,
        **values,
    )
    db.add(record)
    db.commit()
    record = _get_record(db, org_id, record.bib_record_id, detail=True)
    return _with_field_access(_serialize_record(record, detail=True), org_id, auth, db)


@router.get(_BASE + "/{record_id}", response_model_exclude_unset=True, response_model=BibRecordOut, summary="Get library record")
def get_bib_record(
    org_id: UUID,
    record_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get one record with its holdings, items, subjects and names."""
    record = _get_record(db, org_id, record_id, detail=True)
    return _with_field_access(_serialize_record(record, detail=True), org_id, auth, db)


@router.patch(_BASE + "/{record_id}", response_model_exclude_unset=True, response_model=BibRecordOut, summary="Update library record")
def update_bib_record(
    org_id: UUID,
    record_id: UUID,
    body: BibRecordUpdate,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Change the fields sent; leave the rest. Write-restricted fields are ignored."""
    record = _get_record(db, org_id, record_id)
    changes = _drop_write_restricted(body.model_dump(exclude_unset=True), org_id, auth, db)
    if "title" in changes and not changes["title"]:
        raise HTTPException(status_code=422, detail="Title is required")
    if "record_type" in changes and changes["record_type"] is None:
        raise HTTPException(status_code=422, detail="Record type is required")
    for key, value in changes.items():
        setattr(record, key, value)
    if (
        record.date_earliest is not None and record.date_latest is not None
        and record.date_latest < record.date_earliest
    ):
        raise HTTPException(status_code=422, detail="Latest year must be the same as or later than earliest year")
    _touch(record, auth)
    db.commit()
    record = _get_record(db, org_id, record_id, detail=True)
    return _with_field_access(_serialize_record(record, detail=True), org_id, auth, db)


@router.delete(_BASE + "/{record_id}", response_model=MessageResponse, summary="Delete library record")
def delete_bib_record(
    org_id: UUID,
    record_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete a record with its holdings, items and links (not the linked authorities or objects)."""
    record = _get_record(db, org_id, record_id)
    db.delete(record)
    db.commit()
    return {"message": "Library record deleted"}


# ============================================================================
# Holdings
# ============================================================================

def _holding_out(db: Session, org_id: UUID, record_id: UUID, holding_id: UUID) -> dict:
    holding = (
        db.query(BibHolding)
        .options(
            selectinload(BibHolding.items).selectinload(BibItem.collection_object),
            selectinload(BibHolding.location),
        )
        .filter(BibHolding.holding_id == holding_id, BibHolding.organization_id == org_id)
        .one()
    )
    return _serialize_holding(holding)


@router.post(_BASE + "/{record_id}/holdings", status_code=201, response_model=BibHoldingOut, summary="Add holding")
def add_bib_holding(
    org_id: UUID,
    record_id: UUID,
    body: BibHoldingCreate,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    record = _get_record(db, org_id, record_id)
    values = _resolve_location(db, org_id, body.model_dump())
    holding = BibHolding(
        organization_id=org_id,
        bib_record_id=record_id,
        created_by_id=auth.user_id,
        updated_by_id=auth.user_id,
        **values,
    )
    db.add(holding)
    _touch(record, auth)
    db.commit()
    return _holding_out(db, org_id, record_id, holding.holding_id)


@router.patch(_BASE + "/{record_id}/holdings/{holding_id}", response_model=BibHoldingOut, summary="Update holding")
def update_bib_holding(
    org_id: UUID,
    record_id: UUID,
    holding_id: UUID,
    body: BibHoldingUpdate,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    holding = _get_holding(db, org_id, record_id, holding_id)
    for key, value in _resolve_location(db, org_id, body.model_dump(exclude_unset=True)).items():
        setattr(holding, key, value)
    holding.updated_by_id = auth.user_id
    holding.updated_at = datetime.now(timezone.utc)
    db.commit()
    return _holding_out(db, org_id, record_id, holding_id)


@router.delete(_BASE + "/{record_id}/holdings/{holding_id}", response_model=MessageResponse, summary="Remove holding")
def delete_bib_holding(
    org_id: UUID,
    record_id: UUID,
    holding_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove a holding and its items."""
    holding = _get_holding(db, org_id, record_id, holding_id)
    db.delete(holding)
    db.commit()
    return {"message": "Holding removed"}


# ============================================================================
# Items
# ============================================================================

def _item_out(db: Session, org_id: UUID, item_id: UUID) -> dict:
    item = (
        db.query(BibItem)
        .options(selectinload(BibItem.collection_object))
        .filter(BibItem.item_id == item_id, BibItem.organization_id == org_id)
        .one()
    )
    return _serialize_item(item)


@router.post(
    _BASE + "/{record_id}/holdings/{holding_id}/items",
    status_code=201, response_model=BibItemOut, summary="Add item",
)
def add_bib_item(
    org_id: UUID,
    record_id: UUID,
    holding_id: UUID,
    body: BibItemCreate,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    _get_holding(db, org_id, record_id, holding_id)
    values = _resolve_object(db, org_id, body.model_dump())
    item = BibItem(
        organization_id=org_id,
        holding_id=holding_id,
        created_by_id=auth.user_id,
        updated_by_id=auth.user_id,
        **values,
    )
    db.add(item)
    _commit_or_conflict(db, _BARCODE_CONFLICT)
    return _item_out(db, org_id, item.item_id)


@router.patch(
    _BASE + "/{record_id}/holdings/{holding_id}/items/{item_id}",
    response_model=BibItemOut, summary="Update item",
)
def update_bib_item(
    org_id: UUID,
    record_id: UUID,
    holding_id: UUID,
    item_id: UUID,
    body: BibItemUpdate,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    _get_holding(db, org_id, record_id, holding_id)
    item = _get_item(db, org_id, holding_id, item_id)
    changes = _resolve_object(db, org_id, body.model_dump(exclude_unset=True))
    if "status" in changes and changes["status"] is None:
        raise HTTPException(status_code=422, detail="Status is required")
    for key, value in changes.items():
        setattr(item, key, value)
    item.updated_by_id = auth.user_id
    item.updated_at = datetime.now(timezone.utc)
    _commit_or_conflict(db, _BARCODE_CONFLICT)
    return _item_out(db, org_id, item_id)


@router.delete(
    _BASE + "/{record_id}/holdings/{holding_id}/items/{item_id}",
    response_model=MessageResponse, summary="Remove item",
)
def delete_bib_item(
    org_id: UUID,
    record_id: UUID,
    holding_id: UUID,
    item_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    _get_holding(db, org_id, record_id, holding_id)
    item = _get_item(db, org_id, holding_id, item_id)
    db.delete(item)
    db.commit()
    return {"message": "Item removed"}


# ============================================================================
# Subjects and names
# ============================================================================

@router.post(_BASE + "/{record_id}/subjects", status_code=201, response_model=BibSubjectOut, summary="Add subject")
def add_bib_subject(
    org_id: UUID,
    record_id: UUID,
    body: BibSubjectAdd,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    record = _get_record(db, org_id, record_id)
    sid = parse_uuid_or_raise(body.subject_authority_id, "subject_authority_id")
    subject = db.query(SubjectAuthority).filter(
        SubjectAuthority.authority_id == sid, SubjectAuthority.organization_id == org_id,
    ).first()
    if not subject:
        raise HTTPException(status_code=404, detail="Subject not found")
    next_order = (db.query(func.max(BibRecordSubject.display_order)).filter(
        BibRecordSubject.bib_record_id == record_id,
    ).scalar() or 0) + 1
    link = BibRecordSubject(
        organization_id=org_id, bib_record_id=record_id, subject_authority_id=sid,
        display_order=next_order, created_by_id=auth.user_id,
    )
    db.add(link)
    _touch(record, auth)
    _commit_or_conflict(db, "This subject is already on this record")
    db.refresh(link)
    return _serialize_subject(link)


@router.delete(_BASE + "/{record_id}/subjects/{link_id}", response_model=MessageResponse, summary="Remove subject")
def remove_bib_subject(
    org_id: UUID,
    record_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    link = db.query(BibRecordSubject).filter(
        BibRecordSubject.link_id == link_id,
        BibRecordSubject.bib_record_id == record_id,
        BibRecordSubject.organization_id == org_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Subject is not on this record")
    db.delete(link)
    db.commit()
    return {"message": "Subject removed"}


@router.post(_BASE + "/{record_id}/names", status_code=201, response_model=BibNameOut, summary="Add name")
def add_bib_name(
    org_id: UUID,
    record_id: UUID,
    body: BibNameAdd,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    record = _get_record(db, org_id, record_id)
    cid = parse_uuid_or_raise(body.constituent_id, "constituent_id")
    person = db.query(Constituent).filter(
        Constituent.constituent_id == cid, Constituent.organization_id == org_id,
    ).first()
    if not person:
        raise HTTPException(status_code=404, detail="Person or organization record not found")
    next_order = (db.query(func.max(BibRecordConstituent.display_order)).filter(
        BibRecordConstituent.bib_record_id == record_id,
    ).scalar() or 0) + 1
    link = BibRecordConstituent(
        organization_id=org_id, bib_record_id=record_id, constituent_id=cid,
        role=body.role, display_order=next_order, created_by_id=auth.user_id,
    )
    db.add(link)
    _touch(record, auth)
    _commit_or_conflict(db, "This name is already on this record in that role")
    db.refresh(link)
    return _serialize_name(link)


@router.delete(_BASE + "/{record_id}/names/{link_id}", response_model=MessageResponse, summary="Remove name")
def remove_bib_name(
    org_id: UUID,
    record_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    link = db.query(BibRecordConstituent).filter(
        BibRecordConstituent.link_id == link_id,
        BibRecordConstituent.bib_record_id == record_id,
        BibRecordConstituent.organization_id == org_id,
    ).first()
    if not link:
        raise HTTPException(status_code=404, detail="Name is not on this record")
    db.delete(link)
    db.commit()
    return {"message": "Name removed"}
