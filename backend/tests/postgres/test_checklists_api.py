"""
Tests for Exhibition Checklists API endpoints.

Tests the checklist system:
- Checklist templates: Reusable, versioned templates
- Template versions: Immutable once used by an exhibition
- Template items: Tasks within a version
- Exhibition checklists: Instances applied to exhibitions
- Checklist items: Actual tasks with status tracking
- Item links: Connections to other entities

These tests require PostgreSQL because the checklist models use PostgreSQL-specific enums.
Run with: TEST_DATABASE_URL=postgresql://... pytest tests/postgres/test_checklists_api.py -v
"""

import os
import pytest
from datetime import date, timedelta
from uuid import uuid4

from app.models import (
    User,
    Organization,
    OrganizationMembership,
    Role,
    RolePermission,
    ChecklistTemplate,
    ChecklistTemplateVersion,
    ChecklistTemplateItem,
    ExhibitionChecklist,
    ChecklistItem,
    ChecklistItemLink,
    ChecklistPhase,
    ChecklistRole,
    ChecklistItemStatus,
    ChecklistExhibitionType,
    Venue,
    Exhibition,
)
from app.permissions import Permission

# Mark all tests in this file as requiring PostgreSQL
pytestmark = pytest.mark.postgres


@pytest.fixture
def setup_org_user(db_session):
    """Create organization and user with exhibit permissions."""
    org = Organization(
        name="Test Museum",
        slug=f"test-museum-{uuid4().hex[:8]}",
        status="active"
    )
    db_session.add(org)
    db_session.flush()

    user = User(
        email=f"curator-{uuid4().hex[:8]}@example.com",
        password_hash="fakehash",
        status="active"
    )
    db_session.add(user)
    db_session.flush()

    role = Role(
        role_key=f"curator-{uuid4().hex[:8]}",
        display_name="Curator",
        is_system=False,
        organization_id=org.organization_id,
    )
    db_session.add(role)
    db_session.flush()

    from app.models import Permission as PermissionModel
    for perm_key in [
        Permission.EXHIBIT_VIEW.value,
        Permission.EXHIBIT_CREATE.value,
        Permission.EXHIBIT_EDIT.value,
        Permission.EXHIBIT_DELETE.value,
    ]:
        perm = db_session.query(PermissionModel).filter_by(permission_key=perm_key).first()
        if not perm:
            perm = PermissionModel(
                permission_key=perm_key,
                scope=(perm_key).rpartition(".")[0] or (perm_key),
                action=(perm_key).rpartition(".")[2] or (perm_key),
                display_name=(perm_key).replace(".", " ").title(),
                description=f"Test {perm_key}"
            )
            db_session.add(perm)
            db_session.flush()
        role_perm = RolePermission(role_id=role.role_id, permission_id=perm.permission_id)
        db_session.add(role_perm)

    membership = OrganizationMembership(
        user_id=user.user_id,
        organization_id=org.organization_id,
        role="admin",
        role_id=role.role_id,
        status="active"
    )
    db_session.add(membership)
    db_session.commit()

    return {"org": org, "user": user, "role": role}


@pytest.fixture
def setup_exhibition(db_session, setup_org_user):
    """Create a venue and exhibition for checklist tests."""
    org = setup_org_user["org"]

    venue = Venue(
        organization_id=org.organization_id,
        name="Main Gallery",
        default_ceiling_height_cm=300,
        default_wall_color="#FFFFFF"
    )
    db_session.add(venue)
    db_session.flush()

    exhibition = Exhibition(
        organization_id=org.organization_id,
        venue_id=venue.venue_id,
        title="Test Exhibition",
        status="proposed"
    )
    db_session.add(exhibition)
    db_session.commit()

    return {
        **setup_org_user,
        "venue": venue,
        "exhibition": exhibition
    }


