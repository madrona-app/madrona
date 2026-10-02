"""
Auth router — 27 routes migrated from Flask.

Sources:
- app/api/auth.py (routes 1-21)
- app/api/activation.py (routes 22-23)
- app/routes/google_auth.py (routes 24-27)
"""

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from uuid import UUID

import requests
from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_admin_db, get_db
from app.fastapi_app.dependencies.auth import (
    AuthContext,
    require_auth,
    get_current_user_from_cookie,
)
from app.fastapi_app.schemas.auth import (
    ActivateAccountBody,
    ActiveOrganizationResponse,
    AvatarResponse,
    ChangePasswordBody,
    ChangePasswordMFABody,
    CSRFResponse,
    CurrentUserResponse,
    GoogleAuthorizeResponse,
    GoogleCallbackBody,
    GoogleStatusResponse,
    InvitationVerifyResponse,
    LoginRequest,
    MFAReverifyRequest,
    MFAReverifyResponse,
    MFAVerifyRequest,
    MFASetupStartBody,
    MFASetupStartResponse,
    MFAEmailSetupVerifyBody,
    MFAFactorsOut,
    MFAPreferenceBody,
    MFASetupVerifyBody,
    MessageResponse,
    OkResponse,
    OverviewPreferencesResponse,
    EmailVerificationConfirmBody,
    EmailVerificationResendBody,
    MfaRecoveryConfirmBody,
    MfaRecoveryRequestBody,
    PasswordResetConfirmBody,
    PasswordResetRequestBody,
    RefreshResponse,
    SetActiveOrganizationBody,
    SetOverviewPreferencesBody,
    SuccessMessageResponse,
    UpdateProfileBody,
    UpdateProfileResponse,
)
from app.services import auth_backend as _auth_backend
from app.services.auth_utils import (
    decode_access_token,
    generate_access_token,
    generate_email_verification_token,
    generate_password_reset_token,
    generate_refresh_token,
    hash_email_verification_token,
    hash_password,
    hash_password_reset_token,
    hash_refresh_token,
)
from app.services.cognito import (
    AuthChallenge,
    AuthResultType,
    AuthSuccess,
    CognitoAuthError,
    InvalidCredentialsError,
    TooManyRequestsError,
    UserNotConfirmedError,
    UserNotFoundError,
    cognito_associate_software_token,
    cognito_change_password,
    cognito_get_user,
    cognito_get_user_mfa_status,
    cognito_initiate_auth,
    cognito_respond_to_auth_challenge,
    cognito_set_user_mfa_preference,
    cognito_verify_software_token,
    cognito_admin_set_user_password,
)
from app.services.jwt_verify import TokenVerificationError, verify_cognito_id_token
from app.services.rate_limiter import (
    RateLimiter,
    auth_limiter,
    activate_limiter,
    activate_hourly_limiter,
    activate_token_limiter,
    verify_limiter,
    verify_hourly_limiter,
)
from app.services.session_cache import cache_session, get_cached_session, invalidate_session_cache

logger = logging.getLogger(__name__)


class _MfaUnavailable(Exception):
    """Internal sentinel: this deployment has no MFA provider."""

router = APIRouter(tags=["auth"])

# Rate limiters specific to these routes
_password_reset_limiter = RateLimiter(max_requests=5, window_seconds=300)
_email_verification_limiter = RateLimiter(max_requests=5, window_seconds=300)
_mfa_recovery_limiter = RateLimiter(max_requests=5, window_seconds=300)
_refresh_limiter = RateLimiter(max_requests=30, window_seconds=60)

# Keyed on the RECIPIENT, not the caller. The three endpoints below mail an
# attacker-chosen address, and an IP-keyed limit alone does not protect the
# person receiving the mail: a distributed caller — or any single caller, back
# when a forged X-Forwarded-For minted a fresh IP bucket per request — could
# flood one inbox and, because each request invalidates the victim's
# outstanding tokens, deny them the reset flow itself. Login already limits on
# both email and IP; these did not.
_recipient_mail_limiter = RateLimiter(max_requests=5, window_seconds=900)


def _recipient_rate_limited(email: str, scope: str) -> JSONResponse | None:
    """429 response if this address has been mailed too often, else None."""
    if _recipient_mail_limiter.allow(email, scope):
        return None
    return JSONResponse(
        status_code=429,
        content={"error": {"code": "rate_limit_exceeded", "message": "Too many requests, please try again later", "details": {}}},
    )

# Roles that require MFA. platform_admin is the highest-privilege role (cross-org
# platform access) and must carry MFA — without it here, a platform admin who has
# no TOTP enrolled (e.g. after MFA recovery) was never prompted to set one up.
MFA_REQUIRED_ROLES = {"admin", "platform_admin"}

# Frontend / Cognito challenge name translation. Kept in one place
# so login (Cognito → frontend) and verify (frontend → Cognito) can't
# drift — adding a fourth factor only touches these dicts plus the
# email-MFA module section below.
_CHALLENGE_TO_MFA_TYPE = {
    "SOFTWARE_TOKEN_MFA": "totp",
    "SMS_MFA": "sms",
    "EMAIL_OTP": "email",
}
_MFA_TYPE_TO_CHALLENGE = {v: k for k, v in _CHALLENGE_TO_MFA_TYPE.items()}
_MFA_TYPE_TO_CODE_KEY = {
    "totp": "SOFTWARE_TOKEN_MFA_CODE",
    "sms": "SMS_MFA_CODE",
    "email": "EMAIL_OTP_CODE",
}


# =============================================================================
# Helpers
# =============================================================================


def _get_client_ip(request: Request) -> str | None:
    """Extract and validate client IP from request."""
    import ipaddress

    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        for ip_str in forwarded.split(","):
            ip_str = ip_str.strip()
            try:
                ipaddress.ip_address(ip_str)
                return ip_str
            except ValueError:
                continue

    if request.client:
        return request.client.host
    return None


def _require_cognito_mfa():
    """MFA flows are Cognito-backed; under AUTH_PROVIDER=local they don't exist."""
    if get_settings().resolved_auth_provider == "local":
        raise HTTPException(
            status_code=501,
            detail={
                "code": "not_implemented",
                "message": "MFA is unavailable under AUTH_PROVIDER=local; it requires the cognito auth provider.",
            },
        )


def _set_refresh_cookie(response: JSONResponse, token: str) -> JSONResponse:
    """Set HttpOnly refresh token cookie on a response."""
    settings = get_settings()
    response.set_cookie(
        key="refresh_token",
        value=token,
        httponly=True,
        secure=not (settings.is_development or settings.is_testing),
        samesite="lax",
        max_age=30 * 24 * 60 * 60,
        path="/",
    )
    return response


def _clear_refresh_cookie(response: JSONResponse) -> JSONResponse:
    """Clear the refresh token cookie."""
    settings = get_settings()
    response.set_cookie(
        key="refresh_token",
        value="",
        httponly=True,
        secure=not (settings.is_development or settings.is_testing),
        samesite="lax",
        max_age=0,
        path="/",
    )
    return response


def _validate_refresh_cookie(request: Request, db: Session):
    """Validate refresh token from cookie, return (token_record, user) or raise 401."""
    from app.models import RefreshToken, User

    refresh_token = request.cookies.get("refresh_token")
    if not refresh_token:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Authentication required"})

    token_hash = hash_refresh_token(refresh_token)
    token_record = db.query(RefreshToken).filter_by(token_hash=token_hash, revoked_at=None).first()

    if not token_record:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid session"})

    expires_at = token_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if datetime.now(timezone.utc) > expires_at:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Session expired"})

    user = db.query(User).filter_by(user_id=token_record.user_id).first()
    if not user or user.status != "active":
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "User not found or inactive"})

    return token_record, user


# =============================================================================
# Route 1: CSRF Token
# =============================================================================


@router.get("/api/auth/csrf", summary="Get CSRF token")
def get_csrf_token():
    """Generate a CSRF token and set it as a cookie."""
    settings = get_settings()
    csrf_token = secrets.token_urlsafe(32)
    response = JSONResponse(content={"csrf_token": csrf_token})
    response.set_cookie(
        key="csrf_token",
        value=csrf_token,
        httponly=False,
        secure=not (settings.is_development or settings.is_testing),
        samesite="lax",
        max_age=7200,
        path="/",
    )
    return response


# =============================================================================
# Route 2: Login
# =============================================================================


def _issue_session(db, user, email, client_ip, first_membership, active_org_id):
    """Shared post-authentication tail: rate-limit reset, refresh token,
    RLS re-bootstrap, best-effort audit, access token, cookie. Used by both
    the cognito and local login paths."""
    from app.models import RefreshToken
    from app.services.audit_service import log_login_success
    from app.services.rls import set_rls_context_for_session

    # Clear rate limit
    auth_limiter.record_success(email)
    if client_ip:
        auth_limiter.record_success(client_ip)

    # Create refresh token
    refresh_token = generate_refresh_token()
    refresh_token_hash = hash_refresh_token(refresh_token)
    refresh_expires = datetime.now(timezone.utc) + timedelta(days=30)

    refresh_token_record = RefreshToken(
        user_id=user.user_id,
        token_hash=refresh_token_hash,
        active_organization_id=first_membership.organization_id if first_membership else None,
        expires_at=refresh_expires,
    )
    db.add(refresh_token_record)

    # Re-bootstrap RLS context with the resolved org_id so the
    # `audit_logs` INSERT below satisfies its WITH CHECK
    # (organization_id = current_org_id()) policy. The earlier
    # set_rls_context_for_session call passed organization_id=None to
    # let the user-aware membership lookup work; once we have the
    # first_membership, we widen the context to the real org. Without
    # this, the audit-log flush fails RLS and the audit savepoint
    # below rolls back — which on its own is fine, but leaves the
    # audit row missing.
    if first_membership is not None:
        set_rls_context_for_session(
            db,
            organization_id=str(first_membership.organization_id),
            user_id=str(user.user_id),
        )

    # Audit log in a savepoint so a failure (RLS policy mismatch,
    # FK violation, etc.) doesn't poison the outer transaction and
    # block the refresh_token INSERT from committing. Logging is
    # best-effort here; auth success is the load-bearing operation.
    audit_sp = db.begin_nested()
    try:
        log_login_success(
            db,
            organization_id=first_membership.organization_id if first_membership else None,
            user_id=user.user_id, email=email, ip_address=client_ip, mfa_used=False,
        )
        audit_sp.commit()
    except SQLAlchemyError:
        audit_sp.rollback()
        logger.warning("login audit log failed for %s", email, exc_info=True)

    db.commit()

    access_token = generate_access_token(
        user_id=str(user.user_id), email=user.email, active_organization_id=active_org_id,
    )

    response = JSONResponse(content={
        "user_id": str(user.user_id), "email": user.email,
        "email_verified_at": user.email_verified_at.isoformat() if user.email_verified_at else None,
        "access_token": access_token, "active_organization_id": active_org_id,
    })
    return _set_refresh_cookie(response, refresh_token)


