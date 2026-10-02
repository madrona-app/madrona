"""Per-user workspace layout overrides — CRUD + activation.

Personal preferences: every route is scoped to the authenticated user
(`auth.user_id`) within their active organization. No special permission is
required — the ownership boundary is the user, not a role. RLS context is set by
`require_auth`; queries additionally filter on organization_id + user_id.

The "exactly one active variant per (user, surface_key, object_type)" invariant
is enforced at the DB level by a partial unique index; activation deactivates
siblings first (within the request transaction) so the switch never collides.
"""
from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth
from app.fastapi_app.schemas.layout_overrides import (
    FormLayoutDelta,
    LayoutDeactivateRequest,
    LayoutOverrideCreate,
    LayoutOverrideOut,
    LayoutOverrideUpdate,
    LayoutSuggestRequest,
)
from app.models.layout_preferences import UserLayoutOverride
from app.services.layout_suggester import (
    CatalogSection,
    LayoutSuggestionError,
    suggest_layout_delta,
)

router = APIRouter(tags=["layout-overrides"])

_BASE = "/api/layout-overrides"


def _require_active_org(auth: AuthContext) -> UUID:
    if auth.active_organization_id is None:
        raise HTTPException(
            status_code=400, detail="No active organization for this session"
        )
    return auth.active_organization_id


def _get_owned(
    db: Session, override_id: UUID, user_id: UUID, org_id: UUID
) -> UserLayoutOverride:
    obj = (
        db.query(UserLayoutOverride)
        .filter(
            UserLayoutOverride.id == override_id,
            UserLayoutOverride.user_id == user_id,
            UserLayoutOverride.organization_id == org_id,
        )
        .first()
    )
    if obj is None:
        raise HTTPException(status_code=404, detail="Layout override not found")
    return obj


def _deactivate_siblings(
    db: Session,
    *,
    user_id: UUID,
    org_id: UUID,
    surface_key: str,
    object_type: str | None,
    exclude_id: UUID | None = None,
) -> None:
    """Clear the active flag on the user's other variants for the same
    (surface_key, object_type) slot, so a fresh activation can't collide with
    the partial unique index."""
    q = db.query(UserLayoutOverride).filter(
        UserLayoutOverride.user_id == user_id,
        UserLayoutOverride.organization_id == org_id,
        UserLayoutOverride.surface_key == surface_key,
        UserLayoutOverride.is_active.is_(True),
    )
    q = (
        q.filter(UserLayoutOverride.object_type.is_(None))
        if object_type is None
        else q.filter(UserLayoutOverride.object_type == object_type)
    )
    if exclude_id is not None:
        q = q.filter(UserLayoutOverride.id != exclude_id)
    q.update({UserLayoutOverride.is_active: False}, synchronize_session=False)
    db.flush()


@router.get(_BASE, response_model=list[LayoutOverrideOut], summary="List my layout variants")
def list_overrides(
    surface_key: str | None = Query(default=None),
    object_type: str | None = Query(default=None),
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> list[UserLayoutOverride]:
    org_id = _require_active_org(auth)
    q = db.query(UserLayoutOverride).filter(
        UserLayoutOverride.user_id == auth.user_id,
        UserLayoutOverride.organization_id == org_id,
    )
    if surface_key is not None:
        q = q.filter(UserLayoutOverride.surface_key == surface_key)
    if object_type is not None:
        q = q.filter(UserLayoutOverride.object_type == object_type)
    return q.order_by(UserLayoutOverride.created_at.asc()).all()


@router.post(
    _BASE + "/suggest",
    response_model=FormLayoutDelta,
    summary="AI-draft a layout delta from a description (preview, not saved)",
)
def suggest_override(
    body: LayoutSuggestRequest,
    auth: AuthContext = Depends(require_auth),
) -> FormLayoutDelta:
    _require_active_org(auth)
    sections = [
        CatalogSection(
            id=s.id, label=s.label, group=s.group, required=s.required
        )
        for s in body.sections
    ]
    try:
        return suggest_layout_delta(get_settings(), body.instruction, sections)
    except LayoutSuggestionError as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.post(
    _BASE,
    response_model=LayoutOverrideOut,
    status_code=201,
    summary="Create a layout variant",
)
def create_override(
    body: LayoutOverrideCreate,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> UserLayoutOverride:
    org_id = _require_active_org(auth)
    obj = UserLayoutOverride(
        organization_id=org_id,
        user_id=auth.user_id,
        surface_key=body.surface_key,
        object_type=body.object_type,
        name=body.name,
        delta=body.delta.model_dump(),
        base_version=body.base_version,
        is_active=False,
    )
    if body.make_active:
        _deactivate_siblings(
            db,
            user_id=auth.user_id,
            org_id=org_id,
            surface_key=body.surface_key,
            object_type=body.object_type,
        )
        obj.is_active = True
    db.add(obj)
    db.commit()
    db.refresh(obj)
    return obj


@router.patch(
    _BASE + "/{override_id}",
    response_model=LayoutOverrideOut,
    summary="Rename or re-edit a layout variant",
)
def update_override(
    override_id: UUID,
    body: LayoutOverrideUpdate,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> UserLayoutOverride:
    org_id = _require_active_org(auth)
    obj = _get_owned(db, override_id, auth.user_id, org_id)
    if body.name is not None:
        obj.name = body.name
    if body.delta is not None:
        obj.delta = body.delta.model_dump()
    db.commit()
    db.refresh(obj)
    return obj


@router.post(
    _BASE + "/deactivate",
    status_code=204,
    summary="Switch a surface back to the default layout (no active variant)",
)
def deactivate_override(
    body: LayoutDeactivateRequest,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> Response:
    org_id = _require_active_org(auth)
    _deactivate_siblings(
        db,
        user_id=auth.user_id,
        org_id=org_id,
        surface_key=body.surface_key,
        object_type=body.object_type,
    )
    db.commit()
    return Response(status_code=204)


@router.post(
    _BASE + "/{override_id}/activate",
    response_model=LayoutOverrideOut,
    summary="Make a layout variant the active one for its surface",
)
def activate_override(
    override_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> UserLayoutOverride:
    org_id = _require_active_org(auth)
    obj = _get_owned(db, override_id, auth.user_id, org_id)
    if not obj.is_active:
        _deactivate_siblings(
            db,
            user_id=auth.user_id,
            org_id=org_id,
            surface_key=obj.surface_key,
            object_type=obj.object_type,
            exclude_id=obj.id,
        )
        obj.is_active = True
        db.commit()
        db.refresh(obj)
    return obj


@router.delete(
    _BASE + "/{override_id}",
    status_code=204,
    summary="Delete a layout variant",
)
def delete_override(
    override_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> Response:
    org_id = _require_active_org(auth)
    obj = _get_owned(db, override_id, auth.user_id, org_id)
    db.delete(obj)
    db.commit()
    return Response(status_code=204)
