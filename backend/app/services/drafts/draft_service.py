"""Draft lifecycle service (Guide Studio v1 Phase 1).

create → (approve) → apply-to-live. Drafts never write live entities directly;
`apply_draft` cascades an approved draft through the same create logic the API
uses, inside a savepoint. Per-entity appliers and payload schemas are derived
from the declarative factory (`services/drafts/factory`) and sourced lazily here
via `_get_dispatch()` / `_get_payload_schemas()` (lazy to break the
draft_service ↔ factory import cycle), so a new entity type (v2 scale-out) is one
`EntityDraftSpec` declaration, not a new code path.

Approval binding (v1 §1.5): when a procedure rule governs the entity+action,
`create_draft` opens the live `ApprovalRequest` and links it. The
approval-triggered auto-apply (review_approval → apply_draft, mirroring
`handle_approval_decision`) is the next integration; `approve_draft` is the
explicit path for now.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from uuid import UUID

from app.config import get_settings
from app.models.agent_drafts import AgentDraft

logger = logging.getLogger(__name__)

# Payload-schema registry and apply dispatch are sourced lazily from the
# factory (services/drafts/factory). Lazy because the factory's generator
# imports this module — building either table at import time would close the
# cycle. Both are cached after first build.
_PAYLOAD_SCHEMAS_CACHE: dict | None = None
_DISPATCH_CACHE: dict | None = None


def _get_payload_schemas() -> dict:
    """entity_type → Pydantic payload schema, from the factory spec list."""
    global _PAYLOAD_SCHEMAS_CACHE
    if _PAYLOAD_SCHEMAS_CACHE is None:
        from app.services.drafts.factory.registry import build_payload_schemas

        _PAYLOAD_SCHEMAS_CACHE = build_payload_schemas()
    return _PAYLOAD_SCHEMAS_CACHE


def _get_dispatch() -> dict:
    """entity_type → applier(session, draft) -> applied_entity_id."""
    global _DISPATCH_CACHE
    if _DISPATCH_CACHE is None:
        from app.services.drafts.factory.wiring import build_apply_dispatch

        _DISPATCH_CACHE = build_apply_dispatch()
    return _DISPATCH_CACHE


class DraftValidationError(ValueError):
    """Payload failed entity-type schema validation."""


class DraftStateError(ValueError):
    """Operation not valid for the draft's current status."""


