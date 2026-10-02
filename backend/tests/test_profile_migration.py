"""
Unit tests for profile migration support.
"""

import pytest

from app.schemas.profiles.migration import (
    Migration,
    FieldTransform,
    MigrationRegistry,
    MigrationResult,
    migrate_record,
    migrate_record_to_latest,
    migrate_records_batch,
    string_to_array,
    array_to_string,
    normalize_boolean,
    create_rename_transform,
    create_default_transform,
    create_removal_transform,
    create_type_transform,
)


class TestFieldTransform:
    """Test FieldTransform class."""

    def test_rename_field(self):
        """Renames a field."""
        transform = FieldTransform(
            source_field="old_name",
            target_field="new_name",
        )
        props = {"old_name": "value", "other": "keep"}
        result = transform.apply(props)
        assert "old_name" not in result
        assert result["new_name"] == "value"
        assert result["other"] == "keep"

    def test_transform_value(self):
        """Transforms a value during rename."""
        transform = FieldTransform(
            source_field="count",
            target_field="count",
            transform=lambda x: x * 2,
        )
        props = {"count": 5}
        result = transform.apply(props)
        assert result["count"] == 10

    def test_remove_field(self):
        """Removes a field."""
        transform = FieldTransform(source_field="deprecated")
        props = {"deprecated": "old", "keep": "value"}
        result = transform.apply(props)
        assert "deprecated" not in result
        assert result["keep"] == "value"

    def test_add_default(self):
        """Adds a field with default value."""
        transform = FieldTransform(target_field="new_field", default="default_value")
        props = {"existing": "value"}
        result = transform.apply(props)
        assert result["new_field"] == "default_value"
        assert result["existing"] == "value"

    def test_default_not_override(self):
        """Default doesn't override existing value."""
        transform = FieldTransform(target_field="field", default="default")
        props = {"field": "existing"}
        result = transform.apply(props)
        assert result["field"] == "existing"

    def test_rename_with_default(self):
        """Uses default when source is missing."""
        transform = FieldTransform(
            source_field="missing",
            target_field="target",
            default="fallback",
        )
        props = {"other": "value"}
        result = transform.apply(props)
        assert result["target"] == "fallback"


class TestMigration:
    """Test Migration class."""

    def test_basic_migration(self):
        """Basic migration with field rename."""
        migration = Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
            field_renames={"artist": "creator"},
        )
        record = {
            "id": "123",
            "properties": {"artist": "Van Gogh", "title": "Starry Night"},
        }
        result = migration.apply(record)
        assert result["properties"]["creator"] == "Van Gogh"
        assert "artist" not in result["properties"]
        assert result["properties"]["title"] == "Starry Night"

    def test_migration_updates_version(self):
        """Migration updates profile_version in meta."""
        migration = Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
        )
        record = {"id": "123", "properties": {}}
        result = migration.apply(record)
        assert result["meta"]["profile_version"] == "1.1.0"

    def test_field_removal(self):
        """Migration removes deprecated fields."""
        migration = Migration(
            profile="test",
            from_version="1.0.0",
            to_version="2.0.0",
            field_removals=["deprecated_field"],
        )
        record = {
            "properties": {"deprecated_field": "old", "keep_field": "new"},
        }
        result = migration.apply(record)
        assert "deprecated_field" not in result["properties"]
        assert result["properties"]["keep_field"] == "new"

    def test_field_defaults(self):
        """Migration adds default values for new fields."""
        migration = Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
            field_defaults={"new_field": "default_value"},
        )
        record = {"properties": {"existing": "value"}}
        result = migration.apply(record)
        assert result["properties"]["new_field"] == "default_value"
        assert result["properties"]["existing"] == "value"

    def test_custom_migrate(self):
        """Migration applies custom function."""
        def custom(record):
            record["properties"]["computed"] = (
                record["properties"].get("a", 0) +
                record["properties"].get("b", 0)
            )
            return record

        migration = Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
            custom_migrate=custom,
        )
        record = {"properties": {"a": 1, "b": 2}}
        result = migration.apply(record)
        assert result["properties"]["computed"] == 3

    def test_does_not_modify_original(self):
        """Migration doesn't modify original record."""
        migration = Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
            field_renames={"old": "new"},
        )
        record = {"properties": {"old": "value"}}
        migration.apply(record)
        assert "old" in record["properties"]

    def test_validation(self):
        """Migration validates its definition."""
        migration = Migration(
            profile="",
            from_version="1.0.0",
            to_version="invalid",
        )
        errors = migration.validate()
        assert len(errors) >= 2


