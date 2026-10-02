"""
Tests for Projection Resolver.

Tests using LOC-style fixture data:
- Resolves title from label
- Resolves thumbnail from media role
- Resolves subtitle from properties.creator (if present)
- Falls back to id if label missing
- Rejects/ignores invalid paths safely and falls back
"""

import pytest
from app.schemas.projection_resolver import (
    resolve_display_fields,
    resolve_display_fields_typed,
    resolve_path,
    resolve_path_segment,
    resolve_value,
    is_path_allowed,
    get_paths_for_role_with_precedence,
    DisplayFields,
)
from app.schemas.projection_config import CURRENT_VERSION


# =============================================================================
# LOC-STYLE FIXTURES
# =============================================================================

@pytest.fixture
def loc_record_complete():
    """Complete LOC-style canonical record with all fields."""
    return {
        "id": "mdrn:loc:2018645678",
        "type": "Work",
        "label": "Civil War Map of Virginia",
        "description": "A detailed topographical map showing Virginia during the Civil War period.",
        "identifiers": [
            {"scheme": "source", "value": "loc:2018645678"},
            {"scheme": "url", "value": "https://www.loc.gov/item/2018645678/"},
            {"scheme": "doi", "value": "10.1234/example"},
        ],
        "classifications": [
            {"scheme": "lcsh", "label": "Civil War"},
            {"scheme": "lcsh", "label": "Maps"},
            {"scheme": "aat", "id": "300015636", "label": "cartographic materials"},
        ],
        "properties": {
            "title": "Civil War Map of Virginia",
            "creator": "John Smith",
            "date": "1863",
            "medium": "Lithograph",
            "dimensions": "24 x 36 inches",
        },
        "media": [
            {
                "id": "mdrn:media:loc:2018645678:thumbnail",
                "type": "image",
                "url": "https://tile.loc.gov/image-services/iiif/2018645678/full/256,/0/default.jpg",
                "role": "thumbnail",
            },
            {
                "id": "mdrn:media:loc:2018645678:primary",
                "type": "image",
                "url": "https://tile.loc.gov/image-services/iiif/2018645678/full/1024,/0/default.jpg",
                "role": "primary",
            },
        ],
        "relationships": [
            {"type": "partOf", "target": "mdrn:collection:loc:civil-war", "label": "Civil War Maps Collection"},
        ],
        "rights": "Public Domain",
        "extensions": [
            {
                "namespace": "source.loc",
                "type": "LocRaw",
                "data": {"originalField": "value"},
            }
        ],
        "provenance": {
            "source": {
                "system": "loc",
                "dataset": "maps",
                "recordId": "2018645678",
            },
            "ingestedAt": "2024-01-15T10:30:00Z",
        },
        "meta": {
            "schemaVersion": "1.0.0",
            "createdAt": "2024-01-15T10:30:00Z",
            "updatedAt": "2024-01-15T10:30:00Z",
        },
    }


@pytest.fixture
def loc_record_minimal():
    """Minimal LOC-style record with only required fields."""
    return {
        "id": "mdrn:loc:minimal123",
        "type": "Object",
        "label": "Simple Item",
        "provenance": {
            "source": {
                "system": "loc",
                "recordId": "minimal123",
            },
            "ingestedAt": "2024-01-15T10:30:00Z",
        },
        "meta": {
            "schemaVersion": "1.0.0",
            "createdAt": "2024-01-15T10:30:00Z",
            "updatedAt": "2024-01-15T10:30:00Z",
        },
    }


@pytest.fixture
def loc_record_no_label():
    """Record with no label (should fall back to id)."""
    return {
        "id": "mdrn:loc:nolabel456",
        "type": "Work",
        "label": "",  # Empty label
        "properties": {
            "title": "",  # Also empty
        },
        "provenance": {
            "source": {
                "system": "loc",
                "recordId": "nolabel456",
            },
            "ingestedAt": "2024-01-15T10:30:00Z",
        },
        "meta": {
            "schemaVersion": "1.0.0",
            "createdAt": "2024-01-15T10:30:00Z",
            "updatedAt": "2024-01-15T10:30:00Z",
        },
    }


