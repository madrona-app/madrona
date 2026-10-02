"""
Profile Migration Support

Utilities for migrating records between profile versions. Supports:
- Field renaming
- Field transformation
- Field deprecation and removal
- Default value injection
- Custom migration logic

USAGE:
    from app.schemas.profiles.migration import (
        Migration,
        MigrationRegistry,
        migrate_record,
        get_migrations_for_profile,
    )

    # Define a migration
    migration = Migration(
        profile="collections",
        from_version="1.0.0",
        to_version="1.1.0",
        description="Add creator_display field",
        field_renames={"artist": "creator"},
        field_defaults={"creator_display": "Unknown"},
    )

    # Register and apply
    register_migration(migration)
    migrated_record = migrate_record(record, "collections", "1.0.0", "1.1.0")
"""

import logging
from copy import deepcopy
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

from .versioning import compare_versions, parse_version, Version

logger = logging.getLogger(__name__)


@dataclass
class FieldTransform:
    """
    Transform specification for a field during migration.

    Attributes:
        source_field: Original field name (or None if creating new field)
        target_field: New field name (or None if removing field)
        transform: Function to transform the value (receives old value, returns new)
        default: Default value if source is missing
    """
    source_field: Optional[str] = None
    target_field: Optional[str] = None
    transform: Optional[Callable[[Any], Any]] = None
    default: Optional[Any] = None

    def apply(self, properties: dict[str, Any]) -> dict[str, Any]:
        """Apply this transform to properties dict."""
        result = dict(properties)

        if self.source_field and self.target_field:
            # Rename/transform
            if self.source_field in result:
                value = result.pop(self.source_field)
                if self.transform:
                    value = self.transform(value)
                result[self.target_field] = value
            elif self.default is not None:
                result[self.target_field] = self.default

        elif self.source_field and not self.target_field:
            # Remove field
            result.pop(self.source_field, None)

        elif not self.source_field and self.target_field:
            # Add new field with default
            if self.target_field not in result and self.default is not None:
                result[self.target_field] = self.default

        return result


@dataclass
class Migration:
    """
    Migration definition for upgrading records between profile versions.

    Attributes:
        profile: Profile name this migration applies to
        from_version: Source version (or None for any version before to_version)
        to_version: Target version
        description: Human-readable description of the migration
        field_renames: Simple field name renames {old_name: new_name}
        field_defaults: Default values for new fields {field: default}
        field_removals: Fields to remove (list of field names)
        field_transforms: Complex field transformations
        custom_migrate: Custom migration function (receives record, returns record)
        reversible: Whether this migration can be reversed
    """
    profile: str
    from_version: Optional[str]
    to_version: str
    description: str = ""

    field_renames: dict[str, str] = field(default_factory=dict)
    field_defaults: dict[str, Any] = field(default_factory=dict)
    field_removals: list[str] = field(default_factory=list)
    field_transforms: list[FieldTransform] = field(default_factory=list)

    custom_migrate: Optional[Callable[[dict], dict]] = None
    reversible: bool = True

    def apply(self, record: dict[str, Any]) -> dict[str, Any]:
        """
        Apply this migration to a record.

        Args:
            record: Record to migrate

        Returns:
            Migrated record (copy, original not modified)
        """
        result = deepcopy(record)
        properties = result.get("properties", {})

        # Apply field renames
        for old_name, new_name in self.field_renames.items():
            if old_name in properties:
                properties[new_name] = properties.pop(old_name)

        # Apply field removals
        for field_name in self.field_removals:
            properties.pop(field_name, None)

        # Apply field defaults
        for field_name, default in self.field_defaults.items():
            if field_name not in properties:
                properties[field_name] = default

        # Apply field transforms
        for transform in self.field_transforms:
            properties = transform.apply(properties)

        result["properties"] = properties

        # Apply custom migration
        if self.custom_migrate:
            result = self.custom_migrate(result)

        # Update version in meta
        if "meta" not in result:
            result["meta"] = {}
        result["meta"]["profile_version"] = self.to_version

        return result

    def validate(self) -> list[str]:
        """Validate migration definition."""
        errors = []

        if not self.profile:
            errors.append("Migration must specify a profile")

        if not self.to_version:
            errors.append("Migration must specify to_version")

        try:
            parse_version(self.to_version)
        except ValueError:
            errors.append(f"Invalid to_version: {self.to_version}")

        if self.from_version:
            try:
                from_v = parse_version(self.from_version)
                to_v = parse_version(self.to_version)
                if from_v >= to_v:
                    errors.append("from_version must be less than to_version")
            except ValueError:
                errors.append(f"Invalid from_version: {self.from_version}")

        return errors


