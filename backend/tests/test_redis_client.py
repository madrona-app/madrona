"""
Tests for Redis client utility.

Tests both Redis-enabled and fallback behaviors.
"""

import pytest
from unittest.mock import patch, MagicMock


@pytest.fixture(autouse=True)
def _disable_rate_limiting():
    """Override conftest autouse fixture — Redis rate limiter tests need real .allow()."""
    yield


class TestRedisClientCreation:
    """Tests for RedisClient initialization and configuration."""

    def test_redis_client_singleton(self, app):
        """Test that get_redis_client returns singleton instance."""
        from app.services.redis_client import get_redis_client, _redis_client

        # Reset singleton
        with patch("app.services.redis_client._redis_client", None):
            client1 = get_redis_client()
            client2 = get_redis_client()
            assert client1 is client2

    def test_redis_client_disabled_via_config(self, app):
        """Test that Redis client is disabled when cache_enabled is False."""
        from app.services.redis_client import RedisClient

        client = RedisClient(
            redis_url="redis://localhost:6379/0",
            cache_enabled=False
        )
        assert not client.is_available()


class TestRedisClientWithFakeredis:
    """Tests for Redis operations using fakeredis."""

    def test_is_available_with_mock_redis(self, mock_redis):
        """Test that mock Redis reports as available."""
        from app.services.redis_client import get_redis_client

        redis = get_redis_client()
        assert redis.is_available()

    def test_basic_set_get(self, mock_redis):
        """Test basic Redis set/get operations."""
        from app.services.redis_client import get_redis_client

        redis = get_redis_client()
        redis.client.set("test:key", "test_value")
        result = redis.client.get("test:key")
        assert result == b"test_value"

    def test_hash_operations(self, mock_redis):
        """Test Redis hash operations."""
        from app.services.redis_client import get_redis_client

        redis = get_redis_client()
        redis.client.hset("test:hash", mapping={
            "field1": "value1",
            "field2": "value2"
        })
        result = redis.client.hget("test:hash", "field1")
        assert result == b"value1"

    def test_sorted_set_operations(self, mock_redis):
        """Test Redis sorted set operations (used for rate limiting)."""
        from app.services.redis_client import get_redis_client
        import time

        redis = get_redis_client()
        now = time.time()

        # Add timestamps to sorted set
        redis.client.zadd("test:zset", {str(now): now, str(now - 10): now - 10})

        # Count members in range
        count = redis.client.zcount("test:zset", now - 60, now + 1)
        assert count == 2

    def test_set_nx_operation(self, mock_redis):
        """Test SET NX (only if not exists) operation."""
        from app.services.redis_client import get_redis_client

        redis = get_redis_client()

        # First set should succeed
        result1 = redis.client.set("test:lock", "1", nx=True, ex=60)
        assert result1 is True

        # Second set should fail (key exists)
        result2 = redis.client.set("test:lock", "1", nx=True, ex=60)
        assert result2 is None

    def test_pipeline_operations(self, mock_redis):
        """Test Redis pipeline for atomic operations."""
        from app.services.redis_client import get_redis_client

        redis = get_redis_client()
        pipe = redis.client.pipeline()
        pipe.set("test:pipe1", "value1")
        pipe.set("test:pipe2", "value2")
        pipe.get("test:pipe1")
        results = pipe.execute()

        assert results[0] is True  # SET result
        assert results[1] is True  # SET result
        assert results[2] == b"value1"  # GET result


class TestRedisClientFallback:
    """Tests for graceful fallback when Redis is unavailable."""

    def test_is_available_returns_false(self, disabled_redis):
        """Test that disabled Redis reports as unavailable."""
        from app.services.redis_client import get_redis_client

        redis = get_redis_client()
        assert not redis.is_available()


class TestRateLimiterWithRedis:
    """Tests for rate limiter with Redis backend."""

    def test_rate_limiter_uses_redis(self, app, mock_redis):
        """Test that rate limiter uses Redis when available."""
        from app.services.rate_limiter import RateLimiter

        limiter = RateLimiter(max_requests=5, window_seconds=60)
        org_id = "test-org"

        # Make 5 requests (should all succeed)
        for _ in range(5):
            allowed = limiter.allow(org_id, "test_endpoint")
            assert allowed

        # 6th request should be rate limited
        allowed = limiter.allow(org_id, "test_endpoint")
        assert not allowed

    def test_rate_limiter_fallback_to_memory(self, app, disabled_redis):
        """Test that rate limiter falls back to in-memory when Redis unavailable."""
        from app.services.rate_limiter import RateLimiter

        limiter = RateLimiter(max_requests=5, window_seconds=60)
        org_id = "test-org"

        # Should still work with in-memory fallback
        allowed = limiter.allow(org_id, "test_endpoint")
        assert allowed


class TestSchedulerWithRedis:
    """Tests for scheduler Redis integration."""

    def test_dedup_lock_acquisition(self, app, mock_redis):
        """Test that scheduler can acquire dedup locks."""
        from app.services.scheduler import _try_acquire_dedup_lock
        from datetime import datetime
        from uuid import uuid4

        schedule_id = uuid4()
        scheduled_for = datetime(2026, 1, 15, 12, 0, 0)

        # First acquisition should succeed
        result1 = _try_acquire_dedup_lock(schedule_id, scheduled_for)
        assert result1 is True

        # Second acquisition should fail (lock held)
        result2 = _try_acquire_dedup_lock(schedule_id, scheduled_for)
        assert result2 is False

    def test_dedup_lock_fallback(self, app, disabled_redis):
        """Test that scheduler returns None when Redis unavailable."""
        from app.services.scheduler import _try_acquire_dedup_lock
        from datetime import datetime
        from uuid import uuid4

        schedule_id = uuid4()
        scheduled_for = datetime(2026, 1, 15, 12, 0, 0)

        # Should return None (fall back to DB dedup)
        result = _try_acquire_dedup_lock(schedule_id, scheduled_for)
        assert result is None

    def test_last_job_cache(self, app, mock_redis):
        """Test caching and retrieving last job time."""
        from app.services.scheduler import (
            _cache_last_job_time,
            _get_cached_last_job_time
        )
        from datetime import datetime
        from uuid import uuid4

        schedule_id = uuid4()
        job_id = uuid4()
        scheduled_for = datetime(2026, 1, 15, 12, 0, 0)

        # Cache the job time
        _cache_last_job_time(schedule_id, scheduled_for, job_id)

        # Retrieve it
        result = _get_cached_last_job_time(schedule_id)
        assert result == scheduled_for
