"""
Department and DepartmentMembership models.

Extracted from models_collections.py — organizational units for record-level
security and user access scoping within a museum/institution.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base
from app.models._helpers import uuid_pk, timestamp_now, timestamp_updated


# ============================================================================
# DEPARTMENTS - Organizational unit for record-level security
# ============================================================================

class Department(Base):
    """
    Organizational department within a museum/institution.

    Departments are the primary mechanism for record-level access control
    below the organization level. Objects, loans, acquisitions, and other
    records are assigned to a department, and users access records through
    their department membership(s).

    Supports hierarchical departments (e.g., "Art" -> "European Paintings"
    -> "Dutch & Flemish") via parent_id self-join with materialized path.

    Equivalent to TMS DepartmentID — used across Objects, Loans,
    Exhibitions, Media, Conservation, and Shipping for security scoping.
    """
    __tablename__ = "departments"

    department_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Identification
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    code: Mapped[str] = mapped_column(String(50), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Hierarchy
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="SET NULL"),
        nullable=True,
    )
    path: Mapped[str] = mapped_column(String(1000), nullable=False, default="/")
    depth: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # Contact
    head_user_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(50), nullable=True)

    # Display
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    color: Mapped[str | None] = mapped_column(String(7), nullable=True)

    # Status
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Audit
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
        primaryjoin="Department.organization_id == Organization.organization_id",
    )
    parent: Mapped["Department | None"] = relationship(
        "Department",
        remote_side="Department.department_id",
        foreign_keys=[parent_id],
        back_populates="children",
    )
    children: Mapped[list["Department"]] = relationship(
        "Department",
        back_populates="parent",
        foreign_keys="Department.parent_id",
    )
    head_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[head_user_id],
        primaryjoin="Department.head_user_id == User.user_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="Department.created_by == User.user_id",
    )
    updated_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[updated_by],
        primaryjoin="Department.updated_by == User.user_id",
    )
    members: Mapped[list["DepartmentMembership"]] = relationship(
        "DepartmentMembership",
        back_populates="department",
        cascade="all, delete-orphan",
    )

    __table_args__ = (
        Index("ix_departments_org_code", "organization_id", "code", unique=True),
        Index("ix_departments_org_parent", "organization_id", "parent_id"),
        Index("ix_departments_org_active", "organization_id", "is_active"),
        Index("ix_departments_path", "path"),
        {"schema": "collections"},
    )


# ============================================================================
# DEPARTMENT MEMBERSHIPS - User access to departments
# ============================================================================

class DepartmentMembership(Base):
    """
    Links users to departments with a department-scoped role.

    A user can belong to multiple departments (e.g., a registrar covering
    both European Paintings and Asian Art). Each membership carries its own
    role, allowing different access levels per department.

    The is_primary flag identifies the user's main department for default
    assignment of new records.

    Roles:
    - 'admin': Full control within department (assign objects, manage members)
    - 'curator': Create, edit, and delete records in department
    - 'editor': Create and edit records in department
    - 'viewer': Read-only access to department records
    """
    __tablename__ = "department_memberships"

    membership_id: Mapped[uuid.UUID] = uuid_pk()
    organization_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("organizations.organization_id", ondelete="CASCADE"),
        nullable=False,
    )
    department_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("collections.departments.department_id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="CASCADE"),
        nullable=False,
    )

    # Department-scoped role
    role: Mapped[str] = mapped_column(String(20), nullable=False, default="viewer")

    # Primary department flag
    is_primary: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Audit
    created_at: Mapped[datetime] = timestamp_now()
    created_by: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.user_id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        primaryjoin="DepartmentMembership.organization_id == Organization.organization_id",
    )
    department: Mapped["Department"] = relationship(
        "Department",
        back_populates="members",
    )
    user: Mapped["User"] = relationship(
        "User",
        foreign_keys=[user_id],
        primaryjoin="DepartmentMembership.user_id == User.user_id",
    )
    created_by_user: Mapped["User | None"] = relationship(
        "User",
        foreign_keys=[created_by],
        primaryjoin="DepartmentMembership.created_by == User.user_id",
    )

    __table_args__ = (
        UniqueConstraint("department_id", "user_id", name="uq_department_user"),
        Index("ix_dept_members_org", "organization_id"),
        Index("ix_dept_members_dept", "department_id"),
        Index("ix_dept_members_user", "user_id"),
        Index(
            "ix_dept_members_user_primary",
            "organization_id", "user_id",
            postgresql_where=text("is_primary = true"),
            unique=True,
        ),
        CheckConstraint(
            "role IN ('admin', 'curator', 'editor', 'viewer')",
            name="check_dept_membership_role",
        ),
        {"schema": "collections"},
    )


__all__ = [
    "Department",
    "DepartmentMembership",
]
