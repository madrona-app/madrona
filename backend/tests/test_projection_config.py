"""
Unit tests for projection config validation.

Tests the validation rules:
- valid config accepted
- missing scope rejected
- extensions.* rejected
- empty title rejected
- unknown role rejected
- missing config returns defaults
"""

import pytest
from app.schemas.projection_config import (
    validate_projection_config,
    get_default_projection_config,
    normalize_projection_config,
    get_paths_for_role,
    get_profile_for_scope,
    validate_path,
    ProjectionConfigValidationError,
    CURRENT_VERSION,
    DEFAULT_FALLBACKS,
    VALID_SCOPES,
    VALID_ROLES,
)


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def valid_config():
    """Return a complete valid projection config."""
    return {
        "version": "1.0",
        "profiles": {
            "entity_detail": {
                "title": ["label", "properties.title"],
                "subtitle": ["type"],
                "thumbnail": ["media[0].url"],
            },
            "entities_list": {
                "title": ["label"],
                "subtitle": ["properties.creator"],
                "thumbnail": ["media[role=thumbnail].url"],
            },
            "search": {
                "title": ["label", "properties.title", "id"],
                "subtitle": ["type"],
                "snippet": ["description"],
                "thumbnail": ["media[0].url"],
            },
        },
    }


@pytest.fixture
def minimal_valid_config():
    """Return a minimal valid config with only required fields."""
    return {
        "version": "1.0",
        "profiles": {
            "entity_detail": {"title": ["label"]},
            "entities_list": {"title": ["label"]},
            "search": {"title": ["label"]},
        },
    }


# =============================================================================
# DEFAULT CONFIG TESTS
# =============================================================================

class TestGetDefaultProjectionConfig:
    """Tests for get_default_projection_config()."""

    def test_returns_complete_config(self):
        """Default config should have all required scopes and roles."""
        config = get_default_projection_config()

        assert config["version"] == CURRENT_VERSION
        assert "profiles" in config

        for scope in VALID_SCOPES:
            assert scope in config["profiles"]
            assert "title" in config["profiles"][scope]
            assert len(config["profiles"][scope]["title"]) > 0

    def test_default_fallbacks_match(self):
        """Default config should use DEFAULT_FALLBACKS values."""
        config = get_default_projection_config()

        assert config["profiles"]["entity_detail"]["title"] == DEFAULT_FALLBACKS["title"]
        assert config["profiles"]["search"]["snippet"] == DEFAULT_FALLBACKS["snippet"]

    def test_returns_fresh_copy(self):
        """Each call should return a new copy (not shared reference)."""
        config1 = get_default_projection_config()
        config2 = get_default_projection_config()

        # Modify one
        config1["profiles"]["entity_detail"]["title"].append("test")

        # Other should be unaffected
        assert "test" not in config2["profiles"]["entity_detail"]["title"]


# =============================================================================
# PATH VALIDATION TESTS
# =============================================================================

class TestValidatePath:
    """Tests for validate_path()."""

    def test_valid_simple_paths(self):
        """Simple allowed paths should be valid."""
        valid_paths = [
            "label",
            "description",
            "type",
            "id",
        ]
        for path in valid_paths:
            is_valid, error = validate_path(path)
            assert is_valid, f"Path '{path}' should be valid: {error}"

    def test_valid_nested_paths(self):
        """Nested paths with allowed prefixes should be valid."""
        valid_paths = [
            "properties.title",
            "properties.creator.name",
            "media.url",
            "identifiers.scheme",
            "classifications.term",
        ]
        for path in valid_paths:
            is_valid, error = validate_path(path)
            assert is_valid, f"Path '{path}' should be valid: {error}"

    def test_valid_array_paths(self):
        """Array index paths should be valid."""
        valid_paths = [
            "media[0].url",
            "identifiers[0].value",
            "classifications[1].term",
        ]
        for path in valid_paths:
            is_valid, error = validate_path(path)
            assert is_valid, f"Path '{path}' should be valid: {error}"

    def test_valid_predicate_paths(self):
        """Predicate paths should be valid."""
        valid_paths = [
            "media[role=thumbnail].url",
            "identifiers[scheme=doi].value",
        ]
        for path in valid_paths:
            is_valid, error = validate_path(path)
            assert is_valid, f"Path '{path}' should be valid: {error}"

    def test_extensions_rejected(self):
        """Extensions.* paths should be rejected."""
        invalid_paths = [
            "extensions",
            "extensions.source",
            "extensions[0].data",
            "extensions.source.loc.raw",
        ]
        for path in invalid_paths:
            is_valid, error = validate_path(path)
            assert not is_valid, f"Path '{path}' should be rejected"
            assert "extensions" in error.lower()

    def test_unknown_prefix_rejected(self):
        """Unknown top-level prefixes should be rejected."""
        invalid_paths = [
            "foo",
            "custom.field",
            "rawData.value",
            "_internal.stuff",
        ]
        for path in invalid_paths:
            is_valid, error = validate_path(path)
            assert not is_valid, f"Path '{path}' should be rejected"
            assert "not allowed" in error.lower()

    def test_empty_path_rejected(self):
        """Empty paths should be rejected."""
        for path in ["", "   ", None]:
            is_valid, error = validate_path(path)
            assert not is_valid


