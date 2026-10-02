"""
Custom role management API.

Endpoints for creating, reading, updating, and deleting org-scoped custom roles.
System roles are read-only. Custom roles have flat permission sets (no inheritance).

All endpoints require org.manage_roles permission.
"""

import re
import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, func, or_, and_
from sqlalchemy.orm import Session

from app.fastapi_app.dependencies.auth import require_auth, require_permission, get_db, AuthContext
from app.permissions import Permission

logger = logging.getLogger(__name__)
router = APIRouter()


# =============================================================================
# Request/Response Models
# =============================================================================

class CreateRoleRequest(BaseModel):
    display_name: str
    description: str | None = None
    clone_from_role_id: str | None = None


class UpdateRoleRequest(BaseModel):
    display_name: str | None = None
    description: str | None = None


class SetPermissionsRequest(BaseModel):
    permission_ids: list[str]


class RoleDetailOut(BaseModel):
    role_id: str
    role_key: str
    display_name: str
    description: str | None = None
    is_system: bool
    is_active: bool
    cloned_from_name: str | None = None
    member_count: int = 0
    permission_count: int = 0


class RoleListResponse(BaseModel):
    roles: list[RoleDetailOut]


class PermissionItemOut(BaseModel):
    permission_id: str
    permission_key: str
    display_name: str
    description: str | None = None
    granted: bool


class PermissionGroupOut(BaseModel):
    scope: str
    permissions: list[PermissionItemOut]


class RolePermissionsResponse(BaseModel):
    role_id: str
    groups: list[PermissionGroupOut]


# =============================================================================
# Helpers
# =============================================================================

def _slugify(name: str) -> str:
    """Convert display name to a role_key slug."""
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9]+', '_', slug)
    slug = slug.strip('_')
    return slug[:50]


def _get_role_detail(role, db: Session, org_id: UUID) -> dict:
    """Build a RoleDetailOut dict for a role."""
    from app.models import OrganizationMembership, RolePermission, Role

    member_count = db.query(func.count(OrganizationMembership.membership_id)).filter(
        OrganizationMembership.role_id == role.role_id,
        OrganizationMembership.organization_id == org_id,
        OrganizationMembership.status == 'active',
    ).scalar() or 0

    permission_count = db.query(func.count(RolePermission.permission_id)).filter(
        RolePermission.role_id == role.role_id,
    ).scalar() or 0

    cloned_from_name = None
    if role.cloned_from:
        source = db.query(Role).filter_by(role_id=role.cloned_from).first()
        if source:
            cloned_from_name = source.display_name

    return {
        "role_id": str(role.role_id),
        "role_key": role.role_key,
        "display_name": role.display_name,
        "description": role.description,
        "is_system": role.is_system,
        "is_active": role.is_active,
        "cloned_from_name": cloned_from_name,
        "member_count": member_count,
        "permission_count": permission_count,
    }


# =============================================================================
# GET /api/organizations/{org_id}/custom-roles
# =============================================================================

@router.get("/api/organizations/{org_id}/custom-roles", response_model=RoleListResponse, summary="List roles")
def list_roles(
    org_id: UUID,
    # ignore_role_override: the Test Role UI itself depends on this endpoint to
    # populate its picker, so platform admins must retain access even when an
    # override is active.
    auth: AuthContext = Depends(
        require_permission(Permission.ORG_MANAGE_MEMBERS, ignore_role_override=True)
    ),
    db: Session = Depends(get_db),
):
    """List system roles (read-only) and org custom roles."""
    from app.models import Role

    roles = (
        db.query(Role)
        .filter(
            or_(
                Role.is_system == True,
                and_(Role.organization_id == org_id, Role.is_active == True),
            ),
            Role.role_key != 'platform_admin',
        )
        .order_by(Role.is_system.desc(), Role.display_name)
        .all()
    )

    return {
        "roles": [_get_role_detail(role, db, org_id) for role in roles],
    }


# =============================================================================
# POST /api/organizations/{org_id}/custom-roles
# =============================================================================

