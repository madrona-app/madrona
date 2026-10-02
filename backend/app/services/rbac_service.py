"""
RBAC service for permission checking.

Provides canonical permission-based authorization that replaces role-string checks.
All authorization decisions should use check_permission() or @require_permission().

Uses the canonical permission model from app.permissions.

Usage:
    from app.services.rbac_service import check_permission, require_permission
    from app.permissions import Permission
    
    # In service code:
    if not check_permission(user_id, org_id, Permission.CONNECTORS_EDIT):
        raise PermissionDenied()
    
    # In route handlers:
    @bp.route('/connectors', methods=['POST'])
    @require_auth()
    @require_permission(Permission.CONNECTORS_EDIT)
    def create_connector():
        ...

FUTURE-PROOFING DESIGN:

Graceful Permission Handling:
- If permission doesn't exist in DB → check_permission() returns False
- If user doesn't have permission → returns False
- No crashes if permission enum added before migration runs
- Default-deny security (fail closed)

Adding New Permissions:
1. Add to Permission enum in app/permissions.py
2. Run migration to INSERT into permissions + role_permissions
3. Existing users with assigned roles gain permission automatically
4. New @require_permission() decorators work immediately after migration

Profile Switching (Future):
- get_user_permissions() will handle profile switches transparently
- Permissions tied to role_key, not profile
- Switching profile changes labels, not permissions
- No code changes needed when orgs switch profiles

Assumptions:
- Permissions are organization-scoped (not per-entity)
- User either has permission for ALL resources in org or NONE
- Permission checks are stateless (no caching required)
- Organizations inherit permission changes automatically
- No per-organization customization of permission sets
- Frontend checks are for UX only; backend always enforces

See docs/RBAC_MIGRATION_DESIGN.md for detailed design.
"""

import logging
from typing import Callable
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.sql import func

from app.database import current_session
from app.models import User, OrganizationMembership, Role, RolePermission, Permission as PermissionModel, AppRoleAssignment
from app.permissions import Permission, validate_permission, get_role_inheritance_chain

logger = logging.getLogger(__name__)


def _s(session=None):
    """Resolve DB session: use explicit session if provided, else current_session()."""
    if session is not None:
        return session
    return current_session()


def resolve_permissions_with_inheritance(role_key: str, session=None) -> set[str]:
    """
    Resolve all permissions for a system role including inherited permissions.

    Walks the role inheritance chain and gathers permissions from the role
    and all its ancestor roles. Only works for system roles.

    Args:
        role_key: Internal role identifier (e.g., 'registrar')

    Returns:
        Set of permission keys including inherited permissions

    Example:
        registrar inherits from curator → publisher → viewer
        Returns: union of permissions from all 4 roles
    """
    try:
        # Get the full inheritance chain (self + ancestors)
        role_chain = get_role_inheritance_chain(role_key)

        logger.debug(f"Resolving permissions for {role_key} with inheritance chain: {role_chain}")

        # Query permissions for all roles in the chain
        stmt = (
            select(PermissionModel.permission_key)
            .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
            .join(Role, Role.role_id == RolePermission.role_id)
            .where(Role.role_key.in_(role_chain))
        )

        result = _s(session).execute(stmt)
        permissions = {row[0] for row in result}

        logger.debug(
            f"Role {role_key} has {len(permissions)} permissions (including {len(role_chain)-1} inherited roles)"
        )

        return permissions

    except ValueError as e:
        # Invalid role or cycle detected
        logger.error(f"Error resolving role inheritance for {role_key}: {e}")
        return set()


def resolve_permissions_for_role(role_id: UUID | str, session=None) -> set[str]:
    """
    Resolve permissions for any role (system or custom).

    System roles: walk the inheritance chain (existing behavior).
    Custom roles: return explicit permission set (flat, no inheritance).

    Args:
        role_id: Role UUID

    Returns:
        Set of permission keys
    """
    if isinstance(role_id, str):
        role_id = UUID(role_id)

    s = _s(session)
    role = s.query(Role).filter_by(role_id=role_id).first()
    if not role or not role.is_active:
        return set()

    if role.is_system:
        return resolve_permissions_with_inheritance(role.role_key, session=s)
    else:
        # Custom role: flat permission set, no inheritance
        stmt = (
            select(PermissionModel.permission_key)
            .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
            .where(RolePermission.role_id == role_id)
        )
        result = s.execute(stmt)
        permissions = {row[0] for row in result}
        logger.debug(f"Custom role {role.role_key} (org {role.organization_id}) has {len(permissions)} permissions")
        return permissions


