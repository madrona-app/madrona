"""
Madrona Data Schemas.

This package contains schema definitions for:
- Canonical entity format (the unified data model)
- Database source configuration
- Validation utilities for schema enforcement
"""

from app.schemas.canonical import (
    # Enums
    CanonicalRecordType,
    MediaType,
    # Nested models
    Identifier,
    Classification,
    Relationship,
    MediaReference,
    Extension,
    ProvenanceSource,
    Provenance,
    Meta,
    # Main models
    CanonicalDraft,
    CanonicalRecord,
    # Validation
    ValidationResult,
    validate_canonical_record,
    validate_canonical_draft,
    check_unknown_top_level_keys,
    # Finalization and hashing
    finalize_draft,
    compute_canonical_hash,
    canonical_hash_material,
    stable_json_dumps,
    HASH_INCLUDE_EXTENSION_DATA,
    # Legacy detection and policy
    is_canonical_payload,
    is_legacy_payload,
    get_payload_status,
    PayloadStatus,
    LegacyPayloadInfo,
    CANONICAL_REQUIRED_FIELDS,
    CANONICAL_ALLOWED_FIELDS,
    # Helpers
    create_source_extension,
    create_media_reference,
)

from app.schemas.database_source import (
    # Enums
    DatabaseType,
    AuthMode,
    TlsMode,
    NetworkMode,
    # Schemas and validation
    DATABASE_CONFIG_SCHEMAS,
    validate_database_config,
    get_database_capabilities,
    DEFAULT_PORTS,
    DATABASE_DISPLAY_NAMES,
)

from app.schemas.authority_backed import (
    # Enums
    AuthoritySource,
    # Core schemas
    AuthorityLink,
    AuthorityBackedValue,
    # CDWA-aligned field schemas
    CreatorValue,
    MaterialValue,
    TechniqueValue,
    PlaceValue,
    ClassificationValue,
    SubjectValue,
    # Utilities
    build_authority_uri,
    parse_authority_uri,
    normalize_authority_value,
    AUTHORITY_URI_TEMPLATES,
)

from app.schemas.semantic_roles import (
    # Enums
    SemanticRole,
    # Core schemas
    RoleTaggedValue,
    FieldRoleConfig,
    # Configuration
    DEFAULT_FIELD_CONFIGS,
    ROLE_QUALIFIERS,
    # Utilities
    get_field_config,
    get_default_role,
    normalize_value_with_role,
    extract_values_by_role,
    group_values_by_role,
)

from app.schemas.semantic_role_validation import (
    ValidationWarning,
    RoleValidationResult,
    validate_role,
    validate_qualifier,
    validate_value_roles,
    validate_field_values,
    validate_object_roles,
    normalize_object_roles,
    strip_roles,
)

from app.schemas.semantic_role_exports import (
    # IIIF exports
    to_iiif_metadata,
    to_iiif_metadata_grouped,
    role_to_iiif_label,
    # JSON-LD / schema.org exports
    to_schema_org_property,
    role_to_schema_property,
    to_jsonld_object,
    # Dublin Core exports
    to_dublin_core,
    role_to_dc_element,
)

__all__ = [
    # Enums
    "CanonicalRecordType",
    "MediaType",
    # Nested models
    "Identifier",
    "Classification",
    "Relationship",
    "MediaReference",
    "Extension",
    "ProvenanceSource",
    "Provenance",
    "Meta",
    # Main models
    "CanonicalDraft",
    "CanonicalRecord",
    # Validation
    "ValidationResult",
    "validate_canonical_record",
    "validate_canonical_draft",
    "check_unknown_top_level_keys",
    # Finalization and hashing
    "finalize_draft",
    "compute_canonical_hash",
    "canonical_hash_material",
    "stable_json_dumps",
    "HASH_INCLUDE_EXTENSION_DATA",
    # Legacy detection and policy
    "is_canonical_payload",
    "is_legacy_payload",
    "get_payload_status",
    "PayloadStatus",
    "LegacyPayloadInfo",
    "CANONICAL_REQUIRED_FIELDS",
    "CANONICAL_ALLOWED_FIELDS",
    # Helpers
    "create_source_extension",
    "create_media_reference",
    # Database source configuration
    "DatabaseType",
    "AuthMode",
    "TlsMode",
    "NetworkMode",
    "DATABASE_CONFIG_SCHEMAS",
    "validate_database_config",
    "get_database_capabilities",
    "DEFAULT_PORTS",
    "DATABASE_DISPLAY_NAMES",
    # Authority-backed value schemas
    "AuthoritySource",
    "AuthorityLink",
    "AuthorityBackedValue",
    "CreatorValue",
    "MaterialValue",
    "TechniqueValue",
    "PlaceValue",
    "ClassificationValue",
    "SubjectValue",
    "build_authority_uri",
    "parse_authority_uri",
    "normalize_authority_value",
    "AUTHORITY_URI_TEMPLATES",
    # Semantic role tagging
    "SemanticRole",
    "RoleTaggedValue",
    "FieldRoleConfig",
    "DEFAULT_FIELD_CONFIGS",
    "ROLE_QUALIFIERS",
    "get_field_config",
    "get_default_role",
    "normalize_value_with_role",
    "extract_values_by_role",
    "group_values_by_role",
    # Semantic role validation
    "ValidationWarning",
    "RoleValidationResult",
    "validate_role",
    "validate_qualifier",
    "validate_value_roles",
    "validate_field_values",
    "validate_object_roles",
    "normalize_object_roles",
    "strip_roles",
    # Semantic role exports
    "to_iiif_metadata",
    "to_iiif_metadata_grouped",
    "role_to_iiif_label",
    "to_schema_org_property",
    "role_to_schema_property",
    "to_jsonld_object",
    "to_dublin_core",
    "role_to_dc_element",
]
