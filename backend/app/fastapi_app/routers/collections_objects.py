"""
Collection Objects endpoints (FastAPI).

Core CRUD operations, object constituent links, and other number types.
"""
import logging
import traceback
from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Constituent,
    ConstituentXref,
    Location,
    Media,
    Movement,
    ObjectPart,
    VocabularyMapping,
    VocabularyTerm,
    OtherNumberType,
    ConditionReport,
    ObjectEntry,
    ObjectEntryItem,
    Acquisition,
    AcquisitionObject,
    LoanIn,
    LoanInObject,
    LoanOut,
    LoanOutObject,
    ConservationTreatment,
    ObjectExit,
    Deaccession,
    UseRequest,
    UseRequestObject,
    IncidentReport,
    IncidentReportObject,
    ObjectMaterial,
    ObjectTechnique,
    ObjectClassification,
    ObjectTitle,
    ObjectOtherNumber,
    ObjectMeasurement,
    ObjectInscription,
    EntityAuditEvent,
    EntityAuditFieldDiff,
)
from app.services.uploads import get_org_media_url
from app.permissions import Permission
from app.services.api_security import escape_ilike
from app.services.field_access_service import apply_field_access, get_write_restricted_fields
from app.fastapi_app.serializers.collections_helpers import (
    _index_collection_object,
    _reindex_linked_media,
    _delete_collection_object_from_index,
    _get_primary_images_bulk,
)
from app.fastapi_app.serializers.collections import (
    _serialize_collection_object,
    _serialize_collection_object_full,
    _serialize_condition_report,
    _serialize_object_entry,
    _serialize_acquisition,
    _serialize_loan_in,
    _serialize_loan_in_object,
    _serialize_loan_out,
    _serialize_loan_out_object,
    _serialize_conservation_treatment,
    _serialize_object_exit,
    _serialize_deaccession,
    _serialize_other_number_type,
)
from app.fastapi_app.schemas.collections_objects import (
    CollectionObjectListResponse,
    ObjectProceduresResponse,
    ConstituentObjectsResponse,
    OtherNumberTypeListResponse,
    OtherNumberTypeDeleteResponse,
)
from app.fastapi_app.schemas.common import MessageResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["collections-objects"])


# ============================================================================
# HELPERS
# ============================================================================

