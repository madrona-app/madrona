"""Draft-chaining engine (the await-for-draft-approval unlock).

A plan can propose a draft, PAUSE until that draft is approved + applied, then
thread the freshly-created entity's id into a later step. Three layers:

- TestValidateDraftApproval — _validate_steps rules for the draft_approval await.
- TestResolveStepRefs — pure $from_step arg threading.
- TestDraftChainIntegration — the full loop through the real executor +
  approvals path: propose (gated) → park → approve → apply → resume → thread.
"""

from __future__ import annotations

from uuid import UUID, uuid4

import pytest

from app.models import (
    AgentDraft,
    AgentPlan,
    AgentPlanStep,
    CollectionObject,
    Conversation,
    Organization,
    OrganizationMembership,
    Role,
    User,
)
from app.models.core_org import ApprovalRule
from app.services.agent_plan_service import (
    PlanService,
    _resolve_step_refs,
    _serialize_context,
    _StepRefError,
    _validate_steps,
)
from app.services.agent_tools import AgentContext


# ── unit: draft_approval validation ──────────────────────────────────────────


class TestValidateDraftApproval:
    def _steps(self, wait_for):
        return [
            {"description": "propose", "kind": "tool_call",
             "tool": "propose_collection_object_draft", "persona": "registrar",
             "args": {"object_number": "X.1"}},
            {"description": "await it", "kind": "await", "wait_for": wait_for},
        ]

    def test_accepts_backward_from_step(self):
        steps, err = _validate_steps(
            self._steps({"kind": "draft_approval", "from_step": 0})
        )
        assert err is None
        assert steps[1]["wait_for"]["from_step"] == 0

    def test_rejects_missing_from_step(self):
        _, err = _validate_steps(self._steps({"kind": "draft_approval"}))
        assert err is not None and "from_step" in err

    def test_rejects_forward_or_self_ref(self):
        # from_step must reference an EARLIER step (the await is idx 1).
        _, err = _validate_steps(self._steps({"kind": "draft_approval", "from_step": 1}))
        assert err is not None and "earlier step" in err

    def test_rejects_non_integer_from_step(self):
        _, err = _validate_steps(
            self._steps({"kind": "draft_approval", "from_step": "0"})
        )
        assert err is not None and "integer" in err

    def test_explicit_draft_id_bypasses_from_step_requirement(self):
        steps, err = _validate_steps(
            self._steps({"kind": "draft_approval", "draft_id": str(uuid4())})
        )
        assert err is None


# ── unit: $from_step arg threading ────────────────────────────────────────────


class _FakeStep:
    def __init__(self, idx, status, result):
        self.idx = idx
        self.status = status
        self.result = result


class TestResolveStepRefs:
    def test_threads_applied_entity_id(self):
        eid = str(uuid4())
        steps = {1: _FakeStep(1, "completed", {"applied_entity_id": eid})}
        args = {"object_id": {"$from_step": 1}, "report_type": "intake"}
        out = _resolve_step_refs(args, steps)
        assert out == {"object_id": eid, "report_type": "intake"}

    def test_custom_field_and_nesting(self):
        steps = {0: _FakeStep(0, "completed", {"draft_id": "d-9"})}
        args = {"meta": {"src": {"$from_step": 0, "field": "draft_id"}}}
        assert _resolve_step_refs(args, steps) == {"meta": {"src": "d-9"}}

    def test_raises_on_unknown_step(self):
        with pytest.raises(_StepRefError):
            _resolve_step_refs({"x": {"$from_step": 5}}, {})

    def test_raises_on_incomplete_step(self):
        steps = {1: _FakeStep(1, "awaiting_user", {})}
        with pytest.raises(_StepRefError):
            _resolve_step_refs({"x": {"$from_step": 1}}, steps)

    def test_raises_on_missing_field(self):
        steps = {1: _FakeStep(1, "completed", {"other": "v"})}
        with pytest.raises(_StepRefError):
            _resolve_step_refs({"x": {"$from_step": 1}}, steps)

    def test_passthrough_without_refs(self):
        assert _resolve_step_refs({"a": 1, "b": ["x"]}, {}) == {"a": 1, "b": ["x"]}


# ── integration: the full chain ──────────────────────────────────────────────


@pytest.fixture
def org(db_session):
    o = Organization(name="Chain Museum", slug=f"chain-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


@pytest.fixture
def user(db_session, org):
    # Active org member — the executor re-validates membership before running.
    u = User(email=f"reg-{uuid4().hex[:8]}@example.com", display_name="Registrar",
             status="active")
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


def _ctx(db_session, org, user):
    return AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="staff",
        db_session=db_session,
    )