@router.post("/api/auth/login", summary="Log in")
def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """Authenticate user with email and password via Cognito."""
    from app.models import User, OrganizationMembership, RefreshToken, Role
    from app.services.audit_service import (
        log_login_success,
        log_login_failure,
        write_audit_via_admin,
    )

    email = body.email.lower().strip()
    password = body.password
    client_ip = _get_client_ip(request)

    # Rate limiting
    email_limit = auth_limiter.check_rate_limit(email)
    if not email_limit.allowed:
        # Failure-path audit rows have organization_id=None (we don't
        # know who's behind the attempt). The strict audit_logs RLS
        # policy `(organization_id = current_org_id())` rejects NULL=NULL
        # under the regular session — write via the BYPASSRLS owner
        # connection so the row actually lands.
        write_audit_via_admin(
            log_login_failure,
            email=email, reason="rate_limited", ip_address=client_ip,
        )
        return JSONResponse(
            status_code=429,
            content={"error": "Too many login attempts. Please try again later.", "retry_after": int(email_limit.retry_after or 60)},
        )

    if client_ip:
        ip_limit = auth_limiter.check_rate_limit(client_ip)
        if not ip_limit.allowed:
            return JSONResponse(
                status_code=429,
                content={"error": "Too many login attempts. Please try again later.", "retry_after": int(ip_limit.retry_after or 60)},
            )

    # Local provider: verify against users.password_hash, then the same
    # session tail as the cognito path. MFA is unavailable under local auth.
    if get_settings().resolved_auth_provider == "local":
        from app.services.auth_backend import local_verify_credentials, warn_local_mfa_once
        from app.services.rls import set_rls_context_for_session

        try:
            user = local_verify_credentials(db, email, password)
        except (InvalidCredentialsError, UserNotFoundError):
            auth_limiter.record_failure(email)
            if client_ip:
                auth_limiter.record_failure(client_ip)
            write_audit_via_admin(
                log_login_failure,
                email=email, reason="invalid_credentials", ip_address=client_ip,
            )
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid credentials"})

        if user.status != "active":
            raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "Account is not active"})

        warn_local_mfa_once()
        set_rls_context_for_session(db, organization_id=None, user_id=str(user.user_id))
        memberships = (
            db.query(OrganizationMembership)
            .join(Role, OrganizationMembership.role_id == Role.role_id, isouter=True)
            .filter(OrganizationMembership.user_id == user.user_id)
            .all()
        )
        first_membership = memberships[0] if memberships else None
        active_org_id = str(first_membership.organization_id) if first_membership else None
        return _issue_session(db, user, email, client_ip, first_membership, active_org_id)

    # Authenticate with Cognito
    try:
        result = cognito_initiate_auth(email, password)
    except (InvalidCredentialsError, UserNotFoundError):
        auth_limiter.record_failure(email)
        if client_ip:
            auth_limiter.record_failure(client_ip)
        write_audit_via_admin(
            log_login_failure,
            email=email, reason="invalid_credentials", ip_address=client_ip,
        )
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid credentials"})
    except UserNotConfirmedError:
        auth_limiter.record_failure(email)
        write_audit_via_admin(
            log_login_failure,
            email=email, reason="user_not_confirmed", ip_address=client_ip,
        )
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Please verify your email address"})
    except CognitoAuthError as e:
        logger.error("Cognito error during login for %s: %s", email, e.code)
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Authentication service error"})

    # Handle MFA challenge
    if isinstance(result, AuthChallenge):
        if result.type == AuthResultType.MFA_REQUIRED:
            mfa_type = _CHALLENGE_TO_MFA_TYPE.get(result.challenge_name, "sms")
            return JSONResponse(content={"mfaRequired": True, "mfaType": mfa_type, "session": result.session})
        elif result.type == AuthResultType.NEW_PASSWORD_REQUIRED:
            return JSONResponse(
                status_code=401,
                content={"error": "Password change required", "passwordChangeRequired": True, "session": result.session},
            )

    if not isinstance(result, AuthSuccess) or not result.tokens:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Authentication failed"})

    # Verify ID token
    try:
        id_claims = verify_cognito_id_token(result.tokens.id_token)
        cognito_sub = id_claims["sub"]
        cognito_email = id_claims.get("email", email)
    except TokenVerificationError:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Authentication failed"})

    # Map to internal user
    user = db.query(User).filter_by(email=cognito_email).first()
    if not user:
        user = User(email=cognito_email, cognito_sub=cognito_sub, status="active")
        db.add(user)
        db.flush()
    elif not user.cognito_sub:
        user.cognito_sub = cognito_sub

    if user.status != "active":
        raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "Account is not active"})

    # Same bootstrap as /me: set user RLS context so the user-aware
    # organization_memberships policy returns the caller's own rows. Without
    # this, login silently treats every user as having zero memberships.
    from app.services.rls import set_rls_context_for_session
    set_rls_context_for_session(db, organization_id=None, user_id=str(user.user_id))

    # Get memberships
    memberships = (
        db.query(OrganizationMembership)
        .join(Role, OrganizationMembership.role_id == Role.role_id, isouter=True)
        .filter(OrganizationMembership.user_id == user.user_id)
        .all()
    )
    first_membership = memberships[0] if memberships else None
    active_org_id = str(first_membership.organization_id) if first_membership else None

    # Check MFA requirement
    user_roles = set()
    for membership in memberships:
        if membership.role_id:
            role = db.query(Role).filter_by(role_id=membership.role_id).first()
            if role:
                user_roles.add(role.role_key)
        if membership.role == "admin":
            user_roles.add("admin")

    if user_roles & MFA_REQUIRED_ROLES:
        try:
            mfa_status = cognito_get_user_mfa_status(email)
            if not mfa_status.get("totp_enabled"):
                return JSONResponse(content={"mfaSetupRequired": True, "email": email, "session": result.tokens.access_token})
        except CognitoAuthError:
            pass

    return _issue_session(db, user, email, client_ip, first_membership, active_org_id)


# =============================================================================
# Routes 3-4: MFA Verify (+ alias)
# =============================================================================


@router.post("/api/auth/mfa/verify", summary="Verify MFA code")
def login_mfa(body: MFAVerifyRequest, request: Request, db: Session = Depends(get_db)):
    """Complete login by verifying MFA code (TOTP, SMS, or email)."""
    _require_cognito_mfa()
    from app.models import User, OrganizationMembership, RefreshToken
    from app.services.audit_service import (
        log_mfa_challenge_success,
        log_mfa_challenge_failure,
        log_login_success,
        write_audit_via_admin,
    )

    email = body.email.strip().lower()
    mfa_code = body.code.strip()
    session_token = body.session
    mfa_type = body.mfaType
    client_ip = _get_client_ip(request)

    challenge_name = _MFA_TYPE_TO_CHALLENGE.get(mfa_type, "SOFTWARE_TOKEN_MFA")
    code_key = _MFA_TYPE_TO_CODE_KEY.get(mfa_type, "SOFTWARE_TOKEN_MFA_CODE")

    mfa_limit = auth_limiter.check_rate_limit(f"mfa:{email}")
    if not mfa_limit.allowed:
        # Same RLS rationale as in login() — failure-path audit row
        # has organization_id=None, gets rejected on the regular
        # session, lands fine via BYPASSRLS.
        write_audit_via_admin(
            log_mfa_challenge_failure,
            email=email, mfa_method=challenge_name,
            reason="rate_limited", ip_address=client_ip,
        )
        return JSONResponse(status_code=429, content={"error": "Too many attempts. Please try again later.", "retry_after": int(mfa_limit.retry_after or 60)})

    try:
        result = cognito_respond_to_auth_challenge(
            session=session_token, challenge_name=challenge_name,
            challenge_responses={"USERNAME": email, code_key: mfa_code}, username=email,
        )
    except CognitoAuthError as e:
        auth_limiter.record_failure(f"mfa:{email}")
        if e.code in ("CodeMismatchException", "ExpiredCodeException", "NotAuthorizedException"):
            is_session_expired = e.code == "NotAuthorizedException" and "session" in str(e.message).lower()
            reason = "session_expired" if is_session_expired else "invalid_code"
            write_audit_via_admin(
                log_mfa_challenge_failure,
                email=email, mfa_method=challenge_name,
                reason=reason, ip_address=client_ip,
            )
            if is_session_expired:
                raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Session expired. Please sign in again."})
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Authentication failed"})
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Authentication failed"})

    if not isinstance(result, AuthSuccess) or not result.tokens:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Authentication failed"})

    try:
        id_claims = verify_cognito_id_token(result.tokens.id_token)
        cognito_sub = id_claims["sub"]
        email = id_claims.get("email", "")
    except TokenVerificationError:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Authentication failed"})

    user = db.query(User).filter_by(email=email).first()
    if not user:
        user = User(email=email, cognito_sub=cognito_sub, status="active")
        db.add(user)
        db.flush()
    elif not user.cognito_sub:
        user.cognito_sub = cognito_sub

    if user.status != "active":
        raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "Account is not active"})

    # MFA-verify is a fresh-login path, same bootstrap problem as /api/auth/login.
    from app.services.rls import set_rls_context_for_session
    set_rls_context_for_session(db, organization_id=None, user_id=str(user.user_id))

    first_membership = db.query(OrganizationMembership).filter_by(user_id=user.user_id).first()
    active_org_id = str(first_membership.organization_id) if first_membership else None

    auth_limiter.record_success(f"mfa:{email}")

    mfa_time = datetime.now(timezone.utc)
    refresh_token = generate_refresh_token()
    refresh_token_hash = hash_refresh_token(refresh_token)
    refresh_expires = datetime.now(timezone.utc) + timedelta(days=30)

    refresh_token_record = RefreshToken(
        user_id=user.user_id, token_hash=refresh_token_hash,
        active_organization_id=first_membership.organization_id if first_membership else None,
        expires_at=refresh_expires, mfa_verified=True, mfa_method=mfa_type, mfa_at=mfa_time,
    )
    db.add(refresh_token_record)

    # Re-bootstrap RLS context with the resolved org_id before the
    # audit-log INSERTs below. Same fix as 8e65e713 applied to /me;
    # the earlier set_rls_context_for_session passes organization_id=None
    # so the user-aware membership lookup works, but the audit_logs
    # WITH CHECK (organization_id = current_org_id()) policy then
    # rejects the INSERT and the broken transaction state propagates
    # to db.commit() → PendingRollbackError → 500.
    if first_membership is not None:
        set_rls_context_for_session(
            db,
            organization_id=str(first_membership.organization_id),
            user_id=str(user.user_id),
        )

    # Audit log inside a savepoint so a failure (RLS mismatch, FK
    # violation, etc.) doesn't poison the outer transaction and block
    # the refresh_token INSERT from committing. Logging is best-effort;
    # auth success is the load-bearing operation.
    audit_sp = db.begin_nested()
    try:
        log_mfa_challenge_success(
            db, organization_id=first_membership.organization_id if first_membership else None,
            user_id=user.user_id, email=email, mfa_method=challenge_name, ip_address=client_ip,
        )
        log_login_success(
            db, organization_id=first_membership.organization_id if first_membership else None,
            user_id=user.user_id, email=email, ip_address=client_ip, mfa_used=True, mfa_method=mfa_type,
        )
        audit_sp.commit()
    except SQLAlchemyError:
        audit_sp.rollback()
        logger.warning("login_mfa audit log failed for %s", email, exc_info=True)

    db.commit()

    access_token = generate_access_token(
        user_id=str(user.user_id), email=user.email,
        active_organization_id=active_org_id, mfa_verified=True, mfa_at=mfa_time.isoformat(),
    )

    response = JSONResponse(content={
        "user_id": str(user.user_id), "email": user.email,
        "email_verified_at": user.email_verified_at.isoformat() if user.email_verified_at else None,
        "access_token": access_token, "active_organization_id": active_org_id,
    })
    return _set_refresh_cookie(response, refresh_token)


