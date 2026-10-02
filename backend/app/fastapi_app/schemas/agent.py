"""Pydantic request/response models for agent endpoints."""

from __future__ import annotations

from typing import Literal, Any

from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


# =============================================================================
# Page context — per-message snapshot of where the user is in the UI
# =============================================================================
#
# PageContext is sent on every staff chat turn (not stored on the conversation)
# so the agent sees the user's *current* page even if they navigated since the
# conversation was created. Shape mirrors the frontend PageContext provider;
# camelCase aliases let the frontend POST unchanged JSON.


class _CamelModel(BaseModel):
    """Base that accepts camelCase from the wire, uses snake_case in Python."""

    model_config = ConfigDict(
        populate_by_name=True,
        alias_generator=lambda s: "".join(
            [s.split("_")[0], *[p.title() for p in s.split("_")[1:]]]
        ),
    )


class PageContextEntityIn(_CamelModel):
    type: str = Field(..., max_length=64)
    id: str = Field(..., max_length=128)
    label: str = Field(..., max_length=256)


class PageContextWorkflowIn(_CamelModel):
    status: str = Field(..., max_length=64)
    blocking_count: int = Field(..., ge=0, le=999)
    top_blockers: list[str] = Field(default_factory=list, max_length=5)


class PageContextIn(_CamelModel):
    route: str = Field(..., max_length=512)
    product: str | None = Field(default=None, max_length=64)
    nav_item_id: str | None = Field(default=None, max_length=128)
    entity: PageContextEntityIn | None = None
    workflow: PageContextWorkflowIn | None = None
    edit_mode: bool | None = None


# =============================================================================
# Request models
# =============================================================================


class CreateStaffConversationBody(BaseModel):
    context_entity_type: str | None = None
    context_entity_id: UUID | None = None


class StaffChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000)
    page_context: PageContextIn | None = Field(
        default=None,
        description="Snapshot of the user's current page — route, entity, "
        "workflow state. Used to ground the model in the live UI.",
    )


class CreateVisitorConversationBody(BaseModel):
    session_id: str | None = None
    locale: str = "en"
    source: str | None = None
    context_entity_type: str | None = None
    context_entity_id: UUID | None = None


class VisitorChatBody(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    session_id: str
    locale: str | None = None
    # Per-turn hint: "voice" when the message came from speech input, so the
    # agent shapes a listenable (shorter, link-light) reply. Never trusted for
    # anything security-relevant.
    input_mode: Literal["text", "voice"] | None = None


class GDPRDeleteBody(BaseModel):
    session_id: str


# =============================================================================
# Response models
# =============================================================================


class StaffConversationOut(BaseModel):
    conversation_id: str
    persona: str
    title: str | None = None
    created_at: str


class ConversationSummaryOut(BaseModel):
    conversation_id: str
    title: str | None = None
    persona: str
    created_at: str
    updated_at: str


class StaffConversationListResponse(BaseModel):
    conversations: list[ConversationSummaryOut]


class MessageOut(BaseModel):
    message_id: str | None = None
    role: str | None = None
    content: str | None = None
    created_at: str | None = None
    meta: Any = None


class StaffMessagesResponse(BaseModel):
    messages: list[Any]


class VisitorConversationOut(BaseModel):
    conversation_id: str
    persona: str
    visitor_id: str
    visit_id: str
    session_id: str


class GDPRDeleteResponse(BaseModel):
    deleted_conversations: int


# Agent admin response models

class QualityStatsResponse(BaseModel):
    total_responses: int
    flagged_responses: int
    blocked_responses: int
    pass_rate: float


class FlaggedMessageOut(BaseModel):
    message_id: str | None = None
    role: str | None = None
    content: str | None = None
    created_at: str | None = None
    guardrails: Any = None
    meta: Any = None


class FlaggedMessagesResponse(BaseModel):
    messages: list[Any]
    total: int


# =============================================================================
# System prompt admin models
# =============================================================================


class SystemPromptOut(BaseModel):
    prompt_id: str
    organization_id: str | None = None
    persona: str
    content: str
    version: int
    created_at: str
    updated_at: str


class SystemPromptListResponse(BaseModel):
    prompts: list[SystemPromptOut]


class SystemPromptUpdateBody(BaseModel):
    content: str = Field(..., min_length=1, max_length=50000)


class SystemPromptCreateBody(BaseModel):
    persona: str = Field(..., pattern=r"^(staff|visitor|guide)$")
    content: str = Field(..., min_length=1, max_length=50000)
