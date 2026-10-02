"""
Audit logging service for tracking administrative actions.

Records all user management operations (invitations, role changes, deactivations)
for compliance, security monitoring, and audit trails.
"""

import logging
from datetime import datetime
from typing import Any, Callable
from uuid import UUID

from sqlalchemy.orm import Session
from sqlalchemy import desc

from app.models import AuditLog

logger = logging.getLogger(__name__)


# =============================================================================
# Best-effort audit write (BYPASSRLS path)
# =============================================================================
#
# Some audit events fire outside any org context — login failures from
# unknown emails, rate-limit blocks, etc. The audit_logs RLS policy is
# strict (`organization_id = current_org_id()`), so an attempt to write
# such a row via the regular request session (madrona_app, NOBYPASSRLS)
# is rejected by RLS. Pre-May-2026 the catch swallowed the rejection
# and the row was silently lost.
#
# `write_audit_via_admin` opens a short-lived owner-role session, writes
# the row (BYPASSRLS), commits, and closes. Costs an extra connection
# round-trip per call but those paths are cold (failed auth attempts).
# Failure here is logged but never propagates — the caller's normal
# response (401, 429, …) must still go out even if auditing is broken.


def write_audit_via_admin(audit_fn: Callable[..., AuditLog], **kwargs) -> bool:
    """Write an audit row via the BYPASSRLS owner session.

    Use for "system event" audits where the writer either has no
    org context (anonymous failures) or is unwilling to take an
    RLS-rejection 500 risk on the regular request session.

    Returns True on success, False on any failure (failure is logged
    but not raised — audit writes are best-effort by contract).
    """
    try:
        from app.tasks.rls_helpers import admin_db_session

        with admin_db_session() as admin_db:
            audit_fn(session=admin_db, **kwargs)
            admin_db.commit()
        return True
    except Exception as exc:
        fn_name = getattr(audit_fn, "__name__", "<unknown>")
        logger.warning(
            "audit-log write via admin failed for %s",
            fn_name,
            exc_info=True,
        )
        # Tier this up to Sentry. A False return is silent at the
        # API layer (the caller's 401/429 still flies) but a sustained
        # rate means the audit trail is going dark — exactly the kind
        # of thing the security side needs to know about before they
        # try to read the trail post-incident.
        try:
            import sentry_sdk

            sentry_sdk.set_tag("audit.helper", "write_audit_via_admin")
            sentry_sdk.set_tag("audit.fn", fn_name)
            sentry_sdk.capture_exception(exc)
        except Exception:
            # Sentry being broken must NEVER break the audit helper.
            pass
        return False


# =============================================================================
# Event Logging Functions
# =============================================================================


def log_user_invited(
    session: Session,
    organization_id: UUID,
    acting_user_id: UUID,
    target_user_id: UUID,
    email: str,
    role_id: UUID,
    role_key: str,
) -> AuditLog:
    """
    Log a user invitation event.
    
    Args:
        session: Database session
        organization_id: Organization where user was invited
        acting_user_id: User who created the invitation
        target_user_id: User who was invited
        email: Email address of invited user
        role_id: Role assigned to user
        role_key: Role key (e.g., 'admin', 'registrar')
    
    Returns:
        Created AuditLog record
    """
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=acting_user_id,
        target_user_id=target_user_id,
        action="user.invited",
        details={
            "email": email,
            "role_id": str(role_id),
            "role_key": role_key,
        },
    )
    
    session.add(audit_log)
    session.flush()  # Get audit_log_id without committing
    
    logger.info(
        "Audit: user.invited - %s invited %s (%s) to org %s as %s",
        acting_user_id, target_user_id, email, organization_id, role_key
    )
    
    return audit_log


