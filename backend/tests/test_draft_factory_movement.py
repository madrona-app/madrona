"""1B parity + side-effect proof for the `movement` entity.

Movement is an aggregate create: it writes the Movement row AND mutates the
part's/object's current location and the affected locations' occupancy counts.
These tests prove (1) the router path and the propose→approve→apply path build
field-for-field identical Movement rows, and (2) applying a movement draft
actually performs the move (object relocated, counts adjusted).
"""

from uuid import uuid4

import pytest

from app.models import (
    CollectionObject,
    Location,
    Movement,
    ObjectPart,
    Organization,
    User,
)
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.movement import create_movement
from app.services.drafts.draft_service import approve_draft

# Fields that must match between the two create paths (excludes identity, the
# per-object linkage, the sequential reference number, and timestamps).
_PARITY_FIELDS = (
    "reason",
    "movement_note",
    "location_fitness",
    "movement_method",
    "authorization_note",
    "handler_name",
    "organization_courier",
    "shipper_name",
    "shipping_method",
    "shipping_note",
    "condition_note",
    "status",
    "authorized_by",
    "moved_by",
    "created_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Movement Test Museum", slug=f"mov-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"registrar-{uuid4().hex[:8]}@example.com", display_name="Reg")
    db_session.add(u)
    db_session.commit()
    return u


def _location(db_session, org, *, code: str, count: int = 0) -> Location:
    loc = Location(
        organization_id=org.organization_id,
        name=f"Loc {code}",
        location_type="room",
        code=code,
        path=f"Loc {code}",
        current_count=count,
    )
    db_session.add(loc)
    db_session.commit()
    return loc


def _object_with_part(db_session, org, *, num: str, at_location) -> CollectionObject:
    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=num,
        current_location_id=at_location.location_id,
    )
    db_session.add(obj)
    db_session.flush()
    part = ObjectPart(
        organization_id=org.organization_id,
        object_id=obj.object_id,
        part_number=None,  # primary part
        current_location_id=at_location.location_id,
    )
    db_session.add(part)
    db_session.commit()
    return obj


def _snapshot(m: Movement) -> dict:
    return {f: getattr(m, f) for f in _PARITY_FIELDS}


def _payload(object_id, to_location_id) -> dict:
    return {
        "object_id": str(object_id),
        "to_location_id": str(to_location_id),
        "reason": "storage",
        "movement_note": "Consolidating storage.",
        "movement_method": "hand_carried",
        "location_fitness": "suitable",
        "condition_note": "No change.",
        "status": "completed",
    }


def test_router_and_applier_produce_identical_movement_rows(db_session, org, user):
    from_a = _location(db_session, org, code="FA", count=3)
    to_a = _location(db_session, org, code="TA", count=0)
    obj_a = _object_with_part(db_session, org, num="MV-A", at_location=from_a)

    from_b = _location(db_session, org, code="FB", count=3)
    to_b = _location(db_session, org, code="TB", count=0)
    obj_b = _object_with_part(db_session, org, num="MV-B", at_location=from_b)

    # Path A — the shared create function directly (what the router now calls).
    direct = create_movement(
        db_session, org.organization_id,
        _payload(obj_a.object_id, to_a.location_id), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)

    # Path B — propose → approve → apply.
    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )
    res = _handler_for("movement")(_payload(obj_b.object_id, to_b.location_id), ctx)
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.applied_entity_id is not None
    assert applied.apply_error is None

    applied_row = db_session.get(Movement, applied.applied_entity_id)
    assert applied_row is not None
    assert _snapshot(applied_row) == snap_direct


def test_apply_moves_object_and_updates_counts(db_session, org, user):
    from_loc = _location(db_session, org, code="FROM", count=5)
    to_loc = _location(db_session, org, code="TO", count=0)
    obj = _object_with_part(db_session, org, num="MV-MOVE", at_location=from_loc)

    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )
    res = _handler_for("movement")(_payload(obj.object_id, to_loc.location_id), ctx)
    db_session.commit()
    approve_draft(db_session, res["draft_id"], user.user_id)

    db_session.refresh(obj)
    db_session.refresh(from_loc)
    db_session.refresh(to_loc)
    part = (
        db_session.query(ObjectPart)
        .filter(ObjectPart.object_id == obj.object_id)
        .first()
    )

    assert obj.current_location_id == to_loc.location_id
    assert part.current_location_id == to_loc.location_id
    assert from_loc.current_count == 4  # decremented from 5
    assert to_loc.current_count == 1    # incremented from 0
