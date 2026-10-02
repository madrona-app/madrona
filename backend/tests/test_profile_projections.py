"""
Unit tests for profile-specific projection defaults.
"""

import pytest

from app.schemas.profile_projections import (
    get_profile_projection_defaults,
    get_profile_paths_for_role,
    list_supported_profiles,
    get_profile_display_roles,
    merge_profile_with_config,
    PROFILE_PROJECTIONS,
)
from app.schemas.projection_resolver import (
    resolve_display_fields,
    get_paths_for_role_with_precedence,
)


class TestProfileProjectionDefaults:
    """Test profile projection default retrieval."""

    def test_get_collections_defaults(self):
        """Collections profile has expected defaults."""
        defaults = get_profile_projection_defaults("collections")
        assert defaults is not None
        assert "title" in defaults
        assert "subtitle" in defaults
        assert "thumbnail" in defaults
        assert "snippet" in defaults
        # Collections-specific fields
        assert "accession" in defaults
        assert "creator" in defaults

    def test_get_media_defaults(self):
        """Media profile has expected defaults."""
        defaults = get_profile_projection_defaults("media")
        assert defaults is not None
        assert "properties.media_type" in defaults.get("subtitle", [])
        assert "properties.url" in defaults.get("url", [])

    def test_get_agent_defaults(self):
        """Agent profile has expected defaults."""
        defaults = get_profile_projection_defaults("agent")
        assert defaults is not None
        assert "properties.name" in defaults.get("title", [])
        assert "properties.biography" in defaults.get("snippet", [])

    def test_unknown_profile_returns_none(self):
        """Unknown profile returns None."""
        assert get_profile_projection_defaults("nonexistent") is None


class TestGetProfilePathsForRole:
    """Test path retrieval for specific roles."""

    def test_get_title_paths(self):
        """Gets title paths for collections profile."""
        paths = get_profile_paths_for_role("collections", "title")
        assert "properties.title" in paths
        assert "label" in paths

    def test_get_thumbnail_paths(self):
        """Gets thumbnail paths for collections profile."""
        paths = get_profile_paths_for_role("collections", "thumbnail")
        assert "properties.thumbnail_url" in paths
        assert "properties.primary_image_url" in paths

    def test_returns_fallback_for_unknown_profile(self):
        """Returns fallback for unknown profile."""
        paths = get_profile_paths_for_role("unknown", "title", ["fallback"])
        assert paths == ["fallback"]

    def test_returns_fallback_for_unknown_role(self):
        """Returns fallback for unknown role."""
        paths = get_profile_paths_for_role("collections", "unknown_role", ["default"])
        assert paths == ["default"]

    def test_returns_empty_list_without_fallback(self):
        """Returns empty list when no fallback provided."""
        paths = get_profile_paths_for_role("unknown", "title")
        assert paths == []


class TestListSupportedProfiles:
    """Test profile listing."""

    def test_lists_all_profiles(self):
        """Lists all supported profiles."""
        profiles = list_supported_profiles()
        assert "collections" in profiles
        assert "media" in profiles
        assert "agent" in profiles
        assert "place" in profiles
        assert "event" in profiles
        assert "work" in profiles

    def test_count_matches_registry(self):
        """Count matches PROFILE_PROJECTIONS registry."""
        profiles = list_supported_profiles()
        assert len(profiles) == len(PROFILE_PROJECTIONS)


class TestGetProfileDisplayRoles:
    """Test role listing for profiles."""

    def test_collections_roles(self):
        """Collections profile has standard and custom roles."""
        roles = get_profile_display_roles("collections")
        # Standard roles
        assert "title" in roles
        assert "subtitle" in roles
        # Collections-specific roles
        assert "accession" in roles
        assert "creator" in roles
        assert "medium" in roles

    def test_unknown_profile_returns_empty(self):
        """Unknown profile returns empty list."""
        roles = get_profile_display_roles("unknown")
        assert roles == []


