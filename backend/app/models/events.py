from __future__ import annotations

"""Event and programming models."""

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


class Event(Base):
    """
    Museum programming event (lecture, tour, opening, workshop, donor event, teaching session).

    Events capture intent + scheduling + people while referencing collection objects.
    They do NOT replace procedures - procedures are created as needed.

    Event types:
    - teaching_session: Academic/educational sessions with objects
    - program: Public programs (lectures, tours, workshops)
    - opening_reception: Exhibition openings, VIP events
    - donor_development: Donor cultivation events
    - internal: Staff meetings, internal planning sessions
    """
    __tablename__ = "events"

    event_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    event_reference_number: Mapped[str] = mapped_column(String(50), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="draft")

    # Scheduling
    start_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    end_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Location and ownership
    location_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.locations.location_id", ondelete="SET NULL"),
        nullable=True,
    )
    owner_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Teaching-specific fields
    course_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    instructor_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    department: Mapped[str | None] = mapped_column(String(255), nullable=True)
    institution: Mapped[str | None] = mapped_column(String(255), nullable=True)
    headcount: Mapped[int | None] = mapped_column(Integer, nullable=True)
    session_format: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Program-specific fields
    audience: Mapped[str | None] = mapped_column(String(30), nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    registration_url: Mapped[str | None] = mapped_column(String(500), nullable=True)

    # General fields
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Phase 3D/5: Public-facing fields
    venue_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.venues.venue_id", ondelete="SET NULL"),
        nullable=True,
    )
    slug: Mapped[str | None] = mapped_column(String(255), nullable=True)
    hero_media_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    short_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    price: Mapped[str | None] = mapped_column(String(100), nullable=True)
    price_member: Mapped[str | None] = mapped_column(String(100), nullable=True)
    age_range: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_featured: Mapped[bool] = mapped_column(server_default="false", nullable=False)
    series_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    exhibition_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.exhibitions.exhibition_id", ondelete="SET NULL"),
        nullable=True,
    )
    tags = mapped_column(JSONB, nullable=True)

    # Audit fields
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    updated_at: Mapped[datetime] = timestamp_updated()
    updated_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="Event.organization_id == Organization.organization_id",
    )
    location: Mapped["Location | None"] = relationship(
        "Location",
        primaryjoin="Event.location_id == Location.location_id",
    )
    venue = relationship(
        "Venue",
        foreign_keys=[venue_id],
        primaryjoin="Event.venue_id == Venue.venue_id",
    )
    exhibition = relationship(
        "Exhibition",
        foreign_keys=[exhibition_id],
        primaryjoin="Event.exhibition_id == Exhibition.exhibition_id",
    )
    owner: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[owner_user_id],
        primaryjoin="Event.owner_user_id == User.user_id",
    )
    instructor: Mapped["Constituent | None"] = relationship(
        "Constituent",
        primaryjoin="Event.instructor_id == Constituent.constituent_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="Event.created_by == User.user_id",
    )
    updated_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[updated_by],
        primaryjoin="Event.updated_by == User.user_id",
    )
    object_links: Mapped[list["EventObjectLink"]] = relationship(
        "EventObjectLink",
        back_populates="event",
        cascade="all, delete-orphan",
    )
    # participants are now tracked via ConstituentXref (entity_type='event')

    __table_args__ = (
        Index("ix_events_org_ref_number", "organization_id", "event_reference_number", unique=True),
        Index("ix_events_org_status", "organization_id", "status"),
        Index("ix_events_org_type", "organization_id", "event_type"),
        Index("ix_events_org_start", "organization_id", "start_at"),
        Index("ix_events_owner", "owner_user_id"),
        CheckConstraint(
            "event_type IN ('teaching_session', 'program', 'opening_reception', 'donor_development', 'internal')",
            name="check_event_type",
        ),
        CheckConstraint(
            "status IN ('draft', 'scheduled', 'completed', 'cancelled')",
            name="check_event_status",
        ),
        CheckConstraint(
            "session_format IS NULL OR session_format IN ('gallery', 'study_room', 'handling_session')",
            name="check_event_session_format",
        ),
        CheckConstraint(
            "audience IS NULL OR audience IN ('public', 'members', 'internal')",
            name="check_event_audience",
        ),
        {"schema": "collections"},
    )


class EventObjectLink(Base):
    """
    Links a collection object to an event with role and planned use.

    Roles:
    - primary: Central to the event (e.g., object being discussed)
    - supporting: Provides context or comparison
    - reference: Mentioned but not physically present

    Planned use determines collections impact:
    - display: Object will be on view (may need movement)
    - discuss: Object will be discussed/shown (may need handling)
    - handle: Object will be physically handled (needs condition check)
    - photograph: Object will be photographed (verify rights)
    - record: Object will be recorded on video (verify rights)
    """
    __tablename__ = "event_object_links"

    event_object_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    event_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.events.event_id", ondelete="CASCADE"),
        nullable=False,
    )
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )

    role: Mapped[str] = mapped_column(String(30), nullable=False, default="primary")
    planned_use: Mapped[str] = mapped_column(String(30), nullable=False)
    requirements: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    event: Mapped["Event"] = relationship(
        "Event",
        back_populates="object_links",
    )
    collection_object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        primaryjoin="EventObjectLink.object_id == CollectionObject.object_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        primaryjoin="EventObjectLink.created_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_event_objects_event", "event_id"),
        Index("ix_event_objects_object", "object_id"),
        Index("ix_event_objects_org_object", "organization_id", "object_id"),
        UniqueConstraint(
            "organization_id", "event_id", "object_id", "role",
            name="uq_event_object_role",
        ),
        CheckConstraint(
            "role IN ('primary', 'supporting', 'reference')",
            name="check_event_object_role",
        ),
        CheckConstraint(
            "planned_use IN ('display', 'discuss', 'handle', 'photograph', 'record')",
            name="check_event_object_planned_use",
        ),
        {"schema": "collections"},
    )


__all__ = [
    "Event",
    "EventObjectLink",
]
