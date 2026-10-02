"""1B parity proofs for the `loan_in` and `loan_out` entities."""

from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import LoanIn, LoanOut, Organization, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.loan_in import create_loan_in
from app.services.collections.creation.loan_out import create_loan_out
from app.services.drafts.draft_service import approve_draft


@pytest.fixture
def org(db_session):
    o = Organization(name="Loan Test Museum", slug=f"loan-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"loans-{uuid4().hex[:8]}@example.com", display_name="LR")
    db_session.add(u)
    db_session.commit()
    return u


def _ctx(db_session, org, user):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="loans_registrar",
        db_session=db_session,
    )


_LOAN_IN_FIELDS = (
    "loan_purpose", "lender_name", "exhibition_name", "loan_conditions",
    "special_requirements", "insurance_value", "insurance_currency",
    "loan_note", "status", "created_by", "updated_by",
)
_LOAN_OUT_FIELDS = (
    "loan_purpose", "borrower_name", "venue_name", "venue_address",
    "exhibition_title", "loan_conditions", "insurance_requirements",
    "insurance_value_total", "insurance_currency", "loan_note", "status",
    "created_by", "updated_by",
)


def test_loan_in_router_and_applier_identical(db_session, org, user):
    payload = {
        "loan_purpose": "exhibition",
        "lender_name": "Regional Gallery",
        "exhibition_name": "Modern Voices",
        "loan_conditions": "Climate control required.",
        "special_requirements": "Crating by lender.",
        "insurance_value": "500000.00",
        "insurance_currency": "USD",
        "loan_note": "Proposed by the Guide.",
    }
    direct = create_loan_in(
        db_session, org.organization_id, dict(payload), user.user_id, open_approval=True
    )
    db_session.flush()
    snap = {f: getattr(direct, f) for f in _LOAN_IN_FIELDS}
    assert direct.status == "requested"

    res = _handler_for("loan_in")(dict(payload), _ctx(db_session, org, user))
    assert "error" not in res, res
    db_session.commit()
    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    row = db_session.get(LoanIn, applied.applied_entity_id)
    assert row.loan_number.startswith("LI")
    assert row.insurance_value == Decimal("500000.00")
    assert {f: getattr(row, f) for f in _LOAN_IN_FIELDS} == snap


def test_loan_out_router_and_applier_identical(db_session, org, user):
    payload = {
        "loan_purpose": "touring",
        "borrower_name": "National Museum",
        "venue_name": "Grand Hall",
        "venue_address": "100 Capital Ave",
        "exhibition_title": "Treasures Abroad",
        "loan_conditions": "Couriered both ways.",
        "insurance_requirements": "Wall-to-wall, nail-to-nail.",
        "insurance_value_total": "1200000.00",
        "insurance_currency": "USD",
        "loan_note": "Proposed by the Guide.",
    }
    direct = create_loan_out(
        db_session, org.organization_id, dict(payload), user.user_id, open_approval=True
    )
    db_session.flush()
    snap = {f: getattr(direct, f) for f in _LOAN_OUT_FIELDS}
    assert direct.status == "requested"

    res = _handler_for("loan_out")(dict(payload), _ctx(db_session, org, user))
    assert "error" not in res, res
    db_session.commit()
    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    row = db_session.get(LoanOut, applied.applied_entity_id)
    assert row.loan_number.startswith("LO")
    assert row.insurance_value_total == Decimal("1200000.00")
    assert {f: getattr(row, f) for f in _LOAN_OUT_FIELDS} == snap


def test_loan_out_references_venue_constituent(db_session, org, user):
    # The venue can be a real constituent reference, not just free text.
    from app.models import Constituent

    venue = Constituent(
        organization_id=org.organization_id,
        constituent_type="organization",
        name="Grand Hall Museum",
    )
    db_session.add(venue)
    db_session.flush()

    res = _handler_for("loan_out")(
        {"loan_purpose": "touring", "venue_id": str(venue.constituent_id),
         "venue_name": "Grand Hall"},
        _ctx(db_session, org, user),
    )
    assert "error" not in res, res
    db_session.commit()
    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    row = db_session.get(LoanOut, applied.applied_entity_id)
    assert row.venue_id == venue.constituent_id  # referenced, not just named
