"""
Smoke tests for the Shipments API.

Routes under /api/organizations/<org_id>/collections/shipments.
Tests cover CRUD operations, auth enforcement, not-found handling, filtering, and status updates.
"""

import json
from uuid import uuid4

import pytest

from app.models import Shipment, ShipmentStatusHistory


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _create_shipment(db_session, org, **overrides):
    """Create a shipment row directly in the DB."""
    defaults = dict(
        organization_id=org.organization_id,
        shipment_number="SHP-001",
        shipment_type="outbound",
        direction="outbound",
        status="draft",
    )
    defaults.update(overrides)
    shipment = Shipment(**defaults)
    db_session.add(shipment)
    db_session.commit()
    return shipment


def _shipments_url(org):
    """Build the shipments list/create URL."""
    return f"/api/organizations/{org.organization_id}/collections/shipments"


def _shipment_url(org, shipment):
    """Build the single-shipment URL."""
    return f"/api/organizations/{org.organization_id}/collections/shipments/{shipment.shipment_id}"


# ---------------------------------------------------------------------------
# List Shipments
# ---------------------------------------------------------------------------


class TestListShipments:
    def test_list_empty(self, auth_setup, db_session):
        """GET returns empty list when no shipments exist."""
        auth_client, org, _ = auth_setup
        url = _shipments_url(org)

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["summary"]["total"] == 0

    def test_list_with_data(self, auth_setup, db_session):
        """GET returns created shipments."""
        auth_client, org, _ = auth_setup
        _create_shipment(db_session, org, shipment_number="SHP-001", direction="outbound")
        _create_shipment(db_session, org, shipment_number="SHP-002", direction="inbound")
        url = _shipments_url(org)

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 2
        assert data["summary"]["total"] == 2

    def test_list_filter_by_direction(self, auth_setup, db_session):
        """GET with ?direction= filters shipments."""
        auth_client, org, _ = auth_setup
        _create_shipment(db_session, org, direction="inbound", shipment_number="SHP-IN")
        _create_shipment(db_session, org, direction="outbound", shipment_number="SHP-OUT")
        url = _shipments_url(org)

        resp = auth_client.get(f"{url}?direction=inbound")
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 1
        assert data["items"][0]["direction"] == "inbound"


# ---------------------------------------------------------------------------
# Create Shipment
# ---------------------------------------------------------------------------


class TestCreateShipment:
    def test_create_minimal(self, auth_setup, db_session):
        """POST with minimal payload creates a shipment with defaults."""
        auth_client, org, _ = auth_setup
        url = _shipments_url(org)

        resp = _post_json(auth_client, url, {"shipment_type": "outbound"})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["status"] == "draft"
        assert data["shipment_number"]  # auto-generated

    def test_create_with_details(self, auth_setup, db_session):
        """POST with full payload persists all fields."""
        auth_client, org, _ = auth_setup
        url = _shipments_url(org)

        payload = {
            "shipment_type": "outbound",
            "direction": "inbound",
            "purpose": "exhibition",
            "remarks": "Fragile items",
        }
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["direction"] == "inbound"
        assert data["purpose"] == "exhibition"
        assert data["remarks"] == "Fragile items"

    def test_create_invalid_direction(self, auth_setup, db_session):
        """POST with invalid direction returns 400."""
        auth_client, org, _ = auth_setup
        url = _shipments_url(org)

        resp = _post_json(auth_client, url, {"shipment_type": "outbound", "direction": "sideways"})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "direction" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()

    def test_create_invalid_status(self, auth_setup, db_session):
        """POST with invalid status returns 400."""
        auth_client, org, _ = auth_setup
        url = _shipments_url(org)

        resp = _post_json(auth_client, url, {"shipment_type": "outbound", "status": "flying"})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "status" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()


# ---------------------------------------------------------------------------
# Get Shipment
# ---------------------------------------------------------------------------


class TestGetShipment:
    def test_get_by_id(self, auth_setup, db_session):
        """GET single shipment returns full serialization with relations."""
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org, shipment_type="courier_delivery")
        url = _shipment_url(org, shipment)

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["shipment_id"] == str(shipment.shipment_id)
        assert data["shipment_type"] == "courier_delivery"
        # Full serialization includes relation arrays
        assert "items" in data
        assert "legs" in data
        assert "references" in data
        assert "documents" in data
        assert "status_history" in data

    def test_get_not_found(self, auth_setup, db_session):
        """GET with nonexistent shipment_id returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"/api/organizations/{org.organization_id}/collections/shipments/{fake_id}"

        resp = auth_client.get(url)
        assert resp.status_code == 404
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "not found" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()


# ---------------------------------------------------------------------------
# Update Shipment
# ---------------------------------------------------------------------------


class TestUpdateShipment:
    def test_update_fields(self, auth_setup, db_session):
        """PATCH updates specified fields."""
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        url = _shipment_url(org, shipment)

        resp = _patch_json(auth_client, url, {
            "remarks": "Updated remarks",
            "purpose": "loan",
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["remarks"] == "Updated remarks"
        assert data["purpose"] == "loan"

    def test_update_not_found(self, auth_setup, db_session):
        """PATCH on nonexistent shipment returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"/api/organizations/{org.organization_id}/collections/shipments/{fake_id}"

        resp = _patch_json(auth_client, url, {"remarks": "X"})
        assert resp.status_code == 404

    def test_update_invalid_direction(self, auth_setup, db_session):
        """PATCH with invalid direction returns 400."""
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        url = _shipment_url(org, shipment)

        resp = _patch_json(auth_client, url, {"direction": "diagonal"})
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Delete Shipment
# ---------------------------------------------------------------------------


class TestDeleteShipment:
    def test_delete(self, auth_setup, db_session):
        """DELETE removes the shipment and returns 204."""
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        url = _shipment_url(org, shipment)

        resp = auth_client.delete(url)
        assert resp.status_code == 204

        # Confirm gone
        remaining = db_session.query(Shipment).filter(
            Shipment.shipment_id == shipment.shipment_id
        ).first()
        assert remaining is None

    def test_delete_not_found(self, auth_setup, db_session):
        """DELETE on nonexistent shipment returns 404."""
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"/api/organizations/{org.organization_id}/collections/shipments/{fake_id}"

        resp = auth_client.delete(url)
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Auth Required
# ---------------------------------------------------------------------------


class TestShipmentsAuth:
    def test_list_requires_auth(self, client, auth_setup, db_session):
        """GET list without auth returns 401."""
        _, org, _ = auth_setup
        url = _shipments_url(org)

        resp = client.get(url)
        assert resp.status_code == 401

    def test_create_requires_auth(self, client, auth_setup, db_session):
        """POST without auth returns 401."""
        _, org, _ = auth_setup
        url = _shipments_url(org)

        resp = client.post(
            url,
            data=json.dumps({"shipment_type": "outbound"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_get_requires_auth(self, client, auth_setup, db_session):
        """GET single shipment without auth returns 401."""
        _, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        url = _shipment_url(org, shipment)

        resp = client.get(url)
        assert resp.status_code == 401

    def test_delete_requires_auth(self, client, auth_setup, db_session):
        """DELETE without auth returns 401."""
        _, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        url = _shipment_url(org, shipment)

        resp = client.delete(url)
        assert resp.status_code == 401