@router.post("/api/organizations/{org_id}/custom-roles", status_code=201, summary="Create role")
def create_role(
    org_id: UUID,
    body: CreateRoleRequest,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Create a new custom role, optionally cloned from an existing role."""
    from app.models import Role, RolePermission, Permission as PermissionModel

    if not body.display_name or not body.display_name.strip():
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "display_name is required",
        })

    role_key = _slugify(body.display_name)
    if not role_key:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "display_name must contain alphanumeric characters",
        })

    # Reject collisions with a SYSTEM role key before checking the org.
    #
    # Role keys are slugified display names, so "Registrar" and "Platform
    # Admin" produce the system keys. The boot seed grants permissions by
    # role_key; until that was scoped to system roles a colliding custom role
    # inherited the system role's whole permission set. Both ends are fixed —
    # this one keeps the two namespaces from overlapping in the first place,
    # and gives the admin a clear message instead of a silent escalation.
    system_collision = db.query(Role).filter(
        Role.organization_id.is_(None),
        Role.role_key == role_key,
    ).first()
    if system_collision:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"'{role_key}' is a built-in role key. Choose a different name.",
        })

    # Check uniqueness within org
    existing = db.query(Role).filter(
        Role.organization_id == org_id,
        Role.role_key == role_key,
        Role.is_active == True,
    ).first()
    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"A role with key '{role_key}' already exists in this organization",
        })

    # Create the role
    new_role = Role(
        role_key=role_key,
        display_name=body.display_name.strip(),
        description=body.description,
        is_system=False,
        organization_id=org_id,
        cloned_from=UUID(body.clone_from_role_id) if body.clone_from_role_id else None,
        is_active=True,
    )
    db.add(new_role)
    db.flush()  # Get role_id

    # Clone permissions if source role specified
    if body.clone_from_role_id:
        source_role_id = UUID(body.clone_from_role_id)
        source_permissions = (
            db.query(RolePermission.permission_id)
            .filter(RolePermission.role_id == source_role_id)
            .all()
        )
        for (perm_id,) in source_permissions:
            # Don't clone platform.admin
            perm = db.query(PermissionModel).filter_by(permission_id=perm_id).first()
            if perm and perm.permission_key == 'platform.admin':
                continue
            db.add(RolePermission(role_id=new_role.role_id, permission_id=perm_id))

    db.commit()

    logger.info(
        "custom_role_created org_id=%s role_id=%s role_key=%s cloned_from=%s by=%s",
        org_id, new_role.role_id, role_key, body.clone_from_role_id, auth.user_id,
    )

    return _get_role_detail(new_role, db, org_id)


# =============================================================================
# GET /api/organizations/{org_id}/custom-roles/{role_id}
# =============================================================================

@router.get("/api/organizations/{org_id}/custom-roles/{role_id}", summary="Get role")
def get_role(
    org_id: UUID,
    role_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Get role detail."""
    from app.models import Role

    role = db.query(Role).filter_by(role_id=role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Role not found",
        })

    # Custom roles must belong to this org
    if not role.is_system and role.organization_id != org_id:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Role not found",
        })

    return _get_role_detail(role, db, org_id)


# =============================================================================
# PUT /api/organizations/{org_id}/custom-roles/{role_id}
# =============================================================================

@router.put("/api/organizations/{org_id}/custom-roles/{role_id}", summary="Update role")
def update_role(
    org_id: UUID,
    role_id: UUID,
    body: UpdateRoleRequest,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Update custom role display_name and description. System roles are read-only."""
    from app.models import Role

    role = db.query(Role).filter_by(role_id=role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Role not found",
        })

    if role.is_system:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden", "message": "System roles cannot be modified",
        })

    if role.organization_id != org_id:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Role not found",
        })

    if body.display_name is not None:
        role.display_name = body.display_name.strip()
        role.role_key = _slugify(body.display_name)
    if body.description is not None:
        role.description = body.description

    db.commit()
    return _get_role_detail(role, db, org_id)


# =============================================================================
# DELETE /api/organizations/{org_id}/custom-roles/{role_id}
# =============================================================================

@router.delete("/api/organizations/{org_id}/custom-roles/{role_id}", summary="Delete role")
def delete_role(
    org_id: UUID,
    role_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Soft-delete a custom role. Fails if members are assigned."""
    from app.models import Role, OrganizationMembership

    role = db.query(Role).filter_by(role_id=role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Role not found",
        })

    if role.is_system:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden", "message": "System roles cannot be deleted",
        })

    if role.organization_id != org_id:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Role not found",
        })

    # Check if any members are assigned
    member_count = db.query(func.count(OrganizationMembership.membership_id)).filter(
        OrganizationMembership.role_id == role_id,
        OrganizationMembership.organization_id == org_id,
        OrganizationMembership.status == 'active',
    ).scalar() or 0

    if member_count > 0:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"Cannot delete role with {member_count} active member(s). Reassign them first.",
        })

    role.is_active = False
    db.commit()

    logger.info(
        "custom_role_deactivated org_id=%s role_id=%s role_key=%s by=%s",
        org_id, role_id, role.role_key, auth.user_id,
    )

    return {"status": "deleted", "role_id": str(role_id)}


