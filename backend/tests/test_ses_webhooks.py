"""
Tests for AWS SES/SNS webhook handling.
"""
import json
import pytest
from unittest.mock import patch, MagicMock
from app.models import User, EmailEvent


@pytest.fixture
def bounce_notification():
    """Sample SNS notification for SES bounce event."""
    return {
        "Type": "Notification",
        "MessageId": "sns-msg-123",
        "TopicArn": "arn:aws:sns:us-east-1:123456789:ses-bounces",
        "Subject": "Amazon SES Email Event Notification",
        "Message": json.dumps({
            "eventType": "Bounce",
            "bounce": {
                "bounceType": "Permanent",
                "bounceSubType": "General",
                "bouncedRecipients": [
                    {"emailAddress": "bounced@example.com"}
                ],
                "timestamp": "2024-01-01T12:00:00.000Z",
                "feedbackId": "feedback-123",
            },
            "mail": {
                "timestamp": "2024-01-01T11:59:00.000Z",
                "source": "noreply@example.com",
                "messageId": "ses-msg-456",
                "destination": ["bounced@example.com"],
            },
        }),
        "Timestamp": "2024-01-01T12:00:00Z",
        "SignatureVersion": "1",
        "Signature": "fake-signature",
        "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
        "UnsubscribeURL": "https://sns.us-east-1.amazonaws.com/unsubscribe",
    }


@pytest.fixture
def complaint_notification():
    """Sample SNS notification for SES complaint event."""
    return {
        "Type": "Notification",
        "MessageId": "sns-msg-456",
        "TopicArn": "arn:aws:sns:us-east-1:123456789:ses-complaints",
        "Subject": "Amazon SES Email Event Notification",
        "Message": json.dumps({
            "eventType": "Complaint",
            "complaint": {
                "complainedRecipients": [
                    {"emailAddress": "complainer@example.com"}
                ],
                "timestamp": "2024-01-01T12:00:00.000Z",
                "feedbackId": "feedback-789",
                "complaintFeedbackType": "abuse",
            },
            "mail": {
                "timestamp": "2024-01-01T11:59:00.000Z",
                "source": "noreply@example.com",
                "messageId": "ses-msg-789",
                "destination": ["complainer@example.com"],
            },
        }),
        "Timestamp": "2024-01-01T12:00:00Z",
        "SignatureVersion": "1",
        "Signature": "fake-signature",
        "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
        "UnsubscribeURL": "https://sns.us-east-1.amazonaws.com/unsubscribe",
    }


@pytest.fixture
def subscription_confirmation():
    """Sample SNS subscription confirmation message."""
    return {
        "Type": "SubscriptionConfirmation",
        "MessageId": "sns-msg-sub-123",
        "TopicArn": "arn:aws:sns:us-east-1:123456789:ses-bounces",
        "Message": "You have chosen to subscribe to the topic...",
        "Timestamp": "2024-01-01T12:00:00Z",
        "SignatureVersion": "1",
        "Signature": "fake-signature",
        "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
        "SubscribeURL": "https://sns.us-east-1.amazonaws.com/confirm?token=abc123",
        "Token": "abc123",
    }


@pytest.fixture
def user_with_active_email(db_session):
    """Create a test user with active email status."""
    user = User(
        email="bounced@example.com",
        email_status="active",
        status="active",
    )
    db_session.add(user)
    db_session.commit()
    return user