def get_user_permissions(user_id: UUID | str, organization_id: UUID | str, session=None) -> set[str]:
    """
    Get all permissions for a user in an organization.
    
    Includes permissions inherited from parent roles in the role hierarchy.
    
    Only returns permissions for:
    - Active users (status='active')
    - Active memberships (status='active')
    - Invited/suspended/deleted users get no permissions
    
    Args:
        user_id: User UUID
        organization_id: Organization UUID
        
    Returns:
        Set of permission keys (e.g., {'connectors.view', 'connectors.edit', ...})
        Empty set if user is not a member, not active, or membership deactivated.
    """
    # Convert strings to UUIDs if needed
    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)
    
    # First check if user is active
    user = _s(session).query(User).filter_by(user_id=user_id).first()
    if not user or user.status != 'active':
        logger.debug(
            f"User {user_id} denied permissions: user status is {user.status if user else 'not found'}"
        )
        return set()
    
    # Get user's role in the organization
    stmt = (
        select(Role.role_id, Role.role_key)
        .join(OrganizationMembership, OrganizationMembership.role_id == Role.role_id)
        .where(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.status == 'active'  # Only active memberships
        )
    )

    result = _s(session).execute(stmt).first()

    if not result:
        logger.debug(f"User {user_id} is not an active member of org {organization_id}")
        return set()

    role_id, role_key = result

    # Resolve permissions (handles both system and custom roles)
    permissions = resolve_permissions_for_role(role_id, session=session)

    logger.debug(
        f"User {user_id} has role {role_key} with {len(permissions)} permissions in org {organization_id}"
    )

    return permissions


# ==================== App-Specific Role Management ====================

# Valid app keys for app-specific role assignments
VALID_APP_KEYS = frozenset({'bridge', 'collections', 'media', 'reports'})


def get_user_role_for_app(
    user_id: UUID | str,
    organization_id: UUID | str,
    app_key: str | None = None,
    session=None
) -> str | None:
    """
    Get user's role for a specific app, with fallback to org default.

    This implements the per-app role override system:
    1. If app_key is provided, check for an app-specific override
    2. If no override exists (or app_key is None), return the org default role

    Args:
        user_id: User UUID
        organization_id: Organization UUID
        app_key: App identifier ('bridge', 'collections', 'media', 'reports')
                 If None, returns the org default role

    Returns:
        Role key (e.g., 'admin', 'curator') or None if not a member

    Example:
        >>> get_user_role_for_app(user_id, org_id, 'collections')
        'curator'  # Has override for Collections
        >>> get_user_role_for_app(user_id, org_id, 'media')
        'admin'  # No override, uses org default
    """
    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)

    # First check if user is active
    user = _s(session).query(User).filter_by(user_id=user_id).first()
    if not user or user.status != 'active':
        return None

    # Check if user has active membership
    membership = _s(session).query(OrganizationMembership).filter_by(
        user_id=user_id,
        organization_id=organization_id,
        status='active'
    ).first()

    if not membership:
        return None

    # If app_key provided, check for app-specific override
    if app_key and app_key in VALID_APP_KEYS:
        override = _s(session).query(AppRoleAssignment).filter_by(
            user_id=user_id,
            organization_id=organization_id,
            app_key=app_key
        ).first()

        if override:
            role = _s(session).query(Role).filter_by(role_id=override.role_id).first()
            if role:
                logger.debug(
                    f"User {user_id} has app-specific role {role.role_key} for {app_key} in org {organization_id}"
                )
                return role.role_key

    # Fall back to organization default role
    role = _s(session).query(Role).filter_by(role_id=membership.role_id).first()
    return role.role_key if role else None