class TestMigrationRegistry:
    """Test MigrationRegistry class."""

    def test_register_migration(self):
        """Registers a migration."""
        registry = MigrationRegistry()
        migration = Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
        )
        registry.register(migration)
        migrations = registry.get_migrations("test")
        assert len(migrations) == 1
        assert migrations[0].to_version == "1.1.0"

    def test_register_invalid_migration(self):
        """Rejects invalid migration."""
        registry = MigrationRegistry()
        migration = Migration(
            profile="",
            from_version=None,
            to_version="invalid",
        )
        with pytest.raises(ValueError):
            registry.register(migration)

    def test_find_migration_path(self):
        """Finds migration path between versions."""
        registry = MigrationRegistry()
        registry.register(Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
        ))
        registry.register(Migration(
            profile="test",
            from_version="1.1.0",
            to_version="1.2.0",
        ))

        path = registry.find_migration_path("test", "1.0.0", "1.2.0")
        assert len(path) == 2
        assert path[0].to_version == "1.1.0"
        assert path[1].to_version == "1.2.0"

    def test_find_path_no_migration_needed(self):
        """Returns empty path when no migration needed."""
        registry = MigrationRegistry()
        path = registry.find_migration_path("test", "1.2.0", "1.1.0")
        assert path == []

    def test_find_path_missing_profile(self):
        """Raises error for missing profile."""
        registry = MigrationRegistry()
        with pytest.raises(ValueError):
            registry.find_migration_path("nonexistent", "1.0.0", "1.1.0")

    def test_can_migrate(self):
        """can_migrate returns True when path exists."""
        registry = MigrationRegistry()
        registry.register(Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
        ))
        assert registry.can_migrate("test", "1.0.0", "1.1.0") is True
        assert registry.can_migrate("test", "1.0.0", "2.0.0") is False

    def test_get_latest_version(self):
        """get_latest_version returns highest version."""
        registry = MigrationRegistry()
        registry.register(Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
        ))
        registry.register(Migration(
            profile="test",
            from_version="1.1.0",
            to_version="1.2.0",
        ))
        assert registry.get_latest_version("test") == "1.2.0"

    def test_get_latest_version_no_migrations(self):
        """get_latest_version returns None for unknown profile."""
        registry = MigrationRegistry()
        assert registry.get_latest_version("unknown") is None


class TestMigrateRecord:
    """Test migrate_record function."""

    def test_migrate_through_multiple_versions(self):
        """Migrates record through multiple versions."""
        registry = MigrationRegistry()
        registry.register(Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
            field_renames={"old1": "new1"},
        ))
        registry.register(Migration(
            profile="test",
            from_version="1.1.0",
            to_version="1.2.0",
            field_renames={"old2": "new2"},
        ))

        record = {"properties": {"old1": "val1", "old2": "val2"}}
        result = migrate_record(record, "test", "1.0.0", "1.2.0", registry)

        assert result["properties"]["new1"] == "val1"
        assert result["properties"]["new2"] == "val2"
        assert result["meta"]["profile_version"] == "1.2.0"

    def test_migrate_updates_version_only(self):
        """When no migrations, just updates version."""
        registry = MigrationRegistry()
        registry.register(Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
        ))

        record = {"properties": {"field": "value"}}
        result = migrate_record(record, "test", "1.1.0", "1.1.0", registry)

        assert result["properties"]["field"] == "value"
        assert result["meta"]["profile_version"] == "1.1.0"


class TestMigrateRecordToLatest:
    """Test migrate_record_to_latest function."""

    def test_migrate_to_latest(self):
        """Migrates to the latest available version."""
        registry = MigrationRegistry()
        registry.register(Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
        ))
        registry.register(Migration(
            profile="test",
            from_version="1.1.0",
            to_version="2.0.0",
        ))

        record = {"properties": {}}
        result, version = migrate_record_to_latest(
            record, "test", "1.0.0", registry
        )

        assert version == "2.0.0"
        assert result["meta"]["profile_version"] == "2.0.0"

    def test_no_migrations_returns_original_version(self):
        """Returns original version when no migrations exist."""
        registry = MigrationRegistry()
        record = {"properties": {}}
        result, version = migrate_record_to_latest(
            record, "unknown", "1.0.0", registry
        )

        assert version == "1.0.0"