def _sync_link_tables(obj, data, org_uuid, user_uuid):
    """Sync link table data from frontend payload (JSONB-shaped) into link table records.

    Safety note: The clear-and-recreate pattern here is safe because the entire
    update (including this sync) runs inside a single DB transaction that is
    committed in the calling function. If any step fails, the transaction rolls
    back and no data is lost.  Do NOT add intermediate commits or flushes here.

    Returns:
        list[str]: Warning messages for items that were silently dropped.
    """
    from decimal import Decimal

    warnings: list[str] = []

    if "titles" in data:
        # Clear existing and recreate
        obj.title_links.clear()
        for i, t in enumerate(data["titles"] or []):
            title_text = t.get("title", "").strip() if isinstance(t, dict) else ""
            if not title_text:
                warnings.append(f"Title at position {i + 1} was skipped (empty title)")
                continue
            obj.title_links.append(ObjectTitle(
                organization_id=org_uuid,
                title=title_text,
                title_type=t.get("title_type"),
                language=t.get("language"),
                is_preferred=bool(t.get("is_preferred", False)),
                display_order=i,
                created_by=user_uuid,
            ))

    if "other_numbers" in data:
        obj.other_number_links.clear()
        for i, n in enumerate(data["other_numbers"] or []):
            num_type = n.get("type", "").strip() if isinstance(n, dict) else ""
            num_value = n.get("value", "").strip() if isinstance(n, dict) else ""
            if not num_type or not num_value:
                missing = []
                if not num_type:
                    missing.append("type")
                if not num_value:
                    missing.append("value")
                warnings.append(f"Other number at position {i + 1} was skipped (missing {', '.join(missing)})")
                continue
            obj.other_number_links.append(ObjectOtherNumber(
                organization_id=org_uuid,
                number_type=num_type,
                number_value=num_value,
                display_order=i,
                created_by=user_uuid,
            ))

    if "measurements" in data:
        obj.measurement_links.clear()
        for i, m in enumerate(data["measurements"] or []):
            if not isinstance(m, dict) or not m.get("dimension") or m.get("value") is None or not m.get("unit"):
                missing = []
                if isinstance(m, dict):
                    if not m.get("dimension"):
                        missing.append("dimension")
                    if m.get("value") is None:
                        missing.append("value")
                    if not m.get("unit"):
                        missing.append("unit")
                if missing:
                    warnings.append(f"Measurement at position {i + 1} was skipped (missing {', '.join(missing)})")
                continue
            obj.measurement_links.append(ObjectMeasurement(
                organization_id=org_uuid,
                dimension=m["dimension"],
                value=Decimal(str(m["value"])),
                unit=m["unit"],
                part=m.get("part"),
                display_order=i,
                created_by=user_uuid,
            ))

    if "inscriptions" in data:
        obj.inscription_links.clear()
        for i, ins in enumerate(data["inscriptions"] or []):
            content = ins.strip() if isinstance(ins, str) else (ins.get("content", "").strip() if isinstance(ins, dict) else "")
            if not content:
                warnings.append(f"Inscription at position {i + 1} was skipped (empty content)")
                continue
            obj.inscription_links.append(ObjectInscription(
                organization_id=org_uuid,
                content=content,
                inscription_type=ins.get("inscription_type") if isinstance(ins, dict) else None,
                location_on_object=ins.get("location_on_object") if isinstance(ins, dict) else None,
                method=ins.get("method") if isinstance(ins, dict) else None,
                language=ins.get("language") if isinstance(ins, dict) else None,
                display_order=i,
                created_by=user_uuid,
            ))

    return warnings


# Fields that are now link tables, not model columns
_LINK_TABLE_FIELDS = {'titles', 'other_numbers', 'measurements', 'inscriptions'}


# ============================================================================
# COLLECTION OBJECT CRUD
# ============================================================================

@router.post("/api/organizations/{organization_id}/collections/objects", status_code=201, response_model=dict, summary="Create collection object")
def create_collection_object(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_CREATE)),
    db: Session = Depends(get_db),
):
    """
    Create a new collection object.

    Request body:
    {
        "object_number": "2024.1.1",
        "title": "Portrait of a Lady",
        "object_type": "painting",
        ... (all procedure fields supported)
    }
    """
    # Validate required fields - object_number is required
    if "object_number" not in data or not data.get("object_number", "").strip():
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing required field: object_number",
            "field": "object_number",
        })

    user_uuid = auth.user_id

    # Extract link table data before filtering model fields
    link_data = {k: data.pop(k) for k in list(data.keys()) if k in _LINK_TABLE_FIELDS}

    # Filter data to only include valid model fields
    from app.services.coerce import coerce_value_for_column
    protected_fields = {'object_id', 'organization_id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'barcode'}
    protected_fields |= get_write_restricted_fields('collection_object', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    filtered_data = {}
    for k, v in data.items():
        if hasattr(CollectionObject, k) and k not in protected_fields:
            filtered_data[k] = coerce_value_for_column(CollectionObject, k, v)

    # Create the object + its default part via the shared service — the same
    # core the draft applier runs. Link tables and indexing stay here (they are
    # untrusted-input / API concerns the curated draft payload doesn't carry).
    from app.services.collections.creation.collection_object import (
        create_collection_object as _create_collection_object,
    )

    obj = _create_collection_object(db, organization_id, filtered_data, user_uuid, open_approval=True)

    # Create link table records
    sync_warnings = _sync_link_tables(obj, link_data, organization_id, user_uuid)

    try:
        db.commit()

        # Refresh to get relationships
        db.refresh(obj)

        # Index in OpenSearch (async, don't fail if unavailable)
        _index_collection_object(obj)

        result = _serialize_collection_object_full(obj, session=db)
        if sync_warnings:
            result["_warnings"] = sync_warnings
        return result

    except IntegrityError as e:
        db.rollback()
        if "ix_objects_org_number" in str(e).lower():
            raise HTTPException(status_code=409, detail={
                "code": "conflict",
                "message": f"Object with number '{data.get('object_number')}' already exists",
            })
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Database constraint violation",
        })