def get_user_role_id_for_app(
    user_id: UUID | str,
    organization_id: UUID | str,
    app_key: str | None = None,
    session=None
) -> UUID | None:
    """
    Get user's role_id for a specific app, with fallback to org default.

    Same as get_user_role_for_app but returns role_id (needed for custom role resolution).
    """
    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)

    user = _s(session).query(User).filter_by(user_id=user_id).first()
    if not user or user.status != 'active':
        return None

    membership = _s(session).query(OrganizationMembership).filter_by(
        user_id=user_id,
        organization_id=organization_id,
        status='active'
    ).first()
    if not membership:
        return None

    if app_key and app_key in VALID_APP_KEYS:
        override = _s(session).query(AppRoleAssignment).filter_by(
            user_id=user_id,
            organization_id=organization_id,
            app_key=app_key
        ).first()
        if override:
            return override.role_id

    return membership.role_id


def get_user_permissions_for_app(
    user_id: UUID | str,
    organization_id: UUID | str,
    app_key: str | None = None,
    session=None
) -> set[str]:
    """
    Get permissions for a user in an app context.

    Uses app-specific role if set, otherwise falls back to org default.
    Includes inherited permissions from the role hierarchy.

    Args:
        user_id: User UUID
        organization_id: Organization UUID
        app_key: App identifier ('bridge', 'collections', 'media', 'reports')
                 If None, uses the org default role

    Returns:
        Set of permission keys (e.g., {'collections.view', 'collections.edit'})
        Empty set if user is not a member or not active

    Example:
        >>> get_user_permissions_for_app(user_id, org_id, 'collections')
        {'collections.view', 'collections.edit', ...}
    """
    role_id = get_user_role_id_for_app(user_id, organization_id, app_key, session=session)
    if not role_id:
        return set()

    permissions = resolve_permissions_for_role(role_id, session=session)

    logger.debug(
        f"User {user_id} has {len(permissions)} permissions for app {app_key or 'default'} in org {organization_id}"
    )

    return permissions


def get_user_app_role_overrides(
    user_id: UUID | str,
    organization_id: UUID | str,
    session=None
) -> dict[str, dict]:
    """
    Get all app-specific role overrides for a user.

    Returns a mapping of app_key to role information for all apps
    where the user has an override set.

    Args:
        user_id: User UUID
        organization_id: Organization UUID

    Returns:
        Dict mapping app_key to role info:
        {
            'collections': {
                'role_id': 'uuid',
                'role_key': 'curator',
                'role_display_name': 'Curator'
            },
            'media': {
                'role_id': 'uuid',
                'role_key': 'viewer',
                'role_display_name': 'Viewer'
            }
        }

    Example:
        >>> get_user_app_role_overrides(user_id, org_id)
        {'collections': {'role_id': '...', 'role_key': 'curator', ...}}
    """
    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)

    # Query all app overrides for this user in this org
    overrides = (
        _s(session).query(AppRoleAssignment, Role)
        .join(Role, AppRoleAssignment.role_id == Role.role_id)
        .filter(
            AppRoleAssignment.user_id == user_id,
            AppRoleAssignment.organization_id == organization_id
        )
        .all()
    )

    result = {}
    for assignment, role in overrides:
        result[assignment.app_key] = {
            'role_id': str(role.role_id),
            'role_key': role.role_key,
            'role_display_name': get_role_label_for_org(role.role_key, organization_id, session=session)
        }

    return result


def set_user_app_role(
    user_id: UUID | str,
    organization_id: UUID | str,
    app_key: str,
    role_id: UUID | str,
    created_by: UUID | str | None = None,
    session=None
) -> AppRoleAssignment:
    """
    Set or update a user's role for a specific app.

    Creates a new app role assignment or updates an existing one.

    Args:
        user_id: User UUID
        organization_id: Organization UUID
        app_key: App identifier ('bridge', 'collections', 'media', 'reports')
        role_id: Role UUID to assign
        created_by: UUID of the user making this change (optional)

    Returns:
        The created or updated AppRoleAssignment

    Raises:
        ValueError: If app_key is invalid or role doesn't exist
    """
    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)
    if isinstance(role_id, str):
        role_id = UUID(role_id)
    if isinstance(created_by, str):
        created_by = UUID(created_by)

    # Validate app_key
    if app_key not in VALID_APP_KEYS:
        raise ValueError(f"Invalid app_key: {app_key}. Must be one of: {', '.join(sorted(VALID_APP_KEYS))}")

    # Validate role exists
    role = _s(session).query(Role).filter_by(role_id=role_id).first()
    if not role:
        raise ValueError(f"Role not found: {role_id}")

    # Check for existing assignment
    existing = _s(session).query(AppRoleAssignment).filter_by(
        user_id=user_id,
        organization_id=organization_id,
        app_key=app_key
    ).first()

    if existing:
        existing.role_id = role_id
        existing.updated_at = func.now()
        logger.info(
            f"Updated app role for user {user_id} in org {organization_id}: {app_key} -> {role.role_key}"
        )
        return existing
    else:
        new_assignment = AppRoleAssignment(
            organization_id=organization_id,
            user_id=user_id,
            app_key=app_key,
            role_id=role_id,
            created_by=created_by
        )
        _s(session).add(new_assignment)
        logger.info(
            f"Created app role for user {user_id} in org {organization_id}: {app_key} -> {role.role_key}"
        )
        return new_assignment


