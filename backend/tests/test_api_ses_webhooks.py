"""
Smoke tests for the SES/SNS webhook API (/api/webhooks/ses).

These endpoints receive AWS SNS notifications for SES bounce and complaint events.
No Bearer auth is required -- SNS signature verification is the security mechanism.
All tests mock verify_sns_signature to bypass real AWS certificate validation.
"""

import json
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

WEBHOOK_URL = "/api/webhooks/ses"


def _post_webhook(client, payload):
    """POST a JSON payload to the SES webhook endpoint."""
    return client.post(
        WEBHOOK_URL,
        data=json.dumps(payload),
        content_type="application/json",
    )


# ---------------------------------------------------------------------------
# Helpers to build realistic SNS / SES payloads
# ---------------------------------------------------------------------------

def _sns_notification(ses_message_dict, message_id=None):
    """Build a complete SNS Notification envelope wrapping an SES event."""
    return {
        "Type": "Notification",
        "MessageId": message_id or str(uuid4()),
        "TopicArn": "arn:aws:sns:us-east-1:123456789012:ses-bounces",
        "Message": json.dumps(ses_message_dict),
        "Timestamp": "2026-02-14T00:00:00.000Z",
        "Signature": "FAKE_SIG",
        "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
        "SignatureVersion": "1",
    }


def _bounce_ses_message(email="bounced@example.com", bounce_type="Permanent", bounce_subtype="General"):
    """Build a minimal SES bounce event body."""
    return {
        "eventType": "Bounce",
        "bounce": {
            "bounceType": bounce_type,
            "bounceSubType": bounce_subtype,
            "bouncedRecipients": [{"emailAddress": email}],
        },
        "mail": {"messageId": str(uuid4())},
    }


def _complaint_ses_message(email="complainer@example.com", feedback_type="abuse"):
    """Build a minimal SES complaint event body."""
    return {
        "eventType": "Complaint",
        "complaint": {
            "complaintFeedbackType": feedback_type,
            "complainedRecipients": [{"emailAddress": email}],
        },
        "mail": {"messageId": str(uuid4())},
    }


def _subscription_confirmation(subscribe_url="https://sns.us-east-1.amazonaws.com/confirm?token=abc"):
    """Build an SNS SubscriptionConfirmation message."""
    return {
        "Type": "SubscriptionConfirmation",
        "MessageId": str(uuid4()),
        "TopicArn": "arn:aws:sns:us-east-1:123456789012:ses-bounces",
        "Token": "abc123",
        "Message": "You have chosen to subscribe...",
        "SubscribeURL": subscribe_url,
        "Timestamp": "2026-02-14T00:00:00.000Z",
        "Signature": "FAKE_SIG",
        "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
        "SignatureVersion": "1",
    }


# ============================================================================
# Empty / malformed payloads
# ============================================================================


class TestWebhookValidation:
    def test_empty_body_returns_400(self, client):
        """POST with an empty body is a client error, not a server fault.

        This asserted 500 and so documented the defect rather than the
        requirement: the handler's `except Exception -> 500` swallowed the
        JSONDecodeError that the app-level handler turns into a 400. The
        endpoint is public and unauthenticated, so any empty or malformed POST
        reported itself as a server fault. The sibling test below already
        expected 400 for a `null` body.
        """
        resp = client.post(WEBHOOK_URL, data="", content_type="application/json")
        assert resp.status_code == 400
        body = resp.get_json()
        assert "Invalid JSON" in str(body)

    def test_null_json_body_returns_400(self, client):
        """POST with JSON null body returns 400 (parses to None, caught by empty check)."""
        resp = client.post(WEBHOOK_URL, data="null", content_type="application/json")
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Empty message" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_missing_type_field_returns_400(self, _mock_sig, client):
        """Payload without 'Type' should be rejected."""
        resp = _post_webhook(client, {"MessageId": "abc"})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Missing Type field" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=False)
    def test_invalid_signature_returns_401(self, _mock_sig, client):
        """When signature verification fails, return 401."""
        payload = _sns_notification(_bounce_ses_message())
        resp = _post_webhook(client, payload)
        assert resp.status_code == 401
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid signature" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))


# ============================================================================
# Subscription confirmation
# ============================================================================


