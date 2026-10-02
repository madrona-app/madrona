"""Agent plan service: invoke the planner, validate output, persist plans,
and execute pending steps.

Two phases combined:

Phase 2.1 — creation. The staff agent's `make_plan(goal)` tool calls
PlanService.create_plan, which invokes the planner persona, parses its
JSON output, validates each step's schema, and persists AgentPlan +
AgentPlanSteps rows.

Phase 2.2 — execution. PlanService.run_plan(plan_id) walks pending steps
serially. Each step is executed via the tool registry (tool_call or
delegate kinds) and checkpointed to step_state JSONB before the executor
advances. await steps halt the plan with status='awaiting' for Phase 2.3
to resume on external signals.

Key invariants:
- Malformed planner output is rejected wholesale; partial plans never land.
- context_snapshot captures enough to re-validate permissions on resume.
- Each step's result is committed before the next step starts; a process
  crash mid-step leaves the prior steps complete and the in-progress
  step recoverable via recover_stalled_plans.
- Step failure halts the plan; remaining pending steps are marked
  'skipped' (no auto-retry in v1).
"""

from __future__ import annotations

import json
import logging
import re
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import AgentPlan, AgentPlanStep, Conversation
from app.services.agent_persona import SPECIALIST_PERSONAS
from app.services.agent_tools import AgentContext

logger = logging.getLogger(__name__)


def _now() -> datetime:
    return datetime.now(timezone.utc)


# --- config ---

MAX_PLAN_STEPS = 8
MIN_PLAN_STEPS = 0  # planner may legitimately return zero on ambiguous goals
MAX_GOAL_LENGTH = 4000

VALID_STEP_KINDS = {"tool_call", "delegate", "await", "decision"}
VALID_WAIT_KINDS = {
    "approval_request",
    "form_submission",
    "workflow_transition",
    # §1D: park until an async background job (transcription, derivatives, CLIP)
    # finishes — resolved by the entity's own status column, not the Celery
    # result backend. Scanned by tasks.agent_plans.scan_awaiting_jobs.
    "job_completion",
    # Draft-chaining: park until the draft a PRIOR step proposed is approved
    # AND applied. wait_for carries {from_step: <idx>} at author time; the
    # executor resolves that step's returned draft_id into {draft_id: <uuid>}
    # when it reaches the await. handle_draft_decision signals it on apply,
    # threading the new entity's applied_entity_id into the signal so later
    # steps can reference it via {"$from_step": <await idx>}.
    "draft_approval",
}

# Permission an org member must hold to approve a Guide agent plan. Registered
# in the Permission enum + granted via migration; the per-org ApprovalRule is
# created lazily by _ensure_agent_plan_approval_rule.
AGENT_PLAN_APPROVER_PERMISSION = "guide.approve_plan"


# --- value types ---


@dataclass
class PlanCreationResult:
    """Outcome of create_plan. Always returned (never raised) so the
    make_plan tool can render an error to the user without crashing the
    staff agent's tool loop."""

    plan: AgentPlan | None = None
    steps: list[AgentPlanStep] = field(default_factory=list)
    error: str | None = None
    error_kind: str | None = None  # 'parse_error' | 'validation_error' | 'llm_error' | etc.
    raw_planner_output: str | None = None
    duration_ms: int = 0


@dataclass
class PlanRunResult:
    """Outcome of run_plan. The plan is always returned (in its current
    persisted state); halted=True means execution stopped before all
    steps completed and halt_reason explains why.

    halt_reason values:
        'awaiting'    — an await step paused the plan; Phase 2.3 resumes
        'failed'      — a step errored; remaining steps marked 'skipped'
        'cancelled'   — plan was cancelled before the run started
        'already_done' — plan was completed/failed before the call (no-op)
        None           — execution finished cleanly with status='completed'
    """

    plan: AgentPlan
    steps_executed: int = 0
    halted: bool = False
    halt_reason: str | None = None
    last_error: str | None = None


# --- public API ---


