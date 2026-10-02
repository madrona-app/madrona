"""1B parity proof for the `location` entity.

Asserts the router path and the propose→approve→apply path build identical
Location rows (descriptive fields), and that parent-derived path/depth and code
auto-generation work through the draft applier.
"""

from uuid import uuid4

import pytest

from app.models import Location, Organization, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.location import create_location
from app.services.drafts.draft_service import approve_draft

# Fields that must match between the two paths (excludes identity, the
# name-derived code/path/depth, and timestamps).
_PARITY_FIELDS = (
    "location_type",
    "description",
    "note",
    "default_fitness",
    "condition",
    "security_level",
    "capacity",
    "climate_controlled",
    "is_external",
    "created_by",
    "updated_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Location Test Museum", slug=f"loc-{uuid4().hex[:8]}")
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


def _payload(name: str) -> dict:
    return {
        "name": name,
        "location_type": "room",
        "description": "Climate-controlled storage room.",
        "note": "Drafted by the Guide.",
        "default_fitness": "suitable",
        "condition": "good",
        "security_level": "vault",
        "capacity": 25,
        "climate_controlled": True,
    }


def _snapshot(loc: Location) -> dict:
    return {f: getattr(loc, f) for f in _PARITY_FIELDS}


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    # Path A — shared create function directly (different name → different
    # auto-code, so the unique org+code index doesn't collide with path B).
    direct = create_location(
        db_session, org.organization_id, _payload("Vault Alpha"), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)

    # Path B — propose → approve → apply.
    res = _handler_for("location")(_payload("Vault Beta"), _ctx(db_session, org, user))
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    applied_row = db_session.get(Location, applied.applied_entity_id)
    assert applied_row is not None
    assert _snapshot(applied_row) == snap_direct
    # Auto-generated code from the type prefix + name.
    assert applied_row.code == "RM-VB"
    assert applied_row.path == "RM-VB"
    assert applied_row.depth == 0


def test_apply_derives_path_and_depth_from_parent(db_session, org, user):
    parent = create_location(
        db_session, org.organization_id,
        {"name": "Building One", "location_type": "building"}, user.user_id,
    )
    db_session.commit()

    payload = _payload("Room Twelve")
    payload["parent_id"] = str(parent.location_id)
    res = _handler_for("location")(payload, _ctx(db_session, org, user))
    db_session.commit()
    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    child = db_session.get(Location, applied.applied_entity_id)

    assert child.parent_id == parent.location_id
    assert child.depth == parent.depth + 1
    assert child.path == f"{parent.path}/{child.code}"
