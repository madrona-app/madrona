"""
Smoke tests for the Info Requests API (templates + exhibition info requests).

Routes under:
  /api/organizations/<org_id>/exhibit/info-request-templates
  /api/organizations/<org_id>/exhibit/exhibitions/<exhibition_id>/info-requests
  /api/organizations/<org_id>/exhibit/info-request-enums

Note: The info_request_documents table is excluded from the SQLite test schema
(in conftest._BROKEN_TABLES) because its FK references a schema-qualified media
table.  We patch the serialize_info_request function to skip the documents
relationship, and replace selectinload with lazyload for the documents
relationship so the API endpoints never query the missing table.

Additionally, the models use server_default='now()' for timestamp columns, which
SQLite stores as the literal string 'now()' rather than calling the registered
NOW() function.  We use a before_insert event to set proper Python defaults.
"""

import json
from datetime import datetime, timezone
from unittest.mock import patch
from uuid import uuid4

import pytest
from sqlalchemy import event

from app.database import current_session
from app.models import (
    Exhibition,
    InfoRequestTemplate,
    InfoRequestTemplateItem,
    ExhibitionInfoRequest,
    InfoRequestType,
    InfoRequestStatus,
)


# ---------------------------------------------------------------------------
# SQLite compatibility fixtures
# ---------------------------------------------------------------------------

def _set_timestamp_defaults(mapper, connection, target):
    """Before-insert listener that sets created_at/updated_at when missing."""
    now = datetime.now(timezone.utc)
    if hasattr(target, "created_at") and target.created_at is None:
        target.created_at = now
    if hasattr(target, "updated_at") and target.updated_at is None:
        target.updated_at = now


# Register for all info-request models whose server_default='now()' fails on SQLite
for _model in (InfoRequestTemplate, InfoRequestTemplateItem, ExhibitionInfoRequest):
    event.listen(_model, "before_insert", _set_timestamp_defaults)


def _stub_serialize_info_request(req):
    """Replacement serializer that avoids the documents relationship entirely."""
    return {
        'request_id': str(req.request_id),
        'exhibition_id': str(req.exhibition_id),
        'source_template_item_id': str(req.source_template_item_id) if req.source_template_item_id else None,
        'request_type': req.request_type,
        'request_type_label': InfoRequestType.LABELS.get(req.request_type, req.request_type),
        'title': req.title,
        'description': req.description,
        'status': req.status,
        'status_label': InfoRequestStatus.LABELS.get(req.status, req.status),
        'source_party': req.source_party,
        'due_date': req.due_date.isoformat() if req.due_date else None,
        'notes': req.notes,
        'is_required': req.is_required,
        'sort_order': req.sort_order,
        'received_at': req.received_at.isoformat() if req.received_at else None,
        'received_by': str(req.received_by) if req.received_by else None,
        'approved_at': req.approved_at.isoformat() if req.approved_at else None,
        'approved_by': str(req.approved_by) if req.approved_by else None,
        'documents': [],
        'document_count': 0,
        'created_at': req.created_at.isoformat() if req.created_at else None,
        'updated_at': req.updated_at.isoformat() if req.updated_at else None,
    }


@pytest.fixture(autouse=True)
def _patch_documents_for_sqlite(db_session):
    """SQLite-era compat shim — no-op on Postgres where info_request_documents exists."""
    yield


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _templates_url(org):
    return f"/api/organizations/{org.organization_id}/exhibit/info-request-templates"


def _template_url(org, template_id):
    return f"/api/organizations/{org.organization_id}/exhibit/info-request-templates/{template_id}"


def _info_requests_url(org, exhibition_id):
    return f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition_id}/info-requests"


def _info_request_url(org, exhibition_id, request_id):
    return f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition_id}/info-requests/{request_id}"


def _enums_url(org):
    return f"/api/organizations/{org.organization_id}/exhibit/info-request-enums"


