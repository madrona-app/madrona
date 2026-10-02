"""
Smoke tests for the Checklists API (Exhibits module).

Routes under /api/organizations/<org_id>/exhibit/checklist-templates
and /api/organizations/<org_id>/exhibit/exhibitions/<exhibition_id>/checklists.

Covers: list, create, get-by-id, update, delete, not-found (404), and auth-required.
"""

import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models import Exhibition


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NOW = datetime.now(timezone.utc)


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _templates_url(org):
    return f"/api/organizations/{org.organization_id}/exhibit/checklist-templates"


def _template_url(org, template_id):
    return f"/api/organizations/{org.organization_id}/exhibit/checklist-templates/{template_id}"


def _exhibition_checklists_url(org, exhibition_id):
    return f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition_id}/checklists"


def _exhibition_checklist_url(org, exhibition_id, checklist_id):
    return f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition_id}/checklists/{checklist_id}"


def _create_template_via_api(auth_client, org, name="Test Template"):
    """Create a template through the API and return the response JSON."""
    resp = _post_json(auth_client, _templates_url(org), {
        "name": name,
        "description": "Created for tests",
        "exhibition_type": "general",
    })
    assert resp.status_code == 201, f"Template create failed: {resp.get_json()}"
    return resp.get_json()["template"]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def exhibition(db_session, auth_setup):
    """Create a minimal Exhibition for checklist tests.

    Exhibitions cannot be created via the checklist API, so we insert directly.
    We store the organization_id as a plain string to match SQLite storage format.
    """
    _, org, user = auth_setup
    org_id = org.organization_id
    exh = Exhibition(
        organization_id=org_id,
        title="Test Exhibition",
        exhibition_type="temporary",
        status="proposed",
        created_at=_NOW,
        updated_at=_NOW,
    )
    db_session.add(exh)
    db_session.commit()
    return exh


# ============================================================================
# Templates - List
# ============================================================================

class TestListTemplates:
    def test_list_templates_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_templates_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["templates"] == []

    def test_list_templates_returns_created(self, auth_setup):
        auth_client, org, _ = auth_setup
        _create_template_via_api(auth_client, org, name="Smoke Template")
        resp = auth_client.get(_templates_url(org))
        assert resp.status_code == 200
        templates = resp.get_json()["templates"]
        assert len(templates) >= 1
        names = [t["name"] for t in templates]
        assert "Smoke Template" in names


# ============================================================================
# Templates - Create (via API)
# ============================================================================

class TestCreateTemplate:
    def test_create_template(self, auth_setup):
        auth_client, org, _ = auth_setup
        payload = {
            "name": "New Template",
            "description": "A test template",
            "exhibition_type": "in_house",
        }
        resp = _post_json(auth_client, _templates_url(org), payload)
        assert resp.status_code == 201
        tmpl = resp.get_json()["template"]
        assert tmpl["name"] == "New Template"
        assert tmpl["exhibition_type"] == "in_house"
        assert "template_id" in tmpl
        # Should auto-create version 1
        assert len(tmpl["versions"]) == 1
        assert tmpl["versions"][0]["version_number"] == 1

    def test_create_template_name_required(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _templates_url(org), {"name": ""})
        assert resp.status_code in (400, 422)

    def test_create_template_invalid_exhibition_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = _post_json(auth_client, _templates_url(org), {
            "name": "Bad Type",
            "exhibition_type": "invalid_type",
        })
        assert resp.status_code in (400, 422)


# ============================================================================
# Templates - Get by ID
# ============================================================================

class TestGetTemplate:
    def test_get_template(self, auth_setup):
        auth_client, org, _ = auth_setup
        tmpl = _create_template_via_api(auth_client, org, "Get Me")
        template_id = tmpl["template_id"]
        resp = auth_client.get(_template_url(org, template_id))
        assert resp.status_code == 200
        data = resp.get_json()["template"]
        assert data["template_id"] == template_id
        assert data["name"] == "Get Me"

    def test_get_template_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.get(_template_url(org, fake_id))
        assert resp.status_code == 404


# ============================================================================
# Templates - Update
# ============================================================================