class PlanService:
    """Stateful per-request service.

    The constructor's `context` is required for create_plan (it captures
    the org/user/persona of the user *initiating* a plan). For run_plan,
    context is optional — the executor rehydrates AgentContext from the
    plan's stored context_snapshot instead.
    """

    def __init__(self, session: Session, context: AgentContext | None = None):
        self.session = session
        self.context = context

    def create_plan(
        self,
        goal: str,
        conversation: Conversation,
        parent_message_id: UUID | None = None,
        template_id: str | None = None,
        template_params: dict | None = None,
    ) -> PlanCreationResult:
        """Plan creation entry point. Returns a PlanCreationResult; on
        success `result.plan` is the persisted AgentPlan and `result.steps`
        are the inserted steps in order. On failure, both are empty and
        `error_kind`/`error` describe what went wrong.

        §1E: an explicit `template_id` (or a trigger-phrase match against the
        catalog) instantiates a deterministic plan template — no planner LLM
        call. Falls through to free-form planning on no match / unresolved
        required params / invalid template steps."""
        if self.context is None:
            return PlanCreationResult(
                error="create_plan requires AgentContext on the service",
                error_kind="validation_error",
            )
        if not goal or not goal.strip():
            return PlanCreationResult(
                error="goal is required",
                error_kind="validation_error",
            )
        if len(goal) > MAX_GOAL_LENGTH:
            return PlanCreationResult(
                error=f"goal exceeds {MAX_GOAL_LENGTH} characters",
                error_kind="validation_error",
            )

        resolved = self._resolve_template(goal, template_id, template_params)
        if resolved is not None:
            template, validated_steps = resolved
            plan = AgentPlan(
                conversation_id=conversation.conversation_id,
                organization_id=conversation.organization_id,
                parent_message_id=parent_message_id,
                persona_used="planner",
                goal=(template.goal or goal).strip(),
                status="pending",
                context_snapshot=_serialize_context(self.context),
                # Deterministic: no planner LLM produced this, so model pinning
                # is honestly NULL (never a guessed model — v1 §7.4).
                model_provider=None,
                model_id=None,
                model_version=None,
            )
            self.session.add(plan)
            self.session.flush()
            step_records = self._persist_steps(plan, validated_steps)
            self.session.commit()
            return PlanCreationResult(plan=plan, steps=step_records, duration_ms=0)

        t0 = time.monotonic()
        raw, llm_error, model_identity = _invoke_planner(
            self.session, self.context, goal
        )
        duration_ms = int((time.monotonic() - t0) * 1000)

        if llm_error is not None:
            return PlanCreationResult(
                error=llm_error,
                error_kind="llm_error",
                raw_planner_output=raw,
                duration_ms=duration_ms,
            )

        parsed = _parse_planner_json(raw)
        if parsed is None:
            return PlanCreationResult(
                error="planner returned non-JSON output",
                error_kind="parse_error",
                raw_planner_output=raw,
                duration_ms=duration_ms,
            )

        validated_steps, validation_error = _validate_steps(parsed.get("steps") or [])
        if validation_error is not None:
            return PlanCreationResult(
                error=validation_error,
                error_kind="validation_error",
                raw_planner_output=raw,
                duration_ms=duration_ms,
            )

        plan = AgentPlan(
            conversation_id=conversation.conversation_id,
            organization_id=conversation.organization_id,
            parent_message_id=parent_message_id,
            persona_used="planner",
            goal=str(parsed.get("goal") or goal).strip(),
            status="pending",
            context_snapshot=_serialize_context(self.context),
            model_provider=model_identity["model_provider"],
            model_id=model_identity["model_id"],
            model_version=model_identity["model_version"],
        )
        self.session.add(plan)
        self.session.flush()  # plan_id available for the FK on steps

        step_records = self._persist_steps(plan, validated_steps)

        self.session.commit()

        return PlanCreationResult(
            plan=plan,
            steps=step_records,
            raw_planner_output=raw,
            duration_ms=duration_ms,
        )

    # --- §1E plan templates ----------------------------------------------

    def _resolve_template(
        self,
        goal: str,
        template_id: str | None,
        template_params: dict | None,
    ):
        """Resolve a plan template to validated steps, or None (→ free-form
        planning). An explicit template_id is used directly; otherwise the goal
        is trigger-phrase matched against the catalog. Returns None if no match,
        a required param can't be resolved, or — defensively — the rendered
        steps fail _validate_steps (a template bug should never persist a broken
        plan; we fall back to the planner instead)."""
        from app.services.agent_tools.plan_templates.catalog import (
            get_template,
            instantiate,
            match_template,
            resolve_params,
        )

        ctx_params = self._template_context_params()
        if template_id:
            template = get_template(template_id)
            if template is None:
                return None
        else:
            # Match on the goal + page context AND any params the caller already
            # extracted from the request — so a conversational "acquire 2026.1 by
            # purchase" matches the journey, not only a click from a page.
            template = match_template(goal, ctx_params, template_params)
            if template is None:
                return None

        params = resolve_params(template, ctx_params, template_params or {})
        if params is None:
            return None

        validated, err = _validate_steps(instantiate(template, params))
        if err is not None:
            logger.warning(
                "plan template %s produced invalid steps: %s",
                template.template_id, err,
            )
            return None
        return template, validated

    def _template_context_params(self) -> dict:
        """Param sources for template resolution: the per-turn page_context plus
        the structured viewed-entity (so e.g. object_id resolves when the user
        is on an object workspace)."""
        ctx = self.context
        params = dict(getattr(ctx, "page_context", None) or {})
        if (
            getattr(ctx, "context_entity_type", None) == "collection_object"
            and getattr(ctx, "context_entity_id", None)
        ):
            params.setdefault("object_id", str(ctx.context_entity_id))
        return params

    def _write_step_metric(self, plan, step, result, latency_ms: int) -> None:
        """Append one §2A effort metric for a completed step. Delegate steps
        carry real LLM telemetry (rounds/tokens) in result['_telemetry'];
        tool_call steps are deterministic by default — one tool call, no
        measured LLM (honest NULLs, never fabricated 0s)."""
        from app.models import AgentPlanStepMetric
        from app.services import agent_plan_effort as effort

        telem = result.get("_telemetry") if isinstance(result, dict) else None
        if step.kind == "delegate" and isinstance(telem, dict):
            input_tokens = telem.get("input_tokens")
            output_tokens = telem.get("output_tokens")
            llm_rounds = telem.get("llm_rounds")
            tool_calls = telem.get("tool_calls")
            delegation_depth = telem.get("delegation_depth", 1)
            model_provider = step.model_provider
            model_id = step.model_id
            model_version = step.model_version
        else:
            input_tokens = output_tokens = llm_rounds = None
            tool_calls = 1
            delegation_depth = None
            model_provider = model_id = model_version = None

        raw = effort.raw_effort(
            input_tokens, output_tokens, llm_rounds, tool_calls, delegation_depth
        )
        cost = effort.cost_estimate(model_id, input_tokens, output_tokens)
        attempt = (
            self.session.query(AgentPlanStepMetric)
            .filter(AgentPlanStepMetric.step_id == step.step_id)
            .count()
        ) + 1

        self.session.add(AgentPlanStepMetric(
            step_id=step.step_id,
            plan_id=plan.plan_id,
            organization_id=plan.organization_id,
            attempt=attempt,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            llm_rounds=llm_rounds,
            tool_calls=tool_calls,
            latency_ms=latency_ms,
            delegation_depth=delegation_depth,
            cost_estimate_usd=cost,
            raw_effort=raw,
            model_provider=model_provider,
            model_id=model_id,
            model_version=model_version,
        ))

    def _persist_steps(self, plan: "AgentPlan", validated_steps: list[dict]):
        """Insert ordered AgentPlanStep rows from validated step dicts."""
        step_records: list[AgentPlanStep] = []
        for idx, step in enumerate(validated_steps):
            record = AgentPlanStep(
                plan_id=plan.plan_id,
                idx=idx,
                kind=step["kind"],
                description=step["description"],
                tool=step.get("tool"),
                args=step.get("args"),
                persona=step.get("persona"),
                wait_for=step.get("wait_for"),
                branch=step.get("branch"),
                phase=step.get("phase"),
                status="pending",
            )
            self.session.add(record)
            step_records.append(record)
        return step_records

    # --- Phase 2.2 executor ----------------------------------------------

    def run_plan(self, plan_id: UUID) -> PlanRunResult | None:
        """Walk a plan's pending steps serially, persisting checkpoints.

        Returns None if the plan_id doesn't exist. Otherwise returns a
        PlanRunResult describing what happened. Idempotent for plans
        already in a terminal state (completed/failed/cancelled) — those
        return immediately with halt_reason='already_done'.

        On every entry — first run AND every resume — permissions are
        re-validated against the current database. A user that has lost
        their org membership or persona role between pause and resume
        causes the plan to fail rather than silently proceed.
        """
        plan = (
            self.session.query(AgentPlan)
            .filter(AgentPlan.plan_id == plan_id)
            .first()
        )
        if plan is None:
            return None

        if plan.status in ("completed", "failed", "cancelled"):
            return PlanRunResult(
                plan=plan, halted=True, halt_reason="already_done",
            )

        # Phase 2.3: re-validate permissions before any further work.
        permission_error = _revalidate_permissions(plan, self.session)
        if permission_error:
            plan.status = "failed"
            plan.last_error = permission_error
            plan.completed_at = _now()
            # Mark all pending/running steps as skipped — the plan can't
            # safely advance under revoked permissions.
            for step in plan.steps:
                if step.status in ("pending", "running"):
                    step.status = "skipped"
            self.session.commit()
            return PlanRunResult(
                plan=plan,
                halted=True,
                halt_reason="failed",
                last_error=permission_error,
            )

        # Promote pending → running on first invocation.
        if plan.status == "pending":
            plan.status = "running"
            plan.started_at = _now()
            self.session.commit()
            # Plan-start telemetry (v1 Phase 0). A structured log line is
            # the right depth here — the per-plan cost/telemetry table is
            # v1 §1.8 Phase 5 work; emitting to a DB surface now would be
            # building ahead of that design. step_count is read from the
            # already-loaded relationship (no extra query).
            logger.info(
                "agent_plan.started plan_id=%s conversation_id=%s "
                "org_id=%s persona=%s steps=%d model=%s/%s",
                plan.plan_id,
                plan.conversation_id,
                plan.organization_id,
                plan.persona_used,
                len(plan.steps),
                plan.model_provider,
                plan.model_id,
            )
        elif plan.status == "awaiting":
            # Someone called run_plan on a plan that's still waiting on a
            # signal. Don't auto-advance — the wait conditions are managed
            # by signal() and the Celery scanner. Return the current state.
            return PlanRunResult(
                plan=plan, halted=True, halt_reason="awaiting",
            )

        # Rehydrate AgentContext from the snapshot. The DB session is the
        # current request's session (live tools must read the *current*
        # database, not a frozen snapshot of it).
        ctx = _rehydrate_context(plan, self.session)

        steps = (
            self.session.query(AgentPlanStep)
            .filter(AgentPlanStep.plan_id == plan.plan_id)
            .order_by(AgentPlanStep.idx)
            .all()
        )

        executed = 0
        for step in steps:
            if step.status == "completed":
                continue  # already done; resume past it
            if step.status == "skipped":
                continue
            if step.status not in ("pending", "running"):
                # awaiting_user / awaiting_external / failed — stop here.
                # The caller (Phase 2.3) will resume via signal().
                break

            # Mark running. Persist the transition before doing work so a
            # crash mid-step is detectable by recover_stalled_plans.
            step.status = "running"
            if step.started_at is None:
                step.started_at = _now()
            self.session.commit()

            if step.kind == "decision":
                # A human branch point: park for the user's choice. On resume
                # (signal kind='decision'), the chosen branch's steps run and the
                # steps tagged with this decision's other keys are skipped.
                opts = _decision_option_keys(step)
                if len(opts) < 2:
                    return self._fail_plan(
                        plan, step, steps,
                        f"decision step {step.idx} needs >=2 options", executed,
                    )
                step.status = "awaiting_user"
                plan.status = "awaiting"
                self.session.commit()
                return PlanRunResult(
                    plan=plan,
                    steps_executed=executed,
                    halted=True,
                    halt_reason="awaiting",
                )

            if step.kind == "await":
                # Bind the await to a concrete, resolvable target before parking:
                #  - approval_request: create the backing ApprovalRequest now and
                #    write its real id in. Without this the step parks on the
                #    planner's placeholder id, which never matches a real request
                #    — so it can't surface in the Approvals UI and
                #    handle_approval_decision can never resume it.
                #  - draft_approval: resolve from_step -> the draft_id the prior
                #    (propose) step returned, so handle_draft_decision can match
                #    and resume it when that draft is applied.
                # workflow_transition awaits are resolved by the Celery scanner;
                # form_submission has no delivery path yet.
                wait_for = step.wait_for if isinstance(step.wait_for, dict) else {}
                wk = wait_for.get("kind")
                bind_error = None
                if wk == "approval_request":
                    bind_error = self._bind_approval_request(
                        plan, step, ctx, wait_for
                    )
                elif wk == "draft_approval":
                    bind_error = self._bind_draft_approval(
                        plan, step, steps, wait_for
                    )
                if bind_error:
                    # Fail rather than park the plan on an unactionable await
                    # that no human/condition could ever resolve.
                    return self._fail_plan(plan, step, steps, bind_error, executed)
                step.status = _initial_await_status(step.wait_for)
                plan.status = "awaiting"
                self.session.commit()
                return PlanRunResult(
                    plan=plan,
                    steps_executed=executed,
                    halted=True,
                    halt_reason="awaiting",
                )

            # Thread any {"$from_step": idx, "field": ...} references in this
            # step's args from prior steps' results (e.g. a condition report's
            # object_id = the collection_object draft's applied_entity_id). A
            # bad ref fails the step rather than dispatching with a placeholder.
            try:
                resolved_args = _resolve_step_refs(
                    step.args if isinstance(step.args, dict) else {},
                    {s.idx: s for s in steps},
                )
            except _StepRefError as e:
                return self._fail_plan(plan, step, steps, str(e), executed)
            if resolved_args != step.args:
                step.args = resolved_args  # persist concrete ids for the audit trail
                self.session.commit()

            _t0 = time.monotonic()
            ok, result, error = self._execute_step(step, ctx)
            latency_ms = int((time.monotonic() - _t0) * 1000)
            executed += 1

            if ok:
                step.status = "completed"
                step.result = result if isinstance(result, dict) else {"value": result}
                step.completed_at = _now()
                _checkpoint(step, result)
                # §2A: best-effort per-step effort metric. Never let telemetry
                # break execution.
                try:
                    self._write_step_metric(plan, step, result, latency_ms)
                except Exception:  # noqa: BLE001
                    logger.exception("step metric write failed for %s", step.step_id)
                self.session.commit()
                continue

            # Failure: halt plan, mark remaining pending steps skipped.
            return self._fail_plan(plan, step, steps, error, executed)

        # All steps either completed or skipped (no failures, no awaits).
        plan.status = "completed"
        plan.completed_at = _now()
        self.session.commit()
        return PlanRunResult(plan=plan, steps_executed=executed, halted=False)

    # --- Phase 2.3 signal/resume ------------------------------------------

    def signal(
        self,
        plan_id: UUID,
        step_id: UUID,
        signal_data: dict,
    ) -> PlanRunResult | None:
        """Resolve an awaiting step and resume the plan.

        signal_data shape:
            {
                "kind": "approval_request" | "form_submission" | "workflow_transition",
                "outcome": "approved" | "rejected" | "completed",
                # plus kind-specific fields:
                #   approval_request: request_id, reviewed_by, note?
                #   form_submission: form, entity_id, submitted_by
                #   workflow_transition: entity, entity_id, new_status
            }

        On 'rejected' the step fails and the plan halts with status='failed'.
        On 'approved'/'completed' the step is marked completed (signal_data
        recorded as result) and run_plan is re-invoked to walk subsequent
        steps. Same permission re-validation as initial run_plan.
        """
        plan = (
            self.session.query(AgentPlan)
            .filter(AgentPlan.plan_id == plan_id)
            .first()
        )
        if plan is None:
            return None

        if plan.status != "awaiting":
            return PlanRunResult(
                plan=plan,
                halted=True,
                halt_reason="not_awaiting",
                last_error=f"plan status is {plan.status!r}, not 'awaiting'",
            )

        step = (
            self.session.query(AgentPlanStep)
            .filter(AgentPlanStep.step_id == step_id)
            .first()
        )
        if step is None or step.plan_id != plan.plan_id:
            return PlanRunResult(
                plan=plan,
                halted=True,
                halt_reason="invalid_signal",
                last_error="step not found on this plan",
            )

        if step.status not in ("awaiting_user", "awaiting_external"):
            return PlanRunResult(
                plan=plan,
                halted=True,
                halt_reason="invalid_signal",
                last_error=f"step status is {step.status!r}, not awaiting",
            )

        # Branch decision: the chosen key selects a path; the steps tagged with
        # this decision's OTHER keys are skipped (scoped to this decision's keys,
        # so nested decisions only govern their own branches). Resolved via a
        # dedicated signal kind, not the wait_for matching below.
        if step.kind == "decision":
            option_keys = set(_decision_option_keys(step))
            chosen = signal_data.get("chosen") if isinstance(signal_data, dict) else None
            if chosen not in option_keys:
                return PlanRunResult(
                    plan=plan,
                    halted=True,
                    halt_reason="invalid_signal",
                    last_error=(
                        f"decision choice {chosen!r} not in options "
                        f"{sorted(option_keys)}"
                    ),
                )
            now = _now()
            for s in plan.steps:
                if (
                    s.status == "pending"
                    and s.branch in option_keys
                    and s.branch != chosen
                ):
                    s.status = "skipped"
            step.status = "completed"
            step.result = {"kind": "decision", "chosen": chosen}
            step.completed_at = now
            _checkpoint(step, step.result)
            plan.status = "running"
            self.session.commit()
            return self.run_plan(plan_id)

        wait = step.wait_for if isinstance(step.wait_for, dict) else {}
        wait_kind = wait.get("kind")
        signal_kind = signal_data.get("kind") if isinstance(signal_data, dict) else None
        if signal_kind != wait_kind:
            return PlanRunResult(
                plan=plan,
                halted=True,
                halt_reason="signal_mismatch",
                last_error=(
                    f"signal kind {signal_kind!r} does not match "
                    f"step wait_for.kind {wait_kind!r}"
                ),
            )

        # Approval requests must reference the same request_id.
        if wait_kind == "approval_request":
            if signal_data.get("request_id") != wait.get("request_id"):
                return PlanRunResult(
                    plan=plan,
                    halted=True,
                    halt_reason="signal_mismatch",
                    last_error=(
                        f"approval request_id {signal_data.get('request_id')!r} "
                        f"does not match step's {wait.get('request_id')!r}"
                    ),
                )

        # Draft-approval signals must reference the same draft_id.
        if wait_kind == "draft_approval":
            if str(signal_data.get("draft_id")) != str(wait.get("draft_id")):
                return PlanRunResult(
                    plan=plan,
                    halted=True,
                    halt_reason="signal_mismatch",
                    last_error=(
                        f"draft_id {signal_data.get('draft_id')!r} does not "
                        f"match step's {wait.get('draft_id')!r}"
                    ),
                )

        outcome = signal_data.get("outcome", "completed")
        now = _now()

        if outcome == "rejected":
            # Reject = step fails, plan fails, remaining steps skipped.
            step.status = "failed"
            step.error = signal_data.get("note") or f"{wait_kind} rejected"
            step.completed_at = now
            for remaining in plan.steps:
                if remaining.status in ("pending", "awaiting_user", "awaiting_external"):
                    if remaining.step_id != step.step_id:
                        remaining.status = "skipped"
            plan.status = "failed"
            plan.last_error = step.error
            plan.completed_at = now
            self.session.commit()
            return PlanRunResult(
                plan=plan,
                halted=True,
                halt_reason="failed",
                last_error=step.error,
            )

        # Success: resolve the step, resume the plan.
        step.status = "completed"
        step.result = signal_data
        step.completed_at = now
        _checkpoint(step, signal_data)
        plan.status = "running"
        self.session.commit()

        # Re-enter the executor to walk subsequent steps.
        return self.run_plan(plan_id)

    def _execute_step(
        self,
        step: AgentPlanStep,
        ctx: AgentContext,
    ) -> tuple[bool, Any, str | None]:
        """Run a single non-await step via the tool registry.

        Returns (ok, result, error). For tool_call and delegate, the
        registry's allowlist gate enforces persona-level access (so the
        executor inherits whatever the plan's persona could legitimately
        do). Errors raised by tool handlers are caught and returned as
        the failure path.
        """
        from app.services.agent_tools import get_tool_registry

        if step.kind not in ("tool_call", "delegate"):
            return False, None, f"unsupported step kind: {step.kind}"

        # v1 §7.4: a delegate step always invokes a specialist LLM round
        # (the specialist loop in orchestration_tools uses settings.agent_model).
        # Pin that model on the step. tool_call steps are left NULL — many
        # tools are deterministic DB lookups with no LLM, and stamping the
        # configured model on them would be the inferred-model guess §7.4
        # exists to prevent.
        if step.kind == "delegate":
            from app.config import get_settings

            _s = get_settings()
            _identity = _resolve_model_identity(
                _s, getattr(_s, "agent_model", None)
            )
            step.model_provider = _identity["model_provider"]
            step.model_id = _identity["model_id"]
            step.model_version = _identity["model_version"]

        tool_name = step.tool
        if not tool_name:
            return False, None, f"step {step.idx} has kind={step.kind} but no tool"

        registry = get_tool_registry()
        args = step.args if isinstance(step.args, dict) else {}

        # Persona-scoped tool_call: run under the step's persona allowlist when
        # set (so a template can call a specialist-allowlisted tool, e.g. a
        # draft tool). The registry enforces that persona's allowlist. We also
        # stamp the plan provenance so a draft proposed here is linked back to
        # this step (lets a later step pause on its approval / thread its id).
        import dataclasses

        ctx_overrides: dict = {
            "plan_id": step.plan_id,
            "plan_step_id": step.step_id,
        }
        if step.kind == "tool_call" and step.persona and step.persona != ctx.persona:
            ctx_overrides["persona"] = step.persona
        exec_ctx = dataclasses.replace(ctx, **ctx_overrides)

        try:
            exec_result = registry.execute(tool_name, args, exec_ctx)
        except Exception as e:  # noqa: BLE001
            logger.exception("Step %s execution raised", step.step_id)
            return False, None, f"tool_exception: {e}"

        result = exec_result.result_raw
        if isinstance(result, dict) and "error" in result:
            return False, result, str(result["error"])

        return True, result, None

    def _bind_approval_request(
        self,
        plan: AgentPlan,
        step: AgentPlanStep,
        ctx: AgentContext,
        wait_for: dict,
    ) -> str | None:
        """Create the ApprovalRequest backing an approval_request await and
        write its real id into step.wait_for.

        The plan step itself is the approved entity
        (entity_type='agent_plan', entity_id=step_id), so any plan can gate
        on human approval without a procedure record. The request is reviewed
        through the normal Approvals UI; review_approval ->
        handle_approval_decision then signals the step and resumes the plan.

        Returns an error string on failure (caller fails the plan), else None.

        Idempotent: if a real (valid, non-placeholder) request_id is already
        bound — e.g. a caller pre-created the request — keep it and do nothing.
        Only the planner's placeholder (or a missing/garbage id) triggers
        creation.
        """
        from app.services.approval_service import create_approval_request

        def _parse_uuid(v):
            if isinstance(v, UUID):
                return v
            try:
                return UUID(str(v)) if v else None
            except (ValueError, TypeError):
                return None

        _PLACEHOLDER = "00000000-0000-0000-0000-000000000000"
        existing_uuid = _parse_uuid(wait_for.get("request_id"))
        if existing_uuid is not None and str(existing_uuid) != _PLACEHOLDER:
            return None

        requested_by = ctx.user_id or _parse_uuid(
            (plan.context_snapshot or {}).get("user_id")
        )
        if requested_by is None:
            return "approval await has no requesting user to attribute"

        rule = _ensure_agent_plan_approval_rule(
            self.session, plan.organization_id
        )
        request = create_approval_request(
            rule=rule,
            entity_type="agent_plan",
            entity_id=step.step_id,
            requested_by=requested_by,
            requested_action={
                "kind": "agent_plan_step",
                "plan_id": str(plan.plan_id),
                "step_idx": step.idx,
                "description": step.description,
                "goal": plan.goal,
            },
            session=self.session,
        )
        # Reassign a fresh dict so SQLAlchemy flags the JSONB column dirty.
        step.wait_for = {**wait_for, "request_id": str(request.request_id)}
        return None

    def _bind_draft_approval(
        self,
        plan: AgentPlan,
        step: AgentPlanStep,
        steps: list,
        wait_for: dict,
    ) -> str | None:
        """Resolve a draft_approval await's `from_step` into the concrete
        draft_id the referenced (propose) step returned, and write it into
        step.wait_for so handle_draft_decision can match and resume the step
        when that draft is applied.

        Returns an error string if the draft_id can't be resolved (caller then
        fails the plan rather than parking on an unresolvable await). Idempotent:
        a draft_id already present (re-entry / pre-supplied) is kept as-is.
        """
        if wait_for.get("draft_id"):
            return None
        ref = wait_for.get("from_step")
        src = next((s for s in steps if s.idx == ref), None)
        if src is None:
            return f"draft_approval await references unknown step {ref!r}"
        if src.status != "completed":
            return f"draft_approval await: step {ref} did not complete"
        res = src.result if isinstance(src.result, dict) else {}
        draft_id = res.get("draft_id")
        if not draft_id:
            return f"draft_approval await: step {ref} produced no draft_id"
        # Fresh dict so SQLAlchemy flags the JSONB column dirty.
        step.wait_for = {**wait_for, "draft_id": str(draft_id)}
        return None

    def _fail_plan(
        self,
        plan: AgentPlan,
        step: AgentPlanStep,
        steps: list,
        error: str,
        executed: int,
    ) -> "PlanRunResult":
        """Mark `step` failed, skip remaining pending steps, fail the plan, and
        return the halt result. The single place plan failure is materialised so
        the await-bind, arg-resolution, and tool-execution paths stay in sync."""
        step.status = "failed"
        step.error = error
        step.completed_at = _now()
        for remaining in steps:
            if remaining.status == "pending":
                remaining.status = "skipped"
        plan.status = "failed"
        plan.last_error = error
        plan.completed_at = _now()
        self.session.commit()
        return PlanRunResult(
            plan=plan,
            steps_executed=executed,
            halted=True,
            halt_reason="failed",
            last_error=error,
        )


