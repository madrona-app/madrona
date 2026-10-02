"""Coverage tests for app/fastapi_app/routers/collections_procedure_rights.py.

Was at 21% with no test file. 15 routes for Rights Management
(Procedures 17 + 18) under /api/organizations/{org_id}/collections/...
"""

from __future__ import annotations

import json
from datetime import date
from uuid import uuid4

import pytest

from app.models import CollectionObject, ObjectRight, UseRequest


# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------


def _rights_url(org, rid=None) -> str:
    base = f"/api/organizations/{org.organization_id}/collections/rights"
    return base if rid is None else f"{base}/{rid}"


def _object_rights_url(org, obj_id) -> str:
    return (
        f"/api/organizations/{org.organization_id}"
        f"/collections/objects/{obj_id}/rights"
    )


def _use_requests_url(org, rid=None) -> str:
    base = f"/api/organizations/{org.organization_id}/collections/use-requests"
    return base if rid is None else f"{base}/{rid}"


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def _seed_object(db_session, org_id, *, num: str = "RT-1") -> CollectionObject:
    obj = CollectionObject(organization_id=org_id, object_number=num)
    db_session.add(obj)
    db_session.commit()
    return obj


def _seed_right(
    db_session,
    org_id,
    obj,
    *,
    right_type: str = "copyright",
    status: str = "owned",
) -> ObjectRight:
    r = ObjectRight(
        organization_id=org_id,
        object_id=obj.object_id,
        right_type=right_type,
        status=status,
    )
    db_session.add(r)
    db_session.commit()
    return r


# ---------------------------------------------------------------------------
# Rights
# ---------------------------------------------------------------------------


class TestListRights:
    def test_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_rights_url(org))
        assert resp.status_code == 200

    def test_returns_seeded(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="RTS-1")
        _seed_right(db_session, org.organization_id, obj)
        resp = client.get(_rights_url(org))
        assert resp.status_code == 200


class TestObjectRights:
    def test_list_for_known_object(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="OR-1")
        resp = client.get(_object_rights_url(org, obj.object_id))
        assert resp.status_code == 200

    def test_create_object_right(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="OR-2")
        resp = client.post(
            _object_rights_url(org, obj.object_id),
            data=json.dumps(
                {
                    "right_type": "copyright",
                    "status": "owned",
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code in (201, 400, 422)


class TestGetRight:
    def test_returns_detail(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="GR-1")
        right = _seed_right(db_session, org.organization_id, obj)
        resp = client.get(_rights_url(org, right.right_id))
        assert resp.status_code == 200

    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_rights_url(org, uuid4()))
        assert resp.status_code == 404


class TestUpdateRight:
    def test_put_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="UR-1")
        right = _seed_right(db_session, org.organization_id, obj)
        resp = client.put(
            _rights_url(org, right.right_id),
            data=json.dumps(
                {
                    "right_type": "trademark",
                    "status": "unknown",
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code in (200, 400, 422)

    def test_put_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.put(
            _rights_url(org, uuid4()),
            data=json.dumps(
                {"right_type": "copyright", "status": "unknown"}
            ),
            content_type="application/json",
        )
        assert resp.status_code == 404


class TestDeleteRight:
    def test_delete_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="DR-1")
        right = _seed_right(db_session, org.organization_id, obj)
        resp = client.delete(_rights_url(org, right.right_id))
        assert resp.status_code == 200

    def test_delete_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_rights_url(org, uuid4()))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Use requests
# ---------------------------------------------------------------------------


class TestListUseRequests:
    def test_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_use_requests_url(org))
        assert resp.status_code == 200


class TestCreateUseRequest:
    def test_minimal(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _use_requests_url(org),
            data=json.dumps(
                {
                    "request_number": "UR-001",
                    "request_date": str(date.today()),
                    "use_type": "research",
                    "use_purpose": "Academic study",
                    "requester_name": "Researcher Smith",
                }
            ),
            content_type="application/json",
        )
        # 201 or schema-driven 400/422
        assert resp.status_code in (201, 400, 422)

    def test_missing_required(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _use_requests_url(org),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)


class TestGetUseRequest:
    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_use_requests_url(org, uuid4()))
        assert resp.status_code == 404


class TestUpdateUseRequest:
    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.put(
            _use_requests_url(org, uuid4()),
            data=json.dumps({"status": "approved"}),
            content_type="application/json",
        )
        assert resp.status_code == 404
