"""
Agent conversation, message, and system prompt models.

Stores chat history for the AI agent framework. Two personas share the same
tables: 'staff' (authenticated) and 'visitor' (public/anonymous).

GuideSystemPrompt stores per-org overrides for system prompts, enabling
real-time editing and A/B testing without code deploys.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, Integer, String, Text, Index, CheckConstraint, ForeignKey, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, uuid_fk, uuid_fk_nullable, timestamp_now, timestamp_updated, JSONType


class Conversation(Base):
    __tablename__ = "conversations"

    conversation_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    user_id: Mapped[uuid.UUID | None] = uuid_fk_nullable("users.user_id", ondelete="SET NULL")
    persona: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    context_entity_type: Mapped[str | None] = mapped_column(String(50), nullable=True)
    context_entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    session_id: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # Visitor session linkage (populated for visitor persona conversations)
    visitor_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    visit_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)

    # Multi-agent orchestration: persona is mutable across the conversation
    # (e.g. router decides 'staff' → 'registrar' on first message). Each
    # entry in persona_history is {persona, set_at, source, confidence?,
    # rationale?}. Source values: 'initial' (creation default), 'router',
    # 'manual_switch'.
    persona_history: Mapped[list | None] = mapped_column(JSONType, nullable=True)

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    # Relationships
    messages: Mapped[list["Message"]] = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )

    __table_args__ = (
        CheckConstraint(
            "persona IN ('staff', 'visitor', 'guide', "
            "'registrar', 'loans_registrar', 'conservator', "
            "'rights_specialist', 'curator')",
            name="check_conversation_persona",
        ),
        Index("ix_conversations_org_id", "organization_id"),
        Index("ix_conversations_user_id", "user_id"),
        Index("ix_conversations_session_id", "session_id"),
    )


class Message(Base):
    __tablename__ = "messages"

    message_id: Mapped[uuid.UUID] = uuid_pk()
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("conversations.conversation_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    role: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    tool_calls: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    tool_results: Mapped[dict | None] = mapped_column(JSONType, nullable=True)
    model: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # Use Column() to avoid conflict with SQLAlchemy's reserved 'metadata' attribute
    meta = Column("meta", JSONType, nullable=True)

    # Multi-agent orchestration: messages produced by a delegated specialist
    # link back to the parent staff message that triggered them. Both columns
    # are NULL on ordinary single-agent messages.
    parent_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("messages.message_id", ondelete="SET NULL"),
        nullable=True,
    )
    delegation_persona: Mapped[str | None] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    conversation: Mapped["Conversation"] = relationship(
        "Conversation",
        back_populates="messages",
    )

    __table_args__ = (
        CheckConstraint(
            "role IN ('system', 'user', 'assistant', 'tool')",
            name="check_message_role",
        ),
        Index("ix_messages_conversation_id", "conversation_id"),
        Index("ix_messages_org_id", "organization_id"),
        Index("ix_messages_parent_id", "parent_message_id"),
    )


class GuideSystemPrompt(Base):
    """Per-org system prompt overrides for Guide personas.

    When an org has a row for a given persona, it takes precedence over the
    hardcoded default in system_prompts.py.  A NULL organization_id means
    a platform-wide default (overrides code, overridden by org-specific).
    """
    __tablename__ = "guide_system_prompts"

    prompt_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID | None] = uuid_fk_nullable(
        "organizations.organization_id", ondelete="CASCADE",
    )
    persona: Mapped[str] = mapped_column(String(20), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False, server_default="1")

    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()

    __table_args__ = (
        CheckConstraint(
            "persona IN ('staff', 'visitor', 'guide', "
            "'registrar', 'loans_registrar', 'conservator', "
            "'rights_specialist', 'curator', 'planner')",
            name="check_guide_system_prompt_persona",
        ),
        UniqueConstraint("organization_id", "persona", name="uq_guide_system_prompt_org_persona"),
        Index("ix_guide_system_prompts_org_id", "organization_id"),
    )
