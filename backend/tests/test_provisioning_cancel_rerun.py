"""Tests for the cancel + rerun provisioning endpoints.

Avoids the FastAPI TestClient (it hangs on macOS via the auth_setup
fixture chain in this repo) by exercising the endpoint *handler
functions* directly. Each handler is a regular sync function taking
its deps as arguments — equivalent coverage of the route's logic
without the integration-client overhead.

Covers:
  cancel_provisioning_job
    * pending → failed + error_step='cancelled' + retry_count=0
    * running → failed + error_step='cancelled' + retry_count=0
    * failed  → retry_count=0, status preserved, error_step preserved
    * completed → 409
    * 404 when job doesn't exist

  rerun_provisioning_step
    * unknown step_key → 404
    * running job → 409
    * 404 when job doesn't exist
    * resets step_key + all later steps to pending; status → failed
    * dispatches to Celery for sandbox jobs (with_demo_data=true)
"""
from __future__ import annotations

import json
import uuid
from unittest.mock import MagicMock
from uuid import uuid4

import pytest

from app.fastapi_app.routers.platform_admin import (
    cancel_provisioning_job,
    rerun_provisioning_step,
)
from app.fastapi_app.dependencies.auth import AuthContext


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_job(
    db_session,
    *,
    status: str = "failed",
    request_payload: dict | None = None,
    steps: dict | None = None,
    error_step: str | None = None,
    error_message: str | None = None,
    retry_count: int = 0,
    max_retries: int = 10,
):
    """Insert a minimally-valid OrgProvisioningJob row for the test."""
    from app.models import OrgProvisioningJob

    job = OrgProvisioningJob(
        idempotency_key=f"idem-{uuid4().hex}",
        status=status,
        request_payload=request_payload or {},
        steps=steps or {},
        organization_slug=f"test-{uuid4().hex[:8]}",
        error_step=error_step,
        error_message=error_message,
        retry_count=retry_count,
        max_retries=max_retries,
    )
    db_session.add(job)
    db_session.commit()
    return job


def _fake_auth(user_id: uuid.UUID | None = None) -> AuthContext:
    """Build a minimal AuthContext sufficient for endpoint handlers."""
    return AuthContext(
        user_id=user_id or uuid.uuid4(),
        email="platform-admin@madrona.test",
        active_organization_id=None,
        mfa_verified=True,
        mfa_at=None,
    )


def _decode(resp) -> tuple[int, dict]:
    """JSONResponse → (status_code, parsed_body)."""
    body = resp.body if hasattr(resp, "body") else b"{}"
    if isinstance(body, bytes):
        body = body.decode("utf-8")
    return resp.status_code, json.loads(body) if body else {}


# ---------------------------------------------------------------------------
# Cancel endpoint
# ---------------------------------------------------------------------------


class TestCancelEndpoint:
    def test_cancel_pending_flips_to_failed_and_resets_retries(self, db_session):
        job = _seed_job(db_session, status="pending", retry_count=2)
        resp = cancel_provisioning_job(
            job_id=job.job_id,
            auth=_fake_auth(),
            db=db_session,
        )
        status, body = _decode(resp)
        assert status == 200
        assert body["status"] == "failed"
        assert body["error_step"] == "cancelled"

        db_session.refresh(job)
        assert job.status == "failed"
        assert job.error_step == "cancelled"
        assert job.error_message == "Cancelled by admin"
        assert job.retry_count == 0

    def test_cancel_running_flips_to_failed(self, db_session):
        job = _seed_job(db_session, status="running", retry_count=5)
        resp = cancel_provisioning_job(
            job_id=job.job_id,
            auth=_fake_auth(),
            db=db_session,
        )
        status, _ = _decode(resp)
        assert status == 200

        db_session.refresh(job)
        assert job.status == "failed"
        assert job.error_step == "cancelled"
        assert job.retry_count == 0

    def test_cancel_failed_resets_retry_count_only(self, db_session):
        job = _seed_job(
            db_session,
            status="failed",
            error_step="seed_collections_met",
            error_message="prior error",
            retry_count=7,
        )
        resp = cancel_provisioning_job(
            job_id=job.job_id,
            auth=_fake_auth(),
            db=db_session,
        )
        status, body = _decode(resp)
        assert status == 200
        assert body["retry_count"] == 0

        db_session.refresh(job)
        assert job.status == "failed"  # status preserved
        assert job.error_step == "seed_collections_met"  # error preserved
        assert job.retry_count == 0  # but counter reset

    def test_cancel_completed_returns_409(self, db_session):
        job = _seed_job(db_session, status="completed")
        resp = cancel_provisioning_job(
            job_id=job.job_id,
            auth=_fake_auth(),
            db=db_session,
        )
        status, body = _decode(resp)
        assert status == 409
        assert "completed" in json.dumps(body).lower()

    def test_cancel_missing_job_raises_404(self, db_session):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as excinfo:
            cancel_provisioning_job(
                job_id=uuid.uuid4(),
                auth=_fake_auth(),
                db=db_session,
            )
        assert excinfo.value.status_code == 404


