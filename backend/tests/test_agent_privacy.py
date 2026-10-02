"""
Tests for agent privacy infrastructure — PII scrubbing, server-minted sessions,
retention, GDPR delete, email consent, and access control.
"""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch
from uuid import uuid4

from app.services.agent_retention import (
    extract_pii,
    scrub_pii,
    scrub_echoed_pii,
    serialize_message,
    purge_expired_conversations,
    gdpr_delete_visitor_data,
)


# ═══════════════════════════════════════════════════════════════════
# PII Extraction and Scrubbing
# ═══════════════════════════════════════════════════════════════════


class TestPIIExtraction:
    """Tests for extract_pii."""

    def test_extracts_email(self):
        pii = extract_pii("My email is john@example.com, thanks!")
        assert "john@example.com" in pii

    def test_extracts_phone(self):
        pii = extract_pii("Call me at 555-123-4567 please")
        assert "555-123-4567" in pii

    def test_extracts_ssn(self):
        pii = extract_pii("My SSN is 123-45-6789")
        assert "123-45-6789" in pii

    def test_extracts_credit_card(self):
        pii = extract_pii("Card number 4111 1111 1111 1111")
        assert "4111 1111 1111 1111" in pii

    def test_multiple_pii(self):
        pii = extract_pii("Email john@example.com, phone 555-123-4567")
        assert len(pii) >= 2

    def test_no_pii(self):
        pii = extract_pii("Tell me about this painting")
        assert len(pii) == 0


class TestPIIScrubbing:
    """Tests for scrub_pii (storage scrubbing)."""

    def test_storage_scrub_email(self):
        result = scrub_pii("my email is john@example.com")
        assert "john@example.com" not in result
        assert "[EMAIL]" in result

    def test_storage_scrub_phone(self):
        result = scrub_pii("call me at 555-123-4567")
        assert "555-123-4567" not in result
        assert "[PHONE]" in result

    def test_storage_scrub_preserves_non_pii(self):
        result = scrub_pii("Tell me about this painting from 1872")
        assert result == "Tell me about this painting from 1872"


class TestEchoedPIIScrubbing:
    """Tests for scrub_echoed_pii (outbound scrubbing)."""

    def test_echoed_email_scrubbed(self):
        """Visitor email echoed by assistant is scrubbed."""
        visitor_pii = {"john@example.com"}
        result = scrub_echoed_pii(
            "I'll send the info to john@example.com as requested.",
            visitor_pii,
        )
        assert "john@example.com" not in result
        assert "[EMAIL]" in result

    def test_museum_phone_passes(self):
        """Museum phone from tool results is NOT scrubbed (not in visitor_pii)."""
        visitor_pii = {"john@example.com"}  # Visitor mentioned their email, not the museum phone
        result = scrub_echoed_pii(
            "You can reach the museum at 212-555-0100 for more information.",
            visitor_pii,
        )
        assert "212-555-0100" in result  # Museum phone passes through

    def test_staff_unscrubbed(self):
        """Staff messages: empty pii set → nothing scrubbed."""
        result = scrub_echoed_pii(
            "Contact john@example.com for details.",
            set(),  # No visitor PII to scrub
        )
        assert "john@example.com" in result

    def test_multiple_pii_scrubbed(self):
        """Multiple PII values echoed → all scrubbed."""
        visitor_pii = {"john@example.com", "555-123-4567"}
        result = scrub_echoed_pii(
            "Sending to john@example.com and calling 555-123-4567.",
            visitor_pii,
        )
        assert "john@example.com" not in result
        assert "555-123-4567" not in result


# ═══════════════════════════════════════════════════════════════════
# Message Serialization and Access Control
# ═══════════════════════════════════════════════════════════════════


class TestSerializeMessage:
    """Tests for serialize_message access control."""

    def _make_message(self, meta=None):
        msg = MagicMock()
        msg.message_id = uuid4()
        msg.conversation_id = uuid4()
        msg.role = "assistant"
        msg.content = "This is a response."
        msg.model = "qwen2.5:14b"
        msg.created_at = datetime.now(timezone.utc)
        msg.meta = meta
        return msg

    def test_admin_no_original_text(self):
        """Non-owner admin: assistant_text_original is redacted."""
        msg = self._make_message(meta={
            "guardrails": {"passed": False, "blocked": True},
            "assistant_text_original": "The uncensored original text here",
        })
        result = serialize_message(msg, requester_role="member")
        assert result["meta"]["assistant_text_original"] == "[redacted]"

    def test_owner_sees_original(self):
        """Org owner: assistant_text_original is visible."""
        msg = self._make_message(meta={
            "guardrails": {"passed": False, "blocked": True},
            "assistant_text_original": "The uncensored original text here",
        })
        result = serialize_message(msg, requester_role="owner")
        assert result["meta"]["assistant_text_original"] == "The uncensored original text here"

    def test_no_meta_no_error(self):
        """Message with no meta → serializes cleanly."""
        msg = self._make_message(meta=None)
        result = serialize_message(msg, requester_role="member")
        assert "meta" not in result

    def test_meta_without_original_unmodified(self):
        """Meta without assistant_text_original → no redaction needed."""
        msg = self._make_message(meta={
            "guardrails": {"passed": True, "warnings": []},
        })
        result = serialize_message(msg, requester_role="member")
        assert "assistant_text_original" not in result["meta"]