# =============================================================================
# GET /api/organizations/{org_id}/custom-roles/{role_id}/permissions
# =============================================================================

@router.get("/api/organizations/{org_id}/custom-roles/{role_id}/permissions", response_model=RolePermissionsResponse, summary="Get role permissions")
def get_role_permissions(
    org_id: UUID,
    role_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Get all permissions grouped by scope, with granted status for this role."""
    from app.models import Role, RolePermission, Permission as PermissionModel

    role = db.query(Role).filter_by(role_id=role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Role not found",
        })
    if not role.is_system and role.organization_id != org_id:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Role not found",
        })

    # Get all permissions
    all_permissions = (
        db.query(PermissionModel)
        .filter(PermissionModel.permission_key != 'platform.admin')
        .order_by(PermissionModel.scope, PermissionModel.display_name)
        .all()
    )

    # Get granted permission IDs for this role
    if role.is_system:
        # For system roles, include inherited permissions
        from app.services.rbac_service import resolve_permissions_with_inheritance
        granted_keys = resolve_permissions_with_inheritance(role.role_key, session=db)
        granted_ids = {
            p.permission_id
            for p in db.query(PermissionModel).filter(PermissionModel.permission_key.in_(granted_keys)).all()
        } if granted_keys else set()
    else:
        # Custom roles: direct grants only
        granted_ids = {
            row[0] for row in
            db.query(RolePermission.permission_id).filter(RolePermission.role_id == role_id).all()
        }

    # Group by scope
    groups: dict[str, list] = {}
    for perm in all_permissions:
        if perm.scope not in groups:
            groups[perm.scope] = []
        groups[perm.scope].append({
            "permission_id": str(perm.permission_id),
            "permission_key": perm.permission_key,
            "display_name": perm.display_name,
            "description": perm.description,
            "granted": perm.permission_id in granted_ids,
        })

    return {
        "role_id": str(role_id),
        "groups": [
            {"scope": scope, "permissions": perms}
            for scope, perms in sorted(groups.items())
        ],
    }


# =============================================================================
# PUT /api/organizations/{org_id}/custom-roles/{role_id}/permissions
# =============================================================================

@router.put("/api/organizations/{org_id}/custom-roles/{role_id}/permissions", summary="Set role permissions")
def set_role_permissions(
    org_id: UUID,
    role_id: UUID,
    body: SetPermissionsRequest,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Replace the full permission set for a custom role. System roles are read-only."""
    from app.models import Role, RolePermission, Permission as PermissionModel, OrganizationMembership

    role = db.query(Role).filter_by(role_id=role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Role not found",
        })

    if role.is_system:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden", "message": "System role permissions cannot be modified",
        })

    if role.organization_id != org_id:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Role not found",
        })

    # Validate permission IDs
    new_perm_ids = {UUID(pid) for pid in body.permission_ids}

    # Block granting platform.admin
    platform_admin_perm = db.query(PermissionModel).filter_by(permission_key='platform.admin').first()
    if platform_admin_perm and platform_admin_perm.permission_id in new_perm_ids:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden", "message": "Cannot grant platform.admin to custom roles",
        })

    # Self-demotion guard: if the acting user is assigned this role,
    # ensure org.manage_roles stays in the set
    user_membership = db.query(OrganizationMembership).filter_by(
        user_id=auth.user_id,
        organization_id=org_id,
        role_id=role_id,
        status='active',
    ).first()
    if user_membership:
        manage_roles_perm = db.query(PermissionModel).filter_by(
            permission_key='org.manage_roles'
        ).first()
        if manage_roles_perm and manage_roles_perm.permission_id not in new_perm_ids:
            raise HTTPException(status_code=400, detail={
                "code": "self_demotion",
                "message": "Cannot remove org.manage_roles from your own active role",
            })

    # Replace permissions: delete existing, insert new
    db.query(RolePermission).filter(RolePermission.role_id == role_id).delete()

    for perm_id in new_perm_ids:
        db.add(RolePermission(role_id=role_id, permission_id=perm_id))

    db.commit()

    logger.info(
        "custom_role_permissions_updated org_id=%s role_id=%s permission_count=%d by=%s",
        org_id, role_id, len(new_perm_ids), auth.user_id,
    )

    return {
        "status": "updated",
        "role_id": str(role_id),
        "permission_count": len(new_perm_ids),
    }
