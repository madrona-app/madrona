"""
Authentication dependencies for FastAPI.

Provides:
- API key auth (require_api_key)
- User auth via Bearer token or refresh cookie (require_auth)
- Cookie-only auth (get_current_user_from_cookie)
- Org role checking (require_org_role)
- Platform admin checking (require_platform_admin)
- Permission checking (require_permission, check_permission_for_session)
- Fresh MFA requirement (require_fresh_mfa)
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from fastapi import Cookie, Depends, Header, HTTPException, Request
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import context as ctx
from app.database import get_db
from app.services.auth_utils import hash_api_key, decode_access_token, hash_refresh_token
from app.services.session_cache import get_cached_session, cache_session
from app.services.rls import set_rls_context_for_session

logger = logging.getLogger(__name__)


# =============================================================================
# Context dataclasses
# =============================================================================


@dataclass(frozen=True)
class APIKeyContext:
    """Context from a validated API key."""
    organization_id: UUID
    api_key_id: UUID
    permissions: list[str]


@dataclass(frozen=True)
class AuthContext:
    """Context from a validated user session (Bearer or cookie)."""
    user_id: UUID
    email: str
    active_organization_id: UUID | None
    mfa_verified: bool
    mfa_at: datetime | None
    role_override: str | None = None


@dataclass(frozen=True)
class OrgContext:
    """Context from an org role check."""
    auth: AuthContext
    organization_id: UUID
    membership_role: str


# =============================================================================
# API Key auth
# =============================================================================


def require_api_key(required_permission: str = "media.view"):
    """
    Returns a FastAPI dependency that validates X-API-Key header.

    Usage:
        @router.get("/endpoint")
        async def endpoint(ctx: APIKeyContext = Depends(require_api_key("media.view"))):
            ...
    """
    async def _dep(
        x_api_key: str = Header(..., alias="X-API-Key"),
        db: Session = Depends(get_db),
    ) -> APIKeyContext:
        from app.models import APIKey

        # Hash the provided key
        key_hash = hash_api_key(x_api_key)

        # Look up by hash + active status
        key_record = db.query(APIKey).filter(
            APIKey.key_hash == key_hash,
            APIKey.status == "active",
        ).first()

        if not key_record:
            raise HTTPException(status_code=401, detail={
                "code": "UNAUTHORIZED",
                "message": "Invalid API key",
            })

        # Check expiration. api_keys.expires_at is timestamptz, so the
        # coercion below is normally a no-op — kept as a guard, since a naive
        # value reaching the comparison raises TypeError and 500s the request.
        if key_record.expires_at:
            expires_at = key_record.expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at < datetime.now(timezone.utc):
                raise HTTPException(status_code=401, detail={
                    "code": "UNAUTHORIZED",
                    "message": "API key has expired",
                })

        # Normalize scopes from any legacy storage format to canonical set
        from app.services.api_key_scopes import normalize_scopes, has_scope
        scopes = normalize_scopes(key_record.scopes)

        # Check required permission
        if not has_scope(scopes, required_permission):
            raise HTTPException(status_code=403, detail={
                "code": "FORBIDDEN",
                "message": f"API key lacks required permission: {required_permission}",
            })

        permissions = sorted(scopes)

        # Set RLS context (PostgreSQL only)
        try:
            set_rls_context_for_session(db, str(key_record.organization_id))
        except Exception:
            logger.warning("Failed to set RLS context for API key %s", key_record.api_key_id)

        # Update last_used_at
        try:
            key_record.last_used_at = datetime.now(timezone.utc)
            db.commit()
        except Exception:
            db.rollback()

        return APIKeyContext(
            organization_id=key_record.organization_id,
            api_key_id=key_record.api_key_id,
            permissions=permissions,
        )

    return _dep


# =============================================================================
# User auth (Bearer token + cookie fallback)
# =============================================================================


def _resolve_from_bearer(authorization: str | None) -> dict | None:
    """Try to decode a Bearer access token. Returns JWT payload or None."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization[7:]
    return decode_access_token(token)