def _make_plan(db_session, ctx, org, steps_raw):
    conv = Conversation(
        organization_id=org.organization_id, user_id=ctx.user_id, persona="staff"
    )
    db_session.add(conv)
    db_session.flush()
    validated, err = _validate_steps(steps_raw)
    assert err is None, err
    svc = PlanService(db_session, context=ctx)
    plan = AgentPlan(
        conversation_id=conv.conversation_id,
        organization_id=org.organization_id,
        persona_used="staff",
        goal="chain test",
        status="pending",
        context_snapshot=_serialize_context(ctx),
    )
    db_session.add(plan)
    db_session.flush()
    svc._persist_steps(plan, validated)
    db_session.commit()
    return svc, plan


def _chain_steps():
    obj_number = f"2026.{uuid4().hex[:6]}"
    return obj_number, [
        {"description": "Catalog the new object", "kind": "tool_call",
         "tool": "propose_collection_object_draft", "persona": "registrar",
         "args": {"object_number": obj_number}},
        {"description": "Approve the object record", "kind": "await",
         "wait_for": {"kind": "draft_approval", "from_step": 0}},
        {"description": "Intake condition report for the new object",
         "kind": "tool_call", "tool": "propose_condition_report_draft",
         "persona": "conservator",
         "args": {"object_id": {"$from_step": 1, "field": "applied_entity_id"},
                  "report_type": "intake", "report_date": "2026-06-06"}},
    ]


def test_full_draft_chain(db_session, org, user):
    """propose (gated) → park on its approval → approve → apply → resume →
    the new object_id threads into the condition-report step's args."""
    from app.services.approval_service import review_approval

    # Gate the object record so its draft carries an ApprovalRequest.
    db_session.add(ApprovalRule(
        organization_id=org.organization_id,
        entity_type="collection_object",
        trigger_action="create",
        approver_permission="collections.approve",
    ))
    db_session.flush()

    ctx = _ctx(db_session, org, user)
    obj_number, steps_raw = _chain_steps()
    svc, plan = _make_plan(db_session, ctx, org, steps_raw)

    # 1. Run → the plan pauses on the draft_approval await.
    result = svc.run_plan(plan.plan_id)
    assert result.halted and result.halt_reason == "awaiting"

    steps = (
        db_session.query(AgentPlanStep)
        .filter(AgentPlanStep.plan_id == plan.plan_id)
        .order_by(AgentPlanStep.idx)
        .all()
    )
    propose_step, await_step, consumer_step = steps
    assert propose_step.status == "completed"
    assert await_step.status == "awaiting_user"
    assert consumer_step.status == "pending"

    # The proposed draft is linked back to the step that created it, and the
    # await resolved from_step → its concrete draft_id.
    obj_draft = (
        db_session.query(AgentDraft)
        .filter(AgentDraft.plan_id == plan.plan_id,
                AgentDraft.entity_type == "collection_object")
        .one()
    )
    assert obj_draft.plan_step_id == propose_step.step_id
    assert obj_draft.approval_request_id is not None
    assert obj_draft.applied_entity_id is None  # not applied yet
    assert await_step.wait_for["draft_id"] == str(obj_draft.draft_id)

    # 2. Approve through the real approvals path → applies the draft AND, via
    #    handle_draft_decision, signals the parked plan step.
    review_approval(obj_draft.approval_request_id, user.user_id, "approved", None,
                    db_session)

    db_session.refresh(plan)
    db_session.refresh(await_step)
    db_session.refresh(consumer_step)
    db_session.refresh(obj_draft)

    # The object now exists; the await carried its id in on resume.
    new_object_id = obj_draft.applied_entity_id
    assert new_object_id is not None
    assert db_session.get(CollectionObject, new_object_id).object_number == obj_number
    assert await_step.status == "completed"
    assert await_step.result["applied_entity_id"] == str(new_object_id)

    # 3. The consumer step ran with the threaded id — its condition-report
    #    draft targets the brand-new object.
    assert consumer_step.status == "completed"
    assert consumer_step.args["object_id"] == str(new_object_id)  # persisted resolution
    cr_draft = (
        db_session.query(AgentDraft)
        .filter(AgentDraft.plan_id == plan.plan_id,
                AgentDraft.entity_type == "condition_report")
        .one()
    )
    assert cr_draft.payload["object_id"] == str(new_object_id)
    assert plan.status == "completed"


