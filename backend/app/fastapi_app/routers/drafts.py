"""Drafts inbox API (Guide Studio v1 §1.4).

The read/act surface over `agent_drafts`: list, detail, edit-in-place,
approve, reject. Rule-bound drafts (those with `approval_request_id`) are
approved through the Approvals page (`review_approval` → `handle_draft_decision`);
this `approve` endpoint serves drafts without a procedure rule and direct review.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Body, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import AgentDraft
from app.permissions import Permission
from app.services.drafts.draft_service import (
    DraftStateError,
    DraftValidationError,
    approve_draft,
    reject_draft,
    update_draft,
)
from app.services.rls import set_rls_context_for_session

logger = logging.getLogger(__name__)

router = APIRouter(tags=["drafts"])


def _serialize_draft(d: AgentDraft) -> dict:
    from app.services.procedure_requirements.draft_validation import (
        validate_draft_against_procedure,
    )

    return {
        "draft_id": str(d.draft_id),
        "entity_type": d.entity_type,
        "intended_action": d.intended_action,
        "status": d.status,
        "payload": d.payload,
        "rationale": d.rationale,
        "citations": d.citations,
        "target_entity_id": str(d.target_entity_id) if d.target_entity_id else None,
        "proposed_by_user_id": str(d.proposed_by_user_id),
        "proposed_by_persona": d.proposed_by_persona,
        "plan_id": str(d.plan_id) if d.plan_id else None,
        "plan_step_id": str(d.plan_step_id) if d.plan_step_id else None,
        "conversation_id": str(d.conversation_id) if d.conversation_id else None,
        "approval_request_id": (
            str(d.approval_request_id) if d.approval_request_id else None
        ),
        "applied_entity_id": (
            str(d.applied_entity_id) if d.applied_entity_id else None
        ),
        "apply_error": d.apply_error,
        "model_provider": d.model_provider,
        "model_id": d.model_id,
        # Pre-approval procedure validation (§7 trust): the procedure this draft
        # follows + how its payload meets that procedure's proposal-stage
        # blocking requirements. None when the entity has no procedure.
        "procedure": validate_draft_against_procedure(d.entity_type, d.payload or {}),
        "created_at": d.created_at.isoformat() if d.created_at else None,
        "decided_at": d.decided_at.isoformat() if d.decided_at else None,
    }


def _get_draft_or_404(db, organization_id: UUID, draft_id: UUID) -> AgentDraft:
    draft = db.query(AgentDraft).filter(AgentDraft.draft_id == draft_id).first()
    if draft is None or draft.organization_id != organization_id:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Draft not found"},
        )
    return draft


@router.get(
    "/api/organizations/{organization_id}/drafts",
    summary="List agent drafts",
)
def list_drafts(
    organization_id: UUID,
    status: str | None = Query(None),
    mine: bool = Query(False),
    plan_id: UUID | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """The drafts inbox, newest first. RLS scopes to the org; `?mine=true`
    narrows to the caller's own proposals, `?status=` and `?plan_id=` filter."""
    set_rls_context_for_session(db, str(organization_id))
    q = db.query(AgentDraft).filter(AgentDraft.organization_id == organization_id)
    if status:
        q = q.filter(AgentDraft.status == status)
    if mine:
        q = q.filter(AgentDraft.proposed_by_user_id == auth.user_id)
    if plan_id:
        q = q.filter(AgentDraft.plan_id == plan_id)
    drafts = q.order_by(AgentDraft.created_at.desc()).all()
    return {"drafts": [_serialize_draft(d) for d in drafts]}


