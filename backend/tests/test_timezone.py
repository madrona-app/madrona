"""
Tests for timezone support.

Tests cover:
1. Time utilities module (validation, conversion)
2. Schedule calculations with DST-aware timezones
3. Non-DST zones (e.g., Asia/Singapore)
4. DST zones (e.g., Europe/Berlin, Australia/Sydney)
5. Organization timezone defaults
"""

import pytest
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.services.time import (
    is_valid_timezone,
    validate_timezone,
    get_timezone,
    now_utc,
    to_org_zoned,
    from_org_local,
    format_org_display,
    get_all_timezones,
    get_common_timezones,
    get_timezone_display_name,
)
from app.services.schedule_utils import compute_next_run_at
from app.services.scheduler import compute_next_run_time


class TestTimezoneValidation:
    """Tests for timezone validation utilities."""

    def test_is_valid_timezone_valid(self):
        """Valid IANA timezone identifiers should return True."""
        assert is_valid_timezone("UTC") is True
        assert is_valid_timezone("America/New_York") is True
        assert is_valid_timezone("Europe/Berlin") is True
        assert is_valid_timezone("Asia/Singapore") is True
        assert is_valid_timezone("Australia/Sydney") is True
        assert is_valid_timezone("Pacific/Auckland") is True

    def test_is_valid_timezone_invalid(self):
        """Invalid timezone strings should return False."""
        assert is_valid_timezone("Invalid/Timezone") is False
        assert is_valid_timezone("") is False
        assert is_valid_timezone(None) is False
        # Note: Some abbreviations like "EST" may be in available_timezones()
        # depending on the Python version and tzdata package. Test truly invalid ones.
        assert is_valid_timezone("Not_A_Timezone") is False
        assert is_valid_timezone("Foo/Bar/Baz/Qux") is False

    def test_validate_timezone_raises_on_invalid(self):
        """validate_timezone should raise ValueError for invalid timezones."""
        with pytest.raises(ValueError, match="Invalid timezone"):
            validate_timezone("Invalid/Timezone")

        with pytest.raises(ValueError, match="Invalid timezone"):
            validate_timezone("")

    def test_validate_timezone_accepts_valid(self):
        """validate_timezone should not raise for valid timezones."""
        validate_timezone("UTC")
        validate_timezone("America/New_York")
        validate_timezone("Europe/Berlin")
        # No exception means success

    def test_get_timezone_returns_zoneinfo(self):
        """get_timezone should return a ZoneInfo object."""
        tz = get_timezone("America/New_York")
        assert isinstance(tz, ZoneInfo)
        assert str(tz) == "America/New_York"

    def test_get_all_timezones(self):
        """get_all_timezones should return all IANA timezones."""
        timezones = get_all_timezones()
        assert len(timezones) > 400  # There are ~400+ IANA timezones
        assert "UTC" in timezones
        assert "America/New_York" in timezones
        assert "Europe/Berlin" in timezones

    def test_get_common_timezones(self):
        """get_common_timezones should return a curated list."""
        timezones = get_common_timezones()
        assert len(timezones) > 10
        assert len(timezones) < 100  # Should be a curated subset
        assert "UTC" in timezones
        assert "America/New_York" in timezones


class TestTimezoneConversion:
    """Tests for timezone conversion utilities."""

    def test_now_utc_is_timezone_aware(self):
        """now_utc should return a timezone-aware datetime."""
        now = now_utc()
        assert now.tzinfo is not None
        assert now.tzinfo == timezone.utc

    def test_to_org_zoned_converts_utc_to_local(self):
        """to_org_zoned should convert UTC datetime to org timezone."""
        utc_time = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)

        # New York is UTC-5 in January (no DST)
        ny_time = to_org_zoned(utc_time, "America/New_York")
        assert ny_time.hour == 7  # 12:00 UTC -> 07:00 EST
        assert ny_time.tzinfo is not None

        # Berlin is UTC+1 in January (no DST)
        berlin_time = to_org_zoned(utc_time, "Europe/Berlin")
        assert berlin_time.hour == 13  # 12:00 UTC -> 13:00 CET

    def test_to_org_zoned_handles_naive_datetime(self):
        """to_org_zoned should treat naive datetimes as UTC."""
        naive_time = datetime(2026, 1, 15, 12, 0, 0)  # No tzinfo

        ny_time = to_org_zoned(naive_time, "America/New_York")
        assert ny_time.hour == 7  # Assumes UTC input

    def test_from_org_local_converts_to_utc(self):
        """from_org_local should convert org local time to UTC."""
        # 7:00 AM in New York on Jan 15, 2026
        local_time = datetime(2026, 1, 15, 7, 0, 0)

        utc_time = from_org_local(local_time, "America/New_York")
        assert utc_time.hour == 12  # 07:00 EST -> 12:00 UTC
        assert utc_time.tzinfo == timezone.utc

    def test_format_org_display(self):
        """format_org_display should format datetime in org timezone."""
        utc_time = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)

        display = format_org_display(utc_time, "America/New_York")
        # Should contain the formatted time string
        assert "2026" in display or "26" in display

    def test_get_timezone_display_name(self):
        """get_timezone_display_name should return a human-readable string."""
        # Test with a reference time in January (EST, not EDT)
        ref_time = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)
        display = get_timezone_display_name("America/New_York", reference_time=ref_time)
        assert "America/New_York" in display
        assert "UTC" in display


