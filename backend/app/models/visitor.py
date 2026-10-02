"""
Visitor session, visit, and interaction tracking models.

Server-side visitor identity and visit lifecycle. Replaces browser-only
sessionStorage with persistent records that survive sessions and support
post-visit features (email recap, analytics, ticketing).
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, Column, ForeignKey, String, Text, Integer, Index, CheckConstraint, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import (
    uuid_pk,
    uuid_fk,
    uuid_fk_nullable,
    timestamp_now,
    timestamp_updated,
    JSONType,
)


class Visitor(Base):
    __tablename__ = "visitors"

    visitor_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")

    session_token: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    locale: Mapped[str] = mapped_column(String(10), nullable=False, server_default="en")

    email_consent: Mapped[bool] = mapped_column(nullable=False, server_default="false")
    email_consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    first_seen_at: Mapped[datetime] = timestamp_now()
    last_seen_at: Mapped[datetime] = timestamp_updated()
    visit_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")

    # Relationships
    visits: Mapped[list["Visit"]] = relationship(
        "Visit",
        back_populates="visitor",
        cascade="all, delete-orphan",
        order_by="Visit.started_at.desc()",
    )

    __table_args__ = (
        Index("ix_visitors_org_id", "organization_id"),
        Index(
            "ix_visitors_org_session",
            "organization_id",
            "session_token",
            unique=True,
        ),
        Index("ix_visitors_org_email", "organization_id", "email"),
    )


class Visit(Base):
    __tablename__ = "visits"

    visit_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    visitor_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("visitors.visitor_id", ondelete="CASCADE"),
        nullable=False,
        # Indexed via explicit Index in __table_args__ below
    )

    # Reserved for future ticketing module
    ticket_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), nullable=True,
    )

    venue_id: Mapped[uuid.UUID | None] = uuid_fk_nullable(
        "collections.venues.venue_id", ondelete="SET NULL",
    )

    started_at: Mapped[datetime] = timestamp_now()
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    visit_type: Mapped[str] = mapped_column(String(20), nullable=False, server_default="digital")
    source: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Post-visit recap
    recap_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    recap_email: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Relationships
    visitor: Mapped["Visitor"] = relationship("Visitor", back_populates="visits")
    interactions: Mapped[list["VisitInteraction"]] = relationship(
        "VisitInteraction",
        back_populates="visit",
        cascade="all, delete-orphan",
        order_by="VisitInteraction.created_at",
    )

    __table_args__ = (
        CheckConstraint(
            "visit_type IN ('in_person', 'digital')",
            name="check_visit_type",
        ),
        CheckConstraint(
            "source IS NULL OR source IN ('qr_scan', 'website', 'ticket')",
            name="check_visit_source",
        ),
        Index("ix_visits_org_id", "organization_id"),
        Index("ix_visits_visitor_id", "visitor_id"),
        Index("ix_visits_org_started", "organization_id", "started_at"),
    )


class VisitInteraction(Base):
    __tablename__ = "visit_interactions"

    interaction_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = uuid_fk("organizations.organization_id")
    visit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("visits.visit_id", ondelete="CASCADE"),
        nullable=False,
        # Indexed via explicit Index in __table_args__ below
    )

    interaction_type: Mapped[str] = mapped_column(String(30), nullable=False)
    entity_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    entity_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    # Use Column() to avoid conflict with SQLAlchemy's reserved 'metadata' attribute
    meta = Column("meta", JSONType, nullable=True)

    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    visit: Mapped["Visit"] = relationship("Visit", back_populates="interactions")

    __table_args__ = (
        CheckConstraint(
            "interaction_type IN ('object_view', 'qr_scan', 'agent_conversation', "
            "'exhibition_view', 'search', 'share')",
            name="check_interaction_type",
        ),
        Index("ix_visit_interactions_org_id", "organization_id"),
        Index("ix_visit_interactions_visit_id", "visit_id"),
        Index("ix_visit_interactions_entity", "entity_type", "entity_id"),
    )