@pytest.fixture
def loc_record_multiple_media():
    """Record with multiple media items for predicate testing."""
    return {
        "id": "mdrn:loc:multimedia789",
        "type": "Work",
        "label": "Document with Multiple Images",
        "media": [
            {
                "id": "mdrn:media:loc:multimedia789:alt1",
                "type": "image",
                "url": "https://example.com/alt1.jpg",
                "role": "alternate",
            },
            {
                "id": "mdrn:media:loc:multimedia789:thumb",
                "type": "image",
                "url": "https://example.com/thumbnail.jpg",
                "role": "thumbnail",
            },
            {
                "id": "mdrn:media:loc:multimedia789:primary",
                "type": "image",
                "url": "https://example.com/primary.jpg",
                "role": "primary",
            },
        ],
        "provenance": {
            "source": {"system": "loc", "recordId": "multimedia789"},
            "ingestedAt": "2024-01-15T10:30:00Z",
        },
        "meta": {
            "schemaVersion": "1.0.0",
            "createdAt": "2024-01-15T10:30:00Z",
            "updatedAt": "2024-01-15T10:30:00Z",
        },
    }


@pytest.fixture
def valid_org_config():
    """Valid org-level projection config."""
    return {
        "version": "1.0",
        "profiles": {
            "entity_detail": {
                "title": ["label", "properties.title"],
                "subtitle": ["properties.creator"],
                "thumbnail": ["media[role=thumbnail].url"],
            },
            "entities_list": {
                "title": ["label"],
                "subtitle": ["type"],
                "thumbnail": ["media[0].url"],
            },
            "search": {
                "title": ["label", "properties.title", "id"],
                "subtitle": ["type"],
                "snippet": ["description"],
                "thumbnail": ["media[role=thumbnail].url"],
            },
        },
    }


# =============================================================================
# PATH RESOLUTION TESTS
# =============================================================================

class TestIsPathAllowed:
    """Tests for is_path_allowed()."""

    def test_allowed_simple_paths(self):
        """Simple allowed paths should return True."""
        allowed = ["label", "description", "type", "id"]
        for path in allowed:
            assert is_path_allowed(path), f"'{path}' should be allowed"

    def test_allowed_nested_paths(self):
        """Nested paths with allowed prefixes should return True."""
        allowed = [
            "properties.title",
            "properties.creator.name",
            "media.url",
            "identifiers.scheme",
        ]
        for path in allowed:
            assert is_path_allowed(path), f"'{path}' should be allowed"

    def test_disallowed_extensions_paths(self):
        """Extensions.* paths should return False."""
        disallowed = [
            "extensions",
            "extensions.source",
            "extensions.data.field",
        ]
        for path in disallowed:
            assert not is_path_allowed(path), f"'{path}' should be disallowed"

    def test_disallowed_unknown_paths(self):
        """Unknown prefixes should return False."""
        disallowed = ["foo", "custom.field", "rawData.value"]
        for path in disallowed:
            assert not is_path_allowed(path), f"'{path}' should be disallowed"

    def test_empty_paths(self):
        """Empty paths should return False."""
        assert not is_path_allowed("")
        assert not is_path_allowed("   ")
        assert not is_path_allowed(None)


