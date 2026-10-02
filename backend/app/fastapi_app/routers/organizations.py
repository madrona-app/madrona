"""
Organization admin router — 21 routes migrated from Flask.

Sources:
- app/api/organizations.py (routes 1-6)
- app/api/org_users.py (routes 7-16)
- app/api/invitations.py (routes 17-18)
- app/api/api_keys.py (routes 19-21)
"""

import logging
import secrets
import string
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.fastapi_app.dependencies.auth import (
    AuthContext,
    require_auth,
    require_permission,
    require_verified_email,
    require_fresh_mfa,
    check_permission_for_session,
    get_authorized_org_id,
    _is_platform_admin,
)
from app.fastapi_app.schemas.organizations import (
    AcceptInvitationBody,
    AcceptInvitationResponse,
    APIKeyListResponse,
    CreateAPIKeyBody,
    CreateAPIKeyResponse,
    CreateOrganizationBody,
    CreateUserBody,
    CreateUserResponse,
    InvitationOut,
    InviteUserBody,
    OrganizationOut,
    OrganizationStorageResponse,
    RemoveAppRoleResponse,
    RevokeAPIKeyResponse,
    RoleLabelBody,
    RoleLabelResetResponse,
    RoleLabelSetResponse,
    RoleLabelsResponse,
    RolesResponse,
    OrgUsersResponse,
    SetAppRoleBody,
    SetAppRoleResponse,
    StorageRegionsResponse,
    TimezonesResponse,
    UpdateOrganizationBody,
    UpdateUserBody,
    UserAppRolesResponse,
    UserUpdateResponse,
)
from app.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter(tags=["organizations"])


def _generate_temp_password(length: int = 16) -> str:
    """Generate a secure temporary password meeting Cognito requirements."""
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*"
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(length))
        if (
            any(c.isupper() for c in password)
            and any(c.islower() for c in password)
            and any(c.isdigit() for c in password)
            and any(c in "!@#$%^&*" for c in password)
        ):
            return password


# =============================================================================
# 1. GET /api/organizations — list user's organizations
# =============================================================================


@router.get("/api/organizations", response_model=list[OrganizationOut], summary="List organizations")
def list_organizations(
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """List organizations."""
    from app.models import Organization, OrganizationMembership

    memberships = (
        db.query(OrganizationMembership)
        .filter_by(user_id=auth.user_id)
        .all()
    )

    org_ids = [m.organization_id for m in memberships]
    if not org_ids:
        return []

    organizations = (
        db.query(Organization)
        .filter(Organization.organization_id.in_(org_ids))
        .order_by(Organization.created_at.desc())
        .all()
    )

    return [
        {
            "organization_id": str(org.organization_id),
            "name": org.name,
            "slug": org.slug,
            "timezone": org.timezone,
            "created_at": org.created_at.isoformat(),
        }
        for org in organizations
    ]


# =============================================================================
# 2. POST /api/organizations — create organization (platform admin)
# =============================================================================


@router.post("/api/organizations", status_code=201, response_model=OrganizationOut, summary="Create organization")
def create_organization(
    body: CreateOrganizationBody,
    auth: AuthContext = Depends(require_permission(Permission.PLATFORM_ADMIN)),
    db: Session = Depends(get_db),
):
    """Create organization."""
    from app.models import Organization
    from app.services.time import is_valid_timezone

    # Check slug uniqueness
    existing = db.query(Organization).filter_by(slug=body.slug).first()
    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f"Organization with slug '{body.slug}' already exists",
        })

    # Validate timezone
    if not is_valid_timezone(body.timezone):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": f"Invalid timezone: '{body.timezone}'. Must be a valid IANA timezone identifier.",
            "field": "timezone",
        })

    organization = Organization(
        name=body.name,
        slug=body.slug,
        timezone=body.timezone,
    )
    db.add(organization)
    db.commit()
    db.refresh(organization)

    return {
        "organization_id": str(organization.organization_id),
        "name": organization.name,
        "slug": organization.slug,
        "timezone": organization.timezone,
        "created_at": organization.created_at.isoformat(),
    }


# =============================================================================
# 3. PATCH /api/organizations/{org_id} — update organization
# =============================================================================


@router.patch("/api/organizations/{org_id}", response_model=OrganizationOut, summary="Update organization")
def update_organization(
    org_id: UUID,
    body: UpdateOrganizationBody,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Update organization."""
    from app.models import Organization
    from app.services.time import is_valid_timezone

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Organization not found",
        })

    if body.name is not None:
        name = body.name.strip()
        if len(name) == 0:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "name cannot be empty",
                "field": "name",
            })
        if len(name) > 200:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "name cannot exceed 200 characters",
                "field": "name",
            })
        org.name = name

    if body.timezone is not None:
        if not is_valid_timezone(body.timezone):
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": f"Invalid timezone: '{body.timezone}'. Must be a valid IANA timezone identifier.",
                "field": "timezone",
            })
        org.timezone = body.timezone

    db.commit()
    db.refresh(org)

    return {
        "organization_id": str(org.organization_id),
        "name": org.name,
        "slug": org.slug,
        "timezone": org.timezone,
        "updated_at": org.updated_at.isoformat(),
        "message": "Organization updated successfully",
    }


# =============================================================================
# 4. GET /api/timezones — public
# =============================================================================


@router.get("/api/timezones", response_model=TimezonesResponse, summary="List timezones")
def list_timezones(all: str = Query("false")):
    """List timezones."""
    from app.services.time import get_common_timezones, get_all_timezones

    if all.lower() == "true":
        timezones = get_all_timezones()
    else:
        timezones = get_common_timezones()

    return {"timezones": timezones}


# =============================================================================
# 5. GET /api/organizations/{org_id}/storage — storage usage
# =============================================================================


@router.get("/api/organizations/{org_id}/storage", response_model=OrganizationStorageResponse, summary="Get organization storage")
def get_organization_storage(
    org_id: UUID,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Get organization storage."""
    from app.models import Organization, OrganizationMembership

    membership = (
        db.query(OrganizationMembership)
        .filter_by(user_id=auth.user_id, organization_id=org_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Organization not found",
        })

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Organization not found",
        })

    media_bytes = org.storage_used_bytes or 0
    db_bytes = org.db_used_bytes or 0
    search_bytes = org.search_used_bytes or 0
    total_used_bytes = media_bytes + db_bytes + search_bytes
    limit_gb = org.storage_limit_gb if org.storage_limit_gb is not None else Organization.DEFAULT_STORAGE_LIMIT_GB
    limit_bytes = limit_gb * 1024 * 1024 * 1024
    remaining_bytes = max(0, limit_bytes - total_used_bytes)
    usage_percent = (total_used_bytes / limit_bytes * 100) if limit_bytes > 0 else 0

    return {
        "usage": {
            "used_bytes": total_used_bytes,
            "used_gb": round(total_used_bytes / (1024 ** 3), 2),
            "limit_bytes": limit_bytes,
            "limit_gb": limit_gb,
            "remaining_bytes": remaining_bytes,
            "remaining_gb": round(remaining_bytes / (1024 ** 3), 2),
            "usage_percent": round(usage_percent, 2),
            "media_bytes": media_bytes,
            "db_bytes": db_bytes,
            "search_bytes": search_bytes,
            "metered_at": org.storage_metered_at.isoformat() if org.storage_metered_at else None,
        },
        "region": org.storage_region or "us-west-2",
    }