# --- model identity (v1 §7.4 model version pinning) ---


def _resolve_model_identity(settings, model: str) -> dict[str, str | None]:
    """Capture which model served a call, for the plan/step audit trail.

    `model_version` is NULL: no Madrona provider (ollama|runpod|claude)
    reports a concrete version distinct from the requested model id, so
    inferring one would be a guess — exactly what §7.4 forbids. The
    column exists so a provider that *does* report a version later can
    populate it without a schema change.

    `model_id` is the ACTUALLY-SERVED model, which can differ from the
    requested `model`: the Claude client is constructed with
    `agent_claude_model` and ignores `agent_model`/`agent_planner_model`, so
    under provider=claude every call is served by `agent_claude_model`. Recording
    the requested `model` there (e.g. a stale `AGENT_MODEL=madrona-14b`) would
    mis-key cost estimation — it must reflect what ran (claude-haiku-4-5)."""
    provider = getattr(settings, "agent_provider", None)
    if provider == "claude":
        served = getattr(settings, "agent_claude_model", None) or model
    else:
        # ollama/runpod serve the requested model name as-is.
        served = model
    return {
        "model_provider": provider,
        "model_id": served,
        "model_version": None,
    }


# --- planner invocation ---


def _invoke_planner(
    session: Session,
    ctx: AgentContext,
    goal: str,
) -> tuple[str, str | None, dict[str, str | None]]:
    """Call the planner LLM. Returns (raw_content, error_or_None, model_identity).

    Catches all LLM-level errors and surfaces them as the second tuple
    element so the caller never has to handle exceptions. The third
    element is always populated (even on error) so the plan records what
    model was *attempted* — an audit must show the configured model even
    when the call failed."""
    from app.config import get_settings
    from app.services.prompt_service import get_system_prompt

    settings = get_settings()
    model = (
        getattr(settings, "agent_planner_model", None)
        or getattr(settings, "agent_model", None)
        or "claude-haiku-4-5"
    )
    identity = _resolve_model_identity(settings, model)

    try:
        from app.services.model_profiles import resolve_llm
        llm = resolve_llm("planner", ctx.organization_id, session, settings).client
    except Exception as e:  # noqa: BLE001
        return "", f"llm_init: {e}", identity

    system_prompt = get_system_prompt(session, ctx.organization_id, "planner")

    user_payload = goal.strip()
    if ctx.page_context:
        try:
            user_payload += (
                "\n\nPAGE CONTEXT (the user is currently viewing):\n"
                + json.dumps(ctx.page_context, default=str)
            )
        except (TypeError, ValueError):
            pass

    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_payload},
    ]

    try:
        response = llm.chat(
            model,
            messages,
            None,  # no tools — pure JSON output
            getattr(settings, "agent_num_ctx", 8192),
        )
    except Exception as e:  # noqa: BLE001
        return "", f"llm_error: {e}", identity

    return (response.content or "").strip(), None, identity


