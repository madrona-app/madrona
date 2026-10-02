"""
Field-level access control service.

Provides field-level access control for the Collections and Media apps.
Determines which fields a user/role can view or edit based on:

1. System-wide field policies (field_access_policies table)
2. Per-organization role grants (role_field_access table)
3. Role inheritance (higher roles inherit lower role access)

Usage:
    from app.services.field_access_service import (
        can_view_field,
        get_visible_fields,
        filter_entity_fields
    )

    # Check if user can see a specific field
    if can_view_field(session, org_id, user_id, 'collection_object', 'acquisition_cost'):
        include_cost = True

    # Filter sensitive fields from entity data
    filtered = filter_entity_fields(
        session, org_id, user_id, 'collection_object', entity_data
    )

Field Policy Types:
- sensitive: Financial/valuation data (admin only by default)
- restricted: Can be granted to lower roles by org admin
- internal: Internal notes (visible by default, can be restricted)

Role Inheritance:
- admin can see all fields
- Lower roles inherit access from their permission chain
- Per-org grants override system defaults
"""

import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.models import (
    FieldAccessPolicy,
    RoleFieldAccess,
    OrganizationMembership,
    Role,
    Application,
)
from app.permissions import get_role_inheritance_chain

logger = logging.getLogger(__name__)


class _UserRoleInfo:
    """Internal struct for role resolution results."""
    __slots__ = ('role_key', 'role_id', 'is_system')

    def __init__(self, role_key: str, role_id: UUID | None, is_system: bool):
        self.role_key = role_key
        self.role_id = role_id
        self.is_system = is_system


def get_user_role_info(
    session: Session,
    org_id: UUID,
    user_id: UUID,
    role_override: str | None = None,
) -> "_UserRoleInfo | None":
    """
    Get the effective role info for a user in an organization.

    When role_override is provided (platform admin testing as a lower role),
    resolves the override role. Supports both system role keys and custom role UUIDs.

    Returns:
        _UserRoleInfo with role_key, role_id, is_system — or None if not found
    """
    if role_override:
        # Check if override is a UUID (custom role)
        try:
            override_role_id = UUID(role_override)
            role = session.query(Role).filter_by(role_id=override_role_id, is_active=True).first()
            if role:
                return _UserRoleInfo(role.role_key, role.role_id, role.is_system)
        except ValueError:
            pass
        # System role key override
        return _UserRoleInfo(role_override, None, True)

    stmt = (
        select(Role.role_key, Role.role_id, Role.is_system)
        .join(OrganizationMembership, OrganizationMembership.role_id == Role.role_id)
        .where(
            and_(
                OrganizationMembership.organization_id == org_id,
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.status == 'active'
            )
        )
    )
    result = session.execute(stmt).first()
    if not result:
        return None
    return _UserRoleInfo(result[0], result[1], result[2])


def get_user_role_key(
    session: Session,
    org_id: UUID,
    user_id: UUID,
    role_override: str | None = None,
) -> str | None:
    """Get the effective role key for a user. Backward-compatible wrapper."""
    info = get_user_role_info(session, org_id, user_id, role_override)
    return info.role_key if info else None


def get_role_level(role_key: str) -> int:
    """
    DEPRECATED: Use minimum_permission on FieldAccessPolicy instead.
    Kept only for backward compatibility in write-restriction path.
    """
    hierarchy_order = ['viewer', 'publisher', 'curator', 'registrar', 'admin']
    try:
        return hierarchy_order.index(role_key) + 1
    except ValueError:
        return 0


