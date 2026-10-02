"""1B parity proof for the `valuation` entity.

The whole point of extracting `create_valuation` is that the draft applier and
the API router produce the *same* row from the same input — no drift. This
snapshots the row built by a direct `create_valuation` call against the row
produced by the full propose → approve → apply path and asserts field-for-field
equality (the two run on separate objects so the un-mark-prior-current side
effect doesn't cross-contaminate).
"""

from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import CollectionObject, Organization, User, Valuation
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.valuation import create_valuation
from app.services.drafts.draft_service import approve_draft

# Fields that must match between the two create paths (excludes identity,
# linkage to the specific object, and timestamps).
_PARITY_FIELDS = (
    "valuation_type",
    "valuation_amount",
    "valuation_currency",
    "valuation_date",
    "valuator_name",
    "valuator_organization",
    "valuator_credentials",
    "valuation_method",
    "documentation_reference",
    "valuation_note",
    "valid_from",
    "valid_until",
    "is_current",
    "authorization_note",
    "created_by",
    "updated_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Valuation Test Museum", slug=f"val-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"registrar-{uuid4().hex[:8]}@example.com", display_name="Reg")
    db_session.add(u)
    db_session.commit()
    return u


def _make_object(db_session, org) -> CollectionObject:
    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=f"2026.{uuid4().hex[:6]}",
    )
    db_session.add(obj)
    db_session.commit()
    return obj


def _snapshot(v: Valuation) -> dict:
    return {f: getattr(v, f) for f in _PARITY_FIELDS}


def _payload(object_id) -> dict:
    return {
        "object_id": str(object_id),
        "valuation_type": "insurance",
        "valuation_amount": "12500.00",
        "valuation_currency": "USD",
        "valuation_date": "2026-05-01",
        "valuator_name": "Jane Appraiser",
        "valuation_method": "comparable_sales",
        "valuation_note": "Pre-loan insurance valuation.",
        "is_current": True,
    }


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    obj_a = _make_object(db_session, org)
    obj_b = _make_object(db_session, org)

    # Path A — the shared create function directly (what the router now calls).
    direct = create_valuation(
        db_session, org.organization_id, _payload(obj_a.object_id), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)

    # Path B — propose → approve → apply (the factory applier reuses create_fn).
    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )
    res = _handler_for("valuation")(_payload(obj_b.object_id), ctx)
    assert "error" not in res, res
    draft_id = res["draft_id"]
    db_session.commit()

    applied = approve_draft(db_session, draft_id, user.user_id)
    assert applied.applied_entity_id is not None
    assert applied.apply_error is None

    applied_row = db_session.get(Valuation, applied.applied_entity_id)
    assert applied_row is not None
    assert applied_row.object_id == obj_b.object_id
    assert applied_row.valuation_amount == Decimal("12500.00")

    # Field-for-field parity between the two paths.
    assert _snapshot(applied_row) == snap_direct


def test_marking_current_supersedes_prior_on_apply(db_session, org, user):
    obj = _make_object(db_session, org)
    # Seed an existing current insurance valuation directly.
    prior = create_valuation(
        db_session, org.organization_id, _payload(obj.object_id), user.user_id,
        open_approval=False,
    )
    db_session.commit()
    assert prior.is_current is True

    # A draft proposing another current insurance valuation, once applied,
    # supersedes the prior one (the side effect lives in create_valuation).
    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )
    res = _handler_for("valuation")(_payload(obj.object_id), ctx)
    db_session.commit()
    approve_draft(db_session, res["draft_id"], user.user_id)

    db_session.refresh(prior)
    current = (
        db_session.query(Valuation)
        .filter(
            Valuation.object_id == obj.object_id,
            Valuation.valuation_type == "insurance",
            Valuation.is_current.is_(True),
        )
        .all()
    )
    assert prior.is_current is False
    assert len(current) == 1
