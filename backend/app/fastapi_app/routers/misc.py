"""
Misc API — FastAPI router.

17 routes covering:
- Lookup values (7 routes) — CRUD for organization dropdown values
- Audit logs (4 routes) — read-only audit log access
- Tasks (6 routes) — CRUD for user tasks
"""

import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import and_, or_, case, select, func, desc
from sqlalchemy.orm import Session, joinedload, selectinload

from app.database import get_db
from app.fastapi_app.dependencies.auth import (
    AuthContext,
    require_auth,
    require_permission,
    require_platform_admin,
)
from app.fastapi_app.schemas.misc import (
    CreateLookupValueBody,
    UpdateLookupValueBody,
    HideValueBody,
    SortOrderBody,
    CreateTaskBody,
    UpdateTaskBody,
    LookupCategoryWithValuesOut,
    LookupValueOut,
    CategoryValuesResponse,
    HideValueResponse,
    SortOrderResponse,
    AuditLogListResponse,
    PlatformAuditLogListResponse,
    EntityAuditEventListResponse,
    EntityAuditEventDetailResponse,
    TaskListResponse,
    TaskEnumsResponse,
    TaskWrapperResponse,
)
from app.fastapi_app.schemas.common import SuccessResponse
from app.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter(tags=["misc"])


# =============================================================================
# Lookup Values — Serializers
# =============================================================================


def _serialize_category(category) -> dict:
    return {
        "category_id": str(category.category_id),
        "category_key": category.category_key,
        "display_name": category.display_name,
        "description": category.description,
        "applicable_contexts": category.applicable_contexts or [],
        "supports_icons": category.supports_icons,
    }


def _serialize_value(value, effective_sort_order=None) -> dict:
    return {
        "value_id": str(value.value_id),
        "category_id": str(value.category_id),
        "organization_id": str(value.organization_id) if value.organization_id else None,
        "value_key": value.value_key,
        "label": value.label,
        "description": value.description,
        "icon_name": value.icon_name,
        "sort_order": effective_sort_order if effective_sort_order is not None else value.sort_order,
        "is_active": value.is_active,
        "is_hidden": value.is_hidden,
        "is_system": value.organization_id is None,
    }


# =============================================================================
# Lookup Values — Routes
# =============================================================================


@router.get("/api/organizations/{org_id}/lookups", response_model=list[LookupCategoryWithValuesOut], summary="List all lookups")
def list_all_lookups(
    org_id: UUID,
    context: str | None = Query(None),
    include_hidden: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.LOOKUPS_VIEW)),
    db: Session = Depends(get_db),
):
    """List all lookups."""
    from app.models import LookupCategory, LookupValue, LookupSortOverride

    categories_query = db.query(LookupCategory)
    if context:
        categories_query = categories_query.filter(
            LookupCategory.applicable_contexts.contains([context])
        )
    categories = categories_query.order_by(LookupCategory.display_name).all()

    result = []
    for category in categories:
        cat_data = _serialize_category(category)

        values_query = db.query(LookupValue).filter(
            LookupValue.category_id == category.category_id,
            or_(
                LookupValue.is_active == True,  # noqa: E712
                and_(
                    LookupValue.organization_id == org_id,
                    LookupValue.is_hidden == True,  # noqa: E712
                ),
            ),
            or_(
                LookupValue.organization_id.is_(None),
                LookupValue.organization_id == org_id,
            ),
        )

        if not include_hidden:
            values_query = values_query.filter(
                or_(
                    LookupValue.organization_id == org_id,
                    and_(
                        LookupValue.organization_id.is_(None),
                        LookupValue.is_hidden == False,  # noqa: E712
                    ),
                )
            )

        values = values_query.all()

        if not include_hidden:
            hidden_keys_query = db.query(LookupValue.value_key).filter(
                LookupValue.category_id == category.category_id,
                LookupValue.organization_id == org_id,
                LookupValue.is_hidden == True,  # noqa: E712
            )
            hidden_keys = {row[0] for row in hidden_keys_query.all()}
            values = [v for v in values if v.organization_id is not None or v.value_key not in hidden_keys]

        # Get org sort overrides
        sort_overrides = {}
        overrides = db.query(LookupSortOverride).filter(
            LookupSortOverride.category_id == category.category_id,
            LookupSortOverride.organization_id == org_id,
        ).all()
        for override in overrides:
            sort_overrides[override.value_id] = override.sort_order

        def get_sort_key(v):
            effective = sort_overrides.get(v.value_id, v.sort_order)
            return (effective, v.label)

        values = sorted(values, key=get_sort_key)

        cat_data["values"] = [
            _serialize_value(v, sort_overrides.get(v.value_id))
            for v in values
        ]
        result.append(cat_data)

    return result


