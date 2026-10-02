"""
Tests for the relationship service.
"""

import pytest
from uuid import uuid4

from app.models import EntityRelationship, EntityCurrent, Organization, Dataset
from app.services.relationship_service import (
    RelationshipCreate,
    create_relationship,
    get_relationship,
    delete_relationship,
    get_outgoing_relationships,
    get_incoming_relationships,
    get_all_relationships_for_entity,
    get_relationship_type_counts,
    create_relationships_batch,
    delete_relationships_for_entity,
    validate_relationship_type,
)


@pytest.fixture
def organization(db_session):
    """Create a test organization."""
    org = Organization(
        name="Test Organization",
        slug="test-org",
    )
    db_session.add(org)
    db_session.commit()
    return org


@pytest.fixture
def dataset(db_session, organization):
    """Create a test dataset."""
    ds = Dataset(
        organization_id=organization.organization_id,
        name="Test Dataset",
        key="test-dataset",
    )
    db_session.add(ds)
    db_session.commit()
    return ds


@pytest.fixture
def media_dataset(db_session, organization):
    """Create a media dataset."""
    ds = Dataset(
        organization_id=organization.organization_id,
        name="Media Dataset",
        key="media-dataset",
    )
    db_session.add(ds)
    db_session.commit()
    return ds


@pytest.fixture
def source_entity(db_session, organization, dataset):
    """Create a source entity."""
    from datetime import datetime, timezone
    import hashlib

    entity = EntityCurrent(
        organization_id=organization.organization_id,
        entity_key="test:conn1:obj_001",
        dataset_id=dataset.dataset_id,
        entity_type="object",
        source_system="test",
        source_id="obj_001",
        payload={"title": "Test Object"},
        payload_hash=hashlib.sha256(b"test").hexdigest(),
        extracted_at=datetime.now(timezone.utc),
        last_seen_at=datetime.now(timezone.utc),
    )
    db_session.add(entity)
    db_session.commit()
    return entity


@pytest.fixture
def target_entity(db_session, organization, media_dataset):
    """Create a target entity."""
    from datetime import datetime, timezone
    import hashlib

    entity = EntityCurrent(
        organization_id=organization.organization_id,
        entity_key="test:conn2:med_001",
        dataset_id=media_dataset.dataset_id,
        entity_type="media",
        source_system="test",
        source_id="med_001",
        payload={"filename": "image.jpg"},
        payload_hash=hashlib.sha256(b"test2").hexdigest(),
        extracted_at=datetime.now(timezone.utc),
        last_seen_at=datetime.now(timezone.utc),
    )
    db_session.add(entity)
    db_session.commit()
    return entity


class TestCreateRelationship:
    """Tests for create_relationship."""

    def test_create_basic_relationship(self, db_session, organization, source_entity, target_entity, dataset, media_dataset):
        """Test creating a basic relationship."""
        data = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=target_entity.entity_key,
            relationship_type="hasMedia",
            source_dataset_id=dataset.dataset_id,
            target_dataset_id=media_dataset.dataset_id,
        )

        rel = create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        assert rel.relationship_id is not None
        assert rel.source_entity_key == source_entity.entity_key
        assert rel.target_entity_key == target_entity.entity_key
        assert rel.relationship_type == "hasMedia"
        assert rel.created_by_source == "manual"

    def test_create_relationship_with_confidence(self, db_session, organization, source_entity, target_entity):
        """Test creating a relationship with confidence score."""
        data = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=target_entity.entity_key,
            relationship_type="relatedTo",
            created_by_source="rule",
            confidence=0.85,
            extra_data={"matched_on": "accession_number"},
        )

        rel = create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        assert rel.confidence == 0.85
        assert rel.created_by_source == "rule"
        assert rel.extra_data["matched_on"] == "accession_number"

    def test_create_duplicate_relationship_fails(self, db_session, organization, source_entity, target_entity):
        """Test that creating a duplicate relationship raises an error."""
        data = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=target_entity.entity_key,
            relationship_type="hasMedia",
        )

        create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        with pytest.raises(ValueError, match="already exists"):
            create_relationship(db_session, organization.organization_id, data)

    def test_self_reference_fails(self, db_session, organization, source_entity):
        """Test that self-referencing relationship fails."""
        data = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=source_entity.entity_key,
            relationship_type="relatedTo",
        )

        with pytest.raises(ValueError, match="cannot be the same"):
            create_relationship(db_session, organization.organization_id, data)

    def test_invalid_confidence_fails(self, db_session, organization, source_entity, target_entity):
        """Test that invalid confidence value fails."""
        data = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=target_entity.entity_key,
            relationship_type="relatedTo",
            confidence=1.5,  # Invalid
        )

        with pytest.raises(ValueError, match="Confidence must be between"):
            create_relationship(db_session, organization.organization_id, data)


