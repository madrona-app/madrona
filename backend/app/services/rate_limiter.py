"""
Rate limiting and brute-force protection for API endpoints.

Provides:
- Simple rate limiting (per-organization sliding window)
- Auth rate limiting with progressive delays (brute-force protection)
- IP-based and email-based tracking

Uses Redis for distributed rate limiting across multiple servers,
with in-memory fallback when Redis is unavailable.
"""

import time
import logging
from collections import defaultdict
from threading import Lock
from typing import Dict, Tuple, Optional
from dataclasses import dataclass

from app.services.redis_client import get_redis_client

logger = logging.getLogger(__name__)


@dataclass
class RateLimitResult:
    """Result of a rate limit check."""
    allowed: bool
    remaining: int
    retry_after: Optional[float] = None  # Seconds until allowed (for progressive delays)
    attempts: int = 0  # Failed attempts count


class RateLimiter:
    """
    Rate limiter with per-organization sliding windows.

    Uses Redis for distributed rate limiting across multiple servers,
    with in-memory fallback when Redis is unavailable.

    Example usage:
        limiter = RateLimiter(max_requests=10, window_seconds=60)

        if not limiter.allow(organization_id="acme", endpoint="execute"):
            return {"error": "Rate limit exceeded"}, 429
    """

    # Size of the in-memory fallback dict past which a request sweeps out
    # drained keys. Comfortably above any plausible concurrent-client count,
    # so the sweep is rare and the common path stays O(1).
    _EVICT_THRESHOLD = 10_000

    def __init__(self, max_requests: int = 10, window_seconds: int = 60):
        """
        Initialize rate limiter.

        Args:
            max_requests: Maximum requests allowed per window
            window_seconds: Time window in seconds (default 60 = 1 minute)
        """
        self.max_requests = max_requests
        self.window_seconds = window_seconds

        # In-memory fallback storage
        self._requests: Dict[Tuple[str, str], list] = defaultdict(list)
        self._lock = Lock()

    def _get_redis_key(self, organization_id: str, endpoint: str) -> str:
        """Get Redis key for rate limit tracking."""
        return f"madrona:rate:org:{organization_id}:{endpoint}"

    def _allow_redis(self, organization_id: str, endpoint: str) -> bool:
        """Check rate limit using Redis sorted set."""
        redis = get_redis_client()
        if not redis.is_available():
            return None  # Signal to use fallback

        try:
            key = self._get_redis_key(organization_id, endpoint)
            now = time.time()
            cutoff = now - self.window_seconds

            # Atomic pipeline: cleanup + count + add + expire
            pipe = redis.client.pipeline()
            pipe.zremrangebyscore(key, '-inf', cutoff)  # Remove expired
            pipe.zcard(key)  # Count current
            pipe.zadd(key, {str(now): now})  # Add this request
            pipe.expire(key, self.window_seconds + 60)  # Set TTL
            results = pipe.execute()

            count = results[1]
            if count >= self.max_requests:
                # Over limit - remove the optimistically added entry
                redis.client.zrem(key, str(now))
                return False
            return True
        except Exception as e:
            logger.debug(f"Redis rate limit check failed: {e}")
            return None  # Signal to use fallback

    def _allow_memory(self, organization_id: str, endpoint: str) -> bool:
        """Check rate limit using in-memory fallback."""
        now = time.time()
        key = (organization_id, endpoint)

        with self._lock:
            # Amortized sweep: only walk the dict once it has grown past the
            # soft cap, so the common path stays O(1).
            if len(self._requests) > self._EVICT_THRESHOLD:
                self._evict_drained(now)

            timestamps = self._requests[key]
            cutoff = now - self.window_seconds
            timestamps[:] = [ts for ts in timestamps if ts > cutoff]

            if len(timestamps) >= self.max_requests:
                return False

            timestamps.append(now)
            return True

    def _evict_drained(self, now: float) -> None:
        """Drop keys whose timestamps have all aged out.

        `self._requests` is a defaultdict keyed on (identifier, endpoint), and
        the identifier is usually a client IP. Trimming a key's list in place
        never removed the key itself, so the dict grew for the lifetime of the
        worker — one entry per distinct identifier ever seen, never freed. The
        Redis path is bounded by its sorted-set TTL; this fallback is the one
        that runs when Redis is down, i.e. when the process can least afford
        it, and uvicorn runs several workers each with its own copy.
        """
        cutoff = now - self.window_seconds
        drained = [k for k, ts in self._requests.items() if not ts or ts[-1] <= cutoff]
        for k in drained:
            del self._requests[k]

    def allow(self, organization_id: str, endpoint: str) -> bool:
        """
        Check if request is allowed under rate limit.

        Tries Redis first for distributed rate limiting, falls back
        to in-memory if Redis is unavailable.

        Args:
            organization_id: Unique tenant identifier (slug or UUID)
            endpoint: Endpoint name (e.g., "execute", "republish")

        Returns:
            True if request is allowed, False if rate limit exceeded
        """
        # Try Redis first
        result = self._allow_redis(organization_id, endpoint)
        if result is not None:
            return result

        # Fall back to in-memory
        return self._allow_memory(organization_id, endpoint)

    def get_remaining(self, organization_id: str, endpoint: str) -> int:
        """
        Get remaining requests in current window.

        Args:
            organization_id: Unique tenant identifier
            endpoint: Endpoint name

        Returns:
            Number of requests remaining before rate limit
        """
        redis = get_redis_client()
        if redis.is_available():
            try:
                key = self._get_redis_key(organization_id, endpoint)
                now = time.time()
                cutoff = now - self.window_seconds

                pipe = redis.client.pipeline()
                pipe.zremrangebyscore(key, '-inf', cutoff)
                pipe.zcard(key)
                results = pipe.execute()

                count = results[1]
                return max(0, self.max_requests - count)
            except Exception as e:
                logger.debug(f"Redis get_remaining failed: {e}")

        # Fall back to in-memory
        now = time.time()
        key = (organization_id, endpoint)

        with self._lock:
            timestamps = self._requests[key]
            cutoff = now - self.window_seconds
            timestamps[:] = [ts for ts in timestamps if ts > cutoff]

            return max(0, self.max_requests - len(timestamps))

    def reset(self, organization_id: str = None, endpoint: str = None):
        """
        Reset rate limit counters.

        Args:
            organization_id: If provided, only reset this organization (all endpoints)
            endpoint: If provided with organization_id, reset specific organization+endpoint

        If no args provided, clears all counters.
        """
        # Reset in-memory
        with self._lock:
            if organization_id is None:
                self._requests.clear()
            elif endpoint is None:
                keys_to_remove = [k for k in self._requests.keys() if k[0] == organization_id]
                for key in keys_to_remove:
                    del self._requests[key]
            else:
                key = (organization_id, endpoint)
                if key in self._requests:
                    del self._requests[key]

        # Reset Redis
        redis = get_redis_client()
        if redis.is_available():
            try:
                if organization_id is None:
                    # Clear all rate limit keys
                    pattern = "madrona:rate:org:*"
                elif endpoint is None:
                    pattern = f"madrona:rate:org:{organization_id}:*"
                else:
                    # Single key
                    redis.client.delete(self._get_redis_key(organization_id, endpoint))
                    return

                # Scan and delete matching keys
                cursor = 0
                while True:
                    cursor, keys = redis.client.scan(cursor, match=pattern, count=100)
                    if keys:
                        redis.client.delete(*keys)
                    if cursor == 0:
                        break
            except Exception as e:
                logger.debug(f"Redis reset failed: {e}")


