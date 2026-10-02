"""
Task models - user task management.

This module defines the SQLAlchemy models for the Tasks feature,
which provides users with a unified task management experience
across all applications.
"""
from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import (
    DateTime,
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# STATUS AND PRIORITY CONSTANTS
# ============================================================================

class TaskStatus:
    """Valid task statuses."""
    TODO = 'todo'
    IN_PROGRESS = 'in_progress'
    BLOCKED = 'blocked'
    DONE = 'done'
    ALL = [TODO, IN_PROGRESS, BLOCKED, DONE]
    LABELS = {
        TODO: 'To Do',
        IN_PROGRESS: 'In Progress',
        BLOCKED: 'Blocked',
        DONE: 'Done',
    }


class TaskPriority:
    """Valid task priorities."""
    LOW = 'low'
    NORMAL = 'normal'
    HIGH = 'high'
    URGENT = 'urgent'
    ALL = [LOW, NORMAL, HIGH, URGENT]
    LABELS = {
        LOW: 'Low',
        NORMAL: 'Normal',
        HIGH: 'High',
        URGENT: 'Urgent',
    }


class RelatedEntityType:
    """Valid related entity types for task linking."""
    EXHIBITION = 'exhibition'
    COLLECTION_OBJECT = 'collection_object'
    CONDITION_REPORT = 'condition_report'
    LOAN_IN = 'loan_in'
    LOAN_OUT = 'loan_out'
    ACQUISITION = 'acquisition'
    CONSERVATION = 'conservation'
    MEDIA = 'media'
    ALL = [
        EXHIBITION, COLLECTION_OBJECT, CONDITION_REPORT,
        LOAN_IN, LOAN_OUT, ACQUISITION, CONSERVATION, MEDIA
    ]


# ============================================================================
# TASK MODEL
# ============================================================================

class Task(Base):
    """
    Task record for the My Tasks feature.

    Tasks can be assigned to users and optionally linked to related
    records like exhibitions, collection objects, or condition reports.
    """
    __tablename__ = 'tasks'

    task_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Content
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Status & Priority
    status: Mapped[str] = mapped_column(String(20), nullable=False, default=TaskStatus.TODO)
    priority: Mapped[str] = mapped_column(String(20), nullable=False, default=TaskPriority.NORMAL)

    # Assignment
    assigned_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Dates
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = timestamp_now()
    updated_at: Mapped[datetime] = timestamp_updated()
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    # Audit
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    completed_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Product context (which app the task was created in: 'collections', 'media', etc.)
    app_context: Mapped[str | None] = mapped_column(String(30), nullable=True)

    # Related entity link (optional)
    related_entity_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    related_entity_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="Task.organization_id == Organization.organization_id",
    )
    assigned_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[assigned_user_id],
        primaryjoin="Task.assigned_user_id == User.user_id",
    )
    creator: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="Task.created_by == User.user_id",
    )
    completer: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[completed_by],
        primaryjoin="Task.completed_by == User.user_id",
    )

    __table_args__ = (
        Index("ix_tasks_organization_id", "organization_id"),
        Index("ix_tasks_assigned_user_id", "assigned_user_id"),
        Index("ix_tasks_status", "status"),
        Index("ix_tasks_due_date", "due_date"),
        Index("ix_tasks_org_assigned_status", "organization_id", "assigned_user_id", "status"),
        Index("ix_tasks_related_entity", "related_entity_type", "related_entity_id"),
        CheckConstraint(
            "status IN ('todo', 'in_progress', 'blocked', 'done')",
            name="check_task_status",
        ),
        CheckConstraint(
            "priority IN ('low', 'normal', 'high', 'urgent')",
            name="check_task_priority",
        ),
    )

    def to_dict(self) -> dict[str, Any]:
        """Serialize task to dictionary."""
        return {
            'task_id': str(self.task_id),
            'organization_id': str(self.organization_id),
            'title': self.title,
            'description': self.description,
            'status': self.status,
            'status_label': TaskStatus.LABELS.get(self.status, self.status),
            'priority': self.priority,
            'priority_label': TaskPriority.LABELS.get(self.priority, self.priority),
            'assigned_user_id': str(self.assigned_user_id) if self.assigned_user_id else None,
            'assigned_user_name': self.assigned_user.display_name if self.assigned_user else None,
            'due_date': self.due_date.isoformat() if self.due_date else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
            'completed_at': self.completed_at.isoformat() if self.completed_at else None,
            'created_by': str(self.created_by) if self.created_by else None,
            'completed_by': str(self.completed_by) if self.completed_by else None,
            'app_context': self.app_context,
            'related_entity_type': self.related_entity_type,
            'related_entity_id': str(self.related_entity_id) if self.related_entity_id else None,
        }
