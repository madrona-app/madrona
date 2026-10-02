"""
Coverage-focused tests for app/fastapi_app/routers/shipments.py.

Extends (not duplicates) tests/test_api_shipments.py and
tests/postgres/test_shipments.py. The existing API file covers:

    - list empty / with data / filter by direction
    - create minimal / with details / invalid direction & status
    - get 200 / 404
    - update 200 / 404 / invalid direction
    - delete 204 / 404
    - auth 401 across the basics

The model test file only exercises the ORM, not the routes.

This file fills the gaps:
    - enums endpoint
    - status transition endpoint (happy path, notifications hook,
      auto-date-fill, invalid status, 404)
    - list filter variants: q, purpose, shipment_type, reference filter
    - list pagination and summary stats
    - item CRUD (add, update, delete, duplicate-object, invalid status,
      shipment-missing, item-missing)
    - leg CRUD (add with auto-incrementing leg_number, update, delete,
      invalid shipping_method, invalid status)
    - reference CRUD (add, duplicate, invalid procedure_type, delete)
    - document CRUD (add, invalid document_type, missing media_id, delete)
    - crate CRUD (list filters, create, get, update, delete soft-delete)
    - wrong-org isolation (shipment in org B → 404 when caller is org A)
    - viewer → 403 on state-changing routes
"""

import json
from uuid import uuid4

import pytest

from app.models import (
    Shipment,
    ShipmentItem,
    ShipmentLeg,
    ShipmentReference,
    ShipmentDocument,
    Crate,
    CollectionObject,
    Organization,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _shipments_url(org):
    return f"/api/organizations/{org.organization_id}/collections/shipments"


def _shipment_url(org, shipment_id):
    return f"/api/organizations/{org.organization_id}/collections/shipments/{shipment_id}"


def _create_shipment(db_session, org, **overrides):
    defaults = dict(
        organization_id=org.organization_id,
        shipment_number=f"SHP-{uuid4().hex[:6].upper()}",
        shipment_type="outbound",
        direction="outbound",
        status="draft",
    )
    defaults.update(overrides)
    shipment = Shipment(**defaults)
    db_session.add(shipment)
    db_session.commit()
    return shipment


def _create_object(db_session, org, number=None):
    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=number or f"OBJ-{uuid4().hex[:8]}",
    )
    db_session.add(obj)
    db_session.commit()
    return obj


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class TestShipmentEnums:
    def test_enums_returns_all_buckets(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/shipments/enums"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        for key in ("shipment_types", "directions", "purposes", "statuses",
                    "item_statuses", "shipping_methods", "leg_statuses",
                    "document_types", "procedure_types", "crate_conditions"):
            assert key in data, f"missing enum bucket: {key}"
        values = [v["value"] for v in data["statuses"]]
        assert "draft" in values and "delivered" in values


# ---------------------------------------------------------------------------
# Status transition
# ---------------------------------------------------------------------------