# =============================================================================
# Auth Rate Limiter with Progressive Delays
# =============================================================================


class AuthRateLimiter:
    """
    Rate limiter with progressive delays for authentication endpoints.

    Implements brute-force protection by tracking failed attempts and
    applying exponentially increasing delays. Uses Redis for distributed
    tracking with in-memory fallback.

    Delay schedule:
    - 1-3 failures: No delay
    - 4-5 failures: 5 second delay
    - 6-7 failures: 15 second delay
    - 8-9 failures: 30 second delay
    - 10+ failures: 60 second delay

    Also enforces a hard rate limit of max_requests per window.

    Example:
        limiter = AuthRateLimiter()

        result = limiter.check_rate_limit(identifier="user@example.com")
        if not result.allowed:
            return {"error": "Too many attempts", "retry_after": result.retry_after}, 429

        # After failed auth:
        limiter.record_failure("user@example.com")

        # After successful auth:
        limiter.record_success("user@example.com")
    """

    # Progressive delay schedule (attempts: delay_seconds)
    DELAY_SCHEDULE = [
        (10, 60),   # 10+ failures: 60s delay
        (8, 30),    # 8-9 failures: 30s delay
        (6, 15),    # 6-7 failures: 15s delay
        (4, 5),     # 4-5 failures: 5s delay
        (1, 0),     # 1-3 failures: no delay
    ]

    # Hard limit: absolute max requests per window
    MAX_REQUESTS = 10
    WINDOW_SECONDS = 300  # 5 minute window for hard limit

    # Lockout threshold: completely block after this many failures
    LOCKOUT_THRESHOLD = 20
    LOCKOUT_DURATION = 900  # 15 minutes

    def __init__(self):
        # In-memory fallback storage
        self._failures: Dict[str, list] = defaultdict(list)
        self._last_success: Dict[str, float] = {}
        self._lockouts: Dict[str, float] = {}
        self._requests: Dict[str, list] = defaultdict(list)
        self._lock = Lock()

    def _get_delay_for_failures(self, failure_count: int) -> float:
        """Get delay in seconds for given failure count."""
        for threshold, delay in self.DELAY_SCHEDULE:
            if failure_count >= threshold:
                return delay
        return 0

    # Redis key helpers
    def _redis_key_failures(self, identifier: str) -> str:
        return f"madrona:auth:failures:{identifier}"

    def _redis_key_lockout(self, identifier: str) -> str:
        return f"madrona:auth:lockout:{identifier}"

    def _redis_key_requests(self, identifier: str) -> str:
        return f"madrona:auth:requests:{identifier}"

    def _redis_key_last_success(self, identifier: str) -> str:
        return f"madrona:auth:success:{identifier}"

    def _check_rate_limit_redis(self, identifier: str) -> Optional[RateLimitResult]:
        """Check rate limit using Redis."""
        redis = get_redis_client()
        if not redis.is_available():
            return None

        try:
            now = time.time()
            failure_cutoff = now - self.LOCKOUT_DURATION
            request_cutoff = now - self.WINDOW_SECONDS

            # Get all data in a pipeline
            pipe = redis.client.pipeline()
            pipe.get(self._redis_key_lockout(identifier))  # Lockout timestamp
            pipe.zremrangebyscore(self._redis_key_failures(identifier), '-inf', failure_cutoff)
            pipe.zcard(self._redis_key_failures(identifier))  # Failure count
            pipe.zrange(self._redis_key_failures(identifier), -1, -1, withscores=True)  # Last failure
            pipe.zremrangebyscore(self._redis_key_requests(identifier), '-inf', request_cutoff)
            pipe.zcard(self._redis_key_requests(identifier))  # Request count
            pipe.zrange(self._redis_key_requests(identifier), 0, 0, withscores=True)  # First request
            pipe.get(self._redis_key_last_success(identifier))  # Last success
            results = pipe.execute()

            lockout_until_bytes = results[0]
            failure_count = results[2]
            last_failure_data = results[3]
            request_count = results[5]
            first_request_data = results[6]
            last_success_bytes = results[7]

            # Check lockout
            if lockout_until_bytes:
                lockout_until = float(lockout_until_bytes.decode())
                if now < lockout_until:
                    retry_after = lockout_until - now
                    logger.warning(f"Auth rate limit: {identifier} is locked out for {retry_after:.0f}s")
                    return RateLimitResult(
                        allowed=False,
                        remaining=0,
                        retry_after=retry_after,
                        attempts=failure_count,
                    )
                else:
                    # Lockout expired, remove it
                    redis.client.delete(self._redis_key_lockout(identifier))

            # Check hard rate limit
            if request_count >= self.MAX_REQUESTS:
                if first_request_data:
                    first_request_time = first_request_data[0][1]
                    retry_after = first_request_time + self.WINDOW_SECONDS - now
                else:
                    retry_after = self.WINDOW_SECONDS
                logger.warning(f"Auth rate limit: {identifier} exceeded hard limit ({request_count}/{self.MAX_REQUESTS})")
                return RateLimitResult(
                    allowed=False,
                    remaining=0,
                    retry_after=max(0, retry_after),
                    attempts=failure_count,
                )

            # Check progressive delay
            required_delay = self._get_delay_for_failures(failure_count)
            if required_delay > 0:
                last_attempt = 0
                if last_failure_data:
                    last_attempt = last_failure_data[0][1]
                if last_success_bytes:
                    last_success = float(last_success_bytes.decode())
                    if last_success > last_attempt:
                        last_attempt = last_success

                if last_attempt > 0:
                    time_since_last = now - last_attempt
                    if time_since_last < required_delay:
                        retry_after = required_delay - time_since_last
                        logger.info(f"Auth rate limit: {identifier} must wait {retry_after:.1f}s (failures: {failure_count})")
                        return RateLimitResult(
                            allowed=False,
                            remaining=self.MAX_REQUESTS - request_count,
                            retry_after=retry_after,
                            attempts=failure_count,
                        )

            # Allowed - record request
            pipe = redis.client.pipeline()
            pipe.zadd(self._redis_key_requests(identifier), {str(now): now})
            pipe.expire(self._redis_key_requests(identifier), self.WINDOW_SECONDS + 60)
            pipe.execute()

            return RateLimitResult(
                allowed=True,
                remaining=self.MAX_REQUESTS - request_count - 1,
                attempts=failure_count,
            )
        except Exception as e:
            logger.debug(f"Redis auth rate limit check failed: {e}")
            return None

    def _cleanup_old_entries(self, identifier: str, now: float) -> None:
        """Remove expired failures and requests (in-memory)."""
        cutoff = now - self.LOCKOUT_DURATION
        if identifier in self._failures:
            self._failures[identifier] = [
                ts for ts in self._failures[identifier] if ts > cutoff
            ]

        cutoff = now - self.WINDOW_SECONDS
        if identifier in self._requests:
            self._requests[identifier] = [
                ts for ts in self._requests[identifier] if ts > cutoff
            ]

    def check_rate_limit(self, identifier: str) -> RateLimitResult:
        """
        Check if request is allowed under rate limit.

        Tries Redis first, falls back to in-memory.

        Args:
            identifier: Email address or IP address

        Returns:
            RateLimitResult with allowed status and metadata
        """
        identifier = identifier.lower() if identifier else "unknown"

        # Try Redis first
        result = self._check_rate_limit_redis(identifier)
        if result is not None:
            return result

        # Fall back to in-memory
        now = time.time()

        with self._lock:
            self._cleanup_old_entries(identifier, now)

            # Check for active lockout
            if identifier in self._lockouts:
                lockout_until = self._lockouts[identifier]
                if now < lockout_until:
                    retry_after = lockout_until - now
                    logger.warning(f"Auth rate limit: {identifier} is locked out for {retry_after:.0f}s")
                    return RateLimitResult(
                        allowed=False,
                        remaining=0,
                        retry_after=retry_after,
                        attempts=len(self._failures.get(identifier, [])),
                    )
                else:
                    del self._lockouts[identifier]

            # Check hard rate limit
            requests = self._requests[identifier]
            if len(requests) >= self.MAX_REQUESTS:
                retry_after = requests[0] + self.WINDOW_SECONDS - now
                logger.warning(f"Auth rate limit: {identifier} exceeded hard limit ({len(requests)}/{self.MAX_REQUESTS})")
                return RateLimitResult(
                    allowed=False,
                    remaining=0,
                    retry_after=max(0, retry_after),
                    attempts=len(self._failures.get(identifier, [])),
                )

            # Check progressive delay
            failure_count = len(self._failures.get(identifier, []))
            required_delay = self._get_delay_for_failures(failure_count)

            if required_delay > 0:
                last_attempt = 0
                if self._failures.get(identifier):
                    last_attempt = max(self._failures[identifier])
                if self._last_success.get(identifier, 0) > last_attempt:
                    last_attempt = self._last_success[identifier]

                time_since_last = now - last_attempt
                if time_since_last < required_delay:
                    retry_after = required_delay - time_since_last
                    logger.info(f"Auth rate limit: {identifier} must wait {retry_after:.1f}s (failures: {failure_count})")
                    return RateLimitResult(
                        allowed=False,
                        remaining=self.MAX_REQUESTS - len(requests),
                        retry_after=retry_after,
                        attempts=failure_count,
                    )

            # Allowed - record request
            requests.append(now)

            return RateLimitResult(
                allowed=True,
                remaining=self.MAX_REQUESTS - len(requests),
                attempts=failure_count,
            )

    def record_failure(self, identifier: str) -> None:
        """
        Record a failed authentication attempt.

        Args:
            identifier: Email address or IP address
        """
        now = time.time()
        identifier = identifier.lower() if identifier else "unknown"

        # Try Redis first
        redis = get_redis_client()
        if redis.is_available():
            try:
                pipe = redis.client.pipeline()
                pipe.zadd(self._redis_key_failures(identifier), {str(now): now})
                pipe.expire(self._redis_key_failures(identifier), self.LOCKOUT_DURATION + 60)
                pipe.zcard(self._redis_key_failures(identifier))
                results = pipe.execute()

                failure_count = results[2]
                if failure_count >= self.LOCKOUT_THRESHOLD:
                    lockout_until = now + self.LOCKOUT_DURATION
                    redis.client.setex(
                        self._redis_key_lockout(identifier),
                        self.LOCKOUT_DURATION + 60,
                        str(lockout_until)
                    )
                    logger.warning(
                        f"Auth rate limit: {identifier} locked out for {self.LOCKOUT_DURATION}s "
                        f"after {failure_count} failures"
                    )
                return
            except Exception as e:
                logger.debug(f"Redis record_failure failed: {e}")

        # Fall back to in-memory
        with self._lock:
            self._failures[identifier].append(now)
            failure_count = len(self._failures[identifier])

            if failure_count >= self.LOCKOUT_THRESHOLD:
                lockout_until = now + self.LOCKOUT_DURATION
                self._lockouts[identifier] = lockout_until
                logger.warning(
                    f"Auth rate limit: {identifier} locked out for {self.LOCKOUT_DURATION}s "
                    f"after {failure_count} failures"
                )

    def record_success(self, identifier: str) -> None:
        """
        Record a successful authentication (resets failure count).

        Args:
            identifier: Email address or IP address
        """
        now = time.time()
        identifier = identifier.lower() if identifier else "unknown"

        # Try Redis first
        redis = get_redis_client()
        if redis.is_available():
            try:
                pipe = redis.client.pipeline()
                pipe.delete(self._redis_key_failures(identifier))
                pipe.delete(self._redis_key_lockout(identifier))
                pipe.setex(self._redis_key_last_success(identifier), self.LOCKOUT_DURATION, str(now))
                pipe.execute()
                return
            except Exception as e:
                logger.debug(f"Redis record_success failed: {e}")

        # Fall back to in-memory
        with self._lock:
            if identifier in self._failures:
                del self._failures[identifier]
            if identifier in self._lockouts:
                del self._lockouts[identifier]
            self._last_success[identifier] = now

    def get_status(self, identifier: str) -> dict:
        """Get current rate limit status for an identifier."""
        now = time.time()
        identifier = identifier.lower() if identifier else "unknown"

        # Try Redis first
        redis = get_redis_client()
        if redis.is_available():
            try:
                failure_cutoff = now - self.LOCKOUT_DURATION
                request_cutoff = now - self.WINDOW_SECONDS

                pipe = redis.client.pipeline()
                pipe.zremrangebyscore(self._redis_key_failures(identifier), '-inf', failure_cutoff)
                pipe.zcard(self._redis_key_failures(identifier))
                pipe.zremrangebyscore(self._redis_key_requests(identifier), '-inf', request_cutoff)
                pipe.zcard(self._redis_key_requests(identifier))
                pipe.get(self._redis_key_lockout(identifier))
                results = pipe.execute()

                failure_count = results[1]
                request_count = results[3]
                lockout_bytes = results[4]

                is_locked_out = False
                if lockout_bytes:
                    lockout_until = float(lockout_bytes.decode())
                    is_locked_out = now < lockout_until

                return {
                    'identifier': identifier,
                    'failures': failure_count,
                    'requests_in_window': request_count,
                    'remaining': max(0, self.MAX_REQUESTS - request_count),
                    'locked_out': is_locked_out,
                    'required_delay': self._get_delay_for_failures(failure_count),
                }
            except Exception as e:
                logger.debug(f"Redis get_status failed: {e}")

        # Fall back to in-memory
        with self._lock:
            self._cleanup_old_entries(identifier, now)

            failure_count = len(self._failures.get(identifier, []))
            request_count = len(self._requests.get(identifier, []))
            is_locked_out = (
                identifier in self._lockouts and
                now < self._lockouts[identifier]
            )

            return {
                'identifier': identifier,
                'failures': failure_count,
                'requests_in_window': request_count,
                'remaining': max(0, self.MAX_REQUESTS - request_count),
                'locked_out': is_locked_out,
                'required_delay': self._get_delay_for_failures(failure_count),
            }

    def reset(self, identifier: str = None) -> None:
        """Reset rate limit state (for testing)."""
        # Reset in-memory
        with self._lock:
            if identifier is None:
                self._failures.clear()
                self._requests.clear()
                self._lockouts.clear()
                self._last_success.clear()
            else:
                identifier = identifier.lower()
                self._failures.pop(identifier, None)
                self._requests.pop(identifier, None)
                self._lockouts.pop(identifier, None)
                self._last_success.pop(identifier, None)

        # Reset Redis
        redis = get_redis_client()
        if redis.is_available():
            try:
                if identifier is None:
                    # Clear all auth rate limit keys
                    for pattern in ["madrona:auth:failures:*", "madrona:auth:lockout:*",
                                   "madrona:auth:requests:*", "madrona:auth:success:*"]:
                        cursor = 0
                        while True:
                            cursor, keys = redis.client.scan(cursor, match=pattern, count=100)
                            if keys:
                                redis.client.delete(*keys)
                            if cursor == 0:
                                break
                else:
                    redis.client.delete(
                        self._redis_key_failures(identifier),
                        self._redis_key_lockout(identifier),
                        self._redis_key_requests(identifier),
                        self._redis_key_last_success(identifier),
                    )
            except Exception as e:
                logger.debug(f"Redis reset failed: {e}")