class DraftSensitivityError(ValueError):
    """The target record requires authorization this draft can't assert
    (v1 §7.3). Carries a persona-facing reason for the planner to surface."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _model_identity() -> dict[str, str | None]:
    """Pin which model produced a draft, for the audit trail (v1 §7.4)."""
    s = get_settings()
    return {
        "model_provider": getattr(s, "agent_provider", None),
        "model_id": getattr(s, "agent_model", None),
        # No Madrona provider reports a version distinct from the model id yet.
        "model_version": None,
    }


# ── Create / lifecycle ──────────────────────────────────────────────────────


def create_draft(
    ctx,
    *,
    entity_type: str,
    intended_action: str = "create",
    payload: dict,
    rationale: str | None = None,
    citations: list[dict] | None = None,
    assigned_to_user_id=None,
    cardinality: str = "single",
    target_entity_ids: list | None = None,
    sensitivity_entity_type: str | None = None,
) -> AgentDraft:
    """Validate a proposed write against the entity-type schema and persist it
    as a pending draft. Raises DraftValidationError on a bad/extra-field payload.

    `assigned_to_user_id` directs a rule-bound draft's approval to a specific
    person (who must hold the approver permission); otherwise it's open to any
    holder.

    `cardinality='batch'` applies `payload` to every id in `target_entity_ids`
    as one all-or-nothing unit (§1C). For 'single' (the default) the payload
    targets one entity and `target_entity_ids` is ignored.
    """
    from app.models.agent_drafts import DRAFT_CARDINALITIES

    if cardinality not in DRAFT_CARDINALITIES:
        raise DraftValidationError(
            f"invalid cardinality {cardinality!r}; "
            f"must be one of {DRAFT_CARDINALITIES}"
        )
    if cardinality == "batch":
        if not isinstance(target_entity_ids, list) or not target_entity_ids:
            raise DraftValidationError(
                "a batch draft requires a non-empty target_entity_ids list"
            )
    else:
        target_entity_ids = None

    schema = _get_payload_schemas().get(entity_type)
    if schema is None:
        raise DraftValidationError(
            f"no draft schema registered for entity_type {entity_type!r}"
        )
    try:
        validated = schema.model_validate(payload)
    except Exception as e:  # pydantic ValidationError
        raise DraftValidationError(f"invalid {entity_type} payload: {e}") from e

    session = ctx.db_session
    conversation_id = getattr(ctx, "conversation_id", None)

    # Record-level sensitivity gate (§7.3): refuse before doing any further
    # work if the target record requires authorization this draft can't assert.
    from app.services.drafts.sensitivity import check_record_sensitivity

    sensitivity = check_record_sensitivity(
        session,
        persona=ctx.persona,
        entity_type=entity_type,
        action=intended_action,
        payload=validated,
        organization_id=ctx.organization_id,
        sensitivity_entity_type=sensitivity_entity_type,
    )
    if not sensitivity.allowed:
        raise DraftSensitivityError(sensitivity.reason)

    # Citation enforcement (§7.2): every cited source must resolve, or the draft
    # is rejected — hallucinated provenance never reaches the audit trail.
    if citations:
        from app.services.drafts.citation_validator import CitationValidator

        bad = CitationValidator(session, conversation_id).unresolved(citations)
        if bad:
            raise DraftValidationError(
                f"unresolvable citations: {', '.join(bad)}"
            )

    # Resolve the governing approval rule up front. When the draft directs its
    # approval to a specific reviewer (§7.5), validate that reviewer holds the
    # approver permission BEFORE persisting — a rejected assignment must never
    # orphan a pending draft. (Assignment only has a home when a rule exists; a
    # directed draft with no rule is created open, per the tool contract.)
    from app.services.approval_service import (
        check_approval_required,
        create_approval_request,
    )

    rule = check_approval_required(
        ctx.organization_id, entity_type, intended_action, session
    )
    if assigned_to_user_id is not None and rule is not None:
        from app.services.rbac_service import check_permission

        try:
            assignee_uuid = (
                assigned_to_user_id
                if isinstance(assigned_to_user_id, UUID)
                else UUID(str(assigned_to_user_id))
            )
        except (ValueError, TypeError):
            raise DraftValidationError(
                f"invalid assign_to_user_id: {assigned_to_user_id!r}"
            )
        if not check_permission(
            assignee_uuid, ctx.organization_id, rule.approver_permission,
            session=session,
        ):
            raise DraftValidationError(
                f"user {assignee_uuid} cannot be the reviewer — they do not hold "
                f"the {rule.approver_permission!r} permission required to approve "
                f"a {entity_type}"
            )

    ident = _model_identity()
    target_id = None
    if intended_action != "create":
        target_id = getattr(validated, "object_id", None)

    draft = AgentDraft(
        organization_id=ctx.organization_id,
        conversation_id=conversation_id,
        # Plan provenance, set when this draft is proposed from inside a plan
        # step (the executor stamps these on ctx). Lets a draft_approval await
        # find and resume the right plan step when this draft is applied.
        plan_id=getattr(ctx, "plan_id", None),
        plan_step_id=getattr(ctx, "plan_step_id", None),
        proposed_by_user_id=ctx.user_id,
        proposed_by_persona=ctx.persona,
        entity_type=entity_type,
        intended_action=intended_action,
        target_entity_id=target_id,
        cardinality=cardinality,
        target_entity_ids=[str(t) for t in target_entity_ids] if target_entity_ids else None,
        # Batch payloads are partial updates: keep only the fields the caller
        # actually set, so unset fields aren't applied as NULL to every target.
        payload=validated.model_dump(
            mode="json", exclude_unset=(cardinality == "batch")
        ),
        rationale=rationale,
        citations=citations or None,  # validated above (§7.2)
        status="pending",
        model_provider=ident["model_provider"],
        model_id=ident["model_id"],
        model_version=ident["model_version"],
    )
    session.add(draft)
    session.flush()

    if rule is not None:
        req = create_approval_request(
            rule=rule,
            entity_type="agent_draft",
            entity_id=draft.draft_id,
            requested_by=ctx.user_id,
            requested_action={
                "draft_id": str(draft.draft_id),
                "entity_type": entity_type,
                "action": intended_action,
            },
            session=session,
            assigned_to_user_id=assigned_to_user_id,
        )
        draft.approval_request_id = req.request_id
        session.flush()

    return draft


def update_draft(session, draft_id, payload: dict) -> AgentDraft | None:
    """Edit a pending draft's payload in place (v1 §1.1 edit-in-place). The new
    payload is re-validated against the entity schema; pending drafts only."""
    draft = session.get(AgentDraft, draft_id)
    if draft is None:
        return None
    if draft.status != "pending":
        raise DraftStateError(
            f"draft {draft_id} is {draft.status!r}; only pending drafts are editable"
        )
    schema = _get_payload_schemas().get(draft.entity_type)
    if schema is None:
        raise DraftValidationError(
            f"no draft schema registered for entity_type {draft.entity_type!r}"
        )
    try:
        validated = schema.model_validate(payload)
    except Exception as e:  # pydantic ValidationError
        raise DraftValidationError(
            f"invalid {draft.entity_type} payload: {e}"
        ) from e
    draft.payload = validated.model_dump(mode="json")
    session.flush()
    return draft


def approve_draft(session, draft_id, user_id) -> AgentDraft | None:
    """Approve a pending draft and cascade it to the live entity."""
    draft = session.get(AgentDraft, draft_id)
    if draft is None:
        return None
    if draft.status != "pending":
        raise DraftStateError(f"draft {draft_id} is {draft.status!r}, not pending")
    draft.status = "approved"
    draft.decided_by_user_id = user_id
    draft.decided_at = _now()
    session.flush()
    applied = apply_draft(session, draft_id)
    # Draft-chaining: resume any plan step parked on this draft, threading the
    # freshly-applied entity id in. Fires here (not in handle_draft_decision) so
    # BOTH paths are covered — gated drafts via review_approval and ungated
    # drafts approved directly through the drafts inbox. Best-effort: a plan
    # signal must never break the draft decision itself.
    try:
        _signal_draft_approval_awaits(session, applied or draft)
    except Exception:  # noqa: BLE001
        logger.exception(
            "draft_approval plan signal failed for draft %s", draft_id
        )
    return applied


def reject_draft(session, draft_id, user_id, note: str | None = None) -> AgentDraft | None:
    draft = session.get(AgentDraft, draft_id)
    if draft is None:
        return None
    if draft.status != "pending":
        raise DraftStateError(f"draft {draft_id} is {draft.status!r}, not pending")
    draft.status = "rejected"
    draft.decided_by_user_id = user_id
    draft.decided_at = _now()
    draft.apply_error = note or None
    session.flush()
    # Draft-chaining: a rejected draft fails the plan step parked on it (so the
    # plan halts cleanly rather than waiting forever). Same dual-path rationale
    # as approve_draft.
    try:
        _signal_draft_approval_awaits(session, draft)
    except Exception:  # noqa: BLE001
        logger.exception(
            "draft_approval plan signal failed for draft %s", draft_id
        )
    return draft


def cancel_draft(session, draft_id, user_id) -> AgentDraft | None:
    draft = session.get(AgentDraft, draft_id)
    if draft is None:
        return None
    if draft.status not in ("pending", "approved"):
        raise DraftStateError(
            f"draft {draft_id} is {draft.status!r}; only pending/approved cancel"
        )
    draft.status = "cancelled"
    draft.decided_by_user_id = user_id
    draft.decided_at = _now()
    session.flush()
    return draft


def handle_draft_decision(request_id, session) -> int:
    """Hook called by `approval_service.review_approval` after an approval is
    decided. Applies the draft bound to this request (approved) or rejects it
    (rejected). Returns the number of drafts handled.

    Idempotent: a second call finds no *pending* draft for the request and
    returns 0. Drafts gated on a procedure rule reach the live entity only
    through this path — the approval is the gate.
    """
    from app.models.core_org import ApprovalRequest

    request = (
        session.query(ApprovalRequest)
        .filter(ApprovalRequest.request_id == request_id)
        .first()
    )
    if request is None or request.status not in ("approved", "rejected"):
        return 0

    drafts = (
        session.query(AgentDraft)
        .filter(
            AgentDraft.approval_request_id == request_id,
            AgentDraft.status == "pending",
        )
        .all()
    )

    handled = 0
    for draft in drafts:
        if request.status == "approved":
            approve_draft(session, draft.draft_id, request.reviewed_by)
        else:
            reject_draft(
                session, draft.draft_id, request.reviewed_by, request.review_note
            )
        handled += 1
    return handled


def _signal_draft_approval_awaits(session, draft) -> int:
    """Signal plan steps parked on `draft` (wait_for.kind='draft_approval',
    draft_id=this draft) now that it has been decided + applied.

    Approved AND applied -> outcome 'approved' carrying applied_entity_id (which
    later steps thread via {"$from_step": ...}). Rejected, or approved but the
    apply failed (no live entity), -> outcome 'rejected' with the reason, so the
    plan fails cleanly rather than proceeding without the record it needed.
    """
    from app.models import AgentPlanStep
    from app.services.agent_plan_service import PlanService

    steps = (
        session.query(AgentPlanStep)
        .filter(
            AgentPlanStep.status.in_(("awaiting_user", "awaiting_external")),
            AgentPlanStep.wait_for.op("->>")("kind") == "draft_approval",
            AgentPlanStep.wait_for.op("->>")("draft_id") == str(draft.draft_id),
        )
        .all()
    )
    if not steps:
        return 0

    applied = draft.applied_at is not None
    if draft.status == "approved" and applied:
        signal_data = {
            "kind": "draft_approval",
            "draft_id": str(draft.draft_id),
            "outcome": "approved",
            "applied_entity_id": (
                str(draft.applied_entity_id) if draft.applied_entity_id else None
            ),
        }
    else:
        signal_data = {
            "kind": "draft_approval",
            "draft_id": str(draft.draft_id),
            "outcome": "rejected",
            "note": draft.apply_error or "draft rejected",
        }

    for step in steps:
        PlanService(session).signal(step.plan_id, step.step_id, signal_data)
    return len(steps)


def apply_draft(session, draft_id) -> AgentDraft | None:
    """Cascade an approved draft to its live entity(ies), in a savepoint.
    Idempotent (a draft already applied is a no-op via `applied_at`). On failure
    the draft keeps its approved status with `apply_error` set, so it can be
    retried after edit.

    A batch draft (`cardinality='batch'`) applies its payload to every id in
    `target_entity_ids` inside the SAME savepoint — all-or-nothing: one failing
    item rolls the whole batch back. The applier returns per-item outcomes which
    are recorded in `apply_result`; a single draft's applier returns the created
    entity id (`applied_entity_id`)."""
    draft = session.get(AgentDraft, draft_id)
    if draft is None:
        return None
    if draft.applied_at is not None:  # universal idempotency marker
        return draft
    if draft.status != "approved":
        raise DraftStateError(f"draft {draft_id} is {draft.status!r}, not approved")

    applier = _get_dispatch().get(draft.entity_type)
    if applier is None:
        draft.apply_error = f"no applier registered for entity_type {draft.entity_type!r}"
        session.flush()
        return draft

    try:
        with session.begin_nested():
            result = applier(session, draft)
        if draft.cardinality == "batch":
            draft.apply_result = result  # per-item outcomes
        else:
            draft.applied_entity_id = result  # the created entity id
        draft.applied_at = _now()
        draft.apply_error = None
    except Exception as e:  # noqa: BLE001
        logger.exception("apply_draft failed for %s", draft_id)
        draft.apply_error = f"apply_failed: {e}"
    session.flush()
    return draft
