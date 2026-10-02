"""Periodic Celery tasks for the multi-agent orchestration plan executor.

Two tasks are exposed:

- scan_awaiting_workflow_transitions: scans agent_plan_steps in
  status='awaiting_external' with wait_for.kind='workflow_transition' and,
  for each, checks whether the referenced entity has reached the target
  status. If yes, signals the plan via PlanService.signal which resumes
  it (and run_plan walks subsequent steps).

- recover_stalled_plans_task: thin wrapper around
  agent_plan_service.recover_stalled_plans for the case where the
  process restarts while a step was in 'running' state.

The first runs frequently (every minute by default). The second runs at
process startup and as a safety net every few minutes.

Entity dispatch is intentionally a small explicit table — adding a new
entity type to the workflow-transition path is one row here, not a
schema or executor change.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from app.celery_app import celery_app
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)

# A job_completion await older than this is treated as a zombie and failed, so a
# plan never parks forever on a job that died without flipping its status.
MAX_JOB_WAIT = timedelta(hours=2)


# --- entity dispatch ---
#
# Maps wait_for.entity values to (model, pk_attr, status_attr). Looked up
# inside the scanner so adding a new procedure workflow only requires
# adding a row here.

def _entity_dispatch():
    """Build the dispatch table lazily so model imports don't run at
    Celery worker boot time (which can happen before all model modules
    have registered)."""
    from app.models import (
        LoanIn, LoanOut, Deaccession, ObjectEntry, ObjectExit,
    )
    return {
        "loan_in": (LoanIn, "loan_in_id", "status"),
        "loan_out": (LoanOut, "loan_out_id", "status"),
        "deaccession": (Deaccession, "deaccession_id", "status"),
        "object_entry": (ObjectEntry, "entry_id", "status"),
        "object_exit": (ObjectExit, "exit_id", "status"),
    }


@celery_app.task(
    base=SystemTask,
    name="app.tasks.agent_plans.scan_awaiting_workflow_transitions",
)
def scan_awaiting_workflow_transitions() -> dict[str, Any]:
    """Resume plans whose await step's workflow_transition condition is met.

    Each invocation queries every step in status='awaiting_external' that
    waits on a workflow_transition. For each, looks up the referenced
    entity and compares its current status to wait_for.target_status. On
    match, calls PlanService.signal which advances the step to completed
    and re-enters run_plan.

    Idempotent: signaling a step that's already past awaiting is a no-op
    via the signal()'s status guard.
    """
    from app.models import AgentPlanStep
    from app.services.agent_plan_service import PlanService
    from app.tasks.rls_helpers import admin_db_session

    scanned = 0
    advanced = 0
    skipped: list[dict] = []

    with admin_db_session() as session:
        rows = (
            session.query(AgentPlanStep)
            .filter(
                AgentPlanStep.status == "awaiting_external",
                AgentPlanStep.wait_for.op("->>")("kind") == "workflow_transition",
            )
            .all()
        )
        scanned = len(rows)

        if not rows:
            return {"scanned": 0, "advanced": 0, "skipped": []}

        dispatch = _entity_dispatch()
        service = PlanService(session)

        for step in rows:
            wait = step.wait_for or {}
            entity_type = wait.get("entity")
            entity_id_raw = wait.get("entity_id")
            target_status = wait.get("target_status")

            if not entity_type or not entity_id_raw or not target_status:
                skipped.append({
                    "step_id": str(step.step_id),
                    "reason": "wait_for missing entity/entity_id/target_status",
                })
                continue

            mapping = dispatch.get(entity_type)
            if mapping is None:
                skipped.append({
                    "step_id": str(step.step_id),
                    "reason": f"no dispatch entry for entity {entity_type!r}",
                })
                continue

            model_cls, pk_attr, status_attr = mapping

            try:
                entity_id = UUID(str(entity_id_raw))
            except (ValueError, TypeError):
                skipped.append({
                    "step_id": str(step.step_id),
                    "reason": f"entity_id not a UUID: {entity_id_raw!r}",
                })
                continue

            row = (
                session.query(getattr(model_cls, status_attr))
                .filter(getattr(model_cls, pk_attr) == entity_id)
                .first()
            )
            if row is None:
                skipped.append({
                    "step_id": str(step.step_id),
                    "reason": f"{entity_type} {entity_id} not found",
                })
                continue

            current_status = row[0] if isinstance(row, tuple) else row
            if current_status != target_status:
                # Condition not yet met — leave it awaiting
                continue

            signal_data = {
                "kind": "workflow_transition",
                "entity": entity_type,
                "entity_id": str(entity_id),
                "new_status": current_status,
                "outcome": "completed",
            }
            try:
                service.signal(step.plan_id, step.step_id, signal_data)
                advanced += 1
            except Exception:  # noqa: BLE001
                logger.exception(
                    "scan_awaiting_workflow_transitions: signal raised "
                    "for step %s", step.step_id,
                )
                skipped.append({
                    "step_id": str(step.step_id),
                    "reason": "signal raised; see logs",
                })

    logger.info(
        "scan_awaiting_workflow_transitions scanned=%d advanced=%d skipped=%d",
        scanned, advanced, len(skipped),
    )
    return {
        "scanned": scanned,
        "advanced": advanced,
        "skipped": skipped,
    }


# --- job_completion dispatch (§1D) ---
#
# Maps wait_for.job_type → (model, pk_attr, status_attr, done_value,
# failed_value). Completion is resolved by the entity's OWN status column (the
# durable source of truth), NOT the Celery result backend — so a job triggered
# anywhere flips the await. Adding a new async job is one row here.

def _job_dispatch():
    from app.models import Media

    return {
        "transcription": (Media, "media_id", "transcription_status", "completed", "failed"),
        "ai_processing": (Media, "media_id", "ai_processing_status", "completed", "failed"),
        "media_processing": (Media, "media_id", "processing_status", "completed", "failed"),
    }


@celery_app.task(
    base=SystemTask,
    name="app.tasks.agent_plans.scan_awaiting_jobs",
)
def scan_awaiting_jobs() -> dict[str, Any]:
    """Resume (or fail) plans whose await step waits on an async job (§1D).

    For each step in status='awaiting_external' waiting on a job_completion,
    look up the referenced entity's status column:
      - reached the done value   → signal completed → plan resumes
      - reached the failed value → signal rejected  → plan fails cleanly
      - older than MAX_JOB_WAIT  → signal rejected (zombie guard)
      - otherwise                → leave awaiting

    Mirrors scan_awaiting_workflow_transitions; idempotent via signal()'s
    status guard."""
    from app.models import AgentPlanStep
    from app.services.agent_plan_service import PlanService
    from app.tasks.rls_helpers import admin_db_session

    scanned = 0
    advanced = 0
    failed = 0
    skipped: list[dict] = []

    with admin_db_session() as session:
        rows = (
            session.query(AgentPlanStep)
            .filter(
                AgentPlanStep.status == "awaiting_external",
                AgentPlanStep.wait_for.op("->>")("kind") == "job_completion",
            )
            .all()
        )
        scanned = len(rows)
        if not rows:
            return {"scanned": 0, "advanced": 0, "failed": 0, "skipped": []}

        dispatch = _job_dispatch()
        service = PlanService(session)
        now = datetime.now(timezone.utc)

        for step in rows:
            wait = step.wait_for or {}
            job_type = wait.get("job_type")
            entity = wait.get("entity")
            entity_id_raw = wait.get("entity_id")

            mapping = dispatch.get(job_type)
            if mapping is None:
                skipped.append({
                    "step_id": str(step.step_id),
                    "reason": f"no dispatch entry for job_type {job_type!r}",
                })
                continue

            model_cls, pk_attr, status_attr, done_value, failed_value = mapping
            try:
                entity_id = UUID(str(entity_id_raw))
            except (ValueError, TypeError):
                skipped.append({
                    "step_id": str(step.step_id),
                    "reason": f"entity_id not a UUID: {entity_id_raw!r}",
                })
                continue

            row = (
                session.query(getattr(model_cls, status_attr))
                .filter(getattr(model_cls, pk_attr) == entity_id)
                .first()
            )
            current = (row[0] if isinstance(row, tuple) else row) if row else None

            outcome = None
            note = None
            if current == done_value:
                outcome = "completed"
            elif current == failed_value:
                outcome, note = "rejected", f"{job_type} job failed"
            elif step.started_at and (now - _aware(step.started_at)) > MAX_JOB_WAIT:
                outcome, note = "rejected", f"{job_type} job timed out (zombie await)"
            else:
                continue  # not done yet

            signal_data = {
                "kind": "job_completion",
                "job_type": job_type,
                "entity": entity,
                "entity_id": str(entity_id),
                "outcome": outcome,
            }
            if note:
                signal_data["note"] = note
            try:
                service.signal(step.plan_id, step.step_id, signal_data)
                if outcome == "completed":
                    advanced += 1
                else:
                    failed += 1
            except Exception:  # noqa: BLE001
                logger.exception(
                    "scan_awaiting_jobs: signal raised for step %s", step.step_id
                )
                skipped.append({
                    "step_id": str(step.step_id),
                    "reason": "signal raised; see logs",
                })

    logger.info(
        "scan_awaiting_jobs scanned=%d advanced=%d failed=%d skipped=%d",
        scanned, advanced, failed, len(skipped),
    )
    return {"scanned": scanned, "advanced": advanced, "failed": failed, "skipped": skipped}


def _aware(dt: datetime) -> datetime:
    """Treat a naive timestamp (DB columns are timestamptz, but callers vary) as
    UTC so the max-age comparison is valid."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


@celery_app.task(
    base=SystemTask,
    name="app.tasks.agent_plans.recover_stalled_plans_task",
)
def recover_stalled_plans_task() -> dict[str, Any]:
    """Safety net: reset 'running' plan steps to 'pending' so a process
    restart resumes from the last completed step.

    This is also called on application startup (see app/main.py if the
    hook lands there). Running it on a beat schedule guards against the
    case where a worker dies without invoking startup hooks.
    """
    from app.services.agent_plan_service import recover_stalled_plans
    from app.tasks.rls_helpers import admin_db_session

    with admin_db_session() as session:
        n = recover_stalled_plans(session)
    return {"reset_steps": n}
