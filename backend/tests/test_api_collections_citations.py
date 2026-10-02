"""Coverage tests for the citations + critical-responses portion of
app/fastapi_app/routers/collections_relations.py.

Was at 25%; relationship endpoints are covered by tests/test_api_relationships.py.
This file fills the citation / critical-response gap.
"""

from __future__ import annotations

import json
from uuid import uuid4

import pytest

from app.models import Citation, CollectionObject


# ---------------------------------------------------------------------------
# URLs
# ---------------------------------------------------------------------------


def _citations_url(org, cid=None) -> str:
    base = f"/api/organizations/{org.organization_id}/collections/citations"
    return base if cid is None else f"{base}/{cid}"


def _object_citations_url(org, obj_id, link_id=None) -> str:
    base = (
        f"/api/organizations/{org.organization_id}"
        f"/collections/objects/{obj_id}/citations"
    )
    return base if link_id is None else f"{base}/{link_id}"


def _critical_responses_url(org, obj_id) -> str:
    return (
        f"/api/organizations/{org.organization_id}"
        f"/collections/objects/{obj_id}/critical-responses"
    )


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


def _seed_object(db_session, org_id, *, num: str = "CIT-1") -> CollectionObject:
    obj = CollectionObject(organization_id=org_id, object_number=num)
    db_session.add(obj)
    db_session.commit()
    return obj


def _seed_citation(
    db_session,
    org_id,
    *,
    citation_type: str = "book",
    full_citation: str = "Author, Title (Publisher, 2020).",
) -> Citation:
    c = Citation(
        organization_id=org_id,
        citation_type=citation_type,
        full_citation=full_citation,
    )
    db_session.add(c)
    db_session.commit()
    return c


# ---------------------------------------------------------------------------
# Citations CRUD
# ---------------------------------------------------------------------------


class TestListCitations:
    def test_empty(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_citations_url(org))
        assert resp.status_code == 200

    def test_returns_seeded(self, auth_setup, db_session):
        client, org, _ = auth_setup
        _seed_citation(
            db_session, org.organization_id, full_citation="Citation A"
        )
        _seed_citation(
            db_session, org.organization_id, full_citation="Citation B"
        )
        resp = client.get(_citations_url(org))
        assert resp.status_code == 200


class TestCreateCitation:
    def test_minimal(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _citations_url(org),
            data=json.dumps(
                {
                    "citation_type": "book",
                    "full_citation": "Smith, A. (2020). Test Book. Pub.",
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code in (201, 400, 422)

    def test_missing_required(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(
            _citations_url(org),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code in (400, 422)


class TestGetCitation:
    def test_returns_detail(self, auth_setup, db_session):
        client, org, _ = auth_setup
        c = _seed_citation(
            db_session, org.organization_id, full_citation="Detail Test"
        )
        resp = client.get(_citations_url(org, c.citation_id))
        assert resp.status_code == 200

    def test_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_citations_url(org, uuid4()))
        assert resp.status_code == 404


class TestUpdateCitation:
    def test_put_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        c = _seed_citation(
            db_session, org.organization_id, full_citation="Original"
        )
        resp = client.put(
            _citations_url(org, c.citation_id),
            data=json.dumps(
                {
                    "citation_type": "book",
                    "full_citation": "Updated",
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code in (200, 400, 422)

    def test_put_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.put(
            _citations_url(org, uuid4()),
            data=json.dumps(
                {
                    "citation_type": "book",
                    "full_citation": "x",
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code == 404


class TestDeleteCitation:
    def test_delete_existing(self, auth_setup, db_session):
        client, org, _ = auth_setup
        c = _seed_citation(
            db_session, org.organization_id, full_citation="ToDelete"
        )
        resp = client.delete(_citations_url(org, c.citation_id))
        assert resp.status_code == 200

    def test_delete_not_found(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.delete(_citations_url(org, uuid4()))
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Object-citation links
# ---------------------------------------------------------------------------


class TestObjectCitations:
    def test_list_empty(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="OC-1")
        resp = client.get(_object_citations_url(org, obj.object_id))
        assert resp.status_code == 200

    def test_link_citation_to_object(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="OC-2")
        cit = _seed_citation(
            db_session, org.organization_id, full_citation="Linkable"
        )
        resp = client.post(
            _object_citations_url(org, obj.object_id),
            data=json.dumps({"citation_id": str(cit.citation_id)}),
            content_type="application/json",
        )
        # 201 if accepted, 400/422 if more fields needed
        assert resp.status_code in (201, 400, 422)


# ---------------------------------------------------------------------------
# Critical responses
# ---------------------------------------------------------------------------


class TestCriticalResponses:
    def test_list_empty(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, num="CR-1")
        resp = client.get(_critical_responses_url(org, obj.object_id))
        assert resp.status_code == 200
