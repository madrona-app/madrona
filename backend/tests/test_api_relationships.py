"""
Tests for the relationships API endpoints.
"""

import pytest
from uuid import uuid4

from app.models import (
    EntityRelationship, EntityCurrent, Organization, Dataset, User,
    OrganizationMembership, Role, Permission as PermissionModel, RolePermission,
)
from app.services.auth_utils import generate_access_token


class AuthenticatedClient:
    """Wrapper around Flask test client that includes auth headers."""

    def __init__(self, client, token: str):
        self._client = client
        self._token = token
        self._headers = {"Authorization": f"Bearer {token}"}

    def get(self, *args, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.update(self._headers)
        return self._client.get(*args, headers=headers, **kwargs)

    def post(self, *args, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.update(self._headers)
        return self._client.post(*args, headers=headers, **kwargs)

    def put(self, *args, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.update(self._headers)
        return self._client.put(*args, headers=headers, **kwargs)

    def delete(self, *args, **kwargs):
        headers = kwargs.pop("headers", {})
        headers.update(self._headers)
        return self._client.delete(*args, headers=headers, **kwargs)


@pytest.fixture
def auth_client(client, db_session):
    """
    Create an authenticated test client with user and org.

    Returns a tuple of (authenticated_client, organization, user).
    """
    # Create organization
    organization = Organization(
        name="Relationships Test Organization",
        slug="rel-test-org",
        is_demo=False,
        status="active",
    )
    db_session.add(organization)
    db_session.flush()

    # Create a role for the user
    role = Role(
        role_key="admin",
        display_name="Organization Admin",
        description="Full access to organization",
        is_system=True,
    )
    db_session.add(role)
    db_session.flush()

    # Create permissions
    permissions = [
        PermissionModel(
            permission_key="data.view",
            scope="data",
            action="view",
            display_name="View Data",
            description="View canonical entity data",
        ),
        PermissionModel(
            permission_key="data.manage",
            scope="data",
            action="manage",
            display_name="Manage Data",
            description="Manage canonical entity data",
        ),
    ]
    for perm in permissions:
        db_session.add(perm)
    db_session.flush()

    # Link role to permissions
    for perm in permissions:
        role_permission = RolePermission(
            role_id=role.role_id,
            permission_id=perm.permission_id,
        )
        db_session.add(role_permission)
    db_session.flush()

    # Create user
    user = User(
        email="reltest@example.com",
        password_hash="not_used_in_tests",
        status="active",
    )
    db_session.add(user)
    db_session.flush()

    # Create organization membership
    membership = OrganizationMembership(
        organization_id=organization.organization_id,
        user_id=user.user_id,
        role="admin",
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)
    db_session.commit()

    # Generate access token
    token = generate_access_token(
        user_id=str(user.user_id),
        email=user.email,
        active_organization_id=str(organization.organization_id),
        expires_minutes=60,
    )

    return AuthenticatedClient(client, token), organization, user


@pytest.fixture
def dataset(db_session, auth_client):
    """Create a test dataset."""
    _, organization, _ = auth_client
    ds = Dataset(
        organization_id=organization.organization_id,
        name="Test Dataset",
        key="test-dataset-api",
    )
    db_session.add(ds)
    db_session.commit()
    return ds


@pytest.fixture
def source_entity(db_session, auth_client, dataset):
    """Create a source entity."""
    from datetime import datetime, timezone
    import hashlib

    _, organization, _ = auth_client
    entity = EntityCurrent(
        organization_id=organization.organization_id,
        entity_key="api:conn1:obj_001",
        dataset_id=dataset.dataset_id,
        entity_type="object",
        source_system="api",
        source_id="obj_001",
        payload={"title": "Test Object"},
        payload_hash=hashlib.sha256(b"test-api").hexdigest(),
        extracted_at=datetime.now(timezone.utc),
        last_seen_at=datetime.now(timezone.utc),
    )
    db_session.add(entity)
    db_session.commit()
    return entity


@pytest.fixture
def target_entity(db_session, auth_client, dataset):
    """Create a target entity."""
    from datetime import datetime, timezone
    import hashlib

    _, organization, _ = auth_client
    entity = EntityCurrent(
        organization_id=organization.organization_id,
        entity_key="api:conn2:med_001",
        dataset_id=dataset.dataset_id,
        entity_type="media",
        source_system="api",
        source_id="med_001",
        payload={"filename": "image.jpg"},
        payload_hash=hashlib.sha256(b"test-api2").hexdigest(),
        extracted_at=datetime.now(timezone.utc),
        last_seen_at=datetime.now(timezone.utc),
    )
    db_session.add(entity)
    db_session.commit()
    return entity


class TestCreateRelationship:
    """Tests for POST /api/relationships."""

    def test_create_relationship(self, auth_client, db_session, source_entity, target_entity, dataset):
        """Test creating a relationship via API."""
        client, organization, _ = auth_client

        response = client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": source_entity.entity_key,
                "target_entity_key": target_entity.entity_key,
                "relationship_type": "hasMedia",
                "source_dataset_id": str(dataset.dataset_id),
                "target_dataset_id": str(dataset.dataset_id),
            },
        )

        assert response.status_code == 201
        data = response.get_json()
        assert "relationship" in data
        assert data["relationship"]["source_entity_key"] == source_entity.entity_key
        assert data["relationship"]["target_entity_key"] == target_entity.entity_key
        assert data["relationship"]["relationship_type"] == "hasMedia"

    def test_create_relationship_missing_fields(self, auth_client):
        """Test that missing fields return 400."""
        client, organization, _ = auth_client

        response = client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": "test:123",
            },
        )

        assert response.status_code in (400, 422)
        data = response.get_json()
        assert "error" in data

    def test_create_duplicate_relationship(self, auth_client, db_session, source_entity, target_entity):
        """Test that duplicate relationship returns 409."""
        client, organization, _ = auth_client

        # Create first relationship
        response1 = client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": source_entity.entity_key,
                "target_entity_key": target_entity.entity_key,
                "relationship_type": "hasMedia",
            },
        )
        assert response1.status_code == 201

        # Try to create duplicate
        response2 = client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": source_entity.entity_key,
                "target_entity_key": target_entity.entity_key,
                "relationship_type": "hasMedia",
            },
        )
        assert response2.status_code == 409


