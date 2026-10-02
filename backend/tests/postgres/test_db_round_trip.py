"""
Integration tests for loading connectors from database records.

Tests the full round trip:
1. Create connector definition + instance in DB
2. Load connector from DB using connector loader
3. Verify connector works correctly

Requires PostgreSQL with TEST_DATABASE_URL set.
"""

import pytest
from uuid import UUID

from app.models import ConnectorDefinition, ConnectorInstance
from app.connectors.loader import load_connector_from_db_record
from app.connectors.base import BaseSourceConnector, BaseTargetConnector

pytestmark = pytest.mark.postgres

import uuid
from uuid import UUID

import pytest

from app.connectors import ConnectorLoadError, ConnectorConfigError
from app.connectors.loader import load_connector_from_db_record
from app.connectors.stub import StubSourceConnector, StubTargetConnector


class TestDBRoundTripHappyPath:
    """Test successful DB → connector instantiation."""

    def test_load_stub_source_connector_from_db(self, db_session, test_tenant):
        """Test full round-trip: DB records → StubSourceConnector."""
        # Step 1: Insert connector_definition with schema
        definition = ConnectorDefinition(
            key="stub-source",
            display_name="Stub Source Connector",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={"incremental": True, "full_refresh": True},
            config_schema={
                "type": "object",
                "properties": {
                    "api_key": {"type": "string", "description": "API key for authentication"},
                },
                "required": ["api_key"],
            },
            default_config=None,
            is_enabled=True,
        )
        db_session.add(definition)
        db_session.commit()
        db_session.refresh(definition)

        # Step 2: Insert connector_instance with valid config
        instance = ConnectorInstance(
            organization_id=test_tenant.organization_id,
            connector_definition_id=definition.connector_definition_id,
            name="Test Stub Source",
            status="active",
            config={"api_key": "test-api-key-12345"},
        )
        db_session.add(instance)
        db_session.commit()
        db_session.refresh(instance)

        # Step 3: Convert to dict (simulating what you'd get from a query)
        definition_dict = {
            "connector_definition_id": definition.connector_definition_id,
            "implementation_key": definition.implementation_key,
            "config_schema": definition.config_schema,
        }
        instance_dict = {
            "connector_instance_id": instance.connector_instance_id,
            "config": instance.config,
        }

        # Step 4: Load connector from DB records
        connector = load_connector_from_db_record(
            connector_instance=instance_dict,
            connector_definition=definition_dict,
            organization_id=test_tenant.organization_id,
        )

        # Step 5: Assert correct connector instantiation
        assert isinstance(connector, StubSourceConnector)
        assert connector.config == {"api_key": "test-api-key-12345"}
        assert connector.organization_id == str(test_tenant.organization_id)
        assert connector.direction == "source"

        # Verify connector is functional
        records = list(connector.extract(limit=3))
        assert len(records) == 3
        assert records[0]["id"] == 1

    def test_load_stub_target_connector_from_db(self, db_session, test_tenant):
        """Test full round-trip: DB records → StubTargetConnector."""
        # Step 1: Insert connector_definition
        definition = ConnectorDefinition(
            key="stub-target",
            display_name="Stub Target Connector",
            direction="target",
            implementation_key="app.connectors.stub:StubTargetConnector",
            capabilities={"batch_write": True},
            config_schema={
                "type": "object",
                "properties": {
                    "output_path": {"type": "string"},
                },
                "required": ["output_path"],
            },
        )
        db_session.add(definition)
        db_session.commit()
        db_session.refresh(definition)

        # Step 2: Insert connector_instance
        instance = ConnectorInstance(
            organization_id=test_tenant.organization_id,
            connector_definition_id=definition.connector_definition_id,
            name="Test Stub Target",
            status="active",
            config={"output_path": "/tmp/test-output.json"},
        )
        db_session.add(instance)
        db_session.commit()
        db_session.refresh(instance)

        # Step 3: Load connector
        connector = load_connector_from_db_record(
            connector_instance={"config": instance.config},
            connector_definition={
                "implementation_key": definition.implementation_key,
                "config_schema": definition.config_schema,
            },
            organization_id=test_tenant.organization_id,
        )

        # Step 4: Assertions
        assert isinstance(connector, StubTargetConnector)
        assert connector.config == {"output_path": "/tmp/test-output.json"}
        assert connector.direction == "target"

        # Verify connector is functional
        test_entities = [{"entity_key": "test:1", "title": "Test"}]
        connector.publish_records(test_entities)  # Should not raise

    def test_tenant_id_normalization_with_uuid_object(self, db_session, test_tenant):
        """Test that tenant_id is normalized from UUID to string."""
        definition = ConnectorDefinition(
            key="stub-normalize",
            display_name="Stub for UUID Normalization",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={},
            config_schema={
                "type": "object",
                "properties": {"api_key": {"type": "string"}},
                "required": ["api_key"],
            },
        )
        db_session.add(definition)
        db_session.commit()

        instance = ConnectorInstance(
            organization_id=test_tenant.organization_id,
            connector_definition_id=definition.connector_definition_id,
            name="UUID Test",
            status="active",
            config={"api_key": "test"},
        )
        db_session.add(instance)
        db_session.commit()

        # Pass UUID object directly (not string)
        connector = load_connector_from_db_record(
            connector_instance={"config": instance.config},
            connector_definition={
                "implementation_key": definition.implementation_key,
                "config_schema": definition.config_schema,
            },
            organization_id=test_tenant.organization_id,  # UUID object
        )

        # Should be normalized to string
        assert connector.organization_id == str(test_tenant.organization_id)
        assert isinstance(connector.organization_id, str)


