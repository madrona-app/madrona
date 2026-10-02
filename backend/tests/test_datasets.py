"""
Unit tests for Dataset model and API endpoints.

Tests dataset creation, uniqueness constraints, run associations,
and serialization.
"""

import pytest
from uuid import uuid4

from app.models import Dataset, Organization, Run
from app.fastapi_app.routers.runs import _serialize_dataset


class TestDatasetModel:
    """Test Dataset SQLAlchemy model."""

    def test_create_dataset(self, db_session, demo_tenant):
        """Test creating a dataset with all fields."""
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Museum Objects",
            key="objects",
            description="Smithsonian museum collection objects",
            source_type="smithsonian",
            schema={"fields": ["title", "object_number"]},
        )
        db_session.add(dataset)
        db_session.commit()

        assert dataset.dataset_id is not None
        assert dataset.name == "Museum Objects"
        assert dataset.key == "objects"
        assert dataset.description == "Smithsonian museum collection objects"
        assert dataset.source_type == "smithsonian"
        assert dataset.schema == {"fields": ["title", "object_number"]}
        assert dataset.created_at is not None
        assert dataset.updated_at is not None

    def test_create_minimal_dataset(self, db_session, demo_tenant):
        """Test creating dataset with only required fields."""
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Donors",
            key="donors",
        )
        db_session.add(dataset)
        db_session.commit()

        assert dataset.dataset_id is not None
        assert dataset.name == "Donors"
        assert dataset.key == "donors"
        assert dataset.description is None
        assert dataset.source_type is None
        assert dataset.schema is None

    def test_dataset_key_uniqueness_per_org(self, db_session, demo_tenant):
        """Test that dataset keys must be unique within an organization."""
        dataset1 = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Objects",
            key="objects",
        )
        db_session.add(dataset1)
        db_session.commit()

        dataset2 = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Another Objects",
            key="objects",
        )
        db_session.add(dataset2)

        with pytest.raises(Exception):
            db_session.commit()

    def test_dataset_key_unique_across_orgs(self, db_session):
        """Test that same key can be used by different organizations."""
        org1 = Organization(
            name="Organization 1",
            slug="org-ds-1",
            is_demo=False,
            status="active",
        )
        org2 = Organization(
            name="Organization 2",
            slug="org-ds-2",
            is_demo=False,
            status="active",
        )
        db_session.add_all([org1, org2])
        db_session.commit()

        dataset1 = Dataset(
            organization_id=org1.organization_id,
            name="Objects",
            key="objects",
        )
        dataset2 = Dataset(
            organization_id=org2.organization_id,
            name="Objects",
            key="objects",
        )
        db_session.add_all([dataset1, dataset2])
        db_session.commit()

        assert dataset1.dataset_id != dataset2.dataset_id
        assert dataset1.key == dataset2.key


