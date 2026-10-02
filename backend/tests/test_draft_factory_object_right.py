"""1B parity proof for the `object_right` entity."""

from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import CollectionObject, ObjectRight, Organization, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.object_right import create_object_right
from app.services.drafts.draft_service import approve_draft

_PARITY_FIELDS = (
    "right_type",
    "right_subtype",
    "status",
    "is_perpetual",
    "territory",
    "license_type",
    "license_reference",
    "usage_conditions",
    "restrictions",
    "fee_required",
    "fee_amount",
    "fee_currency",
    "permissions_granted",
    "right_note",
    "created_by_id",
    "updated_by_id",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Rights Test Museum", slug=f"rt-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"rights-{uuid4().hex[:8]}@example.com", display_name="RS")
    db_session.add(u)
    db_session.commit()
    return u


def _object(db_session, org, num) -> CollectionObject:
    obj = CollectionObject(organization_id=org.organization_id, object_number=num)
    db_session.add(obj)
    db_session.commit()
    return obj


def _payload(object_id) -> dict:
    return {
        "object_id": str(object_id),
        "right_type": "reproduction",
        "right_subtype": "print",
        "status": "licensed",
        "is_perpetual": False,
        "territory": "worldwide",
        "license_type": "CC-BY",
        "license_reference": "LIC-2026-014",
        "usage_conditions": "Credit the museum.",
        "restrictions": "No commercial use.",
        "fee_required": True,
        "fee_amount": "250.00",
        "fee_currency": "USD",
        "permissions_granted": "Single-edition catalog reproduction.",
        "right_note": "Proposed by the Guide.",
    }


def _snapshot(r: ObjectRight) -> dict:
    return {f: getattr(r, f) for f in _PARITY_FIELDS}


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    obj_a = _object(db_session, org, "RT-A")
    obj_b = _object(db_session, org, "RT-B")

    direct = create_object_right(
        db_session, org.organization_id, _payload(obj_a.object_id), user.user_id,
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
    res = _handler_for("object_right")(_payload(obj_b.object_id), ctx)
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    applied_row = db_session.get(ObjectRight, applied.applied_entity_id)
    assert applied_row is not None
    assert applied_row.object_id == obj_b.object_id
    assert applied_row.fee_amount == Decimal("250.00")
    assert _snapshot(applied_row) == snap_direct