# ═══════════════════════════════════════════════════════════════════
# Retention Purge
# ═══════════════════════════════════════════════════════════════════


class TestRetentionPurge:
    """Tests for purge_expired_conversations."""

    @patch("app.services.agent_retention.get_settings")
    def test_retention_purge_deletes_expired(self, mock_settings):
        """Conversations beyond retention window are deleted."""
        settings = MagicMock()
        settings.agent_visitor_retention_days = 90
        settings.agent_staff_retention_days = 365
        mock_settings.return_value = settings

        # Create mock expired conversations
        expired_conv = MagicMock()
        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.all.return_value = [expired_conv]

        purge_expired_conversations(session=mock_session)
        assert mock_session.delete.called

    @patch("app.services.agent_retention.get_settings")
    def test_retention_window_respected(self, mock_settings):
        """Retention with 0 days = keep forever."""
        settings = MagicMock()
        settings.agent_visitor_retention_days = 0
        settings.agent_staff_retention_days = 0
        mock_settings.return_value = settings

        mock_session = MagicMock()
        counts = purge_expired_conversations(session=mock_session)
        assert counts["visitor"] == 0
        assert counts["staff"] == 0


# ═══════════════════════════════════════════════════════════════════
# GDPR Delete
# ═══════════════════════════════════════════════════════════════════


class TestGDPRDelete:
    """Tests for gdpr_delete_visitor_data."""

    def test_gdpr_delete_cascades(self):
        """GDPR delete removes all conversations for a session."""
        org_id = uuid4()
        session_id = "test-session-token"

        conv1 = MagicMock()
        conv2 = MagicMock()
        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.all.return_value = [conv1, conv2]

        count = gdpr_delete_visitor_data(org_id, session_id, session=mock_session)
        assert count == 2
        assert mock_session.delete.call_count == 2
        mock_session.commit.assert_called_once()

    def test_gdpr_idempotent(self):
        """GDPR delete with no matching data returns 0, no commit."""
        org_id = uuid4()
        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.all.return_value = []

        count = gdpr_delete_visitor_data(org_id, "nonexistent-session", session=mock_session)
        assert count == 0
        mock_session.commit.assert_not_called()


# ═══════════════════════════════════════════════════════════════════
# Email Consent
# ═══════════════════════════════════════════════════════════════════


class TestEmailConsent:
    """Tests for email consent gating in visitor service."""

    def test_email_consent_required(self):
        """Email without consent → not stored."""
        from app.services.visitor_service import VisitorService

        visitor = MagicMock()
        visitor.email_consent = False
        visitor.visitor_id = uuid4()
        # Real Visitor doesn't have an .email attribute unless explicitly set;
        # clear the auto-generated MagicMock attr so we can verify it isn't set.
        del visitor.email

        mock_session = MagicMock()
        svc = VisitorService(session=mock_session)
        svc.identify_visitor(visitor, email="john@example.com")

        # email should NOT have been set
        assert not hasattr(visitor, "email") or visitor.email != "john@example.com"

    def test_email_consent_stored(self):
        """Email with consent → stored."""
        from app.services.visitor_service import VisitorService

        visitor = MagicMock()
        visitor.email_consent = True
        visitor.visitor_id = uuid4()

        mock_session = MagicMock()
        svc = VisitorService(session=mock_session)
        svc.identify_visitor(visitor, email="john@example.com")

        assert visitor.email == "john@example.com"


# ═══════════════════════════════════════════════════════════════════
# Server-Minted Sessions (Cookie)
# ═══════════════════════════════════════════════════════════════════


class TestServerMintedSession:
    """Tests for server-minted session tokens and cookie handling."""

    def test_session_token_minted(self):
        """_mint_session_token returns a non-empty url-safe string."""
        from app.fastapi_app.routers.agent import _mint_session_token

        token = _mint_session_token()
        assert len(token) > 20
        # url-safe characters only
        import re
        assert re.match(r'^[A-Za-z0-9_-]+$', token)

    def test_validate_session_cookie_matches(self):
        """Double-submit validation: matching body and cookie → True."""
        from app.fastapi_app.routers.agent import _validate_session_cookie

        mock_request = MagicMock()
        mock_request.cookies = {"madrona_visitor_session": "test-token-123"}

        assert _validate_session_cookie(mock_request, "test-token-123") is True

    def test_validate_session_cookie_mismatch(self):
        """Double-submit validation: mismatched → False."""
        from app.fastapi_app.routers.agent import _validate_session_cookie

        mock_request = MagicMock()
        mock_request.cookies = {"madrona_visitor_session": "real-token"}

        assert _validate_session_cookie(mock_request, "fake-token") is False

    def test_validate_session_cookie_missing(self):
        """No cookie present → False."""
        from app.fastapi_app.routers.agent import _validate_session_cookie

        mock_request = MagicMock()
        mock_request.cookies = {}

        assert _validate_session_cookie(mock_request, "any-token") is False

    def test_cookie_constants(self):
        """Verify cookie name and max-age constants."""
        from app.fastapi_app.routers.agent import VISITOR_SESSION_COOKIE, VISITOR_SESSION_MAX_AGE

        assert VISITOR_SESSION_COOKIE == "madrona_visitor_session"
        assert VISITOR_SESSION_MAX_AGE == 86400
