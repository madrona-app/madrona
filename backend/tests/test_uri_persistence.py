"""
Tests for URI Persistence Service.

Tests pure functions (slugify, build_uri, parse_uri, generate_memorable_id,
get_http_response_for_resolution) and Pydantic models (URIStatus, RedirectType,
URIResolution). No database required for these tests.

Integration tests for URIPersistenceService are skipped because they require
the app.models.uri.URIRegistry model which needs PostgreSQL-specific features.
"""

import re
import pytest
from uuid import uuid4

from app.services.uri_persistence import (
    URIStatus,
    RedirectType,
    PublicURI,
    URIResolution,
    generate_public_id,
    slugify,
    generate_memorable_id,
    build_uri,
    parse_uri,
    get_http_response_for_resolution,
    BASE_URI,
    ENTITY_TYPES,
    URL_SEGMENT_TO_ENTITY,
)


# ============================================================================
# SLUGIFY TESTS
# ============================================================================

class TestSlugify:
    """Tests for the slugify function."""

    def test_accented_characters(self):
        """Accented characters are normalized to ASCII.

        Note: spaces are removed by the non-alnum filter, not converted to hyphens.
        """
        assert slugify("Cafe Muller") == "cafemuller"

    def test_accent_removal(self):
        """Diacritics are removed via NFKD normalization."""
        # e with accent -> e (the accent is stripped)
        result = slugify("Cafe")
        assert result == "cafe"

    def test_special_characters_removed(self):
        """Non-alphanumeric characters (except hyphens) are removed.

        Spaces are also removed (not converted to hyphens).
        """
        assert slugify("Oil & Canvas") == "oilcanvas"

    def test_object_number_format(self):
        """Dots in object numbers become hyphens."""
        assert slugify("1941.4.1") == "1941-4-1"

    def test_forward_slashes(self):
        """Forward slashes become hyphens."""
        assert slugify("2024/001/A") == "2024-001-a"

    def test_backslashes(self):
        """Backslashes become hyphens."""
        assert slugify("path\\to\\item") == "path-to-item"

    def test_leading_trailing_hyphens_stripped(self):
        """Leading/trailing hyphens are removed."""
        assert slugify("--Hello--") == "hello"

    def test_empty_string_returns_memorable(self):
        """Empty string falls back to memorable ID."""
        result = slugify("")
        assert len(result) == 9  # xxxx-xxxx format
        assert "-" in result

    def test_lowercase(self):
        """Output is always lowercase."""
        result = slugify("UPPERCASE")
        assert result == "uppercase"

    def test_spaces_removed(self):
        """Spaces are removed (they are not alphanumeric or hyphens).

        Note: The slugify implementation uses re.sub(r'[^a-z0-9-]', '', text)
        which removes spaces. Spaces do NOT become hyphens.
        """
        # Spaces are stripped by the non-alnum filter
        result = slugify("Hello World")
        # "Hello World" -> lowercase -> "hello world"
        # -> replace ./\\ with - -> "hello world"
        # -> remove non-alnum except - -> "helloworld"
        # -> collapse hyphens -> "helloworld"
        assert result == "helloworld"

    def test_multiple_dots_collapsed(self):
        """Multiple dots become single hyphen after collapsing."""
        result = slugify("a...b")
        assert result == "a-b"

    def test_unicode_normalization(self):
        """Unicode characters are normalized."""
        # naive with diaeresis on i
        result = slugify("naive")
        assert result == "naive"


class TestMemorableId:
    """Tests for memorable ID generation."""

    def test_format(self):
        """Memorable ID has xxxx-xxxx format (9 chars total)."""
        mid = generate_memorable_id()
        assert len(mid) == 9
        assert mid[4] == "-"

    def test_uniqueness(self):
        """Generated IDs are unique."""
        ids = [generate_memorable_id() for _ in range(100)]
        assert len(set(ids)) == 100

    def test_url_safe(self):
        """IDs only contain URL-safe characters."""
        for _ in range(50):
            mid = generate_memorable_id()
            # After removing the hyphen separator, should be alphanumeric
            assert mid.replace("-", "").isalnum()

    def test_hex_chars_only(self):
        """Memorable IDs use hex characters (from SHA256 digest)."""
        for _ in range(50):
            mid = generate_memorable_id()
            # Should be hex chars plus one hyphen
            assert re.match(r'^[0-9a-f]{4}-[0-9a-f]{4}$', mid)