# =============================================================================
# Route 5: MFA Re-verify
# =============================================================================


@router.post("/api/auth/mfa/reverify", response_model=MFAReverifyResponse, summary="Re-verify MFA")
def mfa_reverify(body: MFAReverifyRequest, request: Request, auth: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    """Re-verify MFA for sensitive operations within an active session."""
    _require_cognito_mfa()
    from app.models import User, RefreshToken
    from app.services.audit_service import (
        log_mfa_challenge_success,
        log_mfa_challenge_failure,
        write_audit_via_admin,
    )

    mfa_code = body.code.strip()
    client_ip = _get_client_ip(request)

    if not mfa_code.isdigit() or len(mfa_code) != 6:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Code must be 6 digits"})

    user = db.query(User).filter_by(user_id=auth.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "User not found"})

    email = user.email

    mfa_limit = auth_limiter.check_rate_limit(f"mfa_reverify:{email}")
    if not mfa_limit.allowed:
        write_audit_via_admin(
            log_mfa_challenge_failure,
            email=email, mfa_method="SOFTWARE_TOKEN_MFA",
            reason="rate_limited", ip_address=client_ip,
        )
        return JSONResponse(status_code=429, content={"error": "Too many attempts. Please try again later.", "retry_after": int(mfa_limit.retry_after or 60)})

    try:
        cognito_verify_software_token(email=email, user_code=mfa_code, friendly_device_name="re-verify")
    except CognitoAuthError as e:
        auth_limiter.record_failure(f"mfa_reverify:{email}")
        if e.code in ("CodeMismatchException", "ExpiredCodeException", "NotAuthorizedException", "EnableSoftwareTokenMFAException"):
            write_audit_via_admin(
                log_mfa_challenge_failure,
                email=email, mfa_method="SOFTWARE_TOKEN_MFA",
                reason="invalid_code", ip_address=client_ip,
            )
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Authentication failed"})
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Verification failed"})

    mfa_time = datetime.now(timezone.utc)

    refresh_token_cookie = request.cookies.get("refresh_token")
    if refresh_token_cookie:
        token_hash = hash_refresh_token(refresh_token_cookie)
        token_record = db.query(RefreshToken).filter_by(token_hash=token_hash, revoked_at=None).first()
        if token_record:
            token_record.mfa_verified = True
            token_record.mfa_method = "totp"
            token_record.mfa_at = mfa_time
            db.commit()
            invalidate_session_cache(token_hash)

    auth_limiter.record_success(f"mfa_reverify:{email}")

    try:
        log_mfa_challenge_success(
            db, organization_id=auth.active_organization_id,
            user_id=auth.user_id, email=email, mfa_method="SOFTWARE_TOKEN_MFA", ip_address=client_ip,
        )
        db.commit()
    except SQLAlchemyError:
        db.rollback()

    access_token = generate_access_token(
        user_id=str(user.user_id), email=user.email,
        active_organization_id=str(auth.active_organization_id) if auth.active_organization_id else None,
        mfa_verified=True, mfa_at=mfa_time.isoformat(),
    )

    return {"access_token": access_token, "mfa_verified": True, "message": "MFA verification successful"}


# =============================================================================
# Route 6: Refresh
# =============================================================================


@router.post("/api/auth/refresh", response_model=RefreshResponse, summary="Refresh access token")
def refresh(request: Request, db: Session = Depends(get_db)):
    """Exchange refresh token cookie for a new access token."""
    from app.models import RefreshToken, User

    client_ip = _get_client_ip(request) or "unknown"
    if not _refresh_limiter.allow(client_ip, "token_refresh"):
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limit_exceeded", "message": "Too many requests, please try again later", "details": {}}})

    refresh_token_value = request.cookies.get("refresh_token")
    if not refresh_token_value:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "No refresh token"})

    token_hash = hash_refresh_token(refresh_token_value)
    now = datetime.now(timezone.utc)

    cached = get_cached_session(token_hash)
    user_id = None
    active_org_id = None
    mfa_verified = False
    mfa_at_iso = None
    token_record = None

    if cached:
        user_id = cached["user_id"]
        active_org_id = str(cached["active_organization_id"]) if cached["active_organization_id"] else None
        mfa_verified = cached["mfa_verified"]
        if cached["mfa_at"]:
            mfa_at_iso = cached["mfa_at"].isoformat()
    else:
        token_record = db.query(RefreshToken).filter_by(token_hash=token_hash, revoked_at=None).first()
        if not token_record:
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid refresh token"})

        expires_at = token_record.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if now > expires_at:
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Refresh token expired"})

        user_id = token_record.user_id
        active_org_id = str(token_record.active_organization_id) if token_record.active_organization_id else None
        mfa_verified = token_record.mfa_verified
        if token_record.mfa_at:
            mfa_at = token_record.mfa_at
            if mfa_at.tzinfo is None:
                mfa_at = mfa_at.replace(tzinfo=timezone.utc)
            mfa_at_iso = mfa_at.isoformat()
        cache_session(token_hash, token_record)

    user = db.query(User).filter_by(user_id=user_id).first()
    if not user or user.status != "active":
        invalidate_session_cache(token_hash)
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "User not found or inactive"})

    access_token = generate_access_token(
        user_id=str(user.user_id), email=user.email,
        active_organization_id=active_org_id,
        mfa_verified=mfa_verified, mfa_at=mfa_at_iso,
    )

    return {"access_token": access_token, "active_organization_id": active_org_id, "mfa_verified": mfa_verified}


# =============================================================================
# Route 7: Logout
# =============================================================================


@router.post("/api/auth/logout", summary="Logout")
def logout(request: Request, db: Session = Depends(get_db)):
    """Logout."""
    from app.models import RefreshToken, User

    refresh_token_value = request.cookies.get("refresh_token")

    if refresh_token_value:
        token_hash = hash_refresh_token(refresh_token_value)
        token_record = db.query(RefreshToken).filter_by(token_hash=token_hash, revoked_at=None).first()
        if token_record:
            token_record.revoked_at = datetime.now(timezone.utc)
            db.commit()
            invalidate_session_cache(token_hash)

    response = JSONResponse(content={"message": "Logged out"})
    return _clear_refresh_cookie(response)


# =============================================================================
# Routes 8-9: Password Reset
# =============================================================================


@router.post("/api/auth/password-reset/request", response_model=MessageResponse, summary="Password reset request")
def password_reset_request(body: PasswordResetRequestBody, request: Request, db: Session = Depends(get_db)):
    """Password reset request."""
    from app.models import User, PasswordResetToken

    client_ip = _get_client_ip(request) or "unknown"
    if not _password_reset_limiter.allow(client_ip, "password_reset_request"):
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limit_exceeded", "message": "Too many requests, please try again later", "details": {}}})

    email = body.email.lower().strip()
    success_response = {"message": "If an account exists with this email, a reset link has been sent."}

    limited = _recipient_rate_limited(email, "password_reset_request")
    if limited is not None:
        return limited

    user = db.query(User).filter_by(email=email).first()
    if not user or user.status != "active":
        return success_response

    # Invalidate existing tokens
    db.query(PasswordResetToken).filter_by(user_id=user.user_id, used_at=None).update({"used_at": datetime.now(timezone.utc)})

    token = generate_password_reset_token()
    token_hash = hash_password_reset_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)

    db.add(PasswordResetToken(user_id=user.user_id, token_hash=token_hash, expires_at=expires_at))
    db.commit()

    settings = get_settings()
    reset_url = f"{settings.app_base_url.rstrip('/')}/reset-password?token={token}"

    if settings.email_enabled:
        from app.services.email_service import get_email_service
        get_email_service().send_password_reset_email(email, reset_url)
    else:
        logger.info("[DEV] Password reset link for %s: %s", email, reset_url)

    return success_response


def _revoke_all_sessions(db: Session, user_id, now: datetime) -> int:
    """Revoke every live refresh token for a user AND drop its cached session.

    Revoking the DB row alone is not enough. `_resolve_from_cookie` serves
    from the Redis session cache before it ever reads `revoked_at`
    (dependencies/auth.py), and the cached payload carries no revocation
    state, so a stolen cookie kept working for the remainder of the cache
    TTL — up to an hour — after the victim reset their password. Password
    reset is the remediation path for a stolen session, so it has to
    actually terminate one.
    """
    from app.models import RefreshToken

    token_hashes = [
        row[0]
        for row in db.query(RefreshToken.token_hash)
        .filter(RefreshToken.user_id == user_id, RefreshToken.revoked_at.is_(None))
        .all()
    ]
    db.query(RefreshToken).filter_by(user_id=user_id, revoked_at=None).update(
        {"revoked_at": now}
    )
    for token_hash in token_hashes:
        invalidate_session_cache(token_hash)
    return len(token_hashes)


