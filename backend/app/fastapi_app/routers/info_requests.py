"""
Info Requests API endpoints (FastAPI).

17 routes:
  - Templates (5): list, create, get, update, delete
  - Template Items (3): add, update, delete
  - Exhibition Info Requests (5): list, create, get, update, delete
  - Documents (2): add, remove
  - Enums (1)
  - Summary (1)

Migrated from app/api/info_requests.py.
"""

import logging
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy import select, func
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    InfoRequestTemplate,
    InfoRequestTemplateItem,
    ExhibitionInfoRequest,
    InfoRequestDocument,
    InfoRequestType,
    InfoRequestStatus,
    InfoRequestSourceParty,
    Exhibition,
)
from app.permissions import Permission
from app.services.entity_notifications import notify_status_change
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.info_requests import (
    TemplateListResponse,
    TemplateResponse,
    TemplateItemResponse,
    InfoRequestSummary,
    InfoRequestListResponse,
    InfoRequestResponse,
    InfoRequestBulkCreateResponse,
    InfoRequestDocumentResponse,
    InfoRequestEnumsResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["info-requests"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_template(template: InfoRequestTemplate, include_items: bool = False) -> dict:
    data = {
        "template_id": str(template.template_id),
        "name": template.name,
        "description": template.description,
        "exhibition_type": template.exhibition_type,
        "is_archived": template.is_archived,
        "item_count": len(template.items) if template.items else 0,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "created_by": str(template.created_by) if template.created_by else None,
    }
    if include_items:
        data["items"] = [
            _serialize_template_item(i)
            for i in sorted(template.items, key=lambda x: x.sort_order)
        ]
    return data


def _serialize_template_item(item: InfoRequestTemplateItem) -> dict:
    return {
        "template_item_id": str(item.template_item_id),
        "request_type": item.request_type,
        "request_type_label": InfoRequestType.LABELS.get(item.request_type, item.request_type),
        "title": item.title,
        "description": item.description,
        "default_source_party": item.default_source_party,
        "default_due_offset_days": item.default_due_offset_days,
        "is_required": item.is_required,
        "sort_order": item.sort_order,
    }


def _serialize_info_request(req: ExhibitionInfoRequest) -> dict:
    return {
        "request_id": str(req.request_id),
        "exhibition_id": str(req.exhibition_id),
        "source_template_item_id": str(req.source_template_item_id) if req.source_template_item_id else None,
        "request_type": req.request_type,
        "request_type_label": InfoRequestType.LABELS.get(req.request_type, req.request_type),
        "title": req.title,
        "description": req.description,
        "status": req.status,
        "status_label": InfoRequestStatus.LABELS.get(req.status, req.status),
        "source_party": req.source_party,
        "due_date": req.due_date.isoformat() if req.due_date else None,
        "notes": req.notes,
        "is_required": req.is_required,
        "sort_order": req.sort_order,
        "received_at": req.received_at.isoformat() if req.received_at else None,
        "received_by": str(req.received_by) if req.received_by else None,
        "approved_at": req.approved_at.isoformat() if req.approved_at else None,
        "approved_by": str(req.approved_by) if req.approved_by else None,
        "documents": [_serialize_document(d) for d in req.documents] if req.documents else [],
        "document_count": len(req.documents) if req.documents else 0,
        "created_at": req.created_at.isoformat() if req.created_at else None,
        "updated_at": req.updated_at.isoformat() if req.updated_at else None,
    }


def _serialize_document(doc: InfoRequestDocument) -> dict:
    return {
        "link_id": str(doc.link_id),
        "media_id": str(doc.media_id),
        "label": doc.label,
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
    }


# ============================================================================
# TEMPLATE ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/exhibit/info-request-templates", response_model=TemplateListResponse, summary="List templates")
def list_templates(
    org_id: UUID,
    include_archived: bool = Query(False),
    exhibition_type: str = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List all info request templates for an organization."""
    query = select(InfoRequestTemplate).where(
        InfoRequestTemplate.organization_id == org_id
    ).options(selectinload(InfoRequestTemplate.items))

    if not include_archived:
        query = query.where(InfoRequestTemplate.is_archived == False)  # noqa: E712

    if exhibition_type:
        query = query.where(InfoRequestTemplate.exhibition_type == exhibition_type)

    query = query.order_by(InfoRequestTemplate.name)
    templates = db.execute(query).scalars().all()

    return {"templates": [_serialize_template(t, include_items=False) for t in templates]}


@router.post("/api/organizations/{org_id}/exhibit/info-request-templates", response_model=TemplateResponse, status_code=201, summary="Create template")
def create_template(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create a new info request template."""
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    template = InfoRequestTemplate(
        organization_id=org_id,
        name=name,
        description=body.get("description"),
        exhibition_type=body.get("exhibition_type", "general"),
        created_by=auth.user_id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(template)
    db.commit()

    return {"template": _serialize_template(template, include_items=True)}


@router.get("/api/organizations/{org_id}/exhibit/info-request-templates/{template_id}", response_model=TemplateResponse, summary="Get template")
def get_template(
    org_id: UUID,
    template_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get an info request template with items."""
    template = db.execute(
        select(InfoRequestTemplate)
        .where(
            InfoRequestTemplate.template_id == template_id,
            InfoRequestTemplate.organization_id == org_id,
        )
        .options(selectinload(InfoRequestTemplate.items))
    ).scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    return {"template": _serialize_template(template, include_items=True)}


@router.patch("/api/organizations/{org_id}/exhibit/info-request-templates/{template_id}", response_model=TemplateResponse, summary="Update template")
def update_template(
    org_id: UUID,
    template_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update template metadata."""
    template = db.execute(
        select(InfoRequestTemplate)
        .where(
            InfoRequestTemplate.template_id == template_id,
            InfoRequestTemplate.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if "name" in body:
        name = body["name"].strip()
        if not name:
            raise HTTPException(status_code=400, detail="Name cannot be empty")
        template.name = name

    if "description" in body:
        template.description = body["description"]
    if "exhibition_type" in body:
        template.exhibition_type = body["exhibition_type"]
    if "is_archived" in body:
        template.is_archived = bool(body["is_archived"])

    template.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"template": _serialize_template(template, include_items=True)}


@router.delete("/api/organizations/{org_id}/exhibit/info-request-templates/{template_id}", response_model=SuccessResponse, summary="Delete template")
def delete_template(
    org_id: UUID,
    template_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a template."""
    template = db.execute(
        select(InfoRequestTemplate)
        .where(
            InfoRequestTemplate.template_id == template_id,
            InfoRequestTemplate.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    db.delete(template)
    db.commit()

    return {"success": True}


# ============================================================================
# TEMPLATE ITEM ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{org_id}/exhibit/info-request-templates/{template_id}/items", response_model=TemplateItemResponse, status_code=201, summary="Add template item")
def add_template_item(
    org_id: UUID,
    template_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Add an item to a template."""
    template = db.execute(
        select(InfoRequestTemplate)
        .where(
            InfoRequestTemplate.template_id == template_id,
            InfoRequestTemplate.organization_id == org_id,
        )
        .options(selectinload(InfoRequestTemplate.items))
    ).scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    request_type = body.get("request_type")
    if request_type not in InfoRequestType.ALL:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid request_type. Must be one of: {', '.join(InfoRequestType.ALL)}",
        )

    max_sort = max([i.sort_order for i in template.items], default=-1)

    item = InfoRequestTemplateItem(
        template_id=template.template_id,
        request_type=request_type,
        title=title,
        description=body.get("description"),
        default_source_party=body.get("default_source_party"),
        default_due_offset_days=body.get("default_due_offset_days"),
        is_required=body.get("is_required", True),
        sort_order=body.get("sort_order", max_sort + 1),
        created_at=datetime.now(timezone.utc),
    )
    db.add(item)
    db.commit()

    return {"item": _serialize_template_item(item)}


@router.patch(
    "/api/organizations/{org_id}/exhibit/info-request-templates/{template_id}/items/{item_id}",
    response_model=TemplateItemResponse, summary="Update template item")
def update_template_item(
    org_id: UUID,
    template_id: UUID,
    item_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a template item."""
    item = db.execute(
        select(InfoRequestTemplateItem)
        .join(InfoRequestTemplate)
        .where(
            InfoRequestTemplateItem.template_item_id == item_id,
            InfoRequestTemplate.template_id == template_id,
            InfoRequestTemplate.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if "title" in body:
        title = body["title"].strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        item.title = title

    if "description" in body:
        item.description = body["description"]
    if "request_type" in body:
        if body["request_type"] not in InfoRequestType.ALL:
            raise HTTPException(status_code=400, detail="Invalid request_type")
        item.request_type = body["request_type"]
    if "default_source_party" in body:
        item.default_source_party = body["default_source_party"]
    if "default_due_offset_days" in body:
        item.default_due_offset_days = body["default_due_offset_days"]
    if "is_required" in body:
        item.is_required = bool(body["is_required"])
    if "sort_order" in body:
        item.sort_order = body["sort_order"]

    db.commit()

    return {"item": _serialize_template_item(item)}


@router.delete(
    "/api/organizations/{org_id}/exhibit/info-request-templates/{template_id}/items/{item_id}",
    response_model=SuccessResponse, summary="Delete template item")
def delete_template_item(
    org_id: UUID,
    template_id: UUID,
    item_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete a template item."""
    item = db.execute(
        select(InfoRequestTemplateItem)
        .join(InfoRequestTemplate)
        .where(
            InfoRequestTemplateItem.template_item_id == item_id,
            InfoRequestTemplate.template_id == template_id,
            InfoRequestTemplate.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    db.delete(item)
    db.commit()

    return {"success": True}


# ============================================================================
# EXHIBITION INFO REQUEST ENDPOINTS
# ============================================================================


# Static "summary" route BEFORE parameterized "{request_id}" routes
@router.get(
    "/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/info-requests/summary",
    response_model=InfoRequestSummary, summary="Get summary")
def get_summary(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get summary stats for info requests (for exhibition overview card)."""
    exhibition = db.execute(
        select(Exhibition)
        .where(Exhibition.exhibition_id == exhibition_id, Exhibition.organization_id == org_id)
    ).scalar_one_or_none()

    if not exhibition:
        raise HTTPException(status_code=404, detail="Exhibition not found")

    requests = db.execute(
        select(ExhibitionInfoRequest)
        .where(ExhibitionInfoRequest.exhibition_id == exhibition_id)
    ).scalars().all()

    today = datetime.now(timezone.utc).date()
    total = len(requests)
    received = sum(1 for r in requests if r.status in ["received", "approved"])
    approved = sum(1 for r in requests if r.status == "approved")
    missing = sum(1 for r in requests if r.status == "requested" and r.is_required)
    overdue = sum(1 for r in requests if r.status == "requested" and r.due_date and r.due_date < today)
    incomplete = sum(1 for r in requests if r.status == "incomplete")

    return {
        "total": total,
        "received": received,
        "approved": approved,
        "missing": missing,
        "overdue": overdue,
        "incomplete": incomplete,
    }


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/info-requests", response_model=InfoRequestListResponse, summary="List info requests")
def list_info_requests(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List all info requests for an exhibition with summary stats."""
    exhibition = db.execute(
        select(Exhibition)
        .where(Exhibition.exhibition_id == exhibition_id, Exhibition.organization_id == org_id)
    ).scalar_one_or_none()

    if not exhibition:
        raise HTTPException(status_code=404, detail="Exhibition not found")

    requests = db.execute(
        select(ExhibitionInfoRequest)
        .where(ExhibitionInfoRequest.exhibition_id == exhibition_id)
        .options(selectinload(ExhibitionInfoRequest.documents))
        .order_by(ExhibitionInfoRequest.sort_order, ExhibitionInfoRequest.request_type)
    ).scalars().all()

    today = datetime.now(timezone.utc).date()
    total = len(requests)
    received = sum(1 for r in requests if r.status in ["received", "approved"])
    approved = sum(1 for r in requests if r.status == "approved")
    missing = sum(1 for r in requests if r.status == "requested" and r.is_required)
    overdue = sum(1 for r in requests if r.status == "requested" and r.due_date and r.due_date < today)
    incomplete = sum(1 for r in requests if r.status == "incomplete")

    return {
        "info_requests": [_serialize_info_request(r) for r in requests],
        "summary": {
            "total": total,
            "received": received,
            "approved": approved,
            "missing": missing,
            "overdue": overdue,
            "incomplete": incomplete,
        },
    }


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/info-requests", status_code=201, response_model=dict, summary="Create info request")
def create_info_request(
    org_id: UUID,
    exhibition_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create an info request (single or from template)."""
    exhibition = db.execute(
        select(Exhibition)
        .where(Exhibition.exhibition_id == exhibition_id, Exhibition.organization_id == org_id)
    ).scalar_one_or_none()

    if not exhibition:
        raise HTTPException(status_code=404, detail="Exhibition not found")

    # If template_id provided, generate from template
    template_id_str = body.get("template_id")
    if template_id_str:
        try:
            tmpl_uuid = UUID(template_id_str)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid template_id")

        template = db.execute(
            select(InfoRequestTemplate)
            .where(InfoRequestTemplate.template_id == tmpl_uuid, InfoRequestTemplate.organization_id == org_id)
            .options(selectinload(InfoRequestTemplate.items))
        ).scalar_one_or_none()

        if not template:
            raise HTTPException(status_code=404, detail="Template not found")

        reference_date = exhibition.actual_start_date or exhibition.planned_start_date

        created_requests = []
        for item in template.items:
            due_date = None
            if item.default_due_offset_days is not None and reference_date:
                due_date = reference_date + timedelta(days=item.default_due_offset_days)

            info_req = ExhibitionInfoRequest(
                exhibition_id=exhibition_id,
                source_template_item_id=item.template_item_id,
                request_type=item.request_type,
                title=item.title,
                description=item.description,
                status="requested",
                source_party=item.default_source_party,
                due_date=due_date,
                is_required=item.is_required,
                sort_order=item.sort_order,
                created_by=auth.user_id,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
            )
            db.add(info_req)
            created_requests.append(info_req)

        db.commit()

        return {
            "info_requests": [_serialize_info_request(r) for r in created_requests],
            "count": len(created_requests),
        }

    # Single request creation
    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    request_type = body.get("request_type")
    if request_type not in InfoRequestType.ALL:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid request_type. Must be one of: {', '.join(InfoRequestType.ALL)}",
        )

    due_date = None
    if body.get("due_date"):
        try:
            due_date = datetime.fromisoformat(body["due_date"].replace("Z", "+00:00")).date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid due_date format")

    max_sort = db.execute(
        select(func.max(ExhibitionInfoRequest.sort_order))
        .where(ExhibitionInfoRequest.exhibition_id == exhibition_id)
    ).scalar() or -1

    info_req = ExhibitionInfoRequest(
        exhibition_id=exhibition_id,
        request_type=request_type,
        title=title,
        description=body.get("description"),
        status="requested",
        source_party=body.get("source_party"),
        due_date=due_date,
        notes=body.get("notes"),
        is_required=body.get("is_required", True),
        sort_order=max_sort + 1,
        created_by=auth.user_id,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    db.add(info_req)
    db.commit()

    return {"info_request": _serialize_info_request(info_req)}


@router.get(
    "/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/info-requests/{request_id}",
    response_model=InfoRequestResponse, summary="Get info request")
def get_info_request(
    org_id: UUID,
    exhibition_id: UUID,
    request_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a specific info request."""
    info_req = db.execute(
        select(ExhibitionInfoRequest)
        .join(Exhibition)
        .where(
            ExhibitionInfoRequest.request_id == request_id,
            ExhibitionInfoRequest.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
        .options(selectinload(ExhibitionInfoRequest.documents))
    ).scalar_one_or_none()

    if not info_req:
        raise HTTPException(status_code=404, detail="Info request not found")

    return {"info_request": _serialize_info_request(info_req)}


@router.patch(
    "/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/info-requests/{request_id}",
    response_model=InfoRequestResponse, summary="Update info request")
def update_info_request(
    org_id: UUID,
    exhibition_id: UUID,
    request_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update an info request."""
    info_req = db.execute(
        select(ExhibitionInfoRequest)
        .join(Exhibition)
        .where(
            ExhibitionInfoRequest.request_id == request_id,
            ExhibitionInfoRequest.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
        .options(selectinload(ExhibitionInfoRequest.documents))
    ).scalar_one_or_none()

    if not info_req:
        raise HTTPException(status_code=404, detail="Info request not found")

    if "title" in body:
        title = body["title"].strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        info_req.title = title

    if "description" in body:
        info_req.description = body["description"]
    if "request_type" in body:
        if body["request_type"] not in InfoRequestType.ALL:
            raise HTTPException(status_code=400, detail="Invalid request_type")
        info_req.request_type = body["request_type"]
    if "source_party" in body:
        info_req.source_party = body["source_party"]
    if "due_date" in body:
        if body["due_date"]:
            try:
                info_req.due_date = datetime.fromisoformat(
                    body["due_date"].replace("Z", "+00:00")
                ).date()
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid due_date format")
        else:
            info_req.due_date = None
    if "notes" in body:
        info_req.notes = body["notes"]
    if "is_required" in body:
        info_req.is_required = bool(body["is_required"])
    if "sort_order" in body:
        info_req.sort_order = body["sort_order"]

    old_status = info_req.status

    # Handle status changes with tracking
    if "status" in body:
        new_status = body["status"]
        if new_status not in InfoRequestStatus.ALL:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status. Must be one of: {', '.join(InfoRequestStatus.ALL)}",
            )

        info_req.status = new_status

        # Track received
        if new_status == "received" and old_status != "received":
            info_req.received_at = datetime.now(timezone.utc)
            info_req.received_by = auth.user_id
        elif new_status == "requested" and old_status in ["received", "approved"]:
            info_req.received_at = None
            info_req.received_by = None
            info_req.approved_at = None
            info_req.approved_by = None

        # Track approved
        if new_status == "approved" and old_status != "approved":
            info_req.approved_at = datetime.now(timezone.utc)
            info_req.approved_by = auth.user_id
            if not info_req.received_at:
                info_req.received_at = datetime.now(timezone.utc)
                info_req.received_by = auth.user_id
        elif new_status in ["requested", "received", "incomplete"] and old_status == "approved":
            info_req.approved_at = None
            info_req.approved_by = None

    info_req.updated_at = datetime.now(timezone.utc)
    db.commit()

    if "status" in body and info_req.status != old_status:
        notify_status_change(
            org_id, "info_request", info_req.request_id,
            info_req.title, old_status, info_req.status,
            auth.user_id, entity=info_req,
        )

    return {"info_request": _serialize_info_request(info_req)}


@router.delete(
    "/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/info-requests/{request_id}",
    response_model=SuccessResponse, summary="Delete info request")
def delete_info_request(
    org_id: UUID,
    exhibition_id: UUID,
    request_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete an info request."""
    info_req = db.execute(
        select(ExhibitionInfoRequest)
        .join(Exhibition)
        .where(
            ExhibitionInfoRequest.request_id == request_id,
            ExhibitionInfoRequest.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not info_req:
        raise HTTPException(status_code=404, detail="Info request not found")

    db.delete(info_req)
    db.commit()

    return {"success": True}


# ============================================================================
# DOCUMENT ENDPOINTS
# ============================================================================


@router.post(
    "/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/info-requests/{request_id}/documents",
    response_model=InfoRequestDocumentResponse,
    status_code=201, summary="Add document")
def add_document(
    org_id: UUID,
    exhibition_id: UUID,
    request_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Link a document to an info request."""
    info_req = db.execute(
        select(ExhibitionInfoRequest)
        .join(Exhibition)
        .where(
            ExhibitionInfoRequest.request_id == request_id,
            ExhibitionInfoRequest.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not info_req:
        raise HTTPException(status_code=404, detail="Info request not found")

    media_id_str = body.get("media_id")
    if not media_id_str:
        raise HTTPException(status_code=400, detail="media_id is required")

    try:
        media_id = UUID(media_id_str)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid media_id")

    # Check for duplicate
    existing = db.execute(
        select(InfoRequestDocument)
        .where(
            InfoRequestDocument.request_id == request_id,
            InfoRequestDocument.media_id == media_id,
        )
    ).scalar_one_or_none()

    if existing:
        raise HTTPException(status_code=400, detail="Document already linked")

    doc = InfoRequestDocument(
        request_id=request_id,
        media_id=media_id,
        label=body.get("label"),
        created_at=datetime.now(timezone.utc),
    )
    db.add(doc)
    db.commit()

    return {"document": _serialize_document(doc)}


@router.delete(
    "/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/info-requests/{request_id}/documents/{link_id}",
    response_model=SuccessResponse, summary="Remove document")
def remove_document(
    org_id: UUID,
    exhibition_id: UUID,
    request_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Remove a document link from an info request."""
    doc = db.execute(
        select(InfoRequestDocument)
        .join(ExhibitionInfoRequest)
        .join(Exhibition)
        .where(
            InfoRequestDocument.link_id == link_id,
            ExhibitionInfoRequest.request_id == request_id,
            ExhibitionInfoRequest.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail="Document link not found")

    db.delete(doc)
    db.commit()

    return {"success": True}


# ============================================================================
# ENUM ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/exhibit/info-request-enums", response_model=InfoRequestEnumsResponse, summary="Get enums")
def get_enums(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get all enum values for info requests."""
    return {
        "request_types": [{"value": t, "label": InfoRequestType.LABELS[t]} for t in InfoRequestType.ALL],
        "statuses": [{"value": s, "label": InfoRequestStatus.LABELS[s]} for s in InfoRequestStatus.ALL],
        "source_parties": [{"value": p, "label": InfoRequestSourceParty.LABELS[p]} for p in InfoRequestSourceParty.ALL],
    }
