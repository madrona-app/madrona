"""
Exhibition Budget models.

Lightweight budgeting tool for tracking estimated vs actual costs.
"""

from datetime import datetime
from sqlalchemy import (
    Column, String, Text, DateTime, ForeignKey, Numeric, Integer, Index
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid

from app.database import Base


class BudgetCategory:
    """Budget category constants."""
    SHIPPING = 'shipping'
    INSURANCE = 'insurance'
    FABRICATION = 'fabrication'
    PRINTING = 'printing'
    TRAVEL = 'travel'
    INSTALLATION = 'installation'
    MOUNTS = 'mounts'
    CONSERVATION = 'conservation'
    RIGHTS = 'rights'
    MARKETING = 'marketing'
    OTHER = 'other'

    ALL = [
        SHIPPING, INSURANCE, FABRICATION, PRINTING, TRAVEL,
        INSTALLATION, MOUNTS, CONSERVATION, RIGHTS, MARKETING, OTHER
    ]

    LABELS = {
        SHIPPING: 'Shipping',
        INSURANCE: 'Insurance',
        FABRICATION: 'Fabrication',
        PRINTING: 'Printing',
        TRAVEL: 'Travel',
        INSTALLATION: 'Installation',
        MOUNTS: 'Mounts & Frames',
        CONSERVATION: 'Conservation',
        RIGHTS: 'Rights & Licensing',
        MARKETING: 'Marketing',
        OTHER: 'Other',
    }


class BudgetLinkEntityType:
    """Types of entities that can be linked to budget lines."""
    SHIPMENT = 'shipment'
    LOAN = 'loan'
    CHECKLIST_ITEM = 'checklist_item'
    INFO_REQUEST = 'info_request'

    ALL = [SHIPMENT, LOAN, CHECKLIST_ITEM, INFO_REQUEST]


class ExhibitionBudgetLine(Base):
    """A single budget line item for an exhibition."""

    __tablename__ = 'exhibition_budget_lines'
    __table_args__ = (
        Index('ix_budget_lines_exhibition', 'exhibition_id'),
        Index('ix_budget_lines_category', 'category'),
        {'schema': 'collections'}
    )

    line_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    exhibition_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.exhibitions.exhibition_id', ondelete='CASCADE'),
        nullable=False
    )
    category = Column(String(50), nullable=False)
    description = Column(String(500), nullable=False)
    estimated_amount = Column(Numeric(12, 2), nullable=False, default=0)
    actual_amount = Column(Numeric(12, 2), nullable=True)
    vendor = Column(String(255), nullable=True)
    notes = Column(Text, nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)

    # Currency (stored but UX kept simple - single currency per exhibition)
    currency_code = Column(String(3), nullable=False, default='USD')

    # Audit
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    updated_by = Column(UUID(as_uuid=True), nullable=True)

    # Relationships
    links = relationship(
        'BudgetLineLink',
        back_populates='budget_line',
        cascade='all, delete-orphan',
        lazy='selectin'
    )


class BudgetLineLink(Base):
    """Links budget lines to other entities (shipments, loans, checklist items)."""

    __tablename__ = 'budget_line_links'
    __table_args__ = (
        Index('ix_budget_links_line', 'line_id'),
        Index('ix_budget_links_entity', 'entity_type', 'entity_id'),
        {'schema': 'collections'}
    )

    link_id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4
    )
    line_id = Column(
        UUID(as_uuid=True),
        ForeignKey('collections.exhibition_budget_lines.line_id', ondelete='CASCADE'),
        nullable=False
    )
    entity_type = Column(String(50), nullable=False)
    entity_id = Column(UUID(as_uuid=True), nullable=False)
    label = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    # Relationships
    budget_line = relationship('ExhibitionBudgetLine', back_populates='links')
