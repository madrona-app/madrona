"""
Chaos / failure-injection tests for provisioning saga.

Forces exceptions at each step boundary to verify:
- Completed steps are not re-executed on retry (no duplicates)
- Partial state is correctly persisted
- The saga resumes from the exact failure point
- Edge cases: email sent but commit fails, Cognito timeout, etc.
"""

import uuid
from unittest.mock import MagicMock, patch, PropertyMock

import pytest
from botocore.exceptions import ClientError

from app.database import Base
from app.models import (
    Application,
    Organization,
    OrganizationApplication,
    OrganizationInvitation,
    OrganizationMembership,
    ProvisioningAuditLog,
    Role,
    User,
    OrgProvisioningJob,
)
from app.services.provisioning_service import (
    PROVISIONING_STEPS,
    ProvisioningError,
    ProvisioningService,
)

@pytest.fixture()
def session(db_session):
    """The shared Postgres session from conftest.

    This module used to stand up its own in-memory SQLite engine holding a
    hand-listed set of provisioning tables. SQLite has no schemas and cannot
    compile JSONB, so that fixture could only ever model a flattened subset —
    which is why a provisioning step touching the media schema could not be
    tested here at all. db_session runs each test in a savepoint on
    madrona_test and rolls back on teardown.
    """
    return db_session


SAMPLE_PAYLOAD = {
    "organization": {"name": "Chaos Museum", "slug": "chaos-museum"},
    "applications": [{"key": "collections"}],
    "contract": {"start_date": "2026-02-01", "end_date": "2027-01-31"},
    "admin": {"email": "chaos@museum.org", "name": "Chaos Admin"},
    "onboarding": {"csm_name": "Alex", "csm_email": "alex@example.com"},
}


def _seed(session):
    """Seed Application, Role, and platform admin."""
    app = Application(
        key="collections",
        display_name="Collections",
        description="Collections management",
        icon="archive",
    )
    session.add(app)
    session.flush()

    role = Role(
        role_key="admin",
        display_name="Organization Admin",
        description="Org admin role",
    )
    session.add(role)

    admin = User(
        email="platform-admin@example.com",
        display_name="Platform Admin",
        status="active",
    )
    session.add(admin)
    session.flush()
    session.commit()
    return admin


def _standard_mocks():
    """Return (mock_settings, mock_cognito_return, mock_email) values."""
    return (
        MagicMock(app_base_url="https://app.madrona.test"),
        {"Username": "chaos@museum.org"},
        MagicMock(send_welcome_email=MagicMock(return_value=True)),
    )


# ---------------------------------------------------------------------------
# TestStepBoundaryFailures
#
# For each of the 6 steps, inject a failure, verify:
# 1. Job status is 'failed' with correct error_step
# 2. Steps before the failed one are 'completed'
# 3. Retry completes successfully
# 4. No duplicate DB records (orgs, users, memberships, invitations)
# ---------------------------------------------------------------------------


