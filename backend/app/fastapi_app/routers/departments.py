"""
Department CRUD and membership endpoints (FastAPI).

Manages organizational departments and user membership assignments.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_auth, require_permission
from app.fastapi_app.schemas.common import MessageResponse
from app.fastapi_app.schemas.departments import (
    DepartmentMembershipOut,
    DepartmentOut,
    UserDepartmentOut,
)
from app.models.departments import Department, DepartmentMembership
from app.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter(tags=["departments"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_department(dept: Department) -> dict:
    return {
        "department_id": str(dept.department_id),
        "organization_id": str(dept.organization_id),
        "name": dept.name,
        "code": dept.code,
        "description": dept.description,
        "parent_id": str(dept.parent_id) if dept.parent_id else None,
        "path": dept.path,
        "depth": dept.depth,
        "head_user_id": str(dept.head_user_id) if dept.head_user_id else None,
        "color": dept.color,
        "sort_order": dept.sort_order,
        "is_active": dept.is_active,
        "member_count": len(dept.members) if dept.members else 0,
        "created_at": dept.created_at.isoformat() if dept.created_at else None,
    }


def _serialize_membership(m: DepartmentMembership) -> dict:
    return {
        "membership_id": str(m.membership_id),
        "department_id": str(m.department_id),
        "organization_id": str(m.organization_id),
        "user_id": str(m.user_id),
        "role": m.role,
        "is_primary": m.is_primary,
        "created_at": m.created_at.isoformat() if m.created_at else None,
    }


# ============================================================================
# DEPARTMENT CRUD
# ============================================================================


@router.get("/api/organizations/{organization_id}/departments", response_model=list[DepartmentOut], summary="List departments")
def list_departments(
    organization_id: UUID,
    active_only: bool = Query(True),
    auth: AuthContext = Depends(require_permission(Permission.DEPARTMENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List departments for an organization."""
    query = db.query(Department).filter(
        Department.organization_id == organization_id
    )

    if active_only:
        query = query.filter(Department.is_active == True)

    departments = query.options(
        joinedload(Department.members)
    ).order_by(Department.sort_order, Department.name).all()

    return [_serialize_department(d) for d in departments]


@router.post("/api/organizations/{organization_id}/departments", status_code=201, response_model=DepartmentOut, summary="Create department")
def create_department(
    organization_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DEPARTMENTS_CREATE)),
    db: Session = Depends(get_db),
):
    """Create a new department."""
    if not data.get("name"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing required field: name",
        })
    if not data.get("code"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing required field: code",
        })

    dept = Department(
        organization_id=organization_id,
        name=data["name"],
        code=data["code"],
        description=data.get("description"),
        parent_id=UUID(data["parent_id"]) if data.get("parent_id") else None,
        path=data.get("path", "/"),
        depth=data.get("depth", 0),
        head_user_id=UUID(data["head_user_id"]) if data.get("head_user_id") else None,
        contact_email=data.get("contact_email"),
        contact_phone=data.get("contact_phone"),
        color=data.get("color"),
        sort_order=data.get("sort_order", 0),
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )

    try:
        db.add(dept)
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "A department with this code already exists in this organization",
        })

    db.commit()
    dept = db.query(Department).options(
        joinedload(Department.members)
    ).get(dept.department_id)

    return _serialize_department(dept)


@router.get("/api/organizations/{organization_id}/departments/{dept_id}", response_model=DepartmentOut, summary="Get department")
def get_department(
    organization_id: UUID,
    dept_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DEPARTMENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get a single department."""
    dept = db.query(Department).options(
        joinedload(Department.members)
    ).filter(
        Department.department_id == dept_id,
        Department.organization_id == organization_id,
    ).first()

    if not dept:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Department not found",
        })

    return _serialize_department(dept)


@router.put("/api/organizations/{organization_id}/departments/{dept_id}", response_model=DepartmentOut, summary="Update department")
def update_department(
    organization_id: UUID,
    dept_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DEPARTMENTS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update a department."""
    dept = db.query(Department).filter(
        Department.department_id == dept_id,
        Department.organization_id == organization_id,
    ).first()

    if not dept:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Department not found",
        })

    updatable_fields = [
        "name", "code", "description", "path", "depth",
        "contact_email", "contact_phone", "color", "sort_order", "is_active",
    ]
    for field in updatable_fields:
        if field in data:
            setattr(dept, field, data[field])

    if "parent_id" in data:
        dept.parent_id = UUID(data["parent_id"]) if data["parent_id"] else None
    if "head_user_id" in data:
        dept.head_user_id = UUID(data["head_user_id"]) if data["head_user_id"] else None

    dept.updated_by = auth.user_id

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "A department with this code already exists in this organization",
        })

    dept = db.query(Department).options(
        joinedload(Department.members)
    ).get(dept.department_id)

    return _serialize_department(dept)


