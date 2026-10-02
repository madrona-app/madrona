"""
Checklist API endpoints (FastAPI).

Provides CRUD for templates, versions, and exhibition checklists.
Migrated from app/api/checklists.py — 25 routes.
"""
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import select, func
from sqlalchemy.orm import Session, selectinload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    ChecklistTemplate,
    ChecklistTemplateVersion,
    ChecklistTemplateItem,
    ExhibitionChecklist,
    ChecklistItem,
    ChecklistItemLink,
    ChecklistPhase,
    ChecklistRole,
    ChecklistItemStatus,
    ChecklistExhibitionType,
    ChecklistLinkEntityType,
    Exhibition,
)
from app.permissions import Permission
from app.services.entity_notifications import notify_status_change
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.checklists import (
    ChecklistEnumsResponse,
    ChecklistItemLinkWrapperResponse,
    ChecklistItemLinksListResponse,
    ChecklistItemWrapperResponse,
    ChecklistTemplateItemWrapperResponse,
    ChecklistTemplateListResponse,
    ChecklistTemplateWrapperResponse,
    ChecklistVersionWrapperResponse,
    ExhibitionChecklistWrapperResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["checklists"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_template(template: ChecklistTemplate, include_versions: bool = False) -> dict:
    data = {
        "template_id": str(template.template_id),
        "name": template.name,
        "description": template.description,
        "exhibition_type": template.exhibition_type,
        "is_archived": template.is_archived,
        "created_at": template.created_at.isoformat() if template.created_at else None,
        "created_by": str(template.created_by) if template.created_by else None,
    }
    if include_versions:
        data["versions"] = [_serialize_version(v, include_items=False) for v in template.versions]
    return data


def _serialize_version(version: ChecklistTemplateVersion, include_items: bool = True) -> dict:
    data = {
        "version_id": str(version.version_id),
        "template_id": str(version.template_id),
        "version_number": version.version_number,
        "is_published": version.is_published,
        "is_locked": version.is_locked,
        "change_notes": version.change_notes,
        "created_at": version.created_at.isoformat() if version.created_at else None,
        "created_by": str(version.created_by) if version.created_by else None,
    }
    if include_items:
        data["items"] = [
            _serialize_template_item(i)
            for i in sorted(version.items, key=lambda x: (ChecklistPhase.ALL.index(x.phase), x.sort_order))
        ]
        data["item_count"] = len(version.items)
    return data


def _serialize_template_item(item: ChecklistTemplateItem) -> dict:
    return {
        "template_item_id": str(item.template_item_id),
        "phase": item.phase,
        "phase_label": ChecklistPhase.LABELS.get(item.phase, item.phase),
        "title": item.title,
        "description": item.description,
        "responsible_role": item.responsible_role,
        "responsible_role_label": ChecklistRole.LABELS.get(item.responsible_role, item.responsible_role),
        "default_due_offset_days": item.default_due_offset_days,
        "sort_order": item.sort_order,
        "is_required": item.is_required,
    }


def _serialize_checklist(checklist: ExhibitionChecklist, include_items: bool = True) -> dict:
    data = {
        "checklist_id": str(checklist.checklist_id),
        "exhibition_id": str(checklist.exhibition_id),
        "template_version_id": str(checklist.template_version_id) if checklist.template_version_id else None,
        "name": checklist.name,
        "created_at": checklist.created_at.isoformat() if checklist.created_at else None,
        "created_by": str(checklist.created_by) if checklist.created_by else None,
    }
    if include_items:
        items = sorted(checklist.items, key=lambda x: (ChecklistPhase.ALL.index(x.phase), x.sort_order))
        data["items"] = [_serialize_checklist_item(i) for i in items]
        data["item_count"] = len(checklist.items)

        status_counts = {}
        for item in checklist.items:
            status_counts[item.status] = status_counts.get(item.status, 0) + 1
        data["status_summary"] = status_counts
    return data


def _serialize_checklist_item(item: ChecklistItem) -> dict:
    return {
        "item_id": str(item.item_id),
        "checklist_id": str(item.checklist_id),
        "source_template_item_id": str(item.source_template_item_id) if item.source_template_item_id else None,
        "phase": item.phase,
        "phase_label": ChecklistPhase.LABELS.get(item.phase, item.phase),
        "title": item.title,
        "description": item.description,
        "responsible_role": item.responsible_role,
        "responsible_role_label": ChecklistRole.LABELS.get(item.responsible_role, item.responsible_role),
        "assigned_user_id": str(item.assigned_user_id) if item.assigned_user_id else None,
        "due_date": item.due_date.isoformat() if item.due_date else None,
        "status": item.status,
        "status_label": ChecklistItemStatus.LABELS.get(item.status, item.status),
        "notes": item.notes,
        "sort_order": item.sort_order,
        "completed_at": item.completed_at.isoformat() if item.completed_at else None,
        "completed_by": str(item.completed_by) if item.completed_by else None,
        "links": [_serialize_link(l) for l in item.links] if item.links else [],
    }


def _serialize_link(link: ChecklistItemLink) -> dict:
    return {
        "link_id": str(link.link_id),
        "linked_entity_type": link.linked_entity_type,
        "linked_entity_id": str(link.linked_entity_id),
    }


# ============================================================================
# TEMPLATE ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/exhibit/checklist-templates", response_model=ChecklistTemplateListResponse, summary="List templates")
def list_templates(
    org_id: UUID,
    exhibition_type: Optional[str] = Query(None),
    include_archived: bool = Query(False),
    published_only: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List templates."""
    query = (
        select(ChecklistTemplate)
        .where(ChecklistTemplate.organization_id == org_id)
        .options(selectinload(ChecklistTemplate.versions))
    )

    if not include_archived:
        query = query.where(ChecklistTemplate.is_archived == False)  # noqa: E712

    if exhibition_type and exhibition_type in ChecklistExhibitionType.ALL:
        query = query.where(ChecklistTemplate.exhibition_type == exhibition_type)

    query = query.order_by(ChecklistTemplate.name)
    templates = db.execute(query).scalars().all()

    if published_only:
        templates = [t for t in templates if any(v.is_published for v in t.versions)]

    result = []
    for t in templates:
        data = _serialize_template(t, include_versions=True)
        published_versions = [v for v in t.versions if v.is_published]
        if published_versions:
            latest = max(published_versions, key=lambda v: v.version_number)
            data["published_version_id"] = str(latest.version_id)
            data["published_version_number"] = latest.version_number
        else:
            data["published_version_id"] = None
            data["published_version_number"] = None
        result.append(data)

    return {"templates": result}


@router.post("/api/organizations/{org_id}/exhibit/checklist-templates", response_model=ChecklistTemplateWrapperResponse, status_code=201, summary="Create template")
def create_template(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create template."""
    name = (body.get("name") or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Name is required")

    exhibition_type = body.get("exhibition_type", "general")
    if exhibition_type not in ChecklistExhibitionType.ALL:
        raise HTTPException(status_code=400, detail=f"Invalid exhibition_type. Must be one of: {', '.join(ChecklistExhibitionType.ALL)}")

    template = ChecklistTemplate(
        organization_id=org_id,
        name=name,
        description=body.get("description"),
        exhibition_type=exhibition_type,
        created_by=auth.user_id,
    )
    db.add(template)
    db.flush()

    version = ChecklistTemplateVersion(
        template_id=template.template_id,
        version_number=1,
        is_published=False,
        is_locked=False,
        created_by=auth.user_id,
    )
    db.add(version)
    db.commit()

    return {"template": _serialize_template(template, include_versions=True)}


@router.get("/api/organizations/{org_id}/exhibit/checklist-templates/{template_id}", response_model=ChecklistTemplateWrapperResponse, summary="Get template")
def get_template(
    org_id: UUID,
    template_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get template."""
    template = db.execute(
        select(ChecklistTemplate)
        .where(ChecklistTemplate.template_id == template_id, ChecklistTemplate.organization_id == org_id)
        .options(selectinload(ChecklistTemplate.versions).selectinload(ChecklistTemplateVersion.items))
    ).scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    return {"template": _serialize_template(template, include_versions=True)}


@router.patch("/api/organizations/{org_id}/exhibit/checklist-templates/{template_id}", response_model=ChecklistTemplateWrapperResponse, summary="Update template")
def update_template(
    org_id: UUID,
    template_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update template."""
    template = db.execute(
        select(ChecklistTemplate)
        .where(ChecklistTemplate.template_id == template_id, ChecklistTemplate.organization_id == org_id)
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

    if "is_archived" in body:
        template.is_archived = bool(body["is_archived"])

    db.commit()

    return {"template": _serialize_template(template, include_versions=True)}


@router.delete("/api/organizations/{org_id}/exhibit/checklist-templates/{template_id}", response_model=SuccessResponse, summary="Delete template")
def delete_template(
    org_id: UUID,
    template_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete template."""
    template = db.execute(
        select(ChecklistTemplate)
        .where(ChecklistTemplate.template_id == template_id, ChecklistTemplate.organization_id == org_id)
        .options(selectinload(ChecklistTemplate.versions))
    ).scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    for version in template.versions:
        if version.is_locked:
            raise HTTPException(status_code=400, detail="Cannot delete template with versions in use. Archive it instead.")

    db.delete(template)
    db.commit()

    return {"success": True}


# ============================================================================
# VERSION ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{org_id}/exhibit/checklist-templates/{template_id}/versions", response_model=ChecklistVersionWrapperResponse, status_code=201, summary="Create version")
def create_version(
    org_id: UUID,
    template_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create version."""
    template = db.execute(
        select(ChecklistTemplate)
        .where(ChecklistTemplate.template_id == template_id, ChecklistTemplate.organization_id == org_id)
        .options(selectinload(ChecklistTemplate.versions).selectinload(ChecklistTemplateVersion.items))
    ).scalar_one_or_none()

    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    max_version = max([v.version_number for v in template.versions], default=0)
    new_version_number = max_version + 1

    copy_from_version_id = body.get("copy_from_version_id")
    source_version = None
    if copy_from_version_id:
        try:
            source_uuid = UUID(copy_from_version_id)
            source_version = next((v for v in template.versions if v.version_id == source_uuid), None)
        except (ValueError, TypeError):
            pass

    version = ChecklistTemplateVersion(
        template_id=template.template_id,
        version_number=new_version_number,
        is_published=False,
        is_locked=False,
        change_notes=body.get("change_notes"),
        created_by=auth.user_id,
    )
    db.add(version)
    db.flush()

    if source_version:
        for item in source_version.items:
            new_item = ChecklistTemplateItem(
                version_id=version.version_id,
                phase=item.phase,
                title=item.title,
                description=item.description,
                responsible_role=item.responsible_role,
                default_due_offset_days=item.default_due_offset_days,
                sort_order=item.sort_order,
                is_required=item.is_required,
            )
            db.add(new_item)

    db.commit()

    return {"version": _serialize_version(version)}


@router.get("/api/organizations/{org_id}/exhibit/checklist-templates/{template_id}/versions/{version_id}", response_model=ChecklistVersionWrapperResponse, summary="Get version")
def get_version(
    org_id: UUID,
    template_id: UUID,
    version_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get version."""
    version = db.execute(
        select(ChecklistTemplateVersion)
        .join(ChecklistTemplate)
        .where(
            ChecklistTemplateVersion.version_id == version_id,
            ChecklistTemplate.template_id == template_id,
            ChecklistTemplate.organization_id == org_id,
        )
        .options(selectinload(ChecklistTemplateVersion.items))
    ).scalar_one_or_none()

    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    return {"version": _serialize_version(version)}


@router.patch("/api/organizations/{org_id}/exhibit/checklist-templates/{template_id}/versions/{version_id}", response_model=ChecklistVersionWrapperResponse, summary="Update version")
def update_version(
    org_id: UUID,
    template_id: UUID,
    version_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update version."""
    version = db.execute(
        select(ChecklistTemplateVersion)
        .join(ChecklistTemplate)
        .where(
            ChecklistTemplateVersion.version_id == version_id,
            ChecklistTemplate.template_id == template_id,
            ChecklistTemplate.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    if version.is_locked:
        raise HTTPException(status_code=409, detail="Cannot modify a locked version")

    if "change_notes" in body:
        version.change_notes = body["change_notes"]

    if "is_published" in body:
        version.is_published = bool(body["is_published"])

    db.commit()

    return {"version": _serialize_version(version)}


@router.post("/api/organizations/{org_id}/exhibit/checklist-templates/{template_id}/versions/{version_id}/publish", response_model=ChecklistVersionWrapperResponse, summary="Publish version")
def publish_version(
    org_id: UUID,
    template_id: UUID,
    version_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Publish version."""
    version = db.execute(
        select(ChecklistTemplateVersion)
        .join(ChecklistTemplate)
        .where(
            ChecklistTemplateVersion.version_id == version_id,
            ChecklistTemplate.template_id == template_id,
            ChecklistTemplate.organization_id == org_id,
        )
        .options(selectinload(ChecklistTemplateVersion.items))
    ).scalar_one_or_none()

    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    if not version.items:
        raise HTTPException(status_code=400, detail="Cannot publish a version with no items")

    version.is_published = True
    db.commit()

    return {"version": _serialize_version(version)}


# ============================================================================
# TEMPLATE ITEM ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{org_id}/exhibit/checklist-templates/{template_id}/versions/{version_id}/items", response_model=ChecklistTemplateItemWrapperResponse, status_code=201, summary="Add template item")
def add_template_item(
    org_id: UUID,
    template_id: UUID,
    version_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Add template item."""
    version = db.execute(
        select(ChecklistTemplateVersion)
        .join(ChecklistTemplate)
        .where(
            ChecklistTemplateVersion.version_id == version_id,
            ChecklistTemplate.template_id == template_id,
            ChecklistTemplate.organization_id == org_id,
        )
        .options(selectinload(ChecklistTemplateVersion.items))
    ).scalar_one_or_none()

    if not version:
        raise HTTPException(status_code=404, detail="Version not found")

    if version.is_locked:
        raise HTTPException(status_code=409, detail="Cannot modify a locked version")

    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    phase = body.get("phase")
    if phase not in ChecklistPhase.ALL:
        raise HTTPException(status_code=400, detail=f"Invalid phase. Must be one of: {', '.join(ChecklistPhase.ALL)}")

    responsible_role = body.get("responsible_role")
    if responsible_role not in ChecklistRole.ALL:
        raise HTTPException(status_code=400, detail=f"Invalid responsible_role. Must be one of: {', '.join(ChecklistRole.ALL)}")

    max_sort = max([i.sort_order for i in version.items if i.phase == phase], default=-1)

    item = ChecklistTemplateItem(
        version_id=version.version_id,
        phase=phase,
        title=title,
        description=body.get("description"),
        responsible_role=responsible_role,
        default_due_offset_days=body.get("default_due_offset_days"),
        sort_order=body.get("sort_order", max_sort + 1),
        is_required=body.get("is_required", True),
    )
    db.add(item)
    db.commit()

    return {"item": _serialize_template_item(item)}


@router.patch("/api/organizations/{org_id}/exhibit/checklist-templates/{template_id}/versions/{version_id}/items/{item_id}", response_model=ChecklistTemplateItemWrapperResponse, summary="Update template item")
def update_template_item(
    org_id: UUID,
    template_id: UUID,
    version_id: UUID,
    item_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update template item."""
    item = db.execute(
        select(ChecklistTemplateItem)
        .join(ChecklistTemplateVersion)
        .join(ChecklistTemplate)
        .where(
            ChecklistTemplateItem.template_item_id == item_id,
            ChecklistTemplateVersion.version_id == version_id,
            ChecklistTemplate.template_id == template_id,
            ChecklistTemplate.organization_id == org_id,
        )
        .options(selectinload(ChecklistTemplateItem.version))
    ).scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if item.version.is_locked:
        raise HTTPException(status_code=409, detail="Cannot modify items in a locked version")

    if "title" in body:
        title = body["title"].strip()
        if not title:
            raise HTTPException(status_code=400, detail="Title cannot be empty")
        item.title = title

    if "description" in body:
        item.description = body["description"]

    if "phase" in body:
        if body["phase"] not in ChecklistPhase.ALL:
            raise HTTPException(status_code=400, detail="Invalid phase")
        item.phase = body["phase"]

    if "responsible_role" in body:
        if body["responsible_role"] not in ChecklistRole.ALL:
            raise HTTPException(status_code=400, detail="Invalid responsible_role")
        item.responsible_role = body["responsible_role"]

    if "default_due_offset_days" in body:
        item.default_due_offset_days = body["default_due_offset_days"]

    if "sort_order" in body:
        item.sort_order = body["sort_order"]

    if "is_required" in body:
        item.is_required = bool(body["is_required"])

    db.commit()

    return {"item": _serialize_template_item(item)}


@router.delete("/api/organizations/{org_id}/exhibit/checklist-templates/{template_id}/versions/{version_id}/items/{item_id}", response_model=SuccessResponse, summary="Delete template item")
def delete_template_item(
    org_id: UUID,
    template_id: UUID,
    version_id: UUID,
    item_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete template item."""
    item = db.execute(
        select(ChecklistTemplateItem)
        .join(ChecklistTemplateVersion)
        .join(ChecklistTemplate)
        .where(
            ChecklistTemplateItem.template_item_id == item_id,
            ChecklistTemplateVersion.version_id == version_id,
            ChecklistTemplate.template_id == template_id,
            ChecklistTemplate.organization_id == org_id,
        )
        .options(selectinload(ChecklistTemplateItem.version))
    ).scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if item.version.is_locked:
        raise HTTPException(status_code=409, detail="Cannot delete items from a locked version")

    db.delete(item)
    db.commit()

    return {"success": True}


# ============================================================================
# EXHIBITION CHECKLIST ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/checklists", response_model=ExhibitionChecklistWrapperResponse, summary="List exhibition checklists")
def list_exhibition_checklists(
    org_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """List exhibition checklists."""
    exhibition = db.execute(
        select(Exhibition)
        .where(Exhibition.exhibition_id == exhibition_id, Exhibition.organization_id == org_id)
    ).scalar_one_or_none()

    if not exhibition:
        raise HTTPException(status_code=404, detail="Exhibition not found")

    checklists = db.execute(
        select(ExhibitionChecklist)
        .where(ExhibitionChecklist.exhibition_id == exhibition_id)
        .options(selectinload(ExhibitionChecklist.items).selectinload(ChecklistItem.links))
        .order_by(ExhibitionChecklist.created_at)
    ).scalars().all()

    if checklists:
        checklist_data = _serialize_checklist(checklists[0])
        for item_data in checklist_data.get("items", []):
            item_data["links_count"] = len(item_data.get("links", []))
        return {"checklist": checklist_data}
    else:
        return {"checklist": None}


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/checklists", response_model=ExhibitionChecklistWrapperResponse, status_code=201, summary="Create exhibition checklist")
def create_exhibition_checklist(
    org_id: UUID,
    exhibition_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Create exhibition checklist."""
    exhibition = db.execute(
        select(Exhibition)
        .where(Exhibition.exhibition_id == exhibition_id, Exhibition.organization_id == org_id)
    ).scalar_one_or_none()

    if not exhibition:
        raise HTTPException(status_code=404, detail="Exhibition not found")

    template_version_id = body.get("template_version_id")
    template_id_str = body.get("template_id")
    name = (body.get("name") or "").strip()

    template_version = None

    if template_id_str and not template_version_id:
        try:
            template_uuid = UUID(template_id_str)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid template_id")

        template = db.execute(
            select(ChecklistTemplate)
            .where(ChecklistTemplate.template_id == template_uuid, ChecklistTemplate.organization_id == org_id)
            .options(selectinload(ChecklistTemplate.versions).selectinload(ChecklistTemplateVersion.items))
        ).scalar_one_or_none()

        if template:
            published_versions = [v for v in template.versions if v.is_published]
            if published_versions:
                template_version = max(published_versions, key=lambda v: v.version_number)

        if not template_version:
            raise HTTPException(status_code=404, detail="Template not found or has no published version")

    elif template_version_id:
        try:
            version_uuid = UUID(template_version_id)
        except (ValueError, TypeError):
            raise HTTPException(status_code=400, detail="Invalid template_version_id")

        template_version = db.execute(
            select(ChecklistTemplateVersion)
            .join(ChecklistTemplate)
            .where(
                ChecklistTemplateVersion.version_id == version_uuid,
                ChecklistTemplate.organization_id == org_id,
                ChecklistTemplateVersion.is_published == True,  # noqa: E712
            )
            .options(
                selectinload(ChecklistTemplateVersion.items),
                selectinload(ChecklistTemplateVersion.template),
            )
        ).scalar_one_or_none()

        if not template_version:
            raise HTTPException(status_code=404, detail="Template version not found or not published")

    if template_version:
        template_version.is_locked = True
        if not name:
            name = template_version.template.name

    if not name:
        name = "Exhibition Checklist"

    checklist = ExhibitionChecklist(
        exhibition_id=exhibition_id,
        template_version_id=template_version.version_id if template_version else None,
        name=name,
        created_by=auth.user_id,
    )
    db.add(checklist)
    db.flush()

    if template_version:
        for template_item in template_version.items:
            due_date = None
            reference_date = getattr(exhibition, "actual_start_date", None) or getattr(exhibition, "planned_start_date", None)
            if template_item.default_due_offset_days is not None and reference_date:
                due_date = reference_date + timedelta(days=template_item.default_due_offset_days)

            item = ChecklistItem(
                checklist_id=checklist.checklist_id,
                source_template_item_id=template_item.template_item_id,
                phase=template_item.phase,
                title=template_item.title,
                description=template_item.description,
                responsible_role=template_item.responsible_role,
                due_date=due_date,
                status="todo",
                sort_order=template_item.sort_order,
            )
            db.add(item)

    db.commit()

    checklist = db.execute(
        select(ExhibitionChecklist)
        .where(ExhibitionChecklist.checklist_id == checklist.checklist_id)
        .options(selectinload(ExhibitionChecklist.items).selectinload(ChecklistItem.links))
    ).scalar_one()

    return {"checklist": _serialize_checklist(checklist)}


@router.get("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/checklists/{checklist_id}", response_model=ExhibitionChecklistWrapperResponse, summary="Get exhibition checklist")
def get_exhibition_checklist(
    org_id: UUID,
    exhibition_id: UUID,
    checklist_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get exhibition checklist."""
    checklist = db.execute(
        select(ExhibitionChecklist)
        .join(Exhibition)
        .where(
            ExhibitionChecklist.checklist_id == checklist_id,
            ExhibitionChecklist.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
        .options(selectinload(ExhibitionChecklist.items).selectinload(ChecklistItem.links))
    ).scalar_one_or_none()

    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist not found")

    return {"checklist": _serialize_checklist(checklist)}


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/checklists/{checklist_id}", response_model=SuccessResponse, summary="Delete exhibition checklist")
def delete_exhibition_checklist(
    org_id: UUID,
    exhibition_id: UUID,
    checklist_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete exhibition checklist."""
    checklist = db.execute(
        select(ExhibitionChecklist)
        .join(Exhibition)
        .where(
            ExhibitionChecklist.checklist_id == checklist_id,
            ExhibitionChecklist.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist not found")

    db.delete(checklist)
    db.commit()

    return {"success": True}


# ============================================================================
# CHECKLIST ITEM ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/checklists/{checklist_id}/items", response_model=ChecklistItemWrapperResponse, status_code=201, summary="Add checklist item")
def add_checklist_item(
    org_id: UUID,
    exhibition_id: UUID,
    checklist_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Add checklist item."""
    checklist = db.execute(
        select(ExhibitionChecklist)
        .join(Exhibition)
        .where(
            ExhibitionChecklist.checklist_id == checklist_id,
            ExhibitionChecklist.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
        .options(selectinload(ExhibitionChecklist.items))
    ).scalar_one_or_none()

    if not checklist:
        raise HTTPException(status_code=404, detail="Checklist not found")

    title = (body.get("title") or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required")

    phase = body.get("phase")
    if phase not in ChecklistPhase.ALL:
        raise HTTPException(status_code=400, detail="Invalid phase")

    responsible_role = body.get("responsible_role")
    if responsible_role not in ChecklistRole.ALL:
        raise HTTPException(status_code=400, detail="Invalid responsible_role")

    max_sort = max([i.sort_order for i in checklist.items if i.phase == phase], default=-1)

    due_date = None
    if body.get("due_date"):
        try:
            due_date = datetime.fromisoformat(body["due_date"].replace("Z", "+00:00")).date()
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid due_date format")

    item = ChecklistItem(
        checklist_id=checklist.checklist_id,
        source_template_item_id=None,
        phase=phase,
        title=title,
        description=body.get("description"),
        responsible_role=responsible_role,
        assigned_user_id=UUID(body["assigned_user_id"]) if body.get("assigned_user_id") else None,
        due_date=due_date,
        status="todo",
        notes=body.get("notes"),
        sort_order=body.get("sort_order", max_sort + 1),
    )
    db.add(item)
    db.commit()

    return {"item": _serialize_checklist_item(item)}


@router.patch("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/checklists/{checklist_id}/items/{item_id}", response_model=ChecklistItemWrapperResponse, summary="Update checklist item")
def update_checklist_item(
    org_id: UUID,
    exhibition_id: UUID,
    checklist_id: UUID,
    item_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update checklist item."""
    item = db.execute(
        select(ChecklistItem)
        .join(ExhibitionChecklist)
        .join(Exhibition)
        .where(
            ChecklistItem.item_id == item_id,
            ExhibitionChecklist.checklist_id == checklist_id,
            ExhibitionChecklist.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
        .options(selectinload(ChecklistItem.links))
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

    if "phase" in body:
        if body["phase"] not in ChecklistPhase.ALL:
            raise HTTPException(status_code=400, detail="Invalid phase")
        item.phase = body["phase"]

    if "responsible_role" in body:
        if body["responsible_role"] not in ChecklistRole.ALL:
            raise HTTPException(status_code=400, detail="Invalid responsible_role")
        item.responsible_role = body["responsible_role"]

    if "assigned_user_id" in body:
        item.assigned_user_id = UUID(body["assigned_user_id"]) if body["assigned_user_id"] else None

    if "due_date" in body:
        if body["due_date"]:
            try:
                item.due_date = datetime.fromisoformat(body["due_date"].replace("Z", "+00:00")).date()
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid due_date format")
        else:
            item.due_date = None

    if "notes" in body:
        item.notes = body["notes"]

    if "sort_order" in body:
        item.sort_order = body["sort_order"]

    db.commit()

    return {"item": _serialize_checklist_item(item)}


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/checklists/{checklist_id}/items/{item_id}/status", response_model=ChecklistItemWrapperResponse, summary="Update item status")
def update_item_status(
    org_id: UUID,
    exhibition_id: UUID,
    checklist_id: UUID,
    item_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update item status."""
    item = db.execute(
        select(ChecklistItem)
        .join(ExhibitionChecklist)
        .join(Exhibition)
        .where(
            ChecklistItem.item_id == item_id,
            ExhibitionChecklist.checklist_id == checklist_id,
            ExhibitionChecklist.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
        .options(selectinload(ChecklistItem.links))
    ).scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    new_status = body.get("status")
    if new_status not in ChecklistItemStatus.ALL:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of: {', '.join(ChecklistItemStatus.ALL)}")

    old_status = item.status
    item.status = new_status

    # DONE and NOT_APPLICABLE are both terminal: N/A means "this item doesn't
    # apply here," which counts as complete for progress tracking.
    _TERMINAL = (ChecklistItemStatus.DONE, ChecklistItemStatus.NOT_APPLICABLE)
    was_terminal = old_status in _TERMINAL
    now_terminal = new_status in _TERMINAL
    if now_terminal and not was_terminal:
        item.completed_at = datetime.now(timezone.utc)
        item.completed_by = auth.user_id
    elif was_terminal and not now_terminal:
        item.completed_at = None
        item.completed_by = None

    db.commit()

    if new_status != old_status:
        notify_status_change(
            org_id, "checklist_item", item.item_id,
            item.title, old_status, new_status,
            auth.user_id, entity=item,
        )

    return {"item": _serialize_checklist_item(item)}


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/checklists/{checklist_id}/items/{item_id}", response_model=SuccessResponse, summary="Delete checklist item")
def delete_checklist_item(
    org_id: UUID,
    exhibition_id: UUID,
    checklist_id: UUID,
    item_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete checklist item."""
    item = db.execute(
        select(ChecklistItem)
        .join(ExhibitionChecklist)
        .join(Exhibition)
        .where(
            ChecklistItem.item_id == item_id,
            ExhibitionChecklist.checklist_id == checklist_id,
            ExhibitionChecklist.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    db.delete(item)
    db.commit()

    return {"success": True}


# ============================================================================
# ITEM LINK ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/checklists/{checklist_id}/items/{item_id}/links", response_model=ChecklistItemLinkWrapperResponse, status_code=201, summary="Add item link")
def add_item_link(
    org_id: UUID,
    exhibition_id: UUID,
    checklist_id: UUID,
    item_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Add item link."""
    item = db.execute(
        select(ChecklistItem)
        .join(ExhibitionChecklist)
        .join(Exhibition)
        .where(
            ChecklistItem.item_id == item_id,
            ExhibitionChecklist.checklist_id == checklist_id,
            ExhibitionChecklist.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    entity_type = body.get("linked_entity_type")
    if entity_type not in ChecklistLinkEntityType.ALL:
        raise HTTPException(status_code=400, detail="Invalid linked_entity_type")

    entity_id_str = body.get("linked_entity_id")
    if not entity_id_str:
        raise HTTPException(status_code=400, detail="Invalid linked_entity_id")

    try:
        entity_id = UUID(entity_id_str)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid linked_entity_id")

    existing = db.execute(
        select(ChecklistItemLink)
        .where(
            ChecklistItemLink.item_id == item_id,
            ChecklistItemLink.linked_entity_type == entity_type,
            ChecklistItemLink.linked_entity_id == entity_id,
        )
    ).scalar_one_or_none()

    if existing:
        raise HTTPException(status_code=400, detail="Link already exists")

    link = ChecklistItemLink(
        item_id=item_id,
        linked_entity_type=entity_type,
        linked_entity_id=entity_id,
    )
    db.add(link)
    db.commit()

    return {"link": _serialize_link(link)}


@router.delete("/api/organizations/{org_id}/exhibit/exhibitions/{exhibition_id}/checklists/{checklist_id}/items/{item_id}/links/{link_id}", response_model=SuccessResponse, summary="Delete item link")
def delete_item_link(
    org_id: UUID,
    exhibition_id: UUID,
    checklist_id: UUID,
    item_id: UUID,
    link_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete item link."""
    link = db.execute(
        select(ChecklistItemLink)
        .join(ChecklistItem)
        .join(ExhibitionChecklist)
        .join(Exhibition)
        .where(
            ChecklistItemLink.link_id == link_id,
            ChecklistItem.item_id == item_id,
            ExhibitionChecklist.checklist_id == checklist_id,
            ExhibitionChecklist.exhibition_id == exhibition_id,
            Exhibition.organization_id == org_id,
        )
    ).scalar_one_or_none()

    if not link:
        raise HTTPException(status_code=404, detail="Link not found")

    db.delete(link)
    db.commit()

    return {"success": True}


# ============================================================================
# SIMPLIFIED ITEM ENDPOINTS
# ============================================================================


@router.patch("/api/organizations/{org_id}/exhibit/checklists/items/{item_id}", response_model=ChecklistItemWrapperResponse, summary="Update item direct")
def update_item_direct(
    org_id: UUID,
    item_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_EDIT)),
    db: Session = Depends(get_db),
):
    """Update item direct."""
    item = db.execute(
        select(ChecklistItem)
        .join(ExhibitionChecklist)
        .join(Exhibition)
        .where(
            ChecklistItem.item_id == item_id,
            Exhibition.organization_id == org_id,
        )
        .options(selectinload(ChecklistItem.links))
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

    if "phase" in body:
        if body["phase"] not in ChecklistPhase.ALL:
            raise HTTPException(status_code=400, detail="Invalid phase")
        item.phase = body["phase"]

    if "responsible_role" in body:
        if body["responsible_role"] not in ChecklistRole.ALL:
            raise HTTPException(status_code=400, detail="Invalid responsible_role")
        item.responsible_role = body["responsible_role"]

    if "assigned_user_id" in body:
        item.assigned_user_id = UUID(body["assigned_user_id"]) if body["assigned_user_id"] else None

    if "due_date" in body:
        if body["due_date"]:
            try:
                item.due_date = datetime.fromisoformat(body["due_date"].replace("Z", "+00:00")).date()
            except ValueError:
                raise HTTPException(status_code=400, detail="Invalid due_date format")
        else:
            item.due_date = None

    if "notes" in body:
        item.notes = body["notes"]

    if "sort_order" in body:
        item.sort_order = body["sort_order"]

    if "status" in body:
        new_status = body["status"]
        if new_status not in ChecklistItemStatus.ALL:
            raise HTTPException(status_code=400, detail="Invalid status")

        old_status = item.status
        item.status = new_status

        _TERMINAL = (ChecklistItemStatus.DONE, ChecklistItemStatus.NOT_APPLICABLE)
        was_terminal = old_status in _TERMINAL
        now_terminal = new_status in _TERMINAL
        if now_terminal and not was_terminal:
            item.completed_at = datetime.now(timezone.utc)
            item.completed_by = auth.user_id
        elif was_terminal and not now_terminal:
            item.completed_at = None
            item.completed_by = None

    item.updated_at = datetime.now(timezone.utc)
    db.commit()

    return {"item": _serialize_checklist_item(item)}


@router.get("/api/organizations/{org_id}/exhibit/checklists/items/{item_id}/links", response_model=ChecklistItemLinksListResponse, summary="Get item links direct")
def get_item_links_direct(
    org_id: UUID,
    item_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get item links direct."""
    item = db.execute(
        select(ChecklistItem)
        .join(ExhibitionChecklist)
        .join(Exhibition)
        .where(
            ChecklistItem.item_id == item_id,
            Exhibition.organization_id == org_id,
        )
        .options(selectinload(ChecklistItem.links))
    ).scalar_one_or_none()

    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    return {"links": [_serialize_link(link) for link in item.links]}


# ============================================================================
# ENUM ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/exhibit/checklist-enums", response_model=ChecklistEnumsResponse, summary="Get checklist enums")
def get_checklist_enums(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.EXHIBIT_VIEW)),
    db: Session = Depends(get_db),
):
    """Get checklist enums."""
    return {
        "phases": [{"value": p, "label": ChecklistPhase.LABELS[p]} for p in ChecklistPhase.ALL],
        "roles": [{"value": r, "label": ChecklistRole.LABELS[r]} for r in ChecklistRole.ALL],
        "statuses": [{"value": s, "label": ChecklistItemStatus.LABELS[s]} for s in ChecklistItemStatus.ALL],
        "exhibition_types": ChecklistExhibitionType.ALL,
        "link_entity_types": ChecklistLinkEntityType.ALL,
    }