@router.get("/api/organizations/{organization_id}/collections/objects", response_model=CollectionObjectListResponse, summary="List collection objects")
def list_collection_objects(
    organization_id: UUID,
    limit: int = Query(50, le=500),
    offset: int = Query(0),
    search: str = Query(None),
    object_type: str = Query(None),
    object_status: str = Query(None),
    location_id: str = Query(None),
    include_location: bool = Query(False),
    sort_by: str = Query("created_at"),
    sort_order: str = Query("desc"),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    List collection objects with filtering and pagination.

    Uses OpenSearch for full-text search when available, falls back to database.
    """
    if sort_order not in ("asc", "desc"):
        sort_order = "desc"

    # Try OpenSearch first when search term is provided
    if search:
        from app.search.collections.service import (
            CollectionsSearchService,
            get_collections_search_service,
        )
        from app.search.collections.schemas import (
            CollectionsSearchRequest,
            CollectionsSearchQuery,
            CollectionsSearchFilters,
            SearchSort,
        )

        if CollectionsSearchService.is_available():
            try:
                # Build OpenSearch request
                filters = CollectionsSearchFilters(
                    object_type=[object_type] if object_type else None,
                    object_status=[object_status] if object_status else None,
                    location_id=[location_id] if location_id else None,
                )

                # Map sort fields
                sort_field_map = {
                    "created_at": "created_at",
                    "updated_at": "updated_at",
                    "object_number": "object_number.keyword",
                    "title": "title.keyword",
                    "_score": "_score",
                }
                os_sort_field = sort_field_map.get(sort_by, "_score")

                search_request = CollectionsSearchRequest(
                    query=CollectionsSearchQuery(q=search),
                    filters=filters,
                    sort=SearchSort(field=os_sort_field, order=sort_order),
                    limit=min(limit, 100),  # OpenSearch schema limits to 100
                    offset=offset,
                    include_facets=False,
                    highlight=False,
                )

                service = get_collections_search_service()
                result = service.search(search_request, organization_id, db_session=db)

                # Get full objects from database for consistent serialization
                if result.hits:
                    object_ids = [UUID(hit.object_id) for hit in result.hits]
                    objects_query = db.query(CollectionObject).filter(
                        CollectionObject.object_id.in_(object_ids),
                        CollectionObject.organization_id == organization_id,
                    ).options(
                        joinedload(CollectionObject.constituent_xrefs).joinedload(ConstituentXref.constituent),
                        joinedload(CollectionObject.material_links),
                        joinedload(CollectionObject.technique_links),
                        joinedload(CollectionObject.classification_links).joinedload(ObjectClassification.lookup_value),
                        joinedload(CollectionObject.title_links),
                        joinedload(CollectionObject.measurement_links),
                        selectinload(CollectionObject.condition_reports),
                    )
                    if include_location:
                        objects_query = objects_query.options(joinedload(CollectionObject.current_location))

                    objects_map = {str(o.object_id): o for o in objects_query.all()}
                    # Preserve search result order
                    objects = [objects_map[hit.object_id] for hit in result.hits if hit.object_id in objects_map]
                else:
                    objects = []

                # Bulk fetch primary images to avoid N+1 queries
                obj_ids = [o.object_id for o in objects]
                primary_images = _get_primary_images_bulk(obj_ids, organization_id, session=db) if obj_ids else {}

                return {
                    "objects": [
                        apply_field_access(
                            _serialize_collection_object(
                                o,
                                include_location=include_location,
                                include_primary_image=True,
                                primary_image_url=primary_images.get(str(o.object_id)),
                                session=db,
                            ),
                            'collection_object', str(organization_id), str(auth.user_id), session=db,
                        )
                        for o in objects
                    ],
                    "total": result.total,
                    "limit": limit,
                    "offset": offset,
                    "search_engine": "opensearch",
                }

            except Exception as e:
                logger.warning(f"OpenSearch query failed, falling back to database: {e}\n{traceback.format_exc()}")
                # Fall through to database query

    # Database query (fallback or when no search term)
    query = db.query(CollectionObject).filter(
        CollectionObject.organization_id == organization_id,
        CollectionObject.is_deleted == False,
    )

    if search:
        # Fallback ILIKE search when OpenSearch unavailable
        search_term = f"%{escape_ilike(search)}%"
        from app.models.objects import ObjectTitle
        titles_search = text(
            "EXISTS (SELECT 1 FROM collections.object_titles AS t WHERE t.object_id = collections.collection_objects.object_id AND t.title ILIKE :search)"
        ).bindparams(search=search_term)
        query = query.filter(
            or_(
                titles_search,
                CollectionObject.brief_description.ilike(search_term, escape="\\"),
                CollectionObject.object_number.ilike(search_term, escape="\\"),
                CollectionObject.object_name.ilike(search_term, escape="\\"),
            )
        )

    if object_type:
        query = query.filter(CollectionObject.object_type == object_type)

    if object_status:
        query = query.filter(CollectionObject.object_status == object_status)

    if location_id:
        query = query.filter(CollectionObject.current_location_id == UUID(location_id))

    # Always load linked entity counts for indicators
    query = query.options(
        joinedload(CollectionObject.constituent_xrefs).joinedload(ConstituentXref.constituent),
        joinedload(CollectionObject.material_links),
        joinedload(CollectionObject.technique_links),
        joinedload(CollectionObject.classification_links).joinedload(ObjectClassification.lookup_value),
        joinedload(CollectionObject.title_links),
        joinedload(CollectionObject.measurement_links),
        selectinload(CollectionObject.condition_reports),
    )

    if include_location:
        query = query.options(joinedload(CollectionObject.current_location))

    # Apply sorting — a map, not a set, so the allowlist both prevents getattr
    # abuse AND translates the public field name to the column.
    #
    # `title` is the name the search schema and the OpenSearch index use (see
    # the sort_field_map above, and app/search/schemas.py); the column is
    # object_name. As a bare allowlist entry `title` passed the check and then
    # raised AttributeError in getattr, because CollectionObject has no `title`
    # attribute at all — so ?sort_by=title returned 500 on the database path
    # while working on the search path.
    _SORTABLE_COLUMNS = {
        "created_at": "created_at",
        "updated_at": "updated_at",
        "object_number": "object_number",
        "title": "object_name",
        "object_name": "object_name",
        "object_type": "object_type",
        "object_status": "object_status",
    }
    sort_column = getattr(CollectionObject, _SORTABLE_COLUMNS.get(sort_by, "created_at"))
    if sort_order == "asc":
        query = query.order_by(sort_column.asc())
    else:
        query = query.order_by(sort_column.desc())

    total = query.count()
    objects = query.offset(offset).limit(limit).all()

    # Bulk fetch primary images to avoid N+1 queries
    obj_ids = [o.object_id for o in objects]
    primary_images = _get_primary_images_bulk(obj_ids, organization_id, session=db) if obj_ids else {}

    return {
        "items": [
            apply_field_access(
                _serialize_collection_object(
                    o,
                    include_location=include_location,
                    include_primary_image=True,
                    primary_image_url=primary_images.get(str(o.object_id)),
                    session=db,
                ),
                'collection_object', str(organization_id), str(auth.user_id), session=db,
            )
            for o in objects
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
        "search_engine": "database" if search else None,
    }


@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}", response_model=dict, summary="Get collection object")
def get_collection_object(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single collection object by ID with all procedure fields."""
    obj = db.query(CollectionObject).options(
        joinedload(CollectionObject.current_location),
        joinedload(CollectionObject.home_location),
        joinedload(CollectionObject.constituent_xrefs).joinedload(ConstituentXref.constituent),
        joinedload(CollectionObject.acquisitions).joinedload(AcquisitionObject.acquisition),
        joinedload(CollectionObject.material_links).joinedload(ObjectMaterial.vocabulary_term),
        joinedload(CollectionObject.technique_links).joinedload(ObjectTechnique.vocabulary_term),
        joinedload(CollectionObject.classification_links).joinedload(ObjectClassification.lookup_value),
        joinedload(CollectionObject.title_links),
        joinedload(CollectionObject.other_number_links),
        joinedload(CollectionObject.measurement_links),
        joinedload(CollectionObject.inscription_links),
        selectinload(CollectionObject.condition_reports),
    ).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == organization_id,
        CollectionObject.is_deleted == False,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object not found",
        })

    serialized = _serialize_collection_object_full(obj, include_constituents=True, session=db)
    filtered = apply_field_access(serialized, 'collection_object', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    return filtered


@router.put("/api/organizations/{organization_id}/collections/objects/{object_id}", response_model=dict, summary="Update collection object")
def update_collection_object(
    organization_id: UUID,
    object_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a collection object."""
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == organization_id,
        CollectionObject.is_deleted == False,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object not found",
        })

    # Optimistic concurrency check: if the client sends updated_at,
    # verify it matches the current DB value to detect concurrent edits
    client_updated_at = data.pop("updated_at", None)
    if client_updated_at and obj.updated_at:
        try:
            client_ts = datetime.fromisoformat(client_updated_at) if isinstance(client_updated_at, str) else client_updated_at
            # Ensure both are timezone-aware for comparison
            if client_ts.tzinfo is None:
                client_ts = client_ts.replace(tzinfo=timezone.utc)
            db_ts = obj.updated_at if obj.updated_at.tzinfo else obj.updated_at.replace(tzinfo=timezone.utc)
            # Compare with 1-second tolerance for serialization rounding
            if abs((db_ts - client_ts).total_seconds()) > 1:
                raise HTTPException(status_code=409, detail={
                    "code": "conflict",
                    "message": "This record was modified by another user. "
                               "Please refresh and re-apply your changes.",
                })
        except (ValueError, TypeError):
            pass  # Malformed timestamp -- skip check, don't block save

    # Extract link table data before updating model fields
    link_data = {k: data.pop(k) for k in list(data.keys()) if k in _LINK_TABLE_FIELDS}

    # Update allowed fields
    protected_fields = {'object_id', 'organization_id', 'created_at', 'created_by', 'updated_at', 'updated_by'}
    protected_fields |= get_write_restricted_fields('collection_object', str(organization_id), str(auth.user_id), session=db, role_override=auth.role_override)
    from app.services.coerce import coerce_value_for_column
    for key, value in data.items():
        if hasattr(obj, key) and key not in protected_fields:
            setattr(obj, key, coerce_value_for_column(CollectionObject, key, value))

    # Sync link table records
    user_uuid = auth.user_id
    sync_warnings = _sync_link_tables(obj, link_data, organization_id, user_uuid)

    obj.updated_by = user_uuid
    obj.updated_at = datetime.now(timezone.utc)

    try:
        db.commit()
        # Refresh to pick up recreated link table records
        db.refresh(obj)

        # Re-index in OpenSearch
        _index_collection_object(obj)
        # Re-index linked media so denormalized object metadata stays in sync
        _reindex_linked_media(obj)

        result = _serialize_collection_object_full(obj, session=db)
        if sync_warnings:
            result["_warnings"] = sync_warnings
        return result

    except IntegrityError as e:
        db.rollback()
        if "ix_objects_org_number" in str(e).lower():
            raise HTTPException(status_code=409, detail={
                "code": "conflict",
                "message": "Object number already exists",
            })
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Database constraint violation",
        })


@router.delete("/api/organizations/{organization_id}/collections/objects/{object_id}", response_model=MessageResponse, summary="Delete collection object")
def delete_collection_object(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_DELETE)),
    db: Session = Depends(get_db),
):
    """Soft-delete a collection object (sets is_deleted flag, preserves record for audit/compliance)."""
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == organization_id,
        CollectionObject.is_deleted == False,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object not found",
        })

    obj.is_deleted = True
    obj.deleted_at = datetime.now(timezone.utc)
    obj.deleted_by = auth.user_id
    db.commit()

    # Remove from OpenSearch so it no longer appears in search results
    _delete_collection_object_from_index(obj.object_id, obj.organization_id)

    return {"message": "Object deleted successfully"}


# ============================================================================
# OBJECT PROCEDURES
# ============================================================================

@router.get("/api/organizations/{organization_id}/collections/objects/{object_id}/procedures", response_model=ObjectProceduresResponse, summary="Get object procedures")
def get_object_procedures(
    organization_id: UUID,
    object_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Get all procedures related to a collection object.

    Returns acquisitions, loans out, conservation treatments, condition reports,
    deaccessions, use requests, and incident reports linked to this object.
    """
    # Verify the object exists
    obj = db.query(CollectionObject).filter(
        CollectionObject.object_id == object_id,
        CollectionObject.organization_id == organization_id,
    ).first()

    if not obj:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Object not found",
        })

    # Query Acquisitions via ObjectEntryItem -> ObjectEntry -> Acquisition (single JOIN query)
    acqs = db.query(Acquisition).join(
        ObjectEntryItem,
        Acquisition.entry_id == ObjectEntryItem.entry_id
    ).filter(
        ObjectEntryItem.object_id == object_id,
        ObjectEntryItem.organization_id == organization_id,
        Acquisition.organization_id == organization_id,
    ).all()
    acquisitions = [{
        "acquisition_id": str(a.acquisition_id),
        "acquisition_number": a.acquisition_number,
        "acquisition_method": a.acquisition_method,
        "status": a.status,
        "acquisition_date": a.acquisition_date.isoformat() if a.acquisition_date else None,
        "source_name": a.source_name,
    } for a in acqs]

    # Query Loans Out via LoanOutObject (single JOIN query)
    los = db.query(LoanOut).join(
        LoanOutObject,
        LoanOut.loan_out_id == LoanOutObject.loan_out_id
    ).filter(
        LoanOutObject.object_id == object_id,
        LoanOutObject.organization_id == organization_id,
        LoanOut.organization_id == organization_id,
    ).all()
    loans_out = [{
        "loan_out_id": str(l.loan_out_id),
        "loan_number": l.loan_number,
        "borrower_name": l.borrower_name,
        "venue_name": l.venue_name,
        "status": l.status,
        "loan_start_date": l.loan_start_date.isoformat() if l.loan_start_date else None,
        "loan_end_date": l.loan_end_date.isoformat() if l.loan_end_date else None,
    } for l in los]

    # Query Conservation Treatments (direct object_id FK)
    treatments = db.query(ConservationTreatment).filter(
        ConservationTreatment.object_id == object_id,
        ConservationTreatment.organization_id == organization_id,
    ).all()
    conservation = [{
        "treatment_id": str(t.treatment_id),
        "treatment_number": t.treatment_number,
        "treatment_type": t.treatment_type,
        "status": t.status,
        "conservator_name": t.conservator_name,
        "start_date": t.start_date.isoformat() if t.start_date else None,
        "end_date": t.end_date.isoformat() if t.end_date else None,
    } for t in treatments]

    # Query Condition Reports (direct object_id FK)
    reports = db.query(ConditionReport).filter(
        ConditionReport.object_id == object_id,
        ConditionReport.organization_id == organization_id,
    ).all()
    condition_reports = [{
        "report_id": str(r.report_id),
        "report_number": r.report_number,
        "report_type": r.report_type,
        "status": r.status,
        "overall_condition": r.overall_condition,
        "report_date": r.report_date.isoformat() if r.report_date else None,
        "examiner_name": r.examiner_name,
    } for r in reports]

    # Query Deaccessions (direct object_id FK)
    deaccs = db.query(Deaccession).filter(
        Deaccession.object_id == object_id,
        Deaccession.organization_id == organization_id,
    ).all()
    deaccessions = [{
        "deaccession_id": str(d.deaccession_id),
        "deaccession_number": d.deaccession_number,
        "reason": d.reason,
        "disposal_method": d.disposal_method,
        "status": d.status,
        "deaccession_date": d.deaccession_date.isoformat() if d.deaccession_date else None,
    } for d in deaccs]

    # Query Use Requests via UseRequestObject (single JOIN query)
    urs = db.query(UseRequest).join(
        UseRequestObject,
        UseRequest.request_id == UseRequestObject.request_id
    ).filter(
        UseRequestObject.object_id == object_id,
        UseRequestObject.organization_id == organization_id,
        UseRequest.organization_id == organization_id,
    ).all()
    use_requests = [{
        "request_id": str(u.request_id),
        "request_number": u.request_number,
        "use_type": u.use_type,
        "requester_name": u.requester_name,
        "requester_institution": u.requester_institution,
        "status": u.status,
        "request_date": u.request_date.isoformat() if u.request_date else None,
    } for u in urs]

    # Query Incident Reports via IncidentReportObject (single JOIN query)
    irs = db.query(IncidentReport).join(
        IncidentReportObject,
        IncidentReport.report_id == IncidentReportObject.report_id
    ).filter(
        IncidentReportObject.object_id == object_id,
        IncidentReportObject.organization_id == organization_id,
        IncidentReport.organization_id == organization_id,
    ).all()
    incident_reports = [{
        "report_id": str(i.report_id),
        "report_number": i.report_number,
        "incident_type": i.incident_type,
        "incident_date": i.incident_date.isoformat() if i.incident_date else None,
        "status": i.status,
        "report_date": i.report_date.isoformat() if i.report_date else None,
    } for i in irs]

    return {
        "object_id": str(obj.object_id),
        "object_number": obj.object_number,
        "acquisitions": acquisitions,
        "loans_out": loans_out,
        "conservation": conservation,
        "condition_reports": condition_reports,
        "deaccessions": deaccessions,
        "use_requests": use_requests,
        "incident_reports": incident_reports,
    }


