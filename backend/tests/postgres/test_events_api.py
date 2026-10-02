"""
Tests for Events API endpoints.

Tests the museum programming activities:
- Events: Teaching sessions, programs, openings, etc.
- Event object links: Objects referenced by events
- Event participants: Constituents participating in events
- Collections impact: Procedure suggestions

These tests require PostgreSQL because the event models use the 'collections' schema.
Run with: TEST_DATABASE_URL=postgresql://... pytest tests/test_events_api.py -v
"""

import os
import pytest
from uuid import uuid4

from app.models import (
    User,
    Organization,
    OrganizationMembership,
    Role,
    RolePermission,
    Event,
    EventObjectLink,
    ConstituentXref,
    CollectionObject,
    Constituent,
)
from app.permissions import Permission

# Mark all tests in this file as requiring PostgreSQL
pytestmark = pytest.mark.postgres


@pytest.fixture
def setup_user_with_permissions(db_session):
    """Create organization, user, and role with events permissions."""
    # Create organization
    org = Organization(
        name="Test Museum",
        slug=f"test-museum-{uuid4().hex[:8]}",
        status="active"
    )
    db_session.add(org)
    db_session.flush()

    # Create user
    user = User(
        email=f"registrar-{uuid4().hex[:8]}@example.com",
        password_hash="fakehash",
        status="active"
    )
    db_session.add(user)
    db_session.flush()

    # Create role with events permissions
    role = Role(
        role_key=f"registrar-{uuid4().hex[:8]}",
        display_name="Registrar",
        description="Test registrar role",
        is_system=False
    )
    db_session.add(role)
    db_session.flush()

    # Add permissions
    from app.models import Permission as PermissionModel
    for perm_key in [
        Permission.EVENTS_VIEW.value,
        Permission.EVENTS_EDIT.value,
        Permission.COLLECTIONS_VIEW.value,
        Permission.CONTACTS_VIEW.value,
    ]:
        perm = db_session.query(PermissionModel).filter_by(permission_key=perm_key).first()
        if not perm:
            # Parse scope and action from permission key (e.g., "events.view" -> scope="events", action="view")
            parts = perm_key.split(".")
            scope = parts[0] if len(parts) > 0 else "general"
            action = parts[1] if len(parts) > 1 else "view"
            perm = PermissionModel(
                permission_key=perm_key,
                scope=scope,
                action=action,
                display_name=f"Test {perm_key}",
                description=f"Test permission for {perm_key}"
            )
            db_session.add(perm)
            db_session.flush()
        role_perm = RolePermission(role_id=role.role_id, permission_id=perm.permission_id)
        db_session.add(role_perm)

    # Create membership
    membership = OrganizationMembership(
        user_id=user.user_id,
        organization_id=org.organization_id,
        role="admin",  # Legacy role column
        role_id=role.role_id,
        status="active"
    )
    db_session.add(membership)
    db_session.commit()

    return {"org": org, "user": user, "role": role}


@pytest.fixture
def setup_test_object(db_session, setup_user_with_permissions):
    """Create a test collection object."""
    org = setup_user_with_permissions["org"]

    obj = CollectionObject(
        organization_id=org.organization_id,
        object_number=f"OBJ.{uuid4().hex[:8]}",
        object_name="Test Object",
        object_status="accessioned",
    )
    db_session.add(obj)
    db_session.commit()

    return obj


@pytest.fixture
def setup_test_constituent(db_session, setup_user_with_permissions):
    """Create a test constituent for event participant tests."""
    org = setup_user_with_permissions["org"]

    constituent = Constituent(
        organization_id=org.organization_id,
        name="Prof. Smith",
        constituent_type="person",
        email="smith@university.edu",
    )
    db_session.add(constituent)
    db_session.commit()

    return constituent


