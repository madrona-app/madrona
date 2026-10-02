"""§1C batch-draft proof on the `media_metadata` entity.

Verifies the batch lifecycle: propose a partial metadata change over N media →
approve → all N updated; idempotent re-apply; partial update leaves unset fields
untouched; and one bad target rolls the whole batch back (all-or-nothing).
"""

from uuid import UUID, uuid4

import pytest

from app.models import AgentDraft, Media, Organization, User
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.drafts.draft_service import apply_draft, approve_draft


@pytest.fixture
def org(db_session):
    o = Organization(name="Media Test Museum", slug=f"med-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"curator-{uuid4().hex[:8]}@example.com", display_name="Cur")
    db_session.add(u)
    db_session.commit()
    return u


def _media(db_session, org, *, title=None, description="orig") -> Media:
    m = Media(
        organization_id=org.organization_id,
        s3_key=f"s3/{uuid4().hex}",
        filename=f"{uuid4().hex}.jpg",
        file_size=1024,
        mime_type="image/jpeg",
        media_type="image",
        title=title,
        description=description,
    )
    db_session.add(m)
    db_session.commit()
    return m


def _ctx(db_session, org, user):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="curator",
        db_session=db_session,
    )


def test_batch_applies_change_to_all_targets(db_session, org, user):
    m1 = _media(db_session, org, description="a")
    m2 = _media(db_session, org, description="b")
    m3 = _media(db_session, org, description="c")
    ctx = _ctx(db_session, org, user)

    res = _handler_for("media_metadata")(
        {
            "target_ids": [str(m1.media_id), str(m2.media_id), str(m3.media_id)],
            "credit": "Museum Collection",
        },
        ctx,
    )
    assert "error" not in res, res
    assert res["_ui"]["cardinality"] == "batch"
    assert res["_ui"]["target_count"] == 3
    db_session.commit()

    draft = db_session.get(AgentDraft, UUID(res["draft_id"]))
    assert draft.cardinality == "batch"
    assert len(draft.target_entity_ids) == 3

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None
    assert applied.applied_at is not None
    assert applied.applied_entity_id is None  # batch has no single entity
    assert len(applied.apply_result) == 3

    for m in (m1, m2, m3):
        db_session.refresh(m)
        assert m.credit == "Museum Collection"
        assert m.updated_by == user.user_id
    # Partial update: description (not in the payload) is untouched.
    assert m1.description == "a"
    assert m2.description == "b"


def test_batch_apply_is_idempotent(db_session, org, user):
    m1 = _media(db_session, org)
    res = _handler_for("media_metadata")(
        {"target_ids": [str(m1.media_id)], "credit": "X"},
        _ctx(db_session, org, user),
    )
    db_session.commit()
    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    first_applied_at = applied.applied_at
    # A second apply is a no-op (applied_at already set).
    again = apply_draft(db_session, applied.draft_id)
    assert again.applied_at == first_applied_at


def test_batch_is_all_or_nothing_on_a_bad_target(db_session, org, user):
    m1 = _media(db_session, org, description="keep-me")
    bogus = uuid4()
    res = _handler_for("media_metadata")(
        {
            "target_ids": [str(m1.media_id), str(bogus)],
            "description": "changed",
        },
        _ctx(db_session, org, user),
    )
    db_session.commit()

    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    # The bad target raised → the whole batch rolled back.
    assert applied.apply_error is not None
    assert applied.applied_at is None
    assert applied.apply_result is None
    # m1 was NOT changed despite being first in the batch.
    db_session.refresh(m1)
    assert m1.description == "keep-me"
