"""
Unit tests for connector base classes and dynamic loading.

Run with: pytest tests/test_connectors.py -v
"""

import copy
import pytest

from app.connectors import (
    BaseSourceConnector,
    BaseTargetConnector,
    ConnectorLoadError,
    ConnectorConfigError,
    create_connector,
)
from app.connectors.loader import (
    load_connector_class,
    load_connector_from_db_record,
    validate_connector_config,
    compute_schema_fingerprint,
    resolve_org_overlay_implementation,
)
from app.connectors.stub import StubSourceConnector, StubTargetConnector


class TestBaseConnector:
    """Test base connector interface."""

    def test_source_connector_interface(self):
        """Test that StubSourceConnector implements required methods."""
        connector = StubSourceConnector(config={"api_key": "test"}, organization_id="org-123")
        assert connector.direction == "source"
        assert hasattr(connector, "extract")
        assert hasattr(connector, "normalize")

    def test_target_connector_interface(self):
        """Test that StubTargetConnector implements required methods."""
        connector = StubTargetConnector(
            config={"output_path": "/tmp/test"}, organization_id="org-123"
        )
        assert connector.direction == "target"
        assert hasattr(connector, "publish_records")
        assert hasattr(connector, "publish_change_log")

    def test_source_connector_extract(self):
        """Test extract method returns records."""
        connector = StubSourceConnector(config={"api_key": "test"}, organization_id="tenant-123")
        records = list(connector.extract(limit=5))
        assert len(records) == 5
        assert records[0]["id"] == 1
        assert "title" in records[0]

    def test_source_connector_normalize(self):
        """Test normalize method produces canonical format."""
        connector = StubSourceConnector(config={"api_key": "test"}, organization_id="tenant-123")
        raw = {"id": 123, "title": "Test Object", "modified_date": "2026-01-04"}
        normalized = connector.normalize(raw)

        assert normalized["entity_key"] == "stub:123"
        assert normalized["source_system"] == "stub"
        assert normalized["source_id"] == "123"
        assert normalized["title"] == "Test Object"
        assert "payload" in normalized

    def test_connector_config_validation_failure(self):
        """Test that connector raises error on invalid config."""
        with pytest.raises(ValueError, match="api_key is required"):
            StubSourceConnector(config={}, organization_id="tenant-123")


