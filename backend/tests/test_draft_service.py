"""Guide Studio v1 Phase 1 — drafts write tool + apply cascade.

Exercises the end-to-end loop: a conservator proposes a condition report (draft,
never a live write) → approve → the live ConditionReport is created and linked
to the object.
"""

from uuid import UUID, uuid4

import pytest

from app.models import (
    AgentDraft,
    CollectionObject,
    ConditionReport,
    Constituent,
    Conversation,
    Message,
    Organization,
    User,
)
from app.services.agent_tools import AgentContext
from app.services.agent_tools.draft_tools import propose_condition_report_draft
from app.services.drafts.draft_service import (
    DraftSensitivityError,
    DraftStateError,
    approve_draft,
    create_draft,
    reject_draft,
)


@pytest.fixture
def org(db_session):
    o = Organization(name="Draft Test Museum", slug=f"draft-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session):
    u = User(
        email=f"conservator-{uuid4().hex[:8]}@example.com",
        display_name="Test Conservator",
    )
    db_session.add(u)
    db_session.commit()
    return u


@pytest.fixture
def obj(db_session, org):
    o = CollectionObject(
        organization_id=org.organization_id,
        object_number=f"2026.{uuid4().hex[:4]}",
    )
    db_session.add(o)
    db_session.commit()
    return o


def _ctx(db_session, org, user):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="conservator",
        db_session=db_session,
    )


def test_propose_creates_pending_draft_with_model_pinning(db_session, org, user, obj):
    res = propose_condition_report_draft(
        {
            "object_id": str(obj.object_id),
            "report_type": "conservation",
            "report_date": "2026-05-23",
            "overall_condition": "good",
            "rationale": "Surface stable, no active deterioration.",
        },
        _ctx(db_session, org, user),
    )
    assert "error" not in res, res
    draft = db_session.get(AgentDraft, UUID(res["draft_id"]))
    assert draft.status == "pending"
    assert draft.entity_type == "condition_report"
    assert draft.intended_action == "create"
    assert draft.proposed_by_persona == "conservator"
    assert draft.payload["object_id"] == str(obj.object_id)
    assert draft.rationale.startswith("Surface stable")
    assert draft.model_id  # pinned for the audit trail (§7.4)
    assert res["_ui"]["kind"] == "draft"


def test_approve_applies_to_live_condition_report(db_session, org, user, obj):
    res = propose_condition_report_draft(
        {
            "object_id": str(obj.object_id),
            "report_type": "conservation",
            "report_date": "2026-05-23",
            "overall_condition": "fair",
            "conservation_needed": True,
            "conservation_priority": "medium",
        },
        _ctx(db_session, org, user),
    )
    draft_id = UUID(res["draft_id"])

    applied = approve_draft(db_session, draft_id, user.user_id)
    assert applied.status == "approved"
    assert applied.apply_error is None
    assert applied.applied_entity_id is not None

    report = db_session.get(ConditionReport, applied.applied_entity_id)
    assert report is not None
    assert report.object_id == obj.object_id
    assert report.report_number.startswith("CR")
    assert report.overall_condition == "fair"
    assert report.conservation_needed is True
    # examiner_id is the proposer's staff constituent (the user↔constituent link).
    staff = (
        db_session.query(Constituent)
        .filter(Constituent.organization_id == org.organization_id,
                Constituent.user_id == user.user_id)
        .one()
    )
    assert report.examiner_id == staff.constituent_id


def test_invalid_payload_returns_error(db_session, org, user):
    # Missing required report_date AND a non-UUID object_id.
    res = propose_condition_report_draft(
        {"object_id": "not-a-uuid", "report_type": "conservation"},
        _ctx(db_session, org, user),
    )
    assert "error" in res
    # Nothing persisted.
    assert db_session.query(AgentDraft).count() == 0


def _seed_condition_report_rule(db_session, org):
    from app.models.core_org import ApprovalRule

    rule = ApprovalRule(
        organization_id=org.organization_id,
        entity_type="condition_report",
        trigger_action="create",
        approver_permission="conservation.approve",
    )
    db_session.add(rule)
    db_session.flush()
    return rule