class TestGetRelationship:
    """Tests for get_relationship."""

    def test_get_existing_relationship(self, db_session, organization, source_entity, target_entity):
        """Test getting an existing relationship."""
        data = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=target_entity.entity_key,
            relationship_type="hasMedia",
        )
        created = create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        fetched = get_relationship(db_session, organization.organization_id, created.relationship_id)

        assert fetched is not None
        assert fetched.relationship_id == created.relationship_id

    def test_get_nonexistent_relationship(self, db_session, organization):
        """Test getting a relationship that doesn't exist."""
        fetched = get_relationship(db_session, organization.organization_id, uuid4())
        assert fetched is None


class TestDeleteRelationship:
    """Tests for delete_relationship."""

    def test_delete_existing_relationship(self, db_session, organization, source_entity, target_entity):
        """Test deleting an existing relationship."""
        data = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=target_entity.entity_key,
            relationship_type="hasMedia",
        )
        created = create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        result = delete_relationship(db_session, organization.organization_id, created.relationship_id)
        db_session.commit()

        assert result is True
        assert get_relationship(db_session, organization.organization_id, created.relationship_id) is None

    def test_delete_nonexistent_relationship(self, db_session, organization):
        """Test deleting a relationship that doesn't exist."""
        result = delete_relationship(db_session, organization.organization_id, uuid4())
        assert result is False


class TestQueryRelationships:
    """Tests for relationship query functions."""

    def test_get_outgoing_relationships(self, db_session, organization, source_entity, target_entity):
        """Test getting outgoing relationships."""
        data = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=target_entity.entity_key,
            relationship_type="hasMedia",
        )
        create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        results, count = get_outgoing_relationships(
            db_session,
            organization.organization_id,
            source_entity.entity_key,
        )

        assert count == 1
        assert len(results) == 1
        assert results[0].relationship.target_entity_key == target_entity.entity_key

    def test_get_incoming_relationships(self, db_session, organization, source_entity, target_entity):
        """Test getting incoming relationships."""
        data = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=target_entity.entity_key,
            relationship_type="hasMedia",
        )
        create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        results, count = get_incoming_relationships(
            db_session,
            organization.organization_id,
            target_entity.entity_key,
        )

        assert count == 1
        assert len(results) == 1
        assert results[0].relationship.source_entity_key == source_entity.entity_key

    def test_get_all_relationships_for_entity(self, db_session, organization, source_entity, target_entity):
        """Test getting all relationships for an entity."""
        # Create outgoing relationship
        data1 = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=target_entity.entity_key,
            relationship_type="hasMedia",
        )
        create_relationship(db_session, organization.organization_id, data1)

        # Create incoming relationship (reverse)
        data2 = RelationshipCreate(
            source_entity_key=target_entity.entity_key,
            target_entity_key=source_entity.entity_key,
            relationship_type="mediaOf",
        )
        create_relationship(db_session, organization.organization_id, data2)
        db_session.commit()

        results, count = get_all_relationships_for_entity(
            db_session,
            organization.organization_id,
            source_entity.entity_key,
        )

        assert count == 2
        assert len(results) == 2

    def test_filter_by_relationship_type(self, db_session, organization, source_entity, target_entity):
        """Test filtering relationships by type."""
        # Create two relationships with different types
        for rel_type in ["hasMedia", "relatedTo"]:
            data = RelationshipCreate(
                source_entity_key=source_entity.entity_key,
                target_entity_key=target_entity.entity_key,
                relationship_type=rel_type,
            )
            create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        results, count = get_outgoing_relationships(
            db_session,
            organization.organization_id,
            source_entity.entity_key,
            relationship_type="hasMedia",
        )

        assert count == 1
        assert results[0].relationship.relationship_type == "hasMedia"


