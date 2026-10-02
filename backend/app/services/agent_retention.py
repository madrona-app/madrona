"""
Agent data retention and PII scrubbing.

Provides:
- PII detection and scrubbing for visitor messages (storage + outbound)
- Retention purge for conversations beyond configured window
- GDPR data deletion
"""

import re
import logging
from datetime import datetime, timezone, timedelta
from uuid import UUID

from app.config import get_settings
from app.models.agent import Conversation, Message

logger = logging.getLogger(__name__)

# --- PII patterns ---

_PII_PATTERNS = [
    (re.compile(r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b'), "[EMAIL]"),
    (re.compile(r'\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b'), "[PHONE]"),
    (re.compile(r'\b\d{3}-\d{2}-\d{4}\b'), "[SSN]"),
    (re.compile(r'\b(?:\d{4}[-\s]?){3}\d{4}\b'), "[CREDIT_CARD]"),
]


def extract_pii(text: str) -> set[str]:
    """Extract all PII values found in text."""
    found: set[str] = set()
    for pattern, _label in _PII_PATTERNS:
        for match in pattern.finditer(text):
            found.add(match.group(0))
    return found


def scrub_pii(text: str) -> str:
    """Replace all PII patterns in text with redaction labels."""
    for pattern, label in _PII_PATTERNS:
        text = pattern.sub(label, text)
    return text


def scrub_echoed_pii(assistant_text: str, visitor_pii: set[str]) -> str:
    """Scrub only PII that the visitor mentioned (echoed PII).

    Tool-sourced contact info (museum phone, email) passes through untouched.
    Only PII that appeared in the visitor's message gets scrubbed from the response.
    """
    result = assistant_text
    for pii_value in visitor_pii:
        if pii_value in result:
            # Determine the label based on which pattern matches
            for pattern, label in _PII_PATTERNS:
                if pattern.fullmatch(pii_value):
                    result = result.replace(pii_value, label)
                    break
    return result


def purge_expired_conversations(
    visitor_retention_days: int | None = None,
    staff_retention_days: int | None = None,
    session=None,
) -> dict[str, int]:
    """Purge conversations beyond their retention window.

    Returns counts of deleted conversations by persona.
    Requires a SQLAlchemy session.
    """
    if session is None:
        raise ValueError("session is required")
    sess = session
    settings = get_settings()
    v_days = visitor_retention_days or settings.agent_visitor_retention_days
    s_days = staff_retention_days or settings.agent_staff_retention_days
    now = datetime.now(timezone.utc)

    counts = {"visitor": 0, "staff": 0}

    # Visitor conversations
    if v_days > 0:
        cutoff = now - timedelta(days=v_days)
        expired = sess.query(Conversation).filter(
            Conversation.persona == "visitor",
            Conversation.created_at < cutoff,
        ).all()
        for conv in expired:
            sess.delete(conv)
        counts["visitor"] = len(expired)

    # Staff conversations
    if s_days > 0:
        cutoff = now - timedelta(days=s_days)
        expired = sess.query(Conversation).filter(
            Conversation.persona == "staff",
            Conversation.created_at < cutoff,
        ).all()
        for conv in expired:
            sess.delete(conv)
        counts["staff"] = len(expired)

    if counts["visitor"] or counts["staff"]:
        sess.commit()
        logger.info(
            "Retention purge: %d visitor, %d staff conversations deleted",
            counts["visitor"], counts["staff"],
        )

    return counts


def gdpr_delete_visitor_data(
    organization_id: UUID,
    session_id: str,
    session=None,
) -> int:
    """Delete all visitor data associated with a session (GDPR right to erasure).

    Cascading delete: Conversation → Messages.
    Returns count of deleted conversations.
    """
    if session is None:
        raise ValueError("session is required")
    sess = session
    conversations = sess.query(Conversation).filter(
        Conversation.organization_id == organization_id,
        Conversation.session_id == session_id,
        Conversation.persona == "visitor",
    ).all()

    count = len(conversations)
    for conv in conversations:
        sess.delete(conv)

    if count:
        sess.commit()
        logger.info(
            "GDPR delete: %d conversations for session in org %s",
            count, organization_id,
        )

    return count


def serialize_message(message: Message, requester_role: str = "member") -> dict:
    """Serialize a message with access control on sensitive fields.

    Only org owners (requester_role='owner') can see assistant_text_original.
    All other roles get it redacted.
    """
    data = {
        "message_id": str(message.message_id),
        "conversation_id": str(message.conversation_id),
        "role": message.role,
        "content": message.content,
        "model": message.model,
        "created_at": message.created_at.isoformat() if message.created_at else None,
    }

    if message.meta:
        meta = dict(message.meta)
        if "assistant_text_original" in meta and requester_role != "owner":
            meta["assistant_text_original"] = "[redacted]"
        data["meta"] = meta

    return data
