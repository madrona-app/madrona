"""Pydantic response models for department endpoints."""

from __future__ import annotations

from pydantic import BaseModel


class DepartmentOut(BaseModel):
    department_id: str
    organization_id: str
    name: str
    code: str | None = None
    description: str | None = None
    parent_id: str | None = None
    path: str | None = None
    depth: int | None = None
    head_user_id: str | None = None
    color: str | None = None
    sort_order: int | None = None
    is_active: bool = True
    member_count: int = 0
    created_at: str | None = None


class DepartmentMembershipOut(BaseModel):
    membership_id: str
    department_id: str
    organization_id: str
    user_id: str
    role: str | None = None
    is_primary: bool = False
    created_at: str | None = None


class UserDepartmentOut(DepartmentMembershipOut):
    department_name: str | None = None
    department_code: str | None = None
    department_color: str | None = None
