"""Directed review handoff (§7.5) wired through the factory.

`assign_to_user_id` on any propose_<entity>_draft tool routes the draft's
approval to a named reviewer — validated against the approver permission. These
tests use `valuation` as the representative entity (the behavior is generated, so
it holds for all 16).
"""

from uuid import UUID, uuid4

import pytest

from app.models import AgentDraft, CollectionObject, Organization, User
from app.models.core_org import ApprovalRequest, ApprovalRule
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import _handler_for

_VALUATION_RULE_PERM = "valuations.approve"


@pytest.fixture
def org(db_session):
    o = Organization(name="Assign Test Museum", slug=f"asg-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(email=f"proposer-{uuid4().hex[:8]}@example.com", display_name="Prop")
    db_session.add(u)
    db_session.commit()
    return u


@pytest.fixture
def reviewer(db_session):
    u = User(email=f"reviewer-{uuid4().hex[:8]}@example.com", display_name="Rev")
    db_session.add(u)
    db_session.commit()
    return u


def _object(db_session, org) -> CollectionObject:
    obj = CollectionObject(
        organization_id=org.organization_id, object_number=f"2026.{uuid4().hex[:5]}"
    )
    db_session.add(obj)
    db_session.commit()
    return obj


def _seed_valuation_rule(db_session, org) -> ApprovalRule:
    rule = ApprovalRule(
        organization_id=org.organization_id,
        entity_type="valuation",
        trigger_action="create",
        approver_permission=_VALUATION_RULE_PERM,
    )
    db_session.add(rule)
    db_session.flush()
    return rule


def _ctx(db_session, org, user):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="registrar",
        db_session=db_session,
    )


def _payload(object_id, reviewer_id=None) -> dict:
    p = {
        "object_id": str(object_id),
        "valuation_type": "insurance",
        "valuation_amount": "1000.00",
        "valuation_date": "2026-05-01",
    }
    if reviewer_id is not None:
        p["assign_to_user_id"] = str(reviewer_id)
    return p


def test_assign_directs_the_approval_to_the_named_reviewer(
    db_session, org, user, reviewer, monkeypatch
):
    _seed_valuation_rule(db_session, org)
    # The named reviewer holds the approver permission.
    monkeypatch.setattr(
        "app.services.rbac_service.check_permission",
        lambda *a, **k: True,
    )
    obj = _object(db_session, org)

    res = _handler_for("valuation")(
        _payload(obj.object_id, reviewer_id=reviewer.user_id),
        _ctx(db_session, org, user),
    )
    assert "error" not in res, res
    draft = db_session.get(AgentDraft, UUID(res["draft_id"]))
    assert draft.approval_request_id is not None

    req = db_session.get(ApprovalRequest, draft.approval_request_id)
    assert req.assigned_to_user_id == reviewer.user_id


def test_assign_to_user_without_permission_is_rejected_and_creates_no_draft(
    db_session, org, user, reviewer, monkeypatch
):
    _seed_valuation_rule(db_session, org)
    # The named reviewer does NOT hold the approver permission.
    monkeypatch.setattr(
        "app.services.rbac_service.check_permission",
        lambda *a, **k: False,
    )
    obj = _object(db_session, org)

    res = _handler_for("valuation")(
        _payload(obj.object_id, reviewer_id=reviewer.user_id),
        _ctx(db_session, org, user),
    )
    assert "error" in res
    assert "draft_id" not in res
    assert "permission" in res["error"].lower()
    # No orphan: the early validation refused before persisting any draft.
    count = (
        db_session.query(AgentDraft)
        .filter(AgentDraft.organization_id == org.organization_id)
        .count()
    )
    assert count == 0


def test_assign_with_no_rule_is_ignored_draft_open(db_session, org, user, reviewer):
    """No approval rule governs the entity → assignment has no home; the draft is
    created open (no approval request), per the tool contract."""
    obj = _object(db_session, org)
    res = _handler_for("valuation")(
        _payload(obj.object_id, reviewer_id=reviewer.user_id),
        _ctx(db_session, org, user),
    )
    assert "error" not in res, res
    draft = db_session.get(AgentDraft, UUID(res["draft_id"]))
    assert draft.approval_request_id is None
