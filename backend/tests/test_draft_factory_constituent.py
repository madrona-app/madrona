"""1B parity proof for the `constituent` entity."""

from uuid import uuid4

import pytest

from app.models import Constituent, Organization, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.constituent import create_constituent
from app.services.drafts.draft_service import approve_draft

_PARITY_FIELDS = (
    "constituent_type",
    "name",
    "first_name",
    "last_name",
    "title",
    "role",
    "organization_name",
    "email",
    "phone",
    "website",
    "nationality",
    "culture",
    "gender",
    "birth_date_display",
    "birth_place",
    "death_date_display",
    "biography",
    "ulan_id",
    "viaf_id",
    "wikidata_id",
    "notes",
    "created_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Constituent Test Museum", slug=f"con-{uuid4().hex[:8]}")
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
        "constituent_type": "person",
        "name": "Jane Q. Artist",
        "first_name": "Jane",
        "last_name": "Artist",
        "title": "Painter",
        "email": "jane@example.com",
        "nationality": "American",
        "birth_date_display": "1901",
        "death_date_display": "1975",
        "biography": "A 20th-century painter.",
        # Authority IDs omitted: org+ulan_id is uniquely indexed, so the two
        # parity rows can't share one. Their parity (both None) still holds.
        "notes": "Proposed by the Guide during cataloging.",
    }


def _snapshot(c: Constituent) -> dict:
    return {f: getattr(c, f) for f in _PARITY_FIELDS}


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    # No unique-name constraint, so both paths can use the same payload.
    direct = create_constituent(
        db_session, org.organization_id, _payload(), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)

    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )
    res = _handler_for("constituent")(_payload(), ctx)
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    applied_row = db_session.get(Constituent, applied.applied_entity_id)
    assert applied_row is not None
    assert _snapshot(applied_row) == snap_direct


def test_invalid_constituent_type_rejected_at_draft_creation(db_session, org, user):
    """The Literal-typed constituent_type fails schema validation up front, so a
    bad value never reaches a DB CHECK at apply time."""
    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )
    res = _handler_for("constituent")(
        {"constituent_type": "robot", "name": "Bad Bot"}, ctx
    )
    assert "error" in res
    assert "draft_id" not in res
