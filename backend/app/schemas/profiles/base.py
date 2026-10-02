"""
Base Profile classes and types.

Profiles are schema contracts that define what properties a canonical record
must/should have for a specific use case (e.g., Collections app).
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Optional


class PropertyType(str, Enum):
    """Supported property types for validation."""
    STRING = "string"
    INTEGER = "integer"
    FLOAT = "float"
    BOOLEAN = "boolean"
    DATE = "date"           # Flexible date string (various formats accepted)
    DATETIME = "datetime"   # ISO datetime
    URL = "url"
    EMAIL = "email"
    ARRAY = "array"         # List of values
    OBJECT = "object"       # Nested dict


class ValidationSeverity(str, Enum):
    """Severity level for validation issues."""
    ERROR = "error"         # Must be fixed, blocks storage
    WARNING = "warning"     # Should be fixed, allows storage
    INFO = "info"           # Informational only


@dataclass
class PropertySchema:
    """
    Schema definition for a single property.

    Attributes:
        type: The expected data type
        description: Human-readable description of the property
        min_length: Minimum string length (for STRING type)
        max_length: Maximum string length (for STRING type)
        pattern: Regex pattern for validation (for STRING type)
        min_value: Minimum value (for INTEGER/FLOAT types)
        max_value: Maximum value (for INTEGER/FLOAT types)
        allowed_values: List of allowed values (enum-like constraint)
        array_item_type: Type of items if this is an ARRAY
        example: Example value for documentation
        ui_label: Display label for UI
        ui_hint: Hint text for UI forms
    """
    type: PropertyType = PropertyType.STRING
    description: str = ""
    min_length: Optional[int] = None
    max_length: Optional[int] = None
    pattern: Optional[str] = None
    min_value: Optional[float] = None
    max_value: Optional[float] = None
    allowed_values: Optional[list[str]] = None
    array_item_type: Optional[PropertyType] = None
    example: Optional[Any] = None
    ui_label: Optional[str] = None
    ui_hint: Optional[str] = None


@dataclass
class RelationshipSchema:
    """
    Schema for relationships to other profile records.

    Attributes:
        relationship_type: The relationship type string (e.g., "creator", "depicts")
        target_profile: The profile name of the target record (e.g., "agent", "media")
        description: Human-readable description
        required: Whether at least one such relationship is required
        max_count: Maximum number of such relationships (None = unlimited)
        inverse_type: The inverse relationship type on the target (for bidirectional)
    """
    relationship_type: str
    target_profile: str
    description: str = ""
    required: bool = False
    max_count: Optional[int] = None
    inverse_type: Optional[str] = None


@dataclass
class ValidationRule:
    """
    Custom validation rule for a profile.

    Attributes:
        name: Rule identifier
        description: Human-readable description
        check: Function that takes a record and returns (is_valid, message)
        severity: Error severity if rule fails
    """
    name: str
    description: str
    check: Callable[[dict], tuple[bool, str]]
    severity: ValidationSeverity = ValidationSeverity.ERROR


@dataclass
class ValidationIssue:
    """A single validation issue found in a record."""
    field: str
    message: str
    severity: ValidationSeverity
    rule: Optional[str] = None
    value: Optional[Any] = None


@dataclass
class ValidationResult:
    """Result of validating a record against a profile."""
    is_valid: bool
    profile_name: str
    profile_version: str
    issues: list[ValidationIssue] = field(default_factory=list)

    @property
    def errors(self) -> list[ValidationIssue]:
        """Get only ERROR severity issues."""
        return [i for i in self.issues if i.severity == ValidationSeverity.ERROR]

    @property
    def warnings(self) -> list[ValidationIssue]:
        """Get only WARNING severity issues."""
        return [i for i in self.issues if i.severity == ValidationSeverity.WARNING]

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization."""
        return {
            "is_valid": self.is_valid,
            "profile_name": self.profile_name,
            "profile_version": self.profile_version,
            "error_count": len(self.errors),
            "warning_count": len(self.warnings),
            "issues": [
                {
                    "field": i.field,
                    "message": i.message,
                    "severity": i.severity.value,
                    "rule": i.rule,
                }
                for i in self.issues
            ]
        }


class ProfileValidationError(Exception):
    """Raised when a record fails profile validation in strict mode."""

    def __init__(self, result: ValidationResult):
        self.result = result
        super().__init__(
            f"Record failed {result.profile_name} profile validation: "
            f"{len(result.errors)} error(s), {len(result.warnings)} warning(s)"
        )


@dataclass
class Profile:
    """
    A Profile defines a schema contract for canonical records.

    Profiles specify what properties must/should exist and their types,
    enabling downstream applications to rely on predictable data structure.

    Attributes:
        name: Unique profile identifier (e.g., "collections", "media")
        version: Semantic version string (e.g., "1.0.0")
        description: Human-readable description of the profile's purpose
        extends: Optional parent profile name to inherit from

        required_properties: Properties that MUST exist (validation fails without)
        recommended_properties: Properties that SHOULD exist (warning if missing)
        optional_properties: Properties that MAY exist (documented but not validated)

        property_schemas: Schema definitions for each property
        relationships: Expected relationships to other profile records
        validation_rules: Custom validation rules

        canonical_type: If set, only records of this type can use this profile
    """
    name: str
    version: str
    description: str
    extends: Optional[str] = None

    required_properties: list[str] = field(default_factory=list)
    recommended_properties: list[str] = field(default_factory=list)
    optional_properties: list[str] = field(default_factory=list)

    property_schemas: dict[str, PropertySchema] = field(default_factory=dict)
    relationships: list[RelationshipSchema] = field(default_factory=list)
    validation_rules: list[ValidationRule] = field(default_factory=list)

    canonical_type: Optional[str] = None  # e.g., "OBJECT", "AGENT"

    def get_all_properties(self) -> list[str]:
        """Get all property names (required + recommended + optional)."""
        return (
            self.required_properties +
            self.recommended_properties +
            self.optional_properties
        )

    def get_property_schema(self, prop_name: str) -> Optional[PropertySchema]:
        """Get the schema for a specific property."""
        return self.property_schemas.get(prop_name)

    def get_relationships_to(self, target_profile: str) -> list[RelationshipSchema]:
        """Get all relationship schemas targeting a specific profile."""
        return [r for r in self.relationships if r.target_profile == target_profile]

    def to_dict(self) -> dict:
        """Convert profile to dictionary for JSON serialization."""
        return {
            "name": self.name,
            "version": self.version,
            "description": self.description,
            "extends": self.extends,
            "canonical_type": self.canonical_type,
            "required_properties": self.required_properties,
            "recommended_properties": self.recommended_properties,
            "optional_properties": self.optional_properties,
            "property_schemas": {
                k: {
                    "type": v.type.value,
                    "description": v.description,
                    "ui_label": v.ui_label,
                    "example": v.example,
                }
                for k, v in self.property_schemas.items()
            },
            "relationships": [
                {
                    "type": r.relationship_type,
                    "target_profile": r.target_profile,
                    "description": r.description,
                    "required": r.required,
                }
                for r in self.relationships
            ],
        }
