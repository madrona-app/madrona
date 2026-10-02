"""
Centralized Redis client with graceful degradation.

Provides a unified Redis client for all caching operations with:
- Lazy initialization with connection pooling
- Cached availability checks (30s interval)
- Graceful fallback when Redis is unavailable
- Health check endpoint for monitoring

Usage:
    from app.services.redis_client import get_redis_client

    redis = get_redis_client()
    if redis.is_available():
        redis.client.set("key", "value", ex=3600)
        value = redis.client.get("key")
"""

import logging
import time
from typing import Optional

import redis
from redis import Redis
from redis.connection import ConnectionPool

logger = logging.getLogger(__name__)


class RedisClient:
    """
    Redis client wrapper with graceful degradation.

    Features:
    - Lazy connection (connects on first use)
    - Connection pooling for efficiency
    - Cached availability checks to avoid repeated connection attempts
    - Graceful degradation when Redis is unavailable
    """

    def __init__(
        self,
        redis_url: str,
        connection_pool_size: int = 10,
        cache_enabled: bool = True,
    ):
        self._redis_url = redis_url
        self._pool_size = connection_pool_size
        self._cache_enabled = cache_enabled
        self._pool: Optional[ConnectionPool] = None
        self._client: Optional[Redis] = None
        self._available: Optional[bool] = None
        self._last_check: float = 0
        self._check_interval = 30  # Re-check availability every 30s

    def _ensure_client(self) -> Optional[Redis]:
        """Lazily initialize the Redis client."""
        if not self._cache_enabled:
            return None

        if self._client is not None:
            return self._client

        try:
            self._pool = ConnectionPool.from_url(
                self._redis_url,
                max_connections=self._pool_size,
                decode_responses=False,  # Keep bytes for flexibility
            )
            self._client = Redis(connection_pool=self._pool)
            # Test connection
            self._client.ping()
            logger.info("Redis client initialized successfully")
            return self._client
        except redis.RedisError as e:
            logger.warning(f"Failed to initialize Redis client: {e}")
            self._client = None
            return None

    @property
    def client(self) -> Optional[Redis]:
        """
        Get the Redis client instance.

        Returns None if Redis is unavailable or caching is disabled.
        """
        return self._ensure_client()

    def is_available(self) -> bool:
        """
        Check if Redis is available.

        Results are cached for 30 seconds to avoid repeated connection attempts
        when Redis is down.
        """
        if not self._cache_enabled:
            return False

        now = time.time()

        # Use cached result if recent
        if self._available is not None and (now - self._last_check) < self._check_interval:
            return self._available

        # Perform availability check
        self._last_check = now

        try:
            client = self._ensure_client()
            if client is None:
                self._available = False
            else:
                client.ping()
                self._available = True
        except redis.RedisError as e:
            logger.debug(f"Redis availability check failed: {e}")
            self._available = False
            # Reset client so it can reconnect on next attempt
            self._client = None

        return self._available

    def health_check(self) -> dict:
        """
        Return health status for monitoring.

        Returns:
            dict with keys: available, url (redacted), pool_size, last_check
        """
        # Redact password from URL for security
        redacted_url = self._redis_url
        if "@" in redacted_url:
            # redis://:password@host:port/db -> redis://***@host:port/db
            parts = redacted_url.split("@")
            redacted_url = f"{parts[0].rsplit(':', 1)[0]}:***@{parts[1]}"

        return {
            "available": self.is_available(),
            "url": redacted_url,
            "pool_size": self._pool_size,
            "cache_enabled": self._cache_enabled,
            "last_check_seconds_ago": round(time.time() - self._last_check, 1) if self._last_check > 0 else None,
        }

    def close(self) -> None:
        """Close the Redis connection pool."""
        if self._client is not None:
            self._client.close()
            self._client = None
        if self._pool is not None:
            self._pool.disconnect()
            self._pool = None
        self._available = None


# Global singleton instance
_redis_client: Optional[RedisClient] = None


def get_redis_client() -> RedisClient:
    """
    Get or create the global Redis client.

    The client is lazily initialized on first use with settings from config.
    """
    global _redis_client
    if _redis_client is None:
        from app.config import get_settings
        settings = get_settings()
        _redis_client = RedisClient(
            redis_url=settings.redis_url,
            connection_pool_size=getattr(settings, 'redis_connection_pool_size', 10),
            cache_enabled=getattr(settings, 'redis_cache_enabled', True),
        )
    return _redis_client


def reset_redis_client() -> None:
    """
    Reset the global Redis client.

    Useful for testing or when configuration changes.
    """
    global _redis_client
    if _redis_client is not None:
        _redis_client.close()
        _redis_client = None