class TestChecklistTemplateAPI:
    """Tests for Checklist Template CRUD endpoints."""

    def test_create_template(self, client, setup_org_user):
        """Test creating a new checklist template."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]
        token = create_access_token(user.user_id, org.organization_id)

        template_data = {
            "name": "Standard In-House Exhibition",
            "description": "Checklist for in-house exhibitions",
            "exhibition_type": "in_house"
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates",
            json=template_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        payload = response.get_json()
        data = payload["template"]
        assert "template_id" in data
        assert data["name"] == "Standard In-House Exhibition"
        assert data["exhibition_type"] == "in_house"
        # Should create initial draft version
        assert "versions" in data
        assert len(data["versions"]) == 1
        assert data["versions"][0]["version_number"] == 1
        assert data["versions"][0]["is_published"] is False

    def test_list_templates(self, client, db_session, setup_org_user):
        """Test listing checklist templates."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]

        # Create templates directly
        template1 = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Template 1",
            exhibition_type="in_house",
            created_by=user.user_id
        )
        template2 = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Template 2",
            exhibition_type="incoming_traveling",
            created_by=user.user_id
        )
        db_session.add_all([template1, template2])
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "templates" in data
        assert len(data["templates"]) >= 2

    def test_get_template(self, client, db_session, setup_org_user):
        """Test getting a single template with versions."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]

        template = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Test Template",
            exhibition_type="general",
            created_by=user.user_id
        )
        db_session.add(template)
        db_session.flush()

        version = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=1,
            is_published=True,
            created_by=user.user_id
        )
        db_session.add(version)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates/{template.template_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        payload = response.get_json()
        data = payload["template"]
        assert data["template_id"] == str(template.template_id)
        assert "versions" in data
        assert len(data["versions"]) == 1

    def test_archive_template(self, client, db_session, setup_org_user):
        """Test archiving a template."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]

        template = ChecklistTemplate(
            organization_id=org.organization_id,
            name="To Archive",
            exhibition_type="general"
        )
        db_session.add(template)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.patch(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates/{template.template_id}",
            json={"is_archived": True},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        payload = response.get_json()
        data = payload["template"]
        assert data["is_archived"] is True


class TestTemplateVersionAPI:
    """Tests for Template Version endpoints."""

    def test_create_new_version(self, client, db_session, setup_org_user):
        """Test creating a new version of a template."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]

        template = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Test Template",
            exhibition_type="in_house"
        )
        db_session.add(template)
        db_session.flush()

        version1 = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=1,
            is_published=True,
            is_locked=True
        )
        db_session.add(version1)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates/{template.template_id}/versions",
            json={"change_notes": "Updated for 2026 requirements"},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        payload = response.get_json()
        data = payload["version"]
        assert data["version_number"] == 2
        assert data["is_published"] is False
        assert data["change_notes"] == "Updated for 2026 requirements"

    def test_publish_version(self, client, db_session, setup_org_user):
        """Test publishing a version."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]

        template = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Test Template",
            exhibition_type="in_house"
        )
        db_session.add(template)
        db_session.flush()

        version = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=1,
            is_published=False
        )
        db_session.add(version)
        db_session.flush()

        # Publish requires at least one item
        item = ChecklistTemplateItem(
            version_id=version.version_id,
            phase=ChecklistPhase.PLANNING,
            title="Test Task",
            responsible_role=ChecklistRole.CURATOR,
            sort_order=1
        )
        db_session.add(item)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates/{template.template_id}/versions/{version.version_id}/publish",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        payload = response.get_json()
        data = payload["version"]
        assert data["is_published"] is True


