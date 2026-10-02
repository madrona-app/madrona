"""
MFA Recovery Codes Service.

Provides secure generation, storage, and verification of one-time recovery codes
for MFA account recovery when users lose access to their authenticator app.

Security properties:
- Codes stored as Argon2id hashes (never plaintext)
- One-time use with atomic consumption (prevents race conditions)
- Codes tied to user's mfa_version (auto-invalidate on MFA reset)
- Human-readable format: XXXX-XXXX-XXXX (12 chars, alphanumeric)
"""

import logging
import secrets
import string
from datetime import datetime, timezone
from typing import Optional
from uuid import UUID

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from sqlalchemy import and_, update
from sqlalchemy.orm import Session

from app.models import MfaRecoveryCode, User

logger = logging.getLogger(__name__)

# Argon2id hasher with secure defaults
# Using time_cost=2, memory_cost=19456 (19MB), parallelism=1 for reasonable performance
_hasher = PasswordHasher(
    time_cost=2,
    memory_cost=19456,  # 19MB
    parallelism=1,
    hash_len=32,
    salt_len=16,
)

# Character set for recovery codes (excluding ambiguous chars: 0/O, 1/I/l)
# Using uppercase + digits for easier reading/typing
CODE_CHARSET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
CODE_GROUP_LENGTH = 4
CODE_NUM_GROUPS = 3  # Results in XXXX-XXXX-XXXX format


def _generate_code() -> str:
    """
    Generate a single recovery code in human-readable format.

    Format: XXXX-XXXX-XXXX (12 chars total, grouped by 4)
    Uses cryptographically secure random selection.
    """
    groups = []
    for _ in range(CODE_NUM_GROUPS):
        group = ''.join(
            secrets.choice(CODE_CHARSET) for _ in range(CODE_GROUP_LENGTH)
        )
        groups.append(group)
    return '-'.join(groups)


def _normalize_code(code: str) -> str:
    """
    Normalize a recovery code for comparison.

    - Strip whitespace
    - Remove dashes
    - Convert to uppercase
    """
    return code.strip().replace('-', '').replace(' ', '').upper()


def _hash_code(code: str) -> str:
    """Hash a recovery code using Argon2id."""
    normalized = _normalize_code(code)
    return _hasher.hash(normalized)


def _verify_code_hash(code: str, code_hash: str) -> bool:
    """
    Verify a recovery code against its hash.

    Returns True if valid, False otherwise.
    Uses constant-time comparison via Argon2.
    """
    normalized = _normalize_code(code)
    try:
        _hasher.verify(code_hash, normalized)
        return True
    except VerifyMismatchError:
        return False


def create_recovery_codes(
    session: Session,
    user_id: UUID,
    count: int = 10,
    label: str = "initial",
) -> list[str]:
    """
    Generate new recovery codes for a user.

    This will:
    1. Increment user's mfa_version (invalidating old codes)
    2. Generate `count` new codes
    3. Store hashed codes in database
    4. Update user's recovery_codes_generated_at

    Args:
        session: Database session
        user_id: User to generate codes for
        count: Number of codes to generate (default 10)
        label: Label for audit trail (e.g., "initial", "regenerated")

    Returns:
        List of plaintext codes (only time they're available!)

    Raises:
        ValueError: If user not found
    """
    user = session.query(User).filter_by(user_id=user_id).with_for_update().first()
    if not user:
        raise ValueError(f"User {user_id} not found")

    # Increment mfa_version to invalidate any existing codes
    new_version = user.mfa_version + 1
    user.mfa_version = new_version
    user.recovery_codes_generated_at = datetime.now(timezone.utc)

    # Generate codes
    plaintext_codes = []
    for _ in range(count):
        code = _generate_code()
        plaintext_codes.append(code)

        # Store hashed version
        recovery_code = MfaRecoveryCode(
            user_id=user_id,
            code_hash=_hash_code(code),
            mfa_version=new_version,
            label=label,
        )
        session.add(recovery_code)

    session.flush()

    logger.info(
        f"Generated {count} recovery codes for user {user_id} (version {new_version})"
    )

    return plaintext_codes


