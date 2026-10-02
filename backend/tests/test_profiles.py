"""
Unit tests for Canonical Schema Profiles.

Tests the Profile classes, registry, validation, and GLAM profiles.
"""

import pytest

from app.schemas.profiles.base import (
    Profile,
    PropertySchema,
    PropertyType,
    RelationshipSchema,
    ValidationRule,
    ValidationIssue,
    ValidationResult,
    ValidationSeverity,
    ProfileValidationError,
)
from app.schemas.profiles.registry import (
    PROFILE_REGISTRY,
    register_profile,
    get_profile,
    get_profile_or_raise,
    list_profiles,
    get_all_profiles,
    resolve_profile_with_inheritance,
)
from app.schemas.profiles.validation import (
    validate_against_profile,
    check_required_properties,
    check_recommended_properties,
    validate_property,
    validate_property_type,
    validate_url,
    validate_email,
    check_relationships,
)


class TestPropertyType:
    """Test PropertyType enum."""

    def test_all_types_present(self):
        """All expected property types should exist."""
        expected = [
            "string", "integer", "float", "boolean",
            "date", "datetime", "url", "email", "array", "object"
        ]
        actual = [t.value for t in PropertyType]
        assert set(expected) == set(actual)


class TestValidationSeverity:
    """Test ValidationSeverity enum."""

    def test_severity_levels(self):
        """All severity levels should exist."""
        assert ValidationSeverity.ERROR == "error"
        assert ValidationSeverity.WARNING == "warning"
        assert ValidationSeverity.INFO == "info"


class TestPropertySchema:
    """Test PropertySchema dataclass."""

    def test_default_values(self):
        """PropertySchema should have sensible defaults."""
        schema = PropertySchema()
        assert schema.type == PropertyType.STRING
        assert schema.description == ""
        assert schema.min_length is None
        assert schema.max_length is None
        assert schema.pattern is None
        assert schema.min_value is None
        assert schema.max_value is None
        assert schema.allowed_values is None

    def test_string_schema(self):
        """String schema with constraints."""
        schema = PropertySchema(
            type=PropertyType.STRING,
            description="A title field",
            min_length=1,
            max_length=500,
            ui_label="Title",
        )
        assert schema.type == PropertyType.STRING
        assert schema.min_length == 1
        assert schema.max_length == 500

    def test_integer_schema(self):
        """Integer schema with constraints."""
        schema = PropertySchema(
            type=PropertyType.INTEGER,
            min_value=0,
            max_value=100,
        )
        assert schema.type == PropertyType.INTEGER
        assert schema.min_value == 0
        assert schema.max_value == 100

    def test_enum_schema(self):
        """Schema with allowed values (enum)."""
        schema = PropertySchema(
            type=PropertyType.STRING,
            allowed_values=["red", "green", "blue"],
        )
        assert schema.allowed_values == ["red", "green", "blue"]


class TestRelationshipSchema:
    """Test RelationshipSchema dataclass."""

    def test_basic_relationship(self):
        """Basic relationship schema."""
        rel = RelationshipSchema(
            relationship_type="creator",
            target_profile="agent",
            description="The creator of this item",
        )
        assert rel.relationship_type == "creator"
        assert rel.target_profile == "agent"
        assert rel.required is False
        assert rel.max_count is None

    def test_required_relationship(self):
        """Required relationship with max_count."""
        rel = RelationshipSchema(
            relationship_type="primary_image",
            target_profile="media",
            required=True,
            max_count=1,
        )
        assert rel.required is True
        assert rel.max_count == 1


class TestValidationIssue:
    """Test ValidationIssue dataclass."""

    def test_issue_creation(self):
        """Create a validation issue."""
        issue = ValidationIssue(
            field="properties.title",
            message="Title is required",
            severity=ValidationSeverity.ERROR,
            rule="required_property",
        )
        assert issue.field == "properties.title"
        assert issue.severity == ValidationSeverity.ERROR
        assert issue.rule == "required_property"