def _resolve_from_cookie(
    refresh_token_value: str | None,
    db: Session,
) -> tuple[dict | None, "RefreshToken | None"]:  # noqa: F821 - quoted forward ref, not evaluated at runtime
    """
    Resolve user from refresh token cookie.

    Returns (payload_dict, token_record) or (None, None).
    """
    if not refresh_token_value:
        return None, None

    from app.models import RefreshToken, User

    token_hash = hash_refresh_token(refresh_token_value)

    # Try cache first
    cached = get_cached_session(token_hash)
    if cached:
        user = db.query(User).filter_by(user_id=cached["user_id"]).first()
        if user and user.status == "active":
            return {
                "sub": str(user.user_id),
                "email": user.email,
                "active_organization_id": str(cached["active_organization_id"]) if cached["active_organization_id"] else None,
                "mfa_verified": cached["mfa_verified"],
                "mfa_at": cached["mfa_at"].isoformat() if cached["mfa_at"] else None,
            }, None
        return None, None

    # Cache miss — query DB
    token_record = (
        db.query(RefreshToken)
        .filter_by(token_hash=token_hash, revoked_at=None)
        .first()
    )
    if not token_record:
        return None, None

    # Check expiration
    expires_at = token_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        return None, None

    user = db.query(User).filter_by(user_id=token_record.user_id).first()
    if not user or user.status != "active":
        return None, None

    # Cache for future requests
    cache_session(token_hash, token_record)

    mfa_at_iso = None
    if token_record.mfa_at:
        mfa_at = token_record.mfa_at
        if mfa_at.tzinfo is None:
            mfa_at = mfa_at.replace(tzinfo=timezone.utc)
        mfa_at_iso = mfa_at.isoformat()

    return {
        "sub": str(user.user_id),
        "email": user.email,
        "active_organization_id": str(token_record.active_organization_id) if token_record.active_organization_id else None,
        "mfa_verified": token_record.mfa_verified,
        "mfa_at": mfa_at_iso,
    }, token_record


async def require_auth(
    request: Request,
    db: Session = Depends(get_db),
) -> AuthContext:
    """
    FastAPI dependency requiring a valid user session.

    Checks Bearer token first, falls back to refresh_token cookie.
    Sets RLS context on the DB session.
    """
    from app.models import User

    authorization = request.headers.get("Authorization")
    payload = _resolve_from_bearer(authorization)

    if not payload:
        refresh_cookie = request.cookies.get("refresh_token")
        payload, _ = _resolve_from_cookie(refresh_cookie, db)

    if not payload:
        raise HTTPException(status_code=401, detail={
            "code": "unauthorized",
            "message": "Authentication required",
        })

    user_id = UUID(payload["sub"])

    # Always verify user is active (fresh DB lookup)
    user = db.query(User).filter_by(user_id=user_id).first()
    if not user or user.status != "active":
        raise HTTPException(status_code=401, detail={
            "code": "unauthorized",
            "message": "User not found or inactive",
        })

    active_org_id = payload.get("active_organization_id")
    active_org_uuid = UUID(active_org_id) if active_org_id else None

    # Set RLS context
    set_rls_context_for_session(db, active_org_id, str(user_id))

    # Set request context vars for audit/logging
    ctx.request_user_id.set(str(user_id))
    if active_org_id:
        ctx.current_org_id.set(active_org_id)

    # Set Sentry user context
    try:
        from app.sentry import set_sentry_user
        set_sentry_user(
            user_id=str(user_id),
            org_id=active_org_id,
        )
    except Exception:
        pass

    mfa_at = None
    if payload.get("mfa_at"):
        try:
            mfa_at = datetime.fromisoformat(payload["mfa_at"])
        except (ValueError, TypeError):
            pass

    return AuthContext(
        user_id=user_id,
        email=user.email,
        active_organization_id=active_org_uuid,
        mfa_verified=bool(payload.get("mfa_verified")),
        mfa_at=mfa_at,
    )


def require_verified_email(
    auth: "AuthContext" = Depends(require_auth),
    db: Session = Depends(get_db),
) -> "AuthContext":
    """Require the authenticated user to have confirmed their email address.

    Hard gate for flows where an unverified (possibly typo'd) email causes real
    harm — entering a billing relationship, sending mail *from* the account.
    The signup soft-gate (#67) lets unverified users use the app; this is the
    explicit opt-in tightening (#70). Raises 403 ``email_verification_required``
    so the frontend can prompt "verify your email first" instead of failing
    opaquely.
    """
    from app.models import User

    user = db.query(User).filter_by(user_id=auth.user_id).first()
    if user is None or user.email_verified_at is None:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "email_verification_required",
                "message": "Please verify your email address before continuing. Check your inbox for the verification link, or resend it from your account settings.",
            },
        )
    return auth