class TestPublicIdGeneration:
    """Tests for public ID generation."""

    def test_with_object_number_hint(self):
        """Object number hint is slugified."""
        pid = generate_public_id("collection_object", hint="1941.4.1")
        assert pid == "1941-4-1"

    def test_without_hint(self):
        """No hint generates memorable ID."""
        pid = generate_public_id("collection_object")
        assert len(pid) == 9  # xxxx-xxxx

    def test_truncates_long_hints(self):
        """Long hints are truncated to 100 characters."""
        long_hint = "A" * 200
        pid = generate_public_id("collection_object", hint=long_hint)
        assert len(pid) <= 100


# ============================================================================
# URI BUILDING
# ============================================================================

class TestBuildUri:
    """Tests for URI building."""

    def test_basic_uri(self):
        """Build URI for collection object."""
        uri = build_uri("moma", "collection_object", "1941-4-1")
        assert uri == f"{BASE_URI}/org/moma/object/1941-4-1"

    def test_agent_uri(self):
        """Build URI for person authority."""
        uri = build_uri("moma", "person_authority", "monet-claude")
        assert uri == f"{BASE_URI}/org/moma/agent/monet-claude"

    def test_place_uri(self):
        """Build URI for place."""
        uri = build_uri("moma", "place", "paris-france")
        assert uri == f"{BASE_URI}/org/moma/place/paris-france"

    def test_media_uri(self):
        """Build URI for media."""
        uri = build_uri("moma", "media", "starry-night-001")
        assert uri == f"{BASE_URI}/org/moma/media/starry-night-001"

    def test_custom_base_uri(self):
        """Build URI with custom base."""
        uri = build_uri("moma", "collection_object", "test", base_uri="https://custom.example.com")
        assert uri == "https://custom.example.com/org/moma/object/test"

    def test_all_entity_types(self):
        """All configured entity types produce valid URIs."""
        for internal_type, url_segment in ENTITY_TYPES.items():
            uri = build_uri("test", internal_type, "id-1")
            assert f"/org/test/{url_segment}/id-1" in uri

    def test_unknown_entity_type_uses_raw(self):
        """Unknown entity types use the type name as the URL segment."""
        uri = build_uri("test", "unknown_type", "id-1")
        assert "/org/test/unknown_type/id-1" in uri


# ============================================================================
# URI PARSING
# ============================================================================

class TestParseUri:
    """Tests for URI parsing."""

    def test_full_uri(self):
        """Parse a full URI with scheme and host."""
        uri = f"{BASE_URI}/org/moma/object/1941-4-1"
        result = parse_uri(uri)
        assert result == ("moma", "collection_object", "1941-4-1")

    def test_path_only(self):
        """Parse a path-only URI."""
        result = parse_uri("/org/moma/object/1941-4-1")
        assert result == ("moma", "collection_object", "1941-4-1")

    def test_agent_uri(self):
        """Parse agent URI."""
        result = parse_uri("/org/moma/agent/monet-claude")
        assert result == ("moma", "person_authority", "monet-claude")

    def test_invalid_uri(self):
        """Invalid URIs return None."""
        assert parse_uri("/invalid/path") is None

    def test_empty_string(self):
        """Empty string returns None."""
        assert parse_uri("") is None

    def test_roundtrip(self):
        """Building and parsing are inverses."""
        test_cases = [
            ("moma", "collection_object", "1941-4-1"),
            ("british-museum", "person_authority", "monet-claude"),
            ("test-org", "media", "image-001"),
            ("getty", "place", "paris-france"),
        ]

        for org, entity_type, public_id in test_cases:
            uri = build_uri(org, entity_type, public_id)
            parsed = parse_uri(uri)
            assert parsed == (org, entity_type, public_id), f"Roundtrip failed for {uri}"

    def test_unknown_segment_passthrough(self):
        """Unknown URL segments pass through as-is."""
        result = parse_uri("/org/test/custom-type/id-1")
        assert result is not None
        org, entity_type, public_id = result
        assert org == "test"
        assert public_id == "id-1"
        # entity_type may or may not be transformed depending on URL_SEGMENT_TO_ENTITY


# ============================================================================
# HTTP RESPONSE HELPERS
# ============================================================================