def remove_user_app_role(
    user_id: UUID | str,
    organization_id: UUID | str,
    app_key: str,
    session=None
) -> bool:
    """
    Remove an app-specific role override for a user.

    After removal, the user will use their org default role for this app.

    Args:
        user_id: User UUID
        organization_id: Organization UUID
        app_key: App identifier to remove override for

    Returns:
        True if an override was removed, False if no override existed
    """
    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)

    deleted_count = _s(session).query(AppRoleAssignment).filter_by(
        user_id=user_id,
        organization_id=organization_id,
        app_key=app_key
    ).delete()

    if deleted_count > 0:
        logger.info(
            f"Removed app role override for user {user_id} in org {organization_id}: {app_key}"
        )
        return True
    return False


def check_org_membership(user_id: UUID | str, organization_id: UUID | str, session=None) -> tuple[bool, str | None]:
    """
    Check if a user is an active member of an organization.

    Args:
        user_id: User UUID
        organization_id: Organization UUID

    Returns:
        Tuple of (is_member, reason_if_not)
        - (True, None) if user is an active member
        - (False, "reason") if not a member with explanation
    """
    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)

    # Check if user exists and is active
    user = _s(session).query(User).filter_by(user_id=user_id).first()
    if not user:
        return False, "User not found"
    if user.status != 'active':
        return False, f"User account is {user.status}"

    # Check membership
    membership = (
        _s(session).query(OrganizationMembership)
        .filter_by(
            user_id=user_id,
            organization_id=organization_id
        )
        .first()
    )

    if not membership:
        return False, "Not a member of this organization"

    if membership.status != 'active':
        return False, f"Organization membership is {membership.status}"

    return True, None


def check_permission(
    user_id: UUID | str,
    organization_id: UUID | str,
    permission: Permission | str,
    session=None
) -> bool:
    """
    Check if a user has a specific permission in an organization.
    
    Args:
        user_id: User UUID
        organization_id: Organization UUID
        permission: Permission enum or permission key string (e.g., Permission.CONNECTORS_EDIT or 'connectors.edit')
        
    Returns:
        True if user has the permission, False otherwise
    """
    # Convert Permission enum to string if needed
    if isinstance(permission, Permission):
        permission_key = permission.value
    else:
        permission_key = permission
        # Validate permission key
        if not validate_permission(permission_key):
            logger.warning(f"Invalid permission key: {permission_key}")
            return False
    
    permissions = get_user_permissions(user_id, organization_id, session=session)
    has_permission = permission_key in permissions
    
    logger.info(
        "Permission check",
        extra={
            "user_id": str(user_id),
            "organization_id": str(organization_id),
            "permission": permission_key,
            "granted": has_permission,
        }
    )

    return has_permission


def users_with_permission(
    organization_id: UUID | str,
    permission: str,
    session=None,
) -> list[UUID]:
    """Active org members who hold ``permission`` — i.e. who could approve a
    request gated on it. Used to offer valid assignees for directed approvals."""
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)

    s = _s(session)
    member_ids = [
        row[0]
        for row in s.query(OrganizationMembership.user_id)
        .filter(
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.status == "active",
        )
        .all()
    ]
    return [
        uid
        for uid in member_ids
        if check_permission(uid, organization_id, permission, session=s)
    ]


