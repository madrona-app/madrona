"""
Reference document chunks for RAG retrieval.

Stores chunked and embedded documents for semantic search via the
lookup_reference agent tool.

Chunks with organization_id = NULL are global — Madrona's own workflow
playbooks. Madrona ships no third-party standards corpus: it is Apache-2.0
and cannot grant the redistribution rights those publishers withhold.
Chunks with organization_id set are tenant-specific uploads via Guide.

visibility controls who can search the chunk:
- NULL or "public"  — searchable by both staff and visitors
- "internal"        — searchable by staff only

Global corpus chunks have NULL visibility (always accessible to staff).
Guide-uploaded chunks inherit visibility from their GuideDocument.

Requires pgvector extension.
"""

import uuid
from datetime import datetime

from pgvector.sqlalchemy import Vector
from sqlalchemy import Index, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base
from app.models._helpers import uuid_pk, uuid_fk_nullable, timestamp_now, JSONType


class ReferenceChunk(Base):
    """A chunked and embedded section of a reference document."""

    __tablename__ = "reference_chunks"

    chunk_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID | None] = uuid_fk_nullable(
        "organizations.organization_id"
    )
    source: Mapped[str] = mapped_column(String(100), nullable=False)
    document: Mapped[str] = mapped_column(String(500), nullable=False)
    section: Mapped[str | None] = mapped_column(String(500), nullable=True)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # NULL = global corpus (staff-only by design, not visitor-searchable).
    # "public" = visitor-safe. "internal" = staff-only tenant upload.
    visibility: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Personal conversation attachments: set ⇒ this chunk belongs to one
    # conversation (a user dropped a doc into the chat) and must NEVER surface
    # in corpus/widget search. NULL ⇒ corpus/global chunk. See reference_tools
    # ._search_chunks for the isolation filter. CASCADE so deleting the
    # conversation removes its attachment chunks.
    conversation_id: Mapped[uuid.UUID | None] = uuid_fk_nullable(
        "conversations.conversation_id", ondelete="CASCADE"
    )
    uploaded_by_user_id: Mapped[uuid.UUID | None] = uuid_fk_nullable("users.user_id")
    embedding: Mapped[list | None] = mapped_column(JSONType, nullable=True)
    # 1024-dim to match Voyage voyage-3.5 (see guide_voyage_embeddings_1024
    # migration). Must stay in lockstep with settings.semantic_search_dimensions.
    embedding_vec: Mapped[list | None] = mapped_column(Vector(1024), nullable=True)
    created_at: Mapped[datetime] = timestamp_now()

    __table_args__ = (
        Index("ix_reference_chunks_source", "source"),
        Index("ix_reference_chunks_org_source", "organization_id", "source"),
        Index("ix_reference_chunks_conversation", "conversation_id"),
    )