class TestGetRelationship:
    """Tests for GET /api/relationships/<id>."""

    def test_get_relationship(self, auth_client, db_session, source_entity, target_entity):
        """Test getting a relationship by ID."""
        client, organization, _ = auth_client

        # Create relationship first
        create_response = client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": source_entity.entity_key,
                "target_entity_key": target_entity.entity_key,
                "relationship_type": "hasMedia",
            },
        )
        rel_id = create_response.get_json()["relationship"]["relationship_id"]

        # Get the relationship
        response = client.get(
            f"/api/relationships/{rel_id}?organization_id={organization.organization_id}",
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["relationship"]["relationship_id"] == rel_id

    def test_get_relationship_with_entities(self, auth_client, db_session, source_entity, target_entity):
        """Test getting a relationship with entity summaries."""
        client, organization, _ = auth_client

        # Create relationship first
        create_response = client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": source_entity.entity_key,
                "target_entity_key": target_entity.entity_key,
                "relationship_type": "hasMedia",
            },
        )
        rel_id = create_response.get_json()["relationship"]["relationship_id"]

        # Get with entities
        response = client.get(
            f"/api/relationships/{rel_id}?organization_id={organization.organization_id}&include_entities=true",
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "source_entity" in data
        assert "target_entity" in data
        assert data["source_entity"]["entity_key"] == source_entity.entity_key

    def test_get_nonexistent_relationship(self, auth_client):
        """Test getting a relationship that doesn't exist."""
        client, organization, _ = auth_client

        fake_id = str(uuid4())
        response = client.get(
            f"/api/relationships/{fake_id}?organization_id={organization.organization_id}",
        )

        assert response.status_code == 404


class TestDeleteRelationship:
    """Tests for DELETE /api/relationships/<id>."""

    def test_delete_relationship(self, auth_client, db_session, source_entity, target_entity):
        """Test deleting a relationship."""
        client, organization, _ = auth_client

        # Create relationship first
        create_response = client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": source_entity.entity_key,
                "target_entity_key": target_entity.entity_key,
                "relationship_type": "hasMedia",
            },
        )
        rel_id = create_response.get_json()["relationship"]["relationship_id"]

        # Delete
        response = client.delete(
            f"/api/relationships/{rel_id}?organization_id={organization.organization_id}",
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["deleted"] is True

        # Verify it's gone
        get_response = client.get(
            f"/api/relationships/{rel_id}?organization_id={organization.organization_id}",
        )
        assert get_response.status_code == 404


class TestListRelationships:
    """Tests for GET /api/relationships."""

    def test_list_relationships(self, auth_client, db_session, source_entity, target_entity):
        """Test listing relationships."""
        client, organization, _ = auth_client

        # Create a relationship
        client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": source_entity.entity_key,
                "target_entity_key": target_entity.entity_key,
                "relationship_type": "hasMedia",
            },
        )

        # List
        response = client.get(
            f"/api/relationships?organization_id={organization.organization_id}",
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "items" in data
        assert data["total"] >= 1

    def test_list_relationships_with_type_filter(self, auth_client, db_session, source_entity, target_entity):
        """Test filtering relationships by type."""
        client, organization, _ = auth_client

        # Create relationships with different types
        for rel_type in ["hasMedia", "relatedTo"]:
            client.post(
                "/api/relationships",
                json={
                    "organization_id": str(organization.organization_id),
                    "source_entity_key": source_entity.entity_key,
                    "target_entity_key": f"{target_entity.entity_key}_{rel_type}",
                    "relationship_type": rel_type,
                },
            )

        # Filter by type
        response = client.get(
            f"/api/relationships?organization_id={organization.organization_id}&relationship_type=hasMedia",
        )

        assert response.status_code == 200
        data = response.get_json()
        assert all(r["relationship_type"] == "hasMedia" for r in data["items"])


class TestEntityRelationships:
    """Tests for GET /api/entities/<key>/relationships."""

    def test_get_entity_relationships(self, auth_client, db_session, source_entity, target_entity):
        """Test getting relationships for an entity."""
        client, organization, _ = auth_client

        # Create relationship
        client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": source_entity.entity_key,
                "target_entity_key": target_entity.entity_key,
                "relationship_type": "hasMedia",
            },
        )

        # Get entity relationships
        response = client.get(
            f"/api/entities/{source_entity.entity_key}/relationships?organization_id={organization.organization_id}",
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["entity_key"] == source_entity.entity_key
        assert len(data["items"]) >= 1
        assert data["items"][0]["direction"] == "outgoing"

    def test_get_entity_relationships_incoming(self, auth_client, db_session, source_entity, target_entity):
        """Test getting incoming relationships."""
        client, organization, _ = auth_client

        # Create relationship
        client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": source_entity.entity_key,
                "target_entity_key": target_entity.entity_key,
                "relationship_type": "hasMedia",
            },
        )

        # Get incoming relationships for target
        response = client.get(
            f"/api/entities/{target_entity.entity_key}/relationships?organization_id={organization.organization_id}&direction=incoming",
        )

        assert response.status_code == 200
        data = response.get_json()
        assert len(data["items"]) >= 1
        assert data["items"][0]["direction"] == "incoming"