def test_rule_bound_draft_applies_on_approval_review(db_session, org, user, obj):
    from app.services.approval_service import review_approval

    _seed_condition_report_rule(db_session, org)
    res = propose_condition_report_draft(
        {"object_id": str(obj.object_id), "report_type": "conservation", "report_date": "2026-05-23"},
        _ctx(db_session, org, user),
    )
    draft = db_session.get(AgentDraft, UUID(res["draft_id"]))
    # A rule was found, so the draft is bound to a live ApprovalRequest and is
    # NOT yet applied — it waits on the human decision.
    assert draft.status == "pending"
    assert draft.approval_request_id is not None
    assert draft.applied_entity_id is None

    # Approve through the real approvals path → handle_draft_decision applies it.
    review_approval(draft.approval_request_id, user.user_id, "approved", None, db_session)

    db_session.refresh(draft)
    assert draft.status == "approved"
    assert draft.applied_entity_id is not None
    report = db_session.get(ConditionReport, draft.applied_entity_id)
    assert report is not None and report.object_id == obj.object_id


def test_rule_bound_draft_rejected_on_review(db_session, org, user, obj):
    from app.services.approval_service import review_approval

    _seed_condition_report_rule(db_session, org)
    res = propose_condition_report_draft(
        {"object_id": str(obj.object_id), "report_type": "conservation", "report_date": "2026-05-23"},
        _ctx(db_session, org, user),
    )
    draft = db_session.get(AgentDraft, UUID(res["draft_id"]))

    review_approval(draft.approval_request_id, user.user_id, "rejected", "out of scope", db_session)

    db_session.refresh(draft)
    assert draft.status == "rejected"
    assert draft.applied_entity_id is None
    assert db_session.query(ConditionReport).count() == 0


def test_reject_then_apply_is_blocked(db_session, org, user, obj):
    res = propose_condition_report_draft(
        {"object_id": str(obj.object_id), "report_type": "conservation", "report_date": "2026-05-23"},
        _ctx(db_session, org, user),
    )
    draft_id = UUID(res["draft_id"])

    rejected = reject_draft(db_session, draft_id, user.user_id, note="not needed")
    assert rejected.status == "rejected"

    with pytest.raises(DraftStateError):
        approve_draft(db_session, draft_id, user.user_id)

    # No live report created.
    assert db_session.query(ConditionReport).count() == 0


# --- Citation enforcement (§7.2) -------------------------------------------


def _base_payload(obj):
    return {
        "object_id": str(obj.object_id),
        "report_type": "conservation",
        "report_date": "2026-05-23",
    }


def test_resolvable_entity_citation_allows_draft(db_session, org, user, obj):
    res = propose_condition_report_draft(
        {**_base_payload(obj),
         "citations": [{"kind": "entity_link", "ref": str(obj.object_id)}]},
        _ctx(db_session, org, user),
    )
    assert "error" not in res, res
    draft = db_session.get(AgentDraft, UUID(res["draft_id"]))
    assert draft.citations[0]["ref"] == str(obj.object_id)


def test_dangling_citation_rejected(db_session, org, user, obj):
    res = propose_condition_report_draft(
        {**_base_payload(obj),
         "citations": [{"kind": "entity_link", "ref": str(uuid4())}]},
        _ctx(db_session, org, user),
    )
    assert "error" in res
    assert "citation" in res["error"].lower()
    assert db_session.query(AgentDraft).count() == 0


def test_unknown_citation_kind_rejected(db_session, org, user, obj):
    res = propose_condition_report_draft(
        {**_base_payload(obj), "citations": [{"kind": "made_up", "ref": "x"}]},
        _ctx(db_session, org, user),
    )
    assert "error" in res
    assert db_session.query(AgentDraft).count() == 0


def test_tool_result_citation_without_conversation_rejected(db_session, org, user, obj):
    # ctx has no conversation → a tool_result cite can't be verified → rejected.
    res = propose_condition_report_draft(
        {**_base_payload(obj), "citations": [{"kind": "tool_result", "ref": "tc_123"}]},
        _ctx(db_session, org, user),
    )
    assert "error" in res


