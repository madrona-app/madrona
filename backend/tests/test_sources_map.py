"""
Tests for source provenance tracking on EntityCurrent.

Verifies the sources map structure, entity key namespacing,
and multi-source step creation. These tests use mocking rather
than executing a full pipeline run (which requires live connectors).
"""

import pytest
from datetime import datetime, timezone
from uuid import uuid4

from app.models import (
    Organization,
    ConnectorDefinition,
    ConnectorInstance,
    Pipeline,
    PipelineSource,
    EntityCurrent,
    Run,
    RunSourceStep,
    Dataset,
)
from app.services.run_steps import create_run_steps


class TestSourcesMapStructure:
    """Test EntityCurrent.sources map structure and semantics."""

    def test_sources_map_stores_provenance(self, db_session):
        """Entity sources map stores per-source provenance data."""
        org = Organization(
            name="Sources Map Org",
            slug="sources-map-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        connector_id = str(uuid4())
        now = datetime.now(timezone.utc)
        # Seed a real Run so the entity_current.last_run_id FK resolves.
        _run = Run(
            organization_id=org.organization_id,
            status="running",
            triggered_by="test",
            parameters={},
        )
        db_session.add(_run)
        db_session.flush()
        run_id = _run.run_id

        entity = EntityCurrent(
            organization_id=org.organization_id,
            entity_key=f"stub:{connector_id}:1",
            entity_type="record",
            source_system="stub",
            source_id="1",
            payload={"id": 1, "name": "Test Entity"},
            payload_hash="abc123",
            sources={
                connector_id: {
                    "raw_payload": {"id": 1, "name": "Test Entity"},
                    "last_seen_at": now.isoformat(),
                    "run_id": str(run_id),
                },
            },
            extracted_at=now,
            last_seen_at=now,
            last_run_id=run_id,
        )
        db_session.add(entity)
        db_session.commit()

        # Verify sources map structure
        assert isinstance(entity.sources, dict)
        assert len(entity.sources) == 1

        source_data = entity.sources[connector_id]
        assert "raw_payload" in source_data
        assert "last_seen_at" in source_data
        assert "run_id" in source_data

    def test_entity_key_namespacing(self, db_session):
        """Entity keys follow {source_system}:{connector_id}:{source_id} format."""
        org = Organization(
            name="Namespace Org",
            slug="namespace-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        connector_id = str(uuid4())
        now = datetime.now(timezone.utc)

        entity = EntityCurrent(
            organization_id=org.organization_id,
            entity_key=f"smithsonian:{connector_id}:OBJ-001",
            entity_type="record",
            source_system="smithsonian",
            source_id="OBJ-001",
            payload={"object_number": "OBJ-001"},
            payload_hash="def456",
            sources={},
            extracted_at=now,
            last_seen_at=now,
        )
        db_session.add(entity)
        db_session.commit()

        # Verify key structure
        parts = entity.entity_key.split(":")
        assert len(parts) == 3
        assert parts[0] == "smithsonian"
        assert parts[1] == connector_id
        assert parts[2] == "OBJ-001"

    def test_different_sources_create_distinct_entities(self, db_session):
        """Different source_systems with same source_id create distinct entities.

        The unique index on (organization_id, source_system, source_id) means
        different source_system values produce different rows, matching the
        real namespacing behavior where each connector type uses its own
        source_system prefix.
        """
        org = Organization(
            name="Distinct Org",
            slug="distinct-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        connector_a_id = str(uuid4())
        connector_b_id = str(uuid4())
        now = datetime.now(timezone.utc)

        # Different source_system values prevent unique constraint violation
        entity_a = EntityCurrent(
            organization_id=org.organization_id,
            entity_key=f"source_a:{connector_a_id}:1",
            entity_type="record",
            source_system="source_a",
            source_id="1",
            payload={"id": 1, "source": "A"},
            payload_hash="hash_a",
            sources={connector_a_id: {"run_id": str(uuid4())}},
            extracted_at=now,
            last_seen_at=now,
        )
        entity_b = EntityCurrent(
            organization_id=org.organization_id,
            entity_key=f"source_b:{connector_b_id}:1",
            entity_type="record",
            source_system="source_b",
            source_id="1",
            payload={"id": 1, "source": "B"},
            payload_hash="hash_b",
            sources={connector_b_id: {"run_id": str(uuid4())}},
            extracted_at=now,
            last_seen_at=now,
        )
        db_session.add_all([entity_a, entity_b])
        db_session.commit()

        # Two distinct entities with same source_id but different source_systems
        entities = (
            db_session.query(EntityCurrent)
            .filter_by(organization_id=org.organization_id)
            .all()
        )
        assert len(entities) == 2

        keys = {e.entity_key for e in entities}
        assert f"source_a:{connector_a_id}:1" in keys
        assert f"source_b:{connector_b_id}:1" in keys


class TestMultiSourceStepCreation:
    """Test that multi-source pipelines create correct run steps."""

    def test_two_sources_create_two_steps(self, db_session):
        """Pipeline with two sources creates two RunSourceStep rows."""
        org = Organization(
            name="Multi Step Org",
            slug="multi-step-org",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.flush()

        source_def = ConnectorDefinition(
            key="multi_step_source",
            display_name="Multi Step Source",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={},
            config_schema={},
            is_enabled=True,
        )
        db_session.add(source_def)
        db_session.flush()

        source_a = ConnectorInstance(
            organization_id=org.organization_id,
            connector_definition_id=source_def.connector_definition_id,
            name="Source A",
            status="active",
            config={"api_key": "key_a"},
        )
        source_b = ConnectorInstance(
            organization_id=org.organization_id,
            connector_definition_id=source_def.connector_definition_id,
            name="Source B",
            status="active",
            config={"api_key": "key_b"},
        )
        db_session.add_all([source_a, source_b])
        db_session.flush()

        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        ps_a = PipelineSource(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=source_a.connector_instance_id,
            enabled=True,
            parameters={},
            ordering=0,
        )
        ps_b = PipelineSource(
            pipeline_id=pipeline.pipeline_id,
            connector_instance_id=source_b.connector_instance_id,
            enabled=True,
            parameters={},
            ordering=1,
        )
        db_session.add_all([ps_a, ps_b])
        db_session.flush()

        run = Run(
            organization_id=org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            status="queued",
            triggered_by="test",
            parameters={},
        )
        db_session.add(run)
        db_session.flush()

        create_run_steps(run)
        db_session.commit()

        source_steps = (
            db_session.query(RunSourceStep)
            .filter_by(run_id=run.run_id)
            .all()
        )
        assert len(source_steps) == 2

        step_source_ids = {s.pipeline_source_id for s in source_steps}
        assert ps_a.source_id in step_source_ids
        assert ps_b.source_id in step_source_ids

        # Both should be pending
        assert all(s.status == "pending" for s in source_steps)
