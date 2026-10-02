from __future__ import annotations

"""
NAGPRA compliance models — per-object actions with consultation tracking.

Accessed from the CollectionObject workspace page, not a standalone list.
When an object is identified as potentially NAGPRA-eligible, staff creates
a NagpraAction on that object. Consultation events log the audit trail.

Objects going through the same NAGPRA process share a group_reference
so staff can see related items without a separate case entity.

References:
- 25 U.S.C. 3001-3013 (NAGPRA statute)
- 43 CFR Part 10 (implementing regulations, 2024 revision)
"""

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# NAGPRA ACTION - Per-object compliance record
# ============================================================================


class NagpraAction(Base):
    """
    A NAGPRA compliance action on a single collection object.

    Created from the object workspace page when an object is identified
    as potentially NAGPRA-eligible. Tracks categorization, duty of care,
    consultation, and disposition through to transfer or closure.

    Objects in the same NAGPRA process share a group_reference (free text,
    typically an institutional case number) so related items can be found
    together.

    Workflow: identified -> under_review -> consultation ->
             notice_filed -> waiting_period -> approved_for_transfer ->
             transferred -> closed
    """
    __tablename__ = "nagpra_actions"

    action_id: Mapped[uuid.UUID] = uuid_pk()
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

    # ── Identification ──

    action_number: Mapped[str] = mapped_column(String(50), nullable=False)

    # Optional grouping — links related objects in the same NAGPRA process
    group_reference: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # How this action originated
    origin_type: Mapped[str] = mapped_column(String(30), nullable=False)

    # ── Categorization ──

    nagpra_category: Mapped[str] = mapped_column(
        String(40), nullable=False, default="undetermined",
    )
    funerary_association: Mapped[str | None] = mapped_column(
        String(20), nullable=True,
    )
    category_basis: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_determined_date: Mapped[date | None] = mapped_column(
        Date, nullable=True,
    )
    category_determined_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # ── Geographic / cultural context ──

    geographic_origin: Mapped[str | None] = mapped_column(String(255), nullable=True)
    site_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    state: Mapped[str | None] = mapped_column(String(100), nullable=True)
    county: Mapped[str | None] = mapped_column(String(100), nullable=True)

    # ── Cultural affiliation ──

    affiliation_status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="pending",
    )
    affiliated_party_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    affiliation_basis: Mapped[str | None] = mapped_column(Text, nullable=True)
    affiliation_evidence_types: Mapped[list[str] | None] = mapped_column(
        JSONB, nullable=True,
    )
    affiliation_determined_date: Mapped[date | None] = mapped_column(
        Date, nullable=True,
    )

    # ── Duty of care (2024 rule) ──

    display_consent: Mapped[str] = mapped_column(
        String(20), nullable=False, default="restricted",
    )
    display_consent_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    access_consent: Mapped[str] = mapped_column(
        String(20), nullable=False, default="restricted",
    )
    access_consent_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    research_consent: Mapped[str] = mapped_column(
        String(20), nullable=False, default="restricted",
    )
    research_consent_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    handling_preferences: Mapped[str | None] = mapped_column(Text, nullable=True)
    storage_preferences: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Hold ──
    # Visible on the object record to all staff regardless of case access.
    # Default True — creating a NAGPRA action immediately restricts the object.

    hold_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True,
    )

    # ── Federal Register notice ──

    notice_type: Mapped[str | None] = mapped_column(String(40), nullable=True)
    notice_submitted_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notice_published_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notice_fr_citation: Mapped[str | None] = mapped_column(String(100), nullable=True)
    waiting_period_end_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    # ── Transfer / repatriation ──

    transfer_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    transfer_recipient_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    transfer_method: Mapped[str | None] = mapped_column(String(50), nullable=True)
    transfer_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Link to deaccession record when transfer is executed
    deaccession_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.deaccessions.deaccession_id", ondelete="SET NULL"),
        nullable=True,
    )

    # ── Coordinator ──

    coordinator_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # ── Key dates ──

    identified_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    consultation_initiated_date: Mapped[date | None] = mapped_column(
        Date, nullable=True,
    )
    closed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    inventory_deadline: Mapped[date | None] = mapped_column(Date, nullable=True)

    # ── Status ──

    status: Mapped[str] = mapped_column(
        String(30), nullable=False, default="identified",
    )

    # ── Notes ──

    action_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    internal_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # ── Audit ──

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

    # ── Relationships ──

    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="NagpraAction.organization_id == Organization.organization_id",
    )
    object: Mapped["CollectionObject"] = relationship(
        "CollectionObject",
        foreign_keys=[object_id],
    )
    affiliated_party: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[affiliated_party_id],
    )
    transfer_recipient: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[transfer_recipient_id],
    )
    coordinator: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[coordinator_id],
    )
    deaccession: Mapped["Deaccession | None"] = relationship(
        "Deaccession",
        foreign_keys=[deaccession_id],
    )
    consultation_log: Mapped[list["NagpraConsultationEvent"]] = relationship(
        "NagpraConsultationEvent",
        back_populates="action",
        cascade="all, delete-orphan",
        order_by="NagpraConsultationEvent.event_date.desc()",
    )

    __table_args__ = (
        Index("ix_nagpra_actions_org_number", "organization_id", "action_number",
              unique=True),
        Index("ix_nagpra_actions_object", "object_id", unique=True),
        Index("ix_nagpra_actions_org_status", "organization_id", "status"),
        Index("ix_nagpra_actions_org_group", "organization_id", "group_reference"),
        Index("ix_nagpra_actions_hold", "organization_id", "hold_active"),
        CheckConstraint(
            "origin_type IN ("
            "'tribal_request', 'staff_review', 'inadvertent_discovery', "
            "'collections_review', 'other')",
            name="check_nagpra_origin_type",
        ),
        CheckConstraint(
            "nagpra_category IN ("
            "'human_remains', 'associated_funerary_object', "
            "'unassociated_funerary_object', 'sacred_object', "
            "'object_of_cultural_patrimony', 'undetermined')",
            name="check_nagpra_category",
        ),
        CheckConstraint(
            "funerary_association IS NULL OR "
            "funerary_association IN ('associated', 'unassociated')",
            name="check_nagpra_funerary_assoc",
        ),
        CheckConstraint(
            "affiliation_status IN ("
            "'pending', 'affiliated', 'culturally_unidentifiable', "
            "'multiple_claimants', 'disputed')",
            name="check_nagpra_affiliation_status",
        ),
        CheckConstraint(
            "display_consent IN ("
            "'restricted', 'requested', 'granted', 'denied', 'conditional')",
            name="check_nagpra_display_consent",
        ),
        CheckConstraint(
            "access_consent IN ("
            "'restricted', 'requested', 'granted', 'denied', 'conditional')",
            name="check_nagpra_access_consent",
        ),
        CheckConstraint(
            "research_consent IN ("
            "'restricted', 'requested', 'granted', 'denied', 'conditional')",
            name="check_nagpra_research_consent",
        ),
        CheckConstraint(
            "notice_type IS NULL OR notice_type IN ("
            "'notice_of_inventory_completion', 'notice_of_intent_to_repatriate')",
            name="check_nagpra_notice_type",
        ),
        CheckConstraint(
            "status IN ("
            "'identified', 'under_review', 'consultation', "
            "'notice_filed', 'waiting_period', 'approved_for_transfer', "
            "'transferred', 'closed')",
            name="check_nagpra_action_status",
        ),
        {"schema": "collections"},
    )


