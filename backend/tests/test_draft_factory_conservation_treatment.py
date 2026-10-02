"""1B parity proof for the `conservation_treatment` entity."""

from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import CollectionObject, ConservationTreatment, Organization, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.conservation_treatment import (
    create_conservation_treatment,
)
from app.services.drafts.draft_service import approve_draft

_PARITY_FIELDS = (
    "treatment_type",
    "conservator_name",
    "conservator_institution",
    "proposal_summary",
    "estimated_duration_days",
    "estimated_cost",
    "estimated_cost_currency",
    "treatment_note",
    "status",
    "created_by",
    "updated_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Conservation Test Museum", slug=f"con-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"conservator-{uuid4().hex[:8]}@example.com", display_name="Cons")
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
        "treatment_type": "cleaning",
        "conservator_name": "M. Restorer",
        "conservator_institution": "Conservation Lab",
        "proposal_summary": "Surface clean and consolidate flaking paint.",
        "estimated_duration_days": 14,
        "estimated_cost": "3200.00",
        "estimated_cost_currency": "USD",
        "treatment_note": "Proposed by the Guide.",
    }


def _snapshot(t: ConservationTreatment) -> dict:
    return {f: getattr(t, f) for f in _PARITY_FIELDS}


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    obj_a = _object(db_session, org, "CT-A")
    obj_b = _object(db_session, org, "CT-B")

    direct = create_conservation_treatment(
        db_session, org.organization_id, _payload(obj_a.object_id), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)
    assert direct.status == "proposed"

    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="conservator",
        db_session=db_session,
    )
    res = _handler_for("conservation_treatment")(_payload(obj_b.object_id), ctx)
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    applied_row = db_session.get(ConservationTreatment, applied.applied_entity_id)
    assert applied_row is not None
    assert applied_row.treatment_number.startswith("CON")
    assert applied_row.estimated_cost == Decimal("3200.00")
    assert _snapshot(applied_row) == snap_direct