class TestEventsAPI:
    """Tests for Events CRUD endpoints."""

    def test_list_events_empty(self, client, setup_user_with_permissions):
        """Test listing events when none exist."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )

        response = client.get(
            f"/api/organizations/{org.organization_id}/collections/events",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "items" in data
        assert len(data["items"]) == 0
        assert data["total"] == 0

    def test_create_event(self, client, setup_user_with_permissions):
        """Test creating a new event."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )

        event_data = {
            "title": "Introduction to Art History",
            "event_type": "teaching_session",
            "status": "draft",
            "course_code": "AH101",
            "institution": "University of Art",
            "department": "Art History",
            "headcount": 25,
            "session_format": "gallery",
            "description": "An introduction to major art movements.",
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/collections/events",
            json=event_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert data["title"] == "Introduction to Art History"
        assert data["event_type"] == "teaching_session"
        assert data["status"] == "draft"
        assert data["course_code"] == "AH101"
        assert data["event_reference_number"].startswith("EVT.")
        assert "event_id" in data

    def test_create_event_validation(self, client, setup_user_with_permissions):
        """Test event creation validation."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )

        # Missing title
        response = client.post(
            f"/api/organizations/{org.organization_id}/collections/events",
            json={"event_type": "program"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 400

        # Missing event_type
        response = client.post(
            f"/api/organizations/{org.organization_id}/collections/events",
            json={"title": "Test Event"},
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 400

    def test_get_event(self, client, setup_user_with_permissions, db_session):
        """Test getting a single event."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )

        # Create event directly
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0001",
            title="Gallery Tour",
            event_type="program",
            status="scheduled",
            audience="public",
        )
        db_session.add(event)
        db_session.commit()

        response = client.get(
            f"/api/organizations/{org.organization_id}/collections/events/{event.event_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["title"] == "Gallery Tour"
        assert data["event_type"] == "program"
        assert data["audience"] == "public"

    def test_update_event(self, client, setup_user_with_permissions, db_session):
        """Test updating an event."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )

        # Create event
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0002",
            title="Original Title",
            event_type="program",
            status="draft",
        )
        db_session.add(event)
        db_session.commit()

        # Update event
        response = client.patch(
            f"/api/organizations/{org.organization_id}/collections/events/{event.event_id}",
            json={
                "title": "Updated Title",
                "status": "scheduled",
                "capacity": 50,
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["title"] == "Updated Title"
        assert data["status"] == "scheduled"
        assert data["capacity"] == 50

    def test_delete_event(self, client, setup_user_with_permissions, db_session):
        """Test deleting an event."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )

        # Create event
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0003",
            title="Event to Delete",
            event_type="internal",
            status="draft",
        )
        db_session.add(event)
        db_session.commit()
        event_id = event.event_id

        # Delete event
        response = client.delete(
            f"/api/organizations/{org.organization_id}/collections/events/{event_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 204

        # Verify deleted
        response = client.get(
            f"/api/organizations/{org.organization_id}/collections/events/{event_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert response.status_code == 404


class TestEventObjectLinksAPI:
    """Tests for Event object linking endpoints."""

    def test_add_object_to_event(
        self, client, setup_user_with_permissions, setup_test_object, db_session
    ):
        """Test linking an object to an event."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )
        obj = setup_test_object

        # Create event
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0010",
            title="Teaching Session",
            event_type="teaching_session",
            status="draft",
        )
        db_session.add(event)
        db_session.commit()

        # Link object
        response = client.post(
            f"/api/organizations/{org.organization_id}/collections/events/{event.event_id}/objects",
            json={
                "object_id": str(obj.object_id),
                "role": "primary",
                "planned_use": "handle",
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert data["object_id"] == str(obj.object_id)
        assert data["role"] == "primary"
        assert data["planned_use"] == "handle"

    def test_list_event_objects(
        self, client, setup_user_with_permissions, setup_test_object, db_session
    ):
        """Test listing objects linked to an event."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )
        obj = setup_test_object

        # Create event with linked object
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0011",
            title="Test Event",
            event_type="program",
            status="draft",
        )
        db_session.add(event)
        db_session.flush()

        link = EventObjectLink(
            organization_id=org.organization_id,
            event_id=event.event_id,
            object_id=obj.object_id,
            role="primary",
            planned_use="display",
        )
        db_session.add(link)
        db_session.commit()

        # List objects
        response = client.get(
            f"/api/organizations/{org.organization_id}/collections/events/{event.event_id}/objects",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["total"] == 1
        assert len(data["objects"]) == 1
        assert data["objects"][0]["object_id"] == str(obj.object_id)

    def test_remove_object_from_event(
        self, client, setup_user_with_permissions, setup_test_object, db_session
    ):
        """Test removing an object from an event."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )
        obj = setup_test_object

        # Create event with linked object
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0012",
            title="Test Event",
            event_type="program",
            status="draft",
        )
        db_session.add(event)
        db_session.flush()

        link = EventObjectLink(
            organization_id=org.organization_id,
            event_id=event.event_id,
            object_id=obj.object_id,
            role="primary",
            planned_use="display",
        )
        db_session.add(link)
        db_session.commit()
        link_id = link.event_object_id

        # Remove link
        response = client.delete(
            f"/api/organizations/{org.organization_id}/collections/events/{event.event_id}/objects/{link_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 204


class TestCollectionsImpactAPI:
    """Tests for collections impact computation."""

    def test_collections_impact_empty(
        self, client, setup_user_with_permissions, db_session
    ):
        """Test collections impact with no objects."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )

        # Create event without objects
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0020",
            title="Event Without Objects",
            event_type="program",
            status="scheduled",
        )
        db_session.add(event)
        db_session.commit()

        response = client.get(
            f"/api/organizations/{org.organization_id}/collections/events/{event.event_id}/collections-impact",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["total_objects"] == 0
        assert data["needs_movement_plan"] is False
        assert data["needs_condition_checks"] is False
        assert data["needs_rights_verification"] is False

    def test_collections_impact_with_handling(
        self, client, setup_user_with_permissions, setup_test_object, db_session
    ):
        """Test collections impact when objects need handling."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )
        obj = setup_test_object

        # Create event with object for handling
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0021",
            title="Handling Session",
            event_type="teaching_session",
            status="scheduled",
        )
        db_session.add(event)
        db_session.flush()

        link = EventObjectLink(
            organization_id=org.organization_id,
            event_id=event.event_id,
            object_id=obj.object_id,
            role="primary",
            planned_use="handle",
        )
        db_session.add(link)
        db_session.commit()

        response = client.get(
            f"/api/organizations/{org.organization_id}/collections/events/{event.event_id}/collections-impact",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["total_objects"] == 1
        assert data["needs_movement_plan"] is True
        assert data["needs_condition_checks"] is True
        assert len(data["objects_needing_movement"]) == 1
        assert len(data["objects_needing_condition_check"]) == 1

    def test_collections_impact_with_photography(
        self, client, setup_user_with_permissions, setup_test_object, db_session
    ):
        """Test collections impact when objects will be photographed."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )
        obj = setup_test_object

        # Create event with object for photography
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0022",
            title="Photography Session",
            event_type="internal",
            status="scheduled",
        )
        db_session.add(event)
        db_session.flush()

        link = EventObjectLink(
            organization_id=org.organization_id,
            event_id=event.event_id,
            object_id=obj.object_id,
            role="primary",
            planned_use="photograph",
        )
        db_session.add(link)
        db_session.commit()

        response = client.get(
            f"/api/organizations/{org.organization_id}/collections/events/{event.event_id}/collections-impact",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["total_objects"] == 1
        assert data["needs_rights_verification"] is True
        assert len(data["objects_needing_rights_check"]) == 1


class TestEventParticipantsAPI:
    """Tests for Event participants endpoints."""

    def test_add_participant(
        self, client, setup_user_with_permissions, setup_test_constituent, db_session
    ):
        """Test adding a participant to an event."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )
        constituent = setup_test_constituent

        # Create event
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0030",
            title="Lecture",
            event_type="program",
            status="draft",
        )
        db_session.add(event)
        db_session.commit()

        # Add participant
        response = client.post(
            f"/api/organizations/{org.organization_id}/collections/events/{event.event_id}/participants",
            json={
                "constituent_id": str(constituent.constituent_id),
                "role": "speaker",
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert data["constituent_id"] == str(constituent.constituent_id)
        assert data["role"] == "speaker"

    def test_remove_participant(
        self, client, setup_user_with_permissions, setup_test_constituent, db_session
    ):
        """Test removing a participant from an event."""
        from app.services.auth_utils import generate_access_token

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = generate_access_token(
            str(user.user_id),
            user.email,
            str(org.organization_id)
        )
        constituent = setup_test_constituent

        # Create event with participant
        event = Event(
            organization_id=org.organization_id,
            event_reference_number="EVT.2026.0031",
            title="Workshop",
            event_type="program",
            status="draft",
        )
        db_session.add(event)
        db_session.flush()

        xref = ConstituentXref(
            organization_id=org.organization_id,
            constituent_id=constituent.constituent_id,
            entity_type="event",
            entity_id=event.event_id,
            role="instructor",
        )
        db_session.add(xref)
        db_session.commit()
        xref_id = xref.xref_id

        # Remove participant
        response = client.delete(
            f"/api/organizations/{org.organization_id}/collections/events/{event.event_id}/participants/{xref_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 204
