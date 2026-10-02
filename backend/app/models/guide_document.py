"""
Guide document model for tenant-uploaded documents.

Museums upload their own policies, procedures, and collection data
which are chunked and embedded into reference_chunks with their
organization_id for tenant-scoped RAG retrieval.

Each document has a visibility setting:
- "public"   — searchable by visitors via the embedded widget
- "internal" — searchable only by staff via the platform

This prevents sensitive internal documents (HR policies, security
procedures, board minutes, etc.) from being surfaced to visitors.
"""

import uuid
from datetime import datetime

from sqlalchemy import BigInteger, Boolean, CheckConstraint, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, uuid_fk, uuid_fk_nullable, timestamp_now


class GuideDocument(Base):
    """A document uploaded by a museum for their Guide assistant's RAG corpus."""

    __tablename__ = "guide_documents"

    document_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    file_key: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default="uploaded", server_default="uploaded"
    )
    # Controls whether visitors can see this document's chunks.
    # "public" = visitor-searchable, "internal" = staff-only.
    # Defaults to "internal" so nothing leaks unless the admin explicitly
    # marks it as visitor-facing.
    visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, default="internal", server_default="internal"
    )
    chunk_count: Mapped[int] = mapped_column(
        Integer, nullable=False, default=0, server_default="0"
    )
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    uploaded_by: Mapped[uuid.UUID | None] = uuid_fk_nullable("users.user_id")
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    organization: Mapped["Organization"] = relationship(foreign_keys=[organization_id])  # type: ignore[name-defined]
    uploaded_by_user: Mapped["User | None"] = relationship(foreign_keys=[uploaded_by])  # type: ignore[name-defined]

    __table_args__ = (
        Index("ix_guide_documents_org_id", "organization_id"),
        CheckConstraint(
            "status IN ('uploaded', 'processing', 'ready', 'error')",
            name="check_guide_document_status",
        ),
        CheckConstraint(
            "visibility IN ('public', 'internal')",
            name="check_guide_document_visibility",
        ),
    )
