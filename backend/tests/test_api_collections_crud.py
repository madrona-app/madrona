"""
Integration tests for the Collections CRUD API.

Routes under /api/organizations/<org_id>/collections/objects and /collections/locations.
Mocks OpenSearch indexing so tests run against SQLite.
"""

import json
from unittest.mock import patch
from uuid import uuid4

import pytest

from app.models import CollectionObject, Location


# Mock OpenSearch indexing for all tests in this module
pytestmark = pytest.mark.usefixtures()


def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


# ============================================================================
# Collection Objects
# ============================================================================


class TestCreateCollectionObject:
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_create_object_minimal(self, mock_index, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects"
        resp = _post_json(auth_client, url, {"object_number": "2024.1.1"})
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["object_number"] == "2024.1.1"
        assert data["organization_id"] == str(org.organization_id)
        assert "object_id" in data
        mock_index.assert_called_once()

    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_create_object_full(self, mock_index, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects"
        payload = {
            "object_number": "2024.2.1",
            "object_name": "Portrait of a Lady",
            "object_type": "painting",
            "brief_description": "Oil on canvas",
            "titles": [{"title": "Portrait of a Lady", "is_preferred": True}],
            "materials": [{"material": "oil paint"}],
            "measurements": [{"type": "height", "value": "100", "unit": "cm"}],
            "acquisition_method": "purchase",
            "credit_line": "Gift of the Foundation",
        }
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["object_name"] == "Portrait of a Lady"
        assert data["object_type"] == "painting"
        assert data["credit_line"] == "Gift of the Foundation"

    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_create_object_duplicate_number(self, mock_index, auth_setup):
        """Creating a second object with the same object_number in the same org returns 409."""
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects"
        body = {"object_number": "DUP-001", "object_name": "First"}
        first = _post_json(auth_client, url, body)
        assert first.status_code == 201
        second = _post_json(auth_client, url, {"object_number": "DUP-001", "object_name": "Second"})
        assert second.status_code == 409
        data = second.get_json()
        err = data.get("error", {})
        assert err.get("code") == "conflict"

    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_create_object_missing_number(self, mock_index, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects"
        resp = _post_json(auth_client, url, {"object_name": "No number"})
        assert resp.status_code in (400, 422)


class TestObjectListSorting:
    """Every advertised sort field must resolve to a real column.

    `title` is the name the search schema and the OpenSearch index use, but the
    column is object_name. It was in the allowlist as a bare string, so it
    passed the check and then raised AttributeError inside getattr —
    ?sort_by=title returned 500 on the database path while working on the
    search path.
    """

    def _url(self, org):
        return f"/api/organizations/{org.organization_id}/collections/objects"

    @pytest.mark.parametrize(
        "sort_by",
        ["created_at", "updated_at", "object_number", "title", "object_name",
         "object_type", "object_status"],
    )
    @pytest.mark.parametrize("sort_order", ["asc", "desc"])
    def test_every_advertised_sort_field_works(self, auth_setup, sort_by, sort_order):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(
            f"{self._url(org)}?sort_by={sort_by}&sort_order={sort_order}"
        )
        assert resp.status_code == 200, f"sort_by={sort_by} returned {resp.status_code}"

    def test_unknown_sort_field_falls_back_rather_than_erroring(self, auth_setup):
        auth_client, org, _ = auth_setup
        resp = auth_client.get(f"{self._url(org)}?sort_by=../../etc/passwd")
        assert resp.status_code == 200

    def test_sort_by_title_orders_by_object_name(self, auth_setup, db_session):
        from app.models import CollectionObject

        auth_client, org, _ = auth_setup
        for num, name in (("SRT-2", "Beta"), ("SRT-1", "Alpha"), ("SRT-3", "Gamma")):
            db_session.add(CollectionObject(
                organization_id=org.organization_id,
                object_number=num,
                object_name=name,
            ))
        db_session.commit()

        resp = auth_client.get(f"{self._url(org)}?sort_by=title&sort_order=asc")
        assert resp.status_code == 200
        names = [o.get("object_name") for o in resp.get_json()["items"]]
        seeded = [n for n in names if n in {"Alpha", "Beta", "Gamma"}]
        assert seeded == sorted(seeded), f"not ordered by object_name: {seeded}"


class TestListCollectionObjects:
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_list_objects_empty(self, mock_index, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_list_objects_with_data(self, mock_index, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects"
        _post_json(auth_client, url, {"object_number": "LIST.1"})
        _post_json(auth_client, url, {"object_number": "LIST.2"})

        resp = auth_client.get(url)
        data = resp.get_json()
        assert data["total"] == 2
        assert len(data["items"]) == 2

    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_list_objects_pagination(self, mock_index, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects"
        for i in range(5):
            _post_json(auth_client, url, {"object_number": f"PAGE.{i}"})

        resp = auth_client.get(f"{url}?limit=2&offset=0")
        data = resp.get_json()
        assert len(data["items"]) == 2
        assert data["total"] == 5


class TestGetCollectionObject:
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_get_object(self, mock_index, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects"
        create_resp = _post_json(auth_client, url, {"object_number": "GET.1", "object_name": "Test"})
        object_id = create_resp.get_json()["object_id"]

        resp = auth_client.get(f"{url}/{object_id}")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["object_number"] == "GET.1"
        assert data["object_name"] == "Test"

    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_get_object_not_found(self, mock_index, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects/{uuid4()}"
        resp = auth_client.get(url)
        assert resp.status_code == 404


class TestUpdateCollectionObject:
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_update_object(self, mock_index, auth_setup):
        auth_client, org, _ = auth_setup
        base = f"/api/organizations/{org.organization_id}/collections/objects"
        create_resp = _post_json(auth_client, base, {"object_number": "UPD.1", "object_name": "Old"})
        object_id = create_resp.get_json()["object_id"]

        resp = _put_json(auth_client, f"{base}/{object_id}", {"object_name": "New Name"})
        assert resp.status_code == 200
        assert resp.get_json()["object_name"] == "New Name"


class TestDeleteCollectionObject:
    @patch("app.fastapi_app.routers.collections_objects._delete_collection_object_from_index")
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_delete_object(self, mock_index, mock_del_index, auth_setup):
        auth_client, org, _ = auth_setup
        base = f"/api/organizations/{org.organization_id}/collections/objects"
        create_resp = _post_json(auth_client, base, {"object_number": "DEL.1"})
        object_id = create_resp.get_json()["object_id"]

        resp = auth_client.delete(f"{base}/{object_id}")
        assert resp.status_code == 200

        # Verify deleted
        resp = auth_client.get(f"{base}/{object_id}")
        assert resp.status_code == 404


# ============================================================================
# Locations
# ============================================================================


class TestCreateLocation:
    def test_create_location(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/locations"
        payload = {
            "name": "Storage Room A",
            "location_type": "room",
            "code": "SRA",
        }
        resp = _post_json(auth_client, url, payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "Storage Room A"
        assert data["location_type"] == "room"

    def test_create_location_missing_required(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/locations"
        resp = _post_json(auth_client, url, {"name": "Room Only"})
        assert resp.status_code in (400, 422)


class TestListLocations:
    def test_list_locations(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/locations"
        _post_json(auth_client, url, {"name": "Room 1", "location_type": "room", "code": "RM1"})
        _post_json(auth_client, url, {"name": "Room 2", "location_type": "room", "code": "RM2"})

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 2


# ============================================================================
# Authorization
# ============================================================================


class TestCollectionsAuth:
    def test_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/objects"
        resp = client.get(url)
        assert resp.status_code == 401

    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_permission_denied_no_create(self, mock_index, client, db_session):
        """User without collections.create permission gets 403."""
        from app.models import (
            Organization, User, OrganizationMembership, Role,
            Permission as PermissionModel, RolePermission,
        )
        from app.services.auth_utils import generate_access_token
        from tests.conftest import AuthenticatedClient

        org = Organization(
            name="Limited Org", slug="limited-org",
        )
        db_session.add(org)
        db_session.flush()

        # Role with view-only permission (no create)
        role = Role(role_key="viewer", display_name="Viewer", description="View only", is_system=False)
        db_session.add(role)
        db_session.flush()
        perm = PermissionModel(
            permission_key="collections.view", scope="collections", action="view",
            display_name="View Collections", description="View",
        )
        db_session.add(perm)
        db_session.flush()
        db_session.add(RolePermission(role_id=role.role_id, permission_id=perm.permission_id))

        user = User(email="viewer@example.com", password_hash="x", status="active")
        db_session.add(user)
        db_session.flush()
        db_session.add(OrganizationMembership(
            organization_id=org.organization_id, user_id=user.user_id,
            role="member", role_id=role.role_id, status="active",
        ))
        db_session.commit()

        token = generate_access_token(
            user_id=str(user.user_id), email=user.email,
            active_organization_id=str(org.organization_id), expires_minutes=60,
        )
        limited_client = AuthenticatedClient(client, token)

        url = f"/api/organizations/{org.organization_id}/collections/objects"
        resp = limited_client.post(
            url, data=json.dumps({"object_number": "NOPE.1"}),
            content_type="application/json",
        )
        assert resp.status_code == 403


class TestCrossOrgIsolation:
    @patch("app.fastapi_app.routers.collections_objects._index_collection_object")
    def test_cross_org_isolation(self, mock_index, auth_setup, db_session):
        """Objects from one org should not be visible to another org's listing."""
        auth_client, org, user = auth_setup

        # Create object in the auth'd org
        url = f"/api/organizations/{org.organization_id}/collections/objects"
        _post_json(auth_client, url, {"object_number": "ISO.1"})

        # Create a second org
        from app.models import Organization
        org2 = Organization(
            name="Other Org", slug="other-org",
        )
        db_session.add(org2)
        db_session.commit()

        # List objects in org2 (should be empty)
        url2 = f"/api/organizations/{org2.organization_id}/collections/objects"
        resp = auth_client.get(url2)
        data = resp.get_json()
        assert data["total"] == 0