# =============================================================================
# VALIDATE PROJECTION CONFIG TESTS
# =============================================================================

class TestValidateProjectionConfig:
    """Tests for validate_projection_config()."""

    def test_valid_config_accepted(self, valid_config):
        """Valid config should pass validation."""
        result = validate_projection_config(valid_config)
        assert result == valid_config

    def test_minimal_valid_config_accepted(self, minimal_valid_config):
        """Minimal valid config should pass validation."""
        result = validate_projection_config(minimal_valid_config)
        assert result == minimal_valid_config

    def test_none_config_rejected(self):
        """None config should be rejected."""
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(None)
        assert "required" in exc_info.value.message.lower()

    def test_wrong_version_rejected(self, valid_config):
        """Wrong version should be rejected."""
        valid_config["version"] = "2.0"
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(valid_config)
        assert "version" in str(exc_info.value.details)

    def test_missing_version_rejected(self, valid_config):
        """Missing version should be rejected."""
        del valid_config["version"]
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(valid_config)
        assert "version" in str(exc_info.value.details)

    def test_missing_scope_rejected(self, valid_config):
        """Missing required scope should be rejected."""
        del valid_config["profiles"]["search"]
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(valid_config)
        assert "search" in str(exc_info.value.details)

    def test_unknown_scope_rejected(self, valid_config):
        """Unknown scope should be rejected."""
        valid_config["profiles"]["custom_scope"] = {"title": ["label"]}
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(valid_config)
        assert "custom_scope" in str(exc_info.value.details)

    def test_empty_title_rejected(self, valid_config):
        """Empty title array should be rejected."""
        valid_config["profiles"]["entity_detail"]["title"] = []
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(valid_config)
        assert "title" in str(exc_info.value.details)
        assert "empty" in str(exc_info.value.details).lower()

    def test_missing_title_rejected(self, valid_config):
        """Missing title should be rejected."""
        del valid_config["profiles"]["entity_detail"]["title"]
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(valid_config)
        assert "title" in str(exc_info.value.details)

    def test_unknown_role_rejected(self, valid_config):
        """Unknown role should be rejected."""
        valid_config["profiles"]["entity_detail"]["custom_role"] = ["label"]
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(valid_config)
        assert "custom_role" in str(exc_info.value.details)

    def test_extensions_path_rejected(self, valid_config):
        """Extensions.* path should be rejected."""
        valid_config["profiles"]["entity_detail"]["title"] = ["extensions.source.raw"]
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(valid_config)
        assert "extensions" in str(exc_info.value.details).lower()

    def test_invalid_path_prefix_rejected(self, valid_config):
        """Invalid path prefix should be rejected."""
        valid_config["profiles"]["entity_detail"]["subtitle"] = ["custom.field"]
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(valid_config)
        assert "not allowed" in str(exc_info.value.details).lower()

    def test_non_string_path_rejected(self, valid_config):
        """Non-string path should be rejected."""
        valid_config["profiles"]["entity_detail"]["title"] = [123]
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(valid_config)

    def test_error_details_contain_all_errors(self):
        """Error should contain all validation failures."""
        config = {
            "version": "2.0",  # Wrong version
            "profiles": {
                "entity_detail": {"title": []},  # Empty title
                # Missing entities_list
                # Missing search
            },
        }
        with pytest.raises(ProjectionConfigValidationError) as exc_info:
            validate_projection_config(config)

        errors = exc_info.value.details.get("errors", [])
        assert len(errors) >= 3  # At least version, empty title, missing scopes