@router.post("/api/auth/password-reset/confirm", response_model=MessageResponse, summary="Password reset confirm")
def password_reset_confirm(body: PasswordResetConfirmBody, request: Request, db: Session = Depends(get_db)):
    """Password reset confirm."""
    from app.models import User, PasswordResetToken, RefreshToken

    client_ip = _get_client_ip(request) or "unknown"
    if not _password_reset_limiter.allow(client_ip, "password_reset_confirm"):
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limit_exceeded", "message": "Too many requests, please try again later", "details": {}}})

    token_hash = hash_password_reset_token(body.token)
    reset_token = db.query(PasswordResetToken).filter_by(token_hash=token_hash).first()

    if not reset_token:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Reset link not found"})
    if reset_token.used_at:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "This reset link has already been used"})

    now = datetime.now(timezone.utc)
    expires_at = reset_token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if now > expires_at:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "This reset link has expired"})

    user = db.query(User).filter_by(user_id=reset_token.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    if get_settings().resolved_auth_provider == "cognito":
        try:
            cognito_admin_set_user_password(user.email, body.password, permanent=True)
        except CognitoAuthError:
            raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to reset password. Please try again."})

    user.password_hash = hash_password(body.password)
    reset_token.used_at = now

    _revoke_all_sessions(db, user.user_id, now)
    db.commit()

    return {"message": "Password has been reset successfully. Please log in with your new password."}


# =============================================================================
# MFA recovery — self-service "lost your authenticator"
# =============================================================================


@router.post("/api/auth/mfa/recovery/request", response_model=MessageResponse, summary="Request MFA recovery")
def mfa_recovery_request(body: MfaRecoveryRequestBody, request: Request, db: Session = Depends(get_db)):
    """Start the 'lost your authenticator' flow.

    Always returns a generic success (no account enumeration). If the email
    matches an account, emails a single-use, 1-hour link to /recover-mfa.
    """
    _require_cognito_mfa()
    from app.models import User, MfaResetToken

    client_ip = _get_client_ip(request) or "unknown"
    if not _mfa_recovery_limiter.allow(client_ip, "mfa_recovery_request"):
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limit_exceeded", "message": "Too many requests, please try again later", "details": {}}})

    email = body.email.lower().strip()
    success_response = {"message": "If an account exists with this email, recovery instructions have been sent."}

    limited = _recipient_rate_limited(email, "mfa_recovery_request")
    if limited is not None:
        return limited

    user = db.query(User).filter_by(email=email).first()
    if not user:
        return success_response

    # Invalidate any outstanding recovery tokens for this user.
    db.query(MfaResetToken).filter_by(user_id=user.user_id, used_at=None).update(
        {"used_at": datetime.now(timezone.utc)}
    )

    token = generate_password_reset_token()
    token_hash = hash_password_reset_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=1)
    db.add(MfaResetToken(user_id=user.user_id, token_hash=token_hash, expires_at=expires_at))
    db.commit()

    settings = get_settings()
    recovery_url = f"{settings.app_base_url.rstrip('/')}/recover-mfa?token={token}"
    if settings.email_enabled:
        from app.services.email_service import get_email_service
        get_email_service().send_mfa_recovery_email(email, recovery_url)
    else:
        logger.info("[DEV] MFA recovery link for %s: %s", email, recovery_url)

    return success_response


@router.post("/api/auth/mfa/recovery/confirm", response_model=MessageResponse, summary="Confirm MFA recovery")
def mfa_recovery_confirm(body: MfaRecoveryConfirmBody, request: Request, db: Session = Depends(get_db)):
    """Complete MFA recovery: requires the emailed token AND the account
    password, then disables the user's TOTP MFA so they can sign in and
    re-enroll. Revokes existing sessions. Single-use, 1-hour token."""
    _require_cognito_mfa()
    from app.models import User, MfaResetToken, RefreshToken
    from app.services.cognito import cognito_admin_set_user_mfa_preference

    client_ip = _get_client_ip(request) or "unknown"
    if not _mfa_recovery_limiter.allow(client_ip, "mfa_recovery_confirm"):
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limit_exceeded", "message": "Too many requests, please try again later", "details": {}}})

    token_hash = hash_password_reset_token(body.token)
    reset_token = db.query(MfaResetToken).filter_by(token_hash=token_hash).first()
    if not reset_token:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Recovery link not found"})
    if reset_token.used_at:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "This recovery link has already been used"})

    now = datetime.now(timezone.utc)
    expires_at = reset_token.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if now > expires_at:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "This recovery link has expired"})

    user = db.query(User).filter_by(user_id=reset_token.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    # Verify the account password against Cognito (the auth authority). A wrong
    # password raises; a correct one returns either tokens or an MFA challenge —
    # both mean the password is valid. Rate-limited above to deter guessing.
    try:
        cognito_initiate_auth(user.email, body.password)
    except CognitoAuthError:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Incorrect password"})

    # Remove the TOTP authenticator so the user can sign in and re-enroll.
    try:
        cognito_admin_set_user_mfa_preference(email=user.email, totp_enabled=False)
    except CognitoAuthError:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to reset MFA. Please try again."})

    reset_token.used_at = now
    _revoke_all_sessions(db, user.user_id, now)
    db.commit()

    return {"message": "Your authenticator has been removed. Sign in with your password and set up a new authenticator."}


# =============================================================================
# Email Verification
# =============================================================================


@router.post("/api/auth/email-verification/confirm", response_model=MessageResponse, summary="Confirm email verification")
def email_verification_confirm(body: EmailVerificationConfirmBody, request: Request, db: Session = Depends(get_db)):
    """Verify the email address that received this token. Single-use; 24h TTL."""
    from app.models import User, EmailVerificationToken

    client_ip = _get_client_ip(request) or "unknown"
    if not _email_verification_limiter.allow(client_ip, "email_verification_confirm"):
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limit_exceeded", "message": "Too many requests, please try again later", "details": {}}})

    token_hash = hash_email_verification_token(body.token)
    record = db.query(EmailVerificationToken).filter_by(token_hash=token_hash).first()
    if not record:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Verification link not found"})

    now = datetime.now(timezone.utc)
    if record.used_at:
        raise HTTPException(status_code=400, detail={"code": "token_used", "message": "This verification link has already been used"})
    # Normally a no-op now the columns are timestamptz; kept as a guard.
    expires_at = record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < now:
        raise HTTPException(status_code=400, detail={"code": "token_expired", "message": "This verification link has expired"})

    user = db.query(User).filter_by(user_id=record.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    record.used_at = now
    # Idempotent: don't overwrite an earlier verification timestamp.
    if user.email_verified_at is None:
        user.email_verified_at = now
    db.commit()

    return {"message": "Email verified."}


@router.post("/api/auth/email-verification/resend", response_model=MessageResponse, summary="Resend verification email")
def email_verification_resend(body: EmailVerificationResendBody, request: Request, db: Session = Depends(get_db)):
    """Send a fresh verification email. Rate-limited; returns success regardless
    of whether the address is on file (no account-existence enumeration)."""
    from app.models import User, EmailVerificationToken

    client_ip = _get_client_ip(request) or "unknown"
    if not _email_verification_limiter.allow(client_ip, "email_verification_resend"):
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limit_exceeded", "message": "Too many requests, please try again later", "details": {}}})

    email = body.email.lower().strip()
    success = {"message": "If an unverified account exists for this email, we sent a verification link."}

    limited = _recipient_rate_limited(email, "email_verification_resend")
    if limited is not None:
        return limited

    user = db.query(User).filter_by(email=email).first()
    if not user or user.status != "active" or user.email_verified_at is not None:
        return success

    # Invalidate any outstanding tokens so only the newest link works.
    db.query(EmailVerificationToken).filter_by(user_id=user.user_id, used_at=None).update(
        {"used_at": datetime.now(timezone.utc)}
    )

    token = generate_email_verification_token()
    token_hash = hash_email_verification_token(token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=24)
    db.add(EmailVerificationToken(user_id=user.user_id, token_hash=token_hash, expires_at=expires_at))
    db.commit()

    settings = get_settings()
    # app_base_url, not guide_app_url. This was the only one of the three
    # transactional links built from the Guide's origin — residue from when the
    # Guide was a separate self-serve app on its own port. Password reset and
    # MFA recovery both use app_base_url, and so should this.
    verify_url = f"{settings.app_base_url.rstrip('/')}/verify-email?token={token}"
    if settings.email_enabled:
        from app.services.email_service import get_email_service
        get_email_service().send_email_verification_email(email, verify_url, user.display_name)
    else:
        logger.info("[DEV] Email verification link for %s: %s", email, verify_url)

    return success


# =============================================================================
# Routes 10-11: Password Change
# =============================================================================


@router.post("/api/auth/password/change", response_model=dict, summary="Change password")
def change_password(body: ChangePasswordBody, request: Request, db: Session = Depends(get_db)):
    """Change password."""
    token_record, user = _validate_refresh_cookie(request, db)
    client_ip = _get_client_ip(request)

    rate_key = f"password_change:{user.email}"
    rate_limit = auth_limiter.check_rate_limit(rate_key)
    if not rate_limit.allowed:
        return JSONResponse(status_code=429, content={"error": "Too many attempts. Please try again later.", "retry_after": int(rate_limit.retry_after or 60)})

    if get_settings().resolved_auth_provider == "local":
        from app.services.auth_utils import verify_password
        if not user.password_hash or not verify_password(body.current_password, user.password_hash):
            auth_limiter.record_failure(rate_key)
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Current password is incorrect"})
        user.password_hash = hash_password(body.new_password)
        db.commit()
        auth_limiter.record_success(rate_key)
        return {"success": True}

    try:
        result = cognito_initiate_auth(user.email, body.current_password)
    except InvalidCredentialsError:
        auth_limiter.record_failure(rate_key)
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Current password is incorrect"})
    except TooManyRequestsError:
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limit_exceeded", "message": "Too many attempts. Please try again later.", "details": {}}})
    except CognitoAuthError:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Authentication service error"})

    if isinstance(result, AuthChallenge) and result.type == AuthResultType.MFA_REQUIRED:
        return {"mfaRequired": True, "session": result.session, "challengeType": result.challenge_name}

    if not isinstance(result, AuthSuccess) or not result.tokens:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Authentication failed"})

    try:
        cognito_change_password(result.tokens.access_token, body.current_password, body.new_password)
    except InvalidCredentialsError:
        auth_limiter.record_failure(rate_key)
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Current password is incorrect"})
    except TooManyRequestsError:
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limit_exceeded", "message": "Too many attempts. Please try again later.", "details": {}}})
    except CognitoAuthError as e:
        if "password" in e.message.lower():
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": e.message})
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to change password"})

    auth_limiter.record_success(rate_key)
    return {"message": "Password changed successfully."}


@router.post("/api/auth/password/change/mfa", response_model=MessageResponse, summary="Change password with MFA")
def change_password_with_mfa(body: ChangePasswordMFABody, request: Request, db: Session = Depends(get_db)):
    """Change password with mfa."""
    _require_cognito_mfa()
    token_record, user = _validate_refresh_cookie(request, db)

    rate_key = f"password_change:{user.email}"
    rate_limit = auth_limiter.check_rate_limit(rate_key)
    if not rate_limit.allowed:
        return JSONResponse(status_code=429, content={"error": "Too many attempts. Please try again later.", "retry_after": int(rate_limit.retry_after or 60)})

    try:
        result = cognito_respond_to_auth_challenge(
            session=body.session, challenge_name="SOFTWARE_TOKEN_MFA",
            challenge_responses={"USERNAME": user.email, "SOFTWARE_TOKEN_MFA_CODE": body.mfa_code},
            username=user.email,
        )
    except InvalidCredentialsError:
        auth_limiter.record_failure(rate_key)
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid MFA code"})
    except CognitoAuthError as e:
        if "expired" in str(e.message).lower():
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "MFA session expired. Please try again."})
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "MFA verification failed"})

    if not isinstance(result, AuthSuccess) or not result.tokens:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Authentication failed"})

    try:
        cognito_change_password(result.tokens.access_token, body.current_password, body.new_password)
    except InvalidCredentialsError:
        auth_limiter.record_failure(rate_key)
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Current password is incorrect"})
    except TooManyRequestsError:
        return JSONResponse(status_code=429, content={"error": {"code": "rate_limit_exceeded", "message": "Too many attempts.", "details": {}}})
    except CognitoAuthError as e:
        if "password" in e.message.lower():
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": e.message})
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to change password"})

    auth_limiter.record_success(rate_key)
    return {"message": "Password changed successfully."}