class TestValidationResult:
    """Test ValidationResult dataclass."""

    def test_valid_result(self):
        """Result with no issues is valid."""
        result = ValidationResult(
            is_valid=True,
            profile_name="test",
            profile_version="1.0.0",
            issues=[],
        )
        assert result.is_valid is True
        assert result.errors == []
        assert result.warnings == []

    def test_result_with_errors(self):
        """Result with errors."""
        issues = [
            ValidationIssue(
                field="title",
                message="Required",
                severity=ValidationSeverity.ERROR,
                rule="required",
            ),
            ValidationIssue(
                field="description",
                message="Recommended",
                severity=ValidationSeverity.WARNING,
                rule="recommended",
            ),
        ]
        result = ValidationResult(
            is_valid=False,
            profile_name="test",
            profile_version="1.0.0",
            issues=issues,
        )
        assert result.is_valid is False
        assert len(result.errors) == 1
        assert len(result.warnings) == 1

    def test_to_dict(self):
        """Result converts to dict."""
        result = ValidationResult(
            is_valid=True,
            profile_name="test",
            profile_version="1.0.0",
            issues=[],
        )
        d = result.to_dict()
        assert d["is_valid"] is True
        assert d["profile_name"] == "test"
        assert d["error_count"] == 0
        assert d["warning_count"] == 0


class TestProfile:
    """Test Profile dataclass."""

    def test_basic_profile(self):
        """Create a basic profile."""
        profile = Profile(
            name="test_profile",
            version="1.0.0",
            description="A test profile",
            required_properties=["title"],
            recommended_properties=["description"],
            optional_properties=["notes"],
        )
        assert profile.name == "test_profile"
        assert profile.version == "1.0.0"
        assert "title" in profile.required_properties
        assert "description" in profile.recommended_properties

    def test_get_all_properties(self):
        """Get all properties from a profile."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            required_properties=["a", "b"],
            recommended_properties=["c"],
            optional_properties=["d", "e"],
        )
        all_props = profile.get_all_properties()
        assert all_props == ["a", "b", "c", "d", "e"]

    def test_get_property_schema(self):
        """Get schema for a specific property."""
        schema = PropertySchema(type=PropertyType.STRING)
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            property_schemas={"title": schema},
        )
        assert profile.get_property_schema("title") == schema
        assert profile.get_property_schema("unknown") is None

    def test_to_dict(self):
        """Profile converts to dict."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test profile",
            required_properties=["title"],
        )
        d = profile.to_dict()
        assert d["name"] == "test"
        assert d["version"] == "1.0.0"
        assert "title" in d["required_properties"]


class TestProfileRegistry:
    """Test profile registry functions."""

    def test_glam_profiles_registered(self):
        """All GLAM profiles should be registered."""
        profiles = list_profiles()
        expected = ["agent", "place", "media", "event", "work", "collections"]
        for name in expected:
            assert name in profiles, f"Profile '{name}' not registered"

    def test_get_profile(self):
        """Get a profile by name."""
        profile = get_profile("collections")
        assert profile is not None
        assert profile.name == "collections"

    def test_get_profile_not_found(self):
        """Get returns None for unknown profile."""
        profile = get_profile("nonexistent_profile")
        assert profile is None

    def test_get_profile_or_raise(self):
        """Get or raise returns profile."""
        profile = get_profile_or_raise("collections")
        assert profile.name == "collections"

    def test_get_profile_or_raise_not_found(self):
        """Get or raise raises for unknown profile."""
        with pytest.raises(KeyError, match="not found"):
            get_profile_or_raise("nonexistent_profile")

    def test_get_all_profiles(self):
        """Get all profiles returns dict."""
        all_profiles = get_all_profiles()
        assert isinstance(all_profiles, dict)
        assert "collections" in all_profiles