class TestBatchOperations:
    """Tests for batch operations."""

    def test_create_relationships_batch(self, db_session, organization, source_entity, target_entity):
        """Test batch creating relationships."""
        relationships = [
            RelationshipCreate(
                source_entity_key=source_entity.entity_key,
                target_entity_key=target_entity.entity_key,
                relationship_type="hasMedia",
            ),
            RelationshipCreate(
                source_entity_key=source_entity.entity_key,
                target_entity_key=target_entity.entity_key,
                relationship_type="relatedTo",
            ),
        ]

        created, skipped, errors = create_relationships_batch(
            db_session,
            organization.organization_id,
            relationships,
        )
        db_session.commit()

        assert created == 2
        assert skipped == 0
        assert len(errors) == 0

    def test_batch_skip_duplicates(self, db_session, organization, source_entity, target_entity):
        """Test that batch operation skips duplicates."""
        # Create first relationship
        data = RelationshipCreate(
            source_entity_key=source_entity.entity_key,
            target_entity_key=target_entity.entity_key,
            relationship_type="hasMedia",
        )
        create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        # Try to create same relationship in batch
        relationships = [data]
        created, skipped, errors = create_relationships_batch(
            db_session,
            organization.organization_id,
            relationships,
            skip_duplicates=True,
        )

        assert created == 0
        assert skipped == 1
        assert len(errors) == 0

    def test_delete_relationships_for_entity(self, db_session, organization, source_entity, target_entity):
        """Test deleting all relationships for an entity."""
        # Create relationships
        for rel_type in ["hasMedia", "relatedTo"]:
            data = RelationshipCreate(
                source_entity_key=source_entity.entity_key,
                target_entity_key=target_entity.entity_key,
                relationship_type=rel_type,
            )
            create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        deleted = delete_relationships_for_entity(
            db_session,
            organization.organization_id,
            source_entity.entity_key,
        )
        db_session.commit()

        assert deleted == 2

        # Verify they're gone
        results, count = get_outgoing_relationships(
            db_session,
            organization.organization_id,
            source_entity.entity_key,
        )
        assert count == 0


class TestRelationshipTypeCounts:
    """Tests for get_relationship_type_counts."""

    def test_count_by_type(self, db_session, organization, source_entity, target_entity):
        """Test counting relationships by type."""
        # Create relationships of different types with unique target keys
        relationships = [
            ("hasMedia", "target_1"),
            ("hasMedia", "target_2"),
            ("relatedTo", "target_3"),
        ]

        for rel_type, target_suffix in relationships:
            data = RelationshipCreate(
                source_entity_key=source_entity.entity_key,
                target_entity_key=f"{target_entity.entity_key}_{target_suffix}",
                relationship_type=rel_type,
            )
            create_relationship(db_session, organization.organization_id, data)
        db_session.commit()

        counts = get_relationship_type_counts(
            db_session,
            organization.organization_id,
        )

        assert counts.get("hasMedia", 0) == 2
        assert counts.get("relatedTo", 0) == 1


class TestValidateRelationshipType:
    """Tests for validate_relationship_type."""

    def test_known_types_valid(self):
        """Test that known relationship types are valid."""
        assert validate_relationship_type("hasMedia") is True
        assert validate_relationship_type("inExhibition") is True
        assert validate_relationship_type("relatedTo") is True

    def test_custom_types_valid(self):
        """Test that custom camelCase/snake_case types are valid."""
        assert validate_relationship_type("customType") is True
        assert validate_relationship_type("custom_type") is True
        assert validate_relationship_type("MyRelation123") is True

    def test_invalid_types(self):
        """Test that invalid types are rejected."""
        assert validate_relationship_type("") is False
        assert validate_relationship_type("   ") is False
        assert validate_relationship_type("123start") is False
        assert validate_relationship_type("has-media") is False  # No hyphens