@router.get(
    "/api/organizations/{organization_id}/drafts/count",
    summary="Pending drafts count (for the nav badge)",
)
def drafts_count(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    set_rls_context_for_session(db, str(organization_id))
    count = (
        db.query(AgentDraft)
        .filter(
            AgentDraft.organization_id == organization_id,
            AgentDraft.status == "pending",
        )
        .count()
    )
    return {"count": count}


@router.get(
    "/api/organizations/{organization_id}/drafts/form-schema",
    summary="Editable form-field descriptors for a draft entity type",
)
def draft_form_schema_endpoint(
    organization_id: UUID,
    entity_type: str,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """The field shape (labels, input types, enum options, sections) for editing
    a draft's payload as a real form instead of raw JSON. Derived from the
    entity's draft payload schema + the form registry; no record needed."""
    from app.services.drafts.form_projection import draft_form_schema
    schema = draft_form_schema(entity_type)
    if schema is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": f"no draft schema for {entity_type!r}"},
        )
    return schema


class _RefResolveBody(BaseModel):
    # [{kind, id}] — kind ∈ object | constituent | location | user
    refs: list[dict] = []


@router.post(
    "/api/organizations/{organization_id}/drafts/resolve-refs",
    summary="Resolve referenced-entity ids to display labels (for the draft form)",
)
def resolve_refs(
    organization_id: UUID,
    body: _RefResolveBody,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Turn `*_id` reference values into human labels so the drafts UI shows the
    entity's name/number, never a bare UUID. Batched, grouped by kind."""
    set_rls_context_for_session(db, str(organization_id))

    by_kind: dict[str, set[UUID]] = {}
    for ref in body.refs:
        kind, rid = ref.get("kind"), ref.get("id")
        if not kind or not rid:
            continue
        try:
            by_kind.setdefault(kind, set()).add(UUID(str(rid)))
        except (ValueError, TypeError):
            continue

    labels: dict[str, str] = {}
    for kind, ids in by_kind.items():
        for ent_id, label in _resolve_kind(db, organization_id, kind, ids):
            if label:
                labels[str(ent_id)] = label
    return {"labels": labels}


def _resolve_kind(db, organization_id, kind, ids):
    """Yield (id, label) for one reference kind. Org-scoped."""
    if kind == "object":
        from app.models import CollectionObject as M
        rows = db.query(M.object_id, M.object_number, M.object_name).filter(
            M.organization_id == organization_id, M.object_id.in_(ids))
        for oid, num, name in rows:
            yield oid, " — ".join(x for x in (num, name) if x) or str(oid)
    elif kind == "constituent":
        from app.models import Constituent as M
        for cid, name in db.query(M.constituent_id, M.name).filter(
                M.organization_id == organization_id, M.constituent_id.in_(ids)):
            yield cid, name
    elif kind == "location":
        from app.models import Location as M
        cols = {c.name for c in M.__table__.columns}
        path_col = M.path if "path" in cols else M.name
        for lid, name, path in db.query(M.location_id, M.name, path_col).filter(
                M.organization_id == organization_id, M.location_id.in_(ids)):
            yield lid, path or name
    elif kind == "user":
        from app.models import User as M
        for uid, display, email in db.query(M.user_id, M.display_name, M.email).filter(
                M.user_id.in_(ids)):
            yield uid, display or email


@router.get(
    "/api/organizations/{organization_id}/drafts/{draft_id}",
    summary="Get a draft",
)
def get_draft(
    organization_id: UUID,
    draft_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    set_rls_context_for_session(db, str(organization_id))
    return _serialize_draft(_get_draft_or_404(db, organization_id, draft_id))


@router.patch(
    "/api/organizations/{organization_id}/drafts/{draft_id}",
    summary="Edit a pending draft's payload",
)
def patch_draft(
    organization_id: UUID,
    draft_id: UUID,
    payload: dict = Body(..., embed=True),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_CREATE)),
    db: Session = Depends(get_db),
):
    set_rls_context_for_session(db, str(organization_id))
    _get_draft_or_404(db, organization_id, draft_id)
    try:
        draft = update_draft(db, draft_id, payload)
    except DraftStateError as e:
        raise HTTPException(status_code=409, detail={"code": "bad_state", "message": str(e)})
    except DraftValidationError as e:
        raise HTTPException(status_code=422, detail={"code": "invalid", "message": str(e)})
    db.commit()
    return _serialize_draft(draft)


@router.post(
    "/api/organizations/{organization_id}/drafts/{draft_id}/approve",
    summary="Approve a draft and apply it to the live entity",
)
def approve_draft_endpoint(
    organization_id: UUID,
    draft_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_CREATE)),
    db: Session = Depends(get_db),
):
    set_rls_context_for_session(db, str(organization_id))
    draft = _get_draft_or_404(db, organization_id, draft_id)
    if draft.approval_request_id is not None:
        # Governed by a procedure rule — must be decided via the Approvals page.
        raise HTTPException(
            status_code=409,
            detail={
                "code": "needs_approval_review",
                "message": "This draft is gated on a procedure approval; review it in Approvals.",
            },
        )
    try:
        applied = approve_draft(db, draft_id, auth.user_id)
    except DraftStateError as e:
        raise HTTPException(status_code=409, detail={"code": "bad_state", "message": str(e)})
    db.commit()
    return _serialize_draft(applied)


@router.post(
    "/api/organizations/{organization_id}/drafts/{draft_id}/reject",
    summary="Reject a pending draft",
)
def reject_draft_endpoint(
    organization_id: UUID,
    draft_id: UUID,
    note: str | None = Body(None, embed=True),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_CREATE)),
    db: Session = Depends(get_db),
):
    set_rls_context_for_session(db, str(organization_id))
    _get_draft_or_404(db, organization_id, draft_id)
    try:
        draft = reject_draft(db, draft_id, auth.user_id, note)
    except DraftStateError as e:
        raise HTTPException(status_code=409, detail={"code": "bad_state", "message": str(e)})
    db.commit()
    return _serialize_draft(draft)
