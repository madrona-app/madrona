"""
Unit tests for profile versioning support.
"""

import pytest

from app.schemas.profiles.versioning import (
    Version,
    parse_version,
    compare_versions,
    is_compatible,
    needs_migration,
    increment_version,
    get_version_info,
    VersionRange,
    parse_version_range,
)


class TestVersion:
    """Test Version dataclass."""

    def test_string_representation(self):
        """Version converts to string correctly."""
        v = Version(1, 2, 3)
        assert str(v) == "1.2.3"

    def test_string_with_prerelease(self):
        """Version includes prerelease in string."""
        v = Version(1, 0, 0, prerelease="beta.1")
        assert str(v) == "1.0.0-beta.1"

    def test_string_with_build(self):
        """Version includes build in string."""
        v = Version(1, 0, 0, build="20240101")
        assert str(v) == "1.0.0+20240101"

    def test_equality(self):
        """Version equality works correctly."""
        v1 = Version(1, 2, 3)
        v2 = Version(1, 2, 3)
        v3 = Version(1, 2, 4)
        assert v1 == v2
        assert v1 != v3

    def test_comparison_major(self):
        """Major version difference determines ordering."""
        v1 = Version(1, 9, 9)
        v2 = Version(2, 0, 0)
        assert v1 < v2
        assert v2 > v1

    def test_comparison_minor(self):
        """Minor version difference determines ordering."""
        v1 = Version(1, 1, 9)
        v2 = Version(1, 2, 0)
        assert v1 < v2

    def test_comparison_patch(self):
        """Patch version difference determines ordering."""
        v1 = Version(1, 2, 3)
        v2 = Version(1, 2, 4)
        assert v1 < v2

    def test_comparison_prerelease(self):
        """Prerelease is less than release."""
        v1 = Version(1, 0, 0, prerelease="alpha")
        v2 = Version(1, 0, 0)
        assert v1 < v2

    def test_tuple(self):
        """tuple() returns (major, minor, patch)."""
        v = Version(1, 2, 3)
        assert v.tuple() == (1, 2, 3)


class TestParseVersion:
    """Test parse_version function."""

    def test_basic_version(self):
        """Parses basic version string."""
        v = parse_version("1.2.3")
        assert v.major == 1
        assert v.minor == 2
        assert v.patch == 3

    def test_with_prerelease(self):
        """Parses version with prerelease."""
        v = parse_version("1.0.0-beta.1")
        assert v.major == 1
        assert v.prerelease == "beta.1"

    def test_with_build(self):
        """Parses version with build metadata."""
        v = parse_version("1.0.0+build.123")
        assert v.major == 1
        assert v.build == "build.123"

    def test_full_version(self):
        """Parses version with prerelease and build."""
        v = parse_version("2.1.0-rc.1+20240101")
        assert v.major == 2
        assert v.minor == 1
        assert v.patch == 0
        assert v.prerelease == "rc.1"
        assert v.build == "20240101"

    def test_invalid_version(self):
        """Raises ValueError for invalid version."""
        with pytest.raises(ValueError):
            parse_version("invalid")

    def test_incomplete_version(self):
        """Raises ValueError for incomplete version."""
        with pytest.raises(ValueError):
            parse_version("1.2")

    def test_extra_whitespace(self):
        """Handles whitespace in version string."""
        v = parse_version("  1.2.3  ")
        assert v.major == 1


class TestCompareVersions:
    """Test compare_versions function."""

    def test_equal_versions(self):
        """Equal versions return 0."""
        assert compare_versions("1.2.3", "1.2.3") == 0

    def test_first_greater(self):
        """First greater returns 1."""
        assert compare_versions("1.2.4", "1.2.3") == 1
        assert compare_versions("1.3.0", "1.2.9") == 1
        assert compare_versions("2.0.0", "1.9.9") == 1

    def test_second_greater(self):
        """Second greater returns -1."""
        assert compare_versions("1.2.3", "1.2.4") == -1
        assert compare_versions("1.2.9", "1.3.0") == -1
        assert compare_versions("1.9.9", "2.0.0") == -1


class TestIsCompatible:
    """Test is_compatible function."""

    def test_same_version_compatible(self):
        """Same versions are compatible."""
        assert is_compatible("1.2.3", "1.2.3") is True

    def test_same_major_compatible(self):
        """Same major version is compatible by default."""
        assert is_compatible("1.0.0", "1.5.0") is True
        assert is_compatible("1.5.0", "1.0.0") is True

    def test_different_major_incompatible(self):
        """Different major versions are incompatible."""
        assert is_compatible("1.0.0", "2.0.0") is False
        assert is_compatible("2.0.0", "1.0.0") is False

    def test_strict_minor_check(self):
        """Strict mode requires exact minor version."""
        assert is_compatible("1.2.0", "1.2.0", allow_minor_mismatch=False) is True
        assert is_compatible("1.2.0", "1.3.0", allow_minor_mismatch=False) is False

    def test_invalid_version_incompatible(self):
        """Invalid versions are incompatible."""
        assert is_compatible("invalid", "1.0.0") is False
        assert is_compatible("1.0.0", "invalid") is False