# =============================================================================
# Migration Registry
# =============================================================================

class MigrationRegistry:
    """
    Registry for profile migrations.

    Maintains a directed graph of migrations for each profile, allowing
    automatic migration path discovery.
    """

    def __init__(self):
        # {profile_name: [Migration, ...]}
        self._migrations: dict[str, list[Migration]] = {}

    def register(self, migration: Migration) -> None:
        """
        Register a migration.

        Args:
            migration: Migration to register

        Raises:
            ValueError: If migration is invalid
        """
        errors = migration.validate()
        if errors:
            raise ValueError(f"Invalid migration: {', '.join(errors)}")

        if migration.profile not in self._migrations:
            self._migrations[migration.profile] = []

        self._migrations[migration.profile].append(migration)

        # Sort by to_version for predictable ordering
        self._migrations[migration.profile].sort(
            key=lambda m: parse_version(m.to_version)
        )

    def get_migrations(self, profile: str) -> list[Migration]:
        """Get all migrations for a profile."""
        return self._migrations.get(profile, [])

    def find_migration_path(
        self,
        profile: str,
        from_version: str,
        to_version: str,
    ) -> list[Migration]:
        """
        Find the sequence of migrations to get from one version to another.

        Args:
            profile: Profile name
            from_version: Starting version
            to_version: Target version

        Returns:
            List of Migration objects to apply in order

        Raises:
            ValueError: If no migration path exists
        """
        if compare_versions(from_version, to_version) >= 0:
            return []  # No migration needed

        migrations = self.get_migrations(profile)
        if not migrations:
            raise ValueError(f"No migrations registered for profile '{profile}'")

        from_v = parse_version(from_version)
        to_v = parse_version(to_version)

        path = []
        current_version = from_v

        for migration in migrations:
            mig_to_v = parse_version(migration.to_version)

            # Skip migrations before our current version
            if mig_to_v <= current_version:
                continue

            # Stop if we've passed the target
            if mig_to_v > to_v:
                break

            # Check if this migration applies
            if migration.from_version:
                mig_from_v = parse_version(migration.from_version)
                if current_version < mig_from_v:
                    raise ValueError(
                        f"Migration gap: no migration from {current_version} to "
                        f"{mig_from_v} for profile '{profile}'"
                    )

            path.append(migration)
            current_version = mig_to_v

        if current_version < to_v:
            raise ValueError(
                f"Incomplete migration path: can only migrate to {current_version}, "
                f"not {to_version} for profile '{profile}'"
            )

        return path

    def can_migrate(
        self,
        profile: str,
        from_version: str,
        to_version: str,
    ) -> bool:
        """Check if a migration path exists."""
        try:
            self.find_migration_path(profile, from_version, to_version)
            return True
        except ValueError:
            return False

    def get_latest_version(self, profile: str) -> Optional[str]:
        """Get the latest version with migrations for a profile."""
        migrations = self.get_migrations(profile)
        if not migrations:
            return None
        return migrations[-1].to_version


# Global registry instance
MIGRATION_REGISTRY = MigrationRegistry()


def register_migration(migration: Migration) -> None:
    """Register a migration in the global registry."""
    MIGRATION_REGISTRY.register(migration)


def get_migrations_for_profile(profile: str) -> list[Migration]:
    """Get all migrations for a profile from the global registry."""
    return MIGRATION_REGISTRY.get_migrations(profile)


# =============================================================================
# Migration Functions
# =============================================================================

def migrate_record(
    record: dict[str, Any],
    profile: str,
    from_version: str,
    to_version: str,
    registry: Optional[MigrationRegistry] = None,
) -> dict[str, Any]:
    """
    Migrate a record from one profile version to another.

    Args:
        record: Record to migrate
        profile: Profile name
        from_version: Starting version
        to_version: Target version
        registry: Migration registry (uses global if not provided)

    Returns:
        Migrated record

    Raises:
        ValueError: If no migration path exists
    """
    if registry is None:
        registry = MIGRATION_REGISTRY

    path = registry.find_migration_path(profile, from_version, to_version)

    if not path:
        # No migrations needed, just update version
        result = deepcopy(record)
        if "meta" not in result:
            result["meta"] = {}
        result["meta"]["profile_version"] = to_version
        return result

    result = record
    for migration in path:
        logger.info(
            f"Applying migration for {profile}: "
            f"{migration.from_version or '*'} -> {migration.to_version}"
        )
        result = migration.apply(result)

    return result


