"""
Session caching helpers for Redis-backed session data.

Extracted from app/api/auth.py for reuse across Flask and FastAPI.
"""

import logging
import uuid
from datetime import datetime, timezone

import redis as redis_lib

from app.services.redis_client import get_redis_client

logger = logging.getLogger(__name__)

# Maximum TTL for session cache (1 hour, or token remaining time if less)
SESSION_CACHE_MAX_TTL = 3600


def _get_session_cache_key(token_hash: str) -> str:
    """Get Redis key for session cache."""
    # Use first 32 chars of hash for key safety
    return f"madrona:session:{token_hash[:32]}"


def get_cached_session(token_hash: str) -> dict | None:
    """
    Get session data from Redis cache.

    Returns:
        dict with user_id, active_organization_id, expires_at, mfa fields
        or None if not cached
    """
    redis = get_redis_client()
    if not redis.is_available():
        return None

    try:
        key = _get_session_cache_key(token_hash)
        cached = redis.client.hgetall(key)

        if not cached:
            return None

        # Validate not expired
        expires_at_str = cached.get(b'expires_at', b'').decode()
        if expires_at_str:
            expires_at = datetime.fromisoformat(expires_at_str)
            if datetime.now(timezone.utc) > expires_at:
                redis.client.delete(key)
                return None

        return {
            'user_id': uuid.UUID(cached[b'user_id'].decode()),
            'active_organization_id': uuid.UUID(cached[b'active_organization_id'].decode()) if cached.get(b'active_organization_id') and cached[b'active_organization_id'] != b'' else None,
            'expires_at': datetime.fromisoformat(expires_at_str) if expires_at_str else None,
            'mfa_verified': cached.get(b'mfa_verified', b'0') == b'1',
            'mfa_method': cached.get(b'mfa_method', b'').decode() or None,
            'mfa_at': datetime.fromisoformat(cached[b'mfa_at'].decode()) if cached.get(b'mfa_at') and cached[b'mfa_at'] != b'' else None,
        }
    except (redis_lib.RedisError, KeyError, ValueError) as e:
        logger.debug(f"Failed to get cached session: {e}")
        return None


def cache_session(token_hash: str, token_record) -> None:
    """
    Cache session data in Redis.

    Args:
        token_hash: The hashed refresh token
        token_record: The RefreshToken database record (or any object with
                      user_id, active_organization_id, expires_at,
                      mfa_verified, mfa_method, mfa_at attributes)
    """
    redis = get_redis_client()
    if not redis.is_available():
        return

    try:
        key = _get_session_cache_key(token_hash)

        # Calculate TTL (min of remaining time or max cache TTL)
        now = datetime.now(timezone.utc)
        expires_at = token_record.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        remaining_seconds = int((expires_at - now).total_seconds())
        ttl = min(remaining_seconds, SESSION_CACHE_MAX_TTL)

        if ttl <= 0:
            return

        # Prepare data
        mfa_at_str = ''
        if token_record.mfa_at:
            mfa_at = token_record.mfa_at
            if mfa_at.tzinfo is None:
                mfa_at = mfa_at.replace(tzinfo=timezone.utc)
            mfa_at_str = mfa_at.isoformat()

        pipe = redis.client.pipeline()
        pipe.hset(key, mapping={
            'user_id': str(token_record.user_id),
            'active_organization_id': str(token_record.active_organization_id) if token_record.active_organization_id else '',
            'expires_at': expires_at.isoformat(),
            'mfa_verified': '1' if token_record.mfa_verified else '0',
            'mfa_method': token_record.mfa_method or '',
            'mfa_at': mfa_at_str,
        })
        pipe.expire(key, ttl)
        pipe.execute()
        logger.debug(f"Cached session for {token_hash[:8]}... (TTL: {ttl}s)")
    except redis_lib.RedisError as e:
        logger.debug(f"Failed to cache session: {e}")


def invalidate_session_cache(token_hash: str) -> None:
    """
    Invalidate session cache entry.

    Args:
        token_hash: The hashed refresh token
    """
    redis = get_redis_client()
    if not redis.is_available():
        return

    try:
        key = _get_session_cache_key(token_hash)
        redis.client.delete(key)
        logger.debug(f"Invalidated session cache for {token_hash[:8]}...")
    except redis_lib.RedisError as e:
        logger.debug(f"Failed to invalidate session cache: {e}")