class TestPropertyValidation:
    """Test property type validation."""

    def test_validate_string_type(self):
        """Validate string type."""
        assert validate_property_type("test", "hello", PropertyType.STRING) is None
        issue = validate_property_type("test", 123, PropertyType.STRING)
        assert issue is not None
        assert issue.severity == ValidationSeverity.ERROR

    def test_validate_integer_type(self):
        """Validate integer type."""
        assert validate_property_type("test", 42, PropertyType.INTEGER) is None
        issue = validate_property_type("test", "42", PropertyType.INTEGER)
        assert issue is not None
        # Boolean is not integer
        issue = validate_property_type("test", True, PropertyType.INTEGER)
        assert issue is not None

    def test_validate_float_type(self):
        """Validate float type (accepts int and float)."""
        assert validate_property_type("test", 3.14, PropertyType.FLOAT) is None
        assert validate_property_type("test", 42, PropertyType.FLOAT) is None
        issue = validate_property_type("test", "3.14", PropertyType.FLOAT)
        assert issue is not None

    def test_validate_boolean_type(self):
        """Validate boolean type."""
        assert validate_property_type("test", True, PropertyType.BOOLEAN) is None
        assert validate_property_type("test", False, PropertyType.BOOLEAN) is None
        issue = validate_property_type("test", 1, PropertyType.BOOLEAN)
        assert issue is not None

    def test_validate_array_type(self):
        """Validate array type."""
        assert validate_property_type("test", [], PropertyType.ARRAY) is None
        assert validate_property_type("test", [1, 2, 3], PropertyType.ARRAY) is None
        issue = validate_property_type("test", "array", PropertyType.ARRAY)
        assert issue is not None

    def test_validate_object_type(self):
        """Validate object type."""
        assert validate_property_type("test", {}, PropertyType.OBJECT) is None
        assert validate_property_type("test", {"key": "value"}, PropertyType.OBJECT) is None
        issue = validate_property_type("test", [], PropertyType.OBJECT)
        assert issue is not None


class TestPropertySchemaValidation:
    """Test full property validation against schema."""

    def test_string_min_length(self):
        """Validate string minimum length."""
        schema = PropertySchema(type=PropertyType.STRING, min_length=5)
        issues = validate_property("name", "hi", schema)
        assert len(issues) == 1
        assert "less than minimum" in issues[0].message

        issues = validate_property("name", "hello", schema)
        assert len(issues) == 0

    def test_string_max_length(self):
        """Validate string maximum length."""
        schema = PropertySchema(type=PropertyType.STRING, max_length=5)
        issues = validate_property("name", "hello world", schema)
        assert len(issues) == 1
        assert "exceeds maximum" in issues[0].message

    def test_string_pattern(self):
        """Validate string pattern."""
        schema = PropertySchema(type=PropertyType.STRING, pattern=r"^\d{4}-\d{2}-\d{2}$")
        issues = validate_property("date", "2024-01-15", schema)
        assert len(issues) == 0

        issues = validate_property("date", "invalid", schema)
        assert len(issues) == 1
        assert "pattern" in issues[0].message

    def test_number_min_value(self):
        """Validate number minimum value."""
        schema = PropertySchema(type=PropertyType.INTEGER, min_value=0)
        issues = validate_property("count", -1, schema)
        assert len(issues) == 1
        assert "less than minimum" in issues[0].message

    def test_number_max_value(self):
        """Validate number maximum value."""
        schema = PropertySchema(type=PropertyType.INTEGER, max_value=100)
        issues = validate_property("count", 101, schema)
        assert len(issues) == 1
        assert "exceeds maximum" in issues[0].message

    def test_allowed_values(self):
        """Validate allowed values (enum)."""
        schema = PropertySchema(
            type=PropertyType.STRING,
            allowed_values=["red", "green", "blue"],
        )
        issues = validate_property("color", "red", schema)
        assert len(issues) == 0

        issues = validate_property("color", "purple", schema)
        assert len(issues) == 1
        assert "not in allowed values" in issues[0].message

    def test_null_value_skipped(self):
        """Null values are skipped (handled by required checks)."""
        schema = PropertySchema(type=PropertyType.STRING, min_length=5)
        issues = validate_property("name", None, schema)
        assert len(issues) == 0


