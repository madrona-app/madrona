"""1B parity + approval-gate proof for the `deaccession` entity."""

from uuid import UUID, uuid4

import pytest

from app.models import (
    CollectionObject,
    Deaccession,
    DeaccessionAudit,
    Organization,
    User,
)
from app.models.core_org import ApprovalRequest, ApprovalRule
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.deaccession import create_deaccession
from app.services.drafts.draft_service import approve_draft

_PARITY_FIELDS = (
    "reason",
    "reason_detail",
    "justification",
    "disposal_method",
    "disposal_method_detail",
    "recipient_name",
    "committee_review_required",
    "board_approval_required",
    "deaccession_note",
    "status",
    "proposed_by",
    "created_by",
    "updated_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Deacc Test Museum", slug=f"da-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"registrar-{uuid4().hex[:8]}@example.com", display_name="Reg")
    db_session.add(u)
    db_session.commit()
    return u


def _object(db_session, org, num) -> CollectionObject:
    obj = CollectionObject(organization_id=org.organization_id, object_number=num)
    db_session.add(obj)
    db_session.commit()
    return obj


def _ctx(db_session, org, user):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )


def _payload(object_id) -> dict:
    return {
        "object_id": str(object_id),
        "reason": "outside_scope",
        "reason_detail": "No longer fits the collecting plan.",
        "justification": "Reviewed by curatorial; recommended for release.",
        "disposal_method": "transfer",
        "recipient_name": "Partner Museum",
        "committee_review_required": True,
        "board_approval_required": True,
        "deaccession_note": "Proposed by the Guide.",
    }


def _snapshot(d: Deaccession) -> dict:
    return {f: getattr(d, f) for f in _PARITY_FIELDS}


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    obj_a = _object(db_session, org, "DA-A")
    obj_b = _object(db_session, org, "DA-B")

    direct = create_deaccession(
        db_session, org.organization_id, _payload(obj_a.object_id), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)
    assert direct.status == "proposed"

    res = _handler_for("deaccession")(_payload(obj_b.object_id), _ctx(db_session, org, user))
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    applied_row = db_session.get(Deaccession, applied.applied_entity_id)
    assert applied_row is not None
    assert _snapshot(applied_row) == snap_direct

    # The audit child record is written through the shared create path.
    audits = (
        db_session.query(DeaccessionAudit)
        .filter(DeaccessionAudit.deaccession_id == applied_row.deaccession_id)
        .all()
    )
    assert len(audits) == 1
    assert audits[0].action == "created"


def test_approval_gate_is_not_doubled(db_session, org, user):
    from app.services.approval_service import review_approval
    from app.models import AgentDraft

    obj = _object(db_session, org, "DA-GATE")
    db_session.add(ApprovalRule(
        organization_id=org.organization_id,
        entity_type="deaccession",
        trigger_action="create",
        approver_permission="deaccession.approve",
    ))
    db_session.flush()

    res = _handler_for("deaccession")(_payload(obj.object_id), _ctx(db_session, org, user))
    draft = db_session.get(AgentDraft, UUID(res["draft_id"]))
    assert draft.status == "pending"
    assert draft.approval_request_id is not None
    assert draft.applied_entity_id is None

    review_approval(draft.approval_request_id, user.user_id, "approved", None, db_session)
    db_session.refresh(draft)
    assert draft.status == "approved"

    deacc = db_session.get(Deaccession, draft.applied_entity_id)
    assert deacc.status == "proposed"
    acq_requests = (
        db_session.query(ApprovalRequest)
        .filter(
            ApprovalRequest.entity_type == "deaccession",
            ApprovalRequest.entity_id == deacc.deaccession_id,
        )
        .count()
    )
    assert acq_requests == 0
