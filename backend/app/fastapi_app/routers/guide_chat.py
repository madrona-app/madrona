"""
Authenticated Guide chat endpoints.

Used by the Guide dashboard Chat Playground. These are staff-like
conversations using the "guide" persona — the user is an authenticated
museum professional, not an anonymous visitor.

The "guide" persona has access to lookup_reference (Madrona playbooks +
org uploads) and lookup_museum_info (all org docs, including internal),
but NOT collection tools (search_collection, get_object_detail, etc.)
since standalone Guide orgs don't have structured collection data.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from starlette.responses import StreamingResponse

from app.config import get_settings
from app.database import get_db
from app.fastapi_app.dependencies.guide import GuideContext, require_guide_app
from app.services.agent_service import get_agent_service
from app.services.guide_usage import messages_used_this_month

logger = logging.getLogger(__name__)

router = APIRouter(tags=["guide"])

INPUT_LIMIT_GUIDE = 4000


class GuideChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=INPUT_LIMIT_GUIDE)


@router.post("/api/guide/chat/conversations", status_code=201, summary="Create guide conversation")
def create_guide_conversation(
    guide_ctx: GuideContext = Depends(require_guide_app),
    db: Session = Depends(get_db),
):
    """Create a new Guide conversation for the authenticated user."""
    if not get_settings().agent_enabled:
        raise HTTPException(status_code=503, detail={"code": "feature_disabled", "message": "Agent is not enabled"})

    # Platform orgs get the staff persona (collections-aware, same as sidebar).
    # Self-serve Guide orgs get the guide persona (document-only, "Madrona Guide").
    persona = "staff" if guide_ctx.is_platform else "guide"

    service = get_agent_service(session=db)
    conv = service.create_conversation(
        organization_id=guide_ctx.organization_id,
        persona=persona,
        user_id=guide_ctx.auth.user_id,
    )

    return {
        "conversation_id": str(conv.conversation_id),
        "persona": conv.persona,
        "title": conv.title,
        "created_at": conv.created_at.isoformat(),
    }


@router.get("/api/guide/chat/conversations", summary="List guide conversations")
def list_guide_conversations(
    guide_ctx: GuideContext = Depends(require_guide_app),
    db: Session = Depends(get_db),
):
    """List the authenticated user's Guide conversations."""
    if not get_settings().agent_enabled:
        raise HTTPException(status_code=503, detail={"code": "feature_disabled", "message": "Agent is not enabled"})

    service = get_agent_service(session=db)
    convs = service.list_conversations(
        organization_id=guide_ctx.organization_id,
        user_id=guide_ctx.auth.user_id,
    )

    return {
        "conversations": [
            {
                "conversation_id": str(c.conversation_id),
                "title": c.title,
                "persona": c.persona,
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
            }
            for c in convs
        ]
    }


@router.get("/api/guide/chat/conversations/{conversation_id}/messages", summary="Get guide messages")
def get_guide_messages(
    conversation_id: UUID,
    guide_ctx: GuideContext = Depends(require_guide_app),
    db: Session = Depends(get_db),
):
    """Get messages for a Guide conversation."""
    if not get_settings().agent_enabled:
        raise HTTPException(status_code=503, detail={"code": "feature_disabled", "message": "Agent is not enabled"})

    service = get_agent_service(session=db)
    conv = service.get_conversation(
        conversation_id=conversation_id,
        organization_id=guide_ctx.organization_id,
        user_id=guide_ctx.auth.user_id,
    )
    if not conv:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Conversation not found"})

    messages = service.get_messages(conversation_id, guide_ctx.organization_id)

    return {
        "messages": [
            {
                "message_id": str(m.message_id),
                "role": m.role,
                "content": m.content,
                "created_at": m.created_at.isoformat(),
            }
            for m in messages
        ]
    }


@router.post("/api/guide/chat/conversations/{conversation_id}/chat", summary="Guide chat")
def guide_chat(
    conversation_id: UUID,
    body: GuideChatBody,
    guide_ctx: GuideContext = Depends(require_guide_app),
    db: Session = Depends(get_db),
):
    """Send a message and stream the assistant's response."""
    if not get_settings().agent_enabled:
        raise HTTPException(status_code=503, detail={"code": "feature_disabled", "message": "Agent is not enabled"})

    service = get_agent_service(session=db)
    conv = service.get_conversation(
        conversation_id=conversation_id,
        organization_id=guide_ctx.organization_id,
        user_id=guide_ctx.auth.user_id,
    )
    if not conv:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Conversation not found"})

    # Enforce the monthly message quota for standalone Guide orgs. Platform orgs
    # are full-platform customers, not on Guide tiers, so they are not capped.
    if not guide_ctx.is_platform:
        max_msgs = (guide_ctx.config or {}).get("max_monthly_messages")
        if max_msgs is not None and messages_used_this_month(guide_ctx.organization_id, db) >= max_msgs:
            raise HTTPException(
                status_code=429,
                detail={
                    "code": "message_limit_reached",
                    "message": f"Monthly message limit reached ({max_msgs}). Upgrade your plan for more.",
                },
            )

    message = body.message.strip()

    def generate():
        try:
            yield from service.stream_response(conv, message)
        except Exception:
            logger.exception("Guide agent stream error")
            yield 'event: error\ndata: {"error": "Internal error"}\n\n'

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/api/guide/chat/conversations/{conversation_id}", summary="Delete guide conversation")
def delete_guide_conversation(
    conversation_id: UUID,
    guide_ctx: GuideContext = Depends(require_guide_app),
    db: Session = Depends(get_db),
):
    """Delete a Guide conversation."""
    service = get_agent_service(session=db)
    deleted = service.delete_conversation(
        conversation_id=conversation_id,
        organization_id=guide_ctx.organization_id,
        user_id=guide_ctx.auth.user_id,
    )
    if not deleted:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Conversation not found"})

    return {"deleted": True}
