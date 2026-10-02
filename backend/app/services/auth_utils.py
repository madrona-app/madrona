"""
Authentication utilities for ORG2 browser auth.

Provides:
- Password hashing with bcrypt
- JWT access token generation/validation
- Refresh token generation/validation
- Verification code generation/hashing
"""

import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
import jwt

from app.config import get_settings

logger = logging.getLogger(__name__)

settings = get_settings()


# ============================================================================
# Password Hashing
# ============================================================================


def hash_password(password: str) -> str:
    """
    Hash a password using bcrypt.
    
    Args:
        password: Plain text password
        
    Returns:
        Hashed password string (bcrypt format)
    """
    password_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(password_bytes, salt)
    return hashed.decode('utf-8')


def verify_password(password: str, password_hash: str) -> bool:
    """
    Verify a password against a bcrypt hash.
    
    Args:
        password: Plain text password to verify
        password_hash: Bcrypt hash to verify against
        
    Returns:
        True if password matches hash, False otherwise
    """
    try:
        password_bytes = password.encode('utf-8')
        hash_bytes = password_hash.encode('utf-8')
        return bcrypt.checkpw(password_bytes, hash_bytes)
    except Exception as e:
        logger.error(f"Password verification error: {e}")
        return False


# ============================================================================
# JWT Access Tokens
# ============================================================================


def generate_access_token(
    user_id: str,
    email: str,
    active_organization_id: str | None = None,
    expires_minutes: int = 15,
    mfa_verified: bool = False,
    mfa_at: str | None = None,
) -> str:
    """
    Generate a JWT access token for API authentication.

    Args:
        user_id: User UUID as string
        email: User email
        active_organization_id: Optional active org UUID
        expires_minutes: Token expiration time in minutes (default: 15)
        mfa_verified: Whether MFA was verified for this session
        mfa_at: ISO timestamp when MFA was verified

    Returns:
        JWT token string
    """
    now = datetime.now(timezone.utc)
    expires_at = now + timedelta(minutes=expires_minutes)

    payload = {
        'sub': user_id,  # Subject (user ID)
        'email': email,
        'active_organization_id': active_organization_id,
        'iat': now,  # Issued at
        'exp': expires_at,  # Expiration
        'type': 'access',
        'mfa_verified': mfa_verified,
        'mfa_at': mfa_at,
    }

    token = jwt.encode(payload, settings.secret_key, algorithm='HS256')
    return token


def decode_access_token(token: str) -> dict[str, Any] | None:
    """
    Decode and validate a JWT access token.
    
    Args:
        token: JWT token string
        
    Returns:
        Token payload dict if valid, None if invalid/expired
    """
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=['HS256'])
        
        # Verify token type
        if payload.get('type') != 'access':
            logger.warning("Invalid token type")
            return None
            
        return payload
    except jwt.ExpiredSignatureError:
        logger.debug("Access token expired")
        return None
    except jwt.InvalidTokenError as e:
        logger.warning(f"Invalid access token: {e}")
        return None


# ============================================================================
# Refresh Tokens
# ============================================================================


def generate_refresh_token() -> str:
    """
    Generate a cryptographically secure refresh token.
    
    Returns:
        Random token string (hex-encoded 32 bytes)
    """
    return secrets.token_hex(32)


def hash_refresh_token(token: str) -> str:
    """
    Hash a refresh token for storage using HMAC-SHA256.

    Uses the server secret as HMAC key so token hashes are useless
    without the key (prevents rainbow-table attacks on leaked DB).

    Args:
        token: Plain refresh token

    Returns:
        Hex-encoded HMAC-SHA256 hash
    """
    import hmac

    key_bytes = settings.secret_key.encode('utf-8')
    return hmac.new(key_bytes, token.encode('utf-8'), hashlib.sha256).hexdigest()


# ============================================================================
# Password Reset Tokens
# ============================================================================


def generate_password_reset_token() -> str:
    """
    Generate a cryptographically secure password reset token.

    Returns:
        URL-safe token string (32 bytes, base64 encoded)
    """
    return secrets.token_urlsafe(32)


def hash_password_reset_token(token: str) -> str:
    """
    Hash a password reset token for storage using HMAC-SHA256.

    Args:
        token: Plain reset token

    Returns:
        Hex-encoded HMAC-SHA256 hash
    """
    import hmac

    key_bytes = settings.secret_key.encode('utf-8')
    return hmac.new(key_bytes, token.encode('utf-8'), hashlib.sha256).hexdigest()


# ============================================================================
# Email Verification Tokens
# ============================================================================


def generate_email_verification_token() -> str:
    """
    Generate a cryptographically secure email verification token.

    Returns:
        URL-safe token string (32 bytes, base64 encoded).
    """
    return secrets.token_urlsafe(32)


def hash_email_verification_token(token: str) -> str:
    """
    Hash an email verification token for storage using HMAC-SHA256.

    Args:
        token: Plain verification token.

    Returns:
        Hex-encoded HMAC-SHA256 hash.
    """
    import hmac

    key_bytes = settings.secret_key.encode('utf-8')
    return hmac.new(key_bytes, token.encode('utf-8'), hashlib.sha256).hexdigest()


# ============================================================================
# Slug Generation
# ============================================================================


def generate_org_slug(base_name: str) -> str:
    """
    Generate a URL-safe slug for an organization.
    
    Args:
        base_name: Organization name
        
    Returns:
        Slug with random suffix (e.g., "acme-corp-a1b2c3d4")
    """
    # Normalize base name
    slug_base = base_name.lower().strip()
    slug_base = ''.join(c if c.isalnum() or c in ('-', '_') else '-' for c in slug_base)
    slug_base = slug_base[:40]  # Limit length
    
    # Add random suffix for uniqueness
    suffix = secrets.token_hex(4)
    
    return f"{slug_base}-{suffix}"


# ============================================================================
# API Keys (ORG3)
# ============================================================================


def generate_api_key() -> str:
    """
    Generate a customer API key with mkey_ prefix.
    
    Format: mkey_<40 hex chars> (total 45 chars)
    
    Returns:
        API key string to be given to customer (never stored)
    """
    random_part = secrets.token_hex(20)  # 40 hex chars
    return f"mkey_{random_part}"


def hash_api_key(api_key: str) -> str:
    """
    Hash an API key for storage using HMAC-SHA256.
    
    Uses server secret as HMAC key for additional security.
    
    Args:
        api_key: Plain API key
        
    Returns:
        Hex-encoded HMAC-SHA256 hash
    """
    import hmac
    
    key_bytes = settings.secret_key.encode('utf-8')
    message_bytes = api_key.encode('utf-8')
    
    hmac_hash = hmac.new(key_bytes, message_bytes, hashlib.sha256)
    return hmac_hash.hexdigest()


def get_api_key_prefix(api_key: str) -> str:
    """
    Extract the display prefix from an API key.
    
    Returns first 8 characters (e.g., "mkey_abc").
    
    Args:
        api_key: Full API key
        
    Returns:
        First 8 characters for display purposes
    """
    return api_key[:8]