def can_view_field(
    session: Session,
    org_id: UUID,
    user_id: UUID,
    entity_type: str,
    field_path: str,
    app_key: str = 'collections',
    role_override: str | None = None,
) -> bool:
    """
    Check if a user can view a specific field.

    Args:
        session: Database session
        org_id: Organization ID
        user_id: User ID
        entity_type: Entity type (e.g., 'collection_object', 'location')
        field_path: Field name/path to check
        app_key: Application key (default: 'collections')

    Returns:
        True if user can view the field, False otherwise
    """
    # Get user's effective role
    role_info = get_user_role_info(session, org_id, user_id, role_override)
    if not role_info:
        return False

    # admin and platform_admin can see everything
    if role_info.role_key in ('admin', 'platform_admin'):
        return True

    # Get field policy
    stmt = (
        select(FieldAccessPolicy)
        .join(Application, Application.application_id == FieldAccessPolicy.application_id)
        .where(
            and_(
                Application.key == app_key,
                FieldAccessPolicy.entity_type == entity_type,
                FieldAccessPolicy.field_path == field_path
            )
        )
    )
    policy = session.execute(stmt).scalar_one_or_none()

    # No policy = visible by default
    if not policy:
        return True

    # Check for org-specific grant (by role_id if available, else by role_key)
    if role_info.role_id:
        grant_stmt = (
            select(RoleFieldAccess)
            .where(
                and_(
                    RoleFieldAccess.organization_id == org_id,
                    RoleFieldAccess.policy_id == policy.policy_id,
                    RoleFieldAccess.role_id == role_info.role_id,
                )
            )
        )
        grant = session.execute(grant_stmt).scalar_one_or_none()
    else:
        grant_stmt = (
            select(RoleFieldAccess)
            .join(Role, Role.role_id == RoleFieldAccess.role_id)
            .where(
                and_(
                    RoleFieldAccess.organization_id == org_id,
                    RoleFieldAccess.policy_id == policy.policy_id,
                    Role.role_key == role_info.role_key
                )
            )
        )
        grant = session.execute(grant_stmt).scalar_one_or_none()

    if grant:
        return grant.can_view

    # For system roles: check inherited grants from ancestor roles
    if role_info.is_system:
        role_chain = get_role_inheritance_chain(role_info.role_key)
        for ancestor_role in role_chain:
            if ancestor_role == role_info.role_key:
                continue
            ancestor_grant_stmt = (
                select(RoleFieldAccess)
                .join(Role, Role.role_id == RoleFieldAccess.role_id)
                .where(
                    and_(
                        RoleFieldAccess.organization_id == org_id,
                        RoleFieldAccess.policy_id == policy.policy_id,
                        Role.role_key == ancestor_role
                    )
                )
            )
            ancestor_grant = session.execute(ancestor_grant_stmt).scalar_one_or_none()
            if ancestor_grant and ancestor_grant.can_view:
                return True

    # Fall back to system defaults
    if policy.default_visible:
        # Check minimum_permission (works for both system and custom roles)
        if policy.minimum_permission:
            from app.services.rbac_service import resolve_permissions_for_role
            if role_info.role_id:
                user_perms = resolve_permissions_for_role(role_info.role_id, session=session)
            else:
                from app.services.rbac_service import resolve_permissions_with_inheritance
                user_perms = resolve_permissions_with_inheritance(role_info.role_key, session=session)
            return policy.minimum_permission in user_perms
        return True

    return False


def get_restricted_fields(
    session: Session,
    org_id: UUID,
    user_id: UUID,
    entity_type: str,
    app_key: str = 'collections',
    role_override: str | None = None,
) -> set[str]:
    """
    Get the set of field paths that should be hidden from a user.

    Args:
        session: Database session
        org_id: Organization ID
        user_id: User ID
        entity_type: Entity type (e.g., 'collection_object')
        app_key: Application key (default: 'collections')

    Returns:
        Set of field paths that should be hidden
    """
    # Memoized for the life of the session.
    #
    # Every serializer calls apply_field_access() per ROW, and the answer cannot
    # differ between rows of one response: org, user, entity_type, app_key and
    # role_override are all identical. Uncached, a page of 50 objects re-ran the
    # role lookup, the policy query, and then one can_view_field() query per
    # policy — for every row. That is the 38-100 queries per object the audit
    # measured, and it was invisible to anyone testing as an admin, because
    # admins return early below after a single query.
    #
    # The cache lives on the SESSION, deliberately. A module-level dict or an
    # lru_cache would outlive the request and hand one user's field
    # restrictions to the next — the one bug in this file that would actually
    # matter. A session is created per request (get_db) or per task
    # (get_session), so this expires exactly when it should.
    #
    # The trade is that a policy edited mid-request is not seen until the next
    # one. For field-visibility policies, which change rarely and by an admin
    # action, that is not a real window.
    cache_key = (str(org_id), str(user_id), entity_type, app_key, role_override)
    try:
        cache = session.info.setdefault('_field_access_restricted', {})
    except Exception:
        cache = None  # a mock/stub session without .info
    if cache is not None and cache_key in cache:
        # a copy: callers must not be able to poison the cache
        return set(cache[cache_key])

    def _remember(result: set[str]) -> set[str]:
        if cache is not None:
            cache[cache_key] = set(result)
        return result

    # Get user's effective role
    role_key = get_user_role_key(session, org_id, user_id, role_override)
    if not role_key:
        return _remember(set())

    # admin and platform_admin can see everything
    if role_key in ('admin', 'platform_admin'):
        return _remember(set())

    # Get all policies for this entity type
    stmt = (
        select(FieldAccessPolicy)
        .join(Application, Application.application_id == FieldAccessPolicy.application_id)
        .where(
            and_(
                Application.key == app_key,
                FieldAccessPolicy.entity_type == entity_type
            )
        )
    )
    policies = session.execute(stmt).scalars().all()

    restricted = set()
    for policy in policies:
        if not can_view_field(session, org_id, user_id, entity_type, policy.field_path, app_key, role_override):
            restricted.add(policy.field_path)

    return _remember(restricted)