# =============================================================================
# 6. GET /api/storage-regions — list regions
# =============================================================================


@router.get("/api/storage-regions", response_model=StorageRegionsResponse, summary="List storage regions")
def list_storage_regions(
    auth: AuthContext = Depends(require_auth),
):
    """List storage regions."""
    from app.services.uploads import SUPPORTED_REGIONS

    region_names = {
        "us-west-2": "US West (Oregon)",
        "us-east-1": "US East (Virginia)",
        "ca-central-1": "Canada (Central)",
        "eu-west-1": "EU (Ireland)",
        "eu-central-1": "EU (Frankfurt)",
    }

    return {
        "regions": [
            {
                "code": region,
                "name": region_names.get(region, region),
                "default": region == "us-west-2",
            }
            for region in SUPPORTED_REGIONS
        ]
    }


# =============================================================================
# 7. GET /api/organizations/{org_id}/roles — available roles
# =============================================================================


@router.get("/api/organizations/{org_id}/roles", response_model=RolesResponse, summary="Get organization roles")
def get_organization_roles(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_MEMBERS)),
    db: Session = Depends(get_db),
):
    """Get organization roles."""
    from app.models import Organization, Role
    from app.services.rbac_service import get_role_label_for_org

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Organization not found",
        })

    from sqlalchemy import or_, and_

    roles = (
        db.query(Role)
        .filter(
            or_(
                Role.is_system == True,
                and_(Role.organization_id == org_id, Role.is_active == True),
            ),
            Role.role_key != 'platform_admin',
        )
        .order_by(Role.is_system.desc(), Role.role_key)
        .all()
    )

    return {
        "roles": [
            {
                "role_id": str(role.role_id),
                "role_key": role.role_key,
                "display_name": (
                    get_role_label_for_org(role.role_key, org_id, session=db)
                    if role.is_system else role.display_name
                ),
                "description": role.description,
            }
            for role in roles
        ],
    }


# =============================================================================
# 8. GET /api/organizations/{org_id}/role-labels — role labels
# =============================================================================


@router.get("/api/organizations/{org_id}/role-labels", response_model=RoleLabelsResponse, summary="Get organization role labels")
def get_organization_role_labels(
    org_id: UUID,
    app_key: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Get organization role labels."""
    from app.models import Organization, Role, OrgRoleLabel
    from app.services.rbac_service import get_role_label_for_org

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Organization not found",
        })

    roles = (
        db.query(Role)
        .filter_by(is_system=True)
        .order_by(Role.role_key)
        .all()
    )

    # Get org-wide overrides
    org_wide = db.query(OrgRoleLabel).filter_by(
        organization_id=org_id,
        app_key='',
    ).all()
    org_wide_map = {o.role_key: o.label for o in org_wide}

    # Get app-specific overrides (if app_key provided)
    app_map: dict[str, str] = {}
    if app_key:
        app_overrides = db.query(OrgRoleLabel).filter_by(
            organization_id=org_id,
            app_key=app_key,
        ).all()
        app_map = {o.role_key: o.label for o in app_overrides}

    return {
        "role_labels": [
            {
                "role_key": role.role_key,
                "display_name": get_role_label_for_org(role.role_key, org_id, app_key=app_key, session=db),
                "default_name": role.display_name,
                "is_custom": role.role_key in app_map or role.role_key in org_wide_map,
                "app_key": app_key,
                "is_app_custom": role.role_key in app_map,
            }
            for role in roles
        ],
    }


# =============================================================================
# 9. PUT /api/organizations/{org_id}/role-labels/{role_key} — set label
# =============================================================================


@router.put("/api/organizations/{org_id}/role-labels/{role_key}", response_model=RoleLabelSetResponse, summary="Set organization role label")
def set_organization_role_label(
    org_id: UUID,
    role_key: str,
    body: RoleLabelBody,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Set organization role label."""
    from app.models import Organization, Role, OrganizationMembership
    from app.services.rbac_service import (
        set_org_role_label,
        get_role_label_for_org,
        is_platform_admin,
    )

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Organization not found",
        })

    # Check if user is admin or platform_admin
    membership_with_role = (
        db.query(OrganizationMembership, Role)
        .join(Role, OrganizationMembership.role_id == Role.role_id)
        .filter(
            OrganizationMembership.organization_id == org_id,
            OrganizationMembership.user_id == auth.user_id,
            OrganizationMembership.status == "active",
        )
        .first()
    )

    is_org_admin = membership_with_role and membership_with_role[1].role_key == "admin"
    is_plat_admin = is_platform_admin(auth.user_id, session=db)

    if not is_org_admin and not is_plat_admin:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Only organization administrators can customize role labels",
        })

    # Verify role exists
    role = db.query(Role).filter_by(role_key=role_key).first()
    if not role:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Role not found",
        })

    label = body.label.strip()
    if not label:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "label cannot be empty",
            "field": "label",
        })

    set_org_role_label(org_id, role_key, label, app_key=body.app_key, session=db)

    return {
        "status": "ok",
        "role_key": role_key,
        "display_name": get_role_label_for_org(role_key, org_id, app_key=body.app_key, session=db),
        "is_custom": True,
        "app_key": body.app_key,
    }


# =============================================================================
# 10. DELETE /api/organizations/{org_id}/role-labels/{role_key} — reset label
# =============================================================================