def _create_template(db_session, org, name="Test Template", **kwargs):
    """Create an InfoRequestTemplate directly in the database."""
    now = datetime.now(timezone.utc)
    template = InfoRequestTemplate(
        organization_id=org.organization_id,
        name=name,
        description=kwargs.get("description"),
        exhibition_type=kwargs.get("exhibition_type", "general"),
        is_archived=kwargs.get("is_archived", False),
        created_at=now,
        updated_at=now,
    )
    db_session.add(template)
    db_session.commit()
    return template


def _create_exhibition(db_session, org):
    """Create a minimal Exhibition for info request tests.

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


def _create_info_request(db_session, exhibition, **kwargs):
    """Create an ExhibitionInfoRequest directly in the database."""
    now = datetime.now(timezone.utc)
    req = ExhibitionInfoRequest(
        exhibition_id=exhibition.exhibition_id,
        request_type=kwargs.get("request_type", "loan_agreement"),
        title=kwargs.get("title", "Test Info Request"),
        description=kwargs.get("description"),
        status=kwargs.get("status", "requested"),
        source_party=kwargs.get("source_party"),
        is_required=kwargs.get("is_required", True),
        sort_order=kwargs.get("sort_order", 0),
        created_at=now,
        updated_at=now,
    )
    db_session.add(req)
    db_session.commit()
    return req


# ===========================================================================
# Template - List
# ===========================================================================

class TestListTemplates:
    def test_list_templates_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_templates_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["templates"] == []

    def test_list_templates_returns_data(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _create_template(db_session, org, name="Template A")
        _create_template(db_session, org, name="Template B")
        resp = auth_client.get(_templates_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["templates"]) == 2
        names = [t["name"] for t in data["templates"]]
        assert "Template A" in names
        assert "Template B" in names


# ===========================================================================
# Template - Create
# ===========================================================================

class TestCreateTemplate:
    def test_create_template(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        payload = {"name": "New Template", "description": "A description"}
        resp = _post_json(auth_client, _templates_url(org), payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["template"]["name"] == "New Template"
        assert data["template"]["description"] == "A description"
        assert "template_id" in data["template"]

    def test_create_template_missing_name(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _templates_url(org), {})
        assert resp.status_code in (400, 422)


# ===========================================================================
# Template - Get by ID
# ===========================================================================

class TestGetTemplate:
    def test_get_template(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        template = _create_template(db_session, org, name="Fetch Me")
        resp = auth_client.get(_template_url(org, template.template_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["template"]["name"] == "Fetch Me"
        assert "items" in data["template"]

    def test_get_template_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_template_url(org, uuid4()))
        assert resp.status_code == 404


# ===========================================================================
# Template - Update
# ===========================================================================

class TestUpdateTemplate:
    def test_update_template_name(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        template = _create_template(db_session, org, name="Old Name")
        resp = _patch_json(
            auth_client,
            _template_url(org, template.template_id),
            {"name": "New Name"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["template"]["name"] == "New Name"

    def test_update_template_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        resp = _patch_json(
            auth_client,
            _template_url(org, uuid4()),
            {"name": "Nope"},
        )
        assert resp.status_code == 404


# ===========================================================================
# Template - Delete
# ===========================================================================

class TestDeleteTemplate:
    def test_delete_template(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        template = _create_template(db_session, org, name="Delete Me")
        resp = auth_client.delete(_template_url(org, template.template_id))
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        # Confirm it is gone
        resp2 = auth_client.get(_template_url(org, template.template_id))
        assert resp2.status_code == 404

    def test_delete_template_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(_template_url(org, uuid4()))
        assert resp.status_code == 404


# ===========================================================================
# Exhibition Info Request - List
# ===========================================================================

class TestListInfoRequests:
    def test_list_info_requests_empty(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        resp = auth_client.get(_info_requests_url(org, exhibition.exhibition_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["info_requests"] == []
        assert data["summary"]["total"] == 0

    def test_list_info_requests_with_data(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        _create_info_request(db_session, exhibition, title="Req A")
        _create_info_request(db_session, exhibition, title="Req B")
        resp = auth_client.get(_info_requests_url(org, exhibition.exhibition_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["info_requests"]) == 2
        assert data["summary"]["total"] == 2

    def test_list_info_requests_exhibition_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_info_requests_url(org, uuid4()))
        assert resp.status_code == 404


# ===========================================================================
# Exhibition Info Request - Create (single)
# ===========================================================================

class TestCreateInfoRequest:
    def test_create_single_info_request(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        payload = {
            "title": "Loan Agreement Needed",
            "request_type": "loan_agreement",
        }
        resp = _post_json(
            auth_client,
            _info_requests_url(org, exhibition.exhibition_id),
            payload,
        )
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["info_request"]["title"] == "Loan Agreement Needed"
        assert data["info_request"]["request_type"] == "loan_agreement"
        assert data["info_request"]["status"] == "requested"

    def test_create_info_request_missing_title(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        payload = {"request_type": "loan_agreement"}
        resp = _post_json(
            auth_client,
            _info_requests_url(org, exhibition.exhibition_id),
            payload,
        )
        assert resp.status_code in (400, 422)

    def test_create_info_request_invalid_type(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        payload = {"title": "Test", "request_type": "invalid_type"}
        resp = _post_json(
            auth_client,
            _info_requests_url(org, exhibition.exhibition_id),
            payload,
        )
        assert resp.status_code in (400, 422)


# ===========================================================================
# Exhibition Info Request - Get by ID
# ===========================================================================

class TestGetInfoRequest:
    def test_get_info_request(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        req = _create_info_request(db_session, exhibition, title="Fetch Me")
        resp = auth_client.get(
            _info_request_url(org, exhibition.exhibition_id, req.request_id)
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["info_request"]["title"] == "Fetch Me"

    def test_get_info_request_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        resp = auth_client.get(
            _info_request_url(org, exhibition.exhibition_id, uuid4())
        )
        assert resp.status_code == 404


# ===========================================================================
# Exhibition Info Request - Update
# ===========================================================================

class TestUpdateInfoRequest:
    def test_update_info_request_title(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        req = _create_info_request(db_session, exhibition, title="Old Title")
        resp = _patch_json(
            auth_client,
            _info_request_url(org, exhibition.exhibition_id, req.request_id),
            {"title": "New Title"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["info_request"]["title"] == "New Title"

    def test_update_info_request_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        resp = _patch_json(
            auth_client,
            _info_request_url(org, exhibition.exhibition_id, uuid4()),
            {"title": "Nope"},
        )
        assert resp.status_code == 404


# ===========================================================================
# Exhibition Info Request - Delete
# ===========================================================================

class TestDeleteInfoRequest:
    def test_delete_info_request(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        req = _create_info_request(db_session, exhibition, title="Delete Me")
        resp = auth_client.delete(
            _info_request_url(org, exhibition.exhibition_id, req.request_id)
        )
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        # Confirm it is gone
        resp2 = auth_client.get(
            _info_request_url(org, exhibition.exhibition_id, req.request_id)
        )
        assert resp2.status_code == 404

    def test_delete_info_request_not_found(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        resp = auth_client.delete(
            _info_request_url(org, exhibition.exhibition_id, uuid4())
        )
        assert resp.status_code == 404


# ===========================================================================
# Enums
# ===========================================================================

class TestEnums:
    def test_get_enums(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_enums_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert "request_types" in data
        assert "statuses" in data
        assert "source_parties" in data
        # Verify at least one known value
        type_values = [t["value"] for t in data["request_types"]]
        assert "loan_agreement" in type_values


# ===========================================================================
# Authorization
# ===========================================================================

class TestInfoRequestsAuth:
    def test_list_templates_requires_auth(self, client, auth_setup, db_session):
        _, org, _ = auth_setup
        resp = client.get(_templates_url(org))
        assert resp.status_code == 401

    def test_create_template_requires_auth(self, client, auth_setup, db_session):
        _, org, _ = auth_setup
        resp = client.post(
            _templates_url(org),
            data=json.dumps({"name": "Unauthed"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_list_info_requests_requires_auth(self, client, auth_setup, db_session):
        _, org, _ = auth_setup
        exhibition = _create_exhibition(db_session, org)
        resp = client.get(_info_requests_url(org, exhibition.exhibition_id))
        assert resp.status_code == 401