# =============================================================================
# Route 12: Activate Account (auth.py version)
# =============================================================================


@router.post("/api/auth/activate", summary="Activate account")
def activate_account(
    body: ActivateAccountBody,
    request: Request,
    db: Session = Depends(get_admin_db),
):
    """Activate account.

    Pre-auth: uses the BYPASSRLS owner connection because the caller is,
    by definition, not yet authenticated to any organization — RLS
    policies on `organization_invitations` filter by
    `organization_id = current_org_id()`, which is NULL for a pre-auth
    request and hides every invitation. The token-hash lookup itself is
    the access control: an attacker who can produce the SHA256 of a valid
    token already controls the invitation.

    Rate-limited per-IP (per-minute + per-hour) and per-token-hash to make
    brute-force enumeration over the invitation-token space impractical.
    """
    from app.models import User, OrganizationMembership, RefreshToken, OrganizationInvitation, Organization, Role

    client_ip = _get_client_ip(request) or "unknown"
    if not activate_limiter.allow(organization_id=client_ip, endpoint="activate"):
        return JSONResponse(status_code=429, content={"error": "Too many requests — please try again later.", "error_code": "RATE_LIMIT_EXCEEDED", "retry_after_seconds": 60}, headers={"Retry-After": "60"})
    if not activate_hourly_limiter.allow(organization_id=client_ip, endpoint="activate_hr"):
        return JSONResponse(status_code=429, content={"error": "Too many requests — please try again later.", "error_code": "RATE_LIMIT_EXCEEDED", "retry_after_seconds": 3600}, headers={"Retry-After": "3600"})

    token_hash = hashlib.sha256(body.token.encode()).hexdigest()

    if not activate_token_limiter.allow(organization_id=token_hash[:16], endpoint="activate_tok"):
        return JSONResponse(status_code=429, content={"error": "Too many requests — please try again later.", "error_code": "RATE_LIMIT_EXCEEDED", "retry_after_seconds": 60}, headers={"Retry-After": "60"})

    invitation = db.query(OrganizationInvitation).filter_by(token_hash=token_hash).first()
    if not invitation:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Invitation token not found"})
    if invitation.used_at:
        raise HTTPException(status_code=409, detail={"code": "conflict", "message": "This invitation has already been used"})
    # invitations.expires_at is timestamptz, so this normally does nothing.
    # Kept as a guard — comparing a naive value against an aware
    # `datetime.now(timezone.utc)` raises TypeError.
    invitation_expires_at = invitation.expires_at
    if invitation_expires_at.tzinfo is None:
        invitation_expires_at = invitation_expires_at.replace(tzinfo=timezone.utc)
    if invitation_expires_at < datetime.now(timezone.utc):
        return JSONResponse(status_code=410, content={
            "error": "This invitation has expired", "code": "INVITATION_EXPIRED",
            "expires_at": invitation.expires_at.isoformat(),
            "hint": "Ask your administrator to resend the invitation.",
        })
    if not invitation.user_id:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Invitation is not bound to a user account"})

    user = db.query(User).filter_by(user_id=invitation.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User account not found"})
    if user.status not in ("invited", "pending"):
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "User account is not in invited status"})
    if user.email.lower() != invitation.email.lower():
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Email mismatch"})

    try:
        if get_settings().resolved_auth_provider == "cognito":
            cognito_admin_set_user_password(email=user.email, password=body.password, permanent=True)
    except CognitoAuthError:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to set authentication credentials"})

    user.status = "active"
    user.password_hash = hash_password(body.password)
    invitation.used_at = datetime.now(timezone.utc)
    db.commit()

    access_token = generate_access_token(
        user_id=str(user.user_id),
        email=user.email,
        active_organization_id=str(invitation.organization_id),
    )
    refresh_token = generate_refresh_token()
    refresh_token_hash = hash_refresh_token(refresh_token)
    refresh_expires = datetime.now(timezone.utc) + timedelta(days=30)

    membership = db.query(OrganizationMembership).filter_by(user_id=user.user_id, organization_id=invitation.organization_id).first()

    db.add(RefreshToken(user_id=user.user_id, token_hash=refresh_token_hash, expires_at=refresh_expires))
    db.commit()

    # Send notification
    try:
        settings = get_settings()
        if settings.email_enabled and invitation.invited_by:
            inviter = db.query(User).filter_by(user_id=invitation.invited_by).first()
            org = db.query(Organization).filter_by(organization_id=invitation.organization_id).first()
            if inviter and org:
                role_name = invitation.role.title()
                if membership and membership.role_id:
                    role = db.query(Role).filter_by(role_id=membership.role_id).first()
                    if role:
                        role_name = role.display_name
                from app.services.email_service import get_email_service
                get_email_service().send_invitation_accepted_email(
                    admin_email=inviter.email, org_name=org.name,
                    accepted_user_email=user.email, accepted_user_name=user.display_name,
                    role_name=role_name,
                )
    except Exception:
        logger.error("Failed to send invitation accepted notification", exc_info=True)

    response = JSONResponse(content={
        "user_id": str(user.user_id), "email": user.email,
        "access_token": access_token, "active_organization_id": str(invitation.organization_id),
        "message": "Account activated successfully",
    })
    return _set_refresh_cookie(response, refresh_token)


# =============================================================================
# Routes 13-14: MFA Setup
# =============================================================================


@router.post("/api/auth/mfa/setup/start", response_model=MFASetupStartResponse, summary="Start MFA setup")
def mfa_setup_start(body: MFASetupStartBody, request: Request, db: Session = Depends(get_db)):
    """Mfa setup start."""
    _require_cognito_mfa()
    from app.models import User, OrganizationMembership
    from app.services.audit_service import log_mfa_enrollment_started, write_audit_via_admin

    email = body.email.lower().strip()
    session_token = body.session
    client_ip = _get_client_ip(request)

    setup_limit = auth_limiter.check_rate_limit(f"mfa_setup:{email}")
    if not setup_limit.allowed:
        return JSONResponse(status_code=429, content={"error": "Too many attempts. Please try again later.", "retry_after": int(setup_limit.retry_after or 60)})

    try:
        user_info = cognito_get_user(session_token)
        cognito_email = user_info.get("email", "")
        if cognito_email.lower() != email:
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid or expired session"})

        result = cognito_associate_software_token(access_token=session_token)
        secret_code = result["secret_code"]

        otpauth_url = f"otpauth://totp/Madrona:{email}?secret={secret_code}&issuer=Madrona"

        user = db.query(User).filter_by(email=email).first()
        org_id = None
        if user:
            membership = db.query(OrganizationMembership).filter_by(user_id=user.user_id).first()
            if membership:
                org_id = membership.organization_id

        # MFA setup runs before the user's first authenticated session
        # exists (it's called from the post-login MFA-setup challenge).
        # No current_org_id is set on the request session, so the
        # audit_logs RLS would reject the write. Persist via the
        # BYPASSRLS owner connection so the enrollment trail isn't lost.
        write_audit_via_admin(
            log_mfa_enrollment_started,
            organization_id=org_id,
            target_user_id=user.user_id if user else None,
            email=email,
            ip_address=client_ip,
        )

        return {"secret": secret_code, "otpauthUrl": otpauth_url, "session": session_token}

    except InvalidCredentialsError:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid or expired session"})
    except CognitoAuthError:
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "MFA setup failed"})


@router.post("/api/auth/mfa/setup/verify", response_model=OkResponse, summary="Verify MFA setup")
def mfa_setup_verify(body: MFASetupVerifyBody, request: Request, db: Session = Depends(get_db)):
    """Mfa setup verify."""
    _require_cognito_mfa()
    from app.models import User, OrganizationMembership
    from app.services.audit_service import log_mfa_enrollment_completed, write_audit_via_admin

    email = body.email.lower().strip()
    code = body.code.strip()
    session_token = body.session
    client_ip = _get_client_ip(request)

    if not code.isdigit() or len(code) != 6:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Code must be 6 digits"})

    verify_limit = auth_limiter.check_rate_limit(f"mfa_setup_verify:{email}")
    if not verify_limit.allowed:
        return JSONResponse(status_code=429, content={"error": "Too many attempts. Please try again later.", "retry_after": int(verify_limit.retry_after or 60)})

    try:
        user_info = cognito_get_user(session_token)
        cognito_email = user_info.get("email", "")
        if cognito_email.lower() != email:
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid or expired session"})

        result = cognito_verify_software_token(user_code=code, access_token=session_token, friendly_device_name="Authenticator App")
        if result.get("status") != "SUCCESS":
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Verification failed"})

        cognito_set_user_mfa_preference(access_token=session_token, totp_enabled=True, preferred="SOFTWARE_TOKEN_MFA")

        user = db.query(User).filter_by(email=email).first()
        org_id = None
        if user:
            membership = db.query(OrganizationMembership).filter_by(user_id=user.user_id).first()
            if membership:
                org_id = membership.organization_id

        # Same rationale as mfa_setup_start — pre-first-session request,
        # no current_org_id, BYPASSRLS write keeps the trail intact.
        write_audit_via_admin(
            log_mfa_enrollment_completed,
            organization_id=org_id,
            target_user_id=user.user_id if user else None,
            email=email,
            ip_address=client_ip,
        )

        return {"ok": True}

    except CognitoAuthError as e:
        if e.code == "InvalidMFACode":
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Authentication failed"})
        elif e.code in ("NotAuthorizedException", "InvalidParameterException"):
            raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Invalid or expired session"})
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Verification failed"})


# =============================================================================
# Routes 14a-14c: Email OTP MFA setup
# =============================================================================

# 6-digit confirmation code emailed during email-MFA enrollment. Hashed
# in Redis under `mfa_email_setup:{user_id}` with a 5-minute TTL so a
# leaked at-rest value isn't a usable code. Separate from the
# Cognito-issued EMAIL_OTP codes sent on every login; this one is a
# one-time "confirm you actually receive mail" gate before we flip
# the Cognito preference.
_MFA_EMAIL_SETUP_TTL_SECONDS = 300
_mfa_email_setup_limiter = RateLimiter(max_requests=3, window_seconds=600)