class TestConnectorLoader:
    """Test dynamic connector loading."""

    def test_load_connector_class_valid(self):
        """Test loading a valid connector class."""
        cls = load_connector_class("app.connectors.stub:StubSourceConnector")
        assert cls == StubSourceConnector
        assert issubclass(cls, BaseSourceConnector)

    def test_load_connector_class_invalid_format(self):
        """Test error on invalid implementation_key format."""
        with pytest.raises(ConnectorLoadError, match="Invalid implementation_key format"):
            load_connector_class("invalid.format")

    def test_load_connector_class_module_not_found(self):
        """Test error when module doesn't exist."""
        with pytest.raises(ConnectorLoadError, match="Module not found for implementation_key"):
            load_connector_class("app.connectors.nonexistent:FakeConnector")

    def test_load_connector_class_class_not_found(self):
        """Test error when class doesn't exist in module."""
        with pytest.raises(ConnectorLoadError, match="Class 'NonExistent' not found"):
            load_connector_class("app.connectors.stub:NonExistent")

    def test_load_connector_class_not_a_class(self):
        """Test error when the attribute is not a class (e.g., a function or constant)."""
        with pytest.raises(ConnectorLoadError, match="is not a class"):
            load_connector_class("importlib:import_module")

    def test_load_connector_class_wrong_base_class(self):
        """Test error when class is not a subclass of BaseConnector."""
        with pytest.raises(ConnectorLoadError, match="is not a subclass of BaseConnector"):
            load_connector_class("builtins:dict")

    def test_load_connector_class_empty_key(self):
        """Test error when implementation_key is empty."""
        with pytest.raises(ConnectorLoadError, match="implementation_key cannot be empty"):
            load_connector_class("")

    def test_load_connector_class_empty_parts(self):
        """Test error when module or class name is empty."""
        with pytest.raises(ConnectorLoadError, match="Module path and class name cannot be empty"):
            load_connector_class(":ClassName")
        with pytest.raises(ConnectorLoadError, match="Module path and class name cannot be empty"):
            load_connector_class("module.path:")

    def test_validate_connector_config_valid(self):
        """Test config validation with valid config."""
        schema = {
            "type": "object",
            "properties": {"api_key": {"type": "string"}},
            "required": ["api_key"],
        }
        config = {"api_key": "test123"}
        validate_connector_config(config, schema)  # Should not raise

    def test_validate_connector_config_invalid(self):
        """Test config validation with invalid config."""
        schema = {
            "type": "object",
            "properties": {"api_key": {"type": "string"}},
            "required": ["api_key"],
        }
        config = {}  # Missing required field
        with pytest.raises(ConnectorConfigError, match="Connector config is invalid under the current schema"):
            validate_connector_config(config, schema)

    def test_validate_connector_config_rejects_unknown_keys(self):
        """Test that unknown keys are rejected by default."""
        schema = {
            "type": "object",
            "properties": {"api_key": {"type": "string"}},
            "required": ["api_key"],
        }
        config = {"api_key": "test123", "unknown_field": "value"}
        with pytest.raises(ConnectorConfigError, match="Connector config is invalid under the current schema"):
            validate_connector_config(config, schema)

    def test_validate_connector_config_requires_schema(self):
        """Test that validation requires schema to be provided."""
        config = {"api_key": "test123"}
        with pytest.raises(ConnectorConfigError, match="config_schema is required"):
            validate_connector_config(config, None)
        with pytest.raises(ConnectorConfigError, match="config_schema is required"):
            validate_connector_config(config, {})

    def test_validate_connector_config_does_not_mutate_schema(self):
        """Test that validation does not mutate the input schema dict."""
        schema = {
            "type": "object",
            "properties": {"api_key": {"type": "string"}},
            "required": ["api_key"],
        }
        schema_copy = copy.deepcopy(schema)
        config = {"api_key": "test123"}

        validate_connector_config(config, schema)

        # Schema should be unchanged (no additionalProperties injected)
        assert schema == schema_copy
        assert "additionalProperties" not in schema

    def test_validate_connector_config_requires_object_schema(self):
        """Test that validation rejects non-object schemas."""
        schema = {
            "type": "object"
        }
        config = {"api_key": "test123"}
        with pytest.raises(ConnectorConfigError, match="must be an object schema"):
            validate_connector_config(config, schema)

    def test_validate_connector_config_requires_dict_config(self):
        """Test that validation rejects non-dict configs."""
        schema = {
            "type": "object",
            "properties": {"api_key": {"type": "string"}},
        }

        # Config is None
        with pytest.raises(ConnectorConfigError, match="config must be an object"):
            validate_connector_config(None, schema)

        # Config is a list
        with pytest.raises(ConnectorConfigError, match="config must be an object"):
            validate_connector_config(["item1", "item2"], schema)

        # Config is a string
        with pytest.raises(ConnectorConfigError, match="config must be an object"):
            validate_connector_config("string_config", schema)

    def test_compute_schema_fingerprint(self):
        """Test schema fingerprint computation."""
        schema1 = {
            "type": "object",
            "properties": {"api_key": {"type": "string"}},
        }
        schema2 = {
            "properties": {"api_key": {"type": "string"}},
            "type": "object",  # Different order, same content
        }

        fingerprint1 = compute_schema_fingerprint(schema1)
        fingerprint2 = compute_schema_fingerprint(schema2)

        # Should be 64-character hex string
        assert len(fingerprint1) == 64
        assert all(c in '0123456789abcdef' for c in fingerprint1)

        # Should be stable regardless of key order
        assert fingerprint1 == fingerprint2

        # Different schemas should have different fingerprints
        schema3 = {
            "type": "object",
            "properties": {"different_key": {"type": "string"}},
        }
        fingerprint3 = compute_schema_fingerprint(schema3)
        assert fingerprint3 != fingerprint1

    def test_create_connector_success(self):
        """Test successful connector creation."""
        schema = {
            "type": "object",
            "properties": {"api_key": {"type": "string"}},
            "required": ["api_key"],
        }
        config = {"api_key": "test123"}

        connector = create_connector(
            implementation_key="app.connectors.stub:StubSourceConnector",
            config=config,
            config_schema=schema,
            organization_id="org-123",
        )

        assert isinstance(connector, StubSourceConnector)
        assert connector.config == config
        assert connector.organization_id == "org-123"

    def test_create_connector_schema_validation_failure(self):
        """Test connector creation fails on schema validation."""
        schema = {
            "type": "object",
            "properties": {"api_key": {"type": "string"}},
            "required": ["api_key"],
        }
        config = {"wrong_field": "value"}

        with pytest.raises(ConnectorConfigError):
            create_connector(
                implementation_key="app.connectors.stub:StubSourceConnector",
                config=config,
                config_schema=schema,
                organization_id="tenant-123",
            )

    def test_create_connector_custom_validation_failure(self):
        """Test connector creation fails on custom validation."""
        schema = {
            "type": "object",
            "properties": {"output_path": {"type": "string"}},
            "required": ["output_path"],
        }
        config = {"output_path": "/tmp/test"}

        # StubSourceConnector requires api_key but we give it output_path schema
        # This actually passes schema validation but fails connector's validate_config
        schema_source = {
            "type": "object",
            "properties": {"dummy": {"type": "string"}},
        }
        config_empty = {"dummy": "val"}

        with pytest.raises(ConnectorLoadError, match="Failed to instantiate connector"):
            create_connector(
                implementation_key="app.connectors.stub:StubSourceConnector",
                config=config_empty,
                config_schema=schema_source,
                organization_id="tenant-123",
            )

    def test_create_connector_requires_schema(self):
        """Test that create_connector requires schema to be provided."""
        config = {"api_key": "test123"}

        with pytest.raises(ConnectorConfigError, match="config_schema is required"):
            create_connector(
                implementation_key="app.connectors.stub:StubSourceConnector",
                config=config,
                config_schema=None,
                organization_id="tenant-123",
            )

        with pytest.raises(ConnectorConfigError, match="config_schema is required"):
            create_connector(
                implementation_key="app.connectors.stub:StubSourceConnector",
                config=config,
                config_schema={},
                organization_id="tenant-123",
            )


