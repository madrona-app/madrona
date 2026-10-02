"""
Smoke tests for the Exhibition Budget API.

Routes under /api/organizations/<org_id>/exhibit/exhibitions/<exhibition_id>/budget.
Tests cover CRUD operations, auth enforcement, and edge cases.
"""

import json
from uuid import uuid4

import pytest

from app.models import (
    ExhibitionBudgetLine,
    BudgetCategory,
    BudgetLinkEntityType,
    Exhibition,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _create_exhibition(db_session, org):
    """Create a minimal Exhibition row for budget tests.

    Must explicitly set status and exhibition_type because SQLite does not
    process PostgreSQL-style server_default values.
    """
    exhibition = Exhibition(
        organization_id=org.organization_id,
        title="Test Exhibition",
        exhibition_type="temporary",
        status="proposed",
    )
    db_session.add(exhibition)
    db_session.commit()
    return exhibition


# ---------------------------------------------------------------------------
# List Budget Lines
# ---------------------------------------------------------------------------


class TestListBudgetLines:
    def test_list_empty(self, auth_setup, db_session):
        """GET returns empty list and zero totals when no lines exist."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["lines"] == []
        assert data["totals"]["line_count"] == 0
        assert data["totals"]["total_estimated"] == 0
        assert data["currency_code"] == "USD"

    def test_list_with_data(self, auth_setup, db_session):
        """GET returns created budget lines."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        _post_json(auth_client, url, {
            "description": "Crate shipping",
            "category": "shipping",
            "estimated_amount": 1500,
        })
        _post_json(auth_client, url, {
            "description": "Liability coverage",
            "category": "insurance",
            "estimated_amount": 3000,
        })

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["lines"]) == 2
        assert data["totals"]["line_count"] == 2
        assert data["totals"]["total_estimated"] == 4500.0

    def test_list_exhibition_not_found(self, auth_setup, db_session):
        """GET returns 404 when the exhibition does not exist."""
        auth_client, org, _ = auth_setup
        fake_id = uuid4()
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{fake_id}/budget"

        resp = auth_client.get(url)
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Create Budget Line
# ---------------------------------------------------------------------------


class TestCreateBudgetLine:
    def test_create_minimal(self, auth_setup, db_session):
        """POST with only description succeeds; category defaults to 'other'."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        resp = _post_json(auth_client, url, {"description": "Miscellaneous"})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["description"] == "Miscellaneous"
        assert data["category"] == "other"
        assert "line_id" in data

    def test_create_full(self, auth_setup, db_session):
        """POST with all fields populates correctly."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        payload = {
            "description": "International freight",
            "category": "shipping",
            "estimated_amount": 5000.50,
            "actual_amount": 4800.00,
            "vendor": "ArtPack Ltd.",
            "notes": "Includes customs duties",
            "currency_code": "EUR",
        }
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["category"] == "shipping"
        assert data["estimated_amount"] == 5000.50
        assert data["actual_amount"] == 4800.00
        assert data["vendor"] == "ArtPack Ltd."
        assert data["currency_code"] == "EUR"

    def test_create_missing_description(self, auth_setup, db_session):
        """POST without description returns 400."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        resp = _post_json(auth_client, url, {"category": "shipping"})
        assert resp.status_code in (400, 422)

    def test_create_invalid_category(self, auth_setup, db_session):
        """POST with unknown category returns 400."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        resp = _post_json(auth_client, url, {
            "description": "Test",
            "category": "not_a_real_category",
        })
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Get Budget Line by ID
# ---------------------------------------------------------------------------


class TestGetBudgetLine:
    def test_get_by_id(self, auth_setup, db_session):
        """GET /<line_id> returns the correct budget line."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        base_url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        create_resp = _post_json(auth_client, base_url, {
            "description": "Framing materials",
            "category": "mounts",
            "estimated_amount": 800,
        })
        line_id = create_resp.get_json()["line_id"]

        resp = auth_client.get(f"{base_url}/{line_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["line_id"] == line_id
        assert data["description"] == "Framing materials"

    def test_get_not_found(self, auth_setup, db_session):
        """GET with a non-existent line_id returns 404."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget/{uuid4()}"

        resp = auth_client.get(url)
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Update Budget Line (PATCH)
# ---------------------------------------------------------------------------


class TestUpdateBudgetLine:
    def test_update_fields(self, auth_setup, db_session):
        """PATCH updates the specified fields and leaves others unchanged."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        base_url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        create_resp = _post_json(auth_client, base_url, {
            "description": "Old description",
            "category": "travel",
            "estimated_amount": 1000,
        })
        line_id = create_resp.get_json()["line_id"]

        resp = _patch_json(auth_client, f"{base_url}/{line_id}", {
            "description": "Updated description",
            "actual_amount": 950,
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["description"] == "Updated description"
        assert data["actual_amount"] == 950.0
        # Unchanged field should persist
        assert data["category"] == "travel"
        assert data["estimated_amount"] == 1000.0

    def test_update_not_found(self, auth_setup, db_session):
        """PATCH on a non-existent line returns 404."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget/{uuid4()}"

        resp = _patch_json(auth_client, url, {"description": "nope"})
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Delete Budget Line
# ---------------------------------------------------------------------------


class TestDeleteBudgetLine:
    def test_delete(self, auth_setup, db_session):
        """DELETE removes the budget line and returns 204."""
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        base_url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        create_resp = _post_json(auth_client, base_url, {"description": "To be deleted"})
        line_id = create_resp.get_json()["line_id"]

        resp = auth_client.delete(f"{base_url}/{line_id}")
        assert resp.status_code == 204

        # Confirm it is gone
        resp = auth_client.get(f"{base_url}/{line_id}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Authorization
# ---------------------------------------------------------------------------


class TestBudgetAuth:
    def test_list_requires_auth(self, client, auth_setup, db_session):
        """Bare client (no token) gets 401 on GET."""
        _, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        resp = client.get(url)
        assert resp.status_code == 401

    def test_create_requires_auth(self, client, auth_setup, db_session):
        """Bare client (no token) gets 401 on POST."""
        _, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        url = f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/budget"

        resp = client.post(
            url,
            data=json.dumps({"description": "Unauthorized"}),
            content_type="application/json",
        )
        assert resp.status_code == 401
