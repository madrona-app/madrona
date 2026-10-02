"""
Sequence counter model for atomic sequential number generation.

Prevents race conditions in concurrent number generation (e.g., loan numbers,
condition report numbers) by using INSERT ... ON CONFLICT DO UPDATE.
"""

import uuid

from sqlalchemy import Column, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


class SequenceCounter(Base):
    """
    Tracks the current counter value for a given (org, prefix, year) combination.

    Used by next_sequential_number() to atomically generate sequential IDs
    like LI2026.0001, CR2026.0003, etc.
    """

    __tablename__ = 'sequence_counters'
    __table_args__ = (
        UniqueConstraint(
            'organization_id', 'prefix', 'year',
            name='uq_sequence_counters_org_prefix_year',
        ),
        {'schema': 'collections'}
    )

    counter_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), nullable=False)
    prefix = Column(String(10), nullable=False)
    year = Column(Integer, nullable=False)
    current_value = Column(Integer, nullable=False, default=0)
