"""
Tests for Cognito reconciliation hardening.

Verifies _ensure_cognito_user handles:
- Missing user → created
- FORCE_CHANGE_PASSWORD → password reset to CONFIRMED
- UNCONFIRMED → same treatment
- CONFIRMED → no action
- email_verified missing → set to true
"""

import uuid
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest
from botocore.exceptions import ClientError
from app.models import (
    Organization,
    User,
    OrganizationMembership,
    OrganizationInvitation,
    Application,
    Role,
    OrgProvisioningJob,
)
from app.services.provisioning_service import ProvisioningService


@pytest.fixture
def session(db_session):
    """The shared Postgres session from conftest.

    This module used to build its own in-memory SQLite engine and create a
    hand-listed subset of tables. SQLite has no schemas and cannot compile
    JSONB, so such a fixture only ever holds a flattened approximation of the
    schema — the reason conftest dropped its own SQLite engine. db_session
    runs each test in a savepoint on madrona_test and rolls back on teardown,
    so the manual delete pass this fixture used to do is unnecessary.
    """
    return db_session


def _mock_cognito_response(user_status="CONFIRMED", email_verified="true"):
    """Build a mock admin_get_user response."""
    return {
        "Username": "test@example.com",
        "UserStatus": user_status,
        "UserAttributes": [
            {"Name": "email", "Value": "test@example.com"},
            {"Name": "email_verified", "Value": email_verified},
        ],
    }


def _user_not_found_error():
    """Build a Cognito UserNotFoundException."""
    return ClientError(
        {"Error": {"Code": "UserNotFoundException", "Message": "User does not exist."}},
        "AdminGetUser",
    )


