"""
Tests for email service with AWS SES v2.

Uses mocked SES client to avoid sending real emails during tests.
"""

import pytest
from unittest.mock import Mock, patch, MagicMock
from botocore.exceptions import ClientError

from app.services.deployment_identity import accounts_from, notifications_from
from app.services.email_service import EmailService


class TestEmailService:
    """Test suite for EmailService."""

    @pytest.fixture
    def email_service(self):
        """Create a fresh EmailService instance for each test."""
        service = EmailService()
        # Ensure email is enabled for tests
        service.settings.email_enabled = True
        return service

    @pytest.fixture
    def mock_ses_client(self, email_service):
        """Mock the SES v2 client."""
        mock_client = Mock()
        mock_client.send_email.return_value = {"MessageId": "test-message-id-123"}
        email_service._client = mock_client
        return mock_client

    @patch("app.services.email_event_service.check_email_deliverable", return_value=True)
    def test_send_email_accounts_channel(self, mock_deliverable, email_service, mock_ses_client):
        """Test sending email via accounts channel."""
        result = email_service.send_email(
            channel="accounts",
            to=["user@example.com"],
            subject="Welcome to Madrona",
            html="<p>Welcome!</p>",
            text="Welcome!",
        )

        assert result is True
        mock_ses_client.send_email.assert_called_once()
        call_args = mock_ses_client.send_email.call_args[1]

        assert call_args["FromEmailAddress"] == accounts_from()
        assert call_args["Destination"]["ToAddresses"] == ["user@example.com"]
        assert call_args["Content"]["Simple"]["Subject"]["Data"] == "Welcome to Madrona"
        assert call_args["Content"]["Simple"]["Body"]["Html"]["Data"] == "<p>Welcome!</p>"
        assert call_args["Content"]["Simple"]["Body"]["Text"]["Data"] == "Welcome!"

    @patch("app.services.email_event_service.check_email_deliverable", return_value=True)
    def test_send_email_notifications_channel(self, mock_deliverable, email_service, mock_ses_client):
        """Test sending email via notifications channel."""
        result = email_service.send_email(
            channel="notifications",
            to=["admin@example.com"],
            subject="Run Completed",
            html="<p>Run completed successfully</p>",
            text="Run completed successfully",
        )

        assert result is True
        mock_ses_client.send_email.assert_called_once()
        call_args = mock_ses_client.send_email.call_args[1]

        assert call_args["FromEmailAddress"] == notifications_from()

    @patch("app.services.email_event_service.check_email_deliverable", return_value=True)
    def test_send_email_multiple_recipients(self, mock_deliverable, email_service, mock_ses_client):
        """Test sending email to multiple recipients."""
        recipients = ["user1@example.com", "user2@example.com", "user3@example.com"]

        result = email_service.send_email(
            channel="notifications",
            to=recipients,
            subject="Test",
            html="<p>Test</p>",
            text="Test",
        )

        assert result is True
        call_args = mock_ses_client.send_email.call_args[1]
        assert call_args["Destination"]["ToAddresses"] == recipients

    @patch("app.services.email_event_service.check_email_deliverable", return_value=True)
    def test_send_email_with_reply_to(self, mock_deliverable, email_service, mock_ses_client):
        """Test sending email with reply-to addresses."""
        result = email_service.send_email(
            channel="accounts",
            to=["user@example.com"],
            subject="Test",
            html="<p>Test</p>",
            text="Test",
            reply_to=["support@example.com", "noreply@example.com"],
        )

        assert result is True
        call_args = mock_ses_client.send_email.call_args[1]
        assert call_args["ReplyToAddresses"] == ["support@example.com", "noreply@example.com"]

    @patch("app.services.email_event_service.check_email_deliverable", return_value=True)
    def test_send_email_with_tags(self, mock_deliverable, email_service, mock_ses_client):
        """Test sending email with SES tags."""
        result = email_service.send_email(
            channel="notifications",
            to=["user@example.com"],
            subject="Test",
            html="<p>Test</p>",
            text="Test",
            tags={"run_id": "123", "status": "completed", "environment": "production"},
        )

        assert result is True
        call_args = mock_ses_client.send_email.call_args[1]

        tags = call_args["EmailTags"]
        assert len(tags) == 3
        tag_dict = {tag["Name"]: tag["Value"] for tag in tags}
        assert tag_dict["run_id"] == "123"
        assert tag_dict["status"] == "completed"
        assert tag_dict["environment"] == "production"

    @patch("app.services.email_event_service.check_email_deliverable", return_value=True)
    def test_send_email_sanitizes_unsafe_tag_values(
        self, mock_deliverable, email_service, mock_ses_client
    ):
        """SES MessageTag values must match [A-Za-z0-9_\\-.@]+. Freeform
        caller values (most often org_name) frequently contain spaces or
        punctuation; without sanitization, the whole send 400s with
        `Invalid tag value <Test Demo>`. Sanitize at the SES boundary."""
        result = email_service.send_email(
            channel="accounts",
            to=["user@example.com"],
            subject="Test",
            html="<p>Test</p>",
            text="Test",
            tags={
                "type": "welcome",
                "organization": "Test Demo Museum, Inc.",  # spaces + comma + period
                "bad key!": "ok-value",                     # bad chars in name too
            },
        )

        assert result is True
        call_args = mock_ses_client.send_email.call_args[1]
        tag_dict = {t["Name"]: t["Value"] for t in call_args["EmailTags"]}
        # Organization name with spaces and punctuation is now SES-safe.
        assert tag_dict["organization"] == "Test_Demo_Museum__Inc."
        # The bad characters in the key are also sanitized.
        assert "bad_key_" in tag_dict
        # Untouched keys/values are unchanged.
        assert tag_dict["type"] == "welcome"

    def test_send_email_when_disabled(self, email_service, mock_ses_client):
        """Test that emails are not sent when EMAIL_ENABLED is False."""
        email_service.settings.email_enabled = False

        result = email_service.send_email(
            channel="accounts",
            to=["user@example.com"],
            subject="Test",
            html="<p>Test</p>",
            text="Test",
        )

        assert result is True
        mock_ses_client.send_email.assert_not_called()

    @patch("app.services.email_event_service.check_email_deliverable", return_value=True)
    def test_send_email_ses_client_error(self, mock_deliverable, email_service, mock_ses_client):
        """Test handling of SES client errors."""
        mock_ses_client.send_email.side_effect = ClientError(
            {"Error": {"Code": "MessageRejected", "Message": "Email address not verified"}},
            "SendEmail",
        )

        result = email_service.send_email(
            channel="accounts",
            to=["invalid@example.com"],
            subject="Test",
            html="<p>Test</p>",
            text="Test",
        )

        assert result is False

    @patch("app.services.email_event_service.check_email_deliverable", return_value=True)
    def test_send_email_unexpected_error(self, mock_deliverable, email_service, mock_ses_client):
        """Test handling of unexpected errors."""
        mock_ses_client.send_email.side_effect = Exception("Unexpected error")

        result = email_service.send_email(
            channel="notifications",
            to=["user@example.com"],
            subject="Test",
            html="<p>Test</p>",
            text="Test",
        )

        assert result is False

    def test_get_from_address_accounts(self, email_service):
        """Test getting from address for accounts channel."""
        from_address = email_service._get_from_address("accounts")
        assert from_address == accounts_from()

    def test_get_from_address_notifications(self, email_service):
        """Test getting from address for notifications channel."""
        from_address = email_service._get_from_address("notifications")
        assert from_address == notifications_from()

    def test_get_from_address_invalid_channel(self, email_service):
        """Test that invalid channel raises ValueError."""
        with pytest.raises(ValueError, match="Unknown email channel"):
            email_service._get_from_address("invalid")

    def test_lazy_client_initialization(self, email_service):
        """Test that SES client is only created when accessed."""
        # Client should not exist yet
        assert email_service._client is None

        with patch("boto3.client") as mock_boto_client:
            mock_boto_client.return_value = Mock()
            client = email_service.client

            assert client is not None
            mock_boto_client.assert_called_once_with(
                "sesv2",
                region_name=email_service.settings.aws_region,
            )

    @patch("app.services.email_event_service.check_email_deliverable", return_value=True)
    def test_send_email_without_optional_params(self, mock_deliverable, email_service, mock_ses_client):
        """Test sending email without optional parameters (reply_to, tags)."""
        result = email_service.send_email(
            channel="accounts",
            to=["user@example.com"],
            subject="Simple Email",
            html="<p>Simple</p>",
            text="Simple",
        )

        assert result is True
        call_args = mock_ses_client.send_email.call_args[1]

        # Optional parameters should not be in the call
        assert "ReplyToAddresses" not in call_args
        assert "EmailTags" not in call_args

    @patch("app.services.email_event_service.check_email_deliverable")
    def test_send_email_filters_undeliverable(self, mock_deliverable, email_service, mock_ses_client):
        """Test that undeliverable emails are filtered out."""
        # active@example.com is deliverable, bounced@example.com is not
        def side_effect(email):
            return email == "active@example.com"

        mock_deliverable.side_effect = side_effect

        result = email_service.send_email(
            channel="notifications",
            to=["active@example.com", "bounced@example.com"],
            subject="Test",
            html="<p>Test</p>",
            text="Test",
        )

        assert result is True
        call_args = mock_ses_client.send_email.call_args[1]
        assert call_args["Destination"]["ToAddresses"] == ["active@example.com"]

    @patch("app.services.email_event_service.check_email_deliverable", return_value=False)
    def test_send_email_returns_false_all_undeliverable(self, mock_deliverable, email_service, mock_ses_client):
        """Test returns False when all recipients are undeliverable."""
        result = email_service.send_email(
            channel="notifications",
            to=["bounced@example.com"],
            subject="Test",
            html="<p>Test</p>",
            text="Test",
        )

        assert result is False
        mock_ses_client.send_email.assert_not_called()