# =============================================================================
# Global Rate Limiter Instances
# =============================================================================

# Activation/invitation rate limiters (IP-based, use IP as organization_id key)
verify_limiter = RateLimiter(max_requests=30, window_seconds=60)        # 30/min/IP
verify_hourly_limiter = RateLimiter(max_requests=100, window_seconds=3600)  # 100/hr/IP
activate_limiter = RateLimiter(max_requests=10, window_seconds=60)      # 10/min/IP
activate_hourly_limiter = RateLimiter(max_requests=30, window_seconds=3600)  # 30/hr/IP
activate_token_limiter = RateLimiter(max_requests=5, window_seconds=60)  # 5/min/token_hash
resend_daily_limiter = RateLimiter(max_requests=5, window_seconds=86400)  # 5/day/job_id
resend_force_daily_limiter = RateLimiter(max_requests=20, window_seconds=86400)  # 20/day/job_id (force)

# Global API: 200 requests per minute per org/IP
api_limiter = RateLimiter(max_requests=200, window_seconds=60)

# Execute/republish: 10 requests per minute per tenant
execute_limiter = RateLimiter(max_requests=10, window_seconds=60)

# Auth endpoints: progressive delays with brute-force protection
auth_limiter = AuthRateLimiter()

# Public discover endpoints: 60 requests per minute per IP
discover_limiter = RateLimiter(max_requests=60, window_seconds=60)

# Legacy alias (kept for backwards compatibility)
login_limiter = RateLimiter(max_requests=5, window_seconds=60)