@router.delete("/api/organizations/{org_id}/role-labels/{role_key}", response_model=RoleLabelResetResponse, summary="Reset organization role label")
def reset_organization_role_label(
    org_id: UUID,
    role_key: str,
    app_key: str | None = None,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Reset organization role label."""
    from app.models import Organization, Role, OrganizationMembership
    from app.services.rbac_service import (
        remove_org_role_label,
        get_role_label_for_org,
        is_platform_admin,
    )

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Organization not found",
        })

    # Check if user is admin or platform_admin
    membership_with_role = (
        db.query(OrganizationMembership, Role)
        .join(Role, OrganizationMembership.role_id == Role.role_id)
        .filter(
            OrganizationMembership.organization_id == org_id,
            OrganizationMembership.user_id == auth.user_id,
            OrganizationMembership.status == "active",
        )
        .first()
    )

    is_org_admin = membership_with_role and membership_with_role[1].role_key == "admin"
    is_plat_admin = is_platform_admin(auth.user_id, session=db)

    if not is_org_admin and not is_plat_admin:
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Only organization administrators can reset role labels",
        })

    role = db.query(Role).filter_by(role_key=role_key).first()
    if not role:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Role not found",
        })

    removed = remove_org_role_label(org_id, role_key, app_key=app_key, session=db)

    return {
        "status": "ok",
        "role_key": role_key,
        "display_name": get_role_label_for_org(role_key, org_id, app_key=app_key, session=db),
        "is_custom": False,
        "was_custom": removed,
    }


# =============================================================================
# 11. POST /api/organizations/{org_id}/users — create user
# =============================================================================


@router.post("/api/organizations/{org_id}/users", status_code=201, response_model=CreateUserResponse, summary="Create user for org")
def create_user_for_org(
    org_id: UUID,
    body: CreateUserBody,
    request: Request,
    auth: AuthContext = Depends(require_fresh_mfa()),
    db: Session = Depends(get_db),
):
    """Create user for org."""
    from botocore.exceptions import ClientError

    from app.models import Organization, OrganizationMembership, Role, User
    from app.services import audit_service
    from app.services.auth_backend import admin_create_user as cognito_admin_create_user, admin_delete_user as cognito_admin_delete_user
    from app.services.email_service import get_email_service
    from app.services.invitation_service import create_user_invitation

    # Permission check (require_fresh_mfa already ran require_auth)
    if not check_permission_for_session(db, auth.user_id, org_id, Permission.ORG_USERS_CREATE):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Cannot create users for this organization",
        })

    # Validate email format
    if "@" not in body.email or "." not in body.email.split("@")[1]:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Invalid email format",
            "field": "email",
        })

    # Validate organization
    organization = db.query(Organization).filter_by(organization_id=org_id).first()
    if not organization:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Organization not found",
        })

    # Validate role
    role = db.query(Role).filter_by(role_id=body.role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Role not found",
        })

    # platform_admin is internal — cannot be assigned through the API.
    #
    # The two sibling handlers that assign a role (_handle_role_update,
    # _handle_reactivation) both refuse it, and get_organization_roles filters
    # it out of the picker, but this handler only checked that the role
    # EXISTS. Its id is a fixed value in seeds/seed_roles_and_permissions.py,
    # so it is public knowledge; and _is_platform_admin matches a membership
    # in ANY organization, so one grant here is cross-tenant platform access.
    # An org admin could therefore invite an address they control, assign this
    # role, and own every tenant on the deployment.
    if role.role_key == 'platform_admin':
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Platform admin role cannot be assigned",
        })

    # Check if user already exists
    existing_user = db.query(User).filter_by(email=body.email).first()

    if existing_user:
        # Check if already a member
        existing_membership = (
            db.query(OrganizationMembership)
            .filter_by(user_id=existing_user.user_id, organization_id=org_id)
            .first()
        )

        if existing_membership:
            if existing_membership.status == "active":
                raise HTTPException(status_code=409, detail={
                    "code": "conflict",
                    "message": "User is already an active member of this organization",
                })
            else:
                # Reactivate
                existing_membership.status = "active"
                existing_membership.role_id = body.role_id
                db.commit()

                try:
                    audit_service.log_user_reactivated(
                        session=db,
                        organization_id=org_id,
                        acting_user_id=auth.user_id,
                        target_user_id=existing_user.user_id,
                        membership_id=existing_membership.membership_id,
                    )
                    db.commit()
                except Exception as e:
                    logger.error("Failed to log audit event: %s", str(e))

                return JSONResponse(
                    status_code=200,
                    content={
                        "user": {
                            "user_id": str(existing_user.user_id),
                            "email": existing_user.email,
                            "name": existing_user.display_name,
                            "status": existing_user.status,
                        },
                        "membership": {
                            "membership_id": str(existing_membership.membership_id),
                            "organization_id": str(org_id),
                            "role_id": str(body.role_id),
                            "role_key": role.role_key,
                            "status": "active",
                            "created_at": existing_membership.created_at.isoformat(),
                        },
                        "invitation_sent": False,
                        "message": "User membership reactivated",
                    },
                )

        # User exists but not a member — create membership
        membership = OrganizationMembership(
            user_id=existing_user.user_id,
            organization_id=org_id,
            role_id=body.role_id,
            role="member",
            status="active",
        )
        db.add(membership)
        db.commit()

        invitation_sent = False
        try:
            settings = get_settings()
            if settings.email_enabled:
                email_service = get_email_service()
                email_service.send_org_added_email(
                    email=body.email,
                    org_name=organization.name,
                )
                invitation_sent = True
        except Exception as e:
            logger.warning("Failed to send invitation email: %s", str(e))

        return {
            "user": {
                "user_id": str(existing_user.user_id),
                "email": existing_user.email,
                "name": existing_user.display_name,
                "status": existing_user.status,
                "created": False,
            },
            "membership": {
                "membership_id": str(membership.membership_id),
                "organization_id": str(org_id),
                "role_id": str(body.role_id),
                "role_key": role.role_key,
                "status": "active",
                "created_at": membership.created_at.isoformat(),
                "created": True,
            },
            "invitation_sent": invitation_sent,
        }

    # New user — create in Cognito + DB atomically
    temp_password = _generate_temp_password()
    try:
        cognito_admin_create_user(
            email=body.email,
            temporary_password=temp_password,
            suppress_welcome=True,
        )
    except ClientError as e:
        error_code = e.response.get("Error", {}).get("Code", "")
        if error_code != "UsernameExistsException":
            logger.error("Failed to create Cognito user for %s: %s", body.email, e)
            raise HTTPException(status_code=500, detail={
                "code": "internal_error",
                "message": "Failed to create authentication account",
            })
        logger.warning("Cognito user %s already exists, continuing", body.email)

    user = User(
        email=body.email,
        password_hash="",
        status="invited",
        email_status="active",
    )
    if body.name:
        user.display_name = body.name
    db.add(user)
    db.flush()

    membership = OrganizationMembership(
        user_id=user.user_id,
        organization_id=org_id,
        role_id=body.role_id,
        role="member",
        status="active",
    )
    db.add(membership)

    try:
        db.commit()
    except Exception:
        try:
            cognito_admin_delete_user(body.email)
        except Exception as cleanup_err:
            logger.error("Failed to clean up Cognito user %s: %s", body.email, cleanup_err)
        raise

    invitation_sent = False
    try:
        invitation, token = create_user_invitation(
            session=db,
            organization_id=org_id,
            user_id=user.user_id,
            email=body.email,
            role_id=body.role_id,
            invited_by_user_id=auth.user_id,
        )
        invitation_sent = True
    except Exception as e:
        logger.error("Failed to create invitation for new user: %s", str(e))

    try:
        audit_service.log_user_invited(
            session=db,
            organization_id=org_id,
            acting_user_id=auth.user_id,
            target_user_id=user.user_id,
            email=body.email,
            role_id=body.role_id,
            role_key=role.role_key,
        )
        db.commit()
    except Exception as e:
        logger.error("Failed to log audit event: %s", str(e))

    return {
        "user": {
            "user_id": str(user.user_id),
            "email": user.email,
            "name": user.display_name,
            "status": user.status,
            "created": True,
        },
        "membership": {
            "membership_id": str(membership.membership_id),
            "organization_id": str(org_id),
            "role_id": str(body.role_id),
            "role_key": role.role_key,
            "status": "active",
            "created_at": membership.created_at.isoformat(),
            "created": True,
        },
        "invitation_sent": invitation_sent,
    }


# =============================================================================
# 12. GET /api/organizations/{org_id}/users — list users
# =============================================================================


@router.get("/api/organizations/{org_id}/users", response_model=OrgUsersResponse, summary="List organization users")
def list_organization_users(
    org_id: UUID,
    status: str = Query("active"),
    include_app_roles: str = Query("false"),
    include_departments: str = Query("false"),
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_MEMBERS)),
    db: Session = Depends(get_db),
):
    """List organization users."""
    from app.models import OrganizationMembership, Role, User
    from app.services.rbac_service import get_role_label_for_org, get_user_app_role_overrides

    # Also allow platform admins who may not have the permission in this org
    if not check_permission_for_session(db, auth.user_id, org_id, Permission.ORG_MANAGE_MEMBERS):
        if not _is_platform_admin(db, auth.user_id):
            raise HTTPException(status_code=403, detail={
                "code": "forbidden",
                "message": "Cannot view members of this organization",
            })

    query = (
        db.query(OrganizationMembership, User, Role)
        .join(User, User.user_id == OrganizationMembership.user_id)
        .join(Role, Role.role_id == OrganizationMembership.role_id)
        .filter(OrganizationMembership.organization_id == org_id)
    )

    if status != "all":
        query = query.filter(OrganizationMembership.status == status)

    query = query.order_by(OrganizationMembership.created_at.desc())
    results = query.all()

    # Pre-fetch department memberships in bulk if requested (avoids N+1)
    dept_by_user: dict[str, list[dict]] = {}
    if include_departments.lower() == "true":
        from app.models.departments import DepartmentMembership as DeptMembership, Department
        from sqlalchemy.orm import joinedload as _jl

        user_ids = [user.user_id for _m, user, _r in results]
        if user_ids:
            all_dept_memberships = (
                db.query(DeptMembership)
                .options(_jl(DeptMembership.department))
                .filter(
                    DeptMembership.user_id.in_(user_ids),
                    DeptMembership.organization_id == org_id,
                )
                .all()
            )
            for dm in all_dept_memberships:
                uid = str(dm.user_id)
                dept_by_user.setdefault(uid, []).append({
                    "department_id": str(dm.department_id),
                    "department_name": dm.department.name,
                    "department_code": dm.department.code,
                    "department_color": dm.department.color,
                    "role": dm.role,
                    "is_primary": dm.is_primary,
                })

    users = []
    for membership, user, role in results:
        user_data = {
            "membership_id": str(membership.membership_id),
            "user_id": str(user.user_id),
            "email": user.email,
            "name": user.display_name,
            "role_id": str(role.role_id),
            "role_key": role.role_key,
            "role_display_name": get_role_label_for_org(role.role_key, org_id, session=db),
            "status": membership.status,
            "user_status": user.status,
            "created_at": membership.created_at.isoformat(),
        }
        if include_app_roles.lower() == "true":
            user_data["app_roles"] = get_user_app_role_overrides(user.user_id, org_id, session=db)
        if include_departments.lower() == "true":
            user_data["department_memberships"] = dept_by_user.get(str(user.user_id), [])
        users.append(user_data)

    return {
        "organization_id": str(org_id),
        "users": users,
        "total": len(users),
    }


# =============================================================================
# 13. PATCH /api/organizations/{org_id}/users/{user_id} — update/deactivate
# =============================================================================


@router.patch("/api/organizations/{org_id}/users/{user_id}", response_model=UserUpdateResponse, summary="Update or deactivate user")
def update_or_deactivate_user(
    org_id: UUID,
    user_id: UUID,
    body: UpdateUserBody,
    auth: AuthContext = Depends(require_fresh_mfa()),
    db: Session = Depends(get_db),
):
    """Update or deactivate user."""
    if body.action == "deactivate":
        return _handle_deactivation(db, auth, org_id, user_id)
    elif body.action == "reactivate":
        return _handle_reactivation(db, auth, org_id, user_id, body.role_id)
    elif body.role_id:
        return _handle_role_update(db, auth, org_id, user_id, body.role_id)
    else:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Must provide either 'action': 'deactivate'/'reactivate' or 'role_id'",
        })


def _handle_role_update(
    db: Session, auth: AuthContext, org_id: UUID, user_id: UUID, new_role_id: UUID
):
    from app.models import Organization, OrganizationMembership, Role, User
    from app.services import audit_service
    from app.services.email_service import get_email_service

    if not check_permission_for_session(db, auth.user_id, org_id, Permission.ORG_USERS_UPDATE):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Insufficient permissions for role update",
        })

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    membership = (
        db.query(OrganizationMembership)
        .filter_by(organization_id=org_id, user_id=user_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Membership not found"})

    new_role = db.query(Role).filter_by(role_id=new_role_id).first()
    if not new_role:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Role not found"})

    # platform_admin is internal — cannot be assigned through the API
    if new_role.role_key == 'platform_admin':
        raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "Platform admin role cannot be assigned"})

    # Prevent self-demotion from admin
    if user_id == auth.user_id:
        current_role = db.query(Role).filter_by(role_id=membership.role_id).first()
        if current_role and current_role.role_key == "admin" and new_role.role_key != "admin":
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": "Cannot remove your own admin role",
            })

    old_role_id = membership.role_id
    membership.role_id = new_role_id
    db.commit()

    old_role = db.query(Role).filter_by(role_id=old_role_id).first()
    old_role_key = old_role.role_key if old_role else "unknown"

    try:
        audit_service.log_role_changed(
            session=db,
            organization_id=org_id,
            acting_user_id=auth.user_id,
            target_user_id=user_id,
            old_role_id=old_role_id,
            new_role_id=new_role_id,
            old_role_key=old_role_key,
            new_role_key=new_role.role_key,
        )
        db.commit()
    except Exception as e:
        logger.error("Failed to log audit event: %s", str(e))

    try:
        settings = get_settings()
        if settings.email_enabled:
            email_service = get_email_service()
            email_service.send_role_changed_email(
                email=user.email,
                org_name=org.name,
                old_role=old_role.display_name if old_role else "Unknown",
                new_role=new_role.display_name,
            )
    except Exception as e:
        logger.error("Failed to send role change notification: %s", str(e))

    return {
        "message": "User role updated successfully",
        "membership_id": str(membership.membership_id),
        "user_id": str(user_id),
        "organization_id": str(org_id),
        "old_role_id": str(old_role_id),
        "new_role_id": str(new_role_id),
        "new_role_key": new_role.role_key,
    }


def _handle_deactivation(
    db: Session, auth: AuthContext, org_id: UUID, user_id: UUID
):
    from app.models import Organization, OrganizationMembership, User
    from app.services import audit_service
    from app.services.email_service import get_email_service

    if not check_permission_for_session(db, auth.user_id, org_id, Permission.ORG_USERS_DEACTIVATE):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Insufficient permissions for deactivation",
        })

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    membership = (
        db.query(OrganizationMembership)
        .filter_by(organization_id=org_id, user_id=user_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Membership not found"})

    if membership.status == "deactivated":
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "User membership is already deactivated",
        })

    if user_id == auth.user_id:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": "Cannot deactivate your own membership",
        })

    membership.status = "deactivated"

    # End their sessions. Marking the membership deactivated does not, on its
    # own, log anyone out: require_auth validates the USER row (untouched
    # here), the Redis session cache is consulted before revoked_at is ever
    # read, and RLS scopes on the org context the live session already holds.
    # require_permission does filter on active membership, but require_org_role
    # and _is_platform_admin did not — so a departing employee kept their
    # dashboard and, if they held platform_admin, everything else, until their
    # token expired.
    #
    # Only meaningful for a user whose remaining memberships are all inactive;
    # someone who still belongs to another organization keeps their session,
    # which is the correct behaviour for a multi-org platform.
    from app.fastapi_app.routers.auth import _revoke_all_sessions

    remaining = (
        db.query(OrganizationMembership)
        .filter(
            OrganizationMembership.user_id == user_id,
            OrganizationMembership.organization_id != org_id,
            OrganizationMembership.status == "active",
        )
        .first()
    )
    if remaining is None:
        _revoke_all_sessions(db, user_id, datetime.now(timezone.utc))

    db.commit()

    try:
        audit_service.log_user_deactivated(
            session=db,
            organization_id=org_id,
            acting_user_id=auth.user_id,
            target_user_id=user_id,
            membership_id=membership.membership_id,
        )
        db.commit()
    except Exception as e:
        logger.error("Failed to log audit event: %s", str(e))

    try:
        settings = get_settings()
        if settings.email_enabled:
            email_service = get_email_service()
            email_service.send_membership_deactivated_email(
                email=user.email,
                org_name=org.name,
            )
    except Exception as e:
        logger.error("Failed to send deactivation notification: %s", str(e))

    return {
        "message": "User membership deactivated successfully",
        "membership_id": str(membership.membership_id),
        "user_id": str(user_id),
        "organization_id": str(org_id),
        "status": "deactivated",
    }


def _handle_reactivation(
    db: Session, auth: AuthContext, org_id: UUID, user_id: UUID, new_role_id: UUID | None
):
    from app.models import Organization, OrganizationMembership, Role, User
    from app.services import audit_service

    if not check_permission_for_session(db, auth.user_id, org_id, Permission.ORG_USERS_CREATE):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Insufficient permissions for reactivation",
        })

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    user = db.query(User).filter_by(user_id=user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    membership = (
        db.query(OrganizationMembership)
        .filter_by(organization_id=org_id, user_id=user_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Membership not found"})

    if membership.status == "active":
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": "User membership is already active",
        })

    if new_role_id:
        new_role = db.query(Role).filter_by(role_id=new_role_id).first()
        if not new_role:
            raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Role not found"})
        if new_role.role_key == 'platform_admin':
            raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "Platform admin role cannot be assigned"})
        membership.role_id = new_role_id

    membership.status = "active"
    db.commit()

    try:
        audit_service.log_user_reactivated(
            session=db,
            organization_id=org_id,
            acting_user_id=auth.user_id,
            target_user_id=user_id,
            membership_id=membership.membership_id,
        )
        db.commit()
    except Exception as e:
        logger.error("Failed to log audit event: %s", str(e))

    return {
        "message": "User membership reactivated successfully",
        "membership_id": str(membership.membership_id),
        "user_id": str(user_id),
        "organization_id": str(org_id),
        "role_id": str(membership.role_id),
        "status": "active",
    }


# =============================================================================
# 14. GET /api/organizations/{org_id}/users/{user_id}/app-roles
# =============================================================================


@router.get("/api/organizations/{org_id}/users/{user_id}/app-roles", response_model=UserAppRolesResponse, summary="Get user app roles")
def get_user_app_roles(
    org_id: UUID,
    user_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_ROLES)),
    db: Session = Depends(get_db),
):
    """Get user app roles."""
    from app.models import OrganizationMembership, Role
    from app.services.rbac_service import get_role_label_for_org, get_user_app_role_overrides

    membership = (
        db.query(OrganizationMembership)
        .filter_by(user_id=user_id, organization_id=org_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "User in organization not found",
        })

    default_role = db.query(Role).filter_by(role_id=membership.role_id).first()
    if not default_role:
        raise HTTPException(status_code=500, detail={
            "code": "internal_error",
            "message": "Default role not found",
        })

    app_roles = get_user_app_role_overrides(user_id, org_id, session=db)

    return {
        "user_id": str(user_id),
        "default_role_id": str(default_role.role_id),
        "default_role_key": default_role.role_key,
        "default_role_display_name": get_role_label_for_org(default_role.role_key, org_id, session=db),
        "app_roles": app_roles,
    }


# =============================================================================
# 15. PUT /api/organizations/{org_id}/users/{user_id}/app-roles/{app_key}
# =============================================================================


@router.put("/api/organizations/{org_id}/users/{user_id}/app-roles/{app_key}", response_model=SetAppRoleResponse, summary="Set user app role endpoint")
def set_user_app_role_endpoint(
    org_id: UUID,
    user_id: UUID,
    app_key: str,
    body: SetAppRoleBody,
    auth: AuthContext = Depends(require_fresh_mfa()),
    db: Session = Depends(get_db),
):
    """Set user app role endpoint."""
    from app.models import OrganizationMembership, Role
    from app.services.rbac_service import (
        VALID_APP_KEYS,
        get_role_label_for_org,
        set_user_app_role,
    )

    # Check permission
    if not check_permission_for_session(db, auth.user_id, org_id, Permission.ORG_MANAGE_ROLES):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Insufficient permissions",
        })

    if app_key not in VALID_APP_KEYS:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid app_key: {app_key}",
        })

    membership = (
        db.query(OrganizationMembership)
        .filter_by(user_id=user_id, organization_id=org_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "User in organization not found",
        })

    role = db.query(Role).filter_by(role_id=body.role_id).first()
    if not role:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Role not found",
        })

    set_user_app_role(user_id, org_id, app_key, body.role_id, created_by=auth.user_id, session=db)
    db.commit()

    return {
        "status": "ok",
        "user_id": str(user_id),
        "app_key": app_key,
        "role_id": str(body.role_id),
        "role_key": role.role_key,
        "role_display_name": get_role_label_for_org(role.role_key, org_id, session=db),
    }


# =============================================================================
# 16. DELETE /api/organizations/{org_id}/users/{user_id}/app-roles/{app_key}
# =============================================================================


@router.delete("/api/organizations/{org_id}/users/{user_id}/app-roles/{app_key}", response_model=RemoveAppRoleResponse, summary="Remove user app role endpoint")
def remove_user_app_role_endpoint(
    org_id: UUID,
    user_id: UUID,
    app_key: str,
    auth: AuthContext = Depends(require_fresh_mfa()),
    db: Session = Depends(get_db),
):
    """Remove user app role endpoint."""
    from app.models import OrganizationMembership
    from app.services.rbac_service import VALID_APP_KEYS, remove_user_app_role

    # Check permission
    if not check_permission_for_session(db, auth.user_id, org_id, Permission.ORG_MANAGE_ROLES):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Insufficient permissions",
        })

    if app_key not in VALID_APP_KEYS:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Invalid app_key: {app_key}",
        })

    membership = (
        db.query(OrganizationMembership)
        .filter_by(user_id=user_id, organization_id=org_id)
        .first()
    )
    if not membership:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "User in organization not found",
        })

    deleted = remove_user_app_role(user_id, org_id, app_key, session=db)
    db.commit()

    return {
        "status": "ok",
        "user_id": str(user_id),
        "app_key": app_key,
        "deleted": deleted,
    }


# =============================================================================
# 17. POST /api/organizations/{org_id}/invitations — invite user
# =============================================================================


@router.post("/api/organizations/{org_id}/invitations", status_code=201, response_model=InvitationOut, summary="Invite user")
def invite_user(
    org_id: UUID,
    body: InviteUserBody,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_MEMBERS)),
    _verified: AuthContext = Depends(require_verified_email),
    db: Session = Depends(get_db),
):
    """Invite user.

    Gated on a verified email (#70): an invitation sends mail *from* the
    inviting account, so an unverified (possibly typo'd) inviter is blocked.
    """
    from app.services.invitation_service import create_invitation

    if not body.email:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Email is required",
            "field": "email",
        })

    if body.role not in ("admin", "member"):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Role must be 'admin' or 'member'",
            "field": "role",
        })

    # Enforce Guide member limits (personal accounts can't invite)
    from app.models.core import Application, OrganizationApplication, OrganizationMembership
    guide_app = db.query(Application).filter_by(key="guide").first()
    if guide_app:
        org_app = (
            db.query(OrganizationApplication)
            .filter_by(organization_id=org_id, application_id=guide_app.application_id, enabled=True)
            .first()
        )
        if org_app and org_app.config:
            max_members = org_app.config.get("max_members")
            if max_members is not None:
                current_members = (
                    db.query(OrganizationMembership)
                    .filter_by(organization_id=org_id, status="active")
                    .count()
                )
                if current_members >= max_members:
                    account_type = org_app.config.get("account_type", "personal")
                    if account_type == "personal":
                        raise HTTPException(status_code=403, detail={
                            "code": "personal_account",
                            "message": "Personal accounts do not support team members. Upgrade to a museum account to invite others.",
                        })
                    raise HTTPException(status_code=403, detail={
                        "code": "member_limit_reached",
                        "message": f"Member limit reached ({max_members}). Upgrade your plan to add more team members.",
                    })

    try:
        invitation, token = create_invitation(
            session=db,
            organization_id=org_id,
            email=body.email,
            role=body.role,
            invited_by_user_id=auth.user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": str(e),
        })

    return {
        "invitation_id": str(invitation.invitation_id),
        "organization_id": str(invitation.organization_id),
        "email": invitation.email,
        "role": invitation.role,
        "expires_at": invitation.expires_at.isoformat(),
        "created_at": invitation.created_at.isoformat(),
    }


# =============================================================================
# 18. POST /api/invitations/accept — accept invitation
# =============================================================================


@router.post("/api/invitations/accept", response_model=AcceptInvitationResponse, summary="Accept invite")
def accept_invite(
    body: AcceptInvitationBody,
    auth: AuthContext = Depends(require_auth),
    db: Session = Depends(get_db),
):
    """Accept invite."""
    from app.services.invitation_service import accept_invitation

    try:
        membership = accept_invitation(
            session=db,
            token=body.token,
            user_id=auth.user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": str(e),
        })

    return {
        "membership_id": str(membership.membership_id),
        "organization_id": str(membership.organization_id),
        "user_id": str(membership.user_id),
        "role": membership.role,
        "created_at": membership.created_at.isoformat(),
    }


# =============================================================================
# 19. POST /api/organizations/{org_id}/api-keys — create API key
# =============================================================================

from app.services.api_key_scopes import EXTERNAL_API_SCOPES, canonical_scopes_dict, normalize_scopes

# Accept both canonical names and legacy aliases when creating keys
from app.services.api_key_scopes import _SCOPE_ALIASES
VALID_API_SCOPES = frozenset(EXTERNAL_API_SCOPES.keys()) | frozenset(_SCOPE_ALIASES.keys())


@router.post("/api/organizations/{org_id}/api-keys", status_code=201, response_model=CreateAPIKeyResponse, summary="Create api key")
def create_api_key(
    org_id: UUID,
    body: CreateAPIKeyBody,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_API_KEYS)),
    db: Session = Depends(get_db),
):
    """Create api key."""
    from app.models import APIKey
    from app.services.auth_utils import generate_api_key, get_api_key_prefix, hash_api_key

    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "name cannot be empty",
            "field": "name",
        })

    if not body.scopes:
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "scopes must be a non-empty list",
            "field": "scopes",
        })

    invalid_scopes = [s for s in body.scopes if s not in VALID_API_SCOPES]
    if invalid_scopes:
        raise HTTPException(status_code=400, detail={
            "code": "validation_error",
            "message": "Invalid scopes",
            "invalid_scopes": invalid_scopes,
            "valid_scopes": sorted(VALID_API_SCOPES),
            "field": "scopes",
        })

    expires_at = None
    if body.expires_in_days is not None:
        if body.expires_in_days <= 0:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "expires_in_days must be a positive number",
                "field": "expires_in_days",
            })
        if body.expires_in_days > 365:
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "expires_in_days cannot exceed 365",
                "field": "expires_in_days",
            })
        expires_at = datetime.now(timezone.utc) + timedelta(days=body.expires_in_days)

    existing = (
        db.query(APIKey)
        .filter_by(organization_id=org_id, name=name)
        .first()
    )
    if existing:
        raise HTTPException(status_code=409, detail={
            "code": "conflict",
            "message": f'API key with name "{name}" already exists',
            "field": "name",
        })

    secret_key = generate_api_key()
    key_hash = hash_api_key(secret_key)
    key_prefix = get_api_key_prefix(secret_key)

    api_key = APIKey(
        organization_id=org_id,
        name=name,
        key_prefix=key_prefix,
        key_hash=key_hash,
        scopes=canonical_scopes_dict(body.scopes),
        status="active",
        expires_at=expires_at,
        created_by_user_id=auth.user_id,
    )

    db.add(api_key)
    db.commit()

    logger.info("Created API key %s for org %s by user %s", api_key.api_key_id, org_id, auth.user_id)

    return {
        "api_key_id": str(api_key.api_key_id),
        "name": api_key.name,
        "scopes": sorted(normalize_scopes(api_key.scopes)),
        "key_prefix": key_prefix,
        "secret_api_key": secret_key,
        "status": "active",
        "expires_at": api_key.expires_at.isoformat() if api_key.expires_at else None,
        "created_at": api_key.created_at.isoformat(),
    }


# =============================================================================
# 20. GET /api/organizations/{org_id}/api-keys — list API keys
# =============================================================================


@router.get("/api/organizations/{org_id}/api-keys", response_model=APIKeyListResponse, summary="List api keys")
def list_api_keys(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_API_KEYS)),
    db: Session = Depends(get_db),
):
    """List api keys."""
    from app.models import APIKey

    api_keys = (
        db.query(APIKey)
        .filter_by(organization_id=org_id)
        .order_by(APIKey.created_at.desc())
        .all()
    )

    return {
        "api_keys": [
            {
                "api_key_id": str(key.api_key_id),
                "name": key.name,
                "scopes": sorted(normalize_scopes(key.scopes)),
                "key_prefix": key.key_prefix,
                "status": key.status,
                "expires_at": key.expires_at.isoformat() if key.expires_at else None,
                "created_at": key.created_at.isoformat(),
                "last_used_at": key.last_used_at.isoformat() if key.last_used_at else None,
            }
            for key in api_keys
        ]
    }


# =============================================================================
# 21. DELETE /api/api-keys/{api_key_id} — revoke API key
# =============================================================================


@router.delete("/api/api-keys/{api_key_id}", response_model=RevokeAPIKeyResponse, summary="Revoke api key")
def revoke_api_key(
    request: Request,
    api_key_id: UUID,
    organization_id: UUID | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_API_KEYS)),
    db: Session = Depends(get_db),
):
    """Revoke api key."""
    from app.models import APIKey

    org_id = get_authorized_org_id(request, auth, query_org_id=organization_id)

    api_key = (
        db.query(APIKey)
        .filter_by(api_key_id=api_key_id, organization_id=org_id)
        .first()
    )
    if not api_key:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "API key not found",
        })

    api_key.status = "revoked"
    db.commit()

    logger.info("Revoked API key %s by user %s", api_key_id, auth.user_id)

    return {"status": "ok", "message": "API key revoked"}


# =============================================================================
# ROLE TESTING SETTING
# =============================================================================


@router.get("/api/organizations/{org_id}/settings/role-testing", response_model=dict, summary="Get role testing setting")
def get_role_testing(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Whether "Test Role" is available in this organization."""
    from app.models import Organization

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})
    return {"enabled": bool(org.role_testing_enabled)}


@router.put("/api/organizations/{org_id}/settings/role-testing", response_model=dict, summary="Set role testing setting")
def update_role_testing(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Enable or disable "Test Role" for this organization.

    When off, the X-Role-Override header is ignored server-side — the
    session keeps the caller's real permissions — and the UI hides the
    affordance. Disabling it does not change anyone's actual role.
    """
    from app.models import Organization

    if "enabled" not in body or not isinstance(body["enabled"], bool):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error", "message": "Body must include boolean 'enabled'",
        })

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    org.role_testing_enabled = body["enabled"]
    db.commit()
    logger.info("Role testing %s for org %s", "enabled" if body["enabled"] else "disabled", org_id)
    return {"enabled": bool(org.role_testing_enabled)}


# =============================================================================
# APPLICATION ENABLEMENT
# =============================================================================

# Apps an organization cannot switch off. Collections holds the object
# records every other app refers to, so disabling it leaves the rest
# pointing at nothing.
_UNDISABLEABLE_APPS = frozenset({"collections"})


def _app_capability(app_key: str) -> tuple[bool, str | None]:
    """
    Whether this *deployment* can serve an app, independent of the org's
    choice.

    An organization toggling Guide on is meaningless if the server has no
    model behind it: every conversation would 503. The org setting decides
    intent; this decides whether the intent can be honoured, and the UI
    shows the reason rather than offering a switch that leads to errors.
    """
    if app_key == "guide":
        if not get_settings().agent_enabled:
            return False, (
                "Requires an AI provider. Set AGENT_ENABLED and configure a "
                "model provider on the server to make this available."
            )
    return True, None


def _serialize_org_app(app, org_app) -> dict:
    available, reason = _app_capability(app.key)
    return {
        "key": app.key,
        "display_name": app.display_name,
        "description": app.description,
        "icon": app.icon,
        "status": app.status,
        "enabled": bool(org_app.enabled) if org_app else False,
        "available": available,
        "unavailable_reason": reason,
        "can_disable": app.key not in _UNDISABLEABLE_APPS,
    }


def app_enabled_for_org(db, organization_id, app_key: str) -> bool:
    """
    Whether an app is actually usable by an organization right now.

    Both halves have to hold: the deployment can serve it, and the org has
    it switched on. Used by API handlers so that turning an app off closes
    its endpoints too — hiding the navigation while the routes keep
    answering is not "off".
    """
    from app.models import Application, OrganizationApplication

    if not _app_capability(app_key)[0]:
        return False

    row = (
        db.query(OrganizationApplication.enabled)
        .join(Application, Application.application_id == OrganizationApplication.application_id)
        .filter(
            OrganizationApplication.organization_id == organization_id,
            Application.key == app_key,
        )
        .scalar()
    )
    return bool(row)


@router.get("/api/organizations/{org_id}/applications", response_model=dict, summary="List organization applications")
def list_organization_applications(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Every application this organization can turn on, and whether it is on."""
    from app.models import Application, OrganizationApplication

    rows = (
        db.query(Application, OrganizationApplication)
        .outerjoin(
            OrganizationApplication,
            (OrganizationApplication.application_id == Application.application_id)
            & (OrganizationApplication.organization_id == org_id),
        )
        .filter(Application.status != "deprecated")
        .order_by(Application.sort_order)
        .all()
    )
    return {"applications": [_serialize_org_app(a, oa) for a, oa in rows]}


@router.put("/api/organizations/{org_id}/applications/{app_key}", response_model=dict, summary="Enable or disable an application")
def set_organization_application(
    org_id: UUID,
    app_key: str,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """
    Turn an application on or off for this organization.

    Disabling removes it from navigation, the app switcher and the route
    guards; it does not delete any data, and re-enabling restores access to
    everything that was there.
    """
    from app.models import Application, OrganizationApplication

    if "enabled" not in body or not isinstance(body["enabled"], bool):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error", "message": "Body must include boolean 'enabled'",
        })
    enabled = body["enabled"]

    app = db.query(Application).filter_by(key=app_key).first()
    if not app or app.status == "deprecated":
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": f"Unknown application '{app_key}'",
        })

    available, reason = _app_capability(app_key)
    if enabled and not available:
        raise HTTPException(status_code=409, detail={
            "code": "app_unavailable", "message": reason,
        })

    if not enabled and app_key in _UNDISABLEABLE_APPS:
        raise HTTPException(status_code=409, detail={
            "code": "app_required",
            "message": f"{app.display_name} cannot be disabled.",
        })

    org_app = (
        db.query(OrganizationApplication)
        .filter_by(organization_id=org_id, application_id=app.application_id)
        .first()
    )

    # Refuse to switch off the last one. An organization with nothing
    # enabled has no landing page to route to, which strands the very
    # admin who would need to undo it.
    if not enabled and org_app is not None and org_app.enabled:
        remaining = (
            db.query(OrganizationApplication)
            .join(Application, Application.application_id == OrganizationApplication.application_id)
            .filter(
                OrganizationApplication.organization_id == org_id,
                OrganizationApplication.enabled.is_(True),
                Application.status == "active",
                Application.application_id != app.application_id,
            )
            .count()
        )
        if remaining == 0:
            raise HTTPException(status_code=409, detail={
                "code": "last_application",
                "message": "At least one application must stay enabled.",
            })

    if org_app is None:
        org_app = OrganizationApplication(
            organization_id=org_id,
            application_id=app.application_id,
            enabled=enabled,
        )
        db.add(org_app)
    else:
        org_app.enabled = enabled

    db.commit()
    logger.info(
        "Application %s %s for org %s", app_key,
        "enabled" if enabled else "disabled", org_id,
    )
    db.refresh(org_app)
    return _serialize_org_app(app, org_app)