# ---------------------------------------------------------------------------
# Rerun-step endpoint
# ---------------------------------------------------------------------------


class TestRerunStepEndpoint:
    def test_unknown_step_raises_404(self, db_session):
        from fastapi import HTTPException

        job = _seed_job(db_session, status="failed")
        with pytest.raises(HTTPException) as excinfo:
            rerun_provisioning_step(
                job_id=job.job_id,
                step_key="not-a-real-step",
                auth=_fake_auth(),
                db=db_session,
                admin_db=db_session,
            )
        assert excinfo.value.status_code == 404
        assert "not-a-real-step" in str(excinfo.value.detail)

    def test_running_job_returns_409(self, db_session):
        job = _seed_job(db_session, status="running")
        resp = rerun_provisioning_step(
            job_id=job.job_id,
            step_key="seed_collections_met",
            auth=_fake_auth(),
            db=db_session,
            admin_db=db_session,
        )
        status, body = _decode(resp)
        assert status == 409
        assert "running" in json.dumps(body).lower()

    def test_missing_job_raises_404(self, db_session):
        from fastapi import HTTPException

        with pytest.raises(HTTPException) as excinfo:
            rerun_provisioning_step(
                job_id=uuid.uuid4(),
                step_key="seed_collections_met",
                auth=_fake_auth(),
                db=db_session,
                admin_db=db_session,
            )
        assert excinfo.value.status_code == 404

    def test_rerun_resets_step_and_later_steps(self, db_session, monkeypatch):
        """Rerun from step_key → step_key + every later step's status is
        pending; earlier completed steps stay completed."""
        from app.services.provisioning_service import PROVISIONING_STEPS

        # All steps completed.
        steps = {
            sk: {"status": "completed", "started_at": None, "completed_at": None,
                 "result": {"ok": True}, "error": None}
            for sk in PROVISIONING_STEPS
        }
        # Enterprise payload (no with_demo_data) so we'd go through the
        # sync admin_db path. Stub run_job to a no-op so the test doesn't
        # actually try to execute steps against the test payload.
        from app.services import provisioning_service as ps
        monkeypatch.setattr(ps.ProvisioningService, "run_job", lambda self, job: job)

        job = _seed_job(
            db_session,
            status="completed",
            request_payload={"organization": {"name": "X"}, "admin": {"email": "a@b.c", "name": "A"}},
            steps=steps,
        )

        target_step = "seed_procedures_loans"
        resp = rerun_provisioning_step(
            job_id=job.job_id,
            step_key=target_step,
            auth=_fake_auth(),
            db=db_session,
            admin_db=db_session,
        )
        status, body = _decode(resp)
        assert status == 200
        assert body["from_step"] == target_step

        db_session.refresh(job)
        target_idx = PROVISIONING_STEPS.index(target_step)
        for i, sk in enumerate(PROVISIONING_STEPS):
            step_info = job.steps.get(sk, {})
            if i < target_idx:
                assert step_info["status"] == "completed", (
                    f"step {sk} (idx {i}) should still be completed"
                )
            else:
                # Mocked run_job didn't execute; steps stay pending.
                assert step_info["status"] == "pending", (
                    f"step {sk} (idx {i}) should be pending after rerun"
                )

    def test_rerun_dispatches_celery_for_sandbox_payload(self, db_session, monkeypatch):
        """Sandbox jobs (with_demo_data=true) → Celery .delay() + 202."""
        from app.services.provisioning_service import PROVISIONING_STEPS

        steps = {
            sk: {"status": "completed", "started_at": None, "completed_at": None,
                 "result": {"ok": True}, "error": None}
            for sk in PROVISIONING_STEPS
        }
        payload = {
            "organization": {"name": "X"},
            "admin": {"email": "a@b.c", "name": "A"},
            "with_demo_data": True,
        }
        job = _seed_job(
            db_session, status="failed", request_payload=payload, steps=steps,
        )

        called: list[str] = []
        class _FakeTask:
            def delay(self, job_id_str):
                called.append(job_id_str)

        from app.tasks import provisioning as provisioning_tasks
        monkeypatch.setattr(provisioning_tasks, "run_provisioning_job_task", _FakeTask())

        resp = rerun_provisioning_step(
            job_id=job.job_id,
            step_key="seed_collections_met",
            auth=_fake_auth(),
            db=db_session,
            admin_db=db_session,
        )
        status, body = _decode(resp)
        assert status == 202
        assert body["from_step"] == "seed_collections_met"
        assert called == [str(job.job_id)]

    def test_rerun_bumps_retry_count(self, db_session, monkeypatch):
        """Each rerun is one telemetry tick on retry_count."""
        from app.services.provisioning_service import PROVISIONING_STEPS
        from app.services import provisioning_service as ps
        monkeypatch.setattr(ps.ProvisioningService, "run_job", lambda self, job: job)

        steps = {
            sk: {"status": "completed", "result": {}, "started_at": None,
                 "completed_at": None, "error": None}
            for sk in PROVISIONING_STEPS
        }
        job = _seed_job(
            db_session,
            status="completed",
            request_payload={"organization": {"name": "X"}, "admin": {"email": "a@b.c", "name": "A"}},
            steps=steps,
            retry_count=3,
        )

        rerun_provisioning_step(
            job_id=job.job_id,
            step_key="seed_collections_met",
            auth=_fake_auth(),
            db=db_session,
            admin_db=db_session,
        )
        db_session.refresh(job)
        assert job.retry_count == 4

    def test_rerun_send_welcome_email_clears_dedupe_marker(
        self, db_session, monkeypatch
    ):
        """welcome_email_sent_at is a durable marker that survives step
        re-execution. If the operator reruns send_welcome_email — the
        explicit "please send the email again" affordance — the rerun
        handler must clear the marker, or `_step_send_welcome_email`
        short-circuits with `skipped_dedupe: True` and never calls SES.

        Regression test for the case where the original send delivered a
        broken-link email; the marker stuck; every rerun appeared to
        succeed but no email landed in the inbox."""
        from datetime import datetime, timezone
        from app.services.provisioning_service import PROVISIONING_STEPS
        from app.services import provisioning_service as ps
        monkeypatch.setattr(ps.ProvisioningService, "run_job", lambda self, job: job)

        steps = {
            sk: {"status": "completed", "result": {}, "started_at": None,
                 "completed_at": None, "error": None}
            for sk in PROVISIONING_STEPS
        }
        job = _seed_job(
            db_session,
            status="completed",
            request_payload={"organization": {"name": "X"}, "admin": {"email": "a@b.c", "name": "A"}},
            steps=steps,
        )
        # Simulate the bug shape: a prior successful send-of-broken-email
        # left the durable dedupe marker set.
        job.welcome_email_sent_at = datetime.now(timezone.utc)
        db_session.commit()

        rerun_provisioning_step(
            job_id=job.job_id,
            step_key="send_welcome_email",
            auth=_fake_auth(),
            db=db_session,
            admin_db=db_session,
        )
        db_session.refresh(job)
        assert job.welcome_email_sent_at is None, (
            "rerun handler must clear welcome_email_sent_at when the "
            "welcome step is being reset"
        )

    def test_rerun_earlier_step_also_clears_welcome_dedupe(
        self, db_session, monkeypatch
    ):
        """When the rerun cascades through send_welcome_email (e.g. the
        operator reruns from create_admin_user, which resets every later
        step), the welcome dedupe marker must clear too — otherwise the
        cascaded welcome step still short-circuits."""
        from datetime import datetime, timezone
        from app.services.provisioning_service import PROVISIONING_STEPS
        from app.services import provisioning_service as ps
        monkeypatch.setattr(ps.ProvisioningService, "run_job", lambda self, job: job)

        steps = {
            sk: {"status": "completed", "result": {}, "started_at": None,
                 "completed_at": None, "error": None}
            for sk in PROVISIONING_STEPS
        }
        job = _seed_job(
            db_session,
            status="completed",
            request_payload={"organization": {"name": "X"}, "admin": {"email": "a@b.c", "name": "A"}},
            steps=steps,
        )
        job.welcome_email_sent_at = datetime.now(timezone.utc)
        db_session.commit()

        rerun_provisioning_step(
            job_id=job.job_id,
            step_key="create_admin_user",  # earlier than send_welcome_email
            auth=_fake_auth(),
            db=db_session,
            admin_db=db_session,
        )
        db_session.refresh(job)
        assert job.welcome_email_sent_at is None

    def test_rerun_unrelated_step_preserves_welcome_dedupe(
        self, db_session, monkeypatch
    ):
        """If the rerun target is AFTER send_welcome_email (e.g. a
        seeder step), send_welcome_email is not in the reset set and
        the dedupe marker must NOT be cleared — that would cause an
        innocent seeder rerun to re-send the welcome email."""
        from datetime import datetime, timezone
        from app.services.provisioning_service import PROVISIONING_STEPS
        from app.services import provisioning_service as ps
        monkeypatch.setattr(ps.ProvisioningService, "run_job", lambda self, job: job)

        steps = {
            sk: {"status": "completed", "result": {}, "started_at": None,
                 "completed_at": None, "error": None}
            for sk in PROVISIONING_STEPS
        }
        job = _seed_job(
            db_session,
            status="completed",
            request_payload={"organization": {"name": "X"}, "admin": {"email": "a@b.c", "name": "A"}},
            steps=steps,
        )
        marker = datetime.now(timezone.utc)
        job.welcome_email_sent_at = marker
        db_session.commit()

        rerun_provisioning_step(
            job_id=job.job_id,
            step_key="seed_collections_met",
            auth=_fake_auth(),
            db=db_session,
            admin_db=db_session,
        )
        db_session.refresh(job)
        # The column is `timestamp without time zone`; the DB returns the
        # naive form. Compare without tzinfo.
        assert job.welcome_email_sent_at is not None
        assert job.welcome_email_sent_at.replace(tzinfo=timezone.utc) == marker
