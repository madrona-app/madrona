"""
Profile Versioning Support

Utilities for managing profile versions, comparing versions, and tracking
version compatibility across profile updates.

VERSION FORMAT:
    Profiles use semantic versioning (MAJOR.MINOR.PATCH):
    - MAJOR: Breaking changes that require migration
    - MINOR: Backward-compatible additions (new optional/recommended fields)
    - PATCH: Bug fixes, documentation updates

USAGE:
    from app.schemas.profiles.versioning import (
        parse_version,
        compare_versions,
        is_compatible,
        get_version_info,
    )

    # Compare versions
    compare_versions("1.2.0", "1.1.0")  # Returns 1 (first is newer)

    # Check compatibility
    is_compatible("1.2.0", "1.1.0")  # True (minor version bump is compatible)
    is_compatible("2.0.0", "1.1.0")  # False (major version bump breaks compat)
"""

import re
from dataclasses import dataclass
from typing import Optional


@dataclass
class Version:
    """Parsed semantic version."""
    major: int
    minor: int
    patch: int
    prerelease: Optional[str] = None
    build: Optional[str] = None

    def __str__(self) -> str:
        version = f"{self.major}.{self.minor}.{self.patch}"
        if self.prerelease:
            version += f"-{self.prerelease}"
        if self.build:
            version += f"+{self.build}"
        return version

    def __eq__(self, other: object) -> bool:
        if not isinstance(other, Version):
            return NotImplemented
        return (
            self.major == other.major and
            self.minor == other.minor and
            self.patch == other.patch and
            self.prerelease == other.prerelease
        )

    def __lt__(self, other: "Version") -> bool:
        if self.major != other.major:
            return self.major < other.major
        if self.minor != other.minor:
            return self.minor < other.minor
        if self.patch != other.patch:
            return self.patch < other.patch
        # Handle prerelease (no prerelease is "greater" than having one)
        if self.prerelease is None and other.prerelease is not None:
            return False
        if self.prerelease is not None and other.prerelease is None:
            return True
        if self.prerelease and other.prerelease:
            return self.prerelease < other.prerelease
        return False

    def __le__(self, other: "Version") -> bool:
        return self == other or self < other

    def __gt__(self, other: "Version") -> bool:
        return not self <= other

    def __ge__(self, other: "Version") -> bool:
        return not self < other

    def tuple(self) -> tuple[int, int, int]:
        """Return version as (major, minor, patch) tuple."""
        return (self.major, self.minor, self.patch)


# Regex for semantic versioning (simplified)
VERSION_PATTERN = re.compile(
    r"^(?P<major>\d+)\.(?P<minor>\d+)\.(?P<patch>\d+)"
    r"(?:-(?P<prerelease>[a-zA-Z0-9.-]+))?"
    r"(?:\+(?P<build>[a-zA-Z0-9.-]+))?$"
)


def parse_version(version_str: str) -> Version:
    """
    Parse a version string into a Version object.

    Args:
        version_str: Version string (e.g., "1.2.3", "2.0.0-beta.1")

    Returns:
        Parsed Version object

    Raises:
        ValueError: If version string is invalid
    """
    match = VERSION_PATTERN.match(version_str.strip())
    if not match:
        raise ValueError(f"Invalid version string: '{version_str}'")

    return Version(
        major=int(match.group("major")),
        minor=int(match.group("minor")),
        patch=int(match.group("patch")),
        prerelease=match.group("prerelease"),
        build=match.group("build"),
    )


def compare_versions(v1: str, v2: str) -> int:
    """
    Compare two version strings.

    Args:
        v1: First version string
        v2: Second version string

    Returns:
        -1 if v1 < v2
         0 if v1 == v2
         1 if v1 > v2
    """
    parsed_v1 = parse_version(v1)
    parsed_v2 = parse_version(v2)

    if parsed_v1 < parsed_v2:
        return -1
    elif parsed_v1 > parsed_v2:
        return 1
    return 0


def is_compatible(
    record_version: str,
    profile_version: str,
    allow_minor_mismatch: bool = True,
) -> bool:
    """
    Check if a record version is compatible with a profile version.

    By default, records are compatible with profiles that have:
    - Same major version
    - Same or newer minor version (if allow_minor_mismatch=True)

    Args:
        record_version: Version the record was created with
        profile_version: Current profile version
        allow_minor_mismatch: Allow minor version differences

    Returns:
        True if versions are compatible
    """
    try:
        record_v = parse_version(record_version)
        profile_v = parse_version(profile_version)
    except ValueError:
        return False

    # Major version must match
    if record_v.major != profile_v.major:
        return False

    if not allow_minor_mismatch:
        # Exact minor version match required
        return record_v.minor == profile_v.minor

    # Minor version can differ (profile can be newer)
    return True


def needs_migration(record_version: str, profile_version: str) -> bool:
    """
    Check if a record needs migration to the current profile version.

    Migration is needed when:
    - Major version differs (breaking changes)
    - Record is older than profile (even minor version bumps may add fields)

    Args:
        record_version: Version the record was created with
        profile_version: Current profile version

    Returns:
        True if migration may be needed
    """
    try:
        record_v = parse_version(record_version)
        profile_v = parse_version(profile_version)
    except ValueError:
        return True  # Assume migration needed if versions can't be parsed

    # Always migrate if major version differs
    if record_v.major != profile_v.major:
        return True

    # Migration may be needed if profile is newer
    return record_v < profile_v