class TestMergeProfileWithConfig:
    """Test profile and config merging."""

    def test_profile_paths_come_first(self):
        """Profile paths take precedence over config paths."""
        config_paths = {
            "title": ["config.title", "config.name"],
        }
        merged = merge_profile_with_config("collections", config_paths)

        # Profile paths should come first
        assert merged["title"][0] == "properties.title"
        # Config paths should be appended (if not duplicated)
        assert "config.title" in merged["title"]

    def test_deduplicates_paths(self):
        """Duplicate paths are removed."""
        config_paths = {
            "title": ["properties.title", "label"],  # Same as profile
        }
        merged = merge_profile_with_config("collections", config_paths)

        # Should not have duplicates
        unique_paths = list(dict.fromkeys(merged["title"]))
        assert merged["title"] == unique_paths

    def test_handles_no_profile(self):
        """Works with None profile."""
        config_paths = {
            "title": ["custom.title"],
        }
        merged = merge_profile_with_config(None, config_paths)
        assert merged["title"] == ["custom.title"]


class TestProfileAwareResolver:
    """Test projection resolver with profile support."""

    def test_resolves_with_profile_from_record(self):
        """Extracts profile from record meta and uses profile paths."""
        record = {
            "id": "test-123",
            "meta": {
                "profile": "collections",
            },
            "properties": {
                "title": "The Starry Night",
                "object_type": "painting",
                "thumbnail_url": "https://example.com/image.jpg",
            },
        }

        result = resolve_display_fields(record, "entity_detail")

        assert result["title"] == "The Starry Night"
        assert result["subtitle"] == "painting"
        assert result["thumbnailUrl"] == "https://example.com/image.jpg"

    def test_resolves_with_explicit_profile(self):
        """Uses explicitly provided profile."""
        record = {
            "id": "agent-123",
            "properties": {
                "name": "Vincent van Gogh",
                "agent_type": "person",
            },
        }

        result = resolve_display_fields(record, "entity_detail", profile_name="agent")

        assert result["title"] == "Vincent van Gogh"
        assert result["subtitle"] == "person"

    def test_explicit_profile_overrides_record_profile(self):
        """Explicit profile overrides record meta.profile."""
        record = {
            "id": "test-123",
            "meta": {
                "profile": "collections",
            },
            "properties": {
                "name": "Artist Name",  # Agent field
                "title": "Object Title",  # Collections field
            },
        }

        # Use agent profile explicitly
        result = resolve_display_fields(record, "entity_detail", profile_name="agent")

        # Should use agent paths (name takes precedence for title)
        assert result["title"] == "Artist Name"

    def test_falls_back_to_defaults_without_profile(self):
        """Falls back to system defaults when no profile."""
        record = {
            "id": "test-123",
            "label": "Test Label",
        }

        result = resolve_display_fields(record, "entity_detail")

        assert result["title"] == "Test Label"

    def test_get_paths_includes_profile(self):
        """get_paths_for_role_with_precedence uses profile paths."""
        paths = get_paths_for_role_with_precedence(
            "title", "entity_detail", profile_name="collections"
        )

        assert "properties.title" in paths

    def test_org_config_overrides_profile(self):
        """Org config takes precedence over profile defaults."""
        # Must provide complete valid config structure
        org_config = {
            "version": "1.0",
            "profiles": {
                "entity_detail": {
                    "title": ["properties.custom_title", "label"],
                    "subtitle": ["type"],
                    "thumbnail": ["media[role=thumbnail].url"],
                },
                "entities_list": {
                    "title": ["properties.custom_title", "label"],
                    "subtitle": ["type"],
                    "thumbnail": ["media[role=thumbnail].url"],
                },
                "search": {
                    "title": ["properties.custom_title", "label"],
                    "subtitle": ["type"],
                    "snippet": ["description"],
                    "thumbnail": ["media[role=thumbnail].url"],
                },
            },
        }

        paths = get_paths_for_role_with_precedence(
            "title", "entity_detail", org_config=org_config, profile_name="collections"
        )

        # Org config should take precedence
        assert paths == ["properties.custom_title", "label"]