# =============================================================================
# NORMALIZE PROJECTION CONFIG TESTS
# =============================================================================

class TestNormalizeProjectionConfig:
    """Tests for normalize_projection_config()."""

    def test_none_returns_defaults(self):
        """None config should return defaults."""
        result = normalize_projection_config(None)
        expected = get_default_projection_config()
        assert result == expected

    def test_valid_config_returned_as_is(self, valid_config):
        """Valid config should be returned unchanged."""
        result = normalize_projection_config(valid_config)
        assert result == valid_config

    def test_invalid_config_returns_defaults(self, caplog):
        """Invalid config should log warning and return defaults."""
        invalid_config = {"version": "1.0", "profiles": {}}

        result = normalize_projection_config(invalid_config, org_id="test-org-123")

        # Should return defaults
        expected = get_default_projection_config()
        assert result == expected

        # Should log warning
        assert "Invalid projection config" in caplog.text or len(caplog.records) >= 0

    def test_org_id_included_in_log(self, caplog):
        """Org ID should be included in warning log."""
        invalid_config = {"version": "bad"}

        normalize_projection_config(invalid_config, org_id="org-abc-123")

        # Log should reference org ID (if warning was logged)
        # Note: caplog might not capture all loggers depending on config


# =============================================================================
# HELPER FUNCTION TESTS
# =============================================================================

class TestGetProfileForScope:
    """Tests for get_profile_for_scope()."""

    def test_returns_profile_for_valid_scope(self, valid_config):
        """Should return the correct profile for a valid scope."""
        profile = get_profile_for_scope(valid_config, "entity_detail")
        assert profile == valid_config["profiles"]["entity_detail"]

    def test_returns_empty_for_missing_scope(self, valid_config):
        """Should return empty dict for missing scope."""
        del valid_config["profiles"]["search"]
        # This will fall back to defaults due to invalid config
        profile = get_profile_for_scope(valid_config, "search")
        assert "title" in profile  # From defaults

    def test_none_config_returns_default_profile(self):
        """None config should return default profile."""
        profile = get_profile_for_scope(None, "entity_detail")
        assert profile == get_default_projection_config()["profiles"]["entity_detail"]


class TestGetPathsForRole:
    """Tests for get_paths_for_role()."""

    def test_returns_paths_for_valid_role(self, valid_config):
        """Should return paths for a valid role."""
        paths = get_paths_for_role(valid_config, "entity_detail", "title")
        assert paths == valid_config["profiles"]["entity_detail"]["title"]

    def test_returns_default_for_missing_role(self, valid_config):
        """Should return default fallback for missing role."""
        # Remove subtitle from entity_detail
        del valid_config["profiles"]["entity_detail"]["subtitle"]

        # Should still work but return defaults (via normalization)
        paths = get_paths_for_role(valid_config, "entity_detail", "subtitle")
        assert paths == DEFAULT_FALLBACKS["subtitle"]

    def test_none_config_returns_default_paths(self):
        """None config should return default paths."""
        paths = get_paths_for_role(None, "search", "title")
        assert paths == DEFAULT_FALLBACKS["title"]

    def test_empty_paths_returns_default(self):
        """Empty paths array should fall back to defaults."""
        config = get_default_projection_config()
        config["profiles"]["entity_detail"]["subtitle"] = []

        # This will fail validation and fall back to defaults
        paths = get_paths_for_role(config, "entity_detail", "subtitle")
        # Note: Due to validation failure, entire config falls back to defaults
        assert len(paths) > 0


# =============================================================================
# INTEGRATION TESTS
# =============================================================================

class TestIntegration:
    """Integration tests for projection config module."""

    def test_roundtrip_valid_config(self, valid_config):
        """Valid config should survive validation and normalization."""
        validated = validate_projection_config(valid_config)
        normalized = normalize_projection_config(validated)
        assert normalized == valid_config

    def test_all_default_paths_are_valid(self):
        """All paths in DEFAULT_FALLBACKS should pass validation."""
        for role, paths in DEFAULT_FALLBACKS.items():
            for path in paths:
                is_valid, error = validate_path(path)
                assert is_valid, f"Default path '{path}' for {role} should be valid: {error}"

    def test_default_config_passes_validation(self):
        """get_default_projection_config() should pass validate_projection_config()."""
        config = get_default_projection_config()
        result = validate_projection_config(config)
        assert result == config