class TestEmailDeliverability:
    """Tests for email deliverability checking via the service layer."""

    def test_email_service_skips_bounced_emails(self, db_session):
        """Test that EmailService filters out bounced email addresses."""
        from app.models import User

        active_user = User(email="active@example.com", email_status="active", status="active")
        bounced_user = User(email="bounced@example.com", email_status="bounced", status="active")
        complaint_user = User(email="complaint@example.com", email_status="complaint", status="active")

        db_session.add_all([active_user, bounced_user, complaint_user])
        db_session.commit()

        # Mock SES client
        mock_ses = MagicMock()
        mock_ses.send_email.return_value = {"MessageId": "test-123"}

        with patch("boto3.client", return_value=mock_ses):
            email_service = EmailService()
            email_service.settings.email_enabled = True

            result = email_service.send_email(
                channel="notifications",
                to=["active@example.com", "bounced@example.com", "complaint@example.com"],
                subject="Test",
                html="<p>Test</p>",
                text="Test",
            )

            assert result is True

            # Only active email should be sent to
            call_args = mock_ses.send_email.call_args[1]
            recipients = call_args["Destination"]["ToAddresses"]
            assert recipients == ["active@example.com"]
            assert "bounced@example.com" not in recipients
            assert "complaint@example.com" not in recipients

    def test_email_service_returns_false_when_no_deliverable_recipients(self, db_session):
        """Test returns False when all recipients are undeliverable."""
        from app.models import User

        bounced_user = User(email="bounced@example.com", email_status="bounced", status="active")
        db_session.add(bounced_user)
        db_session.commit()

        with patch("boto3.client", return_value=MagicMock()):
            email_service = EmailService()
            email_service.settings.email_enabled = True

            result = email_service.send_email(
                channel="notifications",
                to=["bounced@example.com"],
                subject="Test",
                html="<p>Test</p>",
                text="Test",
            )

            assert result is False

    def test_check_email_deliverable_unknown_email(self, db_session):
        """Test that unknown emails are considered deliverable (fail open)."""
        from app.services.email_event_service import check_email_deliverable

        result = check_email_deliverable("unknown@example.com")
        assert result is True

    def test_check_email_deliverable_active_email(self, db_session):
        """Test that active emails are deliverable."""
        from app.models import User
        from app.services.email_event_service import check_email_deliverable

        user = User(email="active-check@example.com", email_status="active", status="active")
        db_session.add(user)
        db_session.commit()

        result = check_email_deliverable("active-check@example.com")
        assert result is True

    def test_check_email_deliverable_bounced_email(self, db_session):
        """Test that bounced emails are not deliverable."""
        from app.models import User
        from app.services.email_event_service import check_email_deliverable

        user = User(email="bounced-check@example.com", email_status="bounced", status="active")
        db_session.add(user)
        db_session.commit()

        result = check_email_deliverable("bounced-check@example.com")
        assert result is False

    def test_check_email_deliverable_complaint_email(self, db_session):
        """Test that complaint emails are not deliverable."""
        from app.models import User
        from app.services.email_event_service import check_email_deliverable

        user = User(email="complaint-check@example.com", email_status="complaint", status="active")
        db_session.add(user)
        db_session.commit()

        result = check_email_deliverable("complaint-check@example.com")
        assert result is False