class TestStatusTransition:
    def test_status_transition_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org, status="draft")
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/status",
            json={"status": "dispatched", "notes": "Picked up"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["old_status"] == "draft"
        assert data["new_status"] == "dispatched"
        assert data["status_label"] == "Dispatched"

        db_session.expire_all()
        refreshed = db_session.query(Shipment).filter_by(
            shipment_id=shipment.shipment_id
        ).first()
        assert refreshed.status == "dispatched"
        # Dispatched auto-fills actual_dispatch_date
        assert refreshed.actual_dispatch_date is not None

    def test_status_transition_to_delivered_fills_arrival(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org, status="dispatched")
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/status",
            json={"status": "delivered"},
        )
        assert resp.status_code == 200
        db_session.expire_all()
        refreshed = db_session.query(Shipment).filter_by(
            shipment_id=shipment.shipment_id
        ).first()
        assert refreshed.actual_arrival_date is not None

    def test_status_transition_invalid_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/status",
            json={"status": "launched"},
        )
        assert resp.status_code == 422

    def test_status_transition_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            f"{_shipment_url(org, uuid4())}/status",
            json={"status": "dispatched"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Expanded list filters / pagination
# ---------------------------------------------------------------------------


class TestListShipmentsExpanded:
    def test_list_filter_q_matches_remarks(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _create_shipment(db_session, org, shipment_number="SHP-A1", remarks="fragile crystal")
        _create_shipment(db_session, org, shipment_number="SHP-B2", remarks="oil painting")
        resp = auth_client.get(f"{_shipments_url(org)}?q=crystal")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1

    def test_list_filter_purpose_and_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _create_shipment(db_session, org, purpose="loan")
        _create_shipment(db_session, org, purpose="exhibition", shipment_type="internal_transfer")

        r1 = auth_client.get(f"{_shipments_url(org)}?purpose=loan")
        assert r1.status_code == 200
        assert r1.get_json()["total"] == 1

        r2 = auth_client.get(f"{_shipments_url(org)}?shipment_type=internal_transfer")
        assert r2.status_code == 200
        assert r2.get_json()["total"] == 1

    def test_list_filter_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _create_shipment(db_session, org, status="draft")
        _create_shipment(db_session, org, status="in_transit")
        _create_shipment(db_session, org, status="delayed")
        resp = auth_client.get(f"{_shipments_url(org)}?status=in_transit")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        # Summary counts are for the *entire* org, ignoring the filter
        assert data["summary"]["in_transit"] == 1
        assert data["summary"]["delayed"] == 1
        assert data["summary"]["total"] == 3

    def test_list_filter_reference(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        loan_id = uuid4()
        ref = ShipmentReference(
            organization_id=org.organization_id,
            shipment_id=shipment.shipment_id,
            procedure_type="loan_out",
            procedure_id=loan_id,
        )
        db_session.add(ref)
        db_session.commit()

        resp = auth_client.get(f"{_shipments_url(org)}?reference=loan_out:{loan_id}")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

    def test_list_pagination(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        for i in range(5):
            _create_shipment(db_session, org, shipment_number=f"SHP-P{i:02d}")
        resp = auth_client.get(f"{_shipments_url(org)}?limit=2&offset=0")
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 2
        assert data["total"] == 5


# ---------------------------------------------------------------------------
# Items
# ---------------------------------------------------------------------------


class TestShipmentItems:
    def test_add_item_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        obj = _create_object(db_session, org)

        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/items",
            json={
                "object_id": str(obj.object_id),
                "insurance_value": "1000.00",
                "status": "pending",
                "special_instructions": "Upright only",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["object_id"] == str(obj.object_id)
        assert data["status"] == "pending"

    def test_add_item_missing_object(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/items",
            json={},
        )
        assert resp.status_code == 422

    def test_add_item_duplicate_object(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        obj = _create_object(db_session, org)

        url = f"{_shipment_url(org, shipment.shipment_id)}/items"
        first = auth_client.post(url, json={"object_id": str(obj.object_id)})
        assert first.status_code == 201
        second = auth_client.post(url, json={"object_id": str(obj.object_id)})
        assert second.status_code == 400

    def test_add_item_invalid_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        obj = _create_object(db_session, org)
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/items",
            json={"object_id": str(obj.object_id), "status": "aboard"},
        )
        assert resp.status_code == 422

    def test_add_item_shipment_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _create_object(db_session, org)
        resp = auth_client.post(
            f"{_shipment_url(org, uuid4())}/items",
            json={"object_id": str(obj.object_id)},
        )
        assert resp.status_code == 404

    def test_update_item_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        obj = _create_object(db_session, org)
        item = ShipmentItem(
            organization_id=org.organization_id,
            shipment_id=shipment.shipment_id,
            object_id=obj.object_id,
            status="pending",
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.patch(
            f"{_shipment_url(org, shipment.shipment_id)}/items/{item.shipment_item_id}",
            json={"status": "packed", "packing_notes": "Double-boxed"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "packed"
        assert data["packing_notes"] == "Double-boxed"

    def test_update_item_invalid_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        obj = _create_object(db_session, org)
        item = ShipmentItem(
            organization_id=org.organization_id,
            shipment_id=shipment.shipment_id,
            object_id=obj.object_id,
            status="pending",
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.patch(
            f"{_shipment_url(org, shipment.shipment_id)}/items/{item.shipment_item_id}",
            json={"status": "undelivered"},
        )
        assert resp.status_code == 422

    def test_update_item_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.patch(
            f"{_shipment_url(org, shipment.shipment_id)}/items/{uuid4()}",
            json={"status": "packed"},
        )
        assert resp.status_code == 404

    def test_remove_item_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        obj = _create_object(db_session, org)
        item = ShipmentItem(
            organization_id=org.organization_id,
            shipment_id=shipment.shipment_id,
            object_id=obj.object_id,
            status="pending",
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.delete(
            f"{_shipment_url(org, shipment.shipment_id)}/items/{item.shipment_item_id}"
        )
        assert resp.status_code == 204
        assert db_session.query(ShipmentItem).filter_by(
            shipment_item_id=item.shipment_item_id
        ).first() is None

    def test_remove_item_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.delete(
            f"{_shipment_url(org, shipment.shipment_id)}/items/{uuid4()}"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Legs
# ---------------------------------------------------------------------------


class TestShipmentLegs:
    def test_add_leg_autoincrement(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        url = f"{_shipment_url(org, shipment.shipment_id)}/legs"

        r1 = auth_client.post(url, json={
            "carrier_name": "FedEx",
            "shipping_method": "ground",
        })
        assert r1.status_code == 201
        assert r1.get_json()["leg_number"] == 1

        r2 = auth_client.post(url, json={
            "carrier_name": "DHL",
            "shipping_method": "air",
        })
        assert r2.status_code == 201
        assert r2.get_json()["leg_number"] == 2

    def test_add_leg_invalid_shipping_method(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/legs",
            json={"shipping_method": "rocket"},
        )
        assert resp.status_code == 422

    def test_add_leg_invalid_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/legs",
            json={"status": "lost"},
        )
        assert resp.status_code == 422

    def test_update_leg_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        leg = ShipmentLeg(
            organization_id=org.organization_id,
            shipment_id=shipment.shipment_id,
            leg_number=1,
            carrier_name="DHL",
            status="scheduled",
        )
        db_session.add(leg)
        db_session.commit()

        resp = auth_client.patch(
            f"{_shipment_url(org, shipment.shipment_id)}/legs/{leg.leg_id}",
            json={"status": "in_transit", "tracking_number": "TRACK-42"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "in_transit"
        assert data["tracking_number"] == "TRACK-42"

    def test_update_leg_invalid_method(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        leg = ShipmentLeg(
            organization_id=org.organization_id,
            shipment_id=shipment.shipment_id,
            leg_number=1,
            status="scheduled",
        )
        db_session.add(leg)
        db_session.commit()
        resp = auth_client.patch(
            f"{_shipment_url(org, shipment.shipment_id)}/legs/{leg.leg_id}",
            json={"shipping_method": "teleport"},
        )
        assert resp.status_code == 422

    def test_remove_leg_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        leg = ShipmentLeg(
            organization_id=org.organization_id,
            shipment_id=shipment.shipment_id,
            leg_number=1,
            status="scheduled",
        )
        db_session.add(leg)
        db_session.commit()
        resp = auth_client.delete(
            f"{_shipment_url(org, shipment.shipment_id)}/legs/{leg.leg_id}"
        )
        assert resp.status_code == 204
        assert db_session.query(ShipmentLeg).filter_by(leg_id=leg.leg_id).first() is None

    def test_remove_leg_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.delete(
            f"{_shipment_url(org, shipment.shipment_id)}/legs/{uuid4()}"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# References
# ---------------------------------------------------------------------------


class TestShipmentReferences:
    def test_add_reference_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        loan_id = str(uuid4())
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/references",
            json={"procedure_type": "loan_out", "procedure_id": loan_id},
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["procedure_type"] == "loan_out"
        assert data["procedure_id"] == loan_id

    def test_add_reference_duplicate(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        loan_id = str(uuid4())
        url = f"{_shipment_url(org, shipment.shipment_id)}/references"
        auth_client.post(url, json={"procedure_type": "loan_out", "procedure_id": loan_id})
        r2 = auth_client.post(url, json={"procedure_type": "loan_out", "procedure_id": loan_id})
        assert r2.status_code == 400

    def test_add_reference_invalid_procedure_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/references",
            json={"procedure_type": "purchase", "procedure_id": str(uuid4())},
        )
        assert resp.status_code == 422

    def test_add_reference_missing_procedure_id(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/references",
            json={"procedure_type": "loan_out"},
        )
        assert resp.status_code == 422

    def test_remove_reference_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        ref = ShipmentReference(
            organization_id=org.organization_id,
            shipment_id=shipment.shipment_id,
            procedure_type="loan_out",
            procedure_id=uuid4(),
        )
        db_session.add(ref)
        db_session.commit()
        resp = auth_client.delete(
            f"{_shipment_url(org, shipment.shipment_id)}/references/{ref.reference_id}"
        )
        assert resp.status_code == 204

    def test_remove_reference_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.delete(
            f"{_shipment_url(org, shipment.shipment_id)}/references/{uuid4()}"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Documents
# ---------------------------------------------------------------------------


class TestShipmentDocuments:
    def test_add_document_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        media_id = str(uuid4())
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/documents",
            json={
                "media_id": media_id,
                "document_type": "bill_of_lading",
                "label": "BOL 2026-001",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["document_type"] == "bill_of_lading"
        assert data["document_type_label"] == "Bill of Lading"

    def test_add_document_missing_media(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/documents",
            json={"document_type": "bill_of_lading"},
        )
        assert resp.status_code == 422

    def test_add_document_invalid_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/documents",
            json={"media_id": str(uuid4()), "document_type": "manifesto"},
        )
        assert resp.status_code == 422

    def test_remove_document_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        doc = ShipmentDocument(
            organization_id=org.organization_id,
            shipment_id=shipment.shipment_id,
            media_id=uuid4(),
            document_type="packing_list",
        )
        db_session.add(doc)
        db_session.commit()

        resp = auth_client.delete(
            f"{_shipment_url(org, shipment.shipment_id)}/documents/{doc.document_id}"
        )
        assert resp.status_code == 204

    def test_remove_document_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        shipment = _create_shipment(db_session, org)
        resp = auth_client.delete(
            f"{_shipment_url(org, shipment.shipment_id)}/documents/{uuid4()}"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Crates
# ---------------------------------------------------------------------------


class TestCrates:
    def _crates_url(self, org):
        return f"/api/organizations/{org.organization_id}/collections/crates"

    def _crate_url(self, org, crate_id):
        return f"/api/organizations/{org.organization_id}/collections/crates/{crate_id}"

    def test_list_crates_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(self._crates_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []

    def test_create_crate_happy(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(self._crates_url(org), json={
            "crate_number": "CR-001",
            "description": "Large softwood crate",
            "condition": "good",
            "materials": "Pine",
            "climate_controlled": True,
        })
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["crate_number"] == "CR-001"
        assert data["condition"] == "good"
        assert data["condition_label"] == "Good"

    def test_create_crate_missing_number(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(self._crates_url(org), json={"description": "no number"})
        assert resp.status_code == 422

    def test_create_crate_invalid_condition(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(self._crates_url(org), json={
            "crate_number": "CR-BAD",
            "condition": "pristine",
        })
        assert resp.status_code == 422

    def test_create_crate_duplicate_number(self, auth_setup):
        auth_client, org, _ = auth_setup
        first = auth_client.post(self._crates_url(org), json={"crate_number": "CR-DUP"})
        assert first.status_code == 201
        dup = auth_client.post(self._crates_url(org), json={"crate_number": "CR-DUP"})
        assert dup.status_code == 409

    def test_list_crates_filters(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c1 = Crate(organization_id=org.organization_id, crate_number="CR-A",
                   condition="good", is_active=True)
        c2 = Crate(organization_id=org.organization_id, crate_number="CR-B",
                   condition="damaged", is_active=False, description="cracked")
        db_session.add_all([c1, c2])
        db_session.commit()

        # Active filter defaults to true
        resp_active = auth_client.get(self._crates_url(org))
        assert resp_active.status_code == 200
        assert resp_active.get_json()["total"] == 1

        # active=false → only inactive
        resp_inactive = auth_client.get(f"{self._crates_url(org)}?active=false")
        assert resp_inactive.get_json()["total"] == 1

        # condition filter
        resp_cond = auth_client.get(f"{self._crates_url(org)}?active=false&condition=damaged")
        assert resp_cond.get_json()["total"] == 1

        # q filter
        resp_q = auth_client.get(f"{self._crates_url(org)}?active=false&q=crack")
        assert resp_q.get_json()["total"] == 1

    def test_get_crate(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        crate = Crate(organization_id=org.organization_id, crate_number="CR-X", is_active=True)
        db_session.add(crate)
        db_session.commit()

        resp = auth_client.get(self._crate_url(org, crate.crate_id))
        assert resp.status_code == 200
        assert resp.get_json()["crate_number"] == "CR-X"

    def test_get_crate_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(self._crate_url(org, uuid4()))
        assert resp.status_code == 404

    def test_update_crate_happy(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        crate = Crate(organization_id=org.organization_id, crate_number="CR-U", is_active=True)
        db_session.add(crate)
        db_session.commit()

        resp = auth_client.patch(self._crate_url(org, crate.crate_id), json={
            "condition": "fair",
            "notes": "scuffed on side",
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["condition"] == "fair"
        assert data["notes"] == "scuffed on side"

    def test_update_crate_rename_collision(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        c1 = Crate(organization_id=org.organization_id, crate_number="CR-1", is_active=True)
        c2 = Crate(organization_id=org.organization_id, crate_number="CR-2", is_active=True)
        db_session.add_all([c1, c2])
        db_session.commit()

        resp = auth_client.patch(self._crate_url(org, c2.crate_id), json={"crate_number": "CR-1"})
        assert resp.status_code == 409

    def test_update_crate_invalid_condition(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        crate = Crate(organization_id=org.organization_id, crate_number="CR-IC", is_active=True)
        db_session.add(crate)
        db_session.commit()
        resp = auth_client.patch(self._crate_url(org, crate.crate_id), json={"condition": "perfect"})
        assert resp.status_code == 422

    def test_delete_crate_soft(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        crate = Crate(organization_id=org.organization_id, crate_number="CR-DEL", is_active=True)
        db_session.add(crate)
        db_session.commit()

        resp = auth_client.delete(self._crate_url(org, crate.crate_id))
        assert resp.status_code == 204

        db_session.expire_all()
        refreshed = db_session.query(Crate).filter_by(crate_id=crate.crate_id).first()
        # Delete is a soft-delete — row still exists but is_active is False
        assert refreshed is not None
        assert refreshed.is_active is False

    def test_delete_crate_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(self._crate_url(org, uuid4()))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Wrong-org isolation
# ---------------------------------------------------------------------------


class TestWrongOrgIsolation:
    def test_shipment_in_other_org_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        other = Organization(
            name="Other Museum", slug=f"other-{uuid4().hex[:6]}",
            is_demo=False, status="active",
        )
        db_session.add(other)
        db_session.commit()

        stranger = _create_shipment(db_session, other)
        # Caller's org mismatches the shipment's org → 404 per handler
        resp = auth_client.get(_shipment_url(org, stranger.shipment_id))
        assert resp.status_code == 404

    def test_crate_in_other_org_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        other = Organization(
            name="Another Museum", slug=f"another-{uuid4().hex[:6]}",
            is_demo=False, status="active",
        )
        db_session.add(other)
        db_session.commit()

        stranger = Crate(
            organization_id=other.organization_id,
            crate_number="CR-OTHER",
            is_active=True,
        )
        db_session.add(stranger)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}/collections/crates/{stranger.crate_id}"
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Viewer forbidden
# ---------------------------------------------------------------------------


class TestViewerForbidden:
    def test_viewer_cannot_create_shipment(self, viewer_auth_setup):
        client, org, _ = viewer_auth_setup
        resp = client.post(_shipments_url(org), json={"shipment_type": "outbound"})
        assert resp.status_code == 403

    def test_viewer_cannot_update_shipment_status(self, viewer_auth_setup, db_session):
        client, org, _ = viewer_auth_setup
        shipment = _create_shipment(db_session, org)
        resp = client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/status",
            json={"status": "dispatched"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_add_item(self, viewer_auth_setup, db_session):
        client, org, _ = viewer_auth_setup
        shipment = _create_shipment(db_session, org)
        resp = client.post(
            f"{_shipment_url(org, shipment.shipment_id)}/items",
            json={"object_id": str(uuid4())},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_delete_shipment(self, viewer_auth_setup, db_session):
        client, org, _ = viewer_auth_setup
        shipment = _create_shipment(db_session, org)
        resp = client.delete(_shipment_url(org, shipment.shipment_id))
        assert resp.status_code == 403

    def test_viewer_cannot_create_crate(self, viewer_auth_setup):
        client, org, _ = viewer_auth_setup
        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/crates",
            json={"crate_number": "CR-V"},
        )
        assert resp.status_code == 403