async def get_current_user_from_cookie(
    request: Request,
    db: Session = Depends(get_db),
) -> AuthContext:
    """
    FastAPI dependency requiring a valid refresh_token cookie (no Bearer fallback).

    Used by /me/* routes that should only work with cookie-based sessions.
    """
    from app.models import User

    refresh_cookie = request.cookies.get("refresh_token")
    payload, _ = _resolve_from_cookie(refresh_cookie, db)

    if not payload:
        raise HTTPException(status_code=401, detail={
            "code": "unauthorized",
            "message": "Authentication required",
        })

    user_id = UUID(payload["sub"])
    user = db.query(User).filter_by(user_id=user_id).first()
    if not user or user.status != "active":
        raise HTTPException(status_code=401, detail={
            "code": "unauthorized",
            "message": "User not found or inactive",
        })

    active_org_id = payload.get("active_organization_id")
    active_org_uuid = UUID(active_org_id) if active_org_id else None

    set_rls_context_for_session(db, active_org_id, str(user_id))

    mfa_at = None
    if payload.get("mfa_at"):
        try:
            mfa_at = datetime.fromisoformat(payload["mfa_at"])
        except (ValueError, TypeError):
            pass

    return AuthContext(
        user_id=user_id,
        email=user.email,
        active_organization_id=active_org_uuid,
        mfa_verified=bool(payload.get("mfa_verified")),
        mfa_at=mfa_at,
    )



# =============================================================================
# Organization lifecycle
# =============================================================================

# An organization is usable only while it is active. `pending` is set by the
# provisioning saga and cleared by its last step, so it means "half-built";
# anything else means an operator has taken the organization out of service.
_USABLE_ORG_STATUS = "active"


def assert_organization_usable(db: Session, organization_id) -> None:
    """Refuse access to an organization that is not active.

    The public surfaces already filter on `Organization.status == "active"`
    (discover, content, crm, agent). The authenticated path checked only
    `user.status`, so an organization could be marked suspended and every
    member carried on working — the lever existed and moved nothing.

    This is deliberately a platform primitive, not a commercial one. It knows
    nothing about plans, payment or tiers; it enforces a lifecycle an operator
    controls, whether that operator is decommissioning a department,
    offboarding an institution, responding to abuse, or running a hosted
    service whose own control plane decides what "in service" means.

    Platform admins are not subject to it: the account that has to fix or
    reactivate a suspended organization cannot be locked out of it.
    """
    if organization_id is None:
        return

    from app.models import Organization

    status = (
        db.query(Organization.status)
        .filter(Organization.organization_id == organization_id)
        .scalar()
    )
    # No row is not this check's business — membership and RLS answer that,
    # and reporting "suspended" for an organization that does not exist would
    # be a worse error than the one the caller is about to get anyway.
    if status is None or status == _USABLE_ORG_STATUS:
        return

    raise HTTPException(status_code=403, detail={
        "code": "organization_unavailable",
        "message": (
            "This organization is not currently active. "
            "Contact your administrator."
        ),
        "details": {"status": status},
    })


# =============================================================================
# Org role check
# =============================================================================


def require_org_role(min_role: str = "member"):
    """
    Returns a FastAPI dependency that checks org membership + minimum role.

    Must be used after require_auth.

    Usage:
        @router.get("/orgs/{organization_id}/data")
        async def get_data(
            organization_id: UUID,
            org: OrgContext = Depends(require_org_role("admin")),
        ):
            ...
    """
    async def _dep(
        organization_id: UUID,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
    ) -> OrgContext:
        from app.models import OrganizationMembership

        # `status == "active"` matters: require_permission filters on it and
        # this did not, so a deactivated member kept every route guarded by
        # require_org_role — the org dashboards among them.
        membership = (
            db.query(OrganizationMembership)
            .filter_by(
                user_id=auth.user_id,
                organization_id=organization_id,
                status="active",
            )
            .first()
        )

        if not membership:
            raise HTTPException(status_code=403, detail={
                "code": "forbidden",
                "message": "Not a member of this organization",
            })

        if min_role == "admin" and membership.role != "admin":
            raise HTTPException(status_code=403, detail={
                "code": "forbidden",
                "message": "Admin role required",
            })

        assert_organization_usable(db, organization_id)

        # Re-set RLS if route org differs from active org
        if organization_id != auth.active_organization_id:
            set_rls_context_for_session(db, str(organization_id), str(auth.user_id))

        return OrgContext(
            auth=auth,
            organization_id=organization_id,
            membership_role=membership.role,
        )

    return _dep


