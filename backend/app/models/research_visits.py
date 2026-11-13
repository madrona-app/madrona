"""Research visit log: in-person use of objects by researchers.

A use request (UseRequest) records permission to use the collection. A research
visit records what actually happened: who came in, when, who supervised, and
which objects they handled, with a note per object on handling and on its
condition when it came back.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
    Time,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import timestamp_now, uuid_pk


class ResearchVisit(Base):
    """One in-person visit by a researcher."""

    __tablename__ = "research_visits"

    visit_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Researcher: a free-text name is always kept, so the log reads correctly
    # even if the linked person record is later deleted.
    researcher_constituent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    researcher_name: Mapped[str] = mapped_column(String(255), nullable=False)
    researcher_affiliation: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # When and where
    visit_date: Mapped[date] = mapped_column(Date, nullable=False)
    arrival_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    departure_time: Mapped[time | None] = mapped_column(Time, nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # Why
    research_topic: Mapped[str | None] = mapped_column(String(500), nullable=True)
    purpose: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Supervising staff member: a user account when known, plus the name as
    # entered so the record stays readable if the account is removed.
    supervised_by_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    supervised_by_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    # The use request that authorised the visit, if any.
    use_request_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.use_requests.request_id", ondelete="SET NULL"),
        nullable=True,
    )

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = timestamp_now()
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        "created_by", UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )
    updated_at: Mapped[datetime] = timestamp_now()
    updated_by_id: Mapped[uuid.UUID | None] = mapped_column(
        "updated_by", UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    objects: Mapped[list["ResearchVisitObject"]] = relationship(
        "ResearchVisitObject",
        back_populates="visit",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_research_visits_org_date", "organization_id", "visit_date"),
        Index("ix_research_visits_constituent", "researcher_constituent_id"),
        Index("ix_research_visits_use_request", "use_request_id"),
        CheckConstraint(
            "arrival_time IS NULL OR departure_time IS NULL OR departure_time >= arrival_time",
            name="check_research_visit_times",
        ),
        {"schema": "collections"},
    )


class ResearchVisitObject(Base):
    """An object used during a research visit."""

    __tablename__ = "research_visit_objects"

    visit_object_id: Mapped[uuid.UUID] = uuid_pk()
    visit_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.research_visits.visit_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    object_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.collection_objects.object_id", ondelete="CASCADE"),
        nullable=False,
    )

    handling_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    condition_on_return: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = timestamp_now()
    created_by_id: Mapped[uuid.UUID | None] = mapped_column(
        "created_by", UUID(as_uuid=True), ForeignKey("users.user_id", ondelete="SET NULL"), nullable=True
    )

    visit: Mapped["ResearchVisit"] = relationship("ResearchVisit", back_populates="objects")
    object = relationship("CollectionObject", foreign_keys=[object_id])

    __table_args__ = (
        UniqueConstraint("visit_id", "object_id", name="uq_research_visit_objects_visit_object"),
        Index("ix_research_visit_objects_object", "organization_id", "object_id"),
        {"schema": "collections"},
    )


__all__ = ["ResearchVisit", "ResearchVisitObject"]