def _mfa_email_setup_key(user_id) -> str:
    return f"mfa_email_setup:{user_id}"


@router.post(
    "/api/auth/mfa/email/setup/start",
    response_model=OkResponse,
    summary="Start email two-factor enrollment",
)
def mfa_email_setup_start(request: Request, db: Session = Depends(get_db)):
    """Email a 6-digit confirmation code to begin enrolling EMAIL_OTP MFA.

    The code is hashed and stored in Redis with a 5-minute TTL. The
    matching verify endpoint then flips the Cognito email-MFA
    preference on without disturbing existing TOTP.
    """
    _require_cognito_mfa()
    from app.services.audit_service import log_mfa_enrollment_started
    from app.services.email_service import get_email_service
    from app.services.redis_client import get_redis_client

    token_record, user = _validate_refresh_cookie(request, db)
    client_ip = _get_client_ip(request)

    if not _mfa_email_setup_limiter.allow(str(user.user_id), "mfa_email_setup"):
        raise HTTPException(
            status_code=429,
            detail={
                "code": "rate_limit_exceeded",
                "message": "Too many email-setup attempts. Try again in 10 minutes.",
            },
        )

    redis = get_redis_client().client
    if redis is None:
        # Refuse rather than skip the proof-of-receipt step: without a
        # short-lived store we can't verify the code without leaking
        # state into the DB and re-introducing replay risk.
        raise HTTPException(
            status_code=503,
            detail={
                "code": "service_unavailable",
                "message": "Two-factor setup is temporarily unavailable. Try again shortly.",
            },
        )

    code = f"{secrets.randbelow(1_000_000):06d}"
    code_hash = hashlib.sha256(code.encode()).hexdigest()
    redis.set(
        _mfa_email_setup_key(user.user_id),
        code_hash,
        ex=_MFA_EMAIL_SETUP_TTL_SECONDS,
    )

    settings = get_settings()
    if settings.email_enabled:
        get_email_service().send_mfa_email_setup_code(email=user.email, code=code)
    else:
        logger.info("[DEV] MFA email setup code for %s: %s", user.email, code)

    try:
        log_mfa_enrollment_started(
            session=db,
            organization_id=token_record.active_organization_id,
            target_user_id=user.user_id,
            email=user.email,
            ip_address=client_ip,
            mfa_type="email",
        )
        db.commit()
    except SQLAlchemyError:
        db.rollback()

    return {"ok": True}


@router.post(
    "/api/auth/mfa/email/setup/verify",
    response_model=OkResponse,
    summary="Verify email two-factor enrollment",
)
def mfa_email_setup_verify(
    body: MFAEmailSetupVerifyBody,
    request: Request,
    db: Session = Depends(get_db),
):
    """Confirm the emailed code and enable EMAIL_OTP MFA in Cognito.

    Leaves any existing TOTP preference untouched: ``email_enabled=True``
    is passed alone so Cognito's AdminSetUserMFAPreference doesn't
    rewrite the SoftwareTokenMfaSettings block.
    """
    _require_cognito_mfa()
    from app.services.audit_service import log_mfa_enrollment_completed
    from app.services.cognito import cognito_admin_set_user_mfa_preference
    from app.services.redis_client import get_redis_client

    token_record, user = _validate_refresh_cookie(request, db)
    client_ip = _get_client_ip(request)

    code = body.code.strip()
    if not code.isdigit() or len(code) != 6:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Code must be 6 digits"})

    redis = get_redis_client().client
    if redis is None:
        raise HTTPException(
            status_code=503,
            detail={
                "code": "service_unavailable",
                "message": "Two-factor setup is temporarily unavailable. Try again shortly.",
            },
        )

    stored = redis.get(_mfa_email_setup_key(user.user_id))
    if stored is None:
        raise HTTPException(
            status_code=400,
            detail={"code": "bad_request", "message": "No active email-setup code. Request a new one."},
        )
    if isinstance(stored, bytes):
        stored = stored.decode("utf-8")
    submitted_hash = hashlib.sha256(code.encode()).hexdigest()
    # `hmac.compare_digest` would also work; both inputs are hex digests.
    if not secrets.compare_digest(stored, submitted_hash):
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Incorrect code"})

    redis.delete(_mfa_email_setup_key(user.user_id))

    try:
        cognito_admin_set_user_mfa_preference(email=user.email, email_enabled=True)
    except CognitoAuthError as e:
        logger.error("Cognito email-MFA enable failed for %s: %s", user.email, e.code)
        raise HTTPException(
            status_code=500,
            detail={"code": "internal_error", "message": "Failed to enable email two-factor"},
        )

    try:
        log_mfa_enrollment_completed(
            session=db,
            organization_id=token_record.active_organization_id,
            target_user_id=user.user_id,
            email=user.email,
            ip_address=client_ip,
            mfa_type="email",
        )
        db.commit()
    except SQLAlchemyError:
        db.rollback()

    return {"ok": True}


@router.delete(
    "/api/auth/mfa/email",
    response_model=OkResponse,
    summary="Disable email two-factor",
)
def mfa_email_disable(request: Request, db: Session = Depends(get_db)):
    """Disable EMAIL_OTP MFA for the calling user.

    Refuses with 409 if email is the user's only enrolled factor AND
    the user holds a role that requires MFA — that combination would
    lock the user out of every privileged action on next login.
    """
    _require_cognito_mfa()
    from app.models import OrganizationMembership, Role
    from app.services.cognito import (
        cognito_admin_set_user_mfa_preference,
        get_cognito_service,
    )

    token_record, user = _validate_refresh_cookie(request, db)

    cognito_svc = get_cognito_service()
    mfa_status = cognito_svc.get_user_mfa_status(user.email.lower())

    if not mfa_status.get("email_enabled"):
        # Idempotent — already disabled is success.
        return {"ok": True}

    other_factors_enabled = bool(
        mfa_status.get("totp_enabled") or mfa_status.get("sms_enabled")
    )

    if not other_factors_enabled:
        # If any of this user's roles require MFA, refuse.
        user_roles: set[str] = set()
        memberships = (
            db.query(OrganizationMembership, Role)
            .outerjoin(Role, OrganizationMembership.role_id == Role.role_id)
            .filter(OrganizationMembership.user_id == user.user_id)
            .all()
        )
        for membership, role in memberships:
            if role is not None and role.role_key:
                user_roles.add(role.role_key)
            if membership.role:
                user_roles.add(membership.role)

        if user_roles & MFA_REQUIRED_ROLES:
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "conflict",
                    "message": (
                        "Email is the only second factor on your account and your role requires MFA. "
                        "Add another factor before removing email."
                    ),
                },
            )

    try:
        cognito_admin_set_user_mfa_preference(email=user.email, email_enabled=False)
    except CognitoAuthError as e:
        logger.error("Cognito email-MFA disable failed for %s: %s", user.email, e.code)
        raise HTTPException(
            status_code=500,
            detail={"code": "internal_error", "message": "Failed to disable email two-factor"},
        )

    return {"ok": True}


# =============================================================================
# Routes 15-16: User Profile (/me)
# =============================================================================


