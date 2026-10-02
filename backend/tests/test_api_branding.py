"""
Smoke tests for the Branding API endpoints.

Routes under:
- /api/organizations/<org_id>/branding (GET, PUT)
- /api/organizations/<org_id>/branding/logo (POST, DELETE)
- /api/organizations/<org_id>/branding/signature (POST, DELETE)
- /api/organizations/<org_id>/document-templates (GET, POST)
- /api/organizations/<org_id>/document-templates/<template_id> (GET, PUT, DELETE)

Mocks S3 upload services so tests run against SQLite.
"""

import io
import json
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

from app.models import OrganizationBranding, DocumentTemplate


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _branding_url(org):
    return f"/api/organizations/{org.organization_id}/branding"


def _logo_url(org):
    return f"/api/organizations/{org.organization_id}/branding/logo"


def _signature_url(org):
    return f"/api/organizations/{org.organization_id}/branding/signature"


def _templates_url(org):
    return f"/api/organizations/{org.organization_id}/branding/templates"


def _template_url(org, template_id):
    return f"/api/organizations/{org.organization_id}/branding/templates/{template_id}"


def _post_json(auth_client, url, data):
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


@pytest.fixture
def branding_auth_setup(auth_setup, db_session):
    """Extend auth_setup with branding-specific permission keys."""
    from app.models import Permission as PermissionModel, RolePermission, Role

    auth_client, org, user = auth_setup

    # Find the role for this user
    from app.models import OrganizationMembership
    membership = db_session.query(OrganizationMembership).filter_by(
        organization_id=org.organization_id,
        user_id=user.user_id,
    ).first()
    role = db_session.query(Role).filter_by(role_id=membership.role_id).first()

    branding_keys = [
        "branding.view",
        "branding.edit",
    ]
    for key in branding_keys:
        scope, action = key.rsplit(".", 1)
        perm = PermissionModel(
            permission_key=key,
            scope=scope,
            action=action,
            display_name=key.replace(".", " ").title(),
            description=f"Permission for {key}",
        )
        db_session.add(perm)
        db_session.flush()
        rp = RolePermission(role_id=role.role_id, permission_id=perm.permission_id)
        db_session.add(rp)
    db_session.commit()

    return auth_client, org, user


# ============================================================================
# Branding Settings - GET (defaults when none exist)
# ============================================================================