# ============================================================================
# CONSTITUENT OBJECTS
# ============================================================================

@router.get("/api/organizations/{organization_id}/collections/constituents/{constituent_id}/objects", response_model=ConstituentObjectsResponse, summary="Get constituent objects")
def get_constituent_objects(
    organization_id: UUID,
    constituent_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """
    Get all objects linked to a constituent.

    Returns objects grouped by the constituent's relationship role.
    """
    # Verify the constituent exists
    constituent = db.query(Constituent).filter(
        Constituent.constituent_id == constituent_id,
        Constituent.organization_id == organization_id,
    ).first()

    if not constituent:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Constituent not found",
        })

    # Get all collection_object xrefs for the constituent
    xrefs = db.query(ConstituentXref).filter(
        ConstituentXref.constituent_id == constituent_id,
        ConstituentXref.entity_type == 'collection_object',
        ConstituentXref.organization_id == organization_id,
    ).order_by(ConstituentXref.role, ConstituentXref.display_order).all()

    # Bulk-load the linked objects
    entity_ids = [xref.entity_id for xref in xrefs]
    objects_map = {}
    if entity_ids:
        objs = db.query(CollectionObject).filter(
            CollectionObject.object_id.in_(entity_ids),
            CollectionObject.organization_id == organization_id,
        ).all()
        objects_map = {obj.object_id: obj for obj in objs}

    def get_display_title(obj):
        if not obj or not obj.title_links:
            return None
        preferred = next((t for t in obj.title_links if t.is_preferred), None)
        return preferred.title if preferred else (obj.title_links[0].title if obj.title_links else None)

    objects = [{
        "xref_id": str(xref.xref_id),
        "object_id": str(xref.entity_id),
        "object_number": objects_map[xref.entity_id].object_number if xref.entity_id in objects_map else None,
        "title": get_display_title(objects_map.get(xref.entity_id)),
        "role": xref.role,
        "role_qualifier": xref.role_qualifier,
        "attribution_certainty": xref.attribution_certainty,
    } for xref in xrefs]

    return {
        "objects": objects,
    }