# =============================================================================
# Platform admin check
# =============================================================================


async def require_platform_admin(
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
) -> AuthContext:
    """
    FastAPI dependency requiring platform.admin permission.

    Inlines the permission check to avoid Flask-SQLAlchemy dependency
    from rbac_service.
    """
    from app.models.core import (
        OrganizationMembership,
        Role,
        RolePermission,
        Permission as PermissionModel,
    )

    has_admin = (
        db.query(PermissionModel.permission_id)
        .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
        .join(Role, Role.role_id == RolePermission.role_id)
        .join(OrganizationMembership, OrganizationMembership.role_id == Role.role_id)
        .filter(
            OrganizationMembership.user_id == auth.user_id,
            PermissionModel.permission_key == "platform.admin",
        )
        .first()
    ) is not None

    if not has_admin:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Platform admin privileges required",
        })

    return auth


# =============================================================================
# Permission check (RBAC)
# =============================================================================

DEFAULT_MFA_FRESHNESS_MINUTES = 15


def _is_platform_admin(db: Session, user_id: UUID) -> bool:
    """Check if user holds platform.admin via any ACTIVE membership.

    Deliberately not org-scoped — platform admin is cross-organization by
    design. It IS status-scoped: without that filter, deactivating a
    platform admin's membership left them holding every /api/platform/*
    route, because this check never looked at membership status while
    require_permission does.
    """
    from app.models.core import (
        OrganizationMembership,
        Role,
        RolePermission,
        Permission as PermissionModel,
    )

    return (
        db.query(PermissionModel.permission_id)
        .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
        .join(Role, Role.role_id == RolePermission.role_id)
        .join(OrganizationMembership, OrganizationMembership.role_id == Role.role_id)
        .filter(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.status == "active",
            PermissionModel.permission_key == "platform.admin",
        )
        .first()
    ) is not None


def check_permission_for_session(
    db: Session,
    user_id: UUID,
    organization_id: UUID,
    permission: "Permission",  # noqa: F821 - quoted forward ref, not evaluated at runtime
) -> bool:
    """
    Check if a user has a specific permission in an organization.

    Resolves permissions via role inheritance for system roles,
    or direct permission lookup for custom roles.
    Platform admins always pass.

    Args:
        db: SQLAlchemy session
        user_id: User UUID
        organization_id: Organization UUID
        permission: Permission enum value

    Returns:
        True if user has the permission, False otherwise
    """
    from app.models.core import (
        OrganizationMembership,
        Role,
        RolePermission,
        Permission as PermissionModel,
    )
    from app.permissions import Permission as PermissionEnum, get_role_inheritance_chain

    # Platform admins bypass
    if _is_platform_admin(db, user_id):
        return True

    # Get user's role in this org
    role_result = (
        db.execute(
            select(Role.role_id, Role.role_key, Role.is_system)
            .join(OrganizationMembership, OrganizationMembership.role_id == Role.role_id)
            .where(
                OrganizationMembership.user_id == user_id,
                OrganizationMembership.organization_id == organization_id,
                OrganizationMembership.status == "active",
            )
        )
        .first()
    )

    if not role_result:
        return False

    role_id, role_key, is_system = role_result
    permission_key = permission.value if isinstance(permission, PermissionEnum) else permission

    if is_system:
        # System role: resolve via inheritance chain
        try:
            role_chain = get_role_inheritance_chain(role_key)
        except ValueError:
            return False

        has_perm = (
            db.query(PermissionModel.permission_id)
            .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
            .join(Role, Role.role_id == RolePermission.role_id)
            .filter(
                Role.role_key.in_(role_chain),
                PermissionModel.permission_key == permission_key,
            )
            .first()
        ) is not None
    else:
        # Custom role: direct permission lookup by role_id
        has_perm = (
            db.query(PermissionModel.permission_id)
            .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
            .filter(
                RolePermission.role_id == role_id,
                PermissionModel.permission_key == permission_key,
            )
            .first()
        ) is not None

    return has_perm


