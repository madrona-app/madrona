"""1B parity + approval-gate proof for the `acquisition` entity.

Acquisition is approval-gated, so beyond row parity this verifies the gate is
not doubled: when an org requires acquisition sign-off, the *draft* carries the
approval, and the applied acquisition lands in its post-approval state with no
second ApprovalRequest opened against the acquisition itself.
"""

from decimal import Decimal
from uuid import UUID, uuid4

import pytest

from app.models import Acquisition, Organization, User
from app.models.core_org import ApprovalRequest, ApprovalRule
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.acquisition import create_acquisition
from app.services.drafts.draft_service import approve_draft

_PARITY_FIELDS = (
    "acquisition_method",
    "source_name",
    "source_type",
    "funding_source",
    "funding_account",
    "cost",
    "cost_currency",
    "legal_status",
    "provisos",
    "credit_line",
    "objects_count",
    "acquisition_note",
    "status",
    "created_by",
    "updated_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Acq Test Museum", slug=f"acq-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"registrar-{uuid4().hex[:8]}@example.com", display_name="Reg")
    db_session.add(u)
    db_session.commit()
    return u


def _ctx(db_session, org, user):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )


def _payload() -> dict:
    return {
        "acquisition_method": "gift",
        "source_name": "The Estate of A. Donor",
        "source_type": "individual",
        "funding_source": "General fund",
        "cost": "0.00",
        "cost_currency": "USD",
        "legal_status": "clear",
        "credit_line": "Gift of A. Donor, 2026.",
        "objects_count": 3,
        "acquisition_note": "Proposed by the Guide.",
    }


def _snapshot(a: Acquisition) -> dict:
    return {f: getattr(a, f) for f in _PARITY_FIELDS}


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    # No approval rule → both paths land status='proposed'.
    direct = create_acquisition(
        db_session, org.organization_id, _payload(), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)
    assert direct.status == "proposed"

    res = _handler_for("acquisition")(_payload(), _ctx(db_session, org, user))
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    applied_row = db_session.get(Acquisition, applied.applied_entity_id)
    assert applied_row is not None
    assert applied_row.cost == Decimal("0.00")
    assert _snapshot(applied_row) == snap_direct


def test_approval_gate_is_not_doubled(db_session, org, user):
    """With an acquisition/create rule, the DRAFT carries the gate; the applied
    acquisition is already 'proposed' and opens no second ApprovalRequest."""
    from app.services.approval_service import review_approval

    db_session.add(ApprovalRule(
        organization_id=org.organization_id,
        entity_type="acquisition",
        trigger_action="create",
        approver_permission="acquisitions.approve",
    ))
    db_session.flush()

    res = _handler_for("acquisition")(_payload(), _ctx(db_session, org, user))
    from app.models import AgentDraft
    draft = db_session.get(AgentDraft, UUID(res["draft_id"]))
    # The draft itself is gated — bound to a live ApprovalRequest, not yet applied.
    assert draft.status == "pending"
    assert draft.approval_request_id is not None
    assert draft.applied_entity_id is None

    # Approve through the real approvals path → the draft applies.
    review_approval(draft.approval_request_id, user.user_id, "approved", None, db_session)
    db_session.refresh(draft)
    assert draft.status == "approved"

    acq = db_session.get(Acquisition, draft.applied_entity_id)
    assert acq is not None
    # Post-approval state, NOT 'pending_approval'.
    assert acq.status == "proposed"
    # No second gate: nothing was opened against the acquisition entity itself.
    acq_requests = (
        db_session.query(ApprovalRequest)
        .filter(
            ApprovalRequest.entity_type == "acquisition",
            ApprovalRequest.entity_id == acq.acquisition_id,
        )
        .count()
    )
    assert acq_requests == 0
