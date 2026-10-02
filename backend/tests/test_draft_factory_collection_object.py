"""1B parity proof for the `collection_object` entity (core cataloging).

Verifies the router path and the propose→approve→apply path build identical
core object rows AND that both auto-create the default (primary) part — the
invariant the rest of the system (movements, location) depends on.
"""

from uuid import uuid4

import pytest

from app.models import CollectionObject, ObjectPart, Organization, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.collection_object import (
    create_collection_object,
)
from app.services.drafts.draft_service import approve_draft

# Excludes identity (object_number is uniquely indexed, so the two rows differ).
_PARITY_FIELDS = (
    "object_name",
    "object_type",
    "category",
    "responsible_department",
    "brief_description",
    "full_description",
    "physical_description",
    "content_description",
    "comments",
    "creation_date_display",
    "creation_date_earliest",
    "creation_date_latest",
    "creation_place",
    "style_period",
    "provenance",
    "object_history_note",
    "credit_line",
    "number_of_objects",
    "created_by",
    "updated_by",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Object Test Museum", slug=f"obj-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"registrar-{uuid4().hex[:8]}@example.com", display_name="Reg")
    db_session.add(u)
    db_session.commit()
    return u


def _payload(object_number: str) -> dict:
    return {
        "object_number": object_number,
        "object_name": "Portrait of a Lady",
        "object_type": "painting",
        "category": "fine_art",
        "brief_description": "Half-length portrait, oil on canvas.",
        "physical_description": "Oil on canvas in a gilt frame.",
        "creation_date_display": "c. 1890",
        "creation_date_earliest": "1885-01-01",
        "creation_date_latest": "1895-12-31",
        "creation_place": "Paris",
        "style_period": "Impressionism",
        "provenance": "Acquired from the artist's estate.",
        "credit_line": "Proposed by the Guide.",
        "number_of_objects": 1,
    }


def _snapshot(o: CollectionObject) -> dict:
    return {f: getattr(o, f) for f in _PARITY_FIELDS}


def _primary_part(db_session, object_id):
    return (
        db_session.query(ObjectPart)
        .filter(
            ObjectPart.object_id == object_id,
            ObjectPart.part_number.is_(None),
        )
        .first()
    )


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    direct = create_collection_object(
        db_session, org.organization_id, _payload("2026.1.1"), user.user_id,
        open_approval=True,
    )
    db_session.flush()
    snap_direct = _snapshot(direct)
    # Default part created with a derived barcode.
    part_a = _primary_part(db_session, direct.object_id)
    assert part_a is not None
    assert part_a.barcode

    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )
    res = _handler_for("collection_object")(_payload("2026.1.2"), ctx)
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    obj_b = db_session.get(CollectionObject, applied.applied_entity_id)
    assert obj_b is not None
    assert obj_b.object_number == "2026.1.2"
    # Same default-part invariant on the draft path.
    part_b = _primary_part(db_session, obj_b.object_id)
    assert part_b is not None
    assert part_b.barcode
    assert _snapshot(obj_b) == snap_direct