def get_role_key(user_id: UUID | str, organization_id: UUID | str, session=None) -> str | None:
    """
    Get the role key for a user in an organization.
    
    Only returns role for active users with active memberships.
    
    Args:
        user_id: User UUID
        organization_id: Organization UUID
        
    Returns:
        Role key (e.g., 'admin', 'member', 'viewer') or None if not a member/active
    """
    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)
    
    # Check if user is active
    user = _s(session).query(User).filter_by(user_id=user_id).first()
    if not user or user.status != 'active':
        return None
    
    stmt = (
        select(Role.role_key)
        .join(OrganizationMembership, OrganizationMembership.role_id == Role.role_id)
        .where(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.organization_id == organization_id,
            OrganizationMembership.status == 'active'  # Only active memberships
        )
    )
    
    result = _s(session).execute(stmt).scalar_one_or_none()
    return result


def is_platform_admin(user_id: UUID | str, session=None) -> bool:
    """
    Check if a user has platform admin permission in any of their organizations.

    Platform admins can manage all organizations regardless of membership.
    This checks if the user has the 'platform.admin' permission through any
    of their active org memberships.

    Args:
        user_id: User UUID

    Returns:
        True if user is a platform admin, False otherwise
    """
    if isinstance(user_id, str):
        user_id = UUID(user_id)

    # Get all active memberships for this user
    memberships = _s(session).query(OrganizationMembership).filter(
        OrganizationMembership.user_id == user_id,
        OrganizationMembership.status == 'active'
    ).all()

    for membership in memberships:
        try:
            permissions = get_user_permissions(user_id, membership.organization_id, session=session)
            if Permission.PLATFORM_ADMIN.value in permissions:
                logger.debug(f"User {user_id} is platform admin via org {membership.organization_id}")
                return True
        except Exception as e:
            logger.warning(f"Error checking permissions for user {user_id} in org {membership.organization_id}: {e}")
            continue

    return False




def get_role_label(role_key: str, profile_key: str = 'glam_default', session=None) -> str:
    """
    Get the display label for a role based on organization role profile.
    
    Args:
        role_key: Internal role key ('admin', 'registrar', 'curator', 'publisher', 'viewer')
        profile_key: Role profile key ('glam_default')

    Returns:
        Display label for the role (e.g., 'Curator' for curator role in glam_default profile)
    """
    from app.models import RoleProfile as RoleProfileModel
    
    # Query role_profiles table for label
    stmt = (
        select(RoleProfileModel.label)
        .where(
            RoleProfileModel.profile_key == profile_key,
            RoleProfileModel.role_key == role_key
        )
    )
    
    result = _s(session).execute(stmt).scalar_one_or_none()
    
    if result:
        return result
    
    # Fallback: use canonical role labels
    from app.permissions import get_role_label as _get_label
    return _get_label(role_key)


def get_organization_role_profile(organization_id: UUID | str) -> str:
    """Get the role profile key for an organization. Always returns glam_default."""
    return "glam_default"


def get_role_label_for_org(
    role_key: str,
    organization_id: UUID | str,
    app_key: str | None = None,
    session=None
) -> str:
    """
    Get the display label for a role in a specific organization.

    Resolution hierarchy:
    1. App-specific org override (org_role_labels where app_key matches)
    2. Org-wide override (org_role_labels where app_key is NULL)
    3. Profile default (role_profiles table)
    4. Code fallback (ROLE_LABELS dict)

    Args:
        role_key: Internal role key (e.g., 'curator', 'admin')
        organization_id: Organization UUID
        app_key: Optional application context (e.g., 'collections', 'media', 'bridge')

    Returns:
        Display label for the role

    Example:
        >>> get_role_label_for_org('registrar', org_id, app_key='collections')
        'Collections Manager'  # App-specific override
        >>> get_role_label_for_org('registrar', org_id)
        'Registrar'  # Org-wide or default
    """
    from app.models import OrgRoleLabel, RoleProfile as RoleProfileModel

    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)

    # 1. Check for app-specific override (if app_key provided)
    if app_key:
        app_stmt = (
            select(OrgRoleLabel.label)
            .where(
                OrgRoleLabel.organization_id == organization_id,
                OrgRoleLabel.role_key == role_key,
                OrgRoleLabel.app_key == app_key,
            )
        )
        app_result = _s(session).execute(app_stmt).scalar_one_or_none()
        if app_result:
            return app_result

    # 2. Check for org-wide override (app_key = '')
    override_stmt = (
        select(OrgRoleLabel.label)
        .where(
            OrgRoleLabel.organization_id == organization_id,
            OrgRoleLabel.role_key == role_key,
            OrgRoleLabel.app_key == '',
        )
    )
    override_result = _s(session).execute(override_stmt).scalar_one_or_none()
    if override_result:
        return override_result

    # 3. Fall back to profile default
    profile_key = get_organization_role_profile(organization_id)
    return get_role_label(role_key, profile_key, session=session)