class TestConnectorFromDB:
    """Test loading connectors from database records."""

    def test_load_connector_from_db_record_success(self):
        """Test successful loading from DB records."""
        definition = {
            "implementation_key": "app.connectors.stub:StubSourceConnector",
            "config_schema": {
                "type": "object",
                "properties": {"api_key": {"type": "string"}},
                "required": ["api_key"],
            },
        }
        instance = {
            "connector_instance_id": "550e8400-e29b-41d4-a716-446655440000",
            "config": {"api_key": "test123"},
        }
        organization_id = "tenant-uuid"

        connector = load_connector_from_db_record(instance, definition, organization_id)

        assert isinstance(connector, StubSourceConnector)
        assert connector.config == {"api_key": "test123"}
        assert connector.organization_id == organization_id

    def test_load_connector_from_db_record_missing_implementation_key(self):
        """Test error when implementation_key is missing from definition."""
        definition = {
            "config_schema": {"type": "object", "properties": {}},
        }
        instance = {
            "config": {"api_key": "test123"},
        }

        with pytest.raises(ConnectorLoadError, match="Missing required DB field: implementation_key"):
            load_connector_from_db_record(instance, definition, "tenant-123")

    def test_load_connector_from_db_record_missing_config_schema(self):
        """Test error when config_schema is missing from definition."""
        definition = {
            "implementation_key": "app.connectors.stub:StubSourceConnector",
        }
        instance = {
            "config": {"api_key": "test123"},
        }

        with pytest.raises(ConnectorLoadError, match="Missing required DB field: config_schema"):
            load_connector_from_db_record(instance, definition, "tenant-123")

    def test_load_connector_from_db_record_missing_config(self):
        """Test error when config is missing from instance."""
        definition = {
            "implementation_key": "app.connectors.stub:StubSourceConnector",
            "config_schema": {
                "type": "object",
                "properties": {"api_key": {"type": "string"}},
            },
        }
        instance = {
            "connector_instance_id": "550e8400-e29b-41d4-a716-446655440000",
        }

        with pytest.raises(ConnectorLoadError, match="Missing required DB field: config"):
            load_connector_from_db_record(instance, definition, "tenant-123")


