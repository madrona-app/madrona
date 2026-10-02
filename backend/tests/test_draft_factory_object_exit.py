"""1B parity + side-effect proof for the `object_exit` entity."""

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import ObjectEntry, ObjectExit, Organization, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.object_exit import create_object_exit
from app.services.drafts.draft_service import approve_draft

_PARITY_FIELDS = (
    "exit_reason",
    "recipient_name",
    "recipient_address",
    "reference_type",
    "exit_method",
    "insurance_value",
    "insurance_currency",
    "exit_note",
    "status",
    "authorization_id",
    "created_by",
    "updated_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Exit Test Museum", slug=f"ex-{uuid4().hex[:8]}")
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


def _entry(db_session, org, num) -> ObjectEntry:
    e = ObjectEntry(
        organization_id=org.organization_id,
        entry_number=num,
        entry_date=datetime.now(timezone.utc).date(),
        entry_reason="loan_consideration",
        status="pending",
    )
    db_session.add(e)
    db_session.commit()
    return e


def _payload(**extra) -> dict:
    base = {
        "exit_reason": "loan_return",
        "recipient_name": "Partner Museum",
        "recipient_address": "1 Museum Way",
        "exit_method": "courier",
        "insurance_value": "15000.00",
        "insurance_currency": "USD",
        "exit_note": "Returned after exhibition.",
    }
    base.update(extra)
    return base


def _snapshot(x: ObjectExit) -> dict:
    return {f: getattr(x, f) for f in _PARITY_FIELDS}


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    direct = create_object_exit(
        db_session, org.organization_id, _payload(), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)
    assert direct.status == "pending"

    res = _handler_for("object_exit")(_payload(), _ctx(db_session, org, user))
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    applied_row = db_session.get(ObjectExit, applied.applied_entity_id)
    assert applied_row is not None
    assert applied_row.exit_number.startswith("EX")
    assert applied_row.insurance_value == Decimal("15000.00")
    assert _snapshot(applied_row) == snap_direct


def test_apply_links_entry_outcome(db_session, org, user):
    entry = _entry(db_session, org, "E-LINK")
    res = _handler_for("object_exit")(
        _payload(exit_reason="loan_return", entry_id=str(entry.entry_id)),
        _ctx(db_session, org, user),
    )
    db_session.commit()
    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    exit_row = db_session.get(ObjectExit, applied.applied_entity_id)

    db_session.refresh(entry)
    assert entry.outcome == "returned"
    assert entry.outcome_reference_id == exit_row.exit_id
    assert entry.return_date == exit_row.exit_date