def log_role_changed(
    session: Session,
    organization_id: UUID,
    acting_user_id: UUID,
    target_user_id: UUID,
    old_role_id: UUID,
    new_role_id: UUID,
    old_role_key: str,
    new_role_key: str,
) -> AuditLog:
    """
    Log a role change event.
    
    Args:
        session: Database session
        organization_id: Organization where role changed
        acting_user_id: User who changed the role
        target_user_id: User whose role was changed
        old_role_id: Previous role ID
        new_role_id: New role ID
        old_role_key: Previous role key
        new_role_key: New role key
    
    Returns:
        Created AuditLog record
    """
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=acting_user_id,
        target_user_id=target_user_id,
        action="user.role_changed",
        details={
            "old_role_id": str(old_role_id),
            "new_role_id": str(new_role_id),
            "old_role_key": old_role_key,
            "new_role_key": new_role_key,
        },
    )
    
    session.add(audit_log)
    session.flush()
    
    logger.info(
        "Audit: user.role_changed - %s changed %s role from %s to %s in org %s",
        acting_user_id, target_user_id, old_role_key, new_role_key, organization_id
    )
    
    return audit_log


def log_user_deactivated(
    session: Session,
    organization_id: UUID,
    acting_user_id: UUID,
    target_user_id: UUID,
    membership_id: UUID,
) -> AuditLog:
    """
    Log a user deactivation event.
    
    Args:
        session: Database session
        organization_id: Organization where user was deactivated
        acting_user_id: User who deactivated the membership
        target_user_id: User who was deactivated
        membership_id: Membership that was deactivated
    
    Returns:
        Created AuditLog record
    """
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=acting_user_id,
        target_user_id=target_user_id,
        action="user.deactivated",
        details={
            "membership_id": str(membership_id),
        },
    )
    
    session.add(audit_log)
    session.flush()
    
    logger.info(
        "Audit: user.deactivated - %s deactivated %s in org %s (membership %s)",
        acting_user_id, target_user_id, organization_id, membership_id
    )
    
    return audit_log


def log_user_reactivated(
    session: Session,
    organization_id: UUID,
    acting_user_id: UUID,
    target_user_id: UUID,
    membership_id: UUID,
) -> AuditLog:
    """
    Log a user reactivation event (future enhancement).
    
    Args:
        session: Database session
        organization_id: Organization where user was reactivated
        acting_user_id: User who reactivated the membership
        target_user_id: User who was reactivated
        membership_id: Membership that was reactivated
    
    Returns:
        Created AuditLog record
    """
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=acting_user_id,
        target_user_id=target_user_id,
        action="user.reactivated",
        details={
            "membership_id": str(membership_id),
        },
    )
    
    session.add(audit_log)
    session.flush()
    
    logger.info(
        "Audit: user.reactivated - %s reactivated %s in org %s (membership %s)",
        acting_user_id, target_user_id, organization_id, membership_id
    )
    
    return audit_log


def log_mfa_enrollment_started(
    session: Session,
    organization_id: UUID | None,
    target_user_id: UUID | None,
    email: str,
    ip_address: str | None = None,
    mfa_type: str = "totp",
) -> AuditLog:
    """
    Log MFA enrollment start event.

    Args:
        session: Database session
        organization_id: Organization (may be None if user has no memberships)
        target_user_id: User setting up MFA (may be None if user doesn't exist in our DB yet)
        email: Email address of user
        ip_address: Client IP address
        mfa_type: 'totp' (default for back-compat), 'email', or 'sms'

    Returns:
        Created AuditLog record
    """
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=target_user_id,  # User is acting on themselves
        target_user_id=target_user_id,
        action="mfa.enrollment_started",
        details={
            "email": email,
            "ip_address": ip_address,
            "mfa_type": mfa_type,
        },
    )

    session.add(audit_log)
    session.flush()

    # Don't log secret or sensitive data
    logger.info(
        "Audit: mfa.enrollment_started - user %s (%s) started %s enrollment",
        target_user_id, email, mfa_type
    )

    return audit_log


def log_mfa_enrollment_completed(
    session: Session,
    organization_id: UUID | None,
    target_user_id: UUID | None,
    email: str,
    ip_address: str | None = None,
    mfa_type: str = "totp",
) -> AuditLog:
    """
    Log MFA enrollment completion event.

    Args:
        session: Database session
        organization_id: Organization (may be None if user has no memberships)
        target_user_id: User who completed MFA setup
        email: Email address of user
        ip_address: Client IP address
        mfa_type: 'totp' (default for back-compat), 'email', or 'sms'

    Returns:
        Created AuditLog record
    """
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=target_user_id,
        target_user_id=target_user_id,
        action="mfa.enrollment_completed",
        details={
            "email": email,
            "ip_address": ip_address,
            "mfa_type": mfa_type,
        },
    )

    session.add(audit_log)
    session.flush()

    logger.info(
        "Audit: mfa.enrollment_completed - user %s (%s) completed %s enrollment",
        target_user_id, email, mfa_type
    )

    return audit_log