# ============================================================================
# NAGPRA CONSULTATION EVENT - Audit trail of tribal consultation
# ============================================================================


class NagpraConsultationEvent(Base):
    """
    A consultation interaction logged against a NAGPRA action.

    Every contact with a consulting party is recorded: letters, meetings,
    site visits, responses. This is the compliance audit trail that
    demonstrates good-faith consultation under the statute.

    For consultations covering multiple objects in the same group,
    log the event on one action and reference the group. The UI can
    surface group-level consultation history when viewing any object
    in the group.
    """
    __tablename__ = "nagpra_consultation_events"

    event_id: Mapped[uuid.UUID] = uuid_pk()
    action_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.nagpra_actions.action_id", ondelete="CASCADE"),
        nullable=False,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Which party this interaction was with
    consulting_party_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.constituents.constituent_id", ondelete="SET NULL"),
        nullable=True,
    )
    consulting_party_name: Mapped[str | None] = mapped_column(
        String(255), nullable=True,
    )

    # Event details
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    event_type: Mapped[str] = mapped_column(String(30), nullable=False)
    direction: Mapped[str] = mapped_column(String(10), nullable=False)

    # Content
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Participants
    participants: Mapped[list[str] | None] = mapped_column(JSONB, nullable=True)

    # Outcomes
    outcomes: Mapped[str | None] = mapped_column(Text, nullable=True)
    follow_up_required: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False,
    )
    follow_up_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    follow_up_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Document references (letters, meeting minutes, signed agreements)
    document_references: Mapped[list[dict[str, Any]] | None] = mapped_column(
        JSONB, nullable=True,
    )

    # Recorded by
    recorded_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Audit
    created_at: Mapped[datetime] = timestamp_now()

    # Relationships
    action: Mapped["NagpraAction"] = relationship(
        "NagpraAction",
        back_populates="consultation_log",
    )
    consulting_party: Mapped["Constituent | None"] = relationship(
        "Constituent",
        foreign_keys=[consulting_party_id],
    )

    __table_args__ = (
        Index("ix_nagpra_events_action", "action_id"),
        Index("ix_nagpra_events_action_date", "action_id", "event_date"),
        Index("ix_nagpra_events_party", "consulting_party_id"),
        CheckConstraint(
            "event_type IN ("
            "'letter', 'email', 'phone_call', 'meeting', 'site_visit', "
            "'collections_access', 'document_shared', 'formal_notice', "
            "'response_received', 'agreement', 'other')",
            name="check_nagpra_event_type",
        ),
        CheckConstraint(
            "direction IN ('outgoing', 'incoming', 'mutual')",
            name="check_nagpra_event_direction",
        ),
        {"schema": "collections"},
    )


__all__ = [
    "NagpraAction",
    "NagpraConsultationEvent",
]