def migrate_record_to_latest(
    record: dict[str, Any],
    profile: str,
    from_version: str,
    registry: Optional[MigrationRegistry] = None,
) -> tuple[dict[str, Any], str]:
    """
    Migrate a record to the latest profile version.

    Args:
        record: Record to migrate
        profile: Profile name
        from_version: Starting version
        registry: Migration registry (uses global if not provided)

    Returns:
        Tuple of (migrated_record, latest_version)

    Raises:
        ValueError: If no migration path exists
    """
    if registry is None:
        registry = MIGRATION_REGISTRY

    latest = registry.get_latest_version(profile)
    if not latest:
        # No migrations registered, return as-is
        return record, from_version

    migrated = migrate_record(record, profile, from_version, latest, registry)
    return migrated, latest


@dataclass
class MigrationResult:
    """Result of a batch migration operation."""
    total_records: int = 0
    migrated_count: int = 0
    skipped_count: int = 0
    error_count: int = 0
    errors: list[dict[str, Any]] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "total_records": self.total_records,
            "migrated_count": self.migrated_count,
            "skipped_count": self.skipped_count,
            "error_count": self.error_count,
            "errors": self.errors[:10],  # Limit errors in output
        }


def migrate_records_batch(
    records: list[dict[str, Any]],
    profile: str,
    to_version: str,
    registry: Optional[MigrationRegistry] = None,
) -> tuple[list[dict[str, Any]], MigrationResult]:
    """
    Migrate a batch of records to a target version.

    Args:
        records: List of records to migrate
        profile: Profile name
        to_version: Target version
        registry: Migration registry (uses global if not provided)

    Returns:
        Tuple of (migrated_records, result)
    """
    if registry is None:
        registry = MIGRATION_REGISTRY

    result = MigrationResult(total_records=len(records))
    migrated = []

    for i, record in enumerate(records):
        try:
            # Get current version from record meta
            meta = record.get("meta", {})
            from_version = meta.get("profile_version", "1.0.0")

            if compare_versions(from_version, to_version) >= 0:
                # Already at or above target version
                migrated.append(record)
                result.skipped_count += 1
                continue

            record_migrated = migrate_record(
                record, profile, from_version, to_version, registry
            )
            migrated.append(record_migrated)
            result.migrated_count += 1

        except Exception as e:
            logger.error(f"Migration error for record {i}: {e}")
            result.error_count += 1
            result.errors.append({
                "index": i,
                "record_id": record.get("id"),
                "error": str(e),
            })
            # Include original record in output
            migrated.append(record)

    return migrated, result


# =============================================================================
# Common Transformations
# =============================================================================

def string_to_array(value: Any) -> list:
    """Transform a string to a single-item array."""
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def array_to_string(value: Any, separator: str = ", ") -> str:
    """Transform an array to a joined string."""
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return separator.join(str(v) for v in value)


def normalize_boolean(value: Any) -> bool:
    """Normalize various boolean representations."""
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.lower() in ("true", "yes", "1", "y")
    if isinstance(value, (int, float)):
        return bool(value)
    return False


def create_rename_transform(old_name: str, new_name: str) -> FieldTransform:
    """Create a simple field rename transform."""
    return FieldTransform(source_field=old_name, target_field=new_name)


def create_default_transform(field_name: str, default_value: Any) -> FieldTransform:
    """Create a transform that adds a default value for a new field."""
    return FieldTransform(target_field=field_name, default=default_value)


def create_removal_transform(field_name: str) -> FieldTransform:
    """Create a transform that removes a field."""
    return FieldTransform(source_field=field_name)


def create_type_transform(
    field_name: str,
    transform_fn: Callable[[Any], Any],
) -> FieldTransform:
    """Create a transform that changes a field's type/format."""
    return FieldTransform(
        source_field=field_name,
        target_field=field_name,
        transform=transform_fn,
    )
