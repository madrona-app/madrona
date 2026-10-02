"""
Tests for rate limiting on activation, verify, and resend-invite endpoints.

Uses in-memory rate limiter fallback (no Redis required).
"""

import pytest
from unittest.mock import patch, MagicMock
from app.services.rate_limiter import (
    verify_limiter, verify_hourly_limiter,
    activate_limiter, activate_hourly_limiter, activate_token_limiter,
    resend_daily_limiter, resend_force_daily_limiter,
)


@pytest.fixture(autouse=True)
def _disable_rate_limiting():
    """Override conftest autouse fixture — rate limit tests need real .allow()."""
    yield


@pytest.fixture(autouse=True)
def _reset_limiters():
    """Reset all activation/verify/resend limiters between tests."""
    for limiter in [
        verify_limiter, verify_hourly_limiter,
        activate_limiter, activate_hourly_limiter, activate_token_limiter,
        resend_daily_limiter, resend_force_daily_limiter,
    ]:
        limiter.reset()
    yield
    for limiter in [
        verify_limiter, verify_hourly_limiter,
        activate_limiter, activate_hourly_limiter, activate_token_limiter,
        resend_daily_limiter, resend_force_daily_limiter,
    ]:
        limiter.reset()


class TestVerifyRateLimit:
    """GET /api/invitations/<token>/verify — 30/min/IP rate limit."""

    def test_verify_returns_429_after_threshold(self):
        """After 30 requests, the 31st from the same IP should be rejected."""
        ip = "10.0.0.99"
        for i in range(30):
            assert verify_limiter.allow(organization_id=ip, endpoint="verify"), f"Request {i+1} should be allowed"

        assert not verify_limiter.allow(organization_id=ip, endpoint="verify"), "Request 31 should be rejected"

    def test_verify_different_ips_independent(self):
        """Rate limits are per-IP — different IPs have separate counters."""
        for i in range(30):
            verify_limiter.allow(organization_id="10.0.0.1", endpoint="verify")

        # First IP exhausted
        assert not verify_limiter.allow(organization_id="10.0.0.1", endpoint="verify")
        # Second IP still has quota
        assert verify_limiter.allow(organization_id="10.0.0.2", endpoint="verify")

    def test_verify_hourly_limit(self):
        """100/hr/IP limit kicks in after hourly threshold."""
        ip = "10.0.0.50"
        for i in range(100):
            assert verify_hourly_limiter.allow(organization_id=ip, endpoint="verify_hr"), f"Request {i+1} should be allowed"

        assert not verify_hourly_limiter.allow(organization_id=ip, endpoint="verify_hr"), "Request 101 should be rejected"


class TestActivateRateLimit:
    """POST /api/auth/activate — 10/min/IP + 5/min/token_hash rate limits."""

    def test_activate_returns_429_after_ip_threshold(self):
        """After 10 requests from same IP, the 11th should be rejected."""
        ip = "10.0.0.77"
        for i in range(10):
            assert activate_limiter.allow(organization_id=ip, endpoint="activate"), f"Request {i+1} should be allowed"

        assert not activate_limiter.allow(organization_id=ip, endpoint="activate"), "Request 11 should be rejected"

    def test_activate_token_limit(self):
        """5/min per token_hash prefix to prevent brute-forcing a single token."""
        token_prefix = "abc123def456"
        for i in range(5):
            assert activate_token_limiter.allow(organization_id=token_prefix, endpoint="activate_tok"), f"Request {i+1} should be allowed"

        assert not activate_token_limiter.allow(organization_id=token_prefix, endpoint="activate_tok"), "Request 6 should be rejected"

    def test_activate_hourly_limit(self):
        """30/hr/IP limit."""
        ip = "10.0.0.88"
        for i in range(30):
            assert activate_hourly_limiter.allow(organization_id=ip, endpoint="activate_hr")

        assert not activate_hourly_limiter.allow(organization_id=ip, endpoint="activate_hr")


class TestResendRateLimit:
    """POST /provision/<job_id>/resend-invite — daily caps."""

    def test_resend_daily_limit_enforced(self):
        """5/day per job_id without force."""
        job_id = "job-abc-123"
        for i in range(5):
            assert resend_daily_limiter.allow(organization_id=job_id, endpoint="resend"), f"Resend {i+1} should be allowed"

        assert not resend_daily_limiter.allow(organization_id=job_id, endpoint="resend"), "Resend 6 should be rejected"

    def test_resend_force_daily_limit_enforced(self):
        """20/day per job_id with force=true."""
        job_id = "job-def-456"
        for i in range(20):
            assert resend_force_daily_limiter.allow(organization_id=job_id, endpoint="resend_force"), f"Force resend {i+1} should be allowed"

        assert not resend_force_daily_limiter.allow(organization_id=job_id, endpoint="resend_force"), "Force resend 21 should be rejected"

    def test_resend_different_jobs_independent(self):
        """Rate limits are per-job_id."""
        for i in range(5):
            resend_daily_limiter.allow(organization_id="job-1", endpoint="resend")

        assert not resend_daily_limiter.allow(organization_id="job-1", endpoint="resend")
        assert resend_daily_limiter.allow(organization_id="job-2", endpoint="resend")