class TestResolvePathSegment:
    """Tests for resolve_path_segment()."""

    def test_simple_property(self):
        """Simple property access."""
        obj = {"label": "Test", "type": "Work"}
        assert resolve_path_segment(obj, "label") == "Test"
        assert resolve_path_segment(obj, "type") == "Work"

    def test_array_index(self):
        """Array index access."""
        obj = {"media": [{"url": "a.jpg"}, {"url": "b.jpg"}]}
        assert resolve_path_segment(obj, "media[0]") == {"url": "a.jpg"}
        assert resolve_path_segment(obj, "media[1]") == {"url": "b.jpg"}

    def test_array_index_out_of_bounds(self):
        """Array index out of bounds returns None."""
        obj = {"media": [{"url": "a.jpg"}]}
        assert resolve_path_segment(obj, "media[5]") is None

    def test_predicate_match(self):
        """Predicate matching."""
        obj = {
            "media": [
                {"role": "alternate", "url": "alt.jpg"},
                {"role": "thumbnail", "url": "thumb.jpg"},
            ]
        }
        result = resolve_path_segment(obj, "media[role=thumbnail]")
        assert result == {"role": "thumbnail", "url": "thumb.jpg"}

    def test_predicate_no_match(self):
        """Predicate with no match returns None."""
        obj = {"media": [{"role": "primary", "url": "p.jpg"}]}
        assert resolve_path_segment(obj, "media[role=thumbnail]") is None

    def test_none_object(self):
        """None object returns None."""
        assert resolve_path_segment(None, "label") is None


class TestResolvePath:
    """Tests for resolve_path()."""

    def test_simple_path(self, loc_record_complete):
        """Resolve simple path."""
        assert resolve_path(loc_record_complete, "label") == "Civil War Map of Virginia"
        assert resolve_path(loc_record_complete, "type") == "Work"
        assert resolve_path(loc_record_complete, "id") == "mdrn:loc:2018645678"

    def test_nested_path(self, loc_record_complete):
        """Resolve nested path."""
        assert resolve_path(loc_record_complete, "properties.title") == "Civil War Map of Virginia"
        assert resolve_path(loc_record_complete, "properties.creator") == "John Smith"
        assert resolve_path(loc_record_complete, "properties.date") == "1863"

    def test_array_index_path(self, loc_record_complete):
        """Resolve array index path."""
        media_0 = resolve_path(loc_record_complete, "media[0]")
        assert media_0["role"] == "thumbnail"

        # Continue to nested property
        url = resolve_path(loc_record_complete, "media[0].url")
        assert url.startswith("https://tile.loc.gov/")

    def test_predicate_path(self, loc_record_multiple_media):
        """Resolve predicate path."""
        # Find thumbnail
        url = resolve_path(loc_record_multiple_media, "media[role=thumbnail].url")
        assert url == "https://example.com/thumbnail.jpg"

        # Find primary
        url = resolve_path(loc_record_multiple_media, "media[role=primary].url")
        assert url == "https://example.com/primary.jpg"

    def test_missing_path(self, loc_record_minimal):
        """Missing path returns None."""
        assert resolve_path(loc_record_minimal, "properties.title") is None
        assert resolve_path(loc_record_minimal, "media[0].url") is None

    def test_disallowed_path(self, loc_record_complete):
        """Disallowed paths return None."""
        assert resolve_path(loc_record_complete, "extensions.source.loc") is None
        assert resolve_path(loc_record_complete, "customField") is None


class TestResolveValue:
    """Tests for resolve_value() with fallback paths."""

    def test_first_path_succeeds(self, loc_record_complete):
        """First path resolves successfully."""
        paths = ["label", "properties.title", "id"]
        assert resolve_value(loc_record_complete, paths) == "Civil War Map of Virginia"

    def test_fallback_to_second_path(self, loc_record_minimal):
        """Falls back when first path fails."""
        paths = ["properties.title", "label", "id"]
        assert resolve_value(loc_record_minimal, paths) == "Simple Item"

    def test_fallback_to_id(self, loc_record_no_label):
        """Falls back to id when label is empty."""
        paths = ["label", "properties.title", "id"]
        # label is empty string, properties.title is empty, should get id
        assert resolve_value(loc_record_no_label, paths) == "mdrn:loc:nolabel456"

    def test_array_values_joined(self):
        """Array values are joined with comma."""
        record = {"identifiers": ["one", "two", "three"]}
        result = resolve_value(record, ["identifiers"])
        assert result == "one, two, three"

    def test_array_of_dicts_extracts_labels(self):
        """Array of dicts extracts labels."""
        record = {
            "classifications": [
                {"label": "Civil War"},
                {"label": "Maps"},
                {"label": "Historical"},
            ]
        }
        result = resolve_value(record, ["classifications"])
        assert result == "Civil War, Maps, Historical"

    def test_returns_none_for_all_invalid_paths(self):
        """Returns None when all paths invalid."""
        record = {"id": "test"}
        result = resolve_value(record, ["missing", "also_missing"])
        assert result is None


