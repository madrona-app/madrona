"""
Tests for Exhibition API endpoints.

Tests the exhibition planning tools:
- Venues: Physical gallery spaces
- Floor plans: Individual rooms with geometry
- Exhibitions: Planned or active exhibitions
- Placements: Artwork positions
- Frame styles and mount configs (Phase 2)

These tests require PostgreSQL because the exhibit models use the 'exhibit' schema.
Run with: TEST_DATABASE_URL=postgresql://... pytest tests/postgres/test_exhibit_api.py -v
"""

import os
import pytest
from decimal import Decimal
from uuid import uuid4

from app.models import (
    User,
    Organization,
    OrganizationMembership,
    Role,
    RolePermission,
    Venue,
    FloorPlan,
    Exhibition,
    Placement,
    FrameStyle,
    MountConfig,
)
from app.models.exhibit import ExhibitionFloorPlan
from app.permissions import Permission

# Mark all tests in this file as requiring PostgreSQL
pytestmark = pytest.mark.postgres


class TestVenueAPI:
    """Tests for Venue CRUD endpoints."""

    @pytest.fixture
    def setup_user_with_permissions(self, db_session):
        """Create organization, user, and role with exhibit permissions."""
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
            email=f"curator-{uuid4().hex[:8]}@example.com",
            password_hash="fakehash",
            status="active"
        )
        db_session.add(user)
        db_session.flush()

        # Create role with venues permissions
        role = Role(
            role_key=f"curator-{uuid4().hex[:8]}",
            display_name="Curator",
            is_system=False
        )
        db_session.add(role)
        db_session.flush()

        # Add permissions
        from app.models import Permission as PermissionModel
        for perm_key in [
            Permission.VENUES_VIEW.value,
            Permission.VENUES_EDIT.value,
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

        # Create membership
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

    def test_list_venues_empty(self, client, setup_user_with_permissions):
        """Test listing venues when none exist."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/venues",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "venues" in data
        assert len(data["venues"]) == 0

    def test_create_venue(self, client, setup_user_with_permissions):
        """Test creating a new venue."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]
        token = create_access_token(user.user_id, org.organization_id)

        venue_data = {
            "name": "Main Gallery Building",
            "description": "Primary exhibition space",
            "address": "123 Museum Lane",
            "default_ceiling_height_cm": 400,
            "default_wall_color": "#F5F5F5"
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/venues",
            json=venue_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert "venue_id" in data
        assert data["name"] == "Main Gallery Building"

    def test_get_venue(self, client, db_session, setup_user_with_permissions):
        """Test getting a single venue."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]

        # Create venue directly
        venue = Venue(
            organization_id=org.organization_id,
            name="Test Gallery",
            description="A test gallery",
            default_ceiling_height_cm=300,
            default_wall_color="#FFFFFF"
        )
        db_session.add(venue)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/venues/{venue.venue_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["venue_id"] == str(venue.venue_id)
        assert data["name"] == "Test Gallery"
        assert "floor_plans" in data

    def test_update_venue(self, client, db_session, setup_user_with_permissions):
        """Test updating a venue."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]

        # Create venue
        venue = Venue(
            organization_id=org.organization_id,
            name="Old Name",
            default_ceiling_height_cm=300,
            default_wall_color="#FFFFFF"
        )
        db_session.add(venue)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.patch(
            f"/api/organizations/{org.organization_id}/exhibit/venues/{venue.venue_id}",
            json={"name": "New Name", "default_ceiling_height_cm": 350},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        # PATCH returns {status, message, venue_id}; verify via GET
        get_response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/venues/{venue.venue_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert get_response.status_code == 200
        data = get_response.get_json()
        assert data["name"] == "New Name"

    def test_delete_venue(self, client, db_session, setup_user_with_permissions):
        """Test deleting a venue."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_user_with_permissions["org"]
        user = setup_user_with_permissions["user"]

        # Create venue
        venue = Venue(
            organization_id=org.organization_id,
            name="To Delete",
            default_ceiling_height_cm=300,
            default_wall_color="#FFFFFF"
        )
        db_session.add(venue)
        db_session.commit()
        venue_id = venue.venue_id

        token = create_access_token(user.user_id, org.organization_id)

        response = client.delete(
            f"/api/organizations/{org.organization_id}/exhibit/venues/{venue_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200

        # Verify deleted
        deleted = db_session.query(Venue).filter_by(venue_id=venue_id).first()
        assert deleted is None


class TestFloorPlanAPI:
    """Tests for Floor Plan endpoints."""

    @pytest.fixture
    def setup_venue(self, db_session):
        """Create organization, user with permissions, and venue."""
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
            is_system=False
        )
        db_session.add(role)
        db_session.flush()

        from app.models import Permission as PermissionModel
        for perm_key in [
            Permission.VENUES_VIEW.value,
            Permission.VENUES_EDIT.value,
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

        venue = Venue(
            organization_id=org.organization_id,
            name="Main Gallery",
            default_ceiling_height_cm=300,
            default_wall_color="#FFFFFF"
        )
        db_session.add(venue)
        db_session.commit()

        return {"org": org, "user": user, "venue": venue}

    def test_create_floor_plan_rectangular(self, client, setup_venue):
        """Test creating a rectangular floor plan."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_venue["org"]
        user = setup_venue["user"]
        venue = setup_venue["venue"]
        token = create_access_token(user.user_id, org.organization_id)

        floor_plan_data = {
            "name": "Gallery A",
            "floor_number": 1,
            "geometry": {
                "type": "rectangular",
                "width_cm": 800,
                "depth_cm": 600,
                "walls": {
                    "north": {"length": 800},
                    "south": {"length": 800},
                    "east": {"length": 600},
                    "west": {"length": 600}
                }
            }
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/venues/{venue.venue_id}/floor-plans",
            json=floor_plan_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert "floor_plan_id" in data
        assert data["name"] == "Gallery A"

    def test_create_floor_plan_polygon(self, client, setup_venue):
        """Test creating a polygon floor plan (Phase 2)."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_venue["org"]
        user = setup_venue["user"]
        venue = setup_venue["venue"]
        token = create_access_token(user.user_id, org.organization_id)

        floor_plan_data = {
            "name": "L-Shaped Gallery",
            "floor_number": 1,
            "geometry": {
                "type": "polygon",
                "vertices": [
                    {"id": "v1", "x": 0, "y": 0},
                    {"id": "v2", "x": 800, "y": 0},
                    {"id": "v3", "x": 800, "y": 400},
                    {"id": "v4", "x": 400, "y": 400},
                    {"id": "v5", "x": 400, "y": 600},
                    {"id": "v6", "x": 0, "y": 600}
                ],
                "walls": [
                    {"id": "wall_1", "start_vertex": "v1", "end_vertex": "v2", "height_cm": 300, "openings": []},
                    {"id": "wall_2", "start_vertex": "v2", "end_vertex": "v3", "height_cm": 300, "openings": []},
                    {"id": "wall_3", "start_vertex": "v3", "end_vertex": "v4", "height_cm": 300, "openings": []},
                    {"id": "wall_4", "start_vertex": "v4", "end_vertex": "v5", "height_cm": 300, "openings": []},
                    {"id": "wall_5", "start_vertex": "v5", "end_vertex": "v6", "height_cm": 300, "openings": []},
                    {"id": "wall_6", "start_vertex": "v6", "end_vertex": "v1", "height_cm": 300, "openings": []}
                ],
                "columns": [],
                "units": "cm"
            }
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/venues/{venue.venue_id}/floor-plans",
            json=floor_plan_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert data["name"] == "L-Shaped Gallery"

    def test_get_floor_plan(self, client, db_session, setup_venue):
        """Test getting a floor plan with exhibition_id."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_venue["org"]
        user = setup_venue["user"]
        venue = setup_venue["venue"]

        floor_plan = FloorPlan(
            venue_id=venue.venue_id,
            name="Test Room",
            floor_number=0,
            geometry={"type": "rectangular", "width_cm": 500, "depth_cm": 400}
        )
        db_session.add(floor_plan)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/floor-plans/{floor_plan.floor_plan_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "floor_plan" in data
        assert data["floor_plan"]["floor_plan_id"] == str(floor_plan.floor_plan_id)


class TestGeometryValidation:
    """Tests for geometry validation endpoint."""

    @pytest.fixture
    def setup_auth(self, db_session):
        """Create basic auth setup."""
        org = Organization(
            name="Test Museum",
            slug=f"test-museum-{uuid4().hex[:8]}",
            status="active"
        )
        db_session.add(org)
        db_session.flush()

        user = User(
            email=f"user-{uuid4().hex[:8]}@example.com",
            password_hash="fakehash",
            status="active"
        )
        db_session.add(user)
        db_session.flush()

        role = Role(
            role_key=f"role-{uuid4().hex[:8]}",
            display_name="Viewer",
            is_system=False
        )
        db_session.add(role)
        db_session.flush()

        from app.models import Permission as PermissionModel
        perm = db_session.query(PermissionModel).filter_by(
            permission_key=Permission.VENUES_VIEW.value
        ).first()
        if not perm:
            perm = PermissionModel(
                permission_key=Permission.VENUES_VIEW.value,
                scope=(Permission.VENUES_VIEW.value).rpartition(".")[0] or (Permission.VENUES_VIEW.value),
                action=(Permission.VENUES_VIEW.value).rpartition(".")[2] or (Permission.VENUES_VIEW.value),
                display_name=(Permission.VENUES_VIEW.value).replace(".", " ").title(),
                description="View venues"
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

        return {"org": org, "user": user}

    def test_validate_geometry_valid(self, client, setup_auth):
        """Test validating a valid polygon geometry."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_auth["org"]
        user = setup_auth["user"]
        token = create_access_token(user.user_id, org.organization_id)

        geometry = {
            "type": "polygon",
            "vertices": [
                {"id": "v1", "x": 0, "y": 0},
                {"id": "v2", "x": 800, "y": 0},
                {"id": "v3", "x": 800, "y": 600},
                {"id": "v4", "x": 0, "y": 600}
            ],
            "walls": [
                {"id": "w1", "start_vertex": "v1", "end_vertex": "v2", "height_cm": 300, "openings": []},
                {"id": "w2", "start_vertex": "v2", "end_vertex": "v3", "height_cm": 300, "openings": []},
                {"id": "w3", "start_vertex": "v3", "end_vertex": "v4", "height_cm": 300, "openings": []},
                {"id": "w4", "start_vertex": "v4", "end_vertex": "v1", "height_cm": 300, "openings": []}
            ],
            "columns": []
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/floor-plans/validate-geometry",
            json={"geometry": geometry},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["valid"] is True

    def test_validate_geometry_missing_vertices(self, client, setup_auth):
        """Test validation fails for geometry with too few vertices."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_auth["org"]
        user = setup_auth["user"]
        token = create_access_token(user.user_id, org.organization_id)

        geometry = {
            "type": "polygon",
            "vertices": [
                {"id": "v1", "x": 0, "y": 0},
                {"id": "v2", "x": 800, "y": 0}
            ],
            "walls": [],
            "columns": []
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/floor-plans/validate-geometry",
            json={"geometry": geometry},
            headers={"Authorization": f"Bearer {token}"}
        )

        # Router returns 400 with the validation detail when geometry is invalid
        assert response.status_code == 400
        detail = response.get_json()["error"]
        assert detail["valid"] is False
        assert len(detail["errors"]) > 0

    def test_validate_geometry_invalid_wall_references(self, client, setup_auth):
        """Test validation fails for walls referencing non-existent vertices."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_auth["org"]
        user = setup_auth["user"]
        token = create_access_token(user.user_id, org.organization_id)

        geometry = {
            "type": "polygon",
            "vertices": [
                {"id": "v1", "x": 0, "y": 0},
                {"id": "v2", "x": 800, "y": 0},
                {"id": "v3", "x": 800, "y": 600}
            ],
            "walls": [
                {"id": "w1", "start_vertex": "v1", "end_vertex": "v99", "height_cm": 300, "openings": []}
            ],
            "columns": []
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/floor-plans/validate-geometry",
            json={"geometry": geometry},
            headers={"Authorization": f"Bearer {token}"}
        )

        # Router returns 400 with the validation detail when geometry is invalid
        assert response.status_code == 400
        detail = response.get_json()["error"]
        assert detail["valid"] is False
        # Router flags the invalid wall by wall id rather than by the unknown
        # vertex id. (Suspected prod UX gap: error would be clearer if it
        # included "v99" — flagged, not fixed, per test-only constraint.)
        assert any(
            ("invalid end_vertex" in err or "invalid start_vertex" in err)
            and "w1" in err
            for err in detail["errors"]
        )


class TestExhibitionAPI:
    """Tests for Exhibition CRUD endpoints."""

    @pytest.fixture
    def setup_exhibition(self, db_session):
        """Create org, user with permissions, and venue with floor plan."""
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
            is_system=False
        )
        db_session.add(role)
        db_session.flush()

        from app.models import Permission as PermissionModel
        for perm_key in [
            Permission.VENUES_VIEW.value,
            Permission.VENUES_EDIT.value,
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

        venue = Venue(
            organization_id=org.organization_id,
            name="Main Gallery",
            default_ceiling_height_cm=300,
            default_wall_color="#FFFFFF"
        )
        db_session.add(venue)
        db_session.flush()

        floor_plan = FloorPlan(
            venue_id=venue.venue_id,
            name="Room A",
            floor_number=1,
            geometry={"type": "rectangular", "width_cm": 800, "depth_cm": 600}
        )
        db_session.add(floor_plan)
        db_session.commit()

        return {"org": org, "user": user, "venue": venue, "floor_plan": floor_plan}

    def test_create_exhibition(self, client, setup_exhibition):
        """Test creating a new exhibition."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        venue = setup_exhibition["venue"]
        token = create_access_token(user.user_id, org.organization_id)

        exhibition_data = {
            "title": "Modern Masters",
            "description": "A collection of modern art",
            "exhibition_type": "temporary",
            "venue_id": str(venue.venue_id),
            "planned_start_date": "2026-03-01",
            "planned_end_date": "2026-06-30"
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/collections/exhibitions",
            json=exhibition_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert "exhibition_id" in data
        assert data["title"] == "Modern Masters"

    def test_list_exhibitions(self, client, db_session, setup_exhibition):
        """Test listing exhibitions."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        venue = setup_exhibition["venue"]

        # Create exhibition directly
        exhibition = Exhibition(
            organization_id=org.organization_id,
            venue_id=venue.venue_id,
            title="Test Exhibition",
            status="proposed"
        )
        db_session.add(exhibition)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/collections/exhibitions",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "exhibitions" in data
        assert len(data["exhibitions"]) >= 1

    def test_get_exhibition(self, client, db_session, setup_exhibition):
        """Test getting a single exhibition."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        venue = setup_exhibition["venue"]

        exhibition = Exhibition(
            organization_id=org.organization_id,
            venue_id=venue.venue_id,
            title="Test Exhibition",
            description="A test",
            status="proposed"
        )
        db_session.add(exhibition)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/collections/exhibitions/{exhibition.exhibition_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["exhibition_id"] == str(exhibition.exhibition_id)
        assert data["title"] == "Test Exhibition"

    def test_update_exhibition_status(self, client, db_session, setup_exhibition):
        """Test updating exhibition status with history tracking."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_exhibition["org"]
        user = setup_exhibition["user"]
        venue = setup_exhibition["venue"]

        exhibition = Exhibition(
            organization_id=org.organization_id,
            venue_id=venue.venue_id,
            title="Test Exhibition",
            status="proposed"
        )
        db_session.add(exhibition)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        # Update status to authorized
        response = client.patch(
            f"/api/organizations/{org.organization_id}/collections/exhibitions/{exhibition.exhibition_id}",
            json={"status": "authorized"},
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        # PATCH returns {exhibition_id, message}; verify status via GET
        get_response = client.get(
            f"/api/organizations/{org.organization_id}/collections/exhibitions/{exhibition.exhibition_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert get_response.status_code == 200
        data = get_response.get_json()
        assert data["status"] == "authorized"


class TestPlacementAPI:
    """Tests for Placement endpoints."""

    @pytest.fixture
    def setup_placement(self, db_session):
        """Create full setup for placement tests."""
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
            is_system=False
        )
        db_session.add(role)
        db_session.flush()

        from app.models import Permission as PermissionModel
        for perm_key in [
            Permission.VENUES_VIEW.value,
            Permission.EXHIBIT_VIEW.value,
            Permission.EXHIBIT_EDIT.value,
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

        venue = Venue(
            organization_id=org.organization_id,
            name="Gallery",
            default_ceiling_height_cm=300,
            default_wall_color="#FFFFFF"
        )
        db_session.add(venue)
        db_session.flush()

        floor_plan = FloorPlan(
            venue_id=venue.venue_id,
            name="Room A",
            floor_number=1,
            geometry={"type": "rectangular", "width_cm": 800, "depth_cm": 600}
        )
        db_session.add(floor_plan)
        db_session.flush()

        exhibition = Exhibition(
            organization_id=org.organization_id,
            venue_id=venue.venue_id,
            title="Test Exhibition",
            status="in_preparation"
        )
        db_session.add(exhibition)
        db_session.flush()

        # Link floor plan to exhibition (required for placement creation)
        db_session.add(ExhibitionFloorPlan(
            exhibition_id=exhibition.exhibition_id,
            floor_plan_id=floor_plan.floor_plan_id,
            visit_order=0,
        ))
        db_session.commit()

        return {
            "org": org,
            "user": user,
            "venue": venue,
            "floor_plan": floor_plan,
            "exhibition": exhibition
        }

    def test_create_placement(self, client, setup_placement):
        """Test creating a placement."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_placement["org"]
        user = setup_placement["user"]
        floor_plan = setup_placement["floor_plan"]
        exhibition = setup_placement["exhibition"]
        token = create_access_token(user.user_id, org.organization_id)

        placement_data = {
            "floor_plan_id": str(floor_plan.floor_plan_id),
            "source_type": "external",
            "external_url": "https://example.com/artwork.jpg",
            "display_title": "The Starry Night",
            "display_artist": "Vincent van Gogh",
            "width_cm": 92.1,
            "height_cm": 73.7,
            "wall_id": "north",
            "position_x": 200,
            "position_y": 150,
            "mount_type": "wall"
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}/placements",
            json=placement_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert "placement_id" in data
        # POST returns {placement_id, message}; fetch exhibition detail to verify fields
        get_response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}",
            headers={"Authorization": f"Bearer {token}"}
        )
        assert get_response.status_code == 200
        placements = get_response.get_json()["placements"]
        assert any(p["display_title"] == "The Starry Night" for p in placements)

    def test_list_placements(self, client, db_session, setup_placement):
        """Test listing placements for an exhibition."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_placement["org"]
        user = setup_placement["user"]
        floor_plan = setup_placement["floor_plan"]
        exhibition = setup_placement["exhibition"]

        # Create placement directly
        placement = Placement(
            exhibition_id=exhibition.exhibition_id,
            floor_plan_id=floor_plan.floor_plan_id,
            source_type="external",
            display_title="Test Artwork",
            width_cm=Decimal("50"),
            height_cm=Decimal("70"),
            wall_id="north",
            position_x=Decimal("100"),
            position_y=Decimal("150")
        )
        db_session.add(placement)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        # No dedicated list-placements endpoint — placements are embedded in the
        # exhibition detail response.
        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/exhibitions/{exhibition.exhibition_id}",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "placements" in data
        assert len(data["placements"]) >= 1


class TestFrameStyleAPI:
    """Tests for Frame Style endpoints (Phase 2)."""

    @pytest.fixture
    def setup_frame_styles(self, db_session):
        """Create org and user for frame style tests."""
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
            is_system=False
        )
        db_session.add(role)
        db_session.flush()

        from app.models import Permission as PermissionModel
        for perm_key in [Permission.EXHIBIT_VIEW.value, Permission.EXHIBIT_EDIT.value]:
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

        return {"org": org, "user": user}

    def test_list_frame_styles(self, client, db_session, setup_frame_styles):
        """Test listing frame styles."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_frame_styles["org"]
        user = setup_frame_styles["user"]

        # Create frame style
        frame_style = FrameStyle(
            organization_id=org.organization_id,
            name="Classic Black",
            profile_type="flat",
            default_width_cm=Decimal("3"),
            default_depth_cm=Decimal("2"),
            material="wood",
            color_hex="#000000"
        )
        db_session.add(frame_style)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/frame-styles",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "frame_styles" in data
        assert len(data["frame_styles"]) >= 1

    def test_create_frame_style(self, client, setup_frame_styles):
        """Test creating a custom frame style."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_frame_styles["org"]
        user = setup_frame_styles["user"]
        token = create_access_token(user.user_id, org.organization_id)

        frame_data = {
            "name": "Modern White",
            "profile_type": "float",
            "default_width_cm": 2.5,
            "default_depth_cm": 3.0,
            "material": "wood",
            "color_hex": "#FFFFFF"
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/frame-styles",
            json=frame_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert "frame_style_id" in data


class TestMountConfigAPI:
    """Tests for Mount Config endpoints (Phase 2)."""

    @pytest.fixture
    def setup_mount_configs(self, db_session):
        """Create org and user for mount config tests."""
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
            is_system=False
        )
        db_session.add(role)
        db_session.flush()

        from app.models import Permission as PermissionModel
        for perm_key in [Permission.EXHIBIT_VIEW.value, Permission.EXHIBIT_EDIT.value]:
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

        return {"org": org, "user": user}

    def test_list_mount_configs(self, client, db_session, setup_mount_configs):
        """Test listing mount configurations."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_mount_configs["org"]
        user = setup_mount_configs["user"]

        # Create mount config
        mount_config = MountConfig(
            organization_id=org.organization_id,
            name="Standard Plinth",
            mount_type="plinth",
            config={
                "height_cm": 100,
                "width_cm": 60,
                "depth_cm": 60,
                "material": "wood",
                "color_hex": "#FFFFFF"
            }
        )
        db_session.add(mount_config)
        db_session.commit()

        token = create_access_token(user.user_id, org.organization_id)

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/mount-configs",
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "mount_configs" in data
        assert len(data["mount_configs"]) >= 1

    def test_create_mount_config(self, client, setup_mount_configs):
        """Test creating a mount configuration."""
        from app.services.auth_utils import generate_access_token
        create_access_token = lambda uid, oid=None: generate_access_token(str(uid), f'{uid}@test.local', active_organization_id=str(oid) if oid else None)

        org = setup_mount_configs["org"]
        user = setup_mount_configs["user"]
        token = create_access_token(user.user_id, org.organization_id)

        mount_data = {
            "name": "Glass Vitrine",
            "mount_type": "vitrine",
            "config": {
                "height_cm": 60,
                "width_cm": 50,
                "depth_cm": 50,
                "has_pedestal": True,
                "pedestal_height_cm": 80
            }
        }

        response = client.post(
            f"/api/organizations/{org.organization_id}/exhibit/mount-configs",
            json=mount_data,
            headers={"Authorization": f"Bearer {token}"}
        )

        assert response.status_code == 201
        data = response.get_json()
        assert "mount_config_id" in data


class TestAuthenticationRequired:
    """Test that endpoints require authentication."""

    def test_venues_require_auth(self, client, db_session):
        """Test venues endpoint requires authentication."""
        org = Organization(
            name="Test",
            slug=f"test-{uuid4().hex[:8]}",
            status="active"
        )
        db_session.add(org)
        db_session.commit()

        response = client.get(
            f"/api/organizations/{org.organization_id}/exhibit/venues"
        )
        assert response.status_code == 401

    def test_exhibitions_require_auth(self, client, db_session):
        """Test exhibitions endpoint requires authentication."""
        org = Organization(
            name="Test",
            slug=f"test-{uuid4().hex[:8]}",
            status="active"
        )
        db_session.add(org)
        db_session.commit()

        response = client.get(
            f"/api/organizations/{org.organization_id}/collections/exhibitions"
        )
        assert response.status_code == 401