def get_version_info(version_str: str) -> dict:
    """
    Get detailed version information.

    Args:
        version_str: Version string

    Returns:
        Dictionary with version components
    """
    try:
        v = parse_version(version_str)
        return {
            "version": str(v),
            "major": v.major,
            "minor": v.minor,
            "patch": v.patch,
            "prerelease": v.prerelease,
            "build": v.build,
            "is_prerelease": v.prerelease is not None,
            "tuple": v.tuple(),
        }
    except ValueError as e:
        return {
            "version": version_str,
            "error": str(e),
        }


def increment_version(
    version_str: str,
    bump: str = "patch",
) -> str:
    """
    Increment a version number.

    Args:
        version_str: Current version string
        bump: Type of bump ("major", "minor", or "patch")

    Returns:
        New version string
    """
    v = parse_version(version_str)

    if bump == "major":
        return f"{v.major + 1}.0.0"
    elif bump == "minor":
        return f"{v.major}.{v.minor + 1}.0"
    elif bump == "patch":
        return f"{v.major}.{v.minor}.{v.patch + 1}"
    else:
        raise ValueError(f"Invalid bump type: {bump}")


@dataclass
class VersionRange:
    """
    Version range for specifying compatibility.

    Examples:
        ">=1.0.0" - Version 1.0.0 or higher
        ">=1.0.0,<2.0.0" - Version 1.x
        "1.2.x" - Any 1.2 patch version
    """
    min_version: Optional[Version] = None
    max_version: Optional[Version] = None
    min_inclusive: bool = True
    max_inclusive: bool = False

    def contains(self, version: str) -> bool:
        """Check if a version is within this range."""
        try:
            v = parse_version(version)
        except ValueError:
            return False

        if self.min_version:
            if self.min_inclusive:
                if v < self.min_version:
                    return False
            else:
                if v <= self.min_version:
                    return False

        if self.max_version:
            if self.max_inclusive:
                if v > self.max_version:
                    return False
            else:
                if v >= self.max_version:
                    return False

        return True


def parse_version_range(range_str: str) -> VersionRange:
    """
    Parse a version range string.

    Supported formats:
        ">=1.0.0" - Version 1.0.0 or higher
        ">=1.0.0,<2.0.0" - Version range
        "1.x" or "1.x.x" - Any version with major 1
        "1.2.x" - Any version with major 1, minor 2
        "~1.2.3" - Approximately 1.2.3 (>=1.2.3, <1.3.0)
        "^1.2.3" - Compatible with 1.2.3 (>=1.2.3, <2.0.0)

    Args:
        range_str: Version range string

    Returns:
        VersionRange object
    """
    range_str = range_str.strip()

    # Handle x-ranges (1.x, 1.2.x)
    if "x" in range_str.lower():
        parts = range_str.lower().replace("x", "0").split(".")
        if len(parts) == 2:  # 1.x
            major = int(parts[0])
            return VersionRange(
                min_version=parse_version(f"{major}.0.0"),
                max_version=parse_version(f"{major + 1}.0.0"),
                min_inclusive=True,
                max_inclusive=False,
            )
        elif len(parts) == 3:  # 1.2.x
            major = int(parts[0])
            minor = int(parts[1])
            return VersionRange(
                min_version=parse_version(f"{major}.{minor}.0"),
                max_version=parse_version(f"{major}.{minor + 1}.0"),
                min_inclusive=True,
                max_inclusive=False,
            )

    # Handle tilde ranges (~1.2.3 -> >=1.2.3, <1.3.0)
    if range_str.startswith("~"):
        v = parse_version(range_str[1:])
        return VersionRange(
            min_version=v,
            max_version=parse_version(f"{v.major}.{v.minor + 1}.0"),
            min_inclusive=True,
            max_inclusive=False,
        )

    # Handle caret ranges (^1.2.3 -> >=1.2.3, <2.0.0)
    if range_str.startswith("^"):
        v = parse_version(range_str[1:])
        return VersionRange(
            min_version=v,
            max_version=parse_version(f"{v.major + 1}.0.0"),
            min_inclusive=True,
            max_inclusive=False,
        )

    # Handle comparison operators
    vr = VersionRange()

    for part in range_str.split(","):
        part = part.strip()
        if part.startswith(">="):
            vr.min_version = parse_version(part[2:])
            vr.min_inclusive = True
        elif part.startswith(">"):
            vr.min_version = parse_version(part[1:])
            vr.min_inclusive = False
        elif part.startswith("<="):
            vr.max_version = parse_version(part[2:])
            vr.max_inclusive = True
        elif part.startswith("<"):
            vr.max_version = parse_version(part[1:])
            vr.max_inclusive = False
        elif part.startswith("=") or part.startswith("=="):
            v = parse_version(part.lstrip("="))
            vr.min_version = v
            vr.max_version = v
            vr.min_inclusive = True
            vr.max_inclusive = True
        else:
            # Exact version
            v = parse_version(part)
            vr.min_version = v
            vr.max_version = v
            vr.min_inclusive = True
            vr.max_inclusive = True

    return vr