# =============================================================================
# DISPLAY FIELDS RESOLUTION TESTS
# =============================================================================

class TestResolveDisplayFields:
    """Tests for resolve_display_fields() main function."""

    def test_resolves_title_from_label(self, loc_record_complete):
        """Resolves title from label field."""
        result = resolve_display_fields(loc_record_complete, "entity_detail")
        assert result["title"] == "Civil War Map of Virginia"

    def test_resolves_thumbnail_from_media_role(self, loc_record_complete, valid_org_config):
        """Resolves thumbnail from media[role=thumbnail].url."""
        result = resolve_display_fields(
            loc_record_complete,
            "entity_detail",
            org_config=valid_org_config
        )
        assert "thumbnailUrl" in result
        assert result["thumbnailUrl"].startswith("https://tile.loc.gov/")

    def test_resolves_subtitle_from_properties_creator(self, loc_record_complete, valid_org_config):
        """Resolves subtitle from properties.creator."""
        result = resolve_display_fields(
            loc_record_complete,
            "entity_detail",
            org_config=valid_org_config
        )
        assert result.get("subtitle") == "John Smith"

    def test_falls_back_to_id_if_label_missing(self, loc_record_no_label):
        """Falls back to id when label is empty."""
        result = resolve_display_fields(loc_record_no_label, "entity_detail")
        assert result["title"] == "mdrn:loc:nolabel456"

    def test_ignores_invalid_paths_safely(self, loc_record_complete):
        """Invalid paths in config are ignored, falls back to defaults."""
        invalid_config = {
            "version": "1.0",
            "profiles": {
                "entity_detail": {
                    "title": ["extensions.source.raw"],  # Invalid - disallowed
                    "subtitle": ["customField"],  # Invalid - unknown prefix
                },
                "entities_list": {"title": ["label"]},
                "search": {"title": ["label"]},
            },
        }

        # Should fall back to system defaults when invalid paths don't resolve
        result = resolve_display_fields(
            loc_record_complete,
            "entity_detail",
            org_config=invalid_config
        )

        # Title should still be resolved (from default paths)
        assert result["title"] == "Civil War Map of Virginia"

    def test_title_never_blank(self):
        """Title is never blank - ultimate fallback to 'Untitled'."""
        record = {"id": None, "label": None}
        result = resolve_display_fields(record, "entity_detail")
        assert result["title"] == "Untitled"

    def test_snippet_resolved_for_search_scope(self, loc_record_complete):
        """Snippet is resolved for search scope."""
        result = resolve_display_fields(loc_record_complete, "search")
        assert "snippet" in result
        assert "topographical map" in result["snippet"]

    def test_returns_dict(self, loc_record_complete):
        """Returns dict with camelCase keys."""
        result = resolve_display_fields(loc_record_complete, "entity_detail")
        assert isinstance(result, dict)
        assert "title" in result
        # Check camelCase for thumbnail
        if result.get("thumbnailUrl"):
            assert "thumbnailUrl" in result

    def test_optional_fields_omitted_when_not_resolved(self, loc_record_minimal):
        """Optional fields are omitted (not None) when they don't resolve."""
        result = resolve_display_fields(loc_record_minimal, "entity_detail")
        # Only title should be present since minimal record has no media/properties
        assert "title" in result
        assert "subtitle" not in result or result.get("subtitle") == "Object"  # type fallback
        assert "thumbnailUrl" not in result