class TestRelationshipTypes:
    """Tests for GET /api/relationship-types."""

    def test_list_relationship_types(self, auth_client, db_session, source_entity, target_entity):
        """Test listing relationship types with counts."""
        client, organization, _ = auth_client

        # Create relationships with different types
        for rel_type in ["hasMedia", "hasMedia", "relatedTo"]:
            client.post(
                "/api/relationships",
                json={
                    "organization_id": str(organization.organization_id),
                    "source_entity_key": source_entity.entity_key,
                    "target_entity_key": f"{target_entity.entity_key}_{rel_type}_{uuid4().hex[:8]}",
                    "relationship_type": rel_type,
                },
            )

        # Get types
        response = client.get(
            f"/api/relationship-types?organization_id={organization.organization_id}",
        )

        assert response.status_code == 200
        data = response.get_json()
        assert "relationship_types" in data
        types_dict = {t["type"]: t["count"] for t in data["relationship_types"]}
        assert types_dict.get("hasMedia", 0) >= 2
        assert types_dict.get("relatedTo", 0) >= 1


class TestBatchCreate:
    """Tests for POST /api/relationships/batch."""

    def test_batch_create_relationships(self, auth_client, db_session, source_entity, target_entity):
        """Test batch creating relationships."""
        client, organization, _ = auth_client

        response = client.post(
            "/api/relationships/batch",
            json={
                "organization_id": str(organization.organization_id),
                "relationships": [
                    {
                        "source_entity_key": source_entity.entity_key,
                        "target_entity_key": f"{target_entity.entity_key}_batch1",
                        "relationship_type": "hasMedia",
                    },
                    {
                        "source_entity_key": source_entity.entity_key,
                        "target_entity_key": f"{target_entity.entity_key}_batch2",
                        "relationship_type": "relatedTo",
                    },
                ],
            },
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["created"] == 2
        assert data["skipped"] == 0
        assert len(data["errors"]) == 0

    def test_batch_skip_duplicates(self, auth_client, db_session, source_entity, target_entity):
        """Test that batch operation skips duplicates."""
        client, organization, _ = auth_client

        # Create first relationship
        client.post(
            "/api/relationships",
            json={
                "organization_id": str(organization.organization_id),
                "source_entity_key": source_entity.entity_key,
                "target_entity_key": target_entity.entity_key,
                "relationship_type": "hasMedia",
            },
        )

        # Try batch with duplicate
        response = client.post(
            "/api/relationships/batch",
            json={
                "organization_id": str(organization.organization_id),
                "relationships": [
                    {
                        "source_entity_key": source_entity.entity_key,
                        "target_entity_key": target_entity.entity_key,
                        "relationship_type": "hasMedia",
                    },
                ],
                "skip_duplicates": True,
            },
        )

        assert response.status_code == 200
        data = response.get_json()
        assert data["created"] == 0
        assert data["skipped"] == 1
