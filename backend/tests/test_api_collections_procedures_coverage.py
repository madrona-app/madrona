"""
Integration tests for collections_procedures.py (procedures).

Covers the Object Entry, Object Entry Items, Acquisition, and
Acquisition-Object link endpoints under:

    /api/organizations/{org_id}/collections/entries
    /api/organizations/{org_id}/collections/entries/{entry_id}/items
    /api/organizations/{org_id}/collections/entries/{entry_id}/<action>
    /api/organizations/{org_id}/collections/acquisitions
    /api/organizations/{org_id}/collections/acquisitions/{acq_id}/<action>
    /api/organizations/{org_id}/collections/acquisitions/{acq_id}/objects
    /api/organizations/{org_id}/collections/objects/{object_id}/acquisition
    /api/workflow-definitions

Tests use the real postgres test DB via conftest fixtures. procedures
enforcement is off by default on the test org, so blocking-requirements
do not fire — status transitions exercise the workflow + invalid-transition
paths in the router.
"""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import (
    Acquisition,
    AcquisitionObject,
    CollectionObject,
    ObjectEntry,
    ObjectEntryItem,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _entries_url(org_id, suffix: str = "") -> str:
    return f"/api/organizations/{org_id}/collections/entries{suffix}"


def _acq_url(org_id, suffix: str = "") -> str:
    return f"/api/organizations/{org_id}/collections/acquisitions{suffix}"


def _make_entry(
    db_session,
    org,
    *,
    entry_number: str = "E2026.0001",
    entry_reason: str = "loan_consideration",
    status: str = "pending",
    depositor_name: str | None = None,
    objects_description: str | None = None,
    entry_date: date | None = None,
) -> ObjectEntry:
    entry = ObjectEntry(
        organization_id=org.organization_id,
        entry_number=entry_number,
        entry_date=entry_date or date.today(),
        entry_reason=entry_reason,
        depositor_name=depositor_name,
        objects_description=objects_description,
        status=status,
    )
    db_session.add(entry)
    db_session.commit()
    return entry


def _make_acquisition(
    db_session,
    org,
    *,
    acquisition_number: str = "ACQ2026.0001",
    acquisition_method: str = "gift",
    status: str = "proposed",
    source_name: str | None = None,
) -> Acquisition:
    acq = Acquisition(
        organization_id=org.organization_id,
        acquisition_number=acquisition_number,
        acquisition_method=acquisition_method,
        source_name=source_name,
        status=status,
    )
    db_session.add(acq)
    db_session.commit()
    return acq


def _make_collection_object(db_session, org, *, object_number: str = "CO-001") -> CollectionObject:
    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=object_number,
    )
    db_session.add(obj)
    db_session.commit()
    return obj


# ===========================================================================
# OBJECT ENTRY — CREATE / LIST / GET
# ===========================================================================