@router.get("/api/me", response_model=CurrentUserResponse, summary="Get current user")
def get_current_user(request: Request, db: Session = Depends(get_db)):
    """Get current user."""
    from app.models import User, OrganizationMembership, Organization, RefreshToken, Role

    refresh_token_value = request.cookies.get("refresh_token")
    if not refresh_token_value:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Please log in to access this endpoint"})

    token_hash = hash_refresh_token(refresh_token_value)
    token_record = db.query(RefreshToken).filter_by(token_hash=token_hash, revoked_at=None).first()
    if not token_record:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Please log in to access this endpoint"})

    now = datetime.now(timezone.utc)
    expires_at = token_record.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if now > expires_at:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "Session expired"})

    user = db.query(User).filter_by(user_id=token_record.user_id).first()
    if not user:
        raise HTTPException(status_code=401, detail={"code": "unauthorized", "message": "User not found"})

    from app.services.rbac_service import get_user_permissions, is_platform_admin
    from app.services.rls import set_rls_context_for_session

    # Set RLS context using the active org from the refresh token (when set)
    # plus the user_id. The user_id half lets the membership query enumerate
    # orgs via the user-aware policy; the org_id half is what every later
    # query in this handler (applications, permissions, departments) actually
    # needs — without it, organization_applications RLS filters every app row
    # out, the LEFT JOIN sees no matches, and the frontend renders the org
    # with no apps enabled.
    bootstrap_org_id = (
        str(token_record.active_organization_id)
        if token_record.active_organization_id
        else None
    )
    set_rls_context_for_session(db, organization_id=bootstrap_org_id, user_id=str(user.user_id))

    memberships = (
        db.query(OrganizationMembership, Organization, Role)
        .join(Organization, OrganizationMembership.organization_id == Organization.organization_id)
        .join(Role, OrganizationMembership.role_id == Role.role_id)
        .filter(OrganizationMembership.user_id == user.user_id)
        .order_by(Organization.name)
        .all()
    )

    active_org_id = str(token_record.active_organization_id) if token_record.active_organization_id else None

    permissions = []
    role_key = None
    role_label = None
    role_type = None
    active_role_id = None
    if active_org_id:
        try:
            permissions = list(get_user_permissions(user.user_id, active_org_id, session=db))
            active_tuple = next(((m, o, r) for m, o, r in memberships if str(o.organization_id) == active_org_id), None)
            if active_tuple:
                _, _, role = active_tuple
                role_key = role.role_key
                role_label = role.display_name
                role_type = 'system' if role.is_system else 'custom'
                active_role_id = str(role.role_id)
        except (SQLAlchemyError, ValueError):
            pass

    avatar_url = None
    if user.avatar_url:
        from app.services.uploads import get_avatar_public_url
        avatar_url = get_avatar_public_url(user.avatar_url)

    applications = []
    if active_org_id:
        try:
            from app.models import Application, OrganizationApplication
            active_org_uuid = UUID(active_org_id)
            app_query = (
                db.query(Application, OrganizationApplication)
                .outerjoin(
                    OrganizationApplication,
                    (OrganizationApplication.application_id == Application.application_id) &
                    (OrganizationApplication.organization_id == active_org_uuid),
                )
                .filter(Application.status != "deprecated")
                .order_by(Application.sort_order)
                .all()
            )
            # Effective enablement is the organization's choice AND to what
            # the deployment can actually serve. An org can switch Guide on,
            # but if no model provider is configured every conversation would
            # 503 — so the capability check still has the final say here.
            # Org admins see the reason on the Applications settings page.
            #
            # Reported as disabled rather than omitted on purpose:
            # hasAppAccess() fails *open* for unknown keys ("app might not be
            # registered yet"), so dropping the entry would make an app more
            # visible, not less.
            from app.fastapi_app.routers.organizations import _app_capability

            for app, org_app in app_query:
                enabled = bool(org_app.enabled) if org_app else False
                if enabled and not _app_capability(app.key)[0]:
                    enabled = False
                applications.append({
                    "key": app.key, "display_name": app.display_name,
                    "description": app.description, "icon": app.icon,
                    "status": app.status, "enabled": enabled,
                })
        except (SQLAlchemyError, ValueError):
            pass

    user_is_platform_admin = is_platform_admin(user.user_id, session=db)

    # Role override: platform admins can view as a different role, unless
    # the organization has turned role testing off. Checked here because
    # this is where the override is resolved into the session's permission
    # set — gating the UI alone would leave the header working.
    role_override = None
    role_testing_on = True
    if active_org_id:
        try:
            _org = db.query(Organization).filter_by(
                organization_id=UUID(active_org_id)
            ).first()
            role_testing_on = bool(getattr(_org, "role_testing_enabled", True)) if _org else True
        except (SQLAlchemyError, ValueError):
            role_testing_on = True

    if user_is_platform_admin and active_org_id and role_testing_on:
        from app.permissions import ROLE_INHERITANCE_MAP, get_role_inheritance_chain
        from app.models.core import RolePermission, Permission as PermissionModel
        override_header = request.headers.get("x-role-override")
        if override_header and override_header in ROLE_INHERITANCE_MAP and override_header != "platform_admin":
            role_override = override_header
            # Resolve permissions for the override role's inheritance chain
            try:
                override_chain = get_role_inheritance_chain(override_header)
                override_perms = (
                    db.query(PermissionModel.permission_key)
                    .join(RolePermission, RolePermission.permission_id == PermissionModel.permission_id)
                    .join(Role, Role.role_id == RolePermission.role_id)
                    .filter(Role.role_key.in_(override_chain))
                    .distinct()
                    .all()
                )
                permissions = [row[0] for row in override_perms]
                # Update role_key and role_label to reflect the override
                override_role = db.query(Role).filter(Role.role_key == override_header).first()
                if override_role:
                    role_key = override_role.role_key
                    role_label = override_role.display_name
            except (SQLAlchemyError, ValueError):
                role_override = None  # Fall back to normal if anything fails

    department_memberships = []
    primary_department_id = None
    if active_org_id:
        try:
            from app.models.departments import DepartmentMembership as DeptMembership, Department
            dept_memberships = (
                db.query(DeptMembership, Department)
                .join(Department, DeptMembership.department_id == Department.department_id)
                .filter(DeptMembership.user_id == user.user_id, DeptMembership.organization_id == UUID(active_org_id))
                .all()
            )
            for dm, dept in dept_memberships:
                department_memberships.append({
                    "membership_id": str(dm.membership_id), "department_id": str(dm.department_id),
                    "department_name": dept.name, "department_code": dept.code,
                    "department_color": dept.color, "role": dm.role, "is_primary": dm.is_primary,
                })
                if dm.is_primary:
                    primary_department_id = str(dm.department_id)
        except (SQLAlchemyError, ValueError):
            pass

    # MFA factors — Cognito is the source of truth. Failures here
    # shouldn't break /me (the page renders fine without the factors
    # block); the frontend treats `mfa_factors=null` as "unknown".
    mfa_factors = None
    mfa_available = not _auth_backend.is_local()
    try:
        if not mfa_available:
            # Local password auth has no MFA provider. Calling Cognito here
            # raises (no user pool configured) and logs a traceback on every
            # single /me — the loudest error in a healthy self-hosted stack.
            raise _MfaUnavailable
        from app.services.cognito import get_cognito_service
        status = get_cognito_service().get_user_mfa_status(user.email.lower())
        preferred_internal = _CHALLENGE_TO_MFA_TYPE.get(status.get("preferred_mfa") or "")
        mfa_factors = {
            "totp": bool(status.get("totp_enabled")),
            "sms": bool(status.get("sms_enabled")),
            "email": bool(status.get("email_enabled")),
            "preferred": preferred_internal,
        }
    except _MfaUnavailable:
        pass
    except Exception:
        logger.warning("Failed to load MFA factors for %s", user.email, exc_info=True)

    return {
        "user_id": str(user.user_id),
        "email": user.email,
        "email_verified_at": user.email_verified_at.isoformat() if user.email_verified_at else None,
        "name": user.display_name or user.email.split("@")[0],
        "timezone": getattr(user, "timezone", None) or "America/New_York",
        "locale": getattr(user, "locale", None),
        "avatar_url": avatar_url,
        "active_organization_id": active_org_id,
        "permissions": permissions,
        "role_key": role_key,
        "role_label": role_label,
        "role_type": role_type,
        "role_id": active_role_id,
        "is_platform_admin": user_is_platform_admin,
        "role_override": role_override,
        "role_testing_enabled": role_testing_on,
        "applications": applications,
        # Deployment capability, not an org setting: the frontend hides the
        # Ask-Guide affordance entirely when there is no agent configured.
        "agent_enabled": get_settings().agent_enabled,
        "ai_tagging_enabled": get_settings().ai_tagging_enabled,
        "transcription_enabled": get_settings().whisper_enabled,
        "department_memberships": department_memberships,
        "primary_department_id": primary_department_id,
        "mfa_factors": mfa_factors,
        "mfa_available": mfa_available,
        "organizations": [
            {
                "organization_id": str(org.organization_id),
                "name": org.name, "slug": org.slug,
                "timezone": getattr(org, "timezone", "UTC"),
                "role": membership.role, "role_key": role.role_key,
                "role_label": role.display_name,
                "role_id": str(role.role_id),
                "role_type": 'system' if role.is_system else 'custom',
            }
            for membership, org, role in memberships
        ],
    }


@router.put("/api/me", response_model=UpdateProfileResponse, summary="Update current user")
def update_current_user(body: UpdateProfileBody, request: Request, db: Session = Depends(get_db)):
    """Update current user."""
    from app.models import User

    token_record, user = _validate_refresh_cookie(request, db)

    if body.display_name is not None:
        display_name = body.display_name.strip() if body.display_name else None
        if display_name and len(display_name) > 200:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "display_name must be 200 characters or less"})
        user.display_name = display_name if display_name else None

    if body.timezone is not None:
        tz_value = body.timezone.strip() if body.timezone else None
        if tz_value and len(tz_value) > 50:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "timezone must be 50 characters or less"})
        user.timezone = tz_value if tz_value else None

    if body.locale is not None:
        loc_value = body.locale.strip() if body.locale else None
        if loc_value and len(loc_value) > 35:
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "locale must be 35 characters or less"})
        user.locale = loc_value if loc_value else None

    db.commit()

    avatar_url = None
    if user.avatar_url:
        from app.services.uploads import get_avatar_public_url
        avatar_url = get_avatar_public_url(user.avatar_url)

    return {
        "user_id": str(user.user_id), "email": user.email,
        "name": user.display_name or user.email.split("@")[0],
        "timezone": user.timezone, "locale": user.locale, "avatar_url": avatar_url,
        "message": "Profile updated successfully",
    }


# =============================================================================
# Routes 17-18: Avatar
# =============================================================================


@router.post("/api/me/avatar", response_model=AvatarResponse, summary="Upload avatar")
def upload_avatar(request: Request, avatar: UploadFile = File(...), db: Session = Depends(get_db)):
    """Upload avatar."""
    from app.services.uploads import upload_avatar as do_upload, get_avatar_public_url, delete_avatar

    token_record, user = _validate_refresh_cookie(request, db)

    try:
        if user.avatar_url:
            delete_avatar(user.avatar_url)

        s3_key = do_upload(
            user_id=str(user.user_id),
            file_data=avatar.file,
            content_type=avatar.content_type,
            filename=avatar.filename,
        )

        user.avatar_url = s3_key
        db.commit()

        public_url = get_avatar_public_url(s3_key)
        return {"avatar_url": public_url, "message": "Avatar uploaded successfully"}
    except ValueError as e:
        from app.exceptions import ValidationError
        raise ValidationError(str(e))


@router.delete("/api/me/avatar", response_model=MessageResponse, summary="Delete user avatar")
def delete_user_avatar(request: Request, db: Session = Depends(get_db)):
    """Delete user avatar."""
    from app.services.uploads import delete_avatar

    token_record, user = _validate_refresh_cookie(request, db)

    if user.avatar_url:
        delete_avatar(user.avatar_url)
        user.avatar_url = None
        db.commit()

    return {"message": "Avatar deleted successfully"}


# =============================================================================
# Route 19: Active Organization
# =============================================================================


@router.post("/api/me/active-organization", response_model=ActiveOrganizationResponse, summary="Set active organization")
def set_active_organization(body: SetActiveOrganizationBody, request: Request, db: Session = Depends(get_db)):
    """Set active organization."""
    from app.models import OrganizationMembership

    token_record, user = _validate_refresh_cookie(request, db)

    # Cookie auth skips require_auth, so no RLS context is set on this
    # session. organization_memberships is user-scoped under RLS — without
    # current_user_id() the membership row is invisible and every switch
    # would 403 as "not a member".
    from app.services.rls import set_rls_context_for_session
    set_rls_context_for_session(db, organization_id=None, user_id=str(user.user_id))

    membership = db.query(OrganizationMembership).filter_by(user_id=user.user_id, organization_id=body.organization_id).first()
    if not membership:
        raise HTTPException(status_code=403, detail={"code": "forbidden", "message": "Not a member of this organization"})

    token_record.active_organization_id = body.organization_id
    db.commit()

    # The cookie-auth path resolves the active org through the Redis session
    # cache (TTL up to 1h); without this, every request keeps the old org's
    # RLS scope until the entry expires.
    invalidate_session_cache(hash_refresh_token(request.cookies.get("refresh_token")))

    return {"active_organization_id": str(body.organization_id)}


# =============================================================================
# Route 19a: MFA preferences
# =============================================================================