class TestUrlValidation:
    """Test URL validation."""

    def test_valid_urls(self):
        """Valid URLs should pass."""
        assert validate_url("website", "https://example.com") is None
        assert validate_url("website", "http://localhost:8080/path") is None
        assert validate_url("website", "https://sub.domain.com/path?q=1") is None

    def test_invalid_urls(self):
        """Invalid URLs should fail."""
        issue = validate_url("website", "not-a-url")
        assert issue is not None
        assert issue.severity == ValidationSeverity.WARNING

        issue = validate_url("website", "://missing-scheme.com")
        assert issue is not None


class TestEmailValidation:
    """Test email validation."""

    def test_valid_emails(self):
        """Valid emails should pass."""
        assert validate_email("email", "user@example.com") is None
        assert validate_email("email", "user.name@example.co.uk") is None

    def test_invalid_emails(self):
        """Invalid emails should fail."""
        issue = validate_email("email", "not-an-email")
        assert issue is not None
        assert issue.severity == ValidationSeverity.WARNING

        issue = validate_email("email", "@missing-local.com")
        assert issue is not None


class TestRequiredPropertiesCheck:
    """Test required properties validation."""

    def test_all_required_present(self):
        """No issues when all required properties present."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            required_properties=["title", "creator"],
        )
        properties = {"title": "Test Item", "creator": "John Doe"}
        issues = check_required_properties(properties, profile)
        assert len(issues) == 0

    def test_missing_required(self):
        """Issue for missing required property."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            required_properties=["title", "creator"],
        )
        properties = {"title": "Test Item"}
        issues = check_required_properties(properties, profile)
        assert len(issues) == 1
        assert "creator" in issues[0].field
        assert issues[0].severity == ValidationSeverity.ERROR

    def test_null_required(self):
        """Issue for null required property."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            required_properties=["title"],
        )
        properties = {"title": None}
        issues = check_required_properties(properties, profile)
        assert len(issues) == 1
        assert "null" in issues[0].message

    def test_empty_string_required(self):
        """Issue for empty string required property."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            required_properties=["title"],
        )
        properties = {"title": "   "}
        issues = check_required_properties(properties, profile)
        assert len(issues) == 1
        assert "empty" in issues[0].message


class TestRecommendedPropertiesCheck:
    """Test recommended properties validation."""

    def test_all_recommended_present(self):
        """No issues when all recommended properties present."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            recommended_properties=["description"],
        )
        properties = {"description": "A description"}
        issues = check_recommended_properties(properties, profile)
        assert len(issues) == 0

    def test_missing_recommended(self):
        """Warning for missing recommended property."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            recommended_properties=["description"],
        )
        properties = {}
        issues = check_recommended_properties(properties, profile)
        assert len(issues) == 1
        assert issues[0].severity == ValidationSeverity.WARNING


class TestRelationshipCheck:
    """Test relationship validation."""

    def test_required_relationship_present(self):
        """No issue when required relationship exists."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            relationships=[
                RelationshipSchema(
                    relationship_type="creator",
                    target_profile="agent",
                    required=True,
                ),
            ],
        )
        relationships = [{"type": "creator", "target_id": "agent-123"}]
        issues = check_relationships(relationships, profile)
        assert len(issues) == 0

    def test_required_relationship_missing(self):
        """Error when required relationship missing."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            relationships=[
                RelationshipSchema(
                    relationship_type="creator",
                    target_profile="agent",
                    required=True,
                ),
            ],
        )
        relationships = []
        issues = check_relationships(relationships, profile)
        assert len(issues) == 1
        assert issues[0].severity == ValidationSeverity.ERROR

    def test_max_count_exceeded(self):
        """Error when max_count exceeded."""
        profile = Profile(
            name="test",
            version="1.0.0",
            description="Test",
            relationships=[
                RelationshipSchema(
                    relationship_type="primary_image",
                    target_profile="media",
                    max_count=1,
                ),
            ],
        )
        relationships = [
            {"type": "primary_image", "target_id": "media-1"},
            {"type": "primary_image", "target_id": "media-2"},
        ]
        issues = check_relationships(relationships, profile)
        assert len(issues) == 1
        assert "maximum" in issues[0].message