class TestEnsureCognitoUser:
    """Test _ensure_cognito_user state handling."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    def test_missing_user_is_created(self, mock_create, mock_get_svc, session):
        """UserNotFoundException → create the user."""
        mock_client = MagicMock()
        mock_client.admin_get_user.side_effect = _user_not_found_error()
        mock_svc = MagicMock()
        mock_svc.client = mock_client
        mock_svc.user_pool_id = "us-east-1_test"
        mock_get_svc.return_value = mock_svc

        service = ProvisioningService(session)
        result = service._ensure_cognito_user("new@example.com")

        assert result["existed"] is False
        assert "created" in result["actions"]
        mock_create.assert_called_once()

    @patch("app.services.provisioning_service.get_cognito_service")
    def test_force_change_password_is_corrected(self, mock_get_svc, session):
        """FORCE_CHANGE_PASSWORD → set permanent password to move to CONFIRMED."""
        mock_client = MagicMock()
        mock_client.admin_get_user.return_value = _mock_cognito_response(
            user_status="FORCE_CHANGE_PASSWORD", email_verified="true"
        )
        mock_svc = MagicMock()
        mock_svc.client = mock_client
        mock_svc.user_pool_id = "us-east-1_test"
        mock_get_svc.return_value = mock_svc

        service = ProvisioningService(session)
        result = service._ensure_cognito_user("stuck@example.com")

        assert result["existed"] is True
        assert result["status"] == "CONFIRMED"
        assert "reset_password_from_force_change_password" in result["actions"]
        mock_client.admin_set_user_password.assert_called_once()

    @patch("app.services.provisioning_service.get_cognito_service")
    def test_unconfirmed_is_corrected(self, mock_get_svc, session):
        """UNCONFIRMED → same treatment as FORCE_CHANGE_PASSWORD."""
        mock_client = MagicMock()
        mock_client.admin_get_user.return_value = _mock_cognito_response(
            user_status="UNCONFIRMED", email_verified="true"
        )
        mock_svc = MagicMock()
        mock_svc.client = mock_client
        mock_svc.user_pool_id = "us-east-1_test"
        mock_get_svc.return_value = mock_svc

        service = ProvisioningService(session)
        result = service._ensure_cognito_user("unconfirmed@example.com")

        assert result["existed"] is True
        assert result["status"] == "CONFIRMED"
        assert "reset_password_from_unconfirmed" in result["actions"]

    @patch("app.services.provisioning_service.get_cognito_service")
    def test_confirmed_no_action(self, mock_get_svc, session):
        """CONFIRMED user with email_verified=true → no corrective actions."""
        mock_client = MagicMock()
        mock_client.admin_get_user.return_value = _mock_cognito_response(
            user_status="CONFIRMED", email_verified="true"
        )
        mock_svc = MagicMock()
        mock_svc.client = mock_client
        mock_svc.user_pool_id = "us-east-1_test"
        mock_get_svc.return_value = mock_svc

        service = ProvisioningService(session)
        result = service._ensure_cognito_user("healthy@example.com")

        assert result["existed"] is True
        assert result["status"] == "CONFIRMED"
        assert result["actions"] == []
        mock_client.admin_set_user_password.assert_not_called()
        mock_client.admin_update_user_attributes.assert_not_called()

    @patch("app.services.provisioning_service.get_cognito_service")
    def test_email_verified_missing_is_set(self, mock_get_svc, session):
        """email_verified=false → set to true."""
        mock_client = MagicMock()
        mock_client.admin_get_user.return_value = _mock_cognito_response(
            user_status="CONFIRMED", email_verified="false"
        )
        mock_svc = MagicMock()
        mock_svc.client = mock_client
        mock_svc.user_pool_id = "us-east-1_test"
        mock_get_svc.return_value = mock_svc

        service = ProvisioningService(session)
        result = service._ensure_cognito_user("unverified@example.com")

        assert result["existed"] is True
        assert "set_email_verified" in result["actions"]
        mock_client.admin_update_user_attributes.assert_called_once()
        call_args = mock_client.admin_update_user_attributes.call_args
        attrs = call_args.kwargs.get("UserAttributes") or call_args[1].get("UserAttributes")
        assert {"Name": "email_verified", "Value": "true"} in attrs

    @patch("app.services.provisioning_service.get_cognito_service")
    def test_force_change_password_and_email_unverified(self, mock_get_svc, session):
        """Both issues at once → both corrected."""
        mock_client = MagicMock()
        mock_client.admin_get_user.return_value = _mock_cognito_response(
            user_status="FORCE_CHANGE_PASSWORD", email_verified="false"
        )
        mock_svc = MagicMock()
        mock_svc.client = mock_client
        mock_svc.user_pool_id = "us-east-1_test"
        mock_get_svc.return_value = mock_svc

        service = ProvisioningService(session)
        result = service._ensure_cognito_user("both@example.com")

        assert result["existed"] is True
        assert result["status"] == "CONFIRMED"
        assert "reset_password_from_force_change_password" in result["actions"]
        assert "set_email_verified" in result["actions"]


class TestReconcileReportsCognitoActions:
    """Test that reconcile endpoint surfaces Cognito corrective actions."""

    @patch("app.services.provisioning_service.get_cognito_service")
    @patch("app.services.provisioning_service.cognito_admin_create_user")
    def test_reconcile_reports_cognito_creation(self, mock_create, mock_get_svc, session):
        """Reconcile reports 'created_cognito_user' when Cognito user was missing."""
        # Set up mock: user not found → create succeeds
        mock_client = MagicMock()
        mock_client.admin_get_user.side_effect = _user_not_found_error()
        mock_svc = MagicMock()
        mock_svc.client = mock_client
        mock_svc.user_pool_id = "us-east-1_test"
        mock_get_svc.return_value = mock_svc

        # Create org, user, role, membership, job
        org_id = uuid.uuid4()
        user_id = uuid.uuid4()
        performer_id = uuid.uuid4()
        role_id = uuid.uuid4()
        session.add(Organization(organization_id=org_id, name="Test", slug="test", status="active"))
        session.add(User(user_id=user_id, email="admin@test.org", display_name="Admin", status="invited"))
        session.add(User(user_id=performer_id, email="performer@test.org", display_name="Performer", status="active"))
        session.add(Role(role_id=role_id, role_key="admin", display_name="Admin"))
        session.flush()
        session.add(OrganizationMembership(
            membership_id=uuid.uuid4(), organization_id=org_id, user_id=user_id,
            role="admin", role_id=role_id,
        ))
        job = OrgProvisioningJob(
            job_id=uuid.uuid4(), idempotency_key=uuid.uuid4().hex,
            status="completed", organization_id=org_id, admin_user_id=user_id,
            organization_slug="test", request_payload={}, steps={}, event_log=[],
        )
        session.add(job)
        session.commit()

        service = ProvisioningService(session, performer_id=performer_id)
        result = service.reconcile(job)

        assert "created_cognito_user" in result["actions"]

    @patch("app.services.provisioning_service.get_cognito_service")
    def test_reconcile_reports_state_correction(self, mock_get_svc, session):
        """Reconcile reports Cognito state corrections in actions."""
        mock_client = MagicMock()
        mock_client.admin_get_user.return_value = _mock_cognito_response(
            user_status="FORCE_CHANGE_PASSWORD", email_verified="false"
        )
        mock_svc = MagicMock()
        mock_svc.client = mock_client
        mock_svc.user_pool_id = "us-east-1_test"
        mock_get_svc.return_value = mock_svc

        org_id = uuid.uuid4()
        user_id = uuid.uuid4()
        performer_id = uuid.uuid4()
        role_id = uuid.uuid4()
        session.add(Organization(organization_id=org_id, name="Test2", slug="test2", status="active"))
        session.add(User(user_id=user_id, email="stuck@test.org", display_name="Stuck", status="invited"))
        session.add(User(user_id=performer_id, email="performer2@test.org", display_name="Performer", status="active"))
        session.add(Role(role_id=role_id, role_key="admin2", display_name="Admin"))
        session.flush()
        session.add(OrganizationMembership(
            membership_id=uuid.uuid4(), organization_id=org_id, user_id=user_id,
            role="admin", role_id=role_id,
        ))
        job = OrgProvisioningJob(
            job_id=uuid.uuid4(), idempotency_key=uuid.uuid4().hex,
            status="completed", organization_id=org_id, admin_user_id=user_id,
            organization_slug="test2", request_payload={}, steps={}, event_log=[],
        )
        session.add(job)
        session.commit()

        service = ProvisioningService(session, performer_id=performer_id)
        result = service.reconcile(job)

        assert "reset_password_from_force_change_password" in result["actions"]
        assert "set_email_verified" in result["actions"]