class TestVersionImmutability:
    """Tests for template version immutability when used by exhibitions."""

    def test_version_locked_when_applied_to_exhibition(self, client, db_session, setup_exhibition):
        """Test that applying a template version to an exhibition locks the version."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        exhibition = setup_exhibition["exhibition"]

        # Create template with published version
        template = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Test Template",
            exhibition_type="in_house"
        )
        db_session.add(template)
        db_session.flush()

        version = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=1,
            is_published=True,
            is_locked=False  # Not yet locked
        )
        db_session.add(version)
        db_session.flush()

        # Add an item to the version
        item = ChecklistTemplateItem(
            version_id=version.version_id,
            phase=ChecklistPhase.PLANNING,
            title="Test Task",
            responsible_role=ChecklistRole.CURATOR,
            sort_order=1
        )
        db_session.add(item)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        # Apply template to exhibition
        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/checklists",
            json={
                "template_version_id": str(version.version_id),
                "name": "Exhibition Checklist"
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201

        # Verify version is now locked
        db_session.refresh(version)
        assert version.is_locked is True

    def test_cannot_modify_locked_version(self, client, db_session, setup_org_user):
        """Test that locked versions cannot be modified."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]

        template = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Test Template",
            exhibition_type="in_house"
        )
        db_session.add(template)
        db_session.flush()

        version = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=1,
            is_published=True,
            is_locked=True  # Already locked
        )
        db_session.add(version)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        # Try to add item to locked version
        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates/{template.template_id}/versions/{version.version_id}/items",
            json={
                "phase": "planning",
                "title": "New Task",
                "responsible_role": "curator"
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        # Locked-version mutations return 409 Conflict.
        # Flagging as a prod semantics issue; test reflects current behavior.
        assert response.status_code == 409
        data = response.get_json()
        # Error envelope: {"error": {"code": ..., "message": ...}}
        message = data.get("error", {}).get("message", "") if isinstance(data.get("error"), dict) else data.get("detail", "")
        assert "locked" in message.lower()

    def test_cannot_delete_item_from_locked_version(self, client, db_session, setup_org_user):
        """Test that items cannot be deleted from locked versions."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]

        template = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Test Template",
            exhibition_type="in_house"
        )
        db_session.add(template)
        db_session.flush()

        version = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=1,
            is_published=True,
            is_locked=True
        )
        db_session.add(version)
        db_session.flush()

        item = ChecklistTemplateItem(
            version_id=version.version_id,
            phase=ChecklistPhase.PLANNING,
            title="Existing Task",
            responsible_role=ChecklistRole.CURATOR,
            sort_order=1
        )
        db_session.add(item)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.delete(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates/{template.template_id}/versions/{version.version_id}/items/{item.template_item_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        # Locked-version mutations return 409 Conflict.
        assert response.status_code == 409


class TestTemplateItemAPI:
    """Tests for Template Item endpoints."""

    def test_add_item_to_version(self, client, db_session, setup_org_user):
        """Test adding an item to a draft version."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]

        template = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Test Template",
            exhibition_type="in_house"
        )
        db_session.add(template)
        db_session.flush()

        version = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=1,
            is_published=False,
            is_locked=False
        )
        db_session.add(version)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        item_data = {
            "phase": "planning",
            "title": "Finalize exhibition concept",
            "description": "Work with curator to define theme and scope",
            "responsible_role": "exhibitions_manager",
            "default_due_offset_days": -180,  # 6 months before opening
            "is_required": True
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates/{template.template_id}/versions/{version.version_id}/items",
            json=item_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        payload = response.get_json()
        data = payload["item"]
        assert "template_item_id" in data
        assert data["title"] == "Finalize exhibition concept"
        assert data["phase"] == "planning"
        assert data["default_due_offset_days"] == -180

    def test_update_item(self, client, db_session, setup_org_user):
        """Test updating an item in a draft version."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]

        template = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Test Template",
            exhibition_type="in_house"
        )
        db_session.add(template)
        db_session.flush()

        version = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=1,
            is_published=False,
            is_locked=False
        )
        db_session.add(version)
        db_session.flush()

        item = ChecklistTemplateItem(
            version_id=version.version_id,
            phase=ChecklistPhase.PLANNING,
            title="Original Title",
            responsible_role=ChecklistRole.CURATOR,
            sort_order=1
        )
        db_session.add(item)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.patch(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates/{template.template_id}/versions/{version.version_id}/items/{item.template_item_id}",
            json={"title": "Updated Title", "is_required": False},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        payload = response.get_json()
        data = payload["item"]
        assert data["title"] == "Updated Title"
        assert data["is_required"] is False


class TestExhibitionChecklistAPI:
    """Tests for Exhibition Checklist endpoints."""

    def test_create_checklist_from_template(self, client, db_session, setup_exhibition):
        """Test creating an exhibition checklist from a template."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        exhibition = setup_exhibition["exhibition"]

        # Create template with items
        template = ChecklistTemplate(
            organization_id=org.organization_id,
            name="Test Template",
            exhibition_type="in_house"
        )
        db_session.add(template)
        db_session.flush()

        version = ChecklistTemplateVersion(
            template_id=template.template_id,
            version_number=1,
            is_published=True
        )
        db_session.add(version)
        db_session.flush()

        items = [
            ChecklistTemplateItem(
                version_id=version.version_id,
                phase=ChecklistPhase.PLANNING,
                title="Task 1",
                responsible_role=ChecklistRole.CURATOR,
                sort_order=1
            ),
            ChecklistTemplateItem(
                version_id=version.version_id,
                phase=ChecklistPhase.INSTALL,
                title="Task 2",
                responsible_role=ChecklistRole.PREPARATOR,
                sort_order=2
            )
        ]
        db_session.add_all(items)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/checklists",
            json={
                "template_version_id": str(version.version_id),
                "name": "Main Checklist"
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        payload = response.get_json()
        data = payload["checklist"]
        assert "checklist_id" in data
        assert data["name"] == "Main Checklist"
        assert len(data["items"]) == 2

    def test_create_blank_checklist(self, client, db_session, setup_exhibition):
        """Test creating a blank exhibition checklist (no template)."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        exhibition = setup_exhibition["exhibition"]

        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/checklists",
            json={"name": "Custom Checklist"},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        payload = response.get_json()
        data = payload["checklist"]
        assert data["name"] == "Custom Checklist"
        assert data["template_version_id"] is None
        assert len(data["items"]) == 0


class TestChecklistItemStatusTransitions:
    """Tests for checklist item status transitions and tracking."""

    def test_status_update_tracks_completion(self, client, db_session, setup_exhibition):
        """Test that marking item as done sets completed_at and completed_by."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        exhibition = setup_exhibition["exhibition"]

        # Create checklist with item
        checklist = ExhibitionChecklist(
            exhibition_id=exhibition.exhibition_id,
            name="Test Checklist"
        )
        db_session.add(checklist)
        db_session.flush()

        item = ChecklistItem(
            checklist_id=checklist.checklist_id,
            phase=ChecklistPhase.PLANNING,
            title="Test Task",
            responsible_role=ChecklistRole.CURATOR,
            status=ChecklistItemStatus.TODO,
            sort_order=1
        )
        db_session.add(item)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        # Update status to done
        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/checklists/{checklist.checklist_id}/items/{item.item_id}/status",
            json={"status": "done"},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        payload = response.get_json()
        data = payload["item"]
        assert data["status"] == "done"
        assert data["completed_at"] is not None
        assert data["completed_by"] == str(user.user_id)

    def test_status_not_applicable_tracks_completion(self, client, db_session, setup_exhibition):
        """Marking item as N/A sets completed_at — N/A is terminal for progress tracking."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        exhibition = setup_exhibition["exhibition"]

        checklist = ExhibitionChecklist(
            exhibition_id=exhibition.exhibition_id,
            name="Test Checklist"
        )
        db_session.add(checklist)
        db_session.flush()

        item = ChecklistItem(
            checklist_id=checklist.checklist_id,
            phase=ChecklistPhase.TRAVEL,
            title="Coordinate with traveling venue",
            responsible_role=ChecklistRole.REGISTRAR,
            status=ChecklistItemStatus.TODO,
            sort_order=1
        )
        db_session.add(item)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/checklists/{checklist.checklist_id}/items/{item.item_id}/status",
            json={"status": "not_applicable", "notes": "This is an in-house exhibition"},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        payload = response.get_json()
        data = payload["item"]
        assert data["status"] == "not_applicable"
        assert data["completed_at"] is not None
        assert data["completed_by"] == str(user.user_id)

    def test_reopening_item_clears_completion(self, client, db_session, setup_exhibition):
        """Test that reopening a completed item clears completion tracking."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)
        from datetime import datetime

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        exhibition = setup_exhibition["exhibition"]

        checklist = ExhibitionChecklist(
            exhibition_id=exhibition.exhibition_id,
            name="Test Checklist"
        )
        db_session.add(checklist)
        db_session.flush()

        # Create already-completed item
        item = ChecklistItem(
            checklist_id=checklist.checklist_id,
            phase=ChecklistPhase.PLANNING,
            title="Completed Task",
            responsible_role=ChecklistRole.CURATOR,
            status=ChecklistItemStatus.DONE,
            completed_at=datetime.utcnow(),
            completed_by=user.user_id,
            sort_order=1
        )
        db_session.add(item)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        # Reopen the item
        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/checklists/{checklist.checklist_id}/items/{item.item_id}/status",
            json={"status": "in_progress"},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        payload = response.get_json()
        data = payload["item"]
        assert data["status"] == "in_progress"
        assert data["completed_at"] is None
        assert data["completed_by"] is None


class TestChecklistItemLinks:
    """Tests for linking checklist items to other entities."""

    def test_add_link_to_item(self, client, db_session, setup_exhibition):
        """Test adding a link from checklist item to another entity."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        exhibition = setup_exhibition["exhibition"]

        checklist = ExhibitionChecklist(
            exhibition_id=exhibition.exhibition_id,
            name="Test Checklist"
        )
        db_session.add(checklist)
        db_session.flush()

        item = ChecklistItem(
            checklist_id=checklist.checklist_id,
            phase=ChecklistPhase.PLANNING,
            title="Finalize loan agreements",
            responsible_role=ChecklistRole.REGISTRAR,
            status=ChecklistItemStatus.TODO,
            sort_order=1
        )
        db_session.add(item)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        # Link to a loan entity (simulated ID)
        loan_id = str(uuid4())
        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/checklists/{checklist.checklist_id}/items/{item.item_id}/links",
            json={
                "linked_entity_type": "loan",
                "linked_entity_id": loan_id
            },
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        payload = response.get_json()
        data = payload["link"]
        assert "link_id" in data
        assert data["linked_entity_type"] == "loan"
        assert data["linked_entity_id"] == loan_id

    def test_remove_link_from_item(self, client, db_session, setup_exhibition):
        """Test removing a link from a checklist item."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        exhibition = setup_exhibition["exhibition"]

        checklist = ExhibitionChecklist(
            exhibition_id=exhibition.exhibition_id,
            name="Test Checklist"
        )
        db_session.add(checklist)
        db_session.flush()

        item = ChecklistItem(
            checklist_id=checklist.checklist_id,
            phase=ChecklistPhase.PLANNING,
            title="Test Task",
            responsible_role=ChecklistRole.REGISTRAR,
            status=ChecklistItemStatus.TODO,
            sort_order=1
        )
        db_session.add(item)
        db_session.flush()

        link = ChecklistItemLink(
            item_id=item.item_id,
            linked_entity_type="document",
            linked_entity_id=uuid4()
        )
        db_session.add(link)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.delete(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/checklists/{checklist.checklist_id}/items/{item.item_id}/links/{link.link_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200


class TestChecklistEnums:
    """Tests for checklist enum endpoint."""

    def test_get_enums(self, client, setup_org_user):
        """Test getting all checklist enums for dropdowns."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_org_user["org"]
        user = setup_org_user["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-enums",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()

        assert "phases" in data
        assert "roles" in data
        assert "statuses" in data
        assert "exhibition_types" in data

        # Verify phases include labels
        assert any(p["value"] == "planning" for p in data["phases"])
        assert any(p["value"] == "install" for p in data["phases"])


class TestAuthenticationRequired:
    """Test that endpoints require authentication."""

    def test_templates_require_auth(self, client, db_session):
        """Test templates endpoint requires authentication."""
        org = Organization(
            name="Test",
            slug=f"test-{uuid4().hex[:8]}",
            status="active"
        )
        db_session.add(org)
        db_session.commit()

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/checklist-templates"
        )
        assert response.status_code == 401

    def test_exhibition_checklists_require_auth(self, client, db_session):
        """Test exhibition checklists endpoint requires authentication."""
        org = Organization(
            name="Test",
            slug=f"test-{uuid4().hex[:8]}",
            status="active"
        )
        db_session.add(org)
        db_session.flush()

        venue = Venue(
            organization_id=org.organization_id,
            name="Venue",
            default_ceiling_height_cm=300,
            default_wall_color="#FFF"
        )
        db_session.add(venue)
        db_session.flush()

        exhibition = Exhibition(
            organization_id=org.organization_id,
            venue_id=venue.venue_id,
            title="Test",
            status="proposed"
        )
        db_session.add(exhibition)
        db_session.commit()

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/checklists"
        )
        assert response.status_code == 401
