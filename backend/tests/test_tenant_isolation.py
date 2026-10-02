"""
Unit tests for cross-tenant authorization enforcement.

Tests the get_authorized_org_id helper and verifies that query-param org_id
cannot be used to bypass the authorized org context.

Run with:
    cd backend && ./venv/bin/python -m pytest tests/test_tenant_isolation.py -v
"""

import pytest
from unittest.mock import MagicMock
from uuid import uuid4, UUID

from fastapi import HTTPException

from app.fastapi_app.dependencies.auth import AuthContext, get_authorized_org_id


def _make_auth(active_org_id: UUID | None = None) -> AuthContext:
    """Create a minimal AuthContext for testing."""
    return AuthContext(
        user_id=uuid4(),
        email="test@example.com",
        active_organization_id=active_org_id,
        mfa_verified=False,
        mfa_at=None,
    )


def _make_request(path_params: dict | None = None, query_params: dict | None = None) -> MagicMock:
    """Create a minimal Request mock."""
    request = MagicMock()
    request.path_params = path_params or {}
    request.query_params = query_params or {}
    return request


class TestGetAuthorizedOrgId:
    """Tests for the centralized org context validation helper."""

    def test_path_param_org_id_takes_priority(self):
        """Path-param org_id is trusted (already validated by require_permission)."""
        org_id = uuid4()
        request = _make_request(path_params={"org_id": str(org_id)})
        auth = _make_auth(active_org_id=uuid4())  # different active org

        result = get_authorized_org_id(request, auth, query_org_id=uuid4())
        assert result == org_id

    def test_query_org_id_matching_active_org_passes(self):
        """Query org_id that matches active_organization_id is allowed."""
        org_id = uuid4()
        request = _make_request()
        auth = _make_auth(active_org_id=org_id)

        result = get_authorized_org_id(request, auth, query_org_id=org_id)
        assert result == org_id

    def test_query_org_id_mismatching_active_org_raises_403(self):
        """Query org_id that differs from active_organization_id is blocked."""
        org_a = uuid4()
        org_b = uuid4()
        request = _make_request()
        auth = _make_auth(active_org_id=org_a)

        with pytest.raises(HTTPException) as exc_info:
            get_authorized_org_id(request, auth, query_org_id=org_b)
        assert exc_info.value.status_code == 403

    def test_string_query_org_id_is_parsed(self):
        """String org_id from Query params is properly parsed to UUID."""
        org_id = uuid4()
        request = _make_request()
        auth = _make_auth(active_org_id=org_id)

        result = get_authorized_org_id(request, auth, query_org_id=str(org_id))
        assert result == org_id

    def test_no_query_org_id_falls_back_to_active(self):
        """When no query org_id provided, uses active_organization_id."""
        org_id = uuid4()
        request = _make_request()
        auth = _make_auth(active_org_id=org_id)

        result = get_authorized_org_id(request, auth)
        assert result == org_id

    def test_no_org_context_at_all_raises_400(self):
        """When no org_id available anywhere, raises 400."""
        request = _make_request()
        auth = _make_auth(active_org_id=None)

        with pytest.raises(HTTPException) as exc_info:
            get_authorized_org_id(request, auth)
        assert exc_info.value.status_code == 400

    def test_path_param_organization_id_variant(self):
        """organization_id path param variant also works."""
        org_id = uuid4()
        request = _make_request(path_params={"organization_id": str(org_id)})
        auth = _make_auth(active_org_id=uuid4())

        result = get_authorized_org_id(request, auth)
        assert result == org_id

    def test_none_query_org_id_falls_back(self):
        """Explicitly passing None as query_org_id falls back to active org."""
        org_id = uuid4()
        request = _make_request()
        auth = _make_auth(active_org_id=org_id)

        result = get_authorized_org_id(request, auth, query_org_id=None)
        assert result == org_id
