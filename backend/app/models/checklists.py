"""
Checklist models for the Exhibits module.

Provides reusable, versioned checklist templates that can be applied to exhibitions.
"""
from __future__ import annotations
from datetime import datetime, date
from typing import Optional, List
from uuid import UUID, uuid4

from sqlalchemy import (
    String, Text, Integer, Boolean, Date, DateTime, ForeignKey, UniqueConstraint, text
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PGUUID

from app.database import Base


# === ENUMS (as constants for validation) ===

class ChecklistExhibitionType:
    IN_HOUSE = 'in_house'
    INCOMING_TRAVELING = 'incoming_traveling'
    OUTGOING_TRAVELING = 'outgoing_traveling'
    GENERAL = 'general'

    ALL = [IN_HOUSE, INCOMING_TRAVELING, OUTGOING_TRAVELING, GENERAL]


class ChecklistPhase:
    PLANNING = 'planning'
    PRE_INSTALL = 'pre_install'
    INSTALL = 'install'
    OPEN = 'open'
    CLOSE = 'close'
    DEINSTALL = 'deinstall'
    TRAVEL = 'travel'

    ALL = [PLANNING, PRE_INSTALL, INSTALL, OPEN, CLOSE, DEINSTALL, TRAVEL]

    # Display labels
    LABELS = {
        PLANNING: 'Planning',
        PRE_INSTALL: 'Pre-Install',
        INSTALL: 'Install',
        OPEN: 'Open',
        CLOSE: 'Close',
        DEINSTALL: 'Deinstall',
        TRAVEL: 'Travel',
    }


class ChecklistRole:
    CURATOR = 'curator'
    REGISTRAR = 'registrar'
    EXHIBITIONS_MANAGER = 'exhibitions_manager'
    PREPARATOR = 'preparator'
    CONSERVATION = 'conservation'
    MARKETING = 'marketing'
    EDUCATION = 'education'
    SECURITY = 'security'
    FACILITIES = 'facilities'

    ALL = [CURATOR, REGISTRAR, EXHIBITIONS_MANAGER, PREPARATOR, CONSERVATION, MARKETING, EDUCATION, SECURITY, FACILITIES]

    LABELS = {
        CURATOR: 'Curator',
        REGISTRAR: 'Registrar',
        EXHIBITIONS_MANAGER: 'Exhibitions Manager',
        PREPARATOR: 'Preparator',
        CONSERVATION: 'Conservation',
        MARKETING: 'Marketing',
        EDUCATION: 'Education',
        SECURITY: 'Security',
        FACILITIES: 'Facilities',
    }


class ChecklistItemStatus:
    TODO = 'todo'
    IN_PROGRESS = 'in_progress'
    BLOCKED = 'blocked'
    DONE = 'done'
    NOT_APPLICABLE = 'not_applicable'

    ALL = [TODO, IN_PROGRESS, BLOCKED, DONE, NOT_APPLICABLE]

    LABELS = {
        TODO: 'To Do',
        IN_PROGRESS: 'In Progress',
        BLOCKED: 'Blocked',
        DONE: 'Done',
        NOT_APPLICABLE: 'N/A',
    }


class ChecklistLinkEntityType:
    LOAN = 'loan'
    SHIPMENT = 'shipment'
    DOCUMENT = 'document'
    COLLECTION_OBJECT = 'collection_object'
    BUDGET_LINE = 'budget_line'
    EXHIBITION_OBJECT = 'exhibition_object'
    INSURANCE_RECORD = 'insurance_record'
    INFO_REQUEST = 'info_request'

    ALL = [LOAN, SHIPMENT, DOCUMENT, COLLECTION_OBJECT, BUDGET_LINE, EXHIBITION_OBJECT, INSURANCE_RECORD, INFO_REQUEST]


# === MODELS ===

class ChecklistTemplate(Base):
    """Reusable checklist template for exhibitions."""
    __tablename__ = 'checklist_templates'

    template_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    organization_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('organizations.organization_id', ondelete='CASCADE'), nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    exhibition_type: Mapped[str] = mapped_column(String(30), nullable=False, server_default='general')
    is_archived: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default='false')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text('NOW()'), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text('NOW()'), nullable=False)
    created_by: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)

    # Relationships
    versions: Mapped[List["ChecklistTemplateVersion"]] = relationship(back_populates="template", cascade="all, delete-orphan")


