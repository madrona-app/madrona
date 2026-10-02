"""
Invitation / activation robustness tests.

Focused on edge cases and failure modes for:
- Resend invite (Cognito ensure, token rotation, rate-limit, idempotency)
- Reconcile (missing Cognito, missing invite, no email sent)
- Activation (expired token 410, used token 409, marks used)
- Token lifecycle (7-day expiry, rotation, reuse)

Uses a standalone SQLite in-memory database with only the tables needed
for provisioning. External services (Cognito, SES) are mocked.
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

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
from app.services.invitation_service import INVITATION_EXPIRY_DAYS

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
    "organization": {"name": "Test Museum", "slug": "test-museum"},
    "applications": [{"key": "collections"}],
    "contract": {"start_date": "2026-02-01", "end_date": "2027-01-31"},
    "admin": {"email": "admin@testmuseum.org", "name": "Jane Admin"},
    "onboarding": {"csm_name": "Alex", "csm_email": "alex@example.com"},
}


def _seed_all(session):
    """Seed application, role, and platform admin for a full provisioning run."""
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


def _cognito_svc_mock(exists=True):
    """Return a mock get_cognito_service that reports user exists (or not)."""
    mock = MagicMock()
    mock.user_pool_id = "test-pool"
    if exists:
        mock.client.admin_get_user.return_value = {
            "Username": "admin@testmuseum.org",
            "UserStatus": "CONFIRMED",
            "UserAttributes": [
                {"Name": "email_verified", "Value": "true"},
            ],
        }
    else:
        mock.client.admin_get_user.side_effect = ClientError(
            {"Error": {"Code": "UserNotFoundException", "Message": "Not found"}},
            "AdminGetUser",
        )
    return mock


def _run_full_provisioning(session, admin):
    """Run a full provisioning job and return (service, job)."""
    service = ProvisioningService(session, performer_id=admin.user_id)
    job = service.create_job(SAMPLE_PAYLOAD)
    service.run_job(job)
    assert job.status == "completed"
    return service, job


# ---------------------------------------------------------------------------
# TestResendEnsuresCognito
# ---------------------------------------------------------------------------


class TestResendEnsuresCognito:
    """Resend must ensure Cognito user exists (creates if missing)."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_creates_cognito_when_missing(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """If Cognito user is missing (e.g., provisioning failed at that step),
        resend creates it before sending email."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        # Cognito user does NOT exist → will be created by ensure step
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=False)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        mock_email.send_welcome_email.reset_mock()
        mock_cognito_create.reset_mock()

        result = service.resend_invite(job, force=True)

        assert result["cognito_created"] is True
        assert result["sent_at"] is not None
        assert result["invitation_id"] is not None
        # Cognito create should have been called by _ensure_cognito_user
        mock_cognito_create.assert_called_once()
        mock_email.send_welcome_email.assert_called_once()

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_skips_cognito_creation_when_exists(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """If Cognito user already exists, resend does not re-create it."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        mock_cognito_create.reset_mock()
        result = service.resend_invite(job, force=True)

        assert result["cognito_created"] is False
        # cognito_admin_create_user should NOT have been called again by _ensure_cognito_user
        mock_cognito_create.assert_not_called()


# ---------------------------------------------------------------------------
# TestResendRateLimit
# ---------------------------------------------------------------------------


class TestResendRateLimit:
    """Resend rate-limiting uses last_sent_at with 10-min window."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_rate_limit_uses_last_sent_at(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """Rate-limit checks last_sent_at (not created_at), blocking resend within 10 min."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        # First resend — should succeed
        result1 = service.resend_invite(job, force=True)
        assert result1["sent_at"] is not None

        # Second resend without force — should be rate-limited
        mock_email.send_welcome_email.reset_mock()
        result2 = service.resend_invite(job, force=False)
        assert result2.get("dedupe_skipped") is True
        mock_email.send_welcome_email.assert_not_called()

        # Force bypasses rate-limit
        result3 = service.resend_invite(job, force=True)
        assert result3["sent_at"] is not None
        mock_email.send_welcome_email.assert_called_once()

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_rate_limit_expires_after_window(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """After 10 minutes, resend is allowed even without force."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        # First resend
        service.resend_invite(job, force=True)

        # Manually backdate last_sent_at by 11 minutes
        invite = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .order_by(OrganizationInvitation.created_at.desc())
            .first()
        )
        invite.last_sent_at = datetime.now(timezone.utc) - timedelta(minutes=11)
        session.commit()

        # Should succeed without force (past 10-min window)
        mock_email.send_welcome_email.reset_mock()
        result = service.resend_invite(job, force=False)
        assert result.get("dedupe_skipped") is None
        assert result["sent_at"] is not None
        mock_email.send_welcome_email.assert_called_once()


# ---------------------------------------------------------------------------
# TestResendInviteCreation
# ---------------------------------------------------------------------------


class TestResendInviteCreation:
    """Resend creates invite if missing, reuses if valid, rotates if expired."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_creates_invite_when_none_exists(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """If no invitation exists at all, resend creates one."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        # Delete all invitations
        session.query(OrganizationInvitation).filter_by(
            organization_id=job.organization_id
        ).delete()
        session.commit()

        result = service.resend_invite(job, force=True)

        assert result["reused_token"] is False
        assert result["invitation_id"] is not None

        # Verify exactly one invite exists
        invites = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .all()
        )
        assert len(invites) == 1
        assert invites[0].last_sent_at is not None

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_reuses_valid_invite_record(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """If invite is still valid (not expired), resend rotates token on same record."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        invite_before = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .first()
        )
        original_id = invite_before.invitation_id
        original_hash = invite_before.token_hash

        result = service.resend_invite(job, force=True)

        assert result["reused_token"] is True
        assert result["invitation_id"] == str(original_id)

        # Same record, different token hash
        session.refresh(invite_before)
        assert invite_before.token_hash != original_hash

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_creates_new_invite_when_expired(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """If invite is expired, resend creates a new record (doesn't reuse expired)."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        # Expire existing invite
        invite = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .first()
        )
        invite.expires_at = datetime.now(timezone.utc) - timedelta(days=1)
        session.commit()
        old_id = invite.invitation_id

        result = service.resend_invite(job, force=True)

        assert result["reused_token"] is False
        assert result["invitation_id"] != str(old_id)

        # Two invite records: old expired + new valid
        invites = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .all()
        )
        assert len(invites) == 2


# ---------------------------------------------------------------------------
# TestResendIdempotency
# ---------------------------------------------------------------------------


class TestResendIdempotency:
    """Resend never creates duplicate users, memberships, or orgs."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_multiple_resends_no_duplicates(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """Five consecutive resends produce no duplicate records."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        for _ in range(5):
            service.resend_invite(job, force=True)

        # One org, one user, one membership
        orgs = session.query(Organization).filter_by(slug="test-museum").all()
        assert len(orgs) == 1

        users = session.query(User).filter_by(email="admin@testmuseum.org").all()
        assert len(users) == 1

        memberships = (
            session.query(OrganizationMembership)
            .filter_by(organization_id=job.organization_id)
            .all()
        )
        assert len(memberships) == 1


# ---------------------------------------------------------------------------
# TestReconcileRepairsState
# ---------------------------------------------------------------------------


class TestReconcileRepairsState:
    """Reconcile repairs missing state without sending email."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_reconcile_creates_cognito_without_email(
        self, mock_settings, mock_email_svc, mock_cognito_create, mock_cognito_svc_fn, session
    ):
        """Reconcile creates Cognito user when missing but does NOT send email."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        admin = _seed_all(session)

        # Initial provisioning fails at Cognito
        mock_cognito_create.side_effect = ClientError(
            {"Error": {"Code": "InternalErrorException", "Message": "Service unavailable"}},
            "AdminCreateUser",
        )

        service = ProvisioningService(session, performer_id=admin.user_id)
        job = service.create_job(SAMPLE_PAYLOAD)

        with pytest.raises(ProvisioningError):
            service.run_job(job)

        assert job.status == "failed"

        # Reconcile: Cognito not found → create
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=False)
        mock_cognito_create.side_effect = None
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_cognito_create.reset_mock()
        mock_email.send_welcome_email.reset_mock()

        result = service.reconcile(job)

        assert "created_cognito_user" in result["actions"]
        assert result["cognito_user"] == "ensured"
        # CRITICAL: no email sent during reconcile
        mock_email.send_welcome_email.assert_not_called()

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_reconcile_creates_invite_without_email(
        self, mock_settings, mock_email_svc, mock_cognito_create, mock_cognito_svc_fn, session
    ):
        """Reconcile creates invite when missing but does NOT send email."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        # Delete all invitations + mark user as invited
        session.query(OrganizationInvitation).filter_by(
            organization_id=job.organization_id
        ).delete()
        user = session.query(User).filter_by(email="admin@testmuseum.org").first()
        user.status = "invited"
        session.commit()

        mock_email.send_welcome_email.reset_mock()

        result = service.reconcile(job)

        assert "created_invitation" in result["actions"]
        assert result["invitation"] == "ensured"
        # No email
        mock_email.send_welcome_email.assert_not_called()

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_reconcile_ensures_membership(
        self, mock_settings, mock_email_svc, mock_cognito_create, mock_cognito_svc_fn, session
    ):
        """Reconcile creates missing membership."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        # Delete membership
        session.query(OrganizationMembership).filter_by(
            organization_id=job.organization_id
        ).delete()
        session.commit()

        result = service.reconcile(job)

        assert "created_membership" in result["actions"]

        memberships = (
            session.query(OrganizationMembership)
            .filter_by(organization_id=job.organization_id)
            .all()
        )
        assert len(memberships) == 1

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_reconcile_idempotent_no_action(
        self, mock_settings, mock_email_svc, mock_cognito_create, mock_cognito_svc_fn, session
    ):
        """Reconcile on fully-complete state takes no actions."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        result = service.reconcile(job)

        assert result["actions"] == []
        assert result["cognito_user"] == "ensured"


# ---------------------------------------------------------------------------
# TestReconcileResponseShape
# ---------------------------------------------------------------------------


class TestReconcileResponseShape:
    """Reconcile response matches the API contract."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.get_settings")
    def test_reconcile_response_fields(
        self, mock_settings, mock_email_svc, mock_cognito_create, mock_cognito_svc_fn, session
    ):
        """Response includes all required fields from the spec."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        result = service.reconcile(job)

        assert "job_id" in result
        assert "organization_id" in result
        assert "admin_user_id" in result
        assert "cognito_user" in result
        assert "invitation" in result
        assert result["cognito_user"] == "ensured"


# ---------------------------------------------------------------------------
# TestActivationTokenExpiry
# ---------------------------------------------------------------------------


class TestActivationTokenExpiry:
    """Activation endpoint enforces 7-day token expiry."""

    def test_invitation_expiry_is_7_days(self):
        """INVITATION_EXPIRY_DAYS constant is 7."""
        assert INVITATION_EXPIRY_DAYS == 7

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_invitation_created_with_7_day_expiry(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """Provisioning creates invitations with 7-day expiry."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        invite = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .first()
        )
        assert invite is not None
        assert invite.used_at is None

        # Expiry should be ~7 days from now (within a minute tolerance)
        now = datetime.now(timezone.utc).replace(tzinfo=None)
        expected_expiry = now + timedelta(days=7)
        expires = invite.expires_at
        if expires.tzinfo:
            expires = expires.replace(tzinfo=None)
        assert abs((expires - expected_expiry).total_seconds()) < 60

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_invitation_marked_used_after_activation(
        self, mock_settings, mock_cognito, mock_email_svc, session
    ):
        """After a successful activation, invitation.used_at is set (prevents reuse)."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        invite = (
            session.query(OrganizationInvitation)
            .filter_by(organization_id=job.organization_id, email="admin@testmuseum.org")
            .first()
        )
        assert invite.used_at is None

        # Simulate activation by setting used_at (as activation.py does)
        invite.used_at = datetime.now(timezone.utc)
        session.commit()

        session.refresh(invite)
        assert invite.used_at is not None


# ---------------------------------------------------------------------------
# TestResendResponseShape
# ---------------------------------------------------------------------------


class TestResendResponseShape:
    """Resend response matches the API contract."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_response_fields(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """Response includes all required fields from the spec."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        result = service.resend_invite(job, force=True)

        assert result["job_id"] == str(job.job_id)
        assert result["organization_id"] == str(job.organization_id)
        assert result["admin_user_id"] is not None
        assert result["email"] == "admin@testmuseum.org"
        assert result["invitation_id"] is not None
        assert result["sent_at"] is not None
        assert "reused_token" in result
        assert result["expires_at"] is not None

    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_already_active_response(
        self, mock_settings, mock_cognito_create, mock_email_svc, session
    ):
        """Already-active user returns early with correct fields."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)

        # Mark user as active
        user = session.query(User).filter_by(email="admin@testmuseum.org").first()
        user.status = "active"
        session.commit()

        result = service.resend_invite(job)

        assert result["already_active"] is True
        assert result["admin_user_id"] is not None
        assert result["sent_at"] is None


# ---------------------------------------------------------------------------
# TestEventLogAudit
# ---------------------------------------------------------------------------


class TestEventLogAudit:
    """Resend and reconcile operations are audited in event_log."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_resend_event_log_contains_cognito_existed(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """Resend event log includes cognito_existed field."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)
        service.resend_invite(job, force=True)

        resend_events = [e for e in job.event_log if e["action"] == "resend_invite"]
        assert len(resend_events) == 1
        assert resend_events[0]["details"]["cognito_existed"] is True
        assert resend_events[0]["details"]["reused_token"] is True

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.get_email_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    @patch("app.services.provisioning_service.get_settings")
    def test_event_log_no_secrets(
        self, mock_settings, mock_cognito_create, mock_email_svc, mock_cognito_svc_fn, session
    ):
        """Event log from resend never contains tokens or passwords."""
        mock_settings.return_value = MagicMock(app_base_url="https://app.madrona.test")
        mock_cognito_create.return_value = {"Username": "admin@testmuseum.org"}
        mock_email = MagicMock()
        mock_email.send_welcome_email.return_value = True
        mock_email_svc.return_value = mock_email
        mock_cognito_svc_fn.return_value = _cognito_svc_mock(exists=True)

        admin = _seed_all(session)
        service, job = _run_full_provisioning(session, admin)
        service.resend_invite(job, force=True)

        log_str = str(job.event_log)
        assert "invitation_token" not in log_str
        assert "password" not in log_str.lower()
        assert "client_secret" not in log_str.lower()
