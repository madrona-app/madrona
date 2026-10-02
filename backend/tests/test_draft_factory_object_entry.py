"""1B parity proof for the `object_entry` entity."""

from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import ObjectEntry, Organization, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.object_entry import create_object_entry
from app.services.drafts.draft_service import approve_draft

_PARITY_FIELDS = (
    "entry_reason",
    "entry_method",
    "depositor_name",
    "current_owner",
    "authorization_note",
    "expected_duration",
    "receipt_reference",
    "entry_note",
    "objects_description",
    "insurance_value",
    "insurance_currency",
    "insurance_note",
    "conditions",
    "status",
    "created_by",
    "updated_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Entry Test Museum", slug=f"e-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"registrar-{uuid4().hex[:8]}@example.com", display_name="Reg")
    db_session.add(u)
    db_session.commit()
    return u


def _payload() -> dict:
    return {
        "reason": "loan_consideration",
        "entry_method": "hand_delivery",
        "depositor_name": "A. Lender",
        "current_owner": "Lender Trust",
        "expected_duration": "3 months",
        "receipt_reference": "RCPT-2026-09",
        "entry_note": "Two paintings for exhibition review.",
        "objects_description": "2 oil paintings, framed.",
        "insurance_value": "40000.00",
        "insurance_currency": "USD",
        "conditions": "Climate-controlled handling required.",
    }


def _snapshot(e: ObjectEntry) -> dict:
    return {f: getattr(e, f) for f in _PARITY_FIELDS}


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    direct = create_object_entry(
        db_session, org.organization_id, _payload(), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)
    assert direct.status == "pending"

    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )
    res = _handler_for("object_entry")(_payload(), ctx)
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    applied_row = db_session.get(ObjectEntry, applied.applied_entity_id)
    assert applied_row is not None
    assert applied_row.entry_number.startswith("E")
    assert applied_row.insurance_value == Decimal("40000.00")
    assert _snapshot(applied_row) == snap_direct