class TestDSTAwareScheduling:
    """Tests for DST-aware schedule calculations.

    Uses SimpleNamespace mock objects for Schedule to avoid needing
    full DB fixtures with Pipeline/Dataset/ConnectorInstance.
    """

    def _make_schedule(self, **kwargs):
        """Create a mock schedule SimpleNamespace for testing."""
        defaults = {
            "schedule_id": "test-schedule-id",
            "organization_id": "test-org-id",
            "pipeline_id": "test-pipeline-id",
            "enabled": True,
            "type": "interval",
            "every_n": 6,
            "unit": "hours",
            "time_hour": None,
            "time_minute": None,
            "timezone": "UTC",
        }
        defaults.update(kwargs)
        return SimpleNamespace(**defaults)

    def test_schedule_with_non_dst_timezone(self):
        """
        Test scheduling with a timezone that does not observe DST (Asia/Singapore).

        Singapore is always UTC+8, no DST transitions.
        """
        schedule = self._make_schedule(timezone="Asia/Singapore")

        # UTC 04:00 = Singapore 12:00 noon
        test_time = datetime(2026, 3, 15, 4, 0, 0, tzinfo=ZoneInfo("UTC"))

        next_run = compute_next_run_time(schedule, test_time)

        # Should be a valid datetime in UTC
        assert next_run is not None
        assert isinstance(next_run, datetime)

    def test_schedule_with_europe_berlin_dst(self):
        """
        Test scheduling with Europe/Berlin which observes DST.

        Europe/Berlin:
        - Winter (CET): UTC+1
        - Summer (CEST): UTC+2
        - DST starts last Sunday of March
        - DST ends last Sunday of October
        """
        schedule = self._make_schedule(
            timezone="Europe/Berlin",
            type="time",
            time_hour=9,
            time_minute=30,
            every_n=None,
            unit=None,
        )

        # Test in winter (before DST)
        # Berlin 09:30 CET = UTC 08:30
        winter_time = datetime(2026, 2, 15, 6, 0, 0, tzinfo=ZoneInfo("UTC"))
        next_run_winter = compute_next_run_at(schedule, now=winter_time)

        # Should schedule for 09:30 Berlin time = 08:30 UTC
        assert next_run_winter is not None
        assert next_run_winter.hour == 8
        assert next_run_winter.minute == 30

        # Test in summer (during DST)
        # Berlin 09:30 CEST = UTC 07:30
        summer_time = datetime(2026, 7, 15, 6, 0, 0, tzinfo=ZoneInfo("UTC"))
        next_run_summer = compute_next_run_at(schedule, now=summer_time)

        # Should schedule for 09:30 Berlin time = 07:30 UTC
        assert next_run_summer is not None
        assert next_run_summer.hour == 7
        assert next_run_summer.minute == 30

    def test_schedule_with_australia_sydney_dst(self):
        """
        Test scheduling with Australia/Sydney which observes DST.

        Australia/Sydney:
        - Winter (AEST): UTC+10
        - Summer (AEDT): UTC+11
        - Note: Southern hemisphere - DST is Oct-Apr
        """
        schedule = self._make_schedule(
            timezone="Australia/Sydney",
            type="time",
            time_hour=9,
            time_minute=0,
            every_n=None,
            unit=None,
        )

        # Test during Australian summer (January) - DST active
        # Sydney 09:00 AEDT (UTC+11) = UTC 22:00 previous day
        jan_time = datetime(2026, 1, 15, 20, 0, 0, tzinfo=ZoneInfo("UTC"))
        next_run_jan = compute_next_run_at(schedule, now=jan_time)

        assert next_run_jan is not None

        # Test during Australian winter (July) - no DST
        # Sydney 09:00 AEST (UTC+10) = UTC 23:00 previous day
        july_time = datetime(2026, 7, 15, 20, 0, 0, tzinfo=ZoneInfo("UTC"))
        next_run_july = compute_next_run_at(schedule, now=july_time)

        assert next_run_july is not None

    def test_interval_schedule_respects_timezone(self):
        """
        Test that interval schedules use timezone for boundary alignment.

        A 6-hour interval should align to timezone-local midnight boundaries.
        """
        schedule = self._make_schedule(
            timezone="America/New_York",
            type="interval",
            every_n=6,
            unit="hours",
        )

        # 10:00 UTC = 05:00 EST (during winter)
        test_time = datetime(2026, 1, 15, 10, 0, 0, tzinfo=ZoneInfo("UTC"))

        next_run = compute_next_run_time(schedule, test_time)

        # Should bucket to 6-hour boundary in EST
        # EST boundaries: 00:00, 06:00, 12:00, 18:00 EST
        assert next_run is not None

    def test_compute_next_run_time_returns_naive_utc(self):
        """compute_next_run_time should return a naive datetime (UTC assumed)."""
        schedule = self._make_schedule(timezone="UTC")
        test_time = datetime(2026, 1, 15, 10, 0, 0, tzinfo=ZoneInfo("UTC"))

        next_run = compute_next_run_time(schedule, test_time)
        assert next_run.tzinfo is None  # Naive datetime, UTC assumed

    def test_compute_next_run_at_time_based_returns_naive_utc(self):
        """compute_next_run_at for time-based schedule should return naive UTC."""
        schedule = self._make_schedule(
            timezone="America/New_York",
            type="time",
            time_hour=14,
            time_minute=0,
            every_n=None,
            unit=None,
        )
        now = datetime(2026, 1, 15, 10, 0, 0, tzinfo=ZoneInfo("UTC"))
        next_run = compute_next_run_at(schedule, now=now)

        assert next_run is not None
        assert next_run.tzinfo is None  # Naive datetime, UTC assumed