class TestDatasetRunAssociation:
    """Test Dataset association with Runs."""

    def test_run_with_dataset(self, db_session, demo_tenant, demo_pipeline):
        """Test creating a run associated with a dataset."""
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Objects",
            key="objects_assoc",
        )
        db_session.add(dataset)
        db_session.commit()

        run = Run(
            organization_id=demo_tenant.organization_id,
            pipeline_id=demo_pipeline.pipeline_id,
            dataset_id=dataset.dataset_id,
            status="success",
            triggered_by="manual",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        assert run.dataset_id == dataset.dataset_id

    def test_run_without_dataset(self, db_session, demo_tenant, demo_pipeline):
        """Test creating a run without a dataset (backward compatibility)."""
        run = Run(
            organization_id=demo_tenant.organization_id,
            pipeline_id=demo_pipeline.pipeline_id,
            dataset_id=None,
            status="success",
            triggered_by="manual",
            parameters={},
        )
        db_session.add(run)
        db_session.commit()

        assert run.dataset_id is None


class TestDatasetAPI:
    """Test Dataset API endpoints."""

    def test_create_dataset_api(self, auth_setup, db_session):
        """Test POST /api/datasets."""
        auth_client, org, user = auth_setup

        resp = auth_client.post(
            "/api/datasets",
            json={
                "organization_id": str(org.organization_id),
                "name": "Museum Objects",
                "key": "objects_api",
                "description": "Collection objects",
                "source_type": "smithsonian",
                "schema": {"fields": ["title"]},
            },
        )

        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "Museum Objects"
        assert data["key"] == "objects_api"
        assert data["description"] == "Collection objects"
        assert data["source_type"] == "smithsonian"
        assert data["schema"] == {"fields": ["title"]}
        assert "dataset_id" in data
        assert "created_at" in data

    def test_create_dataset_minimal(self, auth_setup, db_session):
        """Test creating dataset with only required fields."""
        auth_client, org, user = auth_setup

        resp = auth_client.post(
            "/api/datasets",
            json={
                "organization_id": str(org.organization_id),
                "name": "Donors",
                "key": "donors_api",
            },
        )

        assert resp.status_code == 201
        data = resp.get_json()
        assert data["name"] == "Donors"
        assert data["key"] == "donors_api"
        assert data["description"] is None

    def test_create_dataset_missing_fields(self, auth_setup, db_session):
        """Test creating dataset without required fields."""
        auth_client, org, user = auth_setup

        resp = auth_client.post(
            "/api/datasets",
            json={
                "organization_id": str(org.organization_id),
                "name": "Objects",
                # Missing 'key'
            },
        )

        assert resp.status_code in (400, 422)
        data = resp.get_json()
        # FastAPI 422 uses {"detail": [...]} shape; the normalized envelope uses {"error": {...}}
        assert "error" in data or "detail" in data

    def test_create_dataset_duplicate_key(self, auth_setup, db_session):
        """Test creating dataset with duplicate key."""
        auth_client, org, user = auth_setup

        auth_client.post(
            "/api/datasets",
            json={
                "organization_id": str(org.organization_id),
                "name": "Objects",
                "key": "dup_objects",
            },
        )

        resp = auth_client.post(
            "/api/datasets",
            json={
                "organization_id": str(org.organization_id),
                "name": "Another Objects",
                "key": "dup_objects",
            },
        )

        assert resp.status_code == 409
        data = resp.get_json()
        assert "error" in data

    def test_list_datasets(self, auth_setup, db_session):
        """Test GET /api/datasets."""
        auth_client, org, user = auth_setup

        for i in range(3):
            auth_client.post(
                "/api/datasets",
                json={
                    "organization_id": str(org.organization_id),
                    "name": f"Dataset {i}",
                    "key": f"dataset-list-{i}",
                },
            )

        resp = auth_client.get(f"/api/datasets?organization_id={org.organization_id}")
        assert resp.status_code == 200
        data = resp.get_json()

        assert "items" in data
        assert "total" in data
        assert data["total"] >= 3

    def test_get_dataset_by_id(self, auth_setup, db_session):
        """Test GET /api/datasets/<id>."""
        auth_client, org, user = auth_setup

        create_resp = auth_client.post(
            "/api/datasets",
            json={
                "organization_id": str(org.organization_id),
                "name": "Get Test Dataset",
                "key": "get_test",
            },
        )
        dataset_id = create_resp.get_json()["dataset_id"]

        resp = auth_client.get(f"/api/datasets/{dataset_id}")
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["dataset_id"] == dataset_id
        assert data["name"] == "Get Test Dataset"
        assert data["key"] == "get_test"

    def test_get_dataset_not_found(self, auth_setup):
        """Test getting non-existent dataset."""
        auth_client, org, user = auth_setup
        fake_id = str(uuid4())
        resp = auth_client.get(f"/api/datasets/{fake_id}")
        assert resp.status_code == 404

    def test_list_datasets_pagination(self, auth_setup, db_session):
        """Test dataset list pagination."""
        auth_client, org, user = auth_setup

        for i in range(5):
            auth_client.post(
                "/api/datasets",
                json={
                    "organization_id": str(org.organization_id),
                    "name": f"Page Dataset {i}",
                    "key": f"page-dataset-{i}",
                },
            )

        resp = auth_client.get(
            f"/api/datasets?organization_id={org.organization_id}&limit=2&offset=0"
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 2
        assert data["limit"] == 2
        assert data["offset"] == 0
        assert data["total"] >= 5


class TestDatasetSerialization:
    """Test Dataset serialization helper."""

    def test_serialize_dataset(self, db_session, demo_tenant):
        """Test _serialize_dataset helper function."""
        dataset = Dataset(
            organization_id=demo_tenant.organization_id,
            name="Objects",
            key="serialize_objects",
            description="Test description",
            source_type="test",
            schema={"test": "schema"},
        )
        db_session.add(dataset)
        db_session.commit()

        serialized = _serialize_dataset(dataset)

        assert serialized["dataset_id"] == str(dataset.dataset_id)
        assert serialized["organization_id"] == str(dataset.organization_id)
        assert serialized["name"] == "Objects"
        assert serialized["key"] == "serialize_objects"
        assert serialized["description"] == "Test description"
        assert serialized["source_type"] == "test"
        assert serialized["schema"] == {"test": "schema"}
        assert "created_at" in serialized
        assert "updated_at" in serialized
        assert serialized["role"] == "canonical"