def test_ungated_draft_resumes_via_direct_approve(db_session, org, user):
    """No ApprovalRule → the draft has no ApprovalRequest and is approved
    directly through the drafts inbox (approve_draft), NOT review_approval.
    The plan must still resume — the signal fires from approve_draft, the
    common chokepoint, so both paths are covered."""
    from app.services.drafts.draft_service import approve_draft

    ctx = _ctx(db_session, org, user)
    obj_number, steps_raw = _chain_steps()
    svc, plan = _make_plan(db_session, ctx, org, steps_raw)
    svc.run_plan(plan.plan_id)

    obj_draft = (
        db_session.query(AgentDraft)
        .filter(AgentDraft.plan_id == plan.plan_id,
                AgentDraft.entity_type == "collection_object")
        .one()
    )
    assert obj_draft.approval_request_id is None  # ungated

    # The drafts-inbox approve path (direct, no review_approval).
    approve_draft(db_session, obj_draft.draft_id, user.user_id)

    db_session.refresh(plan)
    obj_draft = db_session.get(AgentDraft, obj_draft.draft_id)
    cr_draft = (
        db_session.query(AgentDraft)
        .filter(AgentDraft.plan_id == plan.plan_id,
                AgentDraft.entity_type == "condition_report")
        .one_or_none()
    )
    assert plan.status == "completed"
    assert cr_draft is not None
    assert cr_draft.payload["object_id"] == str(obj_draft.applied_entity_id)


def test_acquisition_template_end_to_end(db_session, org, user, monkeypatch):
    """Capstone: drive the REAL acquisition_accession template through
    create_plan → run → approve the two gated drafts → the cataloged object's
    id threads into the intake condition report → the plan completes."""
    from app.services.approval_service import review_approval

    for entity in ("acquisition", "collection_object"):
        db_session.add(ApprovalRule(
            organization_id=org.organization_id,
            entity_type=entity,
            trigger_action="create",
            approver_permission=f"{entity}.approve",
        ))
    db_session.flush()

    ctx = _ctx(db_session, org, user)
    conv = Conversation(
        organization_id=org.organization_id, user_id=user.user_id, persona="staff"
    )
    db_session.add(conv)
    db_session.flush()

    obj_number = f"2026.{uuid4().hex[:6]}"
    svc = PlanService(db_session, context=ctx)
    created = svc.create_plan(
        "process this new acquisition",
        conv,
        template_id="acquisition_accession",
        template_params={
            "acquisition_method": "gift",
            "object_number": obj_number,
            "source_name": "Generous Donor",
        },
    )
    assert created.error is None, created.error
    plan = created.plan
    # propose, delegate (curator review), await, entry, catalog, await, condition
    assert len(created.steps) == 7
    db_session.commit()

    # Stub the curator delegate so the run doesn't invoke the LLM — the chaining
    # behavior under test is deterministic; the delegate's advisory output isn't.
    from app.services.agent_tools import get_tool_registry, ToolExecutionResult
    _reg = get_tool_registry()
    _orig_execute = _reg.execute

    def _stub_execute(tool_name, arguments, context):
        if tool_name == "delegate_to_specialist":
            advisory = {"answer": "Provenance clear; a significant gift for the collection."}
            return ToolExecutionResult(result_for_prompt=advisory, result_raw=advisory)
        return _orig_execute(tool_name, arguments, context)

    monkeypatch.setattr(_reg, "execute", _stub_execute)

    def _approve(entity_type):
        d = (
            db_session.query(AgentDraft)
            .filter(AgentDraft.plan_id == plan.plan_id,
                    AgentDraft.entity_type == entity_type)
            .one()
        )
        review_approval(d.approval_request_id, user.user_id, "approved", None, db_session)
        return d

    # Run → parks on the acquisition (board) sign-off.
    svc.run_plan(plan.plan_id)
    # Approve it → resumes, drafts the entry + catalog, parks on catalog sign-off.
    _approve("acquisition")
    # Approve the catalog record → resumes, threads the new object_id, completes.
    obj_draft = _approve("collection_object")

    db_session.refresh(plan)
    cr_draft = (
        db_session.query(AgentDraft)
        .filter(AgentDraft.plan_id == plan.plan_id,
                AgentDraft.entity_type == "condition_report")
        .one()
    )
    assert plan.status == "completed"
    assert db_session.get(CollectionObject, obj_draft.applied_entity_id) is not None
    # The condition report targets the freshly-cataloged object (threading).
    assert cr_draft.payload["object_id"] == str(obj_draft.applied_entity_id)
    assert cr_draft.payload["report_type"] == "intake"