def _get_role_override(request: Request, db: "Session | None" = None) -> str | None:
    """
    Extract X-Role-Override header if present and valid.

    Accepts system role keys (e.g., 'curator') or custom role UUIDs.
    """
    from app.permissions import ROLE_INHERITANCE_MAP
    override = request.headers.get("x-role-override")
    if not override or override == "platform_admin":
        return None
    # System role override
    if override in ROLE_INHERITANCE_MAP:
        return override
    # Custom role override (UUID) — validate it exists
    if db:
        try:
            from app.models.core import Role
            role_id = UUID(override)
            role = db.query(Role).filter_by(role_id=role_id, is_active=True).first()
            if role and not role.is_system:
                return override  # Return UUID string
        except (ValueError, AttributeError):
            pass
    return None


def require_permission(*required_permissions, ignore_role_override: bool = False):
    """
    Factory returning a FastAPI dependency that checks RBAC permissions.

    Takes one or more Permission enum values (OR logic — any match passes).
    Platform admins bypass all checks unless X-Role-Override header is set,
    in which case permissions are evaluated as if the admin held that role.

    Set ``ignore_role_override=True`` for endpoints that power the Test Role UI
    itself (e.g. listing roles), so platform admins retain access even while an
    override is active.

    Usage:
        @router.patch("/organizations/{org_id}")
        async def update_org(
            org_id: UUID,
            auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
        ):
            ...
    """
    async def _dep(
        request: Request,
        auth: AuthContext = Depends(require_auth),
        db: Session = Depends(get_db),
    ) -> AuthContext:
        from app.models.core import (
            OrganizationMembership,
            Role,
            RolePermission,
            Permission as PermissionModel,
        )
        from app.permissions import Permission as PermissionEnum, get_role_inheritance_chain

        # Platform admins bypass — unless role override is active
        if _is_platform_admin(db, auth.user_id):
            role_override = None if ignore_role_override else _get_role_override(request, db=db)
            if not role_override:
                logger.info(
                    "platform_admin_bypass user_id=%s path=%s method=%s org_context=%s",
                    auth.user_id, request.url.path, request.method,
                    request.path_params.get("org_id", auth.active_organization_id),
                )
                return auth
            # Use the override role's permissions instead of bypassing
            auth_with_override = AuthContext(
                user_id=auth.user_id,
                email=auth.email,
                active_organization_id=auth.active_organization_id,
                mfa_verified=auth.mfa_verified,
                mfa_at=auth.mfa_at,
                role_override=role_override,
            )
            permission_keys = [
                p.value if isinstance(p, PermissionEnum) else p
                for p in required_permissions
            ]
            # Check if override is a UUID (custom role) or system role key
            try:
                override_role_id = UUID(role_override)
                # Custom role override — direct permission lookup
                has_perm = (
                    db.query(PermissionModel.permission_id)
                    .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
                    .filter(
                        RolePermission.role_id == override_role_id,
                        PermissionModel.permission_key.in_(permission_keys),
                    )
                    .first()
                ) is not None
            except ValueError:
                # System role override — use inheritance chain
                role_chain = get_role_inheritance_chain(role_override)
                has_perm = (
                    db.query(PermissionModel.permission_id)
                    .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
                    .join(Role, Role.role_id == RolePermission.role_id)
                    .filter(
                        Role.role_key.in_(role_chain),
                        PermissionModel.permission_key.in_(permission_keys),
                    )
                    .first()
                ) is not None
            if not has_perm:
                raise HTTPException(status_code=403, detail={
                    "code": "forbidden",
                    "message": f"This action requires one of: {', '.join(permission_keys)}",
                })
            return auth_with_override

        # Resolve organization_id from path params or active org
        org_id = request.path_params.get("org_id") or request.path_params.get("organization_id")
        if org_id:
            org_id = UUID(str(org_id))
        else:
            org_id = auth.active_organization_id

        if not org_id:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Organization context required",
            })

        # The organization has to be in service. Checked after the
        # platform-admin bypass above, deliberately: the account that
        # reactivates a suspended organization must still be able to reach it.
        assert_organization_usable(db, org_id)

        # Check active membership and get role info
        role_result = (
            db.execute(
                select(Role.role_id, Role.role_key, Role.is_system)
                .join(OrganizationMembership, OrganizationMembership.role_id == Role.role_id)
                .where(
                    OrganizationMembership.user_id == auth.user_id,
                    OrganizationMembership.organization_id == org_id,
                    OrganizationMembership.status == "active",
                )
            )
            .first()
        )

        if not role_result:
            raise HTTPException(status_code=403, detail={
                "code": "forbidden",
                "message": "Not a member of this organization",
            })

        role_id, role_key, is_system = role_result

        # Convert Permission enums to strings
        permission_keys = [
            p.value if isinstance(p, PermissionEnum) else p
            for p in required_permissions
        ]

        if is_system:
            # System role: resolve via inheritance chain
            try:
                role_chain = get_role_inheritance_chain(role_key)
            except ValueError:
                raise HTTPException(status_code=403, detail={
                    "code": "forbidden",
                    "message": "Invalid role configuration",
                })

            has_perm = (
                db.query(PermissionModel.permission_id)
                .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
                .join(Role, Role.role_id == RolePermission.role_id)
                .filter(
                    Role.role_key.in_(role_chain),
                    PermissionModel.permission_key.in_(permission_keys),
                )
                .first()
            ) is not None
        else:
            # Custom role: direct permission lookup by role_id
            has_perm = (
                db.query(PermissionModel.permission_id)
                .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
                .filter(
                    RolePermission.role_id == role_id,
                    PermissionModel.permission_key.in_(permission_keys),
                )
                .first()
            ) is not None

        if not has_perm:
            raise HTTPException(status_code=403, detail={
                "code": "forbidden",
                "message": f"This action requires one of: {', '.join(permission_keys)}",
            })

        # Re-set RLS if route org differs from active org
        if org_id != auth.active_organization_id:
            set_rls_context_for_session(db, str(org_id), str(auth.user_id))

        return auth

    return _dep