def verify_and_consume_recovery_code(
    session: Session,
    user_id: UUID,
    code: str,
    session_id: Optional[str] = None,
) -> bool:
    """
    Verify and atomically consume a recovery code.

    This uses a row-level lock and atomic update to ensure:
    - Code can only be used once
    - Concurrent attempts only allow one success

    Args:
        session: Database session
        user_id: User attempting to use code
        code: The recovery code to verify
        session_id: Optional session ID for audit trail

    Returns:
        True if code was valid and consumed, False otherwise
    """
    # Get user's current mfa_version
    user = session.query(User).filter_by(user_id=user_id).first()
    if not user:
        logger.warning(f"Recovery code attempt for unknown user {user_id}")
        return False

    current_version = user.mfa_version

    # Get all unused codes for this user and version
    # We need to check each one since we can't query by hash
    unused_codes = (
        session.query(MfaRecoveryCode)
        .filter(
            and_(
                MfaRecoveryCode.user_id == user_id,
                MfaRecoveryCode.mfa_version == current_version,
                MfaRecoveryCode.used_at.is_(None),
            )
        )
        .with_for_update()  # Row-level lock
        .all()
    )

    if not unused_codes:
        logger.info(f"No unused recovery codes for user {user_id}")
        return False

    # Try to match the provided code against unused codes
    for recovery_code in unused_codes:
        if _verify_code_hash(code, recovery_code.code_hash):
            # Atomic update - mark as used
            # Double-check it wasn't consumed in a race condition
            result = session.execute(
                update(MfaRecoveryCode)
                .where(
                    and_(
                        MfaRecoveryCode.code_id == recovery_code.code_id,
                        MfaRecoveryCode.used_at.is_(None),  # Still unused
                    )
                )
                .values(
                    used_at=datetime.now(timezone.utc),
                    used_session_id=session_id,
                )
            )

            if result.rowcount == 1:
                logger.info(
                    f"Recovery code consumed for user {user_id} "
                    f"(code_id: {recovery_code.code_id})"
                )
                return True
            else:
                # Race condition - code was consumed between our check and update
                logger.warning(
                    f"Recovery code race condition for user {user_id} "
                    f"(code_id: {recovery_code.code_id})"
                )
                return False

    logger.info(f"Invalid recovery code attempt for user {user_id}")
    return False


def invalidate_all_recovery_codes(
    session: Session,
    user_id: UUID,
) -> int:
    """
    Invalidate all recovery codes for a user by incrementing mfa_version.

    This is more efficient than deleting codes - old codes simply won't
    match the new version.

    Args:
        session: Database session
        user_id: User to invalidate codes for

    Returns:
        New mfa_version

    Raises:
        ValueError: If user not found
    """
    user = session.query(User).filter_by(user_id=user_id).with_for_update().first()
    if not user:
        raise ValueError(f"User {user_id} not found")

    user.mfa_version += 1
    session.flush()

    logger.info(
        f"Invalidated recovery codes for user {user_id} "
        f"(new version: {user.mfa_version})"
    )

    return user.mfa_version


def get_recovery_code_status(
    session: Session,
    user_id: UUID,
) -> dict:
    """
    Get recovery code status for a user.

    Args:
        session: Database session
        user_id: User to check

    Returns:
        Dict with:
        - has_codes: bool
        - codes_remaining: int
        - generated_at: datetime or None
        - total_codes: int
        - used_codes: int
    """
    user = session.query(User).filter_by(user_id=user_id).first()
    if not user:
        return {
            'has_codes': False,
            'codes_remaining': 0,
            'generated_at': None,
            'total_codes': 0,
            'used_codes': 0,
        }

    # Count codes for current mfa_version
    total_codes = (
        session.query(MfaRecoveryCode)
        .filter(
            and_(
                MfaRecoveryCode.user_id == user_id,
                MfaRecoveryCode.mfa_version == user.mfa_version,
            )
        )
        .count()
    )

    unused_codes = (
        session.query(MfaRecoveryCode)
        .filter(
            and_(
                MfaRecoveryCode.user_id == user_id,
                MfaRecoveryCode.mfa_version == user.mfa_version,
                MfaRecoveryCode.used_at.is_(None),
            )
        )
        .count()
    )

    return {
        'has_codes': unused_codes > 0,
        'codes_remaining': unused_codes,
        'generated_at': user.recovery_codes_generated_at,
        'total_codes': total_codes,
        'used_codes': total_codes - unused_codes,
    }


def delete_old_recovery_codes(
    session: Session,
    user_id: UUID,
    keep_version: Optional[int] = None,
) -> int:
    """
    Delete old recovery codes for a user.

    Useful for cleanup after codes have been regenerated.

    Args:
        session: Database session
        user_id: User to clean up
        keep_version: If provided, only delete codes with older versions

    Returns:
        Number of codes deleted
    """
    query = session.query(MfaRecoveryCode).filter(
        MfaRecoveryCode.user_id == user_id
    )

    if keep_version is not None:
        query = query.filter(MfaRecoveryCode.mfa_version < keep_version)

    count = query.delete(synchronize_session=False)
    session.flush()

    if count > 0:
        logger.info(f"Deleted {count} old recovery codes for user {user_id}")

    return count