@router.put(
    "/api/me/mfa-preferences",
    response_model=MFAFactorsOut,
    summary="Set preferred MFA factor",
)
def set_mfa_preferences(
    body: MFAPreferenceBody,
    request: Request,
    db: Session = Depends(get_db),
):
    """Choose which enrolled MFA factor Cognito issues as the default
    challenge on the next login.

    Refuses with 409 if the requested factor isn't currently enrolled
    on the user — without that guard the API would silently no-op and
    leave the existing preferred factor in place.
    """
    _require_cognito_mfa()
    from app.services.cognito import (
        cognito_admin_set_user_mfa_preference,
        get_cognito_service,
    )

    _, user = _validate_refresh_cookie(request, db)
    target_internal = body.preferred  # 'totp' | 'sms' | 'email'
    target_challenge = _MFA_TYPE_TO_CHALLENGE[target_internal]

    status = get_cognito_service().get_user_mfa_status(user.email.lower())
    enrolled = {
        "totp": bool(status.get("totp_enabled")),
        "sms": bool(status.get("sms_enabled")),
        "email": bool(status.get("email_enabled")),
    }
    if not enrolled.get(target_internal):
        raise HTTPException(
            status_code=409,
            detail={
                "code": "conflict",
                "message": (
                    f"{target_internal} two-factor is not enrolled on this account. "
                    f"Enroll it before making it the preferred factor."
                ),
            },
        )

    # Re-pass every enrolled factor so AWS sees a consistent state — if
    # we omit a factor block, Cognito leaves it as-is, but PreferredMfa
    # only sticks on a block we're writing. Writing all enrolled blocks
    # with the correct PreferredMfa flag is the simplest correct path.
    try:
        cognito_admin_set_user_mfa_preference(
            email=user.email,
            totp_enabled=True if enrolled["totp"] else None,
            sms_enabled=True if enrolled["sms"] else None,
            email_enabled=True if enrolled["email"] else None,
            preferred=target_challenge,
        )
    except CognitoAuthError as e:
        logger.error(
            "Cognito set-preferred-MFA failed for %s: %s", user.email, e.code
        )
        raise HTTPException(
            status_code=500,
            detail={
                "code": "internal_error",
                "message": "Failed to update two-factor preference",
            },
        )

    new_status = get_cognito_service().get_user_mfa_status(user.email.lower())
    return {
        "totp": bool(new_status.get("totp_enabled")),
        "sms": bool(new_status.get("sms_enabled")),
        "email": bool(new_status.get("email_enabled")),
        "preferred": _CHALLENGE_TO_MFA_TYPE.get(new_status.get("preferred_mfa") or ""),
    }


# =============================================================================
# Routes 20-21: Overview Preferences
# =============================================================================


@router.get("/api/me/overview-preferences", response_model=OverviewPreferencesResponse, summary="Get overview preferences")
def get_overview_preferences(request: Request, db: Session = Depends(get_db)):
    """Get overview preferences."""
    from app.models import UserOverviewPreference, Dataset
    from app.services.rls import set_rls_context_for_session

    token_record, user = _validate_refresh_cookie(request, db)
    org_id = token_record.active_organization_id
    if not org_id:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No active organization"})

    # get_db does not set RLS scope — call sites do. Without it
    # current_org_id() is NULL, every org-scoped query matches no rows, and
    # this endpoint silently reports that the organization has no datasets.
    set_rls_context_for_session(db, organization_id=str(org_id), user_id=str(user.user_id))

    pref = db.query(UserOverviewPreference).filter_by(user_id=user.user_id, organization_id=org_id).first()
    if pref:
        return {
            "visible_dataset_ids": pref.visible_dataset_ids,
            "dataset_order": pref.dataset_order or [],
            "updated_at": pref.updated_at.isoformat() if pref.updated_at else None,
        }

    datasets = db.query(Dataset).filter_by(organization_id=org_id).order_by(Dataset.created_at.desc()).all()
    visible = datasets if len(datasets) <= 5 else datasets[:5]
    return {
        "visible_dataset_ids": [str(d.dataset_id) for d in visible],
        "dataset_order": [str(d.dataset_id) for d in datasets],
        "updated_at": None,
    }


@router.put("/api/me/overview-preferences", response_model=OverviewPreferencesResponse, summary="Set overview preferences")
def set_overview_preferences(body: SetOverviewPreferencesBody, request: Request, db: Session = Depends(get_db)):
    """Set overview preferences."""
    from app.models import UserOverviewPreference, Dataset
    from app.services.rls import set_rls_context_for_session

    token_record, user = _validate_refresh_cookie(request, db)
    org_id = token_record.active_organization_id
    if not org_id:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No active organization"})

    # get_db does not set RLS scope — call sites do. Without this,
    # current_org_id() is NULL, so every org-scoped SELECT here matches no
    # rows and the INSERT below fails the policy's WITH CHECK.
    set_rls_context_for_session(db, organization_id=str(org_id), user_id=str(user.user_id))

    # Filter submitted IDs to datasets visible in this org rather than
    # rejecting the save: preferences legitimately outlive datasets (deletion,
    # re-provisioning), and under RLS a foreign dataset is indistinguishable
    # from a deleted one, so a stored stale ID would otherwise poison every
    # subsequent save. Malformed UUIDs are still a 400.
    def _org_filtered(ids: list[str], label: str) -> list[str]:
        if not ids:
            return []
        try:
            uuids = [UUID(d_id) for d_id in ids]
        except (ValueError, AttributeError):
            raise HTTPException(status_code=400, detail={"code": "bad_request", "message": f"Invalid {label} ID format"})
        existing = {
            row[0]
            for row in db.query(Dataset.dataset_id)
            .filter(Dataset.organization_id == org_id, Dataset.dataset_id.in_(uuids))
            .all()
        }
        return [str(u) for u in uuids if u in existing]

    visible_ids = _org_filtered(body.visible_dataset_ids or [], "dataset")
    order_ids = _org_filtered(body.dataset_order or [], "dataset_order")

    pref = db.query(UserOverviewPreference).filter_by(user_id=user.user_id, organization_id=org_id).first()
    if pref:
        pref.visible_dataset_ids = visible_ids
        pref.dataset_order = order_ids
        pref.updated_at = datetime.now(timezone.utc)
    else:
        pref = UserOverviewPreference(
            user_id=user.user_id, organization_id=org_id,
            visible_dataset_ids=visible_ids,
            dataset_order=order_ids,
        )
        db.add(pref)

    db.commit()

    return {
        "visible_dataset_ids": pref.visible_dataset_ids,
        "dataset_order": pref.dataset_order or [],
        "updated_at": pref.updated_at.isoformat() if pref.updated_at else None,
    }


# =============================================================================
# Route 22: Verify Invitation
# =============================================================================


@router.get("/api/invitations/{token}/verify", response_model=InvitationVerifyResponse, summary="Verify invitation")
def verify_invitation(token: str, request: Request, db: Session = Depends(get_admin_db)):
    """Verify invitation. Pre-auth, see `activate_account` for the
    RLS / BYPASSRLS rationale."""
    from app.models import User, OrganizationInvitation

    client_ip = _get_client_ip(request) or "unknown"
    if not verify_limiter.allow(organization_id=client_ip, endpoint="verify"):
        return JSONResponse(status_code=429, content={"error": "Too many requests — please try again later.", "error_code": "RATE_LIMIT_EXCEEDED", "retry_after_seconds": 60}, headers={"Retry-After": "60"})
    if not verify_hourly_limiter.allow(organization_id=client_ip, endpoint="verify_hr"):
        return JSONResponse(status_code=429, content={"error": "Too many requests — please try again later.", "error_code": "RATE_LIMIT_EXCEEDED", "retry_after_seconds": 3600}, headers={"Retry-After": "3600"})

    token_hash = hashlib.sha256(token.encode()).hexdigest()
    invitation = db.query(OrganizationInvitation).filter_by(token_hash=token_hash).first()

    if not invitation or invitation.used_at:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Invitation token not found"})

    verify_expires_at = invitation.expires_at
    if verify_expires_at.tzinfo is None:
        verify_expires_at = verify_expires_at.replace(tzinfo=timezone.utc)
    if verify_expires_at < datetime.now(timezone.utc):
        return JSONResponse(status_code=410, content={
            "error": "Invitation has expired", "code": "INVITATION_EXPIRED",
            "expires_at": invitation.expires_at.isoformat(),
            "hint": "Ask your administrator to resend the invitation.",
        })

    user = None
    if invitation.user_id:
        user = db.query(User).filter_by(user_id=invitation.user_id).first()

    return {
        "valid": True, "email": invitation.email,
        "user_id": str(invitation.user_id) if invitation.user_id else None,
        "user_status": user.status if user else None,
        "organization_id": str(invitation.organization_id),
        "role": invitation.role, "expires_at": invitation.expires_at.isoformat(),
    }


# =============================================================================
# Routes 24-27: Google OAuth
# =============================================================================


@router.get("/api/auth/google/authorize", response_model=GoogleAuthorizeResponse, summary="Google authorize")
def google_authorize(auth: AuthContext = Depends(require_auth)):
    """Google authorize."""
    from app.services.google_oauth import GoogleOAuthService

    oauth_service = GoogleOAuthService()
    if not oauth_service.is_configured():
        raise HTTPException(status_code=503, detail={"code": "service_unavailable", "message": "Google OAuth not configured"})

    auth_url = oauth_service.get_authorization_url()
    return {"authorization_url": auth_url}


@router.post("/api/auth/google/callback", response_model=SuccessMessageResponse, summary="Google callback")
def google_callback(body: GoogleCallbackBody, auth: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    """Google callback."""
    from app.models import User
    from app.services.google_oauth import GoogleOAuthService

    if not body.code:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Missing authorization code"})

    oauth_service = GoogleOAuthService()
    try:
        token_data = oauth_service.exchange_code_for_tokens(body.code)
    except requests.RequestException as exc:
        # An expired, replayed or malformed code is Google rejecting the
        # exchange — a client error and the ordinary failure mode of a stale
        # OAuth round trip. Uncaught, requests.HTTPError surfaced as a 500.
        logger.warning("Google token exchange failed: %s", exc)
        raise HTTPException(
            status_code=400,
            detail={"code": "bad_request", "message": "Invalid or expired authorization code"},
        ) from exc

    # Bind to the authenticated caller, never to a client-supplied id.
    user = db.query(User).filter(User.user_id == auth.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    user.google_access_token = token_data["access_token"]
    user.google_refresh_token = token_data.get("refresh_token")
    user.google_token_expiry = token_data["token_expiry"]
    db.commit()

    return {"success": True, "message": "Google Sheets access authorized successfully"}


@router.get("/api/auth/google/status", response_model=GoogleStatusResponse, summary="Google status")
def google_status(auth: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    """Google status."""
    from app.models import User
    from app.services.google_oauth import GoogleOAuthService

    user = db.query(User).filter(User.user_id == auth.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    has_tokens = bool(user.google_access_token and user.google_refresh_token)
    oauth_service = GoogleOAuthService()
    needs_refresh = has_tokens and oauth_service.needs_refresh(user.google_token_expiry)

    return {"authorized": has_tokens, "needs_refresh": needs_refresh, "oauth_configured": oauth_service.is_configured()}


@router.post("/api/auth/google/revoke", response_model=SuccessMessageResponse, summary="Google revoke")
def google_revoke(auth: AuthContext = Depends(require_auth), db: Session = Depends(get_db)):
    """Google revoke."""
    from app.models import User

    user = db.query(User).filter(User.user_id == auth.user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "User not found"})

    user.google_access_token = None
    user.google_refresh_token = None
    user.google_token_expiry = None
    db.commit()

    return {"success": True, "message": "Google Sheets access revoked successfully"}
