"""
Shared helper functions for model definitions.

Canonical versions of uuid_pk, timestamp_now, etc. used by all model modules.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, JSON, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import func


# Use JSON for cross-database compatibility (SQLite tests + PostgreSQL production)
# In PostgreSQL, this becomes JSONB automatically via type decoration
# In SQLite, this uses JSON text storage
JSONType = JSON().with_variant(JSONB(), "postgresql")


def uuid_pk() -> Mapped[uuid.UUID]:
    """UUID primary key with server-side default on PostgreSQL, client-side on SQLite."""
    return mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),  # PostgreSQL only
        default=uuid.uuid4,  # Fallback for SQLite
    )


def uuid_fk(foreign_key: str, ondelete: str = "CASCADE") -> Mapped[uuid.UUID]:
    """UUID foreign key column."""
    return mapped_column(UUID(as_uuid=True), ForeignKey(foreign_key, ondelete=ondelete), nullable=False)


def uuid_fk_nullable(foreign_key: str, ondelete: str = "SET NULL") -> Mapped[uuid.UUID | None]:
    """Nullable UUID foreign key column."""
    return mapped_column(UUID(as_uuid=True), ForeignKey(foreign_key, ondelete=ondelete), nullable=True)


def timestamp_now() -> Mapped[datetime]:
    """Timestamp with timezone, defaulting to now().

    Explicit ``DateTime(timezone=True)`` — without it SQLAlchemy infers a naive
    ``DateTime()`` from the ``Mapped[datetime]`` annotation, while the DB columns
    are ``TIMESTAMP WITH TIME ZONE``. That mismatch was the bulk of the #34
    model↔DB drift (and feeds the tz-naive bug class in #35).
    """
    return mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


def timestamp_updated() -> Mapped[datetime]:
    """Timestamp with timezone, auto-updating on modification."""
    return mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )
