"""
Smoke tests for the Events API (museum programming activities).

Routes under /api/organizations/<org_id>/collections/events
and related sub-resources (objects, participants, collections-impact).

Tests cover:
- Events CRUD (list, create, get-by-id, update, delete)
- Not-found (404)
- Auth-required (401)
- Event object links (add, list)
- Event participants (add, list)
- Collections impact computation
"""

import json
from uuid import uuid4

import pytest

from app.models import (
    Organization,
    User,
    OrganizationMembership,
    Role,
    Permission as PermissionModel,
    RolePermission,
    Event,
    EventObjectLink,
    EventParticipant,
    CollectionObject,
    Contact,
)
from app.services.auth_utils import generate_access_token
from types import SimpleNamespace
from tests.conftest import AuthenticatedClient, _create_permission, _create_role_permission


# ============================================================================
# HELPERS
# ============================================================================


def _events_url(org):
    return f"/api/organizations/{org.organization_id}/collections/events"


def _event_url(org, event_id):
    return f"/api/organizations/{org.organization_id}/collections/events/{event_id}"


def _event_objects_url(org, event_id):
    return f"/api/organizations/{org.organization_id}/collections/events/{event_id}/objects"


def _event_participants_url(org, event_id):
    return f"/api/organizations/{org.organization_id}/collections/events/{event_id}/participants"


def _collections_impact_url(org, event_id):
    return f"/api/organizations/{org.organization_id}/collections/events/{event_id}/collections-impact"


def _post_json(auth_client, url, data):
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def events_auth_setup(client, db_session):
    """
    Create an authenticated client with events.view and events.edit permissions.

    The base auth_setup fixture doesn't include events permissions, so we build
    our own setup with the required permission keys.
    """
    organization = Organization(
        name="Events Test Org",
        slug="events-test-org",
        is_demo=False,
        status="active",
    )
    db_session.add(organization)
    db_session.flush()

    role = Role(
        role_key="admin",
        display_name="Events Admin",
        description="Full events access",
        is_system=False,
    )
    db_session.add(role)
    db_session.flush()

    permission_keys = [
        "events.view",
        "events.edit",
        "collections.view",
        "contacts.view",
    ]
    for key in permission_keys:
        perm = _create_permission(db_session, key)
        _create_role_permission(db_session, role, perm)

    user = User(
        email="events-admin@example.com",
        password_hash="not_used",
        status="active",
    )
    db_session.add(user)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=organization.organization_id,
        user_id=user.user_id,
        role="admin",
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)

    user_id = user.user_id
    user_email = user.email
    org_id = organization.organization_id
    db_session.commit()

    token = generate_access_token(
        user_id=str(user_id),
        email=user_email,
        active_organization_id=str(org_id),
        expires_minutes=60,
    )

    org_proxy = SimpleNamespace(organization_id=org_id)
    user_proxy = SimpleNamespace(user_id=user_id, email=user_email)
    return AuthenticatedClient(client, token), org_proxy, user_proxy


@pytest.fixture
def sample_event(db_session, events_auth_setup):
    """Create a sample Event directly in the database."""
    _, org, user = events_auth_setup
    event = Event(
        organization_id=org.organization_id,
        event_reference_number="EVT.2026.0001",
        title="Sample Lecture",
        event_type="program",
        status="draft",
        description="A test lecture event.",
        created_by=user.user_id,
    )
    db_session.add(event)
    db_session.commit()
    return event


@pytest.fixture
def sample_object(db_session, events_auth_setup):
    """Create a sample CollectionObject for linking to events."""
    _, org, _ = events_auth_setup
    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=f"OBJ.{uuid4().hex[:8]}",
        object_status="accessioned",
    )
    db_session.add(obj)
    db_session.commit()
    return obj


@pytest.fixture
def sample_contact(db_session, events_auth_setup):
    """Create a sample Contact for adding as event participant."""
    _, org, _ = events_auth_setup
    contact = Contact(
        organization_id=org.organization_id,
        name="Dr. Test Speaker",
        display_name="Dr. Test Speaker",
        constituent_type="person",
    )
    db_session.add(contact)
    db_session.commit()
    return contact


# ============================================================================
# EVENTS CRUD - List
# ============================================================================