def test_tool_result_citation_resolves_within_conversation(db_session, org, user, obj):
    conv = Conversation(
        organization_id=org.organization_id, user_id=user.user_id, persona="staff"
    )
    db_session.add(conv)
    db_session.flush()
    db_session.add(Message(
        conversation_id=conv.conversation_id,
        organization_id=org.organization_id,
        role="assistant",
        content="searched",
        tool_calls={"calls": [{"id": "tc_xyz", "tool": "search_collection"}]},
    ))
    db_session.flush()

    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="conservator",
        db_session=db_session,
        conversation_id=conv.conversation_id,
    )
    res = propose_condition_report_draft(
        {**_base_payload(obj), "citations": [{"kind": "tool_result", "ref": "tc_xyz"}]},
        ctx,
    )
    assert "error" not in res, res
    draft = db_session.get(AgentDraft, UUID(res["draft_id"]))
    assert draft.conversation_id == conv.conversation_id


# --- Record-level sensitivity gate (§7.3) ----------------------------------


def _nagpra(db_session, org, obj, *, hold_active, access_consent="restricted"):
    from app.models.nagpra import NagpraAction

    rec = NagpraAction(
        organization_id=org.organization_id,
        object_id=obj.object_id,
        action_number=f"NA-{uuid4().hex[:6]}",
        origin_type="collections_review",
        hold_active=hold_active,
        access_consent=access_consent,
    )
    db_session.add(rec)
    db_session.flush()
    return rec


def test_nagpra_hold_refuses_draft(db_session, org, user, obj):
    _nagpra(db_session, org, obj, hold_active=True)
    res = propose_condition_report_draft(
        _base_payload(obj), _ctx(db_session, org, user)
    )
    assert res.get("refused") is True
    assert "NAGPRA hold" in res["error"]
    assert db_session.query(AgentDraft).count() == 0


def test_nagpra_no_access_consent_refuses_draft(db_session, org, user, obj):
    _nagpra(db_session, org, obj, hold_active=False, access_consent="restricted")
    res = propose_condition_report_draft(
        _base_payload(obj), _ctx(db_session, org, user)
    )
    assert res.get("refused") is True
    assert "access consent" in res["error"]
    assert db_session.query(AgentDraft).count() == 0


def test_nagpra_granted_consent_allows_draft(db_session, org, user, obj):
    _nagpra(db_session, org, obj, hold_active=False, access_consent="granted")
    res = propose_condition_report_draft(
        _base_payload(obj), _ctx(db_session, org, user)
    )
    assert "error" not in res, res
    assert db_session.get(AgentDraft, UUID(res["draft_id"])).status == "pending"


def test_no_nagpra_record_allows_draft(db_session, org, user, obj):
    # The existing tests already cover this implicitly; assert it explicitly.
    res = propose_condition_report_draft(
        _base_payload(obj), _ctx(db_session, org, user)
    )
    assert "error" not in res, res


def test_nagpra_conditional_consent_allows_draft(db_session, org, user, obj):
    # Conditional consent is a permitted access state — must NOT be refused.
    _nagpra(db_session, org, obj, hold_active=False, access_consent="conditional")
    res = propose_condition_report_draft(
        _base_payload(obj), _ctx(db_session, org, user)
    )
    assert "error" not in res, res


def test_nagpra_denied_consent_refuses_draft(db_session, org, user, obj):
    _nagpra(db_session, org, obj, hold_active=False, access_consent="denied")
    res = propose_condition_report_draft(
        _base_payload(obj), _ctx(db_session, org, user)
    )
    assert res.get("refused") is True
    assert "access consent" in res["error"]
    assert db_session.query(AgentDraft).count() == 0


# --- Referenced examiner (FK) vs the proposer --------------------------------


def test_condition_report_references_examiner_constituent(db_session, org, user, obj):
    # A referenced examiner (a constituent) is used as the FK, not the proposer.
    examiner = Constituent(
        organization_id=org.organization_id,
        constituent_type="person", name="Dr. Examiner",
    )
    db_session.add(examiner)
    db_session.flush()
    res = propose_condition_report_draft(
        {**_base_payload(obj), "examiner_id": str(examiner.constituent_id)},
        _ctx(db_session, org, user),
    )
    assert "error" not in res, res
    approve_draft(db_session, UUID(res["draft_id"]), user.user_id)
    report = (
        db_session.query(ConditionReport)
        .filter(ConditionReport.object_id == obj.object_id)
        .one()
    )
    assert report.examiner_id == examiner.constituent_id  # the reference, not the proposer