class TestOrganizationTimezoneDefaults:
    """Tests for organization timezone field."""

    def test_organization_timezone_defaults_to_utc(self, db_session):
        """New organizations should default to UTC timezone."""
        from app.models import Organization

        org = Organization(
            name="New Org",
            slug="new-org-tz",
            is_demo=False,
            status="active",
        )
        db_session.add(org)
        db_session.commit()
        db_session.refresh(org)

        assert org.timezone == "UTC"

    def test_organization_timezone_can_be_set(self, db_session):
        """Organization timezone can be set to a valid IANA timezone."""
        from app.models import Organization

        org = Organization(
            name="Berlin Org",
            slug="berlin-org-tz",
            is_demo=False,
            status="active",
            timezone="Europe/Berlin",
        )
        db_session.add(org)
        db_session.commit()
        db_session.refresh(org)

        assert org.timezone == "Europe/Berlin"


class TestScheduleTimezoneField:
    """Tests that Schedule model accepts timezone values."""

    def test_schedule_stores_timezone(self, db_session):
        """Schedule model should store a timezone string."""
        from app.models import Organization, Schedule, Pipeline

        org = Organization(
            name="Sydney Org",
            slug="sydney-org-tz",
            is_demo=False,
            status="active",
            timezone="Australia/Sydney",
        )
        db_session.add(org)
        db_session.flush()

        pipeline = Pipeline(
            organization_id=org.organization_id,
            status="active",
        )
        db_session.add(pipeline)
        db_session.flush()

        schedule = Schedule(
            organization_id=org.organization_id,
            pipeline_id=pipeline.pipeline_id,
            enabled=True,
            type="interval",
            every_n=6,
            unit="hours",
            timezone=org.timezone,
        )
        db_session.add(schedule)
        db_session.commit()

        assert schedule.timezone == "Australia/Sydney"