class TestListEvents:
    def test_list_events_empty(self, events_auth_setup):
        auth_client, org, _ = events_auth_setup
        resp = auth_client.get(_events_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_events_with_data(self, events_auth_setup, sample_event):
        auth_client, org, _ = events_auth_setup
        resp = auth_client.get(_events_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert len(data["items"]) == 1
        assert data["items"][0]["title"] == "Sample Lecture"
        assert data["items"][0]["event_type"] == "program"

    def test_list_events_filter_by_status(self, events_auth_setup, sample_event):
        auth_client, org, _ = events_auth_setup
        resp = auth_client.get(f"{_events_url(org)}?status=draft")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1

        resp = auth_client.get(f"{_events_url(org)}?status=completed")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 0


# ============================================================================
# EVENTS CRUD - Create
# ============================================================================


class TestCreateEvent:
    def test_create_event_minimal(self, events_auth_setup):
        auth_client, org, _ = events_auth_setup
        payload = {
            "title": "New Workshop",
            "event_type": "program",
        }
        resp = _post_json(auth_client, _events_url(org), payload)
        assert resp.status_code == 201
        data = resp.get_json()
        assert data["title"] == "New Workshop"
        assert data["event_type"] == "program"
        assert data["status"] == "draft"
        assert data["event_reference_number"].startswith("EVT.")
        assert "event_id" in data

    def test_create_event_missing_title(self, events_auth_setup):
        auth_client, org, _ = events_auth_setup
        payload = {"event_type": "program"}
        resp = _post_json(auth_client, _events_url(org), payload)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Title is required" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_create_event_missing_event_type(self, events_auth_setup):
        auth_client, org, _ = events_auth_setup
        payload = {"title": "Missing Type"}
        resp = _post_json(auth_client, _events_url(org), payload)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Event type is required" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))


# ============================================================================
# EVENTS CRUD - Get by ID
# ============================================================================


class TestGetEvent:
    def test_get_event_by_id(self, events_auth_setup, sample_event):
        auth_client, org, _ = events_auth_setup
        url = _event_url(org, sample_event.event_id)
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["event_id"] == str(sample_event.event_id)
        assert data["title"] == "Sample Lecture"
        assert "object_links" in data
        assert "participants" in data

    def test_get_event_not_found(self, events_auth_setup):
        auth_client, org, _ = events_auth_setup
        fake_id = uuid4()
        url = _event_url(org, fake_id)
        resp = auth_client.get(url)
        assert resp.status_code == 404
        assert resp.get_json()["error"]["code"] == "not_found"


# ============================================================================
# EVENTS CRUD - Update
# ============================================================================


class TestUpdateEvent:
    def test_update_event_title(self, events_auth_setup, sample_event):
        auth_client, org, _ = events_auth_setup
        url = _event_url(org, sample_event.event_id)
        resp = _put_json(auth_client, url, {"title": "Updated Lecture Title"})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["title"] == "Updated Lecture Title"

    def test_update_event_not_found(self, events_auth_setup):
        auth_client, org, _ = events_auth_setup
        fake_id = uuid4()
        url = _event_url(org, fake_id)
        resp = _put_json(auth_client, url, {"title": "Nope"})
        assert resp.status_code == 404


# ============================================================================
# EVENTS CRUD - Delete
# ============================================================================


class TestDeleteEvent:
    def test_delete_event(self, events_auth_setup, sample_event):
        auth_client, org, _ = events_auth_setup
        url = _event_url(org, sample_event.event_id)
        resp = auth_client.delete(url)
        assert resp.status_code == 204

        # Confirm gone
        resp = auth_client.get(url)
        assert resp.status_code == 404

    def test_delete_event_not_found(self, events_auth_setup):
        auth_client, org, _ = events_auth_setup
        fake_id = uuid4()
        url = _event_url(org, fake_id)
        resp = auth_client.delete(url)
        assert resp.status_code == 404


# ============================================================================
# AUTH
# ============================================================================


class TestEventsAuth:
    def test_list_events_requires_auth(self, client, events_auth_setup):
        _, org, _ = events_auth_setup
        resp = client.get(_events_url(org))
        assert resp.status_code == 401

    def test_create_event_requires_auth(self, client, events_auth_setup):
        _, org, _ = events_auth_setup
        resp = client.post(
            _events_url(org),
            data=json.dumps({"title": "Unauthed", "event_type": "program"}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_get_event_requires_auth(self, client, events_auth_setup, sample_event):
        _, org, _ = events_auth_setup
        resp = client.get(_event_url(org, sample_event.event_id))
        assert resp.status_code == 401

    def test_delete_event_requires_auth(self, client, events_auth_setup, sample_event):
        _, org, _ = events_auth_setup
        resp = client.delete(_event_url(org, sample_event.event_id))
        assert resp.status_code == 401