def filter_entity_fields(
    session: Session,
    org_id: UUID,
    user_id: UUID,
    entity_type: str,
    data: dict[str, Any],
    app_key: str = 'collections'
) -> dict[str, Any]:
    """
    Filter restricted fields from entity data based on user's access.

    Args:
        session: Database session
        org_id: Organization ID
        user_id: User ID
        entity_type: Entity type (e.g., 'collection_object')
        data: Entity data dictionary
        app_key: Application key (default: 'collections')

    Returns:
        Filtered data dictionary with restricted fields removed
    """
    restricted = get_restricted_fields(session, org_id, user_id, entity_type, app_key)

    if not restricted:
        return data

    # Create filtered copy
    filtered = {}
    for key, value in data.items():
        if key not in restricted:
            filtered[key] = value

    return filtered


def apply_field_access(
    data: dict,
    entity_type: str,
    org_id: str,
    user_id: str,
    session=None,
    app_key: str = 'collections',
    role_override: str | None = None,
) -> dict:
    """
    Convenience wrapper for API endpoints.
    Filters restricted fields and adds _restricted_fields metadata.

    Args:
        data: Serialized entity data dictionary
        entity_type: Entity type (e.g., 'collection_object')
        org_id: Organization ID (string, will be converted to UUID)
        user_id: User ID (string, will be converted to UUID)
        session: Optional database session (defaults to current_session())
        app_key: Application key (default: 'collections')

    Returns:
        Filtered data dict with _restricted_fields array added
    """
    from app.database import current_session
    sess = session or current_session()
    org_uuid = UUID(str(org_id))
    user_uuid = UUID(str(user_id))
    restricted = get_restricted_fields(sess, org_uuid, user_uuid, entity_type, app_key, role_override)
    if not restricted:
        data['_restricted_fields'] = []
        return data
    filtered = {k: v for k, v in data.items() if k not in restricted}
    filtered['_restricted_fields'] = sorted(restricted)
    return filtered


def get_field_policies(
    session: Session,
    app_key: str = 'collections',
    entity_type: str | None = None
) -> list[dict[str, Any]]:
    """
    Get all field policies for an application.

    Args:
        session: Database session
        app_key: Application key (default: 'collections')
        entity_type: Optional filter by entity type

    Returns:
        List of field policy dictionaries
    """
    stmt = (
        select(FieldAccessPolicy)
        .join(Application, Application.application_id == FieldAccessPolicy.application_id)
        .where(Application.key == app_key)
    )

    if entity_type:
        stmt = stmt.where(FieldAccessPolicy.entity_type == entity_type)

    stmt = stmt.order_by(FieldAccessPolicy.entity_type, FieldAccessPolicy.field_path)

    policies = session.execute(stmt).scalars().all()

    return [
        {
            'policy_id': str(p.policy_id),
            'entity_type': p.entity_type,
            'field_path': p.field_path,
            'policy_type': p.policy_type,
            'display_name': p.display_name,
            'description': p.description,
            'default_visible': p.default_visible,
            'minimum_permission': p.minimum_permission,
        }
        for p in policies
    ]


