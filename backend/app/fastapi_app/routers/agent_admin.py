"""
Agent administration API endpoints (staff-only).

Monitoring endpoints for agent response quality and guardrail flags.

Routes:
  GET  /api/organizations/{org_id}/agent/admin/quality-stats    - Quality overview
  GET  /api/organizations/{org_id}/agent/admin/flagged-messages - Flagged messages
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import (
    AuthContext,
    check_permission_for_session,
    require_permission,
)
from app.fastapi_app.schemas.agent import (
    FlaggedMessagesResponse,
    QualityStatsResponse,
)
from app.models.agent import Conversation, Message
from app.permissions import Permission
from app.services.agent_retention import serialize_message

logger = logging.getLogger(__name__)

router = APIRouter(tags=["agent-admin"])


@router.get("/api/organizations/{organization_id}/agent/admin/quality-stats", response_model=QualityStatsResponse, summary="Get quality stats")
def get_quality_stats(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Get agent response quality statistics."""

    # Total assistant messages
    total = (
        db.query(Message)
        .join(Conversation)
        .filter(
            Conversation.organization_id == organization_id,
            Message.role == "assistant",
        )
        .count()
    )

    # Messages with guardrail warnings (metadata.guardrails.warnings is non-empty)
    flagged = db.execute(
        text("""
            SELECT COUNT(*) FROM messages m
            JOIN conversations c ON m.conversation_id = c.conversation_id
            WHERE c.organization_id = :org_id
              AND m.role = 'assistant'
              AND m.meta IS NOT NULL
              AND m.meta -> 'guardrails' -> 'warnings' IS NOT NULL
              AND jsonb_array_length(m.meta -> 'guardrails' -> 'warnings') > 0
        """),
        {"org_id": str(organization_id)},
    ).scalar() or 0

    blocked = db.execute(
        text("""
            SELECT COUNT(*) FROM messages m
            JOIN conversations c ON m.conversation_id = c.conversation_id
            WHERE c.organization_id = :org_id
              AND m.role = 'assistant'
              AND m.meta IS NOT NULL
              AND (m.meta -> 'guardrails' ->> 'blocked')::boolean = true
        """),
        {"org_id": str(organization_id)},
    ).scalar() or 0

    return {
        "total_responses": total,
        "flagged_responses": flagged,
        "blocked_responses": blocked,
        "pass_rate": round((total - flagged) / total * 100, 1) if total > 0 else 100.0,
    }


@router.get("/api/organizations/{organization_id}/agent/admin/flagged-messages", response_model=FlaggedMessagesResponse, summary="Get flagged messages")
def get_flagged_messages(
    organization_id: UUID,
    limit: int = Query(default=50, le=100, ge=1),
    offset: int = Query(default=0, ge=0),
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Get recent flagged agent messages with guardrail warnings.

    Access control: assistant_text_original is only visible to org owners
    (users with ORG_MANAGE_SETTINGS). All other roles see it redacted.
    """
    # Determine requester role for access control on sensitive fields
    is_owner = check_permission_for_session(
        db, auth.user_id, organization_id, Permission.ORG_MANAGE_SETTINGS,
    )
    requester_role = "owner" if is_owner else "member"

    # Get total count of flagged messages via SQL
    total = db.execute(
        text("""
            SELECT COUNT(*) FROM messages m
            JOIN conversations c ON m.conversation_id = c.conversation_id
            WHERE c.organization_id = :org_id
              AND m.role = 'assistant'
              AND m.meta IS NOT NULL
              AND m.meta -> 'guardrails' -> 'warnings' IS NOT NULL
              AND jsonb_array_length(m.meta -> 'guardrails' -> 'warnings') > 0
        """),
        {"org_id": str(organization_id)},
    ).scalar() or 0

    # Fetch flagged messages with JSONB filter in SQL so pagination works correctly
    rows = db.execute(
        text("""
            SELECT m.message_id FROM messages m
            JOIN conversations c ON m.conversation_id = c.conversation_id
            WHERE c.organization_id = :org_id
              AND m.role = 'assistant'
              AND m.meta IS NOT NULL
              AND m.meta -> 'guardrails' -> 'warnings' IS NOT NULL
              AND jsonb_array_length(m.meta -> 'guardrails' -> 'warnings') > 0
            ORDER BY m.created_at DESC
            LIMIT :limit OFFSET :offset
        """),
        {"org_id": str(organization_id), "limit": limit, "offset": offset},
    ).fetchall()

    message_ids = [row[0] for row in rows]

    messages = []
    if message_ids:
        flagged = (
            db.query(Message)
            .filter(Message.message_id.in_(message_ids))
            .order_by(Message.created_at.desc())
            .all()
        )
        for msg in flagged:
            guardrails = (msg.meta or {}).get("guardrails", {})
            serialized = serialize_message(msg, requester_role=requester_role)
            serialized["content"] = (serialized.get("content") or "")[:500]
            serialized["guardrails"] = guardrails
            messages.append(serialized)

    return {"messages": messages, "total": total}