class TestValidateAgainstProfile:
    """Test full record validation against profile."""

    def test_valid_record(self):
        """Valid record passes validation."""
        result = validate_against_profile(
            record={
                "type": "OBJECT",
                "properties": {
                    "title": "The Starry Night",
                    "accession_number": "1941.4.1",
                },
            },
            profile_name="collections",
        )
        assert result.is_valid is True

    def test_missing_required(self):
        """Record missing required property fails."""
        result = validate_against_profile(
            record={
                "type": "OBJECT",
                "properties": {},
            },
            profile_name="collections",
        )
        assert result.is_valid is False
        assert any("title" in i.field for i in result.errors)

    def test_type_mismatch(self):
        """Record with wrong canonical type fails."""
        result = validate_against_profile(
            record={
                "type": "AGENT",  # Wrong type for collections
                "properties": {"title": "Test"},
            },
            profile_name="collections",
        )
        assert result.is_valid is False
        assert any("type" in i.field for i in result.errors)

    def test_strict_mode(self):
        """Strict mode raises exception on failure."""
        with pytest.raises(ProfileValidationError) as exc_info:
            validate_against_profile(
                record={
                    "type": "OBJECT",
                    "properties": {},
                },
                profile_name="collections",
                strict=True,
            )
        assert exc_info.value.result.is_valid is False


class TestGLAMProfiles:
    """Test GLAM-specific profiles."""

    def test_collections_profile(self):
        """Collections profile has expected structure."""
        profile = get_profile_or_raise("collections")
        assert profile.canonical_type == "OBJECT"
        assert "title" in profile.required_properties
        assert "accession_number" in profile.recommended_properties
        assert any(r.target_profile == "agent" for r in profile.relationships)
        assert any(r.target_profile == "media" for r in profile.relationships)

    def test_media_profile(self):
        """Media profile has expected structure."""
        profile = get_profile_or_raise("media")
        assert profile.canonical_type == "MEDIA"
        assert "title" in profile.required_properties
        assert "media_type" in profile.required_properties
        assert "url" in profile.recommended_properties

    def test_agent_profile(self):
        """Agent profile has expected structure."""
        profile = get_profile_or_raise("agent")
        assert profile.canonical_type == "AGENT"
        assert "name" in profile.required_properties
        assert "agent_type" in profile.recommended_properties

    def test_place_profile(self):
        """Place profile has expected structure."""
        profile = get_profile_or_raise("place")
        assert profile.canonical_type == "PLACE"
        assert "name" in profile.required_properties
        assert "coordinates" in profile.recommended_properties

    def test_event_profile(self):
        """Event profile has expected structure."""
        profile = get_profile_or_raise("event")
        assert profile.canonical_type == "EVENT"
        assert "title" in profile.required_properties
        assert "start_date" in profile.recommended_properties

    def test_work_profile(self):
        """Work profile has expected structure."""
        profile = get_profile_or_raise("work")
        assert profile.canonical_type == "WORK"
        assert "title" in profile.required_properties
        assert "work_type" in profile.recommended_properties