class TestConnectorFunctionality:
    """Test end-to-end connector functionality."""

    def test_source_connector_extraction_with_cursor(self):
        """Test incremental extraction with cursor."""
        connector = StubSourceConnector(config={"api_key": "test"}, organization_id="tenant-123")

        # Extract with cursor
        records = list(connector.extract(cursor={"since_id": 5}, limit=10))
        assert len(records) == 5  # Should skip first 5
        assert records[0]["id"] == 6

    def test_target_connector_publish_records(self):
        """Test publishing records to target."""
        connector = StubTargetConnector(
            config={"output_path": "/tmp/test.json"}, organization_id="tenant-123"
        )

        entities = [
            {"entity_key": "stub:1", "title": "Object 1"},
            {"entity_key": "stub:2", "title": "Object 2"},
        ]

        # Should not raise
        connector.publish_records(entities)

    def test_target_connector_publish_changes(self):
        """Test publishing changes to target."""
        connector = StubTargetConnector(
            config={"output_path": "/tmp/test.json"}, organization_id="tenant-123"
        )

        changes = [
            {
                "change_type": "updated",
                "entity_key": "stub:1",
                "changed_fields": ["title"],
            },
            {
                "change_type": "created",
                "entity_key": "stub:2",
                "changed_fields": None,
            },
        ]

        # Should not raise
        connector.publish_change_log(changes)

    def test_target_connector_get_target_url(self):
        """Test get_target_url returns a URL."""
        connector = StubTargetConnector(
            config={"output_path": "/tmp/test.json"}, organization_id="tenant-123"
        )

        url = connector.get_target_url()
        assert url is not None
        assert "stub" in url.lower() or "example" in url.lower()


class TestOrgOverlayResolution:
    """Test org overlay resolution for connectors."""

    def test_resolve_org_overlay_disabled(self):
        """Test that overlay resolution is bypassed when disabled."""
        result = resolve_org_overlay_implementation(
            default_implementation_key="app.connectors.core.smithsonian:SmithsonianConnector",
            connector_definition_key="smithsonian-openaccess",
            org_slug="example_museum",
            enable_overlay=False
        )
        assert result == "app.connectors.core.smithsonian:SmithsonianConnector"

    def test_resolve_org_overlay_not_found(self):
        """Test fallback to default when org-specific implementation doesn't exist."""
        result = resolve_org_overlay_implementation(
            default_implementation_key="app.connectors.core.nonexistent:NonExistentConnector",
            connector_definition_key="nonexistent-connector",
            org_slug="example_museum",
            enable_overlay=True
        )
        # Should fall back to default since org-specific doesn't exist
        assert result == "app.connectors.core.nonexistent:NonExistentConnector"

    def test_resolve_org_overlay_invalid_key_format(self):
        """Test handling of invalid implementation_key format."""
        result = resolve_org_overlay_implementation(
            default_implementation_key="invalid_format_no_colon",
            connector_definition_key="test",
            org_slug="example_museum",
            enable_overlay=True
        )
        # Should return default when format is invalid
        assert result == "invalid_format_no_colon"

    def test_resolve_org_overlay_normalizes_org_slug(self):
        """Test that org slug is normalized for filesystem."""
        result = resolve_org_overlay_implementation(
            default_implementation_key="app.connectors.core.test:TestConnector",
            connector_definition_key="test-connector",
            org_slug="my-org-name",
            enable_overlay=True
        )
        # Should fall back to default since the org-specific implementation doesn't exist
        assert result == "app.connectors.core.test:TestConnector"

    def test_load_connector_from_db_without_org_slug(self):
        """Test that loading works without org_slug (no overlay resolution)."""
        definition = {
            "key": "stub-source",
            "implementation_key": "app.connectors.stub:StubSourceConnector",
            "config_schema": {
                "type": "object",
                "properties": {"api_key": {"type": "string"}},
                "required": ["api_key"],
            },
        }
        instance = {
            "connector_instance_id": "550e8400-e29b-41d4-a716-446655440000",
            "config": {"api_key": "test123"},
        }

        # Without org_slug, should use default implementation
        connector = load_connector_from_db_record(
            instance,
            definition,
            "org-uuid"
            # No org_slug provided
        )

        assert isinstance(connector, StubSourceConnector)