class TestPrecedence:
    """Tests for precedence: org → defaults."""

    def test_org_takes_precedence_over_defaults(self, loc_record_complete, valid_org_config):
        """Org config takes precedence over system defaults."""
        # Org config specifies properties.creator for subtitle
        result = resolve_display_fields(
            loc_record_complete,
            "entity_detail",
            org_config=valid_org_config,
        )
        assert result.get("subtitle") == "John Smith"

    def test_defaults_used_when_no_config(self, loc_record_complete):
        """System defaults used when no config provided."""
        result = resolve_display_fields(loc_record_complete, "entity_detail")
        # Default subtitle path is ["type"]
        assert result.get("subtitle") == "Work"


class TestGetPathsForRoleWithPrecedence:
    """Tests for get_paths_for_role_with_precedence()."""

    def test_returns_org_paths(self, valid_org_config):
        """Returns org paths when config provided."""
        paths = get_paths_for_role_with_precedence(
            "subtitle",
            "entity_detail",
            org_config=valid_org_config,
        )
        assert paths == ["properties.creator"]

    def test_returns_defaults_when_no_config(self):
        """Returns defaults when no config."""
        paths = get_paths_for_role_with_precedence(
            "title",
            "entity_detail",
        )
        assert "label" in paths
        assert "id" in paths


class TestResolveDisplayFieldsTyped:
    """Tests for resolve_display_fields_typed() returning DisplayFields."""

    def test_returns_display_fields_object(self, loc_record_complete):
        """Returns DisplayFields object."""
        result = resolve_display_fields_typed(loc_record_complete, "entity_detail")
        assert isinstance(result, DisplayFields)
        assert result.title == "Civil War Map of Virginia"

    def test_to_dict_matches_resolve_display_fields(self, loc_record_complete):
        """to_dict() produces same result as resolve_display_fields()."""
        typed_result = resolve_display_fields_typed(loc_record_complete, "entity_detail")
        dict_result = resolve_display_fields(loc_record_complete, "entity_detail")
        assert typed_result.to_dict() == dict_result


# =============================================================================
# EDGE CASES
# =============================================================================

class TestEdgeCases:
    """Edge case tests."""

    def test_handles_none_record(self):
        """Handles None record gracefully."""
        result = resolve_display_fields(None, "entity_detail")
        assert result["title"] == "Unknown"

    def test_handles_non_dict_record(self):
        """Handles non-dict record gracefully."""
        result = resolve_display_fields("not a dict", "entity_detail")
        assert result["title"] == "not a dict"

    def test_handles_invalid_scope(self, loc_record_complete):
        """Handles invalid scope by defaulting to entity_detail."""
        result = resolve_display_fields(loc_record_complete, "invalid_scope")
        assert result["title"] == "Civil War Map of Virginia"

    def test_handles_empty_media_array(self):
        """Handles empty media array."""
        record = {"id": "test", "label": "Test", "media": []}
        result = resolve_display_fields(record, "entity_detail")
        assert "thumbnailUrl" not in result

    def test_handles_deeply_nested_properties(self):
        """Handles deeply nested properties."""
        record = {
            "id": "test",
            "label": "Test",
            "properties": {
                "creator": {
                    "name": "Nested Creator Name"
                }
            }
        }
        url = resolve_path(record, "properties.creator.name")
        assert url == "Nested Creator Name"

    def test_numeric_values_converted_to_string(self):
        """Numeric values are converted to string."""
        record = {"id": "test", "label": "Test", "properties": {"year": 1863}}
        result = resolve_value(record, ["properties.year"])
        assert result == "1863"
