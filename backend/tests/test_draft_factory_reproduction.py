"""1B parity proof for the `reproduction_request` entity.

Also exercises the draft-only request-number auto-generation: the API requires a
client-supplied number, but a proposed draft omits it and the create function
generates a REP sequence.
"""

from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import Organization, ReproductionRequest, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.reproduction_request import (
    create_reproduction_request,
)
from app.services.drafts.draft_service import approve_draft

_PARITY_FIELDS = (
    "requester_name",
    "requester_institution",
    "requester_email",
    "reproduction_type",
    "reproduction_purpose",
    "intended_use",
    "quantity",
    "format_requested",
    "dimensions_requested",
    "credit_line_required",
    "fee_type",
    "fee_amount",
    "fee_currency",
    "notes",
    "status",
    "created_by",
    "updated_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Repro Test Museum", slug=f"rep-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"rights-{uuid4().hex[:8]}@example.com", display_name="RS")
    db_session.add(u)
    db_session.commit()
    return u


def _payload() -> dict:
    # No request_number — both paths auto-generate distinct REP numbers.
    return {
        "requester_name": "Dr. Ada Scholar",
        "reproduction_type": "scan",
        "requester_institution": "University Press",
        "requester_email": "ada@example.edu",
        "reproduction_purpose": "publication",
        "intended_use": "Monograph figure 3.",
        "quantity": 1,
        "format_requested": "TIFF 600dpi",
        "credit_line_required": "Collection of the Museum.",
        "fee_type": "academic",
        "fee_amount": "75.00",
        "fee_currency": "USD",
        "notes": "Proposed by the Guide.",
    }


def _snapshot(r: ReproductionRequest) -> dict:
    return {f: getattr(r, f) for f in _PARITY_FIELDS}


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    direct = create_reproduction_request(
        db_session, org.organization_id, _payload(), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)

    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="rights_specialist",
        db_session=db_session,
    )
    res = _handler_for("reproduction_request")(_payload(), ctx)
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    applied_row = db_session.get(ReproductionRequest, applied.applied_entity_id)
    assert applied_row is not None
    assert applied_row.fee_amount == Decimal("75.00")
    # Auto-generated request number on the draft path.
    assert applied_row.request_number.startswith("REP")
    assert applied_row.request_number != direct.request_number
    assert _snapshot(applied_row) == snap_direct
