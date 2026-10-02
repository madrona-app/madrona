"""API tests for POST /api/organizations/{org}/agent/plans/{plan_id}/run.

Guide Studio v1 Phase 0 — the executor trigger. These exercise the
endpoint contract end-to-end through the real FastAPI app + auth +
RLS-scoped session, not the service in isolation (service-level
behavior is covered by test_agent_plan_service.py).

Plans are hand-constructed rather than created through the planner LLM:
the endpoint's behavior depends only on persisted plan state, and the
auth_setup user is an active org member with a known persona, so
_revalidate_permissions passes deterministically with no model call.
"""

from uuid import uuid4

import pytest

from app.models import AgentPlan, AgentPlanStep, Conversation, Organization


@pytest.fixture(autouse=True)
def _agent_enabled(monkeypatch):
    """These endpoints are gated behind AGENT_ENABLED (default off, incl. CI).
    The plan-run contract tests assume the feature is on, so enable it here."""
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "agent_enabled", True)


def _run_url(org, plan_id):
    return f"/api/organizations/{org.organization_id}/agent/plans/{plan_id}/run"


def _make_conversation(db_session, org_id, user_id):
    conv = Conversation(
        organization_id=org_id,
        user_id=user_id,
        persona="staff",
    )
    db_session.add(conv)
    db_session.flush()
    return conv


def _make_plan(db_session, org_id, user_id, *, status="pending", steps=None):
    conv = _make_conversation(db_session, org_id, user_id)
    plan = AgentPlan(
        conversation_id=conv.conversation_id,
        organization_id=org_id,
        persona_used="staff",
        goal="Test plan",
        status=status,
        context_snapshot={
            "organization_id": str(org_id),
            "user_id": str(user_id),
            "persona": "staff",
        },
    )
    db_session.add(plan)
    db_session.flush()
    for idx, spec in enumerate(steps or []):
        db_session.add(AgentPlanStep(
            plan_id=plan.plan_id,
            idx=idx,
            kind=spec["kind"],
            description=spec.get("description", f"step {idx}"),
            tool=spec.get("tool"),
            args=spec.get("args"),
            persona=spec.get("persona"),
            wait_for=spec.get("wait_for"),
            branch=spec.get("branch"),
            phase=spec.get("phase"),
            status=spec.get("status", "pending"),
        ))
    db_session.commit()
    return plan