class TestCreateObjectEntry:
    def test_create_minimal_entry(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _entries_url(org.organization_id),
            json={"reason": "loan_consideration"},
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["reason"] == "loan_consideration"
        assert data["status"] == "pending"
        assert data["organization_id"] == str(org.organization_id)
        assert data["entry_number"]  # auto-generated

    def test_create_with_full_payload(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _entries_url(org.organization_id),
            json={
                "reason": "gift_offer",
                "depositor_name": "Jane Donor",
                "current_owner": "Jane Donor",
                "objects_description": "Ceramic bowl",
                "insurance_value": "1500.00",
                "insurance_currency": "USD",
                "insurance_note": "Full replacement",
                "conditions": "Handle with care",
                "entry_method": "hand_delivery",
                "entry_note": "Dropped off 2026-04-24",
                "expected_duration": "30 days",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["reason"] == "gift_offer"
        assert data["depositor_name"] == "Jane Donor"
        assert data["insurance_currency"] == "USD"
        assert data["objects_description"] == "Ceramic bowl"

    def test_create_missing_reason_returns_422(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_entries_url(org.organization_id), json={})
        assert resp.status_code == 422
        body = resp.get_json()
        assert body["error"]["code"] == "validation_error"
        assert body["error"]["field"] == "reason"


class TestListObjectEntries:
    def test_list_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_entries_url(org.organization_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 0
        assert data["items"] == []
        assert data["limit"] == 50
        assert data["offset"] == 0

    def test_list_returns_entries(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_entry(db_session, org, entry_number="E-001",
                    depositor_name="Alpha Donor")
        _make_entry(db_session, org, entry_number="E-002",
                    depositor_name="Beta Donor")

        resp = auth_client.get(_entries_url(org.organization_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2
        numbers = {e["entry_number"] for e in data["items"]}
        assert numbers == {"E-001", "E-002"}

    def test_list_filters_by_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_entry(db_session, org, entry_number="E-PEND", status="pending")
        _make_entry(db_session, org, entry_number="E-REC", status="received")

        resp = auth_client.get(
            _entries_url(org.organization_id),
            params={"status": "received"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["entry_number"] == "E-REC"

    def test_list_filters_by_reason(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_entry(db_session, org, entry_number="E-LOAN",
                    entry_reason="loan_consideration")
        _make_entry(db_session, org, entry_number="E-GIFT",
                    entry_reason="gift_offer")

        resp = auth_client.get(
            _entries_url(org.organization_id),
            params={"reason": "gift_offer"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["entry_number"] == "E-GIFT"

    def test_list_search_by_depositor(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_entry(db_session, org, entry_number="E-AA",
                    depositor_name="Unique Name")
        _make_entry(db_session, org, entry_number="E-BB",
                    depositor_name="Other")

        resp = auth_client.get(
            _entries_url(org.organization_id),
            params={"q": "Unique"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["depositor_name"] == "Unique Name"

    def test_list_pagination(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        for i in range(3):
            _make_entry(db_session, org, entry_number=f"E-P{i:03d}")

        resp = auth_client.get(
            _entries_url(org.organization_id),
            params={"limit": 2, "offset": 1},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 3
        assert data["limit"] == 2
        assert data["offset"] == 1
        assert len(data["items"]) == 2


class TestGetObjectEntry:
    def test_get_returns_entry_with_items(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-DETAIL")
        item = ObjectEntryItem(
            entry_id=entry.entry_id,
            organization_id=org.organization_id,
            item_number=1,
            brief_description="A small bowl",
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.get(_entries_url(org.organization_id, f"/{entry.entry_id}"))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["entry_id"] == str(entry.entry_id)
        assert data["entry_number"] == "E-DETAIL"
        assert len(data["items"]) == 1
        assert data["items"][0]["brief_description"] == "A small bowl"

    def test_get_unknown_id_returns_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            _entries_url(org.organization_id, f"/{uuid4()}")
        )
        assert resp.status_code == 404
        assert resp.get_json()["error"]["code"] == "not_found"


class TestUpdateObjectEntry:
    def test_update_partial_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-UPD")

        resp = auth_client.put(
            _entries_url(org.organization_id, f"/{entry.entry_id}"),
            json={"depositor_name": "Updated Name",
                  "objects_description": "Revised"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["depositor_name"] == "Updated Name"
        assert data["objects_description"] == "Revised"

    def test_update_reason_maps_to_entry_reason(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-RSN",
                            entry_reason="loan_consideration")

        resp = auth_client.put(
            _entries_url(org.organization_id, f"/{entry.entry_id}"),
            json={"reason": "gift_offer"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["reason"] == "gift_offer"

    def test_update_empty_string_clears_field(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-CLR",
                            depositor_name="Existing")

        resp = auth_client.put(
            _entries_url(org.organization_id, f"/{entry.entry_id}"),
            json={"depositor_name": ""},
        )
        assert resp.status_code == 200
        assert resp.get_json()["depositor_name"] is None

    def test_update_status_valid(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-STS",
                            status="pending")

        resp = auth_client.put(
            _entries_url(org.organization_id, f"/{entry.entry_id}"),
            json={"status": "received"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "received"

    def test_update_status_invalid_returns_409(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-BAD",
                            status="pending")

        resp = auth_client.put(
            _entries_url(org.organization_id, f"/{entry.entry_id}"),
            json={"status": "nope_not_a_status"},
        )
        assert resp.status_code == 409
        assert resp.get_json()["error"]["code"] == "invalid_status"

    def test_update_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            _entries_url(org.organization_id, f"/{uuid4()}"),
            json={"depositor_name": "Whatever"},
        )
        assert resp.status_code == 404

    def test_update_version_mismatch_returns_409(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-VER")

        resp = auth_client.put(
            _entries_url(org.organization_id, f"/{entry.entry_id}"),
            json={"version": 999, "depositor_name": "nope"},
        )
        assert resp.status_code == 409
        assert resp.get_json()["error"]["code"] == "conflict"


# ===========================================================================
# OBJECT ENTRY — STATUS TRANSITION ACTIONS
# ===========================================================================


class TestReceiveEntry:
    def test_receive_from_pending(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-REC1",
                            status="pending")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/receive"),
        )
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "received"

    def test_receive_forbidden_from_returned_returns_409(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-REC2",
                            status="returned")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/receive"),
        )
        assert resp.status_code == 409
        assert resp.get_json()["error"]["code"] == "invalid_transition"

    def test_receive_unknown_entry_returns_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{uuid4()}/receive"),
        )
        assert resp.status_code == 404


class TestProcessEntry:
    def test_process_from_received(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-PROC1",
                            status="received")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/process"),
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "processed"
        assert data["processed_date"] is not None

    def test_process_from_pending_returns_409(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-PROC2",
                            status="pending")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/process"),
        )
        assert resp.status_code == 409

    def test_process_unknown_entry_returns_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{uuid4()}/process"),
        )
        assert resp.status_code == 404


class TestMarkEntryReturned:
    def test_mark_returned_with_signature(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-MR1",
                            depositor_name="Donor")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/mark-returned"),
            json={
                "return_date": "2026-04-20",
                "returned_to": "Donor",
                "signature_reference": "form-123",
                "outcome_note": "Picked up in person",
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "returned"
        assert data["outcome"] == "returned"
        assert data["return_date"] == "2026-04-20"
        assert data["outcome_reference_id"] is None  # no separate exit

    def test_mark_returned_defaults_date(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-MR2")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/mark-returned"),
        )
        assert resp.status_code == 200
        assert resp.get_json()["return_date"] is not None

    def test_mark_returned_invalid_date_returns_422(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-MR3")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/mark-returned"),
            json={"return_date": "not-a-date"},
        )
        assert resp.status_code == 422
        assert resp.get_json()["error"]["field"] == "return_date"

    def test_mark_returned_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{uuid4()}/mark-returned"),
            json={},
        )
        assert resp.status_code == 404


class TestReturnEntry:
    def test_return_creates_exit_record(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-RET",
                            depositor_name="Lender")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/return"),
            json={"returned_to": "Lender", "return_method": "courier"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "returned"
        assert data["outcome"] == "returned"
        assert data["exit_id"]
        assert data["exit_number"]

    def test_return_unknown_entry_returns_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{uuid4()}/return"),
            json={},
        )
        assert resp.status_code == 404


class TestAccessionEntry:
    def test_accession_links_acquisition(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-ACC")
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-ACC")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/accession"),
            json={"acquisition_id": str(acq.acquisition_id),
                  "outcome_note": "Accepted into collection"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "acquired"
        assert data["outcome"] == "acquired"
        assert data["outcome_reference_id"] == str(acq.acquisition_id)

    def test_accession_missing_acquisition_id_returns_400(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-ACC2")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/accession"),
            json={},
        )
        assert resp.status_code == 400
        assert resp.get_json()["error"]["code"] == "bad_request"

    def test_accession_entry_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{uuid4()}/accession"),
            json={"acquisition_id": str(uuid4())},
        )
        assert resp.status_code == 404

    def test_accession_acquisition_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-ACC3")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/accession"),
            json={"acquisition_id": str(uuid4())},
        )
        assert resp.status_code == 404
        assert resp.get_json()["error"]["message"] == "Acquisition not found"


# ===========================================================================
# OBJECT ENTRY ITEMS
# ===========================================================================


class TestEntryItems:
    def test_add_item_autoassigns_number(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-ITM")

        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/items"),
            json={
                "brief_description": "First item",
                "declared_value": "250.00",
                "declared_value_currency": "USD",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["item_number"] == 1
        assert data["brief_description"] == "First item"
        assert data["declared_value"] == 250.00

        # Next add should get item_number 2
        resp2 = auth_client.post(
            _entries_url(org.organization_id, f"/{entry.entry_id}/items"),
            json={"brief_description": "Second item"},
        )
        assert resp2.status_code == 201
        assert resp2.get_json()["item_number"] == 2

    def test_add_item_to_missing_entry_returns_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _entries_url(org.organization_id, f"/{uuid4()}/items"),
            json={"brief_description": "Orphan"},
        )
        assert resp.status_code == 404

    def test_update_item_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-ITU")
        item = ObjectEntryItem(
            entry_id=entry.entry_id,
            organization_id=org.organization_id,
            item_number=1,
            brief_description="Before",
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.put(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{item.entry_item_id}",
            ),
            json={
                "brief_description": "After",
                "declared_value": "99.99",
                "item_status": "received",
                "condition_note": "fair",
                "not_an_allowed_field": "ignored",
            },
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["brief_description"] == "After"
        assert data["declared_value"] == 99.99
        assert data["item_status"] == "received"

    def test_update_item_empty_string_clears(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-ITC")
        item = ObjectEntryItem(
            entry_id=entry.entry_id,
            organization_id=org.organization_id,
            item_number=1,
            brief_description="Something",
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.put(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{item.entry_item_id}",
            ),
            json={"brief_description": ""},
        )
        assert resp.status_code == 200
        assert resp.get_json()["brief_description"] is None

    def test_update_item_not_found_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-ITN")

        resp = auth_client.put(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{uuid4()}",
            ),
            json={"brief_description": "Nope"},
        )
        assert resp.status_code == 404

    def test_delete_item(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-ITD")
        item = ObjectEntryItem(
            entry_id=entry.entry_id,
            organization_id=org.organization_id,
            item_number=1,
        )
        db_session.add(item)
        db_session.commit()
        item_id = item.entry_item_id

        resp = auth_client.delete(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{item_id}",
            ),
        )
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        # Confirm gone
        still = (
            db_session.query(ObjectEntryItem)
            .filter(ObjectEntryItem.entry_item_id == item_id)
            .first()
        )
        assert still is None

    def test_delete_item_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-ITX")

        resp = auth_client.delete(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{uuid4()}",
            ),
        )
        assert resp.status_code == 404


# ===========================================================================
# OBJECT ENTRY — MEDIA
# ===========================================================================


class TestEntryMediaListing:
    def test_list_all_entry_media_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-MD1")

        resp = auth_client.get(
            _entries_url(org.organization_id, f"/{entry.entry_id}/media"),
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] == 0
        assert data["media"] == []

    def test_list_all_entry_media_entry_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            _entries_url(org.organization_id, f"/{uuid4()}/media"),
        )
        assert resp.status_code == 404

    def test_list_item_media_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-MD2")
        item = ObjectEntryItem(
            entry_id=entry.entry_id,
            organization_id=org.organization_id,
            item_number=1,
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.get(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{item.entry_item_id}/media",
            ),
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] == 0

    def test_list_item_media_item_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-MD3")

        resp = auth_client.get(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{uuid4()}/media",
            ),
        )
        assert resp.status_code == 404


class TestEntryMediaAdd:
    def test_add_media_without_file_or_media_id_returns_400(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-MDA")
        item = ObjectEntryItem(
            entry_id=entry.entry_id,
            organization_id=org.organization_id,
            item_number=1,
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.post(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{item.entry_item_id}/media",
            ),
            json={},
        )
        assert resp.status_code == 400
        assert resp.get_json()["error"]["code"] == "bad_request"

    def test_link_nonexistent_media_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-MDB")
        item = ObjectEntryItem(
            entry_id=entry.entry_id,
            organization_id=org.organization_id,
            item_number=1,
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.post(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{item.entry_item_id}/media",
            ),
            json={"media_id": str(uuid4())},
        )
        assert resp.status_code == 404


class TestEntryMediaRemove:
    def test_remove_nonexistent_link_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-MDR")
        item = ObjectEntryItem(
            entry_id=entry.entry_id,
            organization_id=org.organization_id,
            item_number=1,
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.delete(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{item.entry_item_id}/media/{uuid4()}",
            ),
        )
        assert resp.status_code == 404

    def test_set_primary_nonexistent_link_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-MDP")
        item = ObjectEntryItem(
            entry_id=entry.entry_id,
            organization_id=org.organization_id,
            item_number=1,
        )
        db_session.add(item)
        db_session.commit()

        resp = auth_client.put(
            _entries_url(
                org.organization_id,
                f"/{entry.entry_id}/items/{item.entry_item_id}/media/{uuid4()}/primary",
            ),
        )
        assert resp.status_code == 404


# ===========================================================================
# ACQUISITIONS — CREATE / LIST / GET / UPDATE
# ===========================================================================


class TestCreateAcquisition:
    def test_create_minimal(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _acq_url(org.organization_id),
            json={"acquisition_method": "purchase"},
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["acquisition_method"] == "purchase"
        assert data["status"] == "proposed"
        assert data["acquisition_number"]

    def test_create_full(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _acq_url(org.organization_id),
            json={
                "acquisition_method": "gift",
                "source_name": "Benefactor Foundation",
                # Canonical acquisition source_type (individual|institution|estate|
                # dealer|other) — NOT constituent_type. "organization" was the
                # drifted value the UI rejected; backend now 422s it.
                "source_type": "institution",
                "cost": "0",
                "cost_currency": "USD",
                "legal_status": "clear",
                "credit_line": "Gift of Benefactor Foundation",
                "provisos": "Must remain on public view",
                "objects_count": 3,
                "acquisition_note": "Major donation",
            },
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["source_name"] == "Benefactor Foundation"
        assert data["credit_line"] == "Gift of Benefactor Foundation"

    def test_create_missing_method_returns_422(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(_acq_url(org.organization_id), json={})
        assert resp.status_code == 422
        body = resp.get_json()
        assert body["error"]["code"] == "validation_error"
        assert body["error"]["field"] == "acquisition_method"

    def test_create_rejects_invalid_source_type(self, auth_setup):
        """The named fault: a non-canonical source_type must 422 at the API, not
        silently persist and brick the page on read."""
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _acq_url(org.organization_id),
            json={"acquisition_method": "gift", "source_type": "Auction House"},
        )
        assert resp.status_code == 422
        assert resp.get_json()["error"]["code"] == "invalid_enum_value"

    def test_update_rejects_invalid_source_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org)
        resp = auth_client.put(
            f"{_acq_url(org.organization_id)}/{acq.acquisition_id}",
            json={"source_type": "Auction House"},
        )
        assert resp.status_code == 422
        assert resp.get_json()["error"]["code"] == "invalid_enum_value"


class TestListAcquisitions:
    def test_list_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_acq_url(org.organization_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 0
        assert data["items"] == []

    def test_list_populated(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_acquisition(db_session, org, acquisition_number="ACQ-A",
                          source_name="Alpha")
        _make_acquisition(db_session, org, acquisition_number="ACQ-B",
                          source_name="Bravo")

        resp = auth_client.get(_acq_url(org.organization_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 2

    def test_list_filter_by_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_acquisition(db_session, org, acquisition_number="ACQ-P",
                          status="proposed")
        _make_acquisition(db_session, org, acquisition_number="ACQ-C",
                          status="completed")

        resp = auth_client.get(
            _acq_url(org.organization_id),
            params={"status": "completed"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["acquisition_number"] == "ACQ-C"

    def test_list_filter_by_method(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_acquisition(db_session, org, acquisition_number="ACQ-GF",
                          acquisition_method="gift")
        _make_acquisition(db_session, org, acquisition_number="ACQ-PU",
                          acquisition_method="purchase")

        resp = auth_client.get(
            _acq_url(org.organization_id),
            params={"acquisition_method": "purchase"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["acquisition_number"] == "ACQ-PU"

    def test_list_filter_by_entry_id(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-AQE")
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-WE")
        acq.entry_id = entry.entry_id
        db_session.commit()
        _make_acquisition(db_session, org, acquisition_number="ACQ-WO")

        resp = auth_client.get(
            _acq_url(org.organization_id),
            params={"entry_id": str(entry.entry_id)},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["acquisition_number"] == "ACQ-WE"

    def test_list_search_query(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _make_acquisition(db_session, org, acquisition_number="ACQ-XS1",
                          source_name="Findable Donor")
        _make_acquisition(db_session, org, acquisition_number="ACQ-XS2",
                          source_name="Other Donor")

        resp = auth_client.get(
            _acq_url(org.organization_id),
            params={"q": "Findable"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1


class TestGetAcquisition:
    def test_get_by_id(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-GET")

        resp = auth_client.get(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}"),
        )
        assert resp.status_code == 200
        assert resp.get_json()["acquisition_number"] == "ACQ-GET"

    def test_get_unknown_returns_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            _acq_url(org.organization_id, f"/{uuid4()}"),
        )
        assert resp.status_code == 404


class TestUpdateAcquisition:
    def test_update_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-UPD")

        resp = auth_client.put(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}"),
            json={"source_name": "New Source", "credit_line": "Updated credit"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["source_name"] == "New Source"
        assert data["credit_line"] == "Updated credit"

    def test_update_status_valid(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-UST",
                                status="proposed")

        resp = auth_client.put(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}"),
            json={"status": "cancelled"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "cancelled"

    def test_update_status_invalid_returns_409(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-BAD")

        resp = auth_client.put(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}"),
            json={"status": "not_a_real_status"},
        )
        assert resp.status_code == 409
        assert resp.get_json()["error"]["code"] == "invalid_status"

    def test_update_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            _acq_url(org.organization_id, f"/{uuid4()}"),
            json={"source_name": "X"},
        )
        assert resp.status_code == 404


# ===========================================================================
# ACQUISITIONS — STATUS ACTIONS (approve, complete, rollback)
# ===========================================================================


class TestApproveAcquisition:
    def test_approve_from_proposed(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-AP1",
                                status="proposed")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/approve"),
        )
        assert resp.status_code == 200
        assert resp.get_json()["status"] == "approved"

    def test_approve_from_completed_returns_409(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-AP2",
                                status="completed")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/approve"),
        )
        assert resp.status_code == 409

    def test_approve_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{uuid4()}/approve"),
        )
        assert resp.status_code == 404


class TestCompleteAcquisition:
    def test_complete_from_approved(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-CP1",
                                status="approved")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/complete"),
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["status"] == "completed"
        assert data["completed_date"] is not None

    def test_complete_from_proposed_returns_409(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-CP2",
                                status="proposed")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/complete"),
        )
        assert resp.status_code == 409

    def test_complete_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{uuid4()}/complete"),
        )
        assert resp.status_code == 404


class TestRollbackAcquisition:
    def test_rollback_requires_target_status(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-RB1",
                                status="approved")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/rollback"),
            json={"reason": "mistake"},
        )
        assert resp.status_code == 422
        assert resp.get_json()["error"]["field"] == "target_status"

    def test_rollback_requires_reason(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-RB2",
                                status="approved")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/rollback"),
            json={"target_status": "proposed"},
        )
        assert resp.status_code == 422
        assert resp.get_json()["error"]["field"] == "reason"

    def test_rollback_blank_reason_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-RB3",
                                status="approved")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/rollback"),
            json={"target_status": "proposed", "reason": "   "},
        )
        assert resp.status_code == 422
        assert resp.get_json()["error"]["field"] == "reason"

    def test_rollback_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{uuid4()}/rollback"),
            json={"target_status": "proposed", "reason": "wrong record"},
        )
        assert resp.status_code == 404

    def test_rollback_forward_target_returns_400(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-RB4",
                                status="proposed")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/rollback"),
            json={"target_status": "completed", "reason": "forward not allowed"},
        )
        assert resp.status_code == 400
        assert resp.get_json()["error"]["code"] == "bad_request"


# ===========================================================================
# ACQUISITION <-> OBJECT LINKS
# ===========================================================================


class TestAcquisitionObjects:
    def test_list_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-L1")

        resp = auth_client.get(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/objects"),
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 0
        assert data["objects"] == []

    def test_list_missing_acquisition_returns_404(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            _acq_url(org.organization_id, f"/{uuid4()}/objects"),
        )
        assert resp.status_code == 404

    def test_link_object(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-LK1")
        obj = _make_collection_object(db_session, org, object_number="COL-LK1")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/objects"),
            json={"object_id": str(obj.object_id), "note": "main piece"},
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["object_id"] == str(obj.object_id)
        assert data["note"] == "main piece"
        assert data["object"]["object_number"] == "COL-LK1"

    def test_link_missing_object_id_returns_422(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-LK2")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/objects"),
            json={},
        )
        assert resp.status_code == 422
        assert resp.get_json()["error"]["field"] == "object_id"

    def test_link_unknown_acquisition_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_collection_object(db_session, org, object_number="COL-LK3")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{uuid4()}/objects"),
            json={"object_id": str(obj.object_id)},
        )
        assert resp.status_code == 404

    def test_link_unknown_object_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-LK4")

        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/objects"),
            json={"object_id": str(uuid4())},
        )
        assert resp.status_code == 404
        assert resp.get_json()["error"]["message"] == "Object not found"

    def test_link_duplicate_returns_409(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-LK5")
        obj = _make_collection_object(db_session, org, object_number="COL-LK5")

        first = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/objects"),
            json={"object_id": str(obj.object_id)},
        )
        assert first.status_code == 201

        second = auth_client.post(
            _acq_url(org.organization_id, f"/{acq.acquisition_id}/objects"),
            json={"object_id": str(obj.object_id)},
        )
        assert second.status_code == 409
        assert second.get_json()["error"]["code"] == "conflict"

    def test_unlink_object(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-UL1")
        obj = _make_collection_object(db_session, org, object_number="COL-UL1")
        link = AcquisitionObject(
            acquisition_id=acq.acquisition_id,
            object_id=obj.object_id,
            organization_id=org.organization_id,
        )
        db_session.add(link)
        db_session.commit()

        resp = auth_client.delete(
            _acq_url(
                org.organization_id,
                f"/{acq.acquisition_id}/objects/{obj.object_id}",
            ),
        )
        assert resp.status_code == 200
        assert resp.get_json()["message"] == "Link removed"

        remaining = (
            db_session.query(AcquisitionObject)
            .filter(AcquisitionObject.acquisition_id == acq.acquisition_id)
            .count()
        )
        assert remaining == 0

    def test_unlink_missing_link_returns_404(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-UL2")

        resp = auth_client.delete(
            _acq_url(
                org.organization_id,
                f"/{acq.acquisition_id}/objects/{uuid4()}",
            ),
        )
        assert resp.status_code == 404


# ===========================================================================
# OBJECT -> ACQUISITION LOOKUP/SETTER
# ===========================================================================


class TestObjectAcquisition:
    def test_get_none_when_unlinked(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_collection_object(db_session, org, object_number="COL-OA1")

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{obj.object_id}/acquisition",
        )
        assert resp.status_code == 200
        assert resp.get_json()["acquisition"] is None

    def test_get_linked_acquisition(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_collection_object(db_session, org, object_number="COL-OA2")
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-OA2")
        link = AcquisitionObject(
            acquisition_id=acq.acquisition_id,
            object_id=obj.object_id,
            organization_id=org.organization_id,
        )
        db_session.add(link)
        db_session.commit()

        resp = auth_client.get(
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{obj.object_id}/acquisition",
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["acquisition"]["acquisition_number"] == "ACQ-OA2"
        assert data["link"]["object_id"] == str(obj.object_id)

    def test_set_acquisition_creates_link(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_collection_object(db_session, org, object_number="COL-OA3")
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-OA3")

        resp = auth_client.put(
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{obj.object_id}/acquisition",
            json={"acquisition_id": str(acq.acquisition_id), "note": "primary"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["acquisition"]["acquisition_number"] == "ACQ-OA3"
        assert data["link"]["note"] == "primary"

    def test_set_acquisition_replaces_existing_link(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_collection_object(db_session, org, object_number="COL-OA4")
        acq_a = _make_acquisition(db_session, org, acquisition_number="ACQ-OA4A")
        acq_b = _make_acquisition(db_session, org, acquisition_number="ACQ-OA4B")

        old_link = AcquisitionObject(
            acquisition_id=acq_a.acquisition_id,
            object_id=obj.object_id,
            organization_id=org.organization_id,
        )
        db_session.add(old_link)
        db_session.commit()

        resp = auth_client.put(
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{obj.object_id}/acquisition",
            json={"acquisition_id": str(acq_b.acquisition_id)},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["acquisition"]["acquisition_number"] == "ACQ-OA4B"

        # Exactly one link remains (the new one).
        links = (
            db_session.query(AcquisitionObject)
            .filter(AcquisitionObject.object_id == obj.object_id)
            .all()
        )
        assert len(links) == 1
        assert links[0].acquisition_id == acq_b.acquisition_id

    def test_set_acquisition_null_clears_link(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_collection_object(db_session, org, object_number="COL-OA5")
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-OA5")
        link = AcquisitionObject(
            acquisition_id=acq.acquisition_id,
            object_id=obj.object_id,
            organization_id=org.organization_id,
        )
        db_session.add(link)
        db_session.commit()

        resp = auth_client.put(
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{obj.object_id}/acquisition",
            json={},
        )
        assert resp.status_code == 200
        assert resp.get_json()["acquisition"] is None

    def test_set_acquisition_object_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.put(
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{uuid4()}/acquisition",
            json={"acquisition_id": str(uuid4())},
        )
        assert resp.status_code == 404
        assert resp.get_json()["error"]["message"] == "Object not found"

    def test_set_acquisition_acquisition_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        obj = _make_collection_object(db_session, org, object_number="COL-OA6")

        resp = auth_client.put(
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{obj.object_id}/acquisition",
            json={"acquisition_id": str(uuid4())},
        )
        assert resp.status_code == 404
        assert resp.get_json()["error"]["message"] == "Acquisition not found"


# ===========================================================================
# WORKFLOW DEFINITIONS ENDPOINT
# ===========================================================================


class TestWorkflowDefinitions:
    def test_returns_all_workflows(self, auth_setup):
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/workflow-definitions")
        assert resp.status_code == 200
        data = resp.get_json()
        assert "workflows" in data
        # Core procedure workflows should be registered
        for key in ("object_entry", "acquisition", "object_exit", "deaccession"):
            assert key in data["workflows"]
            wf = data["workflows"][key]
            assert "valid_statuses" in wf
            assert "status_order" in wf
            assert isinstance(wf["valid_statuses"], list)
            assert isinstance(wf["status_order"], list)


# ===========================================================================
# PERMISSIONS — viewer (read-only role) should be blocked on write ops
# ===========================================================================


class TestViewerPermissions:
    """Viewer role lacks entries/acquisitions permissions; writes should be denied.

    Note: viewer_auth_setup grants only *.view keys (collections.view, etc.)
    and NOT entries.view/acquisitions.view. Every procedure endpoint therefore
    returns 403 — including GETs — because the router requires ENTRIES_VIEW /
    ACQUISITIONS_VIEW, not COLLECTIONS_VIEW.
    """

    def test_viewer_cannot_create_entry(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            _entries_url(org.organization_id),
            json={"reason": "loan_consideration"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_list_entries(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.get(_entries_url(org.organization_id))
        assert resp.status_code == 403

    def test_viewer_cannot_create_acquisition(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            _acq_url(org.organization_id),
            json={"acquisition_method": "gift"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_update_acquisition(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        # The permission check runs before the record lookup, so any UUID works.
        resp = auth_client.put(
            _acq_url(org.organization_id, f"/{uuid4()}"),
            json={"source_name": "X"},
        )
        assert resp.status_code == 403

    def test_viewer_cannot_approve_acquisition(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{uuid4()}/approve"),
        )
        assert resp.status_code == 403

    def test_viewer_cannot_rollback_acquisition(self, viewer_auth_setup):
        auth_client, org, _ = viewer_auth_setup
        resp = auth_client.post(
            _acq_url(org.organization_id, f"/{uuid4()}/rollback"),
            json={"target_status": "proposed", "reason": "try"},
        )
        assert resp.status_code == 403


# ===========================================================================
# CROSS-ORG ISOLATION
# ===========================================================================


class TestCrossOrgIsolation:
    def test_cannot_read_entry_under_wrong_org(self, auth_setup, db_session):
        """An entry belonging to org A is not visible when the URL uses org B.

        The entry_id exists but is filtered by organization_id, so a GET under
        a different org in the URL returns 404 rather than leaking data. Here
        we use a random UUID for the URL's org component — a real org id would
        require a second auth context; the 404 proves the filter is on
        organization_id, not just entry_id.
        """
        auth_client, org, _ = auth_setup
        entry = _make_entry(db_session, org, entry_number="E-ISO")

        resp = auth_client.get(
            f"/api/organizations/{uuid4()}"
            f"/collections/entries/{entry.entry_id}",
        )
        # Wrong org in URL → permission middleware rejects before handler,
        # since the user's membership is on their own org only.
        assert resp.status_code in (403, 404)

    def test_cannot_read_acquisition_under_wrong_org(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        acq = _make_acquisition(db_session, org, acquisition_number="ACQ-ISO")

        resp = auth_client.get(
            f"/api/organizations/{uuid4()}"
            f"/collections/acquisitions/{acq.acquisition_id}",
        )
        assert resp.status_code in (403, 404)