class ChecklistTemplateVersion(Base):
    """Immutable version of a checklist template."""
    __tablename__ = 'checklist_template_versions'
    __table_args__ = (
        UniqueConstraint('template_id', 'version_number', name='uq_template_version_number'),
    )

    version_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    template_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('checklist_templates.template_id', ondelete='CASCADE'), nullable=False)
    version_number: Mapped[int] = mapped_column(Integer, nullable=False)
    is_published: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default='false')
    is_locked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default='false')
    change_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text('NOW()'), nullable=False)
    created_by: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)

    # Relationships
    template: Mapped["ChecklistTemplate"] = relationship(back_populates="versions")
    items: Mapped[List["ChecklistTemplateItem"]] = relationship(back_populates="version", cascade="all, delete-orphan")
    checklists: Mapped[List["ExhibitionChecklist"]] = relationship(back_populates="template_version")


class ChecklistTemplateItem(Base):
    """Item within a template version."""
    __tablename__ = 'checklist_template_items'

    template_item_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    version_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('checklist_template_versions.version_id', ondelete='CASCADE'), nullable=False)
    phase: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    responsible_role: Mapped[str] = mapped_column(String(30), nullable=False)
    default_due_offset_days: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default='0')
    is_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default='true')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text('NOW()'), nullable=False)

    # Relationships
    version: Mapped["ChecklistTemplateVersion"] = relationship(back_populates="items")


class ExhibitionChecklist(Base):
    """Checklist instance attached to an exhibition."""
    __tablename__ = 'exhibition_checklists'

    checklist_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    exhibition_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('collections.exhibitions.exhibition_id', ondelete='CASCADE'), nullable=False)
    template_version_id: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('checklist_template_versions.version_id', ondelete='SET NULL'), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text('NOW()'), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text('NOW()'), nullable=False)
    created_by: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)

    # Relationships
    template_version: Mapped[Optional["ChecklistTemplateVersion"]] = relationship(back_populates="checklists")
    items: Mapped[List["ChecklistItem"]] = relationship(back_populates="checklist", cascade="all, delete-orphan")


class ChecklistItem(Base):
    """Actual checklist item for an exhibition."""
    __tablename__ = 'checklist_items'

    item_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    checklist_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('exhibition_checklists.checklist_id', ondelete='CASCADE'), nullable=False)
    source_template_item_id: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('checklist_template_items.template_item_id', ondelete='SET NULL'), nullable=True)
    phase: Mapped[str] = mapped_column(String(20), nullable=False)
    title: Mapped[str] = mapped_column(String(500), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    responsible_role: Mapped[str] = mapped_column(String(30), nullable=False)
    assigned_user_id: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)
    due_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, server_default='todo')
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default='0')
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text('NOW()'), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text('NOW()'), nullable=False)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    completed_by: Mapped[Optional[UUID]] = mapped_column(PGUUID(as_uuid=True), ForeignKey('users.user_id', ondelete='SET NULL'), nullable=True)

    # Relationships
    checklist: Mapped["ExhibitionChecklist"] = relationship(back_populates="items")
    links: Mapped[List["ChecklistItemLink"]] = relationship(back_populates="item", cascade="all, delete-orphan")


class ChecklistItemLink(Base):
    """Link from a checklist item to another entity."""
    __tablename__ = 'checklist_item_links'
    __table_args__ = (
        UniqueConstraint('item_id', 'linked_entity_type', 'linked_entity_id', name='uq_checklist_item_link'),
    )

    link_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    item_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey('checklist_items.item_id', ondelete='CASCADE'), nullable=False)
    linked_entity_type: Mapped[str] = mapped_column(String(30), nullable=False)
    linked_entity_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=text('NOW()'), nullable=False)

    # Relationships
    item: Mapped["ChecklistItem"] = relationship(back_populates="links")