class TestCustomValidationRules:
    """Test custom validation rules in profiles."""

    def test_collections_identifier_warning(self):
        """Collections profile warns if no identifier."""
        result = validate_against_profile(
            record={
                "type": "OBJECT",
                "properties": {"title": "Test Item"},
            },
            profile_name="collections",
        )
        # Should have a warning about missing identifier
        assert any(
            i.rule == "has_identifier" and i.severity == ValidationSeverity.WARNING
            for i in result.issues
        )

    def test_collections_with_identifier(self):
        """Collections profile passes with identifier."""
        result = validate_against_profile(
            record={
                "type": "OBJECT",
                "properties": {
                    "title": "Test Item",
                    "accession_number": "2024.1.1",
                },
            },
            profile_name="collections",
        )
        # Should not have identifier warning
        assert not any(i.rule == "has_identifier" for i in result.issues)

    def test_media_dimensions_validation(self):
        """Media profile validates dimensions."""
        result = validate_against_profile(
            record={
                "type": "MEDIA",
                "properties": {
                    "title": "Test Image",
                    "media_type": "image",
                    "width": -100,  # Invalid
                },
            },
            profile_name="media",
        )
        assert any(
            "positive" in i.message.lower() or "width" in i.message.lower()
            for i in result.issues
        )

    def test_event_date_range_validation(self):
        """Event profile validates date range."""
        result = validate_against_profile(
            record={
                "type": "EVENT",
                "properties": {
                    "title": "Test Exhibition",
                    "start_date": "2024-06-01",
                    "end_date": "2024-01-01",  # Before start
                },
            },
            profile_name="event",
        )
        assert any("date" in i.message.lower() for i in result.issues)


class TestProfileRelationships:
    """Test profile relationship definitions."""

    def test_collections_agent_relationships(self):
        """Collections has proper agent relationships."""
        profile = get_profile_or_raise("collections")
        agent_rels = [r for r in profile.relationships if r.target_profile == "agent"]

        rel_types = [r.relationship_type for r in agent_rels]
        assert "creator" in rel_types
        assert "donor" in rel_types

    def test_collections_media_relationships(self):
        """Collections has proper media relationships."""
        profile = get_profile_or_raise("collections")
        media_rels = [r for r in profile.relationships if r.target_profile == "media"]

        rel_types = [r.relationship_type for r in media_rels]
        assert "primary_image" in rel_types
        assert "image" in rel_types

        # Primary image should have max_count=1
        primary = next(r for r in media_rels if r.relationship_type == "primary_image")
        assert primary.max_count == 1

    def test_collections_place_relationships(self):
        """Collections has proper place relationships."""
        profile = get_profile_or_raise("collections")
        place_rels = [r for r in profile.relationships if r.target_profile == "place"]

        rel_types = [r.relationship_type for r in place_rels]
        assert "created_at" in rel_types
        assert "current_location" in rel_types

    def test_media_collections_relationships(self):
        """Media can relate to collections."""
        profile = get_profile_or_raise("media")
        coll_rels = [r for r in profile.relationships if r.target_profile == "collections"]

        rel_types = [r.relationship_type for r in coll_rels]
        assert "depicts" in rel_types or "documents" in rel_types

    def test_agent_place_relationships(self):
        """Agent has place relationships."""
        profile = get_profile_or_raise("agent")
        place_rels = [r for r in profile.relationships if r.target_profile == "place"]

        rel_types = [r.relationship_type for r in place_rels]
        assert "born_at" in rel_types or "died_at" in rel_types


class TestProfileToDictSerialization:
    """Test profile serialization to dict."""

    def test_profile_serializes_completely(self):
        """Profile to_dict includes all important fields."""
        profile = get_profile_or_raise("collections")
        d = profile.to_dict()

        assert "name" in d
        assert "version" in d
        assert "description" in d
        assert "required_properties" in d
        assert "recommended_properties" in d
        assert "property_schemas" in d
        assert "relationships" in d

    def test_property_schema_serialization(self):
        """Property schemas serialize correctly."""
        profile = get_profile_or_raise("collections")
        d = profile.to_dict()

        title_schema = d["property_schemas"].get("title")
        assert title_schema is not None
        assert title_schema["type"] == "string"

    def test_relationship_serialization(self):
        """Relationships serialize correctly."""
        profile = get_profile_or_raise("collections")
        d = profile.to_dict()

        assert len(d["relationships"]) > 0
        rel = d["relationships"][0]
        assert "type" in rel
        assert "target_profile" in rel