# --- JSON parsing ---


_JSON_OBJECT_PATTERN = re.compile(r"\{.*\}", re.DOTALL)


def _parse_planner_json(raw: str) -> dict[str, Any] | None:
    """Tolerant JSON extraction. Same shape as router's parser."""
    if not raw:
        return None
    try:
        result = json.loads(raw)
        if isinstance(result, dict):
            return result
    except json.JSONDecodeError:
        pass
    match = _JSON_OBJECT_PATTERN.search(raw)
    if match:
        try:
            result = json.loads(match.group(0))
            if isinstance(result, dict):
                return result
        except json.JSONDecodeError:
            return None
    return None


# --- arg threading (draft-chaining) ---


class _StepRefError(Exception):
    """An args `$from_step` reference could not be resolved at execution time."""


def _resolve_step_refs(value: Any, steps_by_idx: dict) -> Any:
    """Recursively replace `{"$from_step": <idx>, "field": <name>}` placeholders
    in a step's args with the referenced step's result[field].

    Used for draft-chaining: a later step's arg (e.g. a condition report's
    object_id) references the applied_entity_id a prior draft_approval await
    carried in on resume. `field` defaults to "applied_entity_id". Raises
    `_StepRefError` on any unresolvable ref (unknown/incomplete step, or a
    missing/None field) so the caller fails the step instead of dispatching a
    tool with a literal placeholder dict.
    """
    if isinstance(value, dict):
        if "$from_step" in value:
            idx = value["$from_step"]
            field = value.get("field", "applied_entity_id")
            src = steps_by_idx.get(idx)
            if src is None:
                raise _StepRefError(f"$from_step {idx!r}: no such step")
            if src.status != "completed":
                raise _StepRefError(
                    f"$from_step {idx}: step is {src.status!r}, not completed"
                )
            res = src.result if isinstance(src.result, dict) else {}
            if res.get(field) is None:
                raise _StepRefError(
                    f"$from_step {idx}: result has no {field!r}"
                )
            return res[field]
        return {k: _resolve_step_refs(v, steps_by_idx) for k, v in value.items()}
    if isinstance(value, list):
        return [_resolve_step_refs(v, steps_by_idx) for v in value]
    return value


