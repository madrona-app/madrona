"""
Time utilities module for timezone-aware operations.

This module provides centralized timezone handling for the Madrona backend.
All timestamps in the database should be stored in UTC. This module helps
with conversions to/from organization-specific timezones.

Key principles:
- All persisted timestamps are in UTC
- Schedule calculations respect org timezone and DST
- Use these utilities instead of `new Date()` or naive datetime operations
"""

from datetime import datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo, available_timezones


# Common timezones for dropdown suggestions (subset of IANA database)
COMMON_TIMEZONES = [
    # Americas
    "America/New_York",
    "America/Chicago",
    "America/Denver",
    "America/Los_Angeles",
    "America/Anchorage",
    "America/Phoenix",
    "America/Toronto",
    "America/Vancouver",
    "America/Mexico_City",
    "America/Sao_Paulo",
    "America/Buenos_Aires",
    # Europe
    "Europe/London",
    "Europe/Paris",
    "Europe/Berlin",
    "Europe/Madrid",
    "Europe/Rome",
    "Europe/Amsterdam",
    "Europe/Brussels",
    "Europe/Vienna",
    "Europe/Stockholm",
    "Europe/Warsaw",
    "Europe/Zurich",
    "Europe/Dublin",
    # Asia
    "Asia/Tokyo",
    "Asia/Shanghai",
    "Asia/Hong_Kong",
    "Asia/Singapore",
    "Asia/Seoul",
    "Asia/Mumbai",
    "Asia/Kolkata",
    "Asia/Dubai",
    "Asia/Bangkok",
    "Asia/Jakarta",
    "Asia/Manila",
    # Oceania
    "Australia/Sydney",
    "Australia/Melbourne",
    "Australia/Brisbane",
    "Australia/Perth",
    "Australia/Adelaide",
    "Pacific/Auckland",
    "Pacific/Fiji",
    "Pacific/Honolulu",
    # Africa
    "Africa/Cairo",
    "Africa/Johannesburg",
    "Africa/Lagos",
    "Africa/Nairobi",
    # UTC
    "UTC",
]


def is_valid_timezone(tz_name: str) -> bool:
    """
    Validate that a timezone string is a valid IANA timezone identifier.

    Args:
        tz_name: The timezone identifier to validate (e.g., 'America/New_York')

    Returns:
        True if valid, False otherwise
    """
    if not tz_name or not isinstance(tz_name, str):
        return False
    return tz_name in available_timezones()


def validate_timezone(tz_name: str) -> None:
    """
    Validate a timezone string, raising ValueError if invalid.

    Args:
        tz_name: The timezone identifier to validate

    Raises:
        ValueError: If the timezone is invalid
    """
    if not is_valid_timezone(tz_name):
        raise ValueError(f"Invalid timezone identifier: '{tz_name}'. Must be a valid IANA timezone.")


def get_timezone(tz_name: str) -> ZoneInfo:
    """
    Get a ZoneInfo object for the given timezone name.

    Args:
        tz_name: IANA timezone identifier

    Returns:
        ZoneInfo object for the timezone

    Raises:
        ValueError: If the timezone is invalid
    """
    validate_timezone(tz_name)
    return ZoneInfo(tz_name)


def now_utc() -> datetime:
    """
    Get the current time in UTC with timezone awareness.

    Returns:
        Current datetime in UTC with tzinfo set
    """
    return datetime.now(timezone.utc)


def to_org_zoned(dt: datetime, org_timezone: str) -> datetime:
    """
    Convert a UTC datetime to the organization's local timezone.

    Args:
        dt: A datetime object (should be in UTC, or timezone-aware)
        org_timezone: The organization's IANA timezone identifier

    Returns:
        Datetime converted to the organization's timezone

    Raises:
        ValueError: If org_timezone is invalid
    """
    validate_timezone(org_timezone)

    # Ensure the datetime is timezone-aware
    if dt.tzinfo is None:
        # Assume naive datetimes are UTC
        dt = dt.replace(tzinfo=timezone.utc)

    # Convert to org timezone
    return dt.astimezone(ZoneInfo(org_timezone))


def from_org_local(dt: datetime, org_timezone: str) -> datetime:
    """
    Convert a datetime from organization local time to UTC.

    This is useful when parsing user input that represents a time
    in the organization's local timezone.

    Args:
        dt: A datetime object representing local time (naive or aware)
        org_timezone: The organization's IANA timezone identifier

    Returns:
        Datetime converted to UTC

    Raises:
        ValueError: If org_timezone is invalid
    """
    validate_timezone(org_timezone)

    tz = ZoneInfo(org_timezone)

    # If naive, assume it's in the org timezone
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz)
    elif dt.tzinfo != tz:
        # If it has a different tzinfo, convert to org timezone first
        # then to UTC (this handles edge cases)
        dt = dt.astimezone(tz)

    # Convert to UTC
    return dt.astimezone(timezone.utc)


def format_org_display(dt: datetime, org_timezone: str, format_str: Optional[str] = None) -> str:
    """
    Format a datetime for display in the organization's timezone.

    Args:
        dt: A datetime object (should be in UTC or timezone-aware)
        org_timezone: The organization's IANA timezone identifier
        format_str: Optional strftime format string. Defaults to ISO 8601 format.

    Returns:
        Formatted string in the organization's timezone

    Raises:
        ValueError: If org_timezone is invalid
    """
    local_dt = to_org_zoned(dt, org_timezone)

    if format_str:
        return local_dt.strftime(format_str)

    # Default: ISO 8601 format with timezone offset
    return local_dt.isoformat()


def get_all_timezones() -> list[str]:
    """
    Get all available IANA timezone identifiers, sorted.

    Returns:
        Sorted list of all valid timezone identifiers
    """
    return sorted(available_timezones())


def get_common_timezones() -> list[str]:
    """
    Get a curated list of common timezones for UI dropdowns.

    Returns:
        List of common timezone identifiers
    """
    return COMMON_TIMEZONES.copy()


def get_timezone_display_name(tz_name: str, reference_time: Optional[datetime] = None) -> str:
    """
    Get a human-readable display name for a timezone.

    Args:
        tz_name: IANA timezone identifier
        reference_time: Optional datetime to show offset at. Defaults to now.

    Returns:
        Display string like "America/New_York (EST, UTC-05:00)"

    Raises:
        ValueError: If tz_name is invalid
    """
    validate_timezone(tz_name)

    if reference_time is None:
        reference_time = now_utc()

    tz = ZoneInfo(tz_name)
    local_time = reference_time.astimezone(tz)

    # Get the offset
    offset = local_time.utcoffset()
    if offset is not None:
        total_seconds = int(offset.total_seconds())
        hours, remainder = divmod(abs(total_seconds), 3600)
        minutes = remainder // 60
        sign = '+' if total_seconds >= 0 else '-'
        offset_str = f"UTC{sign}{hours:02d}:{minutes:02d}"
    else:
        offset_str = "UTC"

    # Get the abbreviated timezone name (e.g., EST, PST)
    abbrev = local_time.strftime('%Z')

    if abbrev and abbrev != tz_name:
        return f"{tz_name} ({abbrev}, {offset_str})"
    return f"{tz_name} ({offset_str})"