def set_org_role_label(
    organization_id: UUID | str,
    role_key: str,
    label: str,
    app_key: str | None = None,
    session=None,
) -> None:
    """
    Set a custom display label for a role in an organization.

    Args:
        organization_id: Organization UUID
        role_key: Internal role key (e.g., 'curator')
        label: Custom display label (e.g., 'Research Specialist')
        app_key: Optional app context (e.g., 'collections'). None/'' = org-wide.

    Raises:
        ValueError: If role_key is invalid
    """
    from app.models import OrgRoleLabel, Role

    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)

    effective_app_key = app_key or ''

    # Validate role_key exists
    role_check = _s(session).execute(
        select(Role.role_id).where(Role.role_key == role_key)
    ).scalar_one_or_none()

    if not role_check:
        raise ValueError(f"Invalid role_key: {role_key}")

    # Upsert org role label
    existing = _s(session).execute(
        select(OrgRoleLabel).where(
            OrgRoleLabel.organization_id == organization_id,
            OrgRoleLabel.role_key == role_key,
            OrgRoleLabel.app_key == effective_app_key,
        )
    ).scalar_one_or_none()

    if existing:
        existing.label = label
    else:
        new_label = OrgRoleLabel(
            organization_id=organization_id,
            role_key=role_key,
            app_key=effective_app_key,
            label=label,
        )
        _s(session).add(new_label)

    _s(session).commit()


def remove_org_role_label(
    organization_id: UUID | str,
    role_key: str,
    app_key: str | None = None,
    session=None,
) -> bool:
    """
    Remove a custom display label override for an organization.

    Args:
        organization_id: Organization UUID
        role_key: Internal role key (e.g., 'curator')
        app_key: Optional app context. None/'' = remove org-wide override.

    Returns:
        True if an override was removed, False if none existed
    """
    from app.models import OrgRoleLabel

    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)

    effective_app_key = app_key or ''

    existing = _s(session).execute(
        select(OrgRoleLabel).where(
            OrgRoleLabel.organization_id == organization_id,
            OrgRoleLabel.role_key == role_key,
            OrgRoleLabel.app_key == effective_app_key,
        )
    ).scalar_one_or_none()

    if existing:
        _s(session).delete(existing)
        _s(session).commit()
        return True

    return False


def get_all_role_labels_for_org(organization_id: UUID | str) -> dict[str, str]:
    """
    Get all role labels for an organization (with overrides applied).
    
    Returns a complete mapping of role_key → display label, incorporating
    any organization-specific overrides.
    
    Args:
        organization_id: Organization UUID
        
    Returns:
        Dict mapping role_key to display label
        
    Example:
        >>> get_all_role_labels_for_org(org_id)
        {
            'admin': 'Organization Administrator',
            'registrar': 'Registrar',
            'curator': 'Research Specialist',  # Custom override
            'publisher': 'Digital Publishing',
            'viewer': 'Viewer'
        }
    """
    from app.models import Role
    from app.permissions import InternalRole
    
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)
    
    # Get all role keys
    role_keys = [role.value for role in InternalRole]
    
    # Build label mapping with overrides
    labels = {}
    for role_key in role_keys:
        labels[role_key] = get_role_label_for_org(role_key, organization_id)
    
    return labels


def get_organization_role_profile(organization_id: UUID | str) -> str:
    """Get the role profile key for an organization. Always returns glam_default."""
    return "glam_default"


# ==================== Department-Level Permission Checks ====================

# Department role hierarchy: admin(4) > curator(3) > editor(2) > viewer(1)
_DEPT_ROLE_LEVELS = {
    'admin': 4,
    'curator': 3,
    'editor': 2,
    'viewer': 1,
}