# =============================================================================
# Org context validation for query-param endpoints
# =============================================================================


def get_authorized_org_id(
    request: Request,
    auth: AuthContext,
    query_org_id: UUID | str | None = None,
) -> UUID:
    """
    Return the organization_id that was actually authorized by require_permission.

    require_permission resolves org from path params or active_organization_id.
    If an endpoint also accepts org_id via Query/body, this helper ensures the
    supplied value matches the authorized context — preventing cross-tenant
    access when a user passes a different org_id in the query string.

    Args:
        request: The current request (to check path_params)
        auth: The AuthContext from require_permission / require_auth
        query_org_id: The org_id from Query param or request body (optional)

    Returns:
        The validated organization UUID

    Raises:
        HTTPException 403 if query_org_id doesn't match the authorized org
        HTTPException 400 if no org context is available
    """
    # Path param takes priority — already validated by require_permission
    path_org = request.path_params.get("org_id") or request.path_params.get("organization_id")
    if path_org:
        return UUID(str(path_org))

    authorized_org = auth.active_organization_id

    if query_org_id is not None:
        parsed = UUID(str(query_org_id)) if not isinstance(query_org_id, UUID) else query_org_id
        if authorized_org and parsed != authorized_org:
            raise HTTPException(status_code=403, detail={
                "code": "forbidden",
                "message": "Cannot access resources in a different organization",
            })
        return parsed

    if not authorized_org:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Organization context required",
        })
    return authorized_org


# =============================================================================
# Fresh MFA check
# =============================================================================


def require_fresh_mfa(freshness_minutes: int = DEFAULT_MFA_FRESHNESS_MINUTES):
    """
    Factory returning a FastAPI dependency that requires recent MFA verification.

    Usage:
        @router.post("/organizations/{org_id}/users")
        async def create_user(
            auth: AuthContext = Depends(require_fresh_mfa()),
        ):
            ...
    """
    async def _dep(
        auth: AuthContext = Depends(require_auth),
    ) -> AuthContext:
        # Local auth provider has no MFA — the freshness gate would lock
        # every sensitive operation forever. Pass through (logged once).
        from app.config import get_settings
        if get_settings().resolved_auth_provider == "local":
            from app.services.auth_backend import warn_local_mfa_once
            warn_local_mfa_once()
            return auth

        if not auth.mfa_verified:
            raise HTTPException(status_code=401, detail={
                "code": "mfa_required",
                "message": "MFA verification required",
                "mfaRequired": True,
            })

        if auth.mfa_at:
            now = datetime.now(timezone.utc)
            mfa_time = auth.mfa_at
            if mfa_time.tzinfo is None:
                mfa_time = mfa_time.replace(tzinfo=timezone.utc)
            age_minutes = (now - mfa_time).total_seconds() / 60

            if age_minutes > freshness_minutes:
                raise HTTPException(status_code=403, detail={
                    "code": "mfa_stale",
                    "message": "MFA verification has expired",
                    "mfaStale": True,
                    "mfaAgeMinutes": int(age_minutes),
                    "requiredFreshnessMinutes": freshness_minutes,
                })

        return auth

    return _dep