class TestUpdateTemplate:
    def test_update_template_name(self, auth_setup):
        auth_client, org, _ = auth_setup
        tmpl = _create_template_via_api(auth_client, org, "Before Rename")
        template_id = tmpl["template_id"]
        resp = _patch_json(auth_client, _template_url(org, template_id), {
            "name": "After Rename",
        })
        assert resp.status_code == 200
        assert resp.get_json()["template"]["name"] == "After Rename"

    def test_update_template_archive(self, auth_setup):
        auth_client, org, _ = auth_setup
        tmpl = _create_template_via_api(auth_client, org, "To Archive")
        template_id = tmpl["template_id"]
        resp = _patch_json(auth_client, _template_url(org, template_id), {
            "is_archived": True,
        })
        assert resp.status_code == 200
        assert resp.get_json()["template"]["is_archived"] is True

    def test_update_template_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = _patch_json(auth_client, _template_url(org, fake_id), {"name": "X"})
        assert resp.status_code == 404


# ============================================================================
# Templates - Delete
# ============================================================================

class TestDeleteTemplate:
    def test_delete_template(self, auth_setup):
        auth_client, org, _ = auth_setup
        tmpl = _create_template_via_api(auth_client, org, "Delete Me")
        template_id = tmpl["template_id"]
        resp = auth_client.delete(_template_url(org, template_id))
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        # Confirm gone
        resp2 = auth_client.get(_template_url(org, template_id))
        assert resp2.status_code == 404

    def test_delete_template_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.delete(_template_url(org, fake_id))
        assert resp.status_code == 404


# ============================================================================
# Exhibition Checklists - Create (empty, no template)
# ============================================================================

class TestCreateExhibitionChecklist:
    def test_create_empty_checklist(self, auth_setup, exhibition):
        auth_client, org, _ = auth_setup
        url = _exhibition_checklists_url(org, exhibition.exhibition_id)
        resp = _post_json(auth_client, url, {"name": "My Checklist"})
        assert resp.status_code == 201
        cl = resp.get_json()["checklist"]
        assert cl["name"] == "My Checklist"
        assert cl["items"] == []

    def test_create_checklist_exhibition_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = _exhibition_checklists_url(org, fake_id)
        resp = _post_json(auth_client, url, {"name": "Ghost"})
        assert resp.status_code == 404


# ============================================================================
# Exhibition Checklists - Get / Delete
# ============================================================================

class TestGetDeleteExhibitionChecklist:
    def test_get_checklist(self, auth_setup, exhibition):
        auth_client, org, _ = auth_setup
        # Create checklist via API
        url = _exhibition_checklists_url(org, exhibition.exhibition_id)
        create_resp = _post_json(auth_client, url, {"name": "Fetch Me"})
        assert create_resp.status_code == 201
        checklist_id = create_resp.get_json()["checklist"]["checklist_id"]

        get_url = _exhibition_checklist_url(org, exhibition.exhibition_id, checklist_id)
        resp = auth_client.get(get_url)
        assert resp.status_code == 200
        assert resp.get_json()["checklist"]["name"] == "Fetch Me"

    def test_get_checklist_not_found(self, auth_setup, exhibition):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = _exhibition_checklist_url(org, exhibition.exhibition_id, fake_id)
        resp = auth_client.get(url)
        assert resp.status_code == 404

    def test_delete_checklist(self, auth_setup, exhibition):
        auth_client, org, _ = auth_setup
        # Create checklist via API
        url = _exhibition_checklists_url(org, exhibition.exhibition_id)
        create_resp = _post_json(auth_client, url, {"name": "To Delete"})
        assert create_resp.status_code == 201
        checklist_id = create_resp.get_json()["checklist"]["checklist_id"]

        del_url = _exhibition_checklist_url(org, exhibition.exhibition_id, checklist_id)
        resp = auth_client.delete(del_url)
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

        # Confirm gone
        resp2 = auth_client.get(del_url)
        assert resp2.status_code == 404


# ============================================================================
# Auth Required
# ============================================================================

class TestChecklistsAuth:
    def test_list_templates_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.get(_templates_url(org))
        assert resp.status_code == 401

    def test_create_template_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.post(
            _templates_url(org),
            data=json.dumps({"name": "No Auth"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_get_template_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        fake_id = str(uuid4())
        resp = client.get(_template_url(org, fake_id))
        assert resp.status_code == 401