def _get_min_dept_role_level(permission_key: str) -> int:
    """Map a permission key to the minimum department role level required."""
    action = permission_key.rsplit('.', 1)[-1] if '.' in permission_key else permission_key
    if action in ('approve', 'manage_members', 'manage'):
        return _DEPT_ROLE_LEVELS['admin']
    if action == 'delete':
        return _DEPT_ROLE_LEVELS['curator']
    if action in ('create', 'edit'):
        return _DEPT_ROLE_LEVELS['editor']
    # Default to viewer for 'view' and anything else
    return _DEPT_ROLE_LEVELS['viewer']


def check_department_permission(
    user_id: UUID | str,
    organization_id: UUID | str,
    department_id: UUID | str | None,
    permission: Permission | str,
    session=None,
) -> bool:
    """
    Check if a user has permission considering department-level access.

    1. First checks org-level permission via check_permission()
    2. If org permission denied, return False
    3. If record has no department_id (None), org permission suffices
    4. If user has collections.view_all_departments, bypass dept check
    5. Otherwise, look up user's DepartmentMembership for that department
    6. Map dept role to permission level and check

    Args:
        user_id: User UUID
        organization_id: Organization UUID
        department_id: Department UUID (or None if record has no department)
        permission: Permission to check

    Returns:
        True if user has the permission, False otherwise
    """
    # Step 1: Check org-level permission first
    if not check_permission(user_id, organization_id, permission, session=session):
        return False

    # Step 2: If no department on the record, org permission suffices
    if department_id is None:
        return True

    # Step 3: Check for cross-department bypass
    if check_permission(user_id, organization_id, Permission.COLLECTIONS_VIEW_ALL_DEPARTMENTS, session=session):
        return True

    # Step 4: Check department membership
    from app.models.departments import DepartmentMembership

    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)
    if isinstance(department_id, str):
        department_id = UUID(department_id)

    membership = _s(session).query(DepartmentMembership).filter_by(
        user_id=user_id,
        organization_id=organization_id,
        department_id=department_id,
    ).first()

    if not membership:
        logger.debug(
            f"User {user_id} has no membership in department {department_id}"
        )
        return False

    # Step 5: Check role level
    permission_key = permission.value if isinstance(permission, Permission) else permission
    user_level = _DEPT_ROLE_LEVELS.get(membership.role, 0)
    required_level = _get_min_dept_role_level(permission_key)

    has_access = user_level >= required_level
    logger.debug(
        f"Department permission check: user {user_id}, dept {department_id}, "
        f"role={membership.role}({user_level}), required={required_level}, granted={has_access}"
    )
    return has_access


def get_user_primary_department_id(
    user_id: UUID | str,
    organization_id: UUID | str,
    session=None,
) -> UUID | None:
    """
    Get the user's primary department ID in an organization.

    Args:
        user_id: User UUID
        organization_id: Organization UUID

    Returns:
        Primary department UUID or None if no primary department
    """
    from app.models.departments import DepartmentMembership

    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)

    membership = _s(session).query(DepartmentMembership).filter_by(
        user_id=user_id,
        organization_id=organization_id,
        is_primary=True,
    ).first()

    return membership.department_id if membership else None


# Backward compatibility: map old role strings to permission checks
def has_admin_role(user_id: UUID | str, organization_id: UUID | str) -> bool:
    """
    Check if user has admin role (backward compatibility).
    
    Deprecated: Use check_permission() for specific permissions instead.
    """
    role_key = get_role_key(user_id, organization_id)
    return role_key == 'admin'


def has_member_role(user_id: UUID | str, organization_id: UUID | str) -> bool:
    """
    Check if user has member role or higher (backward compatibility).
    
    Deprecated: Use check_permission() for specific permissions instead.
    """
    role_key = get_role_key(user_id, organization_id)
    return role_key in ('admin', 'member')


# ==================== Debug Utilities ====================