# --- branching ---


def _decision_option_keys(step) -> list[str]:
    """The branch keys a `decision` step can select, from its args.options
    (each option is {key, label}). Accepts an AgentPlanStep or a raw step dict."""
    args = getattr(step, "args", None)
    if args is None and isinstance(step, dict):
        args = step.get("args")
    args = args if isinstance(args, dict) else {}
    opts = args.get("options")
    keys: list[str] = []
    if isinstance(opts, list):
        for o in opts:
            if isinstance(o, dict) and o.get("key"):
                keys.append(str(o["key"]))
    return keys


# --- step validation ---


def _validate_steps(
    raw_steps: list,
) -> tuple[list[dict], str | None]:
    """Return (validated_steps, error_or_None). Strict: any malformed step
    rejects the whole plan."""
    if not isinstance(raw_steps, list):
        return [], "steps must be a list"
    if len(raw_steps) > MAX_PLAN_STEPS:
        return [], f"plan exceeds {MAX_PLAN_STEPS} steps (got {len(raw_steps)})"

    validated: list[dict] = []
    for i, raw in enumerate(raw_steps):
        if not isinstance(raw, dict):
            return [], f"step {i} is not a mapping"

        description = str(raw.get("description") or "").strip()
        if not description:
            return [], f"step {i} missing description"

        kind = raw.get("kind")
        if kind not in VALID_STEP_KINDS:
            return [], (
                f"step {i} has invalid kind {kind!r}; "
                f"must be one of {sorted(VALID_STEP_KINDS)}"
            )

        step: dict[str, Any] = {
            "description": description,
            "kind": kind,
        }

        if kind == "tool_call":
            tool = raw.get("tool")
            if not isinstance(tool, str) or not tool:
                return [], f"step {i} (tool_call) missing tool name"
            step["tool"] = tool
            step["args"] = raw.get("args") if isinstance(raw.get("args"), dict) else {}
            # Optional persona scoping: run this tool under a specialist's
            # allowlist so a (deterministic) step can call a tool the plan's
            # default persona can't — e.g. a propose_<entity>_draft tool, which
            # is allowlisted to a specialist. The registry still enforces that
            # persona's allowlist, so this grants no capability the persona
            # lacks (and staff can already reach specialists via delegation).
            persona = raw.get("persona")
            if persona is not None:
                if persona not in SPECIALIST_PERSONAS:
                    return [], (
                        f"step {i} (tool_call) has invalid persona {persona!r}; "
                        f"must be one of {sorted(SPECIALIST_PERSONAS)}"
                    )
                step["persona"] = persona

        elif kind == "delegate":
            args = raw.get("args") or {}
            persona = raw.get("persona") or args.get("specialist")
            if persona not in SPECIALIST_PERSONAS:
                return [], (
                    f"step {i} (delegate) has invalid persona {persona!r}; "
                    f"must be one of {sorted(SPECIALIST_PERSONAS)}"
                )
            step["tool"] = "delegate_to_specialist"
            step["persona"] = persona
            step["args"] = {
                "specialist": persona,
                "question": str(args.get("question") or "").strip(),
            }
            if not step["args"]["question"]:
                return [], f"step {i} (delegate) missing question"

        elif kind == "await":
            wait_for = raw.get("wait_for")
            if not isinstance(wait_for, dict):
                return [], f"step {i} (await) missing wait_for object"
            wait_kind = wait_for.get("kind")
            if wait_kind not in VALID_WAIT_KINDS:
                return [], (
                    f"step {i} (await) has invalid wait_for.kind {wait_kind!r}; "
                    f"must be one of {sorted(VALID_WAIT_KINDS)}"
                )
            if wait_kind == "job_completion":
                missing = [
                    f for f in ("job_type", "entity", "entity_id")
                    if not wait_for.get(f)
                ]
                if missing:
                    return [], (
                        f"step {i} (await job_completion) missing "
                        f"{', '.join(missing)}"
                    )
            if wait_kind == "draft_approval":
                # Must point back at an EARLIER step (which proposed the draft).
                # A concrete draft_id can also be pre-supplied, but the normal
                # author-time form is a from_step ref the executor resolves.
                ref = wait_for.get("from_step")
                if wait_for.get("draft_id") is None:
                    if not isinstance(ref, int) or isinstance(ref, bool):
                        return [], (
                            f"step {i} (await draft_approval) needs an integer "
                            f"from_step (the prior step that proposed the draft)"
                        )
                    if not 0 <= ref < i:
                        return [], (
                            f"step {i} (await draft_approval) from_step={ref} "
                            f"must reference an earlier step (0..{i - 1})"
                        )
            step["wait_for"] = wait_for

        elif kind == "decision":
            args = raw.get("args") if isinstance(raw.get("args"), dict) else {}
            opts = args.get("options")
            if not isinstance(opts, list) or len(opts) < 2:
                return [], (
                    f"step {i} (decision) needs args.options with >=2 entries"
                )
            keys: list[str] = []
            norm_opts: list[dict] = []
            for o in opts:
                if not isinstance(o, dict) or not o.get("key"):
                    return [], f"step {i} (decision) option is missing a key"
                k = str(o["key"])
                keys.append(k)
                norm_opts.append({"key": k, "label": str(o.get("label") or k)})
            if len(set(keys)) != len(keys):
                return [], f"step {i} (decision) option keys must be unique"
            step["args"] = {"options": norm_opts}

        # Branch tag (which path this step belongs to; None = unconditional).
        branch = raw.get("branch")
        if branch is not None:
            step["branch"] = str(branch)
        # Phase-group label (template-authored; UI grouping only).
        phase = raw.get("phase")
        if phase is not None:
            step["phase"] = str(phase)

        validated.append(step)

    err = _validate_branching(validated)
    if err:
        return [], err
    return validated, None