class TestRunAgentPlan:
    def test_zero_step_plan_completes(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = _make_plan(
            db_session, org.organization_id, user.user_id, steps=[],
        )
        resp = client.post(_run_url(org, plan.plan_id))
        assert resp.status_code == 200, resp.text
        body = resp.get_json()
        assert body["status"] == "completed"
        assert body["halted"] is False
        assert body["halt_reason"] is None
        assert body["steps_executed"] == 0

    def test_await_step_halts_plan(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = _make_plan(
            db_session, org.organization_id, user.user_id,
            steps=[{
                "kind": "await",
                "wait_for": {
                    "kind": "approval_request",
                    "request_id": str(uuid4()),
                },
            }],
        )
        resp = client.post(_run_url(org, plan.plan_id))
        assert resp.status_code == 200, resp.text
        body = resp.get_json()
        assert body["status"] == "awaiting"
        assert body["halted"] is True
        assert body["halt_reason"] == "awaiting"

    def test_unknown_plan_is_404(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(_run_url(org, uuid4()))
        assert resp.status_code == 404
        assert resp.get_json()["error"]["code"] == "not_found"

    def test_cross_org_plan_is_404_not_disclosed(self, auth_setup, db_session):
        """A plan in another org must resolve to 404 — never 403 — so its
        existence is not disclosed across the tenant boundary."""
        client, org, user = auth_setup
        other_org = Organization(
            name="Other Org", slug=f"other-{uuid4().hex[:8]}",
            is_demo=False, status="active",
        )
        db_session.add(other_org)
        db_session.flush()
        # Reuse the same user as conversation owner; the guard is on the
        # plan's organization_id vs the path org, independent of the user.
        foreign_plan = _make_plan(
            db_session, other_org.organization_id, user.user_id, steps=[],
        )
        resp = client.post(_run_url(org, foreign_plan.plan_id))
        assert resp.status_code == 404
        assert resp.get_json()["error"]["code"] == "not_found"

    def test_completed_plan_is_idempotent(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = _make_plan(
            db_session, org.organization_id, user.user_id,
            status="completed", steps=[],
        )
        resp = client.post(_run_url(org, plan.plan_id))
        assert resp.status_code == 200, resp.text
        body = resp.get_json()
        assert body["status"] == "completed"
        assert body["halted"] is True
        assert body["halt_reason"] == "already_done"

    def test_awaiting_plan_does_not_advance(self, auth_setup, db_session):
        """run_plan on an already-awaiting plan returns its state without
        advancing — resumption is owned by the Celery scanner / approval
        hook, not a user Run click."""
        client, org, user = auth_setup
        plan = _make_plan(
            db_session, org.organization_id, user.user_id,
            status="awaiting",
            steps=[{
                "kind": "await",
                "wait_for": {
                    "kind": "approval_request",
                    "request_id": str(uuid4()),
                },
                "status": "awaiting_user",
            }],
        )
        resp = client.post(_run_url(org, plan.plan_id))
        assert resp.status_code == 200, resp.text
        body = resp.get_json()
        assert body["status"] == "awaiting"
        assert body["halted"] is True
        assert body["halt_reason"] == "awaiting"

    def test_run_requires_auth(self, client, auth_setup, db_session):
        """Unauthenticated call is rejected (no bearer token)."""
        _, org, user = auth_setup
        plan = _make_plan(
            db_session, org.organization_id, user.user_id, steps=[],
        )
        # `client` is the raw unauthenticated test client.
        resp = client.post(_run_url(org, plan.plan_id))
        assert resp.status_code in (401, 403)


def _form_url(org, plan_id, step_id):
    return (
        f"/api/organizations/{org.organization_id}"
        f"/agent/plans/{plan_id}/steps/{step_id}/form-submitted"
    )


def _first_step(db_session, plan_id):
    return (
        db_session.query(AgentPlanStep)
        .filter(AgentPlanStep.plan_id == plan_id)
        .order_by(AgentPlanStep.idx)
        .first()
    )


class TestSubmitAgentPlanForm:
    """The form_submission delivery bridge: POSTing form-submitted resolves
    the await and resumes the plan."""

    def test_form_submission_resumes_plan(self, auth_setup, db_session):
        client, org, user = auth_setup
        # form_submission as the last step: after the signal there's nothing
        # left to execute, so the plan completes without running real tools.
        plan = _make_plan(
            db_session, org.organization_id, user.user_id,
            steps=[{
                "kind": "await",
                "wait_for": {
                    "kind": "form_submission",
                    "form": "condition_report",
                    "entity": "collection_object",
                    "entity_id": str(uuid4()),
                },
            }],
        )
        assert client.post(_run_url(org, plan.plan_id)).status_code == 200
        step = _first_step(db_session, plan.plan_id)
        db_session.refresh(step)
        assert step.status == "awaiting_user"

        resp = client.post(_form_url(org, plan.plan_id, step.step_id))
        assert resp.status_code == 200, resp.text
        body = resp.get_json()
        assert body["status"] == "completed"
        assert body["halted"] is False

        db_session.refresh(step)
        assert step.status == "completed"

    def test_non_form_await_is_409(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = _make_plan(
            db_session, org.organization_id, user.user_id,
            steps=[{
                "kind": "await",
                "wait_for": {"kind": "approval_request",
                             "request_id": str(uuid4())},
            }],
        )
        assert client.post(_run_url(org, plan.plan_id)).status_code == 200
        step = _first_step(db_session, plan.plan_id)
        resp = client.post(_form_url(org, plan.plan_id, step.step_id))
        assert resp.status_code == 409, resp.text
        assert "not_form_await" in resp.text

    def test_unknown_step_is_404(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = _make_plan(
            db_session, org.organization_id, user.user_id, steps=[],
        )
        resp = client.post(_form_url(org, plan.plan_id, uuid4()))
        assert resp.status_code == 404


def _list_url(org, status=None):
    base = f"/api/organizations/{org.organization_id}/agent/plans"
    return f"{base}?status={status}" if status else base


def _get_url(org, plan_id):
    return f"/api/organizations/{org.organization_id}/agent/plans/{plan_id}"


class TestListAndGetAgentPlans:
    """The Plans page read APIs: a user's plan inbox + per-plan detail."""

    def test_list_returns_users_plans_newest_first(self, auth_setup, db_session):
        from datetime import datetime, timedelta, timezone

        client, org, user = auth_setup
        older = _make_plan(db_session, org.organization_id, user.user_id, steps=[])
        newer = _make_plan(db_session, org.organization_id, user.user_id, steps=[])
        # func.now() is constant within a transaction, so both rows share a
        # created_at — push one back so the desc ordering is observable.
        older.created_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        db_session.add(older)
        db_session.commit()

        resp = client.get(_list_url(org))
        assert resp.status_code == 200, resp.text
        ids = [p['plan_id'] for p in resp.get_json()['plans']]
        assert str(older.plan_id) in ids and str(newer.plan_id) in ids
        assert ids.index(str(newer.plan_id)) < ids.index(str(older.plan_id))

    def test_list_status_filter(self, auth_setup, db_session):
        client, org, user = auth_setup
        _make_plan(
            db_session, org.organization_id, user.user_id,
            status='completed', steps=[],
        )
        awaiting = _make_plan(
            db_session, org.organization_id, user.user_id, status='awaiting',
            steps=[{
                'kind': 'await', 'status': 'awaiting_user',
                'wait_for': {'kind': 'approval_request', 'request_id': str(uuid4())},
            }],
        )
        resp = client.get(_list_url(org, status='awaiting'))
        assert resp.status_code == 200, resp.text
        ids = [p['plan_id'] for p in resp.get_json()['plans']]
        assert ids == [str(awaiting.plan_id)]

    def test_awaits_user_flag_and_kind(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = _make_plan(
            db_session, org.organization_id, user.user_id, status='awaiting',
            steps=[{
                'kind': 'await', 'status': 'awaiting_user',
                'wait_for': {'kind': 'form_submission', 'form': 'x'},
            }],
        )
        body = client.get(_get_url(org, plan.plan_id)).get_json()
        assert body['awaits_user'] is True
        assert body['awaiting_kind'] == 'form_submission'

    def test_get_includes_steps_with_wait_for(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = _make_plan(
            db_session, org.organization_id, user.user_id, status='awaiting',
            steps=[
                {'kind': 'tool_call', 'tool': 'lookup_playbook', 'status': 'completed'},
                {'kind': 'await', 'status': 'awaiting_user',
                 'wait_for': {'kind': 'approval_request', 'request_id': str(uuid4())}},
            ],
        )
        resp = client.get(_get_url(org, plan.plan_id))
        assert resp.status_code == 200, resp.text
        steps = resp.get_json()['steps']
        assert len(steps) == 2
        assert steps[1]['kind'] == 'await'
        assert steps[1]['wait_for']['kind'] == 'approval_request'

    def test_get_cross_org_is_404(self, auth_setup, db_session):
        client, org, user = auth_setup
        other = Organization(name='Other', slug=f'other-{uuid4().hex[:8]}')
        db_session.add(other)
        db_session.flush()
        foreign = _make_plan(
            db_session, other.organization_id, user.user_id, steps=[],
        )
        resp = client.get(_get_url(org, foreign.plan_id))
        assert resp.status_code == 404


def _decide_url(org, plan_id, step_id):
    return (
        f"/api/organizations/{org.organization_id}/agent/plans/"
        f"{plan_id}/steps/{step_id}/decide"
    )


class TestDecideAgentPlanStep:
    """The branch-decision resume endpoint, end-to-end through the app."""

    def _branching_plan(self, db_session, org_id, user_id):
        return _make_plan(db_session, org_id, user_id, steps=[
            {"kind": "decision", "description": "Keep or return?",
             "args": {"options": [{"key": "keep", "label": "Keep"},
                                  {"key": "return", "label": "Return"}]}},
            {"kind": "tool_call", "tool": "propose_collection_object_draft",
             "persona": "registrar", "branch": "keep",
             "args": {"object_number": f"2026.{uuid4().hex[:5]}"}},
            {"kind": "tool_call", "tool": "propose_object_exit_draft",
             "persona": "registrar", "branch": "return",
             "args": {"exit_reason": "enquiry_return"}},
        ])

    def test_decide_runs_chosen_branch_skips_other(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = self._branching_plan(db_session, org.organization_id, user.user_id)

        run = client.post(_run_url(org, plan.plan_id))
        assert run.status_code == 200, run.text
        assert run.get_json()["status"] == "awaiting"

        steps = client.get(_get_url(org, plan.plan_id)).get_json()["steps"]
        decision = next(s for s in steps if s["kind"] == "decision")
        assert decision["options"][0]["key"] == "keep"

        resp = client.post(
            _decide_url(org, plan.plan_id, decision["step_id"]),
            json={"chosen": "keep"},
        )
        assert resp.status_code == 200, resp.text
        assert resp.get_json()["status"] == "completed"

        steps = client.get(_get_url(org, plan.plan_id)).get_json()["steps"]
        by_branch = {s["branch"]: s for s in steps if s.get("branch")}
        assert by_branch["keep"]["status"] == "completed"
        assert by_branch["return"]["status"] == "skipped"

    def test_decide_invalid_choice_is_422(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = self._branching_plan(db_session, org.organization_id, user.user_id)
        client.post(_run_url(org, plan.plan_id))
        steps = client.get(_get_url(org, plan.plan_id)).get_json()["steps"]
        decision = next(s for s in steps if s["kind"] == "decision")
        resp = client.post(
            _decide_url(org, plan.plan_id, decision["step_id"]),
            json={"chosen": "bogus"},
        )
        assert resp.status_code == 422, resp.text


class TestStepSerialization:
    """Plan-detail redesign: the step serializer carries phase + result facts."""

    def test_phase_and_result_facts_serialize(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = _make_plan(db_session, org.organization_id, user.user_id, steps=[
            {"kind": "tool_call", "tool": "propose_acquisition_draft",
             "persona": "registrar", "phase": "Receipt",
             "args": {"acquisition_method": "gift", "source_name": "A. Donor"}},
        ])
        # Run → the propose step completes (produces an acquisition draft).
        assert client.post(_run_url(org, plan.plan_id)).status_code == 200

        steps = client.get(_get_url(org, plan.plan_id)).get_json()["steps"]
        s0 = steps[0]
        assert s0["phase"] == "Receipt"
        assert s0["completed_at"]  # absolute ISO timestamp, not "2h ago"
        facts = s0["result_facts"]
        assert facts and facts["entity_type"] == "acquisition"
        assert facts["draft_id"]            # link-able artifact fact
        # Not applied yet → no entity link, and the draft is still pending.
        assert facts.get("applied_entity_id") is None
        assert facts.get("draft_status") == "pending"

    def test_ungrouped_plan_has_null_phase(self, auth_setup, db_session):
        client, org, user = auth_setup
        plan = _make_plan(db_session, org.organization_id, user.user_id, steps=[
            {"kind": "await", "wait_for": {"kind": "approval_request",
                                           "request_id": str(uuid4())}},
        ])
        steps = client.get(_get_url(org, plan.plan_id)).get_json()["steps"]
        assert steps[0]["phase"] is None      # ad-hoc/ungrouped → flat rail
        assert steps[0]["result_facts"] is None