def print_user_permissions(
    user_id: UUID | str,
    organization_id: UUID | str,
    verbose: bool = False,
    session=None,
) -> None:
    """
    Debug utility to print a user's effective permissions.
    
    Shows:
    - User role
    - Role inheritance chain
    - All effective permissions (grouped by domain)
    - Permission count
    
    Args:
        user_id: User UUID
        organization_id: Organization UUID
        verbose: If True, shows all permissions; if False, shows summary only
        
    Example:
        >>> print_user_permissions('user-uuid', 'org-uuid', verbose=True)
        
        User Permissions for user-uuid in org-uuid
        ==========================================
        Role: registrar
        Inheritance: registrar → curator → publisher → viewer
        
        Total Permissions: 18
        
        Organization (0 permissions):
        
        Connectors (2 permissions):
          - connectors.view
          - connectors.edit
        
        Pipelines (2 permissions):
          - pipelines.view
          - pipelines.edit
        ...
    """
    from app.permissions import get_role_inheritance_chain
    
    # Convert to UUID if needed
    if isinstance(user_id, str):
        user_id = UUID(user_id)
    if isinstance(organization_id, str):
        organization_id = UUID(organization_id)
    
    # Get user's role
    role_key = get_role_key(user_id, organization_id, session=session)

    if not role_key:
        logger.debug("User %s is not a member of organization %s", user_id, organization_id)
        return
    
    # Get inheritance chain
    try:
        chain = get_role_inheritance_chain(role_key)
        chain_str = " → ".join(chain)
    except ValueError as e:
        chain_str = f"ERROR: {e}"
        chain = [role_key]
    
    # Get permissions
    permissions = get_user_permissions(user_id, organization_id, session=session)
    
    logger.debug(
        f"User Permissions for {user_id} | Organization: {organization_id} | "
        f"Role: {role_key} | Inheritance Chain: {chain_str} | "
        f"Total Permissions: {len(permissions)}"
    )
    
    if not verbose:
        # Summary view - just counts by domain
        domains = {}
        for perm in sorted(permissions):
            domain = perm.split('.')[0]
            domains[domain] = domains.get(domain, 0) + 1

        domain_summary = ", ".join(f"{d}: {c}" for d, c in sorted(domains.items()))
        logger.debug("Permissions by Domain: %s (use verbose=True for full list)", domain_summary)
        return
    
    # Verbose view - group and list all permissions
    domains = {}
    for perm in sorted(permissions):
        domain = perm.split('.')[0]
        if domain not in domains:
            domains[domain] = []
        domains[domain].append(perm)

    for domain in sorted(domains.keys()):
        perms = domains[domain]
        logger.debug(f"{domain.upper()} ({len(perms)} permissions): {', '.join(perms)}")


def compare_role_permissions(role_key_a: str, role_key_b: str) -> None:
    """
    Debug utility to compare permissions between two roles.
    
    Shows:
    - Permissions unique to role A
    - Permissions unique to role B
    - Shared permissions
    
    Args:
        role_key_a: First role to compare
        role_key_b: Second role to compare
        
    Example:
        >>> compare_role_permissions('viewer', 'publisher')

        Comparing: viewer vs publisher
        ===================================

        viewer only (3 permissions):
          - data.query

        publisher only (2 permissions):
          - data.export
          - runs.execute
          
        Shared (5 permissions):
          - connectors.view
          - pipelines.view
          - runs.view
          - data.view
          - mappings.view
    """
    from app.permissions import get_role_inheritance_chain
    
    # Get permissions for both roles
    perms_a = resolve_permissions_with_inheritance(role_key_a)
    perms_b = resolve_permissions_with_inheritance(role_key_b)
    
    # Get inheritance chains
    try:
        chain_a = " → ".join(get_role_inheritance_chain(role_key_a))
    except ValueError:
        chain_a = role_key_a
    
    try:
        chain_b = " → ".join(get_role_inheritance_chain(role_key_b))
    except ValueError:
        chain_b = role_key_b
    
    # Calculate differences
    only_a = perms_a - perms_b
    only_b = perms_b - perms_a
    shared = perms_a & perms_b
    
    logger.debug(
        f"Role Permission Comparison | "
        f"Role A: {role_key_a} (chain: {chain_a}, {len(perms_a)} permissions) | "
        f"Role B: {role_key_b} (chain: {chain_b}, {len(perms_b)} permissions)"
    )
    
    logger.debug(
        f"Only in {role_key_a} ({len(only_a)}): {', '.join(sorted(only_a)) or '(none)'}"
    )
    logger.debug(
        f"Only in {role_key_b} ({len(only_b)}): {', '.join(sorted(only_b)) or '(none)'}"
    )
    logger.debug(
        f"Shared by both ({len(shared)}): {', '.join(sorted(shared)) or '(none)'}"
    )
