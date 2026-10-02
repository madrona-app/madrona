"""
Tests for run failure notification service.

Covers:
- Email sent to org admins on run failure
- Email content includes run details and truncated error
- Cooldown prevents duplicate notifications
- Different pipelines get separate cooldowns
- No notification when no admins exist
- Email service errors don't affect run execution
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch, MagicMock
from uuid import uuid4

import pytest

from app.models import (
    Organization,
    OrganizationMembership,
    Run,
    User,
    Pipeline,
    PipelineSource,
    ConnectorInstance,
    ConnectorDefinition,
    Role,
)
from app.services.run_notifications import (
    notify_run_failure,
    clear_notification_cache,
    FAILURE_NOTIFICATION_COOLDOWN_MINUTES,
    _last_pipeline_notification_cache,
)


class TestRunFailureNotifications:
    """Tests for run failure notifications."""

    @pytest.fixture
    def notification_org(self, db_session):
        """Create organization with admin users for notification tests."""
        org = Organization(
            name="Notification Test Org",
            slug="notif-test-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        # Create a role for the admins
        role = Role(
            role_key="notif_org_admin",
            display_name="Notification Org Admin",
            description="Admin role for notification tests",
            is_system=False,
        )
        db_session.add(role)
        db_session.flush()

        # Create two admin users
        admin1 = User(
            email="notif-admin1@example.com",
            password_hash="not_used",
            status="active",
        )
        admin2 = User(
            email="notif-admin2@example.com",
            password_hash="not_used",
            status="active",
        )
        db_session.add_all([admin1, admin2])
        db_session.flush()

        # Create admin memberships
        membership1 = OrganizationMembership(
            organization_id=org.organization_id,
            user_id=admin1.user_id,
            role="admin",
            role_id=role.role_id,
            status="active",
        )
        membership2 = OrganizationMembership(
            organization_id=org.organization_id,
            user_id=admin2.user_id,
            role="admin",
            role_id=role.role_id,
            status="active",
        )
        db_session.add_all([membership1, membership2])
        db_session.commit()
        return org, [admin1, admin2], role

    @pytest.fixture
    def notification_pipeline(self, db_session, notification_org):
        """Create a pipeline with source connector for notification tests."""
        org, _, _ = notification_org

        source_def = ConnectorDefinition(
            key="notif_source_def",
            display_name="Notification Source",
            direction="source",
            implementation_key="test.source:NotifSource",
            capabilities={},
            config_schema={},
            is_enabled=True,
        )
        db_session.add(source_def)
        db_session.flush()

        source_instance = ConnectorInstance(
            organization_id=org.organization_id,
            connector_definition_id=source_def.connector_definition_id,
            name="Notif Source Instance",
            status="active",
            config={},
        )
        db_session.add(source_instance)
        db_session.flush()

        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        # Add source to pipeline so pipeline.name works
        pipeline_source = PipelineSource(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=source_instance.connector_instance_id,
            enabled=True,
            parameters={},
            ordering=0,
        )
        db_session.add(pipeline_source)
        db_session.commit()

        return pipeline

    @pytest.fixture
    def failed_run(self, db_session, notification_org, notification_pipeline):
        """Create a failed run for notification tests."""
        org, _, _ = notification_org
        pipeline = notification_pipeline

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="failed",
            started_at=datetime.now(timezone.utc) - timedelta(minutes=5),
            finished_at=datetime.now(timezone.utc),
            duration_ms=300000,
            triggered_by="manual",
            parameters={},
            error="Connection timeout while fetching data from API endpoint",
            error_stage="extract",
            error_at=datetime.now(timezone.utc),
        )
        db_session.add(run)
        db_session.commit()
        return run

    @pytest.fixture(autouse=True)
    def clear_cache(self):
        """Clear notification cache before and after each test."""
        clear_notification_cache()
        yield
        clear_notification_cache()

    def test_sends_email_to_admins(
        self, db_session, failed_run, notification_org
    ):
        """Notification sends email to all org admins."""
        org, admins, _ = notification_org

        mock_service = Mock()
        with patch("app.services.run_notifications.get_email_service", return_value=mock_service):
            notify_run_failure(db_session, failed_run)

        mock_service.send_email.assert_called_once()
        call_kwargs = mock_service.send_email.call_args.kwargs

        # Should use notifications channel
        assert call_kwargs["channel"] == "notifications"

        # Should send to both admins
        assert set(call_kwargs["to"]) == {
            "notif-admin1@example.com",
            "notif-admin2@example.com",
        }

        # Should have proper subject with pipeline name
        assert "failed" in call_kwargs["subject"].lower()

        # Should have HTML and text bodies
        assert "html" in call_kwargs
        assert "text" in call_kwargs

    def test_email_contains_run_details(
        self, db_session, failed_run
    ):
        """Email contains run ID and error details."""
        mock_service = Mock()
        with patch("app.services.run_notifications.get_email_service", return_value=mock_service):
            notify_run_failure(db_session, failed_run)

        call_kwargs = mock_service.send_email.call_args.kwargs
        html_body = call_kwargs["html"]
        text_body = call_kwargs["text"]

        # Check HTML body
        assert str(failed_run.run_id) in html_body
        assert "Connection timeout" in html_body
        assert "/app/runs/" in html_body  # Link to run detail

        # Check text body
        assert str(failed_run.run_id) in text_body
        assert "Connection timeout" in text_body

    def test_truncates_long_errors(
        self, db_session, failed_run
    ):
        """Long error messages are truncated to 200 chars."""
        failed_run.error = "A" * 300
        db_session.commit()

        mock_service = Mock()
        with patch("app.services.run_notifications.get_email_service", return_value=mock_service):
            notify_run_failure(db_session, failed_run)

        call_kwargs = mock_service.send_email.call_args.kwargs
        html_body = call_kwargs["html"]

        # Should be truncated with ellipsis
        assert "A" * 200 in html_body
        assert "..." in html_body
        assert "A" * 300 not in html_body

    def test_cooldown_prevents_spam(
        self, db_session, failed_run, notification_org
    ):
        """Multiple failures within cooldown window only send one notification."""
        org, _, _ = notification_org

        mock_service = Mock()
        with patch("app.services.run_notifications.get_email_service", return_value=mock_service):
            # First failure - should send
            notify_run_failure(db_session, failed_run)
            assert mock_service.send_email.call_count == 1

            # Second failure immediately after - should skip (cooldown)
            failed_run2 = Run(
                organization_id=org.organization_id,
                pipeline_id=failed_run.pipeline_id,
                status="failed",
                started_at=datetime.now(timezone.utc),
                finished_at=datetime.now(timezone.utc),
                duration_ms=100,
                triggered_by="manual",
                parameters={},
                error="Another error",
            )
            db_session.add(failed_run2)
            db_session.commit()

            notify_run_failure(db_session, failed_run2)

            # Should still be 1 (no new email)
            assert mock_service.send_email.call_count == 1

    def test_cooldown_expires_after_window(
        self, db_session, failed_run, notification_org, disabled_redis
    ):
        """After cooldown expires, notifications resume.

        Uses disabled_redis so the cooldown check falls back to
        the in-memory _last_pipeline_notification_cache that we can
        manipulate directly.
        """
        org, _, _ = notification_org

        mock_service = Mock()
        with patch("app.services.run_notifications.get_email_service", return_value=mock_service):
            # First failure
            notify_run_failure(db_session, failed_run)
            assert mock_service.send_email.call_count == 1

            # Simulate cooldown expiry by manipulating in-memory cache
            _last_pipeline_notification_cache[failed_run.pipeline_id] = (
                datetime.now(timezone.utc)
                - timedelta(minutes=FAILURE_NOTIFICATION_COOLDOWN_MINUTES + 1)
            )

            # Second failure after cooldown - should send
            failed_run2 = Run(
                organization_id=org.organization_id,
                pipeline_id=failed_run.pipeline_id,
                status="failed",
                started_at=datetime.now(timezone.utc),
                finished_at=datetime.now(timezone.utc),
                duration_ms=100,
                triggered_by="manual",
                parameters={},
                error="Another error after cooldown",
            )
            db_session.add(failed_run2)
            db_session.commit()

            notify_run_failure(db_session, failed_run2)

            # Should have sent second email
            assert mock_service.send_email.call_count == 2

    def test_different_pipelines_get_separate_notifications(
        self, db_session, failed_run, notification_org
    ):
        """Failures on different pipelines do not share cooldown."""
        org, _, _ = notification_org

        mock_service = Mock()
        with patch("app.services.run_notifications.get_email_service", return_value=mock_service):
            # First pipeline fails
            notify_run_failure(db_session, failed_run)
            assert mock_service.send_email.call_count == 1

            # Create second pipeline
            pipeline2 = Pipeline(
                organization_id=org.organization_id,
                status="active",
            )
            db_session.add(pipeline2)
            db_session.flush()

            # Second pipeline fails immediately - should still send
            failed_run2 = Run(
                organization_id=org.organization_id,
                pipeline_id=pipeline2.pipeline_id,
                status="failed",
                started_at=datetime.now(timezone.utc),
                finished_at=datetime.now(timezone.utc),
                duration_ms=100,
                triggered_by="manual",
                parameters={},
                error="Error on second pipeline",
            )
            db_session.add(failed_run2)
            db_session.commit()

            # pipeline2 has no sources so pipeline.name lookup will return fallback,
            # but pipeline lookup still succeeds
            notify_run_failure(db_session, failed_run2)

            # Should have sent two emails (different pipelines)
            assert mock_service.send_email.call_count == 2

    def test_no_notification_when_no_admins(
        self, db_session, failed_run, notification_org
    ):
        """No notification sent if organization has no admins."""
        org, _, _ = notification_org

        # Remove all admin memberships
        db_session.query(OrganizationMembership).filter_by(
            organization_id=org.organization_id
        ).delete()
        db_session.commit()

        mock_service = Mock()
        with patch("app.services.run_notifications.get_email_service", return_value=mock_service):
            notify_run_failure(db_session, failed_run)

            # Should not send email
            mock_service.send_email.assert_not_called()

    def test_notification_handles_missing_pipeline(
        self, db_session, failed_run
    ):
        """Notification gracefully handles missing pipeline."""
        # Delete the pipeline
        db_session.query(Pipeline).filter_by(
            pipeline_id=failed_run.pipeline_id
        ).delete()
        db_session.commit()

        mock_service = Mock()
        with patch("app.services.run_notifications.get_email_service", return_value=mock_service):
            # Should not raise exception
            notify_run_failure(db_session, failed_run)

            # Should not send email (no pipeline found)
            mock_service.send_email.assert_not_called()

    def test_email_service_error_does_not_crash(
        self, db_session, failed_run
    ):
        """Email service error does not raise exception."""
        mock_service = Mock()
        mock_service.send_email.side_effect = Exception("Email service down")
        with patch("app.services.run_notifications.get_email_service", return_value=mock_service):
            # Should not raise exception
            notify_run_failure(db_session, failed_run)

        # Run should still be in failed state
        db_session.refresh(failed_run)
        assert failed_run.status == "failed"