class TestNeedsMigration:
    """Test needs_migration function."""

    def test_same_version_no_migration(self):
        """Same version needs no migration."""
        assert needs_migration("1.2.3", "1.2.3") is False

    def test_newer_record_no_migration(self):
        """Newer record doesn't need migration to older profile."""
        assert needs_migration("1.3.0", "1.2.0") is False

    def test_older_record_needs_migration(self):
        """Older record needs migration to newer profile."""
        assert needs_migration("1.2.0", "1.3.0") is True

    def test_major_version_change_needs_migration(self):
        """Major version change always needs migration."""
        assert needs_migration("1.9.9", "2.0.0") is True
        assert needs_migration("2.0.0", "1.9.9") is True

    def test_invalid_version_needs_migration(self):
        """Invalid version assumes migration needed."""
        assert needs_migration("invalid", "1.0.0") is True


class TestIncrementVersion:
    """Test increment_version function."""

    def test_patch_bump(self):
        """Patch bump increments patch version."""
        assert increment_version("1.2.3", "patch") == "1.2.4"

    def test_minor_bump(self):
        """Minor bump increments minor and resets patch."""
        assert increment_version("1.2.3", "minor") == "1.3.0"

    def test_major_bump(self):
        """Major bump increments major and resets others."""
        assert increment_version("1.2.3", "major") == "2.0.0"

    def test_invalid_bump(self):
        """Invalid bump type raises error."""
        with pytest.raises(ValueError):
            increment_version("1.0.0", "invalid")


class TestGetVersionInfo:
    """Test get_version_info function."""

    def test_basic_info(self):
        """Returns version components."""
        info = get_version_info("1.2.3")
        assert info["major"] == 1
        assert info["minor"] == 2
        assert info["patch"] == 3
        assert info["is_prerelease"] is False

    def test_prerelease_info(self):
        """Returns prerelease info."""
        info = get_version_info("1.0.0-beta")
        assert info["prerelease"] == "beta"
        assert info["is_prerelease"] is True

    def test_invalid_version_info(self):
        """Returns error for invalid version."""
        info = get_version_info("invalid")
        assert "error" in info


class TestVersionRange:
    """Test VersionRange class."""

    def test_contains_within_range(self):
        """Version within range is contained."""
        vr = VersionRange(
            min_version=parse_version("1.0.0"),
            max_version=parse_version("2.0.0"),
        )
        assert vr.contains("1.5.0") is True
        assert vr.contains("1.0.0") is True
        assert vr.contains("1.9.9") is True

    def test_contains_outside_range(self):
        """Version outside range is not contained."""
        vr = VersionRange(
            min_version=parse_version("1.0.0"),
            max_version=parse_version("2.0.0"),
        )
        assert vr.contains("0.9.0") is False
        assert vr.contains("2.0.0") is False  # max exclusive by default
        assert vr.contains("2.1.0") is False

    def test_inclusive_max(self):
        """Inclusive max includes boundary."""
        vr = VersionRange(
            min_version=parse_version("1.0.0"),
            max_version=parse_version("2.0.0"),
            max_inclusive=True,
        )
        assert vr.contains("2.0.0") is True


class TestParseVersionRange:
    """Test parse_version_range function."""

    def test_greater_than_or_equal(self):
        """Parses >=1.0.0 range."""
        vr = parse_version_range(">=1.0.0")
        assert vr.contains("1.0.0") is True
        assert vr.contains("2.0.0") is True
        assert vr.contains("0.9.0") is False

    def test_less_than(self):
        """Parses <2.0.0 range."""
        vr = parse_version_range("<2.0.0")
        assert vr.contains("1.9.9") is True
        assert vr.contains("2.0.0") is False

    def test_combined_range(self):
        """Parses >=1.0.0,<2.0.0 range."""
        vr = parse_version_range(">=1.0.0,<2.0.0")
        assert vr.contains("1.5.0") is True
        assert vr.contains("0.9.0") is False
        assert vr.contains("2.0.0") is False

    def test_x_range_major(self):
        """Parses 1.x range."""
        vr = parse_version_range("1.x")
        assert vr.contains("1.0.0") is True
        assert vr.contains("1.9.9") is True
        assert vr.contains("2.0.0") is False

    def test_x_range_minor(self):
        """Parses 1.2.x range."""
        vr = parse_version_range("1.2.x")
        assert vr.contains("1.2.0") is True
        assert vr.contains("1.2.9") is True
        assert vr.contains("1.3.0") is False

    def test_tilde_range(self):
        """Parses ~1.2.3 range (patch-level changes)."""
        vr = parse_version_range("~1.2.3")
        assert vr.contains("1.2.3") is True
        assert vr.contains("1.2.9") is True
        assert vr.contains("1.3.0") is False

    def test_caret_range(self):
        """Parses ^1.2.3 range (compatible changes)."""
        vr = parse_version_range("^1.2.3")
        assert vr.contains("1.2.3") is True
        assert vr.contains("1.9.9") is True
        assert vr.contains("2.0.0") is False

    def test_exact_version(self):
        """Parses exact version."""
        vr = parse_version_range("1.2.3")
        assert vr.contains("1.2.3") is True
        assert vr.contains("1.2.4") is False