# =============================================================================
# Query Functions
# =============================================================================


def query_audit_logs(
    session: Session,
    organization_id: UUID | None = None,
    action: str | None = None,
    target_user_id: UUID | None = None,
    acting_user_id: UUID | None = None,
    since: datetime | None = None,
    until: datetime | None = None,
    limit: int = 100,
    offset: int = 0,
) -> tuple[list[AuditLog], int]:
    """
    Query audit logs with filtering.

    Args:
        session: Database session
        organization_id: Organization to query logs for (None = all orgs)
        action: Filter by action (e.g., 'user.invited', 'user.role_changed')
        target_user_id: Filter by target user
        acting_user_id: Filter by acting user
        since: Filter by created_at >= since
        until: Filter by created_at <= until
        limit: Maximum number of results
        offset: Number of results to skip

    Returns:
        Tuple of (audit_logs, total_count)
    """
    query = session.query(AuditLog)
    if organization_id is not None:
        query = query.filter_by(organization_id=organization_id)
    
    # Apply filters
    if action:
        query = query.filter(AuditLog.action == action)
    
    if target_user_id:
        query = query.filter(AuditLog.target_user_id == target_user_id)
    
    if acting_user_id:
        query = query.filter(AuditLog.acting_user_id == acting_user_id)
    
    if since:
        query = query.filter(AuditLog.created_at >= since)
    
    if until:
        query = query.filter(AuditLog.created_at <= until)
    
    # Get total count before pagination
    total_count = query.count()
    
    # Apply ordering and pagination
    audit_logs = (
        query
        .order_by(desc(AuditLog.created_at))
        .limit(limit)
        .offset(offset)
        .all()
    )
    
    return audit_logs, total_count


# =============================================================================
# Auth Audit Events
# =============================================================================


def log_login_success(
    session: Session,
    organization_id: UUID | None,
    user_id: UUID | None,
    email: str,
    ip_address: str | None = None,
    mfa_used: bool = False,
    mfa_method: str | None = None,
) -> AuditLog:
    """
    Log successful login event.

    Args:
        session: Database session
        organization_id: User's organization (may be None for users without orgs)
        user_id: User ID
        email: User's email
        ip_address: Client IP
        mfa_used: Whether MFA was verified
        mfa_method: MFA method used (SOFTWARE_TOKEN_MFA, SMS_MFA)

    Returns:
        Created AuditLog record
    """
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=user_id,
        target_user_id=user_id,
        action="auth.login_success",
        details={
            "email": email,
            "ip_address": ip_address,
            "mfa_used": mfa_used,
            "mfa_method": mfa_method,
        },
    )

    session.add(audit_log)
    session.flush()

    logger.info(
        "Audit: auth.login_success - %s (mfa=%s)",
        email, mfa_used
    )

    return audit_log


def log_login_failure(
    session: Session,
    email: str,
    reason: str,
    ip_address: str | None = None,
    organization_id: UUID | None = None,
    user_id: UUID | None = None,
) -> AuditLog:
    """
    Log failed login attempt.

    Args:
        session: Database session
        email: Email used in login attempt
        reason: Failure reason (invalid_credentials, user_not_found, rate_limited, etc.)
        ip_address: Client IP
        organization_id: Organization if known
        user_id: User ID if known

    Returns:
        Created AuditLog record
    """
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=user_id,
        target_user_id=user_id,
        action="auth.login_failure",
        details={
            "email": email,
            "reason": reason,
            "ip_address": ip_address,
        },
    )

    session.add(audit_log)
    session.flush()

    logger.warning(
        "Audit: auth.login_failure - %s reason=%s ip=%s",
        email, reason, ip_address
    )

    return audit_log