def _validate_branching(validated: list[dict]) -> str | None:
    """Coherence rules for `decision`/`branch` plans. Returns an error or None.

    - decision branch keys are globally unique across the plan;
    - every `branch` tag is declared by a decision step that PRECEDES it;
    - `$from_step` refs (args threading + draft_approval from_step) point
      backward AND only at an unconditional step or one in the SAME branch
      (a sibling branch may be skipped, so threading across branches is unsafe).
    """
    key_to_decision_idx: dict[str, int] = {}
    all_keys: list[str] = []
    for idx, s in enumerate(validated):
        if s["kind"] == "decision":
            ks = [o["key"] for o in s["args"]["options"]]
            all_keys.extend(ks)
            for k in ks:
                key_to_decision_idx[k] = idx
    if len(set(all_keys)) != len(all_keys):
        return "decision branch keys must be globally unique across the plan"

    def _from_step_refs(value) -> list[int]:
        out: list[int] = []
        if isinstance(value, dict):
            if "$from_step" in value:
                out.append(value["$from_step"])
            else:
                for v in value.values():
                    out += _from_step_refs(v)
        elif isinstance(value, list):
            for v in value:
                out += _from_step_refs(v)
        return out

    for idx, s in enumerate(validated):
        b = s.get("branch")
        if b is not None:
            if b not in key_to_decision_idx:
                return f"step {idx} branch {b!r} is not declared by any decision step"
            if key_to_decision_idx[b] >= idx:
                return f"step {idx} branch {b!r} must come after its decision step"
        # Collect step refs: args $from_step + a draft_approval await's from_step.
        refs = list(_from_step_refs(s.get("args") or {}))
        wf = s.get("wait_for")
        if isinstance(wf, dict) and wf.get("kind") == "draft_approval" \
                and isinstance(wf.get("from_step"), int) and not isinstance(wf.get("from_step"), bool):
            refs.append(wf["from_step"])
        for ref in refs:
            if not isinstance(ref, int) or isinstance(ref, bool) or not 0 <= ref < idx:
                return f"step {idx} step-ref {ref!r} must reference an earlier step"
            src_branch = validated[ref].get("branch")
            if src_branch is not None and src_branch != b:
                return (
                    f"step {idx} references step {ref} across branches "
                    f"({src_branch!r} -> {b!r}); thread only from an unconditional "
                    f"or same-branch step"
                )
    return None