class TestSESWebhooks:
    """Tests for SES webhook endpoint."""

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_bounce_event_processing(
        self, mock_verify, client, db_session, bounce_notification, user_with_active_email
    ):
        """Test that bounce events are recorded and user email_status updated."""
        mock_verify.return_value = True

        response = client.post(
            "/api/webhooks/ses",
            json=bounce_notification,
            content_type="application/json",
        )

        assert response.status_code == 200
        assert response.json["status"] == "bounce processed"

        # Check EmailEvent created
        event = db_session.query(EmailEvent).filter_by(email="bounced@example.com").first()
        assert event is not None
        assert event.event_type == "bounce"
        assert event.bounce_type == "Permanent"
        assert event.bounce_subtype == "General"
        assert event.message_id == "ses-msg-456"
        assert event.sns_message_id == "sns-msg-123"

        # Check user email_status updated
        user = db_session.query(User).filter_by(email="bounced@example.com").first()
        assert user.email_status == "bounced"

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_complaint_event_processing(
        self, mock_verify, client, db_session, complaint_notification
    ):
        """Test that complaint events are recorded and user email_status updated."""
        mock_verify.return_value = True

        # Create user
        user = User(
            email="complainer@example.com",
            email_status="active",
            status="active",
        )
        db_session.add(user)
        db_session.commit()

        response = client.post(
            "/api/webhooks/ses",
            json=complaint_notification,
            content_type="application/json",
        )

        assert response.status_code == 200
        assert response.json["status"] == "complaint processed"

        # Check EmailEvent created
        event = db_session.query(EmailEvent).filter_by(
            email="complainer@example.com"
        ).first()
        assert event is not None
        assert event.event_type == "complaint"
        assert event.complaint_feedback_type == "abuse"
        assert event.message_id == "ses-msg-789"
        assert event.sns_message_id == "sns-msg-456"

        # Check user email_status updated
        user = db_session.query(User).filter_by(email="complainer@example.com").first()
        assert user.email_status == "complaint"

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_duplicate_bounce_event_ignored(
        self, mock_verify, client, db_session, bounce_notification, user_with_active_email
    ):
        """Test that duplicate bounce events (same sns_message_id) are ignored."""
        mock_verify.return_value = True

        # Process event twice
        client.post("/api/webhooks/ses", json=bounce_notification)
        response = client.post("/api/webhooks/ses", json=bounce_notification)

        assert response.status_code == 200

        # Should only have one event
        events = db_session.query(EmailEvent).filter_by(
            email="bounced@example.com"
        ).all()
        assert len(events) == 1

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_transient_bounce_does_not_flag_user(
        self, mock_verify, client, db_session, bounce_notification, user_with_active_email
    ):
        """Test that transient bounces don't update user email_status."""
        mock_verify.return_value = True

        # Modify to transient bounce
        message = json.loads(bounce_notification["Message"])
        message["bounce"]["bounceType"] = "Transient"
        bounce_notification["Message"] = json.dumps(message)

        response = client.post(
            "/api/webhooks/ses",
            json=bounce_notification,
            content_type="application/json",
        )

        assert response.status_code == 200

        # Check event recorded but user status unchanged
        event = db_session.query(EmailEvent).filter_by(
            email="bounced@example.com"
        ).first()
        assert event.bounce_type == "Transient"

        user = db_session.query(User).filter_by(email="bounced@example.com").first()
        assert user.email_status == "active"  # Should remain active

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_subscription_confirmation(
        self, mock_verify, client, subscription_confirmation
    ):
        """Test that subscription confirmation returns subscribe URL."""
        mock_verify.return_value = True

        response = client.post(
            "/api/webhooks/ses",
            json=subscription_confirmation,
            content_type="application/json",
        )

        assert response.status_code == 200
        assert "subscribe_url" in response.json
        assert response.json["subscribe_url"] == subscription_confirmation["SubscribeURL"]

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_invalid_signature_rejected(
        self, mock_verify, client, bounce_notification
    ):
        """Test that messages with invalid signatures are rejected."""
        mock_verify.return_value = False

        response = client.post(
            "/api/webhooks/ses",
            json=bounce_notification,
            content_type="application/json",
        )

        assert response.status_code == 401
        _e = response.json.get("error") if isinstance(response.json, dict) else None
        assert "Invalid signature" in ((_e.get("message", "") if isinstance(_e, dict) else str(_e or "")))

    def test_missing_type_field(self, client, bounce_notification):
        """Test that messages without Type field are rejected."""
        del bounce_notification["Type"]

        response = client.post(
            "/api/webhooks/ses",
            json=bounce_notification,
            content_type="application/json",
        )

        assert response.status_code in (400, 422)
        _e = response.json.get("error") if isinstance(response.json, dict) else None
        assert "Missing Type field" in ((_e.get("message", "") if isinstance(_e, dict) else str(_e or "")))

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_unknown_event_type_rejected(
        self, mock_verify, client, bounce_notification
    ):
        """Test that unknown SES event types are rejected."""
        mock_verify.return_value = True

        # Change to unknown event type
        message = json.loads(bounce_notification["Message"])
        message["eventType"] = "UnknownEvent"
        bounce_notification["Message"] = json.dumps(message)

        response = client.post(
            "/api/webhooks/ses",
            json=bounce_notification,
            content_type="application/json",
        )

        assert response.status_code in (400, 422)
        _e = response.json.get("error") if isinstance(response.json, dict) else None
        assert "Unknown event type" in ((_e.get("message", "") if isinstance(_e, dict) else str(_e or "")))

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_malformed_message_json(
        self, mock_verify, client, bounce_notification
    ):
        """Test that malformed SES message JSON is rejected."""
        mock_verify.return_value = True

        # Set invalid JSON in Message field
        bounce_notification["Message"] = "not valid json"

        response = client.post(
            "/api/webhooks/ses",
            json=bounce_notification,
            content_type="application/json",
        )

        assert response.status_code in (400, 422)
        _e = response.json.get("error") if isinstance(response.json, dict) else None
        assert "Invalid SES message JSON" in ((_e.get("message", "") if isinstance(_e, dict) else str(_e or "")))

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_empty_message_rejected(self, mock_verify, client):
        """Test that empty messages are rejected."""
        response = client.post(
            "/api/webhooks/ses",
            json={},
            content_type="application/json",
        )

        assert response.status_code in (400, 422)

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_bounce_for_nonexistent_user(
        self, mock_verify, client, db_session, bounce_notification
    ):
        """Test that bounces for non-existent users still record event."""
        mock_verify.return_value = True

        response = client.post(
            "/api/webhooks/ses",
            json=bounce_notification,
            content_type="application/json",
        )

        assert response.status_code == 200

        # Event should be recorded even if user doesn't exist
        event = db_session.query(EmailEvent).filter_by(
            email="bounced@example.com"
        ).first()
        assert event is not None
        assert event.event_type == "bounce"

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature")
    def test_unknown_message_type_rejected(
        self, mock_verify, client
    ):
        """Test that unknown SNS message types are rejected."""
        mock_verify.return_value = True

        response = client.post(
            "/api/webhooks/ses",
            json={
                "Type": "UnknownType",
                "MessageId": "msg-123",
                "SignatureVersion": "1",
                "Signature": "fake",
                "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
            },
            content_type="application/json",
        )

        assert response.status_code in (400, 422)
        _e = response.json.get("error") if isinstance(response.json, dict) else None
        assert "Unknown message type" in ((_e.get("message", "") if isinstance(_e, dict) else str(_e or "")))