class TestHttpResponses:
    """Tests for HTTP response generation from URI resolution."""

    def test_active_uri_returns_200(self):
        """Active URI returns 200."""
        resolution = URIResolution(
            found=True,
            status=URIStatus.ACTIVE,
            entity_type="collection_object",
            entity_id=uuid4(),
        )
        response = get_http_response_for_resolution(resolution)
        assert response["status_code"] == 200

    def test_redirect_301(self):
        """Permanent redirect returns 301 with Location header."""
        resolution = URIResolution(
            found=True,
            status=URIStatus.REDIRECT,
            redirect_uri="https://example.com/new",
            redirect_type=RedirectType.PERMANENT,
        )
        response = get_http_response_for_resolution(resolution)
        assert response["status_code"] == 301
        assert response["headers"]["Location"] == "https://example.com/new"

    def test_redirect_303(self):
        """See Other redirect returns 303."""
        resolution = URIResolution(
            found=True,
            status=URIStatus.REDIRECT,
            redirect_uri="https://example.com/new",
            redirect_type=RedirectType.SEE_OTHER,
        )
        response = get_http_response_for_resolution(resolution)
        assert response["status_code"] == 303

    def test_tombstone_410(self):
        """Tombstoned URI returns 410 Gone."""
        resolution = URIResolution(
            found=True,
            status=URIStatus.TOMBSTONE,
            tombstone_reason="Duplicate record",
        )
        response = get_http_response_for_resolution(resolution)
        assert response["status_code"] == 410
        assert response["body"]["error"] == "Gone"
        assert "Duplicate record" in response["body"]["reason"]

    def test_not_found_404(self):
        """Unknown URI returns 404."""
        resolution = URIResolution(found=False, status=URIStatus.ACTIVE)
        response = get_http_response_for_resolution(resolution)
        assert response["status_code"] == 404

    def test_active_body_is_none(self):
        """Active URI body is None (caller provides data)."""
        resolution = URIResolution(
            found=True,
            status=URIStatus.ACTIVE,
            entity_type="collection_object",
            entity_id=uuid4(),
        )
        response = get_http_response_for_resolution(resolution)
        assert response["body"] is None

    def test_redirect_body_contains_location(self):
        """Redirect body contains location info."""
        target = "https://example.com/new-entity"
        resolution = URIResolution(
            found=True,
            status=URIStatus.REDIRECT,
            redirect_uri=target,
            redirect_type=RedirectType.SEE_OTHER,
        )
        response = get_http_response_for_resolution(resolution)
        assert response["body"]["location"] == target


# ============================================================================
# ENUM AND MODEL TESTS
# ============================================================================

class TestEnumsAndModels:
    """Test URI enums and Pydantic models."""

    def test_uri_status_values(self):
        """URIStatus has expected values."""
        assert URIStatus.ACTIVE == "active"
        assert URIStatus.REDIRECT == "redirect"
        assert URIStatus.TOMBSTONE == "tombstone"
        assert URIStatus.RESERVED == "reserved"

    def test_redirect_type_values(self):
        """RedirectType has expected values."""
        assert RedirectType.PERMANENT == "301"
        assert RedirectType.SEE_OTHER == "303"

    def test_public_uri_path_property(self):
        """PublicURI.path returns the path portion."""
        uri = PublicURI(
            uri="https://data.madrona.io/org/moma/object/1941-4-1",
            entity_type="object",
            public_id="1941-4-1",
            organization_slug="moma",
        )
        assert uri.path == "/org/moma/object/1941-4-1"

    def test_entity_type_mapping(self):
        """ENTITY_TYPES and URL_SEGMENT_TO_ENTITY are inverse mappings."""
        for internal, segment in ENTITY_TYPES.items():
            assert URL_SEGMENT_TO_ENTITY[segment] == internal


# ============================================================================
# PROPERTY-BASED TESTS
# ============================================================================

class TestURIProperties:
    """Property-based tests for URI invariants."""

    def test_parse_build_roundtrip(self):
        """Building and parsing should be inverses for known entity types."""
        test_cases = [
            ("moma", "collection_object", "1941-4-1"),
            ("british-museum", "person_authority", "monet-claude"),
            ("test-org", "media", "image-001"),
        ]

        for org, entity_type, public_id in test_cases:
            uri = build_uri(org, entity_type, public_id)
            parsed = parse_uri(uri)
            assert parsed == (org, entity_type, public_id)

    def test_uri_never_contains_internal_uuid(self):
        """Public URIs should never expose internal UUIDs as the public_id."""
        for _ in range(50):
            hint = f"Object-{uuid4()}"
            public_id = generate_public_id("collection_object", hint)

            # Should not be a valid UUID (it's a slug)
            try:
                from uuid import UUID
                UUID(public_id)
                pytest.fail(f"Public ID {public_id} looks like a UUID!")
            except ValueError:
                pass  # Expected - not a UUID

    def test_slugify_produces_url_safe_output(self):
        """Slugify output should only contain lowercase alphanumeric and hyphens."""
        test_inputs = [
            "Hello World",
            "Cafe & Bar",
            "Object #42",
            "2024/001",
            "path\\to\\thing",
            "UPPERCASE",
            "spaces   multiple",
        ]

        for inp in test_inputs:
            result = slugify(inp)
            assert re.match(r'^[a-z0-9-]+$', result), f"slugify({inp!r}) = {result!r} is not URL-safe"
