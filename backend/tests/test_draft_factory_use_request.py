"""1B parity proof for the `use_request` entity."""

from uuid import uuid4

import pytest

from app.models import Organization, UseRequest, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.collections.creation.use_request import create_use_request
from app.services.drafts.draft_service import approve_draft

_PARITY_FIELDS = (
    "use_type",
    "use_subtype",
    "use_purpose",
    "use_description",
    "requester_name",
    "requester_title",
    "requester_institution",
    "requester_email",
    "location_required",
    "special_requirements",
    "project_title",
    "project_description",
    "status",
    "request_note",
    "created_by_id",
    "updated_by_id",
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Use Test Museum", slug=f"use-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"rights-{uuid4().hex[:8]}@example.com", display_name="RS")
    db_session.add(u)
    db_session.commit()
    return u


def _payload() -> dict:
    # No request_number — both paths auto-generate distinct USE-{year}-NNN.
    return {
        "use_type": "research",
        "requester_name": "Dr. Ada Scholar",
        "use_purpose": "Doctoral research on 19th-century portraiture.",
        "use_subtype": "onsite",
        "use_description": "Study of brushwork under raking light.",
        "requester_institution": "University",
        "requester_email": "ada@example.edu",
        "location_required": "Study room",
        "project_title": "Portraiture and Light",
        "request_note": "Proposed by the Guide.",
    }


def _snapshot(r: UseRequest) -> dict:
    return {f: getattr(r, f) for f in _PARITY_FIELDS}


def test_router_and_applier_produce_identical_rows(db_session, org, user):
    direct = create_use_request(
        db_session, org.organization_id, _payload(), user.user_id, open_approval=True
    )
    db_session.flush()
    snap_direct = _snapshot(direct)
    assert direct.status == "submitted"

    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="rights_specialist",
        db_session=db_session,
    )
    res = _handler_for("use_request")(_payload(), ctx)
    assert "error" not in res, res
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    applied_row = db_session.get(UseRequest, applied.applied_entity_id)
    assert applied_row is not None
    assert applied_row.request_number.startswith("USE-")
    assert applied_row.request_number != direct.request_number
    assert _snapshot(applied_row) == snap_direct