# =============================================================================
# ENFORCEMENT SETTINGS
# =============================================================================


@router.get("/api/organizations/{org_id}/settings/procedure-enforcement", response_model=dict, summary="Get procedure enforcement")
def get_procedure_enforcement(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Get per-procedure enforcement toggles for this org."""
    from app.models import Organization
    from app.services.procedure_requirements import PROCEDURE_REQUIREMENTS

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    enforcement = org.procedure_enforcement or {}
    # Return all known procedures with their enforcement state
    procedures = {}
    for proc_type, proc in PROCEDURE_REQUIREMENTS.items():
        procedures[proc_type] = {
            "enabled": bool(enforcement.get(proc_type, False)),
            "label": proc.procedure_label,
            "requirement_count": sum(len(g.requirements) for g in proc.requirement_groups),
            "blocking_count": sum(
                1 for g in proc.requirement_groups
                for r in g.requirements if r.severity == "blocking"
            ),
        }

    return {"procedures": procedures}


@router.put("/api/organizations/{org_id}/settings/procedure-enforcement", response_model=dict, summary="Update procedure enforcement")
def update_procedure_enforcement(
    org_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Update per-procedure enforcement toggles."""
    from app.models import Organization
    from app.services.procedure_requirements import PROCEDURE_REQUIREMENTS

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    enforcement = dict(org.procedure_enforcement or {})
    valid_procedures = set(PROCEDURE_REQUIREMENTS.keys())

    for proc_type, enabled in data.items():
        if proc_type not in valid_procedures:
            continue
        if not isinstance(enabled, bool):
            continue
        enforcement[proc_type] = enabled

    org.procedure_enforcement = enforcement
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(org, "procedure_enforcement")
    db.commit()

    return {"status": "ok", "procedure_enforcement": enforcement}


# =============================================================================
# MEDIA-RIGHTS ENFORCEMENT SETTINGS
# =============================================================================


@router.get("/api/organizations/{org_id}/settings/media-rights-enforcement", response_model=dict, summary="Get media-rights enforcement")
def get_media_rights_enforcement(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Get the media-rights-download enforcement flag for this org."""
    from app.models import Organization

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    return {"enabled": bool(getattr(org, "media_rights_enforcement", False))}


@router.put("/api/organizations/{org_id}/settings/media-rights-enforcement", response_model=dict, summary="Update media-rights enforcement")
def update_media_rights_enforcement(
    org_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.ORG_MANAGE_SETTINGS)),
    db: Session = Depends(get_db),
):
    """Update the media-rights-download enforcement flag. Body: {"enabled": bool}."""
    from app.models import Organization

    enabled = data.get("enabled")
    if not isinstance(enabled, bool):
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Body must include `enabled: bool`"})

    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if not org:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Organization not found"})

    org.media_rights_enforcement = enabled
    db.commit()

    return {"status": "ok", "enabled": enabled}
