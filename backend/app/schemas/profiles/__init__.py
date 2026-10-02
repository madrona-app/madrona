"""
Canonical Schema Profiles

Profiles define schema contracts for specific use cases (e.g., Collections, Archives).
They specify:
- Required properties a canonical record must have
- Recommended properties that should exist
- Property schemas (types, formats, constraints)
- Validation rules
- Relationships to other profiles

Usage:
    from app.schemas.profiles import get_profile, validate_against_profile, PROFILE_REGISTRY

    # Get a profile
    profile = get_profile("collections")

    # Validate a record against a profile
    errors = validate_against_profile(record, "collections")

    # Version comparison
    from app.schemas.profiles import compare_versions, is_compatible
    compare_versions("1.2.0", "1.1.0")  # Returns 1

    # Migrate records between versions
    from app.schemas.profiles import migrate_record, register_migration
"""

from .base import (
    Profile,
    PropertySchema,
    RelationshipSchema,
    ValidationResult,
    ProfileValidationError,
)
from .registry import (
    PROFILE_REGISTRY,
    get_profile,
    register_profile,
    list_profiles,
)
from .validation import (
    validate_against_profile,
    validate_property,
    check_required_properties,
    check_relationships,
)
from .versioning import (
    Version,
    parse_version,
    compare_versions,
    is_compatible,
    needs_migration,
    increment_version,
    VersionRange,
    parse_version_range,
)
from .migration import (
    Migration,
    FieldTransform,
    MigrationRegistry,
    MigrationResult,
    MIGRATION_REGISTRY,
    register_migration,
    get_migrations_for_profile,
    migrate_record,
    migrate_record_to_latest,
    migrate_records_batch,
)

# Import all GLAM profiles to register them
from . import glam

__all__ = [
    # Base classes
    "Profile",
    "PropertySchema",
    "RelationshipSchema",
    "ValidationResult",
    "ProfileValidationError",
    # Registry
    "PROFILE_REGISTRY",
    "get_profile",
    "register_profile",
    "list_profiles",
    # Validation
    "validate_against_profile",
    "validate_property",
    "check_required_properties",
    "check_relationships",
    # Versioning
    "Version",
    "parse_version",
    "compare_versions",
    "is_compatible",
    "needs_migration",
    "increment_version",
    "VersionRange",
    "parse_version_range",
    # Migration
    "Migration",
    "FieldTransform",
    "MigrationRegistry",
    "MigrationResult",
    "MIGRATION_REGISTRY",
    "register_migration",
    "get_migrations_for_profile",
    "migrate_record",
    "migrate_record_to_latest",
    "migrate_records_batch",
]