class TestSmithsonianBaseAndOverlay:
    """Test Smithsonian base connector and org overlay pattern (if available)."""

    def test_load_smithsonian_base_connector(self):
        """Test that the base Smithsonian connector can be loaded."""
        try:
            from app.connectors.core.smithsonian_base import SmithsonianBaseConnector
        except ImportError:
            pytest.skip("SmithsonianBaseConnector not available")

        config = {"api_key": "test-api-key-123"}
        org_id = "test-org-uuid"

        connector = SmithsonianBaseConnector(config, org_id)

        assert connector.direction == "source"
        assert connector.config == config
        assert connector.organization_id == org_id

    def test_load_smithsonian_org_overlay(self):
        """Test that the Example Museum org overlay can be loaded."""
        try:
            from app.connectors.orgs.example_museum.smithsonian import SmithsonianConnector
            from app.connectors.core.smithsonian_base import SmithsonianBaseConnector
        except ImportError:
            pytest.skip("SmithsonianConnector org overlay not available")

        config = {"api_key": "test-api-key-456"}
        org_id = "example-museum-org-uuid"

        connector = SmithsonianConnector(config, org_id)

        # Verify it's a subclass of base
        assert isinstance(connector, SmithsonianBaseConnector)
        assert isinstance(connector, SmithsonianConnector)

    def test_smithsonian_org_overlay_via_implementation_key(self):
        """Test loading org overlay via implementation_key string."""
        try:
            load_connector_class("app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector")
        except ConnectorLoadError:
            pytest.skip("SmithsonianConnector org overlay not available")

        impl_key = "app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector"
        connector_class = load_connector_class(impl_key)

        assert connector_class.__name__ == "SmithsonianConnector"
        assert connector_class.__module__ == "app.connectors.orgs.example_museum.smithsonian"

    def test_smithsonian_base_via_implementation_key(self):
        """Test loading base connector via implementation_key string."""
        try:
            load_connector_class("app.connectors.core.smithsonian_base:SmithsonianBaseConnector")
        except ConnectorLoadError:
            pytest.skip("SmithsonianBaseConnector not available")

        impl_key = "app.connectors.core.smithsonian_base:SmithsonianBaseConnector"
        connector_class = load_connector_class(impl_key)

        assert connector_class.__name__ == "SmithsonianBaseConnector"
        assert connector_class.__module__ == "app.connectors.core.smithsonian_base"

    def test_smithsonian_org_overlay_resolution(self):
        """Test org overlay resolution with actual Example Museum connector."""
        try:
            load_connector_class("app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector")
        except ConnectorLoadError:
            pytest.skip("SmithsonianConnector org overlay not available")

        impl_key = "app.connectors.core.smithsonian_base:SmithsonianConnector"
        org_slug = "example_museum"
        connector_definition_key = "smithsonian-openaccess"

        result = resolve_org_overlay_implementation(
            default_implementation_key=impl_key,
            org_slug=org_slug,
            connector_definition_key=connector_definition_key,
            enable_overlay=True
        )

        expected = "app.connectors.orgs.example_museum.smithsonian:SmithsonianConnector"
        assert result == expected