class TestGetBranding:
    def test_get_branding_defaults(self, branding_auth_setup):
        """When no branding record exists, returns sensible defaults."""
        auth_client, org, _ = branding_auth_setup
        resp = auth_client.get(_branding_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["branding_id"] is None
        assert data["organization_id"] == str(org.organization_id)
        assert data["logo_url"] is None
        assert data["primary_color"] == "#1a365d"
        assert data["secondary_color"] == "#2d3748"
        assert data["accent_color"] == "#3182ce"

    def test_get_branding_requires_auth(self, client, branding_auth_setup):
        """Unauthenticated request returns 401."""
        _, org, _ = branding_auth_setup
        resp = client.get(_branding_url(org))
        assert resp.status_code == 401


# ============================================================================
# Branding Settings - PUT (create / update)
# ============================================================================

class TestUpdateBranding:
    def test_update_branding_creates_record(self, branding_auth_setup):
        """PUT creates a branding record if none exists and returns it."""
        auth_client, org, _ = branding_auth_setup
        payload = {
            "letterhead_name": "Test Museum",
            "letterhead_address_line1": "123 Art Lane",
            "primary_color": "#ff0000",
        }
        resp = _put_json(auth_client, _branding_url(org), payload)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["letterhead_name"] == "Test Museum"
        assert data["letterhead_address_line1"] == "123 Art Lane"
        assert data["primary_color"] == "#ff0000"
        assert data["branding_id"] is not None

    def test_update_branding_requires_auth(self, client, branding_auth_setup):
        _, org, _ = branding_auth_setup
        resp = client.put(
            _branding_url(org),
            data=json.dumps({"letterhead_name": "X"}),
            content_type="application/json",
        )
        assert resp.status_code == 401


# ============================================================================
# Logo Upload / Delete
# ============================================================================

class TestLogoUpload:
    @patch("app.services.uploads.get_org_media_url", return_value="https://s3.example.com/logo.png")
    @patch("app.services.uploads.upload_org_branding_file", return_value="branding/logo.png")
    def test_upload_logo(self, mock_upload, mock_url, branding_auth_setup):
        """Successful logo upload stores S3 key and returns presigned URL."""
        auth_client, org, _ = branding_auth_setup
        data = {
            # Route expects form field `file` (FastAPI UploadFile convention).
            "file": (io.BytesIO(b"\x89PNG\r\n\x1a\n" + b"\x00" * 100), "logo.png"),
        }
        resp = auth_client.post(
            _logo_url(org),
            data=data,
            content_type="multipart/form-data",
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["logo_url"] == "https://s3.example.com/logo.png"
        assert body["logo_s3_key"] == "branding/logo.png"

    def test_upload_logo_no_file(self, branding_auth_setup):
        """Missing file returns 422 (FastAPI body validation)."""
        auth_client, org, _ = branding_auth_setup
        resp = auth_client.post(
            _logo_url(org),
            data={},
            content_type="multipart/form-data",
        )
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        _msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()
        # FastAPI validation raises "field required" for the missing `file` upload.
        assert ("no file" in _msg) or ("boundary" in _msg) or ("multipart" in _msg) or ("field required" in _msg) or ("'file'" in _msg)

    def test_delete_logo_not_found(self, branding_auth_setup):
        """Deleting a non-existent logo returns 404."""
        auth_client, org, _ = branding_auth_setup
        resp = auth_client.delete(_logo_url(org))
        assert resp.status_code == 404


# ============================================================================
# Signature Upload / Delete
# ============================================================================

class TestSignatureUpload:
    def test_upload_signature_no_file(self, branding_auth_setup):
        """Missing signature file returns 422 (FastAPI body validation)."""
        auth_client, org, _ = branding_auth_setup
        resp = auth_client.post(
            _signature_url(org),
            data={},
            content_type="multipart/form-data",
        )
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        _msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()
        assert ("no file" in _msg) or ("boundary" in _msg) or ("multipart" in _msg) or ("field required" in _msg) or ("'file'" in _msg)

    def test_delete_signature_not_found(self, branding_auth_setup):
        """Deleting a non-existent signature returns 404."""
        auth_client, org, _ = branding_auth_setup
        resp = auth_client.delete(_signature_url(org))
        assert resp.status_code == 404


# ============================================================================
# Document Templates - List
# ============================================================================

class TestListDocumentTemplates:
    def test_list_templates_empty(self, auth_setup):
        """When no templates exist, returns an empty list."""
        auth_client, org, _ = auth_setup
        resp = auth_client.get(_templates_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        # New response envelope: {"templates": [...]}
        templates = data["templates"] if isinstance(data, dict) else data
        assert templates == []

    def test_list_templates_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.get(_templates_url(org))
        assert resp.status_code == 401


# ============================================================================
# Document Templates - Create
# ============================================================================

class TestCreateDocumentTemplate:
    def test_create_template(self, auth_setup):
        """Create a new document template and get 201."""
        auth_client, org, _ = auth_setup
        payload = {
            "template_type": "loan_agreement_out",
            "name": "Custom Loan Agreement",
            "description": "A custom template",
            "is_default": False,
            "config": {"sections": ["header", "body"]},
            "terms_and_conditions": "All items must be returned.",
        }
        resp = _post_json(auth_client, _templates_url(org), payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["template_type"] == "loan_agreement_out"
        assert data["name"] == "Custom Loan Agreement"
        assert "template_id" in data

    def test_create_template_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        resp = client.post(
            _templates_url(org),
            data=json.dumps({"template_type": "loan_agreement_out", "name": "X"}),
            content_type="application/json",
        )
        assert resp.status_code == 401


# ============================================================================
# Document Templates - Get by ID / Not Found
# ============================================================================

# ============================================================================
# Document Templates - Delete
# ============================================================================

class TestDeleteDocumentTemplate:
    def test_delete_template(self, auth_setup):
        """Delete a template successfully."""
        auth_client, org, _ = auth_setup
        create_resp = _post_json(auth_client, _templates_url(org), {
            "template_type": "packing_list",
            "name": "Delete Me",
        })
        assert create_resp.status_code == 201
        template_id = create_resp.get_json()["template_id"]

        resp = auth_client.delete(_template_url(org, template_id))
        assert resp.status_code == 200

    def test_delete_template_not_found(self, auth_setup):
        """Deleting a non-existent template returns 404."""
        auth_client, org, _ = auth_setup
        resp = auth_client.delete(_template_url(org, str(uuid4())))
        assert resp.status_code == 404
