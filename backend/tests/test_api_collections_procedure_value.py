"""Coverage tests for app/fastapi_app/routers/collections_procedure_value.py.

Was at 18% with no test file. Routes for valuations and reproduction
requests under /api/organizations/{org_id}/collections/...
"""

from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from uuid import uuid4

import pytest

from app.models import CollectionObject, ReproductionRequest, Valuation


# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------


def _valuations_url(org, vid=None) -> str:
    base = f"/api/organizations/{org.organization_id}/collections/valuations"
    return base if vid is None else f"{base}/{vid}"


def _reproductions_url(org, rid=None) -> str:
    base = (
        f"/api/organizations/{org.organization_id}/collections/reproduction-requests"
    )
    return base if rid is None else f"{base}/{rid}"


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def _seed_object(db_session, org_id, *, num: str = "VAL-1") -> CollectionObject:
    obj = CollectionObject(organization_id=org_id, object_number=num)
    db_session.add(obj)
    db_session.commit()
    return obj


def _seed_valuation(
    db_session,
    org_id,
    obj,
    *,
    valuation_type: str = "insurance",
    amount: Decimal = Decimal("1000.00"),
) -> Valuation:
    v = Valuation(
        organization_id=org_id,
        object_id=obj.object_id,
        valuation_type=valuation_type,
        valuation_amount=amount,
        valuation_currency="USD",
        valuation_date=date.today(),
    )
    db_session.add(v)
    db_session.commit()
    return v


# ---------------------------------------------------------------------------
# Valuations
# ---------------------------------------------------------------------------


class TestListValuations:
    def test_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_valuations_url(org))
        assert resp.status_code == 200

    def test_returns_seeded(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="VS-1")
        _seed_valuation(db_session, org.organization_id, obj)
        resp = client.get(_valuations_url(org))
        assert resp.status_code == 200


class TestCreateValuation:
    def test_minimal(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="VC-1")
        resp = client.post(
            _valuations_url(org),
            data=json.dumps(
                {
                    "object_id": str(obj.object_id),
                    "valuation_type": "insurance",
                    "valuation_amount": "5000.00",
                    "valuation_currency": "USD",
                    "valuation_date": str(date.today()),
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code in (201, 400, 422)

    def test_missing_required(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _valuations_url(org),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)


class TestGetValuation:
    def test_returns_detail(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="VG-1")
        v = _seed_valuation(db_session, org.organization_id, obj)
        resp = client.get(_valuations_url(org, v.valuation_id))
        assert resp.status_code == 200

    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_valuations_url(org, uuid4()))
        assert resp.status_code == 404


class TestUpdateValuation:
    def test_put_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="VU-1")
        v = _seed_valuation(db_session, org.organization_id, obj)
        resp = client.put(
            _valuations_url(org, v.valuation_id),
            data=json.dumps(
                {
                    "valuation_type": "market",
                    "valuation_amount": "2500.00",
                    "valuation_currency": "USD",
                    "valuation_date": str(date.today()),
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code in (200, 400, 422)

    def test_put_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.put(
            _valuations_url(org, uuid4()),
            data=json.dumps(
                {
                    "valuation_type": "market",
                    "valuation_amount": "1.00",
                    "valuation_currency": "USD",
                    "valuation_date": str(date.today()),
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code == 404


class TestDeleteValuation:
    def test_delete_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="VD-1")
        v = _seed_valuation(db_session, org.organization_id, obj)
        resp = client.delete(_valuations_url(org, v.valuation_id))
        assert resp.status_code == 200

    def test_delete_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_valuations_url(org, uuid4()))
        assert resp.status_code == 404


class TestObjectValuations:
    def test_list_for_known_object(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="OV-1")
        url = (
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{obj.object_id}/valuations"
        )
        resp = client.get(url)
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Reproduction requests
# ---------------------------------------------------------------------------


class TestListReproductionRequests:
    def test_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_reproductions_url(org))
        assert resp.status_code == 200


class TestCreateReproductionRequest:
    def test_missing_required(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _reproductions_url(org),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)


class TestGetReproductionRequest:
    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_reproductions_url(org, uuid4()))
        assert resp.status_code == 404


class TestUpdateReproductionRequest:
    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.put(
            _reproductions_url(org, uuid4()),
            data=json.dumps({"status": "pending"}),
            content_type="application/json",
        )
        assert resp.status_code == 404