@router.get("/api/organizations/{org_id}/lookups/{category_key}", response_model=CategoryValuesResponse, summary="Get category values")
def get_category_values(
    org_id: UUID,
    category_key: str,
    include_hidden: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.LOOKUPS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get category values."""
    from app.models import LookupCategory, LookupValue

    category = db.query(LookupCategory).filter(
        LookupCategory.category_key == category_key
    ).first()

    if not category:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Category '{category_key}' not found",
        })

    values_query = db.query(LookupValue).filter(
        LookupValue.category_id == category.category_id,
        or_(
            LookupValue.is_active == True,  # noqa: E712
            and_(
                LookupValue.organization_id == org_id,
                LookupValue.is_hidden == True,  # noqa: E712
            ),
        ),
        or_(
            LookupValue.organization_id.is_(None),
            LookupValue.organization_id == org_id,
        ),
    )

    if not include_hidden:
        values_query = values_query.filter(
            or_(
                LookupValue.organization_id == org_id,
                and_(
                    LookupValue.organization_id.is_(None),
                    LookupValue.is_hidden == False,  # noqa: E712
                ),
            )
        )

    values = values_query.order_by(LookupValue.sort_order, LookupValue.label).all()

    if not include_hidden:
        hidden_keys_query = db.query(LookupValue.value_key).filter(
            LookupValue.category_id == category.category_id,
            LookupValue.organization_id == org_id,
            LookupValue.is_hidden == True,  # noqa: E712
        )
        hidden_keys = {row[0] for row in hidden_keys_query.all()}
        values = [v for v in values if v.organization_id is not None or v.value_key not in hidden_keys]

    return {
        "category": _serialize_category(category),
        "values": [_serialize_value(v) for v in values],
    }


@router.post("/api/organizations/{org_id}/lookups/{category_key}", status_code=201, response_model=LookupValueOut, summary="Create lookup value")
def create_lookup_value(
    org_id: UUID,
    category_key: str,
    body: CreateLookupValueBody,
    auth: AuthContext = Depends(require_permission(Permission.LOOKUPS_MANAGE)),
    db: Session = Depends(get_db),
):
    """Create lookup value."""
    from app.models import LookupCategory, LookupValue

    category = db.query(LookupCategory).filter(
        LookupCategory.category_key == category_key
    ).first()

    if not category:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Category '{category_key}' not found",
        })

    # Check duplicate
    existing = db.query(LookupValue).filter(
        LookupValue.category_id == category.category_id,
        LookupValue.organization_id == org_id,
        LookupValue.value_key == body.value_key,
    ).first()

    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"Value key '{body.value_key}' already exists",
        })

    lookup_value = LookupValue(
        category_id=category.category_id,
        organization_id=org_id,
        value_key=body.value_key,
        label=body.label,
        description=body.description,
        icon_name=body.icon_name,
        sort_order=body.sort_order,
        is_active=True,
        is_hidden=False,
    )

    db.add(lookup_value)
    db.commit()

    logger.info("Created lookup value '%s' in category '%s' for org %s", body.value_key, category_key, org_id)

    return _serialize_value(lookup_value)


@router.put("/api/organizations/{org_id}/lookups/values/{value_id}", response_model=LookupValueOut, summary="Update lookup value")
def update_lookup_value(
    org_id: UUID,
    value_id: UUID,
    body: UpdateLookupValueBody,
    auth: AuthContext = Depends(require_permission(Permission.LOOKUPS_MANAGE)),
    db: Session = Depends(get_db),
):
    """Update lookup value."""
    from app.models import LookupValue

    lookup_value = db.query(LookupValue).filter(
        LookupValue.value_id == value_id,
    ).first()

    if not lookup_value:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Lookup value not found",
        })

    if lookup_value.organization_id is None:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Cannot modify system default values. Use the hide endpoint instead.",
        })

    if lookup_value.organization_id != org_id:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Cannot modify another organization's values",
        })

    if body.label is not None:
        lookup_value.label = body.label
    if body.description is not None:
        lookup_value.description = body.description
    if body.icon_name is not None:
        lookup_value.icon_name = body.icon_name
    if body.sort_order is not None:
        lookup_value.sort_order = body.sort_order
    if body.is_active is not None:
        lookup_value.is_active = body.is_active

    db.commit()

    logger.info("Updated lookup value %s for org %s", value_id, org_id)

    return _serialize_value(lookup_value)


@router.delete("/api/organizations/{org_id}/lookups/values/{value_id}", status_code=204, summary="Delete lookup value")
def delete_lookup_value(
    org_id: UUID,
    value_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.LOOKUPS_MANAGE)),
    db: Session = Depends(get_db),
):
    """Delete lookup value."""
    from app.models import LookupValue

    lookup_value = db.query(LookupValue).filter(
        LookupValue.value_id == value_id,
    ).first()

    if not lookup_value:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Lookup value not found",
        })

    if lookup_value.organization_id is None:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Cannot delete system default values. Use the hide endpoint instead.",
        })

    if lookup_value.organization_id != org_id:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Cannot delete another organization's values",
        })

    db.delete(lookup_value)
    db.commit()

    logger.info("Deleted lookup value %s for org %s", value_id, org_id)


@router.put("/api/organizations/{org_id}/lookups/values/{value_id}/hide", response_model=HideValueResponse, summary="Toggle hide value")
def toggle_hide_value(
    org_id: UUID,
    value_id: UUID,
    body: HideValueBody,
    auth: AuthContext = Depends(require_permission(Permission.LOOKUPS_MANAGE)),
    db: Session = Depends(get_db),
):
    """Toggle hide value."""
    from app.models import LookupValue

    lookup_value = db.query(LookupValue).options(
        joinedload(LookupValue.category)
    ).filter(
        LookupValue.value_id == value_id,
    ).first()

    if not lookup_value:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Lookup value not found",
        })

    if lookup_value.organization_id is not None:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Only system default values can be hidden. Delete org-specific values instead.",
        })

    # Check for existing hide override
    org_override = db.query(LookupValue).filter(
        LookupValue.category_id == lookup_value.category_id,
        LookupValue.organization_id == org_id,
        LookupValue.value_key == lookup_value.value_key,
        LookupValue.is_hidden == True,  # noqa: E712
    ).first()

    if body.hidden:
        if org_override:
            return {"message": "Value already hidden", "hidden": True}

        hide_record = LookupValue(
            category_id=lookup_value.category_id,
            organization_id=org_id,
            value_key=lookup_value.value_key,
            label=lookup_value.label,
            description="Hidden override for system default",
            sort_order=lookup_value.sort_order,
            is_active=True,
            is_hidden=True,
        )
        db.add(hide_record)
        db.commit()

        logger.info("Hidden system default '%s' for org %s", lookup_value.value_key, org_id)
        return {"message": "Value hidden", "hidden": True}
    else:
        if not org_override:
            return {"message": "Value not hidden", "hidden": False}

        db.delete(org_override)
        db.commit()

        logger.info("Unhidden system default '%s' for org %s", lookup_value.value_key, org_id)
        return {"message": "Value unhidden", "hidden": False}


@router.put("/api/organizations/{org_id}/lookups/{category_key}/sort", response_model=SortOrderResponse, summary="Update category sort order")
def update_category_sort_order(
    org_id: UUID,
    category_key: str,
    body: SortOrderBody,
    auth: AuthContext = Depends(require_permission(Permission.LOOKUPS_MANAGE)),
    db: Session = Depends(get_db),
):
    """Update category sort order."""
    from app.models import LookupCategory, LookupValue, LookupSortOverride

    category = db.query(LookupCategory).filter(
        LookupCategory.category_key == category_key
    ).first()

    if not category:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"Category '{category_key}' not found",
        })

    # Delete existing overrides
    db.query(LookupSortOverride).filter(
        LookupSortOverride.organization_id == org_id,
        LookupSortOverride.category_id == category.category_id,
    ).delete()

    # Create new overrides
    for sort_order, vid in enumerate(body.value_ids):
        try:
            value_uuid = UUID(vid)
        except (ValueError, TypeError):
            continue

        value = db.query(LookupValue).filter(
            LookupValue.value_id == value_uuid,
            LookupValue.category_id == category.category_id,
        ).first()

        if value:
            override = LookupSortOverride(
                organization_id=org_id,
                category_id=category.category_id,
                value_id=value_uuid,
                sort_order=sort_order,
            )
            db.add(override)

    db.commit()

    logger.info("Updated sort order for category '%s' for org %s", category_key, org_id)
    return {"message": "Sort order updated", "count": len(body.value_ids)}


# =============================================================================
# Audit Logs
# =============================================================================


@router.get("/api/organizations/{org_id}/audit-logs", response_model=AuditLogListResponse, summary="Get audit logs")
def get_audit_logs(
    org_id: UUID,
    action: str | None = Query(None),
    target_user_id: str | None = Query(None),
    acting_user_id: str | None = Query(None),
    since: str | None = Query(None),
    until: str | None = Query(None),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """Get audit logs."""
    from app.services import audit_service

    valid_actions = ["user.invited", "user.role_changed", "user.deactivated", "user.reactivated"]
    if action and action not in valid_actions:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": f"Invalid action. Must be one of: {', '.join(valid_actions)}",
            "field": "action",
        })

    since_dt = None
    until_dt = None

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Invalid 'since' date format. Use ISO 8601.",
                "field": "since",
            })

    if until:
        try:
            until_dt = datetime.fromisoformat(until.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Invalid 'until' date format. Use ISO 8601.",
                "field": "until",
            })

    audit_logs, total_count = audit_service.query_audit_logs(
        session=db,
        organization_id=org_id,
        action=action,
        target_user_id=target_user_id,
        acting_user_id=acting_user_id,
        since=since_dt,
        until=until_dt,
        limit=limit,
        offset=offset,
    )

    logs_data = [
        {
            "audit_log_id": str(log.audit_log_id),
            "organization_id": str(log.organization_id),
            "acting_user_id": str(log.acting_user_id),
            "target_user_id": str(log.target_user_id) if log.target_user_id else None,
            "action": log.action,
            "details": log.details,
            "created_at": log.created_at.isoformat(),
        }
        for log in audit_logs
    ]

    has_more = (offset + limit) < total_count

    return {
        "items": logs_data,
        "total": total_count,
        "page": {
            "limit": limit,
            "offset": offset,
            "has_more": has_more,
        },
    }


@router.get("/api/platform/audit-logs", response_model=PlatformAuditLogListResponse, summary="Get platform audit logs")
def get_platform_audit_logs(
    organization_id: str | None = Query(None),
    action: str | None = Query(None),
    since: str | None = Query(None),
    until: str | None = Query(None),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_platform_admin),
    db: Session = Depends(get_db),
):
    """Get platform audit logs."""
    from app.services import audit_service

    valid_actions = ["user.invited", "user.role_changed", "user.deactivated", "user.reactivated"]
    if action and action not in valid_actions:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": f"Invalid action. Must be one of: {', '.join(valid_actions)}",
            "field": "action",
        })

    since_dt = None
    until_dt = None

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Invalid 'since' date format. Use ISO 8601.",
                "field": "since",
            })

    if until:
        try:
            until_dt = datetime.fromisoformat(until.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Invalid 'until' date format. Use ISO 8601.",
                "field": "until",
            })

    org_uuid = None
    if organization_id:
        try:
            org_uuid = UUID(organization_id)
        except ValueError:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Invalid organization_id format",
                "field": "organization_id",
            })

    audit_logs, total_count = audit_service.query_audit_logs(
        session=db,
        organization_id=org_uuid,
        action=action,
        since=since_dt,
        until=until_dt,
        limit=limit,
        offset=offset,
    )

    logs_data = [
        {
            "audit_log_id": str(log.audit_log_id),
            "organization_id": str(log.organization_id),
            "organization_name": log.organization.name if log.organization else None,
            "acting_user_id": str(log.acting_user_id),
            "acting_user_email": log.acting_user.email if log.acting_user else None,
            "target_user_id": str(log.target_user_id) if log.target_user_id else None,
            "action": log.action,
            "details": log.details,
            "created_at": log.created_at.isoformat(),
        }
        for log in audit_logs
    ]

    has_more = (offset + limit) < total_count

    return {
        "items": logs_data,
        "total": total_count,
        "page": {
            "limit": limit,
            "offset": offset,
            "has_more": has_more,
        },
    }


@router.get("/api/organizations/{org_id}/entity-audit-events", response_model=EntityAuditEventListResponse, summary="Get entity audit events")
def get_entity_audit_events(
    org_id: UUID,
    entity_type: str | None = Query(None),
    change_type: str | None = Query(None),
    changed_by: str | None = Query(None),
    since: str | None = Query(None),
    until: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """Get entity audit events."""
    from app.models import EntityAuditEvent

    valid_change_types = ("created", "updated", "deleted", "link_added", "link_removed", "link_updated")
    if change_type and change_type not in valid_change_types:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": f"Invalid change_type. Must be one of: {', '.join(valid_change_types)}",
            "field": "change_type",
        })

    query = db.query(EntityAuditEvent).filter(
        EntityAuditEvent.organization_id == org_id
    )

    if entity_type:
        query = query.filter(EntityAuditEvent.entity_type == entity_type)
    if change_type:
        query = query.filter(EntityAuditEvent.change_type == change_type)
    if changed_by:
        query = query.filter(EntityAuditEvent.changed_by == changed_by)

    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            query = query.filter(EntityAuditEvent.changed_at >= since_dt)
        except ValueError:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Invalid 'since' date format. Use ISO 8601.",
                "field": "since",
            })

    if until:
        try:
            until_dt = datetime.fromisoformat(until.replace("Z", "+00:00"))
            query = query.filter(EntityAuditEvent.changed_at <= until_dt)
        except ValueError:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Invalid 'until' date format. Use ISO 8601.",
                "field": "until",
            })

    total = query.count()

    events = (
        query
        .order_by(desc(EntityAuditEvent.changed_at))
        .limit(limit)
        .offset(offset)
        .all()
    )

    return {
        "items": [
            {
                "event_id": str(e.event_id),
                "organization_id": str(e.organization_id),
                "entity_type": e.entity_type,
                "entity_id": str(e.entity_id),
                "entity_display_key": e.entity_display_key,
                "change_type": e.change_type,
                "changed_at": e.changed_at.isoformat() if e.changed_at else None,
                "changed_by": str(e.changed_by) if e.changed_by else None,
                "changed_by_name": e.changed_by_name,
                "changed_by_email": e.changed_by_email,
                "changed_fields": e.changed_fields,
                "summary": e.summary,
            }
            for e in events
        ],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{org_id}/entity-audit-events/{event_id}", response_model=EntityAuditEventDetailResponse, summary="Get entity audit event detail")
def get_entity_audit_event_detail(
    org_id: UUID,
    event_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_VIEW_AUDIT_LOGS)),
    db: Session = Depends(get_db),
):
    """Get entity audit event detail."""
    from app.models import EntityAuditEvent, EntityAuditFieldDiff

    event = (
        db.query(EntityAuditEvent)
        .filter_by(event_id=event_id, organization_id=org_id)
        .first()
    )

    if not event:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Event not found",
        })

    diffs = (
        db.query(EntityAuditFieldDiff)
        .filter_by(event_id=event_id)
        .order_by(EntityAuditFieldDiff.field_name)
        .all()
    )

    return {
        "event": {
            "event_id": str(event.event_id),
            "organization_id": str(event.organization_id),
            "entity_type": event.entity_type,
            "entity_id": str(event.entity_id),
            "entity_display_key": event.entity_display_key,
            "change_type": event.change_type,
            "changed_at": event.changed_at.isoformat() if event.changed_at else None,
            "changed_by": str(event.changed_by) if event.changed_by else None,
            "changed_by_name": event.changed_by_name,
            "changed_by_email": event.changed_by_email,
            "changed_fields": event.changed_fields,
            "summary": event.summary,
            "field_diffs": [
                {
                    "diff_id": str(d.diff_id),
                    "field_name": d.field_name,
                    "old_value": d.old_value,
                    "new_value": d.new_value,
                }
                for d in diffs
            ],
        },
    }


# =============================================================================
# Tasks — Helpers
# =============================================================================


def _parse_uuid(value: str | None) -> UUID | None:
    if not value:
        return None
    try:
        return UUID(value)
    except (ValueError, TypeError):
        return None


def _get_related_entity_label(entity_type: str | None, entity_id: UUID | None, db: Session) -> str | None:
    if not entity_type or not entity_id:
        return None
    try:
        if entity_type == "exhibition":
            from app.models import Exhibition
            exhibition = db.get(Exhibition, entity_id)
            if exhibition:
                return exhibition.title
        elif entity_type == "collection_object":
            from app.models import CollectionObject
            obj = db.get(CollectionObject, entity_id)
            if obj:
                return obj.object_number or obj.object_name or "Untitled Object"
    except Exception:
        pass
    return None


def _get_actor_name(db: Session, user_id: UUID) -> str:
    from app.models import User
    user = db.get(User, user_id)
    return user.display_name or user.email if user else "Someone"


def _serialize_task(task, db: Session) -> dict:
    from app.models import TaskStatus, TaskPriority

    data = {
        "task_id": str(task.task_id),
        "organization_id": str(task.organization_id),
        "title": task.title,
        "description": task.description,
        "status": task.status,
        "status_label": TaskStatus.LABELS.get(task.status, task.status),
        "priority": task.priority,
        "priority_label": TaskPriority.LABELS.get(task.priority, task.priority),
        "assigned_user_id": str(task.assigned_user_id) if task.assigned_user_id else None,
        "due_date": task.due_date.isoformat() if task.due_date else None,
        "created_at": task.created_at.isoformat() if task.created_at else None,
        "updated_at": task.updated_at.isoformat() if task.updated_at else None,
        "completed_at": task.completed_at.isoformat() if task.completed_at else None,
        "created_by": str(task.created_by) if task.created_by else None,
        "completed_by": str(task.completed_by) if task.completed_by else None,
        "app_context": task.app_context,
        "related_entity_type": task.related_entity_type,
        "related_entity_id": str(task.related_entity_id) if task.related_entity_id else None,
        "related_entity_label": _get_related_entity_label(task.related_entity_type, task.related_entity_id, db),
    }

    if task.assigned_user:
        data["assigned_user_name"] = task.assigned_user.display_name or task.assigned_user.email
    else:
        data["assigned_user_name"] = None

    if task.creator:
        data["created_by_name"] = task.creator.display_name or task.creator.email
    else:
        data["created_by_name"] = None

    return data


# =============================================================================
# Tasks — Routes
# =============================================================================


@router.get("/api/organizations/{org_id}/tasks", response_model=TaskListResponse, summary="List tasks")
def list_tasks(
    org_id: UUID,
    assigned_user_id: str | None = Query(None),
    status: str | None = Query(None),
    priority: str | None = Query(None),
    include_completed: bool = Query(False),
    due_before: str | None = Query(None),
    due_after: str | None = Query(None),
    app_context: str | None = Query(None),
    related_entity_type: str | None = Query(None),
    related_entity_id: str | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    auth: AuthContext = Depends(require_permission("tasks.view")),
    db: Session = Depends(get_db),
):
    """List tasks."""
    from app.models import Task, TaskStatus, TaskPriority

    query = select(Task).where(Task.organization_id == org_id)

    if assigned_user_id:
        assigned_uuid = _parse_uuid(assigned_user_id)
        if assigned_uuid:
            query = query.where(Task.assigned_user_id == assigned_uuid)

    if status:
        statuses = [s.strip() for s in status.split(",") if s.strip() in TaskStatus.ALL]
        if statuses:
            query = query.where(Task.status.in_(statuses))

    if not include_completed and not status:
        query = query.where(Task.status != TaskStatus.DONE)

    if priority:
        priorities = [p.strip() for p in priority.split(",") if p.strip() in TaskPriority.ALL]
        if priorities:
            query = query.where(Task.priority.in_(priorities))

    if due_before:
        try:
            due_date = datetime.fromisoformat(due_before.replace("Z", "+00:00")).date()
            query = query.where(Task.due_date <= due_date)
        except ValueError:
            pass

    if due_after:
        try:
            due_date = datetime.fromisoformat(due_after.replace("Z", "+00:00")).date()
            query = query.where(Task.due_date >= due_date)
        except ValueError:
            pass

    if app_context:
        query = query.where(Task.app_context == app_context)

    if related_entity_type:
        query = query.where(Task.related_entity_type == related_entity_type)

    if related_entity_id:
        r_uuid = _parse_uuid(related_entity_id)
        if r_uuid:
            query = query.where(Task.related_entity_id == r_uuid)

    count_query = select(func.count()).select_from(query.subquery())
    total = db.execute(count_query).scalar() or 0

    priority_order = case(
        (Task.priority == "urgent", 0),
        (Task.priority == "high", 1),
        (Task.priority == "normal", 2),
        (Task.priority == "low", 3),
        else_=4,
    )
    query = query.order_by(
        priority_order,
        Task.due_date.asc().nullslast(),
        Task.created_at.desc(),
    )

    query = query.options(
        selectinload(Task.assigned_user),
        selectinload(Task.creator),
    ).limit(limit).offset(offset)

    tasks = db.execute(query).scalars().all()

    return {
        "items": [_serialize_task(t, db) for t in tasks],
        "total": total,
        "limit": limit,
        "offset": offset,
    }


@router.get("/api/organizations/{org_id}/tasks/enums", response_model=TaskEnumsResponse, summary="Get task enums")
def get_task_enums(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission("tasks.view")),
    db: Session = Depends(get_db),
):
    """Get task enums."""
    from app.models import TaskStatus, TaskPriority, RelatedEntityType

    return {
        "statuses": [{"value": s, "label": TaskStatus.LABELS[s]} for s in TaskStatus.ALL],
        "priorities": [{"value": p, "label": TaskPriority.LABELS[p]} for p in TaskPriority.ALL],
        "related_entity_types": RelatedEntityType.ALL,
    }


@router.get("/api/organizations/{org_id}/tasks/{task_id}", response_model=TaskWrapperResponse, summary="Get task")
def get_task(
    org_id: UUID,
    task_id: UUID,
    auth: AuthContext = Depends(require_permission("tasks.view")),
    db: Session = Depends(get_db),
):
    """Get task."""
    from app.models import Task

    task = db.execute(
        select(Task)
        .where(Task.task_id == task_id, Task.organization_id == org_id)
        .options(selectinload(Task.assigned_user), selectinload(Task.creator))
    ).scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Task not found",
        })

    return {"task": _serialize_task(task, db)}


@router.post("/api/organizations/{org_id}/tasks", status_code=201, response_model=TaskWrapperResponse, summary="Create task")
def create_task(
    org_id: UUID,
    body: CreateTaskBody,
    auth: AuthContext = Depends(require_permission("tasks.create")),
    db: Session = Depends(get_db),
):
    """Create task."""
    from app.models import Task, TaskStatus, TaskPriority, RelatedEntityType
    from app.services.entity_notifications import notify_task_event

    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Title is required",
        })

    if body.status not in TaskStatus.ALL:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid status. Must be one of: {', '.join(TaskStatus.ALL)}",
        })

    if body.priority not in TaskPriority.ALL:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid priority. Must be one of: {', '.join(TaskPriority.ALL)}",
        })

    assigned_user_id = None
    if body.assigned_user_id:
        assigned_user_id = _parse_uuid(body.assigned_user_id)
        if not assigned_user_id:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Invalid assigned_user_id",
            })

    due_date = None
    if body.due_date:
        try:
            due_date = datetime.fromisoformat(body.due_date.replace("Z", "+00:00")).date()
        except ValueError:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Invalid due_date format",
            })

    related_entity_type = body.related_entity_type
    related_entity_id = None
    if related_entity_type:
        if related_entity_type not in RelatedEntityType.ALL:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Invalid related_entity_type",
            })
        if body.related_entity_id:
            related_entity_id = _parse_uuid(body.related_entity_id)

    task = Task(
        organization_id=org_id,
        title=title,
        description=body.description,
        status=body.status,
        priority=body.priority,
        assigned_user_id=assigned_user_id,
        due_date=due_date,
        created_by=auth.user_id,
        app_context=body.app_context,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
    )

    if body.status == TaskStatus.DONE:
        task.completed_at = datetime.now(timezone.utc)
        task.completed_by = auth.user_id

    db.add(task)
    db.commit()

    # Notify assignee
    if task.assigned_user_id and task.assigned_user_id != auth.user_id:
        actor_name = _get_actor_name(db, auth.user_id)
        notify_task_event(
            org_id=org_id,
            user_id=task.assigned_user_id,
            notification_type="task_assigned",
            title=f"{actor_name} assigned you a task: {task.title}",
            task_id=task.task_id,
            app_context=task.app_context,
        )

    # Reload with relationships
    task = db.execute(
        select(Task)
        .where(Task.task_id == task.task_id)
        .options(selectinload(Task.assigned_user), selectinload(Task.creator))
    ).scalar_one()

    return {"task": _serialize_task(task, db)}


@router.patch("/api/organizations/{org_id}/tasks/{task_id}", response_model=TaskWrapperResponse, summary="Update task")
def update_task(
    org_id: UUID,
    task_id: UUID,
    body: UpdateTaskBody,
    auth: AuthContext = Depends(require_permission("tasks.edit")),
    db: Session = Depends(get_db),
):
    """Update task."""
    from app.models import Task, TaskStatus, TaskPriority, RelatedEntityType
    from app.services.entity_notifications import notify_task_event

    task = db.execute(
        select(Task)
        .where(Task.task_id == task_id, Task.organization_id == org_id)
    ).scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Task not found",
        })

    data = body.model_dump(exclude_unset=True)

    old_assigned_user_id = task.assigned_user_id
    old_status = task.status

    if "title" in data:
        title = data["title"].strip() if data["title"] else ""
        if not title:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Title cannot be empty",
            })
        if len(title) > 255:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Title must be 255 characters or less",
            })
        task.title = title

    if "description" in data:
        task.description = data["description"]

    if "status" in data:
        new_status = data["status"]
        if new_status not in TaskStatus.ALL:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Invalid status",
            })
        old_status = task.status
        task.status = new_status

        if new_status == TaskStatus.DONE and old_status != TaskStatus.DONE:
            task.completed_at = datetime.now(timezone.utc)
            task.completed_by = auth.user_id
        elif new_status != TaskStatus.DONE and old_status == TaskStatus.DONE:
            task.completed_at = None
            task.completed_by = None

    if "priority" in data:
        if data["priority"] not in TaskPriority.ALL:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Invalid priority",
            })
        task.priority = data["priority"]

    if "assigned_user_id" in data:
        if data["assigned_user_id"]:
            assigned_uuid = _parse_uuid(data["assigned_user_id"])
            if not assigned_uuid:
                raise HTTPException(status_code=400, detail={
                    "code": "bad_request",
                    "message": "Invalid assigned_user_id",
                })
            task.assigned_user_id = assigned_uuid
        else:
            task.assigned_user_id = None

    if "due_date" in data:
        if data["due_date"]:
            try:
                task.due_date = datetime.fromisoformat(data["due_date"].replace("Z", "+00:00")).date()
            except ValueError:
                raise HTTPException(status_code=400, detail={
                    "code": "bad_request",
                    "message": "Invalid due_date format",
                })
        else:
            task.due_date = None

    if "related_entity_type" in data:
        if data["related_entity_type"]:
            if data["related_entity_type"] not in RelatedEntityType.ALL:
                raise HTTPException(status_code=400, detail={
                    "code": "bad_request",
                    "message": "Invalid related_entity_type",
                })
            task.related_entity_type = data["related_entity_type"]
        else:
            task.related_entity_type = None

    if "related_entity_id" in data:
        if data["related_entity_id"]:
            task.related_entity_id = _parse_uuid(data["related_entity_id"])
        else:
            task.related_entity_id = None

    task.updated_at = datetime.now(timezone.utc)
    db.commit()

    # Notifications
    current_user_id = str(auth.user_id)
    actor_name = None

    if "assigned_user_id" in data:
        new_assigned = task.assigned_user_id
        if str(old_assigned_user_id or "") != str(new_assigned or ""):
            actor_name = actor_name or _get_actor_name(db, auth.user_id)
            if new_assigned and str(new_assigned) != current_user_id:
                notify_task_event(
                    org_id=org_id,
                    user_id=new_assigned,
                    notification_type="task_assigned",
                    title=f"{actor_name} assigned you a task: {task.title}",
                    task_id=task.task_id,
                    app_context=task.app_context,
                )
            if old_assigned_user_id and str(old_assigned_user_id) != current_user_id:
                msg = (
                    f"{actor_name} reassigned your task: {task.title}"
                    if new_assigned
                    else f"{actor_name} unassigned you from task: {task.title}"
                )
                notify_task_event(
                    org_id=org_id,
                    user_id=old_assigned_user_id,
                    notification_type="task_unassigned",
                    title=msg,
                    task_id=task.task_id,
                    app_context=task.app_context,
                )
    elif "status" in data and task.status != old_status:
        assignee = task.assigned_user_id
        if assignee and str(assignee) != current_user_id:
            actor_name = actor_name or _get_actor_name(db, auth.user_id)
            status_label = TaskStatus.LABELS.get(task.status, task.status)
            notify_task_event(
                org_id=org_id,
                user_id=assignee,
                notification_type="task_updated",
                title=f"{actor_name} updated task status to {status_label}: {task.title}",
                task_id=task.task_id,
                app_context=task.app_context,
            )
    elif any(k in data for k in ("title", "priority", "due_date", "description")):
        assignee = task.assigned_user_id
        if assignee and str(assignee) != current_user_id:
            actor_name = actor_name or _get_actor_name(db, auth.user_id)
            notify_task_event(
                org_id=org_id,
                user_id=assignee,
                notification_type="task_updated",
                title=f"{actor_name} updated task: {task.title}",
                task_id=task.task_id,
                app_context=task.app_context,
            )

    # Reload with relationships
    task = db.execute(
        select(Task)
        .where(Task.task_id == task.task_id)
        .options(selectinload(Task.assigned_user), selectinload(Task.creator))
    ).scalar_one()

    return {"task": _serialize_task(task, db)}


@router.delete("/api/organizations/{org_id}/tasks/{task_id}", response_model=SuccessResponse, summary="Delete task")
def delete_task(
    org_id: UUID,
    task_id: UUID,
    auth: AuthContext = Depends(require_permission("tasks.delete")),
    db: Session = Depends(get_db),
):
    """Delete task."""
    from app.models import Task
    from app.services.entity_notifications import notify_task_event

    task = db.execute(
        select(Task)
        .where(Task.task_id == task_id, Task.organization_id == org_id)
    ).scalar_one_or_none()

    if not task:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Task not found",
        })

    if task.created_by and task.created_by != auth.user_id:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Only the task creator can delete this task",
        })

    task_title = task.title
    task_assigned = task.assigned_user_id
    task_id_val = task.task_id
    task_app_context = task.app_context

    db.delete(task)
    db.commit()

    if task_assigned and task_assigned != auth.user_id:
        actor_name = _get_actor_name(db, auth.user_id)
        notify_task_event(
            org_id=org_id,
            user_id=task_assigned,
            notification_type="task_deleted",
            title=f"{actor_name} deleted task: {task_title}",
            task_id=task_id_val,
            app_context=task_app_context,
        )

    return {"success": True}