class TestSubscriptionConfirmation:
    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_subscription_confirmation_returns_200(self, _mock_sig, client):
        """SubscriptionConfirmation with SubscribeURL should return 200."""
        payload = _subscription_confirmation()
        resp = _post_webhook(client, payload)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "subscribe_url" in data
        assert data["subscribe_url"] == payload["SubscribeURL"]

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_subscription_confirmation_missing_url_returns_400(self, _mock_sig, client):
        """SubscriptionConfirmation without SubscribeURL should return 400."""
        payload = _subscription_confirmation()
        del payload["SubscribeURL"]
        resp = _post_webhook(client, payload)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Missing SubscribeURL" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))


# ============================================================================
# Bounce notifications
# ============================================================================


class TestBounceNotification:
    @patch("app.fastapi_app.routers.email_webhooks.process_bounce")
    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_bounce_processed_successfully(self, _mock_sig, mock_process, client):
        """Valid bounce notification should call process_bounce and return 200."""
        ses_msg = _bounce_ses_message()
        payload = _sns_notification(ses_msg)
        resp = _post_webhook(client, payload)
        assert resp.status_code == 200
        assert "bounce processed" in resp.get_json()["status"]
        mock_process.assert_called_once_with(ses_msg, payload["MessageId"])

    @patch("app.fastapi_app.routers.email_webhooks.process_bounce")
    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_bounce_old_notification_type_format(self, _mock_sig, mock_process, client):
        """Older SES format uses 'notificationType' instead of 'eventType'."""
        ses_msg = _bounce_ses_message()
        # Replace eventType with notificationType (legacy format)
        del ses_msg["eventType"]
        ses_msg["notificationType"] = "Bounce"
        payload = _sns_notification(ses_msg)
        resp = _post_webhook(client, payload)
        assert resp.status_code == 200
        assert "bounce processed" in resp.get_json()["status"]
        mock_process.assert_called_once()


# ============================================================================
# Complaint notifications
# ============================================================================


class TestComplaintNotification:
    @patch("app.fastapi_app.routers.email_webhooks.process_complaint")
    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_complaint_processed_successfully(self, _mock_sig, mock_process, client):
        """Valid complaint notification should call process_complaint and return 200."""
        ses_msg = _complaint_ses_message()
        payload = _sns_notification(ses_msg)
        resp = _post_webhook(client, payload)
        assert resp.status_code == 200
        assert "complaint processed" in resp.get_json()["status"]
        mock_process.assert_called_once_with(ses_msg, payload["MessageId"])


# ============================================================================
# Unknown / unsupported types
# ============================================================================


class TestUnknownTypes:
    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_unknown_sns_message_type_returns_400(self, _mock_sig, client):
        """An SNS message with an unrecognized Type should return 400."""
        payload = {
            "Type": "UnsubscribeConfirmation",
            "MessageId": str(uuid4()),
            "Signature": "FAKE",
            "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
            "SignatureVersion": "1",
        }
        resp = _post_webhook(client, payload)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Unknown message type" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_unknown_ses_event_type_returns_400(self, _mock_sig, client):
        """SES event with unrecognized eventType should return 400."""
        ses_msg = {"eventType": "Delivery"}
        payload = _sns_notification(ses_msg)
        resp = _post_webhook(client, payload)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Unknown event type" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_notification_missing_message_field_returns_400(self, _mock_sig, client):
        """Notification envelope without 'Message' field should return 400."""
        payload = {
            "Type": "Notification",
            "MessageId": str(uuid4()),
            "Signature": "FAKE",
            "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
            "SignatureVersion": "1",
        }
        resp = _post_webhook(client, payload)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Missing Message field" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_notification_invalid_message_json_returns_400(self, _mock_sig, client):
        """If the nested Message is not valid JSON, return 400."""
        payload = {
            "Type": "Notification",
            "MessageId": str(uuid4()),
            "Message": "this is {not valid json",
            "Signature": "FAKE",
            "SigningCertURL": "https://sns.us-east-1.amazonaws.com/cert.pem",
            "SignatureVersion": "1",
        }
        resp = _post_webhook(client, payload)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid SES message JSON" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    @patch("app.fastapi_app.routers.email_webhooks.verify_sns_signature", return_value=True)
    def test_notification_missing_event_type_returns_400(self, _mock_sig, client):
        """SES message with neither eventType nor notificationType should return 400."""
        ses_msg = {"bounce": {"bounceType": "Permanent"}}  # no eventType
        payload = _sns_notification(ses_msg)
        resp = _post_webhook(client, payload)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Missing eventType" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))
