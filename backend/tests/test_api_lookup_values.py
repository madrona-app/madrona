"""
Smoke tests for the Lookup Values API.

Routes under /api/organizations/<org_id>/lookups.
Tests run against SQLite in-memory via the auth_setup fixture.
"""

import json
from uuid import uuid4

import pytest

from app.models import LookupCategory, LookupValue, LookupSortOverride


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


def _add_lookup_permissions(db_session, role):
    """Add lookups.view and lookups.manage permissions to a role."""
    from app.models import Permission as PermissionModel, RolePermission

    for key in ("lookups.view", "lookups.manage"):
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
        db_session.add(RolePermission(role_id=role.role_id, permission_id=perm.permission_id))
    db_session.commit()


def _seed_category(db_session, key="test_category", display_name="Test Category",
                   contexts=None, supports_icons=False):
    """Create a LookupCategory directly in the DB and return it."""
    cat = LookupCategory(
        category_key=key,
        display_name=display_name,
        description="A test category",
        applicable_contexts=contexts or ["general"],
        supports_icons=supports_icons,
    )
    db_session.add(cat)
    db_session.flush()
    return cat


def _seed_value(db_session, category, org_id=None, value_key="val_a",
                label="Value A", sort_order=0, is_hidden=False):
    """Create a LookupValue directly in the DB and return it."""
    val = LookupValue(
        category_id=category.category_id,
        organization_id=org_id,
        value_key=value_key,
        label=label,
        sort_order=sort_order,
        is_active=True,
        is_hidden=is_hidden,
    )
    db_session.add(val)
    db_session.flush()
    return val


@pytest.fixture
def lookup_auth(auth_setup, db_session):
    """Extend auth_setup with lookups.view and lookups.manage permissions.

    Returns the same (auth_client, org, user) tuple.
    """
    auth_client, org, user = auth_setup

    # Find the role that was created by auth_setup for this org
    from app.models import OrganizationMembership
    membership = db_session.query(OrganizationMembership).filter(
        OrganizationMembership.organization_id == org.organization_id,
    ).first()
    role_id = membership.role_id

    from app.models import Role
    role = db_session.query(Role).filter(Role.role_id == role_id).first()
    _add_lookup_permissions(db_session, role)

    return auth_client, org, user


# ============================================================================
# List lookups
# ============================================================================


class TestListAllLookups:
    def test_list_lookups_empty(self, lookup_auth):
        auth_client, org, _ = lookup_auth
        url = f"/api/organizations/{org.organization_id}/lookups"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert isinstance(data, list)
        assert len(data) == 0

    def test_list_lookups_with_data(self, lookup_auth, db_session):
        auth_client, org, _ = lookup_auth
        cat = _seed_category(db_session, key="acq_method", display_name="Acquisition Method")
        _seed_value(db_session, cat, value_key="purchase", label="Purchase")
        _seed_value(db_session, cat, value_key="gift", label="Gift", sort_order=1)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/lookups"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data) == 1
        assert data[0]["category_key"] == "acq_method"
        assert len(data[0]["values"]) == 2


# ============================================================================
# Get category values
# ============================================================================


class TestGetCategoryValues:
    def test_get_category_values(self, lookup_auth, db_session):
        auth_client, org, _ = lookup_auth
        cat = _seed_category(db_session, key="condition")
        _seed_value(db_session, cat, value_key="good", label="Good")
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/lookups/condition"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["category"]["category_key"] == "condition"
        assert len(data["values"]) == 1
        assert data["values"][0]["value_key"] == "good"

    def test_get_category_not_found(self, lookup_auth):
        auth_client, org, _ = lookup_auth
        url = f"/api/organizations/{org.organization_id}/lookups/nonexistent_category"
        resp = auth_client.get(url)
        assert resp.status_code == 404


# ============================================================================
# Create lookup value
# ============================================================================


class TestCreateLookupValue:
    def test_create_value(self, lookup_auth, db_session):
        auth_client, org, _ = lookup_auth
        cat = _seed_category(db_session, key="transport_method")
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/lookups/transport_method"
        payload = {
            "value_key": "courier",
            "label": "Courier Service",
            "description": "Professional art courier",
            "sort_order": 10,
        }
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["value_key"] == "courier"
        assert data["label"] == "Courier Service"
        assert data["is_system"] is False
        assert data["organization_id"] == str(org.organization_id)

    def test_create_value_missing_fields(self, lookup_auth, db_session):
        auth_client, org, _ = lookup_auth
        cat = _seed_category(db_session, key="insurance_type")
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/lookups/insurance_type"
        resp = _post_json(auth_client, url, {"label": "Only Label"})
        assert resp.status_code in (400, 422)

    def test_create_value_category_not_found(self, lookup_auth):
        auth_client, org, _ = lookup_auth
        url = f"/api/organizations/{org.organization_id}/lookups/fake_category"
        resp = _post_json(auth_client, url, {"value_key": "x", "label": "X"})
        assert resp.status_code == 404

    def test_create_value_duplicate_key(self, lookup_auth, db_session):
        auth_client, org, _ = lookup_auth
        cat = _seed_category(db_session, key="dup_test")
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/lookups/dup_test"
        payload = {"value_key": "same_key", "label": "First"}
        resp1 = _post_json(auth_client, url, payload)
        assert resp1.status_code == 201

        payload["label"] = "Second"
        resp2 = _post_json(auth_client, url, payload)
        assert resp2.status_code == 409


# ============================================================================
# Update lookup value
# ============================================================================


class TestUpdateLookupValue:
    def test_update_org_value(self, lookup_auth, db_session):
        auth_client, org, _ = lookup_auth
        cat = _seed_category(db_session, key="upd_cat")
        val = _seed_value(db_session, cat, org_id=org.organization_id,
                          value_key="editable", label="Old Label")
        db_session.commit()
        value_id = val.value_id

        url = f"/api/organizations/{org.organization_id}/lookups/values/{value_id}"
        resp = _put_json(auth_client, url, {"label": "New Label"})
        assert resp.status_code == 200
        assert resp.get_json()["label"] == "New Label"

    def test_update_value_not_found(self, lookup_auth):
        auth_client, org, _ = lookup_auth
        url = f"/api/organizations/{org.organization_id}/lookups/values/{uuid4()}"
        resp = _put_json(auth_client, url, {"label": "Nope"})
        assert resp.status_code == 404


# ============================================================================
# Delete lookup value
# ============================================================================


class TestDeleteLookupValue:
    def test_delete_org_value(self, lookup_auth, db_session):
        auth_client, org, _ = lookup_auth
        cat = _seed_category(db_session, key="del_cat")
        val = _seed_value(db_session, cat, org_id=org.organization_id,
                          value_key="deletable", label="Delete Me")
        db_session.commit()
        value_id = val.value_id

        url = f"/api/organizations/{org.organization_id}/lookups/values/{value_id}"
        resp = auth_client.delete(url)
        assert resp.status_code == 204

    def test_delete_value_not_found(self, lookup_auth):
        auth_client, org, _ = lookup_auth
        url = f"/api/organizations/{org.organization_id}/lookups/values/{uuid4()}"
        resp = auth_client.delete(url)
        assert resp.status_code == 404


# ============================================================================
# Authorization
# ============================================================================


class TestLookupAuth:
    def test_requires_auth(self, client, auth_setup):
        """Unauthenticated request gets 401."""
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/lookups"
        resp = client.get(url)
        assert resp.status_code == 401
