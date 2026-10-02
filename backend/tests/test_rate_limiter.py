"""
Unit tests for rate limiter service.

Tests basic rate limiting logic, window expiry, per-organization isolation,
and endpoint integration. Uses in-memory fallback by mocking Redis as
unavailable, ensuring pure in-memory logic is tested.
"""

import time
import threading
import pytest
from unittest.mock import patch, MagicMock

from app.services.rate_limiter import RateLimiter


@pytest.fixture(autouse=True)
def _disable_rate_limiting():
    """Override conftest autouse fixture — rate limiter tests need real .allow()."""
    yield


@pytest.fixture(autouse=True)
def disable_redis():
    """Disable Redis for all rate limiter tests to force in-memory fallback."""
    mock_client = MagicMock()
    mock_client.is_available.return_value = False
    with patch("app.services.rate_limiter.get_redis_client", return_value=mock_client):
        yield


class TestRateLimiterBasics:
    """Test core rate limiting logic."""

    def test_allows_requests_under_limit(self):
        """Requests under the limit should be allowed."""
        limiter = RateLimiter(max_requests=3, window_seconds=60)

        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is True

    def test_rejects_requests_over_limit(self):
        """Requests exceeding the limit should be rejected."""
        limiter = RateLimiter(max_requests=2, window_seconds=60)

        # First 2 allowed
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is True

        # Third rejected
        assert limiter.allow(organization_id="acme", endpoint="execute") is False

    def test_different_organizations_independent(self):
        """Rate limits should be per-organization."""
        limiter = RateLimiter(max_requests=2, window_seconds=60)

        # Org A uses its limit
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is False

        # Org B has independent limit
        assert limiter.allow(organization_id="initech", endpoint="execute") is True
        assert limiter.allow(organization_id="initech", endpoint="execute") is True
        assert limiter.allow(organization_id="initech", endpoint="execute") is False

    def test_different_endpoints_independent(self):
        """Rate limits should be per-endpoint."""
        limiter = RateLimiter(max_requests=2, window_seconds=60)

        # Execute endpoint uses its limit
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is False

        # Republish endpoint has independent limit
        assert limiter.allow(organization_id="acme", endpoint="republish") is True
        assert limiter.allow(organization_id="acme", endpoint="republish") is True
        assert limiter.allow(organization_id="acme", endpoint="republish") is False


class TestRateLimiterWindowExpiry:
    """Test sliding window expiration."""

    def test_window_expiry_allows_new_requests(self):
        """Requests should be allowed after window expires."""
        limiter = RateLimiter(max_requests=2, window_seconds=1)  # 1 second window

        # Use up limit
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is False

        # Wait for window to expire
        time.sleep(1.1)

        # Should be allowed again
        assert limiter.allow(organization_id="acme", endpoint="execute") is True

    def test_partial_window_expiry(self):
        """Only expired requests should be removed from window."""
        limiter = RateLimiter(max_requests=3, window_seconds=1)

        # First 2 requests
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is True

        # Wait for first 2 to expire
        time.sleep(1.1)

        # Third request (within new window)
        assert limiter.allow(organization_id="acme", endpoint="execute") is True

        # Should have 2 more slots (previous 2 expired)
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="execute") is True

        # Now at limit
        assert limiter.allow(organization_id="acme", endpoint="execute") is False


class TestRateLimiterHelpers:
    """Test helper methods."""

    def test_get_remaining(self):
        """Should correctly report remaining requests."""
        limiter = RateLimiter(max_requests=5, window_seconds=60)

        assert limiter.get_remaining(organization_id="acme", endpoint="execute") == 5

        limiter.allow(organization_id="acme", endpoint="execute")
        assert limiter.get_remaining(organization_id="acme", endpoint="execute") == 4

        limiter.allow(organization_id="acme", endpoint="execute")
        limiter.allow(organization_id="acme", endpoint="execute")
        assert limiter.get_remaining(organization_id="acme", endpoint="execute") == 2

    def test_reset_all(self):
        """Should clear all counters."""
        limiter = RateLimiter(max_requests=2, window_seconds=60)

        # Use up limits for multiple orgs/endpoints
        limiter.allow(organization_id="acme", endpoint="execute")
        limiter.allow(organization_id="acme", endpoint="execute")
        limiter.allow(organization_id="initech", endpoint="republish")
        limiter.allow(organization_id="initech", endpoint="republish")

        # Reset all
        limiter.reset()

        # All limits restored
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="initech", endpoint="republish") is True

    def test_reset_organization(self):
        """Should clear counters for specific organization."""
        limiter = RateLimiter(max_requests=2, window_seconds=60)

        # Use up limits for both orgs
        limiter.allow(organization_id="acme", endpoint="execute")
        limiter.allow(organization_id="acme", endpoint="execute")
        limiter.allow(organization_id="initech", endpoint="execute")
        limiter.allow(organization_id="initech", endpoint="execute")

        # Reset only acme
        limiter.reset(organization_id="acme")

        # Acme restored, initech still limited
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="initech", endpoint="execute") is False

    def test_reset_organization_endpoint(self):
        """Should clear counter for specific organization+endpoint."""
        limiter = RateLimiter(max_requests=2, window_seconds=60)

        # Use up limits for same org, different endpoints
        limiter.allow(organization_id="acme", endpoint="execute")
        limiter.allow(organization_id="acme", endpoint="execute")
        limiter.allow(organization_id="acme", endpoint="republish")
        limiter.allow(organization_id="acme", endpoint="republish")

        # Reset only execute
        limiter.reset(organization_id="acme", endpoint="execute")

        # Execute restored, republish still limited
        assert limiter.allow(organization_id="acme", endpoint="execute") is True
        assert limiter.allow(organization_id="acme", endpoint="republish") is False


class TestRateLimiterThreadSafety:
    """Test thread safety (basic validation)."""

    def test_concurrent_requests_dont_exceed_limit(self):
        """Multiple concurrent requests should not exceed limit."""
        limiter = RateLimiter(max_requests=10, window_seconds=60)
        results = []
        lock = threading.Lock()

        def make_request():
            result = limiter.allow(organization_id="acme", endpoint="execute")
            with lock:
                results.append(result)

        # Make 15 concurrent requests (limit is 10)
        threads = [threading.Thread(target=make_request) for _ in range(15)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        # Exactly 10 should be allowed
        assert sum(results) == 10
