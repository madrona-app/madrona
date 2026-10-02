"""
Auth provider facade — Cognito or local password auth.

The app always issues its own HS256 access tokens and refresh cookies
(see auth_utils / dependencies.auth); the provider only decides how
*credentials* are verified and where user credentials live:

- "cognito": AWS Cognito (hosted deployments). All calls delegate to
  app.services.cognito unchanged.
- "local": the users.password_hash column (self-hosted deployments).
  Cognito admin calls become no-ops; password verification happens
  against the bcrypt hash the Cognito paths were already dual-writing.

MFA is Cognito-only today. Under the local provider, MFA endpoints
return 501 and role-based MFA enforcement is skipped (logged loudly at
startup of the first login). Self-hosters own their own perimeter; see
the Authentication section of the README.
"""

import logging

from sqlalchemy.orm import Session

from app.config import get_settings
from app.services.auth_utils import verify_password
from app.services.cognito import (  # noqa: F401 — re-exported for callers
    InvalidCredentialsError,
    UserNotFoundError,
)

logger = logging.getLogger(__name__)

_warned_local_mfa = False


def resolved_provider() -> str:
    return get_settings().resolved_auth_provider


def is_local() -> bool:
    return resolved_provider() == "local"


def warn_local_mfa_once() -> None:
    """Log once per process that MFA enforcement is off under local auth."""
    global _warned_local_mfa
    if not _warned_local_mfa:
        logger.warning(
            "AUTH_PROVIDER=local: MFA is unavailable and role-based MFA "
            "enforcement is skipped. Use the cognito provider if you need MFA."
        )
        _warned_local_mfa = True


def local_verify_credentials(db: Session, email: str, password: str):
    """
    Verify email+password against users.password_hash.

    Returns the User row on success. Raises the same exceptions the
    Cognito path raises so callers keep one error-handling shape:
    - UserNotFoundError when no user row exists
    - InvalidCredentialsError when there is no local hash or it doesn't match
    """
    from app.models import User

    user = db.query(User).filter_by(email=email).first()
    if user is None:
        raise UserNotFoundError("User not found")
    if not user.password_hash:
        # Cognito-era user with no local hash — they must go through the
        # password-reset flow to establish one before local login works.
        logger.info("local auth: user %s has no password_hash", email)
        raise InvalidCredentialsError("Invalid credentials")
    if not verify_password(password, user.password_hash):
        raise InvalidCredentialsError("Invalid credentials")
    return user


# ---------------------------------------------------------------------------
# Provider-aware wrappers for the Cognito admin ops that other modules call
# unconditionally. Local mode: no-op (the caller owns the DB user row and,
# where relevant, the password_hash write).
# ---------------------------------------------------------------------------

def admin_create_user(email: str, *args, **kwargs):
    if is_local():
        logger.debug("local auth: skipping cognito_admin_create_user(%s)", email)
        return None
    from app.services.cognito import cognito_admin_create_user
    return cognito_admin_create_user(email, *args, **kwargs)


def admin_set_user_password(email: str, password: str, permanent: bool = True):
    if is_local():
        logger.debug("local auth: skipping cognito_admin_set_user_password(%s)", email)
        return None
    from app.services.cognito import cognito_admin_set_user_password
    return cognito_admin_set_user_password(email, password, permanent=permanent)


def admin_delete_user(email: str):
    if is_local():
        logger.debug("local auth: skipping cognito_admin_delete_user(%s)", email)
        return None
    from app.services.cognito import cognito_admin_delete_user
    return cognito_admin_delete_user(email)