class TestStepBoundaryFailures:
    """Inject failures at each provisioning step to verify retry safety."""

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_fail_at_validate_input(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Failure at validate_input: no DB state created, retry succeeds."""
        settings, cognito_ret, email_mock = _standard_mocks()
        mock_settings.return_value = settings
        mock_cognito.return_value = cognito_ret
        mock_email_svc.return_value = email_mock

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)

        # Create job with invalid payload (missing admin.name)
        bad_payload = {
            "organization": {"name": "Chaos Museum", "slug": "chaos-museum"},
            "applications": [{"key": "collections"}],
            "admin": {"email": "chaos@museum.org", "name": ""},
        }
        job = service.create_job(bad_payload)

        with pytest.raises(ProvisioningError) as exc_info:
            service.run_job(job)

        assert job.status == "failed"
        assert job.error_step == "validate_input"

        # No org or user should have been created
        assert session.query(Organization).filter_by(slug="chaos-museum").count() == 0

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_fail_at_create_organization_then_retry(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Failure at create_organization, then retry completes with one org."""
        settings, cognito_ret, email_mock = _standard_mocks()
        mock_settings.return_value = settings
        mock_cognito.return_value = cognito_ret
        mock_email_svc.return_value = email_mock

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        # Monkey-patch _step_create_organization to fail on first call
        original_step = service._step_create_organization
        call_count = {"n": 0}

        def failing_create_org(j):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("Injected: DB connection lost")
            return original_step(j)

        service._step_create_organization = failing_create_org

        with pytest.raises(ProvisioningError) as exc_info:
            service.run_job(job)

        assert job.status == "failed"
        assert job.error_step == "create_organization"
        assert job.steps["validate_input"]["status"] == "completed"

        # Retry
        job.retry_count += 1
        service.run_job(job)

        assert job.status == "completed"
        assert session.query(Organization).filter_by(slug="chaos-museum").count() == 1

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_fail_at_enable_applications_then_retry(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Failure at enable_applications, retry produces no duplicate subscriptions."""
        settings, cognito_ret, email_mock = _standard_mocks()
        mock_settings.return_value = settings
        mock_cognito.return_value = cognito_ret
        mock_email_svc.return_value = email_mock

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        original_step = service._step_enable_applications
        call_count = {"n": 0}

        def failing_enable_apps(j):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("Injected: constraint violation")
            return original_step(j)

        service._step_enable_applications = failing_enable_apps

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        assert job.status == "failed"
        assert job.error_step == "enable_applications"
        # validate_input and create_organization should be completed
        assert job.steps["validate_input"]["status"] == "completed"
        assert job.steps["create_organization"]["status"] == "completed"

        # Retry
        job.retry_count += 1
        service.run_job(job)

        assert job.status == "completed"
        # One org, one subscription
        assert session.query(Organization).filter_by(slug="chaos-museum").count() == 1
        org_apps = session.query(OrganizationApplication).filter_by(
            organization_id=job.organization_id
        ).all()
        assert len(org_apps) == 1

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_fail_at_create_admin_user_then_retry(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Failure at create_admin_user, retry produces one user/membership/invitation."""
        settings, cognito_ret, email_mock = _standard_mocks()
        mock_settings.return_value = settings
        mock_cognito.return_value = cognito_ret
        mock_email_svc.return_value = email_mock

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        original_step = service._step_create_admin_user
        call_count = {"n": 0}

        def failing_create_admin(j):
            call_count["n"] += 1
            if call_count["n"] == 1:
                raise RuntimeError("Injected: foreign key violation")
            return original_step(j)

        service._step_create_admin_user = failing_create_admin

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        assert job.status == "failed"
        assert job.error_step == "create_admin_user"

        # Steps 1-3 should be completed
        for step in PROVISIONING_STEPS[:3]:
            assert job.steps[step]["status"] == "completed"

        # Retry
        job.retry_count += 1
        service.run_job(job)

        assert job.status == "completed"
        assert session.query(User).filter_by(email="chaos@museum.org").count() == 1
        memberships = session.query(OrganizationMembership).filter_by(
            organization_id=job.organization_id
        ).all()
        assert len(memberships) == 1
        invitations = session.query(OrganizationInvitation).filter_by(
            organization_id=job.organization_id, email="chaos@museum.org"
        ).all()
        assert len(invitations) == 1

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_fail_at_create_cognito_user_then_retry(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Cognito timeout at step 5, retry with success. DB records are idempotent."""
        settings, _, email_mock = _standard_mocks()
        mock_settings.return_value = settings
        mock_email_svc.return_value = email_mock

        # First call: timeout exception
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "Request timed out"}},
            "AdminCreateUser",
        )

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        assert job.status == "failed"
        assert job.error_step == "create_cognito_user"

        # Steps 1-4 completed
        for step in PROVISIONING_STEPS[:4]:
            assert job.steps[step]["status"] == "completed"

        # Fix Cognito, retry
        mock_cognito.side_effect = None
        mock_cognito.return_value = {"Username": "chaos@museum.org"}
        mock_cognito.reset_mock()
        job.retry_count += 1

        service.run_job(job)

        assert job.status == "completed"
        # Cognito should be called exactly once on retry (skipped completed steps)
        mock_cognito.assert_called_once()
        # Still only 1 org, 1 user, 1 membership
        assert session.query(Organization).filter_by(slug="chaos-museum").count() == 1
        assert session.query(User).filter_by(email="chaos@museum.org").count() == 1

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_fail_at_send_welcome_email_then_retry(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Email send failure at step 6, retry skips re-send via durable marker."""
        settings, cognito_ret, _ = _standard_mocks()
        mock_settings.return_value = settings
        mock_cognito.return_value = cognito_ret

        # Email service raises on first call
        email_mock = MagicMock()
        email_mock.send_welcome_email.side_effect = RuntimeError("SES unavailable")
        mock_email_svc.return_value = email_mock

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        assert job.status == "failed"
        assert job.error_step == "send_welcome_email"

        # Steps 1-5 completed
        for step in PROVISIONING_STEPS[:5]:
            assert job.steps[step]["status"] == "completed"

        # Fix email, retry
        email_mock.send_welcome_email.side_effect = None
        email_mock.send_welcome_email.return_value = True
        email_mock.send_welcome_email.reset_mock()
        job.retry_count += 1

        service.run_job(job)

        assert job.status == "completed"
        # Email should have been sent on retry
        email_mock.send_welcome_email.assert_called_once()


# ---------------------------------------------------------------------------
# TestPartialCommitEdgeCases
# ---------------------------------------------------------------------------


class TestPartialCommitEdgeCases:
    """Test edge cases around partial commits and durable markers."""

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_email_sent_but_step_commit_fails(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """
        Email is physically sent (SES returns OK) but the step-commit that
        marks send_welcome_email as 'completed' fails. On retry, the durable
        marker (welcome_email_sent_at) prevents re-sending.
        """
        settings, cognito_ret, _ = _standard_mocks()
        mock_settings.return_value = settings
        mock_cognito.return_value = cognito_ret

        email_mock = MagicMock()
        email_mock.send_welcome_email.return_value = True
        mock_email_svc.return_value = email_mock

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)
        service.run_job(job)

        assert job.status == "completed"
        assert job.welcome_email_sent_at is not None
        assert email_mock.send_welcome_email.call_count == 1

        # Simulate: step marked as failed but durable marker is set
        from sqlalchemy.orm.attributes import flag_modified
        job.steps["send_welcome_email"]["status"] = "failed"
        job.status = "failed"
        job.error_step = "send_welcome_email"
        flag_modified(job, "steps")
        session.commit()

        email_mock.send_welcome_email.reset_mock()
        job.retry_count += 1

        service.run_job(job)

        assert job.status == "completed"
        # Email should NOT have been called again (dedupe)
        email_mock.send_welcome_email.assert_not_called()
        assert job.steps["send_welcome_email"]["result"]["skipped_dedupe"] is True

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_cognito_user_exists_on_retry(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """
        Cognito user was created (no exception) but the step-commit failed.
        On retry, cognito_admin_create_user raises UsernameExistsException,
        which the step handles as success (idempotent).
        """
        settings, _, email_mock = _standard_mocks()
        mock_settings.return_value = settings
        mock_email_svc.return_value = email_mock

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        # First call: cognito succeeds
        mock_cognito.return_value = {"Username": "chaos@museum.org"}
        service.run_job(job)
        assert job.status == "completed"

        # Simulate: cognito step marked failed but user exists
        from sqlalchemy.orm.attributes import flag_modified
        job.steps["create_cognito_user"]["status"] = "failed"
        job.steps["send_welcome_email"]["status"] = "failed"
        job.status = "failed"
        job.error_step = "create_cognito_user"
        # Clear email marker so email step also re-runs
        job.welcome_email_sent_at = None
        flag_modified(job, "steps")
        session.commit()

        # On retry, Cognito raises UsernameExistsException (user already there)
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "UsernameExistsException", "Message": "User already exists"}},
            "AdminCreateUser",
        )
        mock_cognito.reset_mock()
        job.retry_count += 1

        service.run_job(job)

        assert job.status == "completed"
        cognito_result = job.steps["create_cognito_user"]["result"]
        assert cognito_result["already_existed"] is True

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_org_exists_on_retry(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """
        Org was created in step 2 but step-commit failed. On retry, step 2
        finds the org by slug and returns already_existed=True (idempotent).
        """
        settings, cognito_ret, email_mock = _standard_mocks()
        mock_settings.return_value = settings
        mock_cognito.return_value = cognito_ret
        mock_email_svc.return_value = email_mock

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        service.run_job(job)
        assert job.status == "completed"

        # Simulate: step 2 marked failed but org exists
        from sqlalchemy.orm.attributes import flag_modified
        job.steps["create_organization"]["status"] = "failed"
        # Mark all subsequent steps as pending too
        for step in PROVISIONING_STEPS[2:]:
            job.steps[step]["status"] = "pending"
        job.status = "failed"
        job.error_step = "create_organization"
        job.welcome_email_sent_at = None
        flag_modified(job, "steps")
        session.commit()

        job.retry_count += 1
        service.run_job(job)

        assert job.status == "completed"
        org_result = job.steps["create_organization"]["result"]
        assert org_result["already_existed"] is True
        # Still only one org
        assert session.query(Organization).filter_by(slug="chaos-museum").count() == 1


# ---------------------------------------------------------------------------
# TestMultipleConsecutiveFailures
# ---------------------------------------------------------------------------


class TestMultipleConsecutiveFailures:
    """Test that multiple failures and retries don't accumulate duplicates."""

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_three_failures_then_success(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """
        Fail at step 3, then step 5, then step 6, then succeed.
        Verify no duplicate records at any point.
        """
        settings, cognito_ret, email_mock = _standard_mocks()
        mock_settings.return_value = settings
        mock_cognito.return_value = cognito_ret
        mock_email_svc.return_value = email_mock

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        # --- Failure 1: enable_applications ---
        original_enable = service._step_enable_applications
        enable_count = {"n": 0}

        def failing_enable(j):
            enable_count["n"] += 1
            if enable_count["n"] == 1:
                raise RuntimeError("Injected: timeout at enable_applications")
            return original_enable(j)

        service._step_enable_applications = failing_enable

        with pytest.raises(ProvisioningError):
            service.run_job(job)
        assert job.error_step == "enable_applications"

        # --- Retry 1: passes enable_applications, fails at create_cognito_user ---
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "Timeout"}},
            "AdminCreateUser",
        )
        job.retry_count += 1

        with pytest.raises(ProvisioningError):
            service.run_job(job)
        assert job.error_step == "create_cognito_user"

        # --- Retry 2: passes cognito, fails at send_welcome_email ---
        mock_cognito.side_effect = None
        mock_cognito.return_value = cognito_ret
        email_mock.send_welcome_email.side_effect = RuntimeError("SES down")
        job.retry_count += 1

        with pytest.raises(ProvisioningError):
            service.run_job(job)
        assert job.error_step == "send_welcome_email"

        # --- Retry 3: everything works ---
        email_mock.send_welcome_email.side_effect = None
        email_mock.send_welcome_email.return_value = True
        job.retry_count += 1

        service.run_job(job)
        assert job.status == "completed"

        # Verify: no duplicates anywhere
        assert session.query(Organization).filter_by(slug="chaos-museum").count() == 1
        assert session.query(User).filter_by(email="chaos@museum.org").count() == 1
        memberships = session.query(OrganizationMembership).filter_by(
            organization_id=job.organization_id
        ).all()
        assert len(memberships) == 1
        org_apps = session.query(OrganizationApplication).filter_by(
            organization_id=job.organization_id
        ).all()
        assert len(org_apps) == 1
        invitations = session.query(OrganizationInvitation).filter_by(
            organization_id=job.organization_id, email="chaos@museum.org"
        ).all()
        assert len(invitations) == 1

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_event_log_records_all_failure_points(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """
        Fail at step 3, retry and fail at step 5, retry and succeed.
        Event log should contain two step_failed + two job_failed entries.
        """
        settings, cognito_ret, email_mock = _standard_mocks()
        mock_settings.return_value = settings
        mock_cognito.return_value = cognito_ret
        mock_email_svc.return_value = email_mock

        admin = _seed(session)
        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        # --- Failure 1: enable_applications ---
        original_enable = service._step_enable_applications
        enable_count = {"n": 0}

        def failing_enable(j):
            enable_count["n"] += 1
            if enable_count["n"] == 1:
                raise RuntimeError("Injected: enable failure")
            return original_enable(j)

        service._step_enable_applications = failing_enable

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        # --- Retry 1: cognito fails ---
        mock_cognito.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "boom"}},
            "AdminCreateUser",
        )
        job.retry_count += 1

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        # --- Retry 2: everything works ---
        mock_cognito.side_effect = None
        mock_cognito.return_value = cognito_ret
        job.retry_count += 1

        service.run_job(job)
        assert job.status == "completed"

        # Verify event log
        step_failed = [e for e in job.event_log if e["action"] == "step_failed"]
        job_failed = [e for e in job.event_log if e["action"] == "job_failed"]
        job_started = [e for e in job.event_log if e["action"] == "job_started"]
        job_completed = [e for e in job.event_log if e["action"] == "job_completed"]

        assert len(step_failed) == 2
        assert len(job_failed) == 2
        assert len(job_started) == 3  # original + 2 retries
        assert len(job_completed) == 1

        # First failure at enable_applications, second at create_cognito_user
        assert step_failed[0]["details"]["step"] == "enable_applications"
        assert step_failed[1]["details"]["step"] == "create_cognito_user"