def upsert_field_grants(
    session: Session,
    org_id: UUID,
    role_id: UUID,
    grants: list[dict[str, Any]],
    granted_by: UUID | None = None
) -> list[dict[str, Any]]:
    """
    Bulk upsert field access grants for a role in an organization.

    Each grant dict should contain:
    - policy_id: str (UUID of the field policy)
    - can_view: bool
    - can_edit: bool

    Args:
        session: Database session
        org_id: Organization ID
        role_id: Role ID
        grants: List of grant dictionaries
        granted_by: User ID of the admin making the change

    Returns:
        List of upserted grant dictionaries
    """
    results = []

    for grant_data in grants:
        policy_id = UUID(str(grant_data['policy_id']))
        can_view = bool(grant_data.get('can_view', False))
        can_edit = bool(grant_data.get('can_edit', False))

        # Look for existing grant
        existing = session.execute(
            select(RoleFieldAccess).where(
                and_(
                    RoleFieldAccess.organization_id == org_id,
                    RoleFieldAccess.role_id == role_id,
                    RoleFieldAccess.policy_id == policy_id,
                )
            )
        ).scalar_one_or_none()

        if existing:
            existing.can_view = can_view
            existing.can_edit = can_edit
            if granted_by:
                existing.granted_by = granted_by
        else:
            new_grant = RoleFieldAccess(
                organization_id=org_id,
                role_id=role_id,
                policy_id=policy_id,
                can_view=can_view,
                can_edit=can_edit,
                granted_by=granted_by,
            )
            session.add(new_grant)

        results.append({
            'policy_id': str(policy_id),
            'can_view': can_view,
            'can_edit': can_edit,
        })

    session.commit()
    return results


def delete_field_grant(
    session: Session,
    org_id: UUID,
    role_id: UUID,
    policy_id: UUID
) -> bool:
    """
    Delete a single field access grant.

    Args:
        session: Database session
        org_id: Organization ID
        role_id: Role ID
        policy_id: Field policy ID

    Returns:
        True if deleted, False if not found
    """
    grant = session.execute(
        select(RoleFieldAccess).where(
            and_(
                RoleFieldAccess.organization_id == org_id,
                RoleFieldAccess.role_id == role_id,
                RoleFieldAccess.policy_id == policy_id,
            )
        )
    ).scalar_one_or_none()

    if not grant:
        return False

    session.delete(grant)
    session.commit()
    return True


def get_role_field_grants(
    session: Session,
    org_id: UUID,
    role_id: UUID,
    app_key: str = 'collections'
) -> list[dict[str, Any]]:
    """
    Get field access grants for a specific role in an organization.

    Args:
        session: Database session
        org_id: Organization ID
        role_id: Role ID
        app_key: Application key

    Returns:
        List of grant dictionaries
    """
    stmt = (
        select(RoleFieldAccess, FieldAccessPolicy.field_path, FieldAccessPolicy.entity_type)
        .join(FieldAccessPolicy, FieldAccessPolicy.policy_id == RoleFieldAccess.policy_id)
        .join(Application, Application.application_id == FieldAccessPolicy.application_id)
        .where(
            and_(
                RoleFieldAccess.organization_id == org_id,
                RoleFieldAccess.role_id == role_id,
                Application.key == app_key
            )
        )
    )

    results = session.execute(stmt).all()

    return [
        {
            'policy_id': str(row.RoleFieldAccess.policy_id),
            'entity_type': row.entity_type,
            'field_path': row.field_path,
            'can_view': row.RoleFieldAccess.can_view,
            'can_edit': row.RoleFieldAccess.can_edit,
        }
        for row in results
    ]


def get_write_restricted_fields(
    entity_type: str,
    org_id: str,
    user_id: str,
    session=None,
    app_key: str = 'collections',
    role_override: str | None = None,
) -> set[str]:
    """
    Get field paths the user cannot write to for a given entity type.

    A field is write-restricted if:
    - The user's role has can_edit=False via an org-level grant, OR
    - The user lacks the field's minimum_permission, OR
    - The field is not visible to the user (if you can't view it, you can't edit it)

    Admin role bypasses all restrictions.

    Args:
        entity_type: Entity type (e.g., 'collection_object')
        org_id: Organization ID (string)
        user_id: User ID (string)
        session: Optional database session
        app_key: Application key (default: 'collections')

    Returns:
        Set of field paths the user cannot write to
    """
    from app.database import current_session
    sess = session or current_session()
    org_uuid = UUID(str(org_id))
    user_uuid = UUID(str(user_id))

    role_key = get_user_role_key(sess, org_uuid, user_uuid, role_override)
    if not role_key:
        return set()

    # Admin and platform_admin can edit everything
    if role_key in ('admin', 'platform_admin'):
        return set()

    # Get all policies for this entity type
    stmt = (
        select(FieldAccessPolicy)
        .join(Application, Application.application_id == FieldAccessPolicy.application_id)
        .where(
            and_(
                Application.key == app_key,
                FieldAccessPolicy.entity_type == entity_type
            )
        )
    )
    policies = sess.execute(stmt).scalars().all()

    if not policies:
        return set()

    write_restricted = set()
    role_chain = get_role_inheritance_chain(role_key)

    for policy in policies:
        # If the user can't even view this field, they definitely can't edit it
        if not can_view_field(sess, org_uuid, user_uuid, entity_type, policy.field_path, app_key, role_override):
            write_restricted.add(policy.field_path)
            continue

        # Check org-specific grant for can_edit
        can_edit = _check_can_edit(sess, org_uuid, role_key, role_chain, policy)
        if not can_edit:
            write_restricted.add(policy.field_path)

    return write_restricted