def log_mfa_challenge_success(
    session: Session,
    organization_id: UUID | None,
    user_id: UUID | None,
    email: str,
    mfa_method: str,
    ip_address: str | None = None,
) -> AuditLog:
    """
    Log successful MFA challenge verification.

    Args:
        session: Database session
        organization_id: User's organization
        user_id: User ID
        email: User's email
        mfa_method: MFA method (SOFTWARE_TOKEN_MFA, SMS_MFA)
        ip_address: Client IP

    Returns:
        Created AuditLog record
    """
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=user_id,
        target_user_id=user_id,
        action="auth.mfa_challenge_success",
        details={
            "email": email,
            "mfa_method": mfa_method,
            "ip_address": ip_address,
        },
    )

    session.add(audit_log)
    session.flush()

    logger.info(
        "Audit: auth.mfa_challenge_success - %s method=%s",
        email, mfa_method
    )

    return audit_log


def log_mfa_challenge_failure(
    session: Session,
    email: str,
    mfa_method: str,
    reason: str,
    ip_address: str | None = None,
    organization_id: UUID | None = None,
    user_id: UUID | None = None,
) -> AuditLog:
    """
    Log failed MFA challenge attempt.

    Args:
        session: Database session
        email: User's email
        mfa_method: MFA method attempted
        reason: Failure reason (invalid_code, expired_session, etc.)
        ip_address: Client IP
        organization_id: Organization if known
        user_id: User ID if known

    Returns:
        Created AuditLog record
    """
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=user_id,
        target_user_id=user_id,
        action="auth.mfa_challenge_failure",
        details={
            "email": email,
            "mfa_method": mfa_method,
            "reason": reason,
            "ip_address": ip_address,
        },
    )

    session.add(audit_log)
    session.flush()

    logger.warning(
        "Audit: auth.mfa_challenge_failure - %s method=%s reason=%s",
        email, mfa_method, reason
    )

    return audit_log


def log_audit_event(
    session: Session,
    organization_id: UUID,
    acting_user_id: UUID,
    action: str,
    details: dict[str, Any] | None = None,
    target_user_id: UUID | None = None,
    ip_address: str | None = None,
) -> AuditLog:
    """
    Log a generic audit event.

    Use this for operations that don't have a specific log_* function.

    Args:
        session: Database session
        organization_id: Organization context
        acting_user_id: User who performed the action
        action: Action type (e.g., 'pipeline.retry', 'destination.retry')
        details: Additional context for the action
        target_user_id: Optional target user (for user-related actions)
        ip_address: Optional IP address

    Returns:
        Created AuditLog record
    """
    audit_details = details or {}
    if ip_address:
        audit_details = {**audit_details, 'ip_address': ip_address}
    audit_log = AuditLog(
        organization_id=organization_id,
        acting_user_id=acting_user_id,
        target_user_id=target_user_id,
        action=action,
        details=audit_details,
    )

    session.add(audit_log)
    session.flush()

    logger.info(
        "Audit: %s - user=%s org=%s details=%s",
        action, acting_user_id, organization_id, details
    )

    return audit_log


# =============================================================================
# Ops Action Types (for documentation and consistency)
# =============================================================================

# These action types are used by the ops scripts in scripts/ops/
# All ops actions are prefixed with 'ops.' to distinguish from normal app actions

OPS_ACTIONS = {
    'ops.user_created': 'Admin created a new user via ops script',
    'ops.password_reset': 'Admin reset user password via ops script',
    'ops.role_assigned': 'Admin assigned/changed user role via ops script',
    'ops.mfa_reset': 'Admin reset MFA for user via ops script',
}

# Auth action types used by the auth module
AUTH_ACTIONS = {
    'auth.login_success': 'User logged in successfully',
    'auth.login_failure': 'Login attempt failed',
    'auth.mfa_challenge_success': 'MFA code verified successfully',
    'auth.mfa_challenge_failure': 'MFA code verification failed',
    'mfa.enrollment_started': 'User started MFA enrollment',
    'mfa.enrollment_completed': 'User completed MFA enrollment',
}