class TestDBRoundTripFailureModes:
    """Test failure scenarios in DB → connector flow."""

    def test_missing_config_schema_in_definition(self, db_session, test_tenant):
        """Test that missing config_schema in definition raises clear error."""
        definition = ConnectorDefinition(
            key="missing-schema",
            display_name="Missing Schema Connector",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={},
            config_schema={},  # Empty schema (will fail the guard)
        )
        db_session.add(definition)
        db_session.commit()

        instance = ConnectorInstance(
            organization_id=test_tenant.organization_id,
            connector_definition_id=definition.connector_definition_id,
            name="Test Instance",
            status="active",
            config={"api_key": "test"},
        )
        db_session.add(instance)
        db_session.commit()

        # Should fail with clear error about missing schema
        with pytest.raises(ConnectorConfigError, match="config_schema is required"):
            load_connector_from_db_record(
                connector_instance={"config": instance.config},
                connector_definition={
                    "implementation_key": definition.implementation_key,
                    "config_schema": definition.config_schema,  # Empty dict
                },
                organization_id=test_tenant.organization_id,
            )

    def test_invalid_implementation_key(self, db_session, test_tenant):
        """Test that invalid implementation_key raises ConnectorLoadError."""
        definition = ConnectorDefinition(
            key="invalid-impl",
            display_name="Invalid Implementation Key",
            direction="source",
            implementation_key="app.connectors.nonexistent:FakeConnector",
            capabilities={},
            config_schema={
                "type": "object",
                "properties": {"api_key": {"type": "string"}},
            },
        )
        db_session.add(definition)
        db_session.commit()

        instance = ConnectorInstance(
            organization_id=test_tenant.organization_id,
            connector_definition_id=definition.connector_definition_id,
            name="Test",
            status="active",
            config={"api_key": "test"},
        )
        db_session.add(instance)
        db_session.commit()

        with pytest.raises(ConnectorLoadError, match="Module not found for implementation_key"):
            load_connector_from_db_record(
                connector_instance={"config": instance.config},
                connector_definition={
                    "implementation_key": definition.implementation_key,
                    "config_schema": definition.config_schema,
                },
                organization_id=test_tenant.organization_id,
            )

    def test_config_invalid_under_schema(self, db_session, test_tenant):
        """Test that config validation fails when config doesn't match schema."""
        definition = ConnectorDefinition(
            key="schema-mismatch",
            display_name="Schema Mismatch Test",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={},
            config_schema={
                "type": "object",
                "properties": {
                    "api_key": {"type": "string"},
                    "endpoint": {"type": "string"},
                },
                "required": ["api_key", "endpoint"],
            },
        )
        db_session.add(definition)
        db_session.commit()

        # Config missing required 'endpoint' field
        instance = ConnectorInstance(
            organization_id=test_tenant.organization_id,
            connector_definition_id=definition.connector_definition_id,
            name="Test",
            status="active",
            config={"api_key": "test"},  # Missing 'endpoint'
        )
        db_session.add(instance)
        db_session.commit()

        with pytest.raises(
            ConnectorConfigError,
            match="Connector config is invalid under the current schema",
        ):
            load_connector_from_db_record(
                connector_instance={"config": instance.config},
                connector_definition={
                    "implementation_key": definition.implementation_key,
                    "config_schema": definition.config_schema,
                },
                organization_id=test_tenant.organization_id,
            )

    def test_config_with_unknown_keys_rejected(self, db_session, test_tenant):
        """Test that config with unknown keys is rejected (additionalProperties: false)."""
        definition = ConnectorDefinition(
            key="unknown-keys",
            display_name="Unknown Keys Test",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={},
            config_schema={
                "type": "object",
                "properties": {
                    "api_key": {"type": "string"},
                },
                "required": ["api_key"],
                # Note: additionalProperties will be set to false by default
            },
        )
        db_session.add(definition)
        db_session.commit()

        # Config has unknown 'extra_field'
        instance = ConnectorInstance(
            organization_id=test_tenant.organization_id,
            connector_definition_id=definition.connector_definition_id,
            name="Test",
            status="active",
            config={
                "api_key": "test",
                "extra_field": "should_be_rejected",
            },
        )
        db_session.add(instance)
        db_session.commit()

        with pytest.raises(
            ConnectorConfigError,
            match="Connector config is invalid under the current schema",
        ):
            load_connector_from_db_record(
                connector_instance={"config": instance.config},
                connector_definition={
                    "implementation_key": definition.implementation_key,
                    "config_schema": definition.config_schema,
                },
                organization_id=test_tenant.organization_id,
            )

    def test_missing_db_field_implementation_key(self, db_session, test_tenant):
        """Test that missing implementation_key in definition dict raises clear error."""
        # Simulate incomplete DB record (missing implementation_key)
        definition_dict = {
            "config_schema": {
                "type": "object",
                "properties": {"api_key": {"type": "string"}},
            },
            # Missing 'implementation_key'
        }
        instance_dict = {
            "config": {"api_key": "test"},
        }

        with pytest.raises(ConnectorLoadError, match="Missing required DB field: implementation_key"):
            load_connector_from_db_record(
                connector_instance=instance_dict,
                connector_definition=definition_dict,
                organization_id=test_tenant.organization_id,
            )

    def test_missing_db_field_config(self, db_session, test_tenant):
        """Test that missing config in instance dict raises clear error."""
        definition_dict = {
            "implementation_key": "app.connectors.stub:StubSourceConnector",
            "config_schema": {
                "type": "object",
                "properties": {"api_key": {"type": "string"}},
            },
        }
        instance_dict = {
            # Missing 'config'
        }

        with pytest.raises(ConnectorLoadError, match="Missing required DB field: config"):
            load_connector_from_db_record(
                connector_instance=instance_dict,
                connector_definition=definition_dict,
                organization_id=test_tenant.organization_id,
            )

    def test_connector_custom_validation_failure(self, db_session, test_tenant):
        """Test that connector's own validate_config() is called and can fail."""
        definition = ConnectorDefinition(
            key="custom-validation",
            display_name="Custom Validation Test",
            direction="source",
            implementation_key="app.connectors.stub:StubSourceConnector",
            capabilities={},
            config_schema={
                "type": "object",
                "properties": {},  # Permissive schema
            },
        )
        db_session.add(definition)
        db_session.commit()

        # Empty config will pass JSON schema but fail StubSourceConnector's validate_config
        instance = ConnectorInstance(
            organization_id=test_tenant.organization_id,
            connector_definition_id=definition.connector_definition_id,
            name="Test",
            status="active",
            config={},  # StubSourceConnector requires 'api_key'
        )
        db_session.add(instance)
        db_session.commit()

        with pytest.raises(ConnectorLoadError, match="Failed to instantiate connector"):
            load_connector_from_db_record(
                connector_instance={"config": instance.config},
                connector_definition={
                    "implementation_key": definition.implementation_key,
                    "config_schema": definition.config_schema,
                },
                organization_id=test_tenant.organization_id,
            )