def _check_can_edit(
    session: Session,
    org_id: UUID,
    role_key: str,
    role_chain: list[str],
    policy: FieldAccessPolicy,
) -> bool:
    """Check if a role can edit a field via direct grant, inheritance, or system default."""
    # Check direct grant
    grant_stmt = (
        select(RoleFieldAccess)
        .join(Role, Role.role_id == RoleFieldAccess.role_id)
        .where(
            and_(
                RoleFieldAccess.organization_id == org_id,
                RoleFieldAccess.policy_id == policy.policy_id,
                Role.role_key == role_key
            )
        )
    )
    grant = session.execute(grant_stmt).scalar_one_or_none()
    if grant:
        return grant.can_edit

    # Check inherited grants
    for ancestor_role in role_chain:
        if ancestor_role == role_key:
            continue
        ancestor_stmt = (
            select(RoleFieldAccess)
            .join(Role, Role.role_id == RoleFieldAccess.role_id)
            .where(
                and_(
                    RoleFieldAccess.organization_id == org_id,
                    RoleFieldAccess.policy_id == policy.policy_id,
                    Role.role_key == ancestor_role
                )
            )
        )
        ancestor_grant = session.execute(ancestor_stmt).scalar_one_or_none()
        if ancestor_grant and ancestor_grant.can_edit:
            return True

    # Fall back to system defaults
    if policy.default_visible and policy.minimum_permission:
        from app.services.rbac_service import resolve_permissions_with_inheritance
        user_perms = resolve_permissions_with_inheritance(role_key)
        return policy.minimum_permission in user_perms

    # If not visible by default, not editable either
    if not policy.default_visible:
        return False

    # Visible by default with no minimum_permission = editable
    return True


def filter_write_restricted(
    data: dict[str, Any],
    entity_type: str,
    org_id: str,
    user_id: str,
    session=None,
    app_key: str = 'collections'
) -> tuple[dict[str, Any], list[str]]:
    """
    Remove write-restricted fields from incoming data.

    Returns the cleaned data dict and a list of dropped field names
    (for observable logging — names only, never values).

    Args:
        data: Incoming request data dictionary
        entity_type: Entity type (e.g., 'collection_object')
        org_id: Organization ID (string)
        user_id: User ID (string)
        session: Optional database session
        app_key: Application key (default: 'collections')

    Returns:
        Tuple of (cleaned_data, dropped_field_names)
    """
    restricted = get_write_restricted_fields(entity_type, org_id, user_id, session, app_key)
    if not restricted:
        return data, []

    incoming_keys = set(data.keys())
    dropped = sorted(incoming_keys & restricted)

    if dropped:
        logger.warning(
            "field_write_restricted: user=%s entity=%s dropped_fields=%s",
            user_id, entity_type, dropped,
        )

    cleaned = {k: v for k, v in data.items() if k not in restricted}
    return cleaned, dropped


def get_org_field_grants(
    session: Session,
    org_id: UUID,
    app_key: str = 'collections'
) -> list[dict[str, Any]]:
    """
    Get all field access grants for an organization.

    Args:
        session: Database session
        org_id: Organization ID
        app_key: Application key

    Returns:
        List of grant dictionaries with role and policy info
    """
    stmt = (
        select(RoleFieldAccess, Role.role_key, FieldAccessPolicy.field_path, FieldAccessPolicy.entity_type)
        .join(Role, Role.role_id == RoleFieldAccess.role_id)
        .join(FieldAccessPolicy, FieldAccessPolicy.policy_id == RoleFieldAccess.policy_id)
        .join(Application, Application.application_id == FieldAccessPolicy.application_id)
        .where(
            and_(
                RoleFieldAccess.organization_id == org_id,
                Application.key == app_key
            )
        )
    )

    results = session.execute(stmt).all()

    return [
        {
            'role_key': row.role_key,
            'entity_type': row.entity_type,
            'field_path': row.field_path,
            'can_view': row.RoleFieldAccess.can_view,
            'can_edit': row.RoleFieldAccess.can_edit,
        }
        for row in results
    ]