def test_conservation_template_end_to_end(db_session, org, user):
    """A second real template end-to-end (conservation_treatment): no delegate,
    no gate. Drive create_plan → run → it parks on the treatment sign-off after
    drafting the pre-treatment report → approve the treatment (ungated, via the
    inbox) → it resumes and drafts the post-treatment report → completes.

    Proves the new object-scoped, multi-draft templates run through the real
    executor under their declared personas (conservator), not just instantiate."""
    from app.services.drafts.draft_service import approve_draft

    obj = CollectionObject(
        organization_id=org.organization_id, object_number=f"2026.{uuid4().hex[:6]}",
    )
    db_session.add(obj)
    db_session.flush()

    ctx = _ctx(db_session, org, user)
    conv = Conversation(
        organization_id=org.organization_id, user_id=user.user_id, persona="staff"
    )
    db_session.add(conv)
    db_session.flush()

    svc = PlanService(db_session, context=ctx)
    created = svc.create_plan(
        "conserve this object",
        conv,
        template_id="conservation_treatment",
        template_params={
            "object_id": str(obj.object_id),
            "treatment_type": "cleaning",
            "proposal_summary": "Surface clean and re-house.",
        },
    )
    assert created.error is None, created.error
    plan = created.plan
    # pre-treatment report, treatment proposal, await sign-off, post-treatment report
    assert len(created.steps) == 4
    db_session.commit()

    # Run → drafts the pre-treatment report + the treatment, parks on the
    # treatment sign-off (idx 2) before the post-treatment report.
    result = svc.run_plan(plan.plan_id)
    assert result.halted and result.halt_reason == "awaiting"

    treat_draft = (
        db_session.query(AgentDraft)
        .filter(AgentDraft.plan_id == plan.plan_id,
                AgentDraft.entity_type == "conservation_treatment")
        .one()
    )
    # Pre-treatment report exists; post-treatment one does NOT yet (still parked).
    cr_types = [
        d.payload.get("report_type")
        for d in db_session.query(AgentDraft).filter(
            AgentDraft.plan_id == plan.plan_id,
            AgentDraft.entity_type == "condition_report",
        )
    ]
    assert cr_types == ["pre_treatment"]

    # Approve the treatment through the drafts inbox (ungated path) → resume.
    approve_draft(db_session, treat_draft.draft_id, user.user_id)

    db_session.refresh(plan)
    cr_types_after = sorted(
        d.payload.get("report_type")
        for d in db_session.query(AgentDraft).filter(
            AgentDraft.plan_id == plan.plan_id,
            AgentDraft.entity_type == "condition_report",
        )
    )
    assert plan.status == "completed"
    assert cr_types_after == ["post_treatment", "pre_treatment"]


def test_rejecting_the_draft_fails_the_plan(db_session, org, user):
    """If the gated draft is rejected, the await fails and the plan halts —
    the downstream consumer never runs (no orphaned condition report)."""
    from app.services.approval_service import review_approval

    db_session.add(ApprovalRule(
        organization_id=org.organization_id,
        entity_type="collection_object",
        trigger_action="create",
        approver_permission="collections.approve",
    ))
    db_session.flush()

    ctx = _ctx(db_session, org, user)
    _, steps_raw = _chain_steps()
    svc, plan = _make_plan(db_session, ctx, org, steps_raw)
    svc.run_plan(plan.plan_id)

    obj_draft = (
        db_session.query(AgentDraft)
        .filter(AgentDraft.plan_id == plan.plan_id,
                AgentDraft.entity_type == "collection_object")
        .one()
    )
    review_approval(obj_draft.approval_request_id, user.user_id, "rejected",
                    "not this one", db_session)

    db_session.refresh(plan)
    steps = (
        db_session.query(AgentPlanStep)
        .filter(AgentPlanStep.plan_id == plan.plan_id)
        .order_by(AgentPlanStep.idx)
        .all()
    )
    assert plan.status == "failed"
    assert steps[1].status == "failed"
    assert steps[2].status == "skipped"
    # No condition-report draft was ever created.
    assert (
        db_session.query(AgentDraft)
        .filter(AgentDraft.plan_id == plan.plan_id,
                AgentDraft.entity_type == "condition_report")
        .count()
    ) == 0