@router.delete("/api/organizations/{organization_id}/departments/{dept_id}", response_model=MessageResponse, summary="Delete department")
def delete_department(
    organization_id: UUID,
    dept_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DEPARTMENTS_DELETE)),
    db: Session = Depends(get_db),
):
    """Soft-delete a department (set is_active=False)."""
    dept = db.query(Department).filter(
        Department.department_id == dept_id,
        Department.organization_id == organization_id,
    ).first()

    if not dept:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Department not found",
        })

    dept.is_active = False
    dept.updated_by = auth.user_id
    db.commit()

    return {"message": "Department deactivated"}


# ============================================================================
# DEPARTMENT MEMBERSHIP
# ============================================================================


@router.get("/api/organizations/{organization_id}/departments/{dept_id}/members", response_model=list[DepartmentMembershipOut], summary="List department members")
def list_department_members(
    organization_id: UUID,
    dept_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DEPARTMENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List members of a department."""
    members = db.query(DepartmentMembership).filter(
        DepartmentMembership.department_id == dept_id,
        DepartmentMembership.organization_id == organization_id,
    ).all()

    return [_serialize_membership(m) for m in members]


@router.post("/api/organizations/{organization_id}/departments/{dept_id}/members", status_code=201, response_model=DepartmentMembershipOut, summary="Add department member")
def add_department_member(
    organization_id: UUID,
    dept_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DEPARTMENTS_MANAGE_MEMBERS)),
    db: Session = Depends(get_db),
):
    """Add a member to a department."""
    if not data.get("user_id"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Missing required field: user_id",
        })

    user_uuid = UUID(data["user_id"])
    role = data.get("role", "viewer")
    is_primary = data.get("is_primary", False)

    # If setting as primary, unset any existing primary for this user/org
    if is_primary:
        db.query(DepartmentMembership).filter(
            DepartmentMembership.user_id == user_uuid,
            DepartmentMembership.organization_id == organization_id,
            DepartmentMembership.is_primary == True,
        ).update({"is_primary": False})

    membership = DepartmentMembership(
        organization_id=organization_id,
        department_id=dept_id,
        user_id=user_uuid,
        role=role,
        is_primary=is_primary,
        created_by=auth.user_id,
    )

    try:
        db.add(membership)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "User is already a member of this department",
        })

    return _serialize_membership(membership)


@router.put("/api/organizations/{organization_id}/departments/{dept_id}/members/{membership_id}", response_model=DepartmentMembershipOut, summary="Update department member")
def update_department_member(
    organization_id: UUID,
    dept_id: UUID,
    membership_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.DEPARTMENTS_MANAGE_MEMBERS)),
    db: Session = Depends(get_db),
):
    """Update a department membership (role, is_primary)."""
    membership = db.query(DepartmentMembership).filter(
        DepartmentMembership.membership_id == membership_id,
        DepartmentMembership.organization_id == organization_id,
    ).first()

    if not membership:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Membership not found",
        })

    if "role" in data:
        membership.role = data["role"]

    if data.get("is_primary"):
        # Unset existing primary for this user/org
        db.query(DepartmentMembership).filter(
            DepartmentMembership.user_id == membership.user_id,
            DepartmentMembership.organization_id == organization_id,
            DepartmentMembership.is_primary == True,
            DepartmentMembership.membership_id != membership_id,
        ).update({"is_primary": False})
        membership.is_primary = True
    elif "is_primary" in data:
        membership.is_primary = data["is_primary"]

    db.commit()
    return _serialize_membership(membership)


@router.delete("/api/organizations/{organization_id}/departments/{dept_id}/members/{membership_id}", response_model=MessageResponse, summary="Remove department member")
def remove_department_member(
    organization_id: UUID,
    dept_id: UUID,
    membership_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DEPARTMENTS_MANAGE_MEMBERS)),
    db: Session = Depends(get_db),
):
    """Remove a member from a department."""
    membership = db.query(DepartmentMembership).filter(
        DepartmentMembership.membership_id == membership_id,
        DepartmentMembership.organization_id == organization_id,
    ).first()

    if not membership:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Membership not found",
        })

    db.delete(membership)
    db.commit()

    return {"message": "Member removed from department"}


@router.get("/api/organizations/{organization_id}/users/{user_id}/departments", response_model=list[UserDepartmentOut], summary="List user departments")
def list_user_departments(
    organization_id: UUID,
    user_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.DEPARTMENTS_VIEW)),
    db: Session = Depends(get_db),
):
    """List departments a user belongs to."""
    memberships = db.query(DepartmentMembership).options(
        joinedload(DepartmentMembership.department)
    ).filter(
        DepartmentMembership.user_id == user_id,
        DepartmentMembership.organization_id == organization_id,
    ).all()

    result = []
    for m in memberships:
        entry = _serialize_membership(m)
        if m.department:
            entry["department_name"] = m.department.name
            entry["department_code"] = m.department.code
            entry["department_color"] = m.department.color
        result.append(entry)

    return result