# --- context snapshot ---


def _rehydrate_context(plan: AgentPlan, session: Session) -> AgentContext:
    """Build a live AgentContext from a plan's stored snapshot.

    The DB session is the current request's session, NOT a frozen one —
    tools must observe current data. The persona, org, and user identity
    come from the snapshot. Phase 2.3 will add explicit permission
    re-validation here (e.g., confirm the user still has the persona's
    role before executing more steps).
    """
    from app.models import Organization

    snap = plan.context_snapshot or {}

    org_id_raw = snap.get("organization_id") or plan.organization_id
    user_id_raw = snap.get("user_id")
    persona = snap.get("persona") or plan.persona_used or "staff"

    def _to_uuid(v):
        if v is None:
            return None
        if isinstance(v, UUID):
            return v
        try:
            return UUID(str(v))
        except (ValueError, TypeError):
            return None

    org_slug = snap.get("org_slug")
    if not org_slug and org_id_raw:
        org = (
            session.query(Organization.slug)
            .filter(Organization.organization_id == org_id_raw)
            .first()
        )
        if org:
            org_slug = org.slug

    return AgentContext(
        organization_id=_to_uuid(org_id_raw),
        user_id=_to_uuid(user_id_raw),
        persona=persona,
        db_session=session,
        org_slug=org_slug,
        conversation_id=plan.conversation_id,
        context_entity_type=snap.get("context_entity_type"),
        context_entity_id=_to_uuid(snap.get("context_entity_id")),
        page_context=snap.get("page_context"),
    )


def _checkpoint(step: AgentPlanStep, result: Any) -> None:
    """Append a checkpoint entry to step.step_state.

    Each successful tool invocation records {tool, args, result_summary,
    completed_at}. If a step ever loops over multiple tool calls (Phase
    2.3+), each one gets its own entry. The 'last_checkpoint_at' field
    is the recovery anchor: a process restart can see when the step last
    made progress.
    """
    state = dict(step.step_state) if isinstance(step.step_state, dict) else {}
    completed = list(state.get("tool_calls_completed") or [])
    summary: Any
    if isinstance(result, dict):
        # Avoid blowing up step_state with huge tool outputs; keep keys
        # plus a short repr of values. Full result lives on step.result.
        summary = {k: _short(v) for k, v in result.items()}
    else:
        summary = _short(result)
    completed.append({
        "tool": step.tool,
        "args": step.args,
        "result_summary": summary,
        "completed_at": _now().isoformat(),
    })
    state["tool_calls_completed"] = completed
    state["last_checkpoint_at"] = _now().isoformat()
    step.step_state = state


def _short(value: Any, limit: int = 200) -> Any:
    """Truncate large values for inclusion in step_state summaries.

    Step.result preserves the full value; step_state is a navigable
    audit trail and stays human-readable in pgAdmin. Lists are
    summarized by length, dicts by key list, strings by truncation.
    """
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value if len(value) <= limit else value[:limit] + "…"
    if isinstance(value, list):
        return f"<list len={len(value)}>"
    if isinstance(value, dict):
        return f"<dict keys={sorted(value.keys())[:10]}>"
    return repr(value)[:limit]


def _initial_await_status(wait_for: dict | None) -> str:
    """Pick the right step status for an await step based on wait_for.kind.

    'approval_request' and 'form_submission' need user action →
    'awaiting_user'. 'workflow_transition' needs a non-user condition →
    'awaiting_external'. Unknown kinds default to 'awaiting_external'
    so the executor stops cleanly.
    """
    if not isinstance(wait_for, dict):
        return "awaiting_external"
    kind = wait_for.get("kind")
    if kind in ("approval_request", "form_submission", "draft_approval"):
        return "awaiting_user"
    return "awaiting_external"