def test_condition_report_examiner_falls_back_to_proposer_staff_constituent(
    db_session, org, user, obj,
):
    # With no referenced examiner, it defaults to the proposer's STAFF constituent
    # (created via the user↔constituent link) — never a bare user id.
    res = propose_condition_report_draft(_base_payload(obj), _ctx(db_session, org, user))
    assert "error" not in res, res
    approve_draft(db_session, UUID(res["draft_id"]), user.user_id)
    report = (
        db_session.query(ConditionReport)
        .filter(ConditionReport.object_id == obj.object_id)
        .one()
    )
    staff = (
        db_session.query(Constituent)
        .filter(Constituent.organization_id == org.organization_id,
                Constituent.user_id == user.user_id)
        .one()
    )
    assert report.examiner_id == staff.constituent_id


# --- §7.3 extended sensitivity: media publication rights -------------------


def _media(db_session, org, *, copyright_status, rights_statement=None):
    from app.models import Media

    m = Media(
        organization_id=org.organization_id,
        s3_key=f"k/{uuid4().hex}", filename="x.jpg", file_size=1,
        mime_type="image/jpeg", media_type="image",
        copyright_status=copyright_status, rights_statement=rights_statement,
    )
    db_session.add(m)
    db_session.flush()
    return m


def _publish_draft(db_session, org, user, media):
    return create_draft(
        _ctx(db_session, org, user),
        entity_type="media_publish",
        intended_action="update",
        payload={"media_id": str(media.media_id)},
        sensitivity_entity_type="media",
    )


def test_media_publish_restricted_copyright_without_statement_refused(db_session, org, user):
    m = _media(db_session, org, copyright_status="in_copyright")
    with pytest.raises(DraftSensitivityError, match="rights"):
        _publish_draft(db_session, org, user, m)
    assert db_session.query(AgentDraft).count() == 0


def test_media_publish_restricted_copyright_with_statement_allowed(db_session, org, user):
    m = _media(db_session, org, copyright_status="in_copyright",
               rights_statement="© cleared under license ABC-123")
    draft = _publish_draft(db_session, org, user, m)
    assert draft.status == "pending"


def test_media_publish_public_domain_allowed(db_session, org, user):
    m = _media(db_session, org, copyright_status="public_domain")
    draft = _publish_draft(db_session, org, user, m)
    assert draft.status == "pending"


# --- §7.3 extended sensitivity: object rights clearance --------------------


def _object_right(db_session, org, obj, status):
    from app.models.objects import ObjectRight

    r = ObjectRight(
        organization_id=org.organization_id,
        object_id=obj.object_id,
        right_type="copyright",
        status=status,
    )
    db_session.add(r)
    db_session.flush()
    return r


def _reproduction_draft(db_session, org, user, obj):
    return create_draft(
        _ctx(db_session, org, user),
        entity_type="reproduction_request",
        payload={
            "requester_name": "A. Scholar",
            "reproduction_type": "scan",
            "object_id": str(obj.object_id),
        },
        sensitivity_entity_type="reproduction_request",
    )


def test_reproduction_request_blocked_rights_refused(db_session, org, user, obj):
    _object_right(db_session, org, obj, "denied")
    with pytest.raises(DraftSensitivityError, match="rights"):
        _reproduction_draft(db_session, org, user, obj)
    assert db_session.query(AgentDraft).count() == 0


def test_reproduction_request_cleared_rights_allowed(db_session, org, user, obj):
    _object_right(db_session, org, obj, "licensed")
    draft = _reproduction_draft(db_session, org, user, obj)
    assert draft.status == "pending"


def test_reproduction_request_no_rights_record_allowed(db_session, org, user, obj):
    # No rights record → nothing to block on → allowed (conservative gate).
    draft = _reproduction_draft(db_session, org, user, obj)
    assert draft.status == "pending"