# ============================================================================
# OTHER NUMBER TYPES - Controlled vocabulary for object numbering
# ============================================================================

@router.get("/api/organizations/{organization_id}/collections/settings/other-number-types", response_model=OtherNumberTypeListResponse, summary="List other number types")
def list_other_number_types(
    organization_id: UUID,
    include_inactive: bool = Query(False),
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """List all other number types for an organization."""
    query = db.query(OtherNumberType).filter(
        OtherNumberType.organization_id == organization_id
    )

    if not include_inactive:
        query = query.filter(OtherNumberType.is_active == True)

    types = query.order_by(OtherNumberType.sort_order, OtherNumberType.name).all()

    return {
        "types": [_serialize_other_number_type(t) for t in types],
        "total": len(types),
    }


@router.post("/api/organizations/{organization_id}/collections/settings/other-number-types", status_code=201, response_model=dict, summary="Create other number type")
def create_other_number_type(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Create a new other number type."""
    user_uuid = auth.user_id

    # Validate required fields
    if not data.get("name") or not data.get("code"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "name and code are required",
        })

    # Check for duplicate code
    existing = db.query(OtherNumberType).filter(
        OtherNumberType.organization_id == organization_id,
        OtherNumberType.code == data["code"].lower().replace(" ", "_")
    ).first()

    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"A type with code '{data['code']}' already exists",
        })

    # Get next sort order
    max_sort = db.query(func.max(OtherNumberType.sort_order)).filter(
        OtherNumberType.organization_id == organization_id
    ).scalar() or 0

    number_type = OtherNumberType(
        organization_id=organization_id,
        name=data["name"],
        code=data["code"].lower().replace(" ", "_"),
        description=data.get("description"),
        sort_order=data.get("sort_order", max_sort + 1),
        is_active=data.get("is_active", True),
        is_system=False,
        created_by=user_uuid,
    )

    try:
        db.add(number_type)
        db.commit()
    except Exception:
        db.rollback()
        raise

    return _serialize_other_number_type(number_type)


@router.put("/api/organizations/{organization_id}/collections/settings/other-number-types/{type_id}", response_model=dict, summary="Update other number type")
def update_other_number_type(
    organization_id: UUID,
    type_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Update an other number type."""
    number_type = db.query(OtherNumberType).filter(
        OtherNumberType.type_id == type_id,
        OtherNumberType.organization_id == organization_id
    ).first()

    if not number_type:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Number type not found",
        })

    # Update allowed fields
    if "name" in data:
        number_type.name = data["name"]
    if "description" in data:
        number_type.description = data["description"]
    if "sort_order" in data:
        number_type.sort_order = data["sort_order"]
    if "is_active" in data:
        number_type.is_active = data["is_active"]

    # Code can only be changed if not a system type
    if "code" in data and not number_type.is_system:
        new_code = data["code"].lower().replace(" ", "_")
        # Check for duplicate
        existing = db.query(OtherNumberType).filter(
            OtherNumberType.organization_id == organization_id,
            OtherNumberType.code == new_code,
            OtherNumberType.type_id != type_id
        ).first()
        if existing:
            raise HTTPException(status_code=409, detail={
                "code": "conflict",
                "message": f"A type with code '{new_code}' already exists",
            })
        number_type.code = new_code

    db.commit()

    return _serialize_other_number_type(number_type)


@router.delete("/api/organizations/{organization_id}/collections/settings/other-number-types/{type_id}", response_model=OtherNumberTypeDeleteResponse, summary="Delete other number type")
def delete_other_number_type(
    organization_id: UUID,
    type_id: UUID,
    force: bool = Query(False),
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Delete an other number type (soft delete by deactivating)."""
    number_type = db.query(OtherNumberType).filter(
        OtherNumberType.type_id == type_id,
        OtherNumberType.organization_id == organization_id
    ).first()

    if not number_type:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Number type not found",
        })

    if number_type.is_system:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Cannot delete system types. You can deactivate them instead.",
        })

    if force:
        # Hard delete
        db.delete(number_type)
    else:
        # Soft delete (deactivate)
        number_type.is_active = False

    db.commit()

    return {"success": True, "deleted": force, "deactivated": not force}
