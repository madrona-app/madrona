"""Media rights → publish clearance flow (Rights management).

Covers the four media draft entities + the hard publish gate + the
media_publish_clearance template end-to-end on the draft-chaining engine:

- each entity proposes→approves→applies to the right live row;
- publish is HARD-GATED: it refuses without active rights AND a completed
  sensitive-content review (and, when required, valid consent);
- the template drives rights → review → publish (with the consent branch),
  pausing on each sign-off, and only publishes once everything is cleared.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from app.models import (
    AgentDraft,
    AgentPlanStep,
    Conversation,
    Media,
    MediaConsent,
    MediaRights,
    Organization,
    OrganizationMembership,
    Role,
    User,
)
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for
from app.services.agent_plan_service import PlanService
from app.services.drafts.draft_service import approve_draft


@pytest.fixture
def org(db_session):
    o = Organization(name="Media Rights Museum", slug=f"mr-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session, org):
    u = User(email=f"curator-{uuid4().hex[:8]}@example.com",
             display_name="Curator", status="active")
    db_session.add(u)
    db_session.flush()
    role = (
        db_session.query(Role)
        .filter(Role.role_key == "member", Role.is_system == True)  # noqa: E712
        .first()
    )
    if role is None:
        role = Role(role_key="member", display_name="Member", is_system=True)
        db_session.add(role)
        db_session.flush()
    db_session.add(OrganizationMembership(
        user_id=u.user_id, organization_id=org.organization_id,
        role="member", role_id=role.role_id,
    ))
    db_session.commit()
    return u


def _media(db_session, org) -> Media:
    m = Media(
        organization_id=org.organization_id,
        s3_key=f"s3/{uuid4().hex}",
        filename=f"{uuid4().hex}.jpg",
        file_size=1024,
        mime_type="image/jpeg",
        media_type="image",
    )
    db_session.add(m)
    db_session.commit()
    return m


def _ctx(db_session, org, user, persona="curator"):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona=persona,
        db_session=db_session,
    )


# ── per-entity apply ─────────────────────────────────────────────────────────


def test_media_rights_draft_applies_to_live_row(db_session, org, user):
    m = _media(db_session, org)
    res = _handler_for("media_rights")(
        {"media_id": str(m.media_id), "rights_type": "license",
         "license_type": "CC-BY", "rights_holder": "Jane Artist"},
        _ctx(db_session, org, user, "rights_specialist"),
    )
    assert "error" not in res, res
    db_session.commit()
    applied = approve_draft(db_session, res["draft_id"], user.user_id)
    assert applied.apply_error is None and applied.applied_at is not None

    rights = db_session.query(MediaRights).filter(
        MediaRights.media_id == m.media_id).one()
    assert rights.rights_type == "license"
    assert rights.license_type == "CC-BY"
    assert rights.is_active is True
    assert rights.created_by == user.user_id


def test_media_review_draft_marks_reviewed(db_session, org, user):
    m = _media(db_session, org)
    assert m.metadata_reviewed is False
    res = _handler_for("media_review")(
        {"media_id": str(m.media_id), "notes": "no sensitive content"},
        _ctx(db_session, org, user),
    )
    db_session.commit()
    approve_draft(db_session, res["draft_id"], user.user_id)
    db_session.refresh(m)
    assert m.metadata_reviewed is True
    assert m.metadata_reviewed_by == user.user_id


# ── the hard publish gate ────────────────────────────────────────────────────


def _propose_publish(db_session, org, user, media_id, **extra):
    res = _handler_for("media_publish")(
        {"media_id": str(media_id), **extra}, _ctx(db_session, org, user)
    )
    db_session.commit()
    return approve_draft(db_session, res["draft_id"], user.user_id)


def test_publish_blocked_without_rights_or_review(db_session, org, user):
    m = _media(db_session, org)
    applied = _propose_publish(db_session, org, user, m.media_id)
    # apply raised inside the savepoint → not applied, reason recorded.
    assert applied.applied_at is None
    assert "rights" in (applied.apply_error or "")
    db_session.refresh(m)
    assert m.is_published is False


def test_publish_succeeds_with_copyright_status_only(db_session, org, user):
    """Rights can be documented by the copyright_status field alone (no detailed
    MediaRights record needed) — the gate accepts either."""
    m = _media(db_session, org)
    m.copyright_status = "public_domain"
    m.metadata_reviewed = True
    db_session.commit()
    applied = _propose_publish(db_session, org, user, m.media_id)
    assert applied.apply_error is None and applied.applied_at is not None
    db_session.refresh(m)
    assert m.is_published is True


def test_publish_blocked_with_rights_but_no_review(db_session, org, user):
    m = _media(db_session, org)
    db_session.add(MediaRights(
        media_id=m.media_id, organization_id=org.organization_id,
        rights_type="copyright", is_active=True))
    db_session.commit()
    applied = _propose_publish(db_session, org, user, m.media_id)
    assert applied.applied_at is None
    assert "has not been reviewed" in (applied.apply_error or "")
    db_session.refresh(m)
    assert m.is_published is False


def test_publish_succeeds_when_rights_and_review_present(db_session, org, user):
    m = _media(db_session, org)
    db_session.add(MediaRights(
        media_id=m.media_id, organization_id=org.organization_id,
        rights_type="copyright", is_active=True))
    m.metadata_reviewed = True
    db_session.commit()
    applied = _propose_publish(
        db_session, org, user, m.media_id,
        rights_statement="https://rightsstatements.org/vocab/InC/1.0/")
    assert applied.apply_error is None and applied.applied_at is not None
    db_session.refresh(m)
    assert m.is_published is True
    assert m.published_by == user.user_id
    assert m.rights_statement == "https://rightsstatements.org/vocab/InC/1.0/"


def test_publish_blocked_when_consent_required_but_missing(db_session, org, user):
    m = _media(db_session, org)
    db_session.add(MediaRights(
        media_id=m.media_id, organization_id=org.organization_id,
        rights_type="copyright", is_active=True))
    m.metadata_reviewed = True
    db_session.commit()
    # require_consent set, but no MediaConsent on file → blocked.
    applied = _propose_publish(db_session, org, user, m.media_id, require_consent=True)
    assert applied.applied_at is None
    assert "consent" in (applied.apply_error or "")
    db_session.refresh(m)
    assert m.is_published is False


# ── the template end-to-end ──────────────────────────────────────────────────


def _approve_plan_draft(db_session, plan, user, entity_type):
    d = (
        db_session.query(AgentDraft)
        .filter(AgentDraft.plan_id == plan.plan_id,
                AgentDraft.entity_type == entity_type)
        .order_by(AgentDraft.created_at.desc())
        .first()
    )
    assert d is not None, f"no {entity_type} draft on the plan"
    approve_draft(db_session, d.draft_id, user.user_id)
    return d


def test_publish_clearance_template_end_to_end(db_session, org, user):
    """rights → ⏸ → review → ⏸ → publish, pausing on each sign-off; the media
    is published only after the whole chain clears (no consent branch)."""
    m = _media(db_session, org)
    conv = Conversation(
        organization_id=org.organization_id, user_id=user.user_id, persona="staff")
    db_session.add(conv)
    db_session.flush()

    svc = PlanService(db_session, _ctx(db_session, org, user, "staff"))
    created = svc.create_plan(
        "publish this image",
        conv,
        template_id="media_publish_clearance",
        template_params={
            "media_id": str(m.media_id),
            "rights_type": "license",
            "rights_statement": "https://rightsstatements.org/vocab/InC/1.0/",
        },
    )
    assert created.error is None, created.error
    # No consent branch (requires_consent unset): rights, await, review, await, publish.
    assert len(created.steps) == 5
    db_session.commit()

    svc.run_plan(created.plan.plan_id)  # parks on rights sign-off
    _approve_plan_draft(db_session, created.plan, user, "media_rights")  # → parks on review
    _approve_plan_draft(db_session, created.plan, user, "media_review")  # → proposes publish, completes

    db_session.refresh(created.plan)
    assert created.plan.status == "completed"
    # The publish draft was proposed (awaiting its own inbox approval), media
    # not yet live until that final go/no-go.
    db_session.refresh(m)
    assert m.is_published is False

    # Approve the publish draft → hard gate passes (rights + review present).
    _approve_plan_draft(db_session, created.plan, user, "media_publish")
    db_session.refresh(m)
    assert m.is_published is True
    assert m.metadata_reviewed is True
    assert db_session.query(MediaRights).filter(
        MediaRights.media_id == m.media_id, MediaRights.is_active.is_(True)).count() == 1


def test_template_includes_consent_branch_when_required(db_session, org, user):
    """requires_consent=True adds the consent propose + sign-off steps."""
    m = _media(db_session, org)
    conv = Conversation(
        organization_id=org.organization_id, user_id=user.user_id, persona="staff")
    db_session.add(conv)
    db_session.flush()

    svc = PlanService(db_session, _ctx(db_session, org, user, "staff"))
    created = svc.create_plan(
        "publish this image",
        conv,
        template_id="media_publish_clearance",
        template_params={
            "media_id": str(m.media_id),
            "requires_consent": True,
            "subject_name": "Jane Subject",
        },
    )
    assert created.error is None, created.error
    # rights, await, consent, await, review, await, publish = 7 steps.
    tools = [s.tool for s in sorted(created.steps, key=lambda s: s.idx) if s.tool]
    assert tools == [
        "propose_media_rights_draft",
        "propose_media_consent_draft",
        "propose_media_review_draft",
        "propose_media_publish_draft",
    ]
    assert len(created.steps) == 7