class TestMigrateRecordsBatch:
    """Test migrate_records_batch function."""

    def test_batch_migration(self):
        """Migrates batch of records."""
        registry = MigrationRegistry()
        registry.register(Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
            field_renames={"old": "new"},
        ))

        records = [
            {"meta": {"profile_version": "1.0.0"}, "properties": {"old": "val1"}},
            {"meta": {"profile_version": "1.0.0"}, "properties": {"old": "val2"}},
        ]

        results, report = migrate_records_batch(
            records, "test", "1.1.0", registry
        )

        assert len(results) == 2
        assert results[0]["properties"]["new"] == "val1"
        assert results[1]["properties"]["new"] == "val2"
        assert report.migrated_count == 2
        assert report.error_count == 0

    def test_batch_skips_already_migrated(self):
        """Skips records already at or above target version."""
        registry = MigrationRegistry()
        registry.register(Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
        ))

        records = [
            {"meta": {"profile_version": "1.0.0"}, "properties": {}},
            {"meta": {"profile_version": "1.1.0"}, "properties": {}},
            {"meta": {"profile_version": "1.2.0"}, "properties": {}},
        ]

        results, report = migrate_records_batch(
            records, "test", "1.1.0", registry
        )

        assert report.migrated_count == 1
        assert report.skipped_count == 2

    def test_batch_handles_errors(self):
        """Handles migration errors in batch."""
        registry = MigrationRegistry()

        def bad_migrate(record):
            raise ValueError("Intentional error")

        registry.register(Migration(
            profile="test",
            from_version="1.0.0",
            to_version="1.1.0",
            custom_migrate=bad_migrate,
        ))

        records = [
            {"id": "good", "meta": {"profile_version": "1.1.0"}, "properties": {}},
            {"id": "bad", "meta": {"profile_version": "1.0.0"}, "properties": {}},
        ]

        results, report = migrate_records_batch(
            records, "test", "1.1.0", registry
        )

        assert len(results) == 2
        assert report.skipped_count == 1
        assert report.error_count == 1
        assert report.errors[0]["record_id"] == "bad"


class TestTransformHelpers:
    """Test common transformation helpers."""

    def test_string_to_array(self):
        """Converts string to single-item array."""
        assert string_to_array("value") == ["value"]
        assert string_to_array(["a", "b"]) == ["a", "b"]
        assert string_to_array(None) == []

    def test_array_to_string(self):
        """Converts array to joined string."""
        assert array_to_string(["a", "b", "c"]) == "a, b, c"
        assert array_to_string(["a", "b"], "; ") == "a; b"
        assert array_to_string("already string") == "already string"
        assert array_to_string(None) == ""

    def test_normalize_boolean(self):
        """Normalizes boolean values."""
        assert normalize_boolean(True) is True
        assert normalize_boolean(False) is False
        assert normalize_boolean("true") is True
        assert normalize_boolean("yes") is True
        assert normalize_boolean("1") is True
        assert normalize_boolean("false") is False
        assert normalize_boolean("no") is False
        assert normalize_boolean(1) is True
        assert normalize_boolean(0) is False

    def test_create_rename_transform(self):
        """create_rename_transform creates rename FieldTransform."""
        transform = create_rename_transform("old", "new")
        result = transform.apply({"old": "value"})
        assert result["new"] == "value"
        assert "old" not in result

    def test_create_default_transform(self):
        """create_default_transform creates default FieldTransform."""
        transform = create_default_transform("field", "default")
        result = transform.apply({})
        assert result["field"] == "default"

    def test_create_removal_transform(self):
        """create_removal_transform creates removal FieldTransform."""
        transform = create_removal_transform("field")
        result = transform.apply({"field": "value", "other": "keep"})
        assert "field" not in result
        assert result["other"] == "keep"

    def test_create_type_transform(self):
        """create_type_transform creates type-changing FieldTransform."""
        transform = create_type_transform("tags", string_to_array)
        result = transform.apply({"tags": "single"})
        assert result["tags"] == ["single"]


class TestMigrationResult:
    """Test MigrationResult class."""

    def test_to_dict(self):
        """to_dict returns migration statistics."""
        result = MigrationResult(
            total_records=10,
            migrated_count=7,
            skipped_count=2,
            error_count=1,
            errors=[{"index": 5, "error": "test error"}],
        )
        d = result.to_dict()
        assert d["total_records"] == 10
        assert d["migrated_count"] == 7
        assert d["skipped_count"] == 2
        assert d["error_count"] == 1
        assert len(d["errors"]) == 1

    def test_to_dict_limits_errors(self):
        """to_dict limits errors in output."""
        errors = [{"index": i, "error": f"error {i}"} for i in range(20)]
        result = MigrationResult(
            total_records=20,
            error_count=20,
            errors=errors,
        )
        d = result.to_dict()
        assert len(d["errors"]) == 10  # Limited to 10