def _revalidate_permissions(plan: AgentPlan, session: Session) -> str | None:
    """Verify the plan's stored identity is still valid before resuming.

    Returns None on success, or a string describing what was revoked.

    Phase 2.3 v1 checks:
    - Organization still exists.
    - User still exists (when present in the snapshot).
    - User is still a member of the organization (when both are present).
    - Persona is still a known persona.

    Future: confirm the user still holds the persona's required role
    (today the persona-to-role mapping is implicit; if/when there's an
    explicit role grant table, this gate should consult it).
    """
    from app.models import Organization, OrganizationMembership, User
    from app.services.agent_persona import get_persona_policy

    snap = plan.context_snapshot or {}
    org_id = snap.get("organization_id") or plan.organization_id
    user_id = snap.get("user_id")
    persona = snap.get("persona") or plan.persona_used

    if not org_id:
        return "context_snapshot has no organization_id"

    if isinstance(org_id, str):
        try:
            from uuid import UUID as _U
            org_id = _U(org_id)
        except (ValueError, TypeError):
            return f"organization_id is not a valid UUID: {org_id!r}"

    org_exists = (
        session.query(Organization.organization_id)
        .filter(Organization.organization_id == org_id)
        .first()
    )
    if not org_exists:
        return f"organization {org_id} no longer exists"

    if user_id:
        if isinstance(user_id, str):
            try:
                from uuid import UUID as _U
                user_id = _U(user_id)
            except (ValueError, TypeError):
                return f"user_id is not a valid UUID: {user_id!r}"

        user_row = (
            session.query(User.user_id, User.status)
            .filter(User.user_id == user_id)
            .first()
        )
        if not user_row:
            return f"user {user_id} no longer exists"
        if user_row.status and user_row.status not in ("active",):
            return f"user {user_id} status is {user_row.status!r}, cannot resume"

        # Membership in the plan's org.
        membership = (
            session.query(OrganizationMembership.membership_id)
            .filter(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.organization_id == org_id,
            )
            .first()
        )
        if not membership:
            return (
                f"user {user_id} no longer has membership in organization {org_id}"
            )

    if persona:
        try:
            get_persona_policy(persona)
        except ValueError:
            return f"persona {persona!r} is no longer registered"

    return None


def _ensure_agent_plan_approval_rule(session: Session, org_id):
    """Get-or-create the org's ApprovalRule for agent-plan approvals.

    Plan approvals reuse the generic approvals system, so each org needs one
    rule mapping entity_type='agent_plan' to the guide.approve_plan
    permission. Created lazily on first use — no per-org seed required.
    """
    from app.models.core_org import ApprovalRule

    rule = (
        session.query(ApprovalRule)
        .filter(
            ApprovalRule.organization_id == org_id,
            ApprovalRule.entity_type == "agent_plan",
            ApprovalRule.trigger_action == "execute",
            ApprovalRule.is_active.is_(True),
        )
        .first()
    )
    if rule is None:
        rule = ApprovalRule(
            organization_id=org_id,
            entity_type="agent_plan",
            trigger_action="execute",
            approver_permission=AGENT_PLAN_APPROVER_PERMISSION,
            description=(
                "Approve a Guide agent plan step before the executor proceeds"
            ),
        )
        session.add(rule)
        session.flush()
    return rule


def handle_approval_decision(
    request_id: UUID,
    session: Session,
) -> int:
    """Hook called by approval_service.review_approval after an approval
    is decided. Finds awaiting plan steps gated on this request_id and
    signals each one. Returns the number of plans signaled.

    Approved → step completed, plan resumes.
    Rejected → step failed, plan fails.

    Idempotent: a second call with the same request_id finds no awaiting
    steps and returns 0.
    """
    from app.models.core_org import ApprovalRequest

    request = (
        session.query(ApprovalRequest)
        .filter(ApprovalRequest.request_id == request_id)
        .first()
    )
    if request is None:
        return 0
    if request.status not in ("approved", "rejected"):
        return 0  # still pending or cancelled — no signal

    # Find awaiting steps that match. wait_for is JSONB; SQLAlchemy can
    # filter on JSON keys via .op('->>') or the ->> shortcut.
    rows = (
        session.query(AgentPlanStep)
        .filter(
            AgentPlanStep.status.in_(("awaiting_user", "awaiting_external")),
            AgentPlanStep.wait_for.op("->>")("kind") == "approval_request",
            AgentPlanStep.wait_for.op("->>")("request_id") == str(request_id),
        )
        .all()
    )

    if not rows:
        return 0

    signaled = 0
    for step in rows:
        signal_data = {
            "kind": "approval_request",
            "request_id": str(request_id),
            "outcome": request.status,  # 'approved' or 'rejected'
            "reviewed_by": str(request.reviewed_by) if request.reviewed_by else None,
            "note": request.review_note,
        }
        service = PlanService(session)
        service.signal(step.plan_id, step.step_id, signal_data)
        signaled += 1

    return signaled


def recover_stalled_plans(session: Session) -> int:
    """Reset 'running' steps to 'pending' so a process restart can resume.

    Designed to be called on application startup or via a Celery beat
    task. A step in 'running' status with a started_at and no
    completed_at means a process died mid-step. Resetting status to
    'pending' makes the next run_plan call pick it up from the start of
    the step. Steps are idempotent in v1 (no partial-tool-call state),
    so re-running a step is safe.

    Returns the number of steps reset.
    """
    rows = (
        session.query(AgentPlanStep)
        .filter(AgentPlanStep.status == "running")
        .all()
    )
    count = 0
    for step in rows:
        step.status = "pending"
        step.started_at = None
        count += 1
    if count:
        session.commit()
        logger.info("recover_stalled_plans: reset %d running step(s) to pending", count)
    return count


def _serialize_context(ctx: AgentContext) -> dict[str, Any]:
    """Capture the immutable AgentContext fields. The DB session is NOT
    serialized — it's reconstructed on resume. Permissions live in
    organization_id + user_id + persona, all of which must be re-validated
    when the plan resumes (see Phase 2.3)."""
    snapshot: dict[str, Any] = {
        "organization_id": str(ctx.organization_id) if ctx.organization_id else None,
        "user_id": str(ctx.user_id) if ctx.user_id else None,
        "persona": ctx.persona,
        "org_slug": ctx.org_slug,
    }
    if ctx.context_entity_type:
        snapshot["context_entity_type"] = ctx.context_entity_type
    if ctx.context_entity_id:
        snapshot["context_entity_id"] = str(ctx.context_entity_id)
    if ctx.page_context:
        snapshot["page_context"] = ctx.page_context
    return snapshot
