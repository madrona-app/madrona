"""
Tests for Phase 1: Format Registry & Identification.
"""

import uuid

import pytest

from app.models.preservation import FormatRegistryEntry
from app.models.media import Media


def _seed_registry(session):
    """Seed the format registry with test entries."""
    entries = [
        FormatRegistryEntry(
            pronom_puid="fmt/353",
            name="TIFF 6.0",
            mime_types=["image/tiff", "image/x-tiff"],
            extensions=[".tif", ".tiff"],
            risk_level="low",
            is_open_format=True,
        ),
        FormatRegistryEntry(
            pronom_puid="fmt/44",
            name="JPEG 1.02",
            mime_types=["image/jpeg"],
            extensions=[".jpg", ".jpeg"],
            risk_level="low",
            is_open_format=True,
        ),
        FormatRegistryEntry(
            pronom_puid="fmt/5",
            name="AVI",
            mime_types=["video/x-msvideo"],
            extensions=[".avi"],
            risk_level="high",
            is_open_format=False,
        ),
    ]
    for e in entries:
        session.add(e)
    session.commit()


class TestFormatRegistryEntry:
    def test_create_entry(self, db_session):
        entry = FormatRegistryEntry(
            pronom_puid="fmt/353",
            name="TIFF 6.0",
            version="6.0",
            mime_types=["image/tiff", "image/x-tiff"],
            extensions=[".tif", ".tiff"],
            risk_level="low",
            is_open_format=True,
        )
        db_session.add(entry)
        db_session.commit()

        fetched = db_session.query(FormatRegistryEntry).filter_by(
            pronom_puid="fmt/353"
        ).first()
        assert fetched is not None
        assert fetched.name == "TIFF 6.0"
        assert fetched.risk_level == "low"
        assert fetched.is_open_format is True

    def test_unique_pronom_puid(self, db_session):
        entry1 = FormatRegistryEntry(
            pronom_puid="fmt/44",
            name="JPEG 1.02",
            risk_level="low",
        )
        db_session.add(entry1)
        db_session.commit()

        entry2 = FormatRegistryEntry(
            pronom_puid="fmt/44",
            name="Duplicate",
            risk_level="low",
        )
        db_session.add(entry2)
        with pytest.raises(Exception):
            db_session.commit()
        db_session.rollback()


class TestIdentifyFormat:
    def test_match_by_mime_type(self, db_session):
        _seed_registry(db_session)
        from app.services.format_identification import identify_format_by_mime

        result = identify_format_by_mime("image/tiff", "photo.tif", db_session)
        assert result.pronom_puid == "fmt/353"
        assert result.format_name == "TIFF 6.0"
        assert result.risk_level == "low"
        assert result.matched_by == "mime_type"

    def test_fallback_to_extension(self, db_session):
        _seed_registry(db_session)
        from app.services.format_identification import identify_format_by_mime

        result = identify_format_by_mime("application/octet-stream", "video.avi", db_session)
        assert result.pronom_puid == "fmt/5"
        assert result.matched_by == "extension"

    def test_no_match(self, db_session):
        _seed_registry(db_session)
        from app.services.format_identification import identify_format_by_mime

        result = identify_format_by_mime("application/unknown", "file.xyz", db_session)
        assert result.pronom_puid is None
        assert result.matched_by == "none"

    def test_no_input(self, db_session):
        from app.services.format_identification import identify_format_by_mime

        result = identify_format_by_mime(None, None, db_session)
        assert result.pronom_puid is None
        assert result.matched_by == "none"


class TestBackfillFormats:
    def test_backfill_sets_pronom_fields(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id

        db_session.add(FormatRegistryEntry(
            pronom_puid="fmt/44",
            name="JPEG 1.02",
            mime_types=["image/jpeg"],
            extensions=[".jpg"],
            risk_level="low",
            is_open_format=True,
        ))

        media = Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/test.jpg",
            filename="test.jpg",
            file_size=1024,
            mime_type="image/jpeg",
            media_type="image",
            processing_status="completed",
        )
        db_session.add(media)
        db_session.commit()

        from app.services.format_identification import backfill_media_formats

        result = backfill_media_formats(db_session, batch_size=100)
        db_session.commit()

        assert result["identified"] == 1
        assert result["skipped"] == 0

        refreshed = db_session.query(Media).filter_by(media_id=media.media_id).first()
        assert refreshed.pronom_puid == "fmt/44"
        assert refreshed.format_name == "JPEG 1.02"
        assert refreshed.format_risk_level == "low"


class TestFormatRiskSummary:
    def test_returns_grouped_counts(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id

        for i in range(3):
            db_session.add(Media(
                organization_id=org_id,
                s3_key=f"orgs/{org_id}/img_{i}.jpg",
                filename=f"img_{i}.jpg",
                file_size=1024,
                mime_type="image/jpeg",
                media_type="image",
                processing_status="completed",
                pronom_puid="fmt/44",
                format_name="JPEG 1.02",
                format_risk_level="low",
            ))
        db_session.add(Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/legacy.avi",
            filename="legacy.avi",
            file_size=2048,
            mime_type="video/x-msvideo",
            media_type="video",
            processing_status="completed",
            pronom_puid="fmt/5",
            format_name="AVI",
            format_risk_level="high",
        ))
        db_session.commit()

        from app.services.format_identification import get_format_risk_summary

        summary = get_format_risk_summary(org_id, db_session)
        assert len(summary) == 2

        low_items = [s for s in summary if s["risk_level"] == "low"]
        assert len(low_items) == 1
        assert low_items[0]["count"] == 3

        high_items = [s for s in summary if s["risk_level"] == "high"]
        assert len(high_items) == 1
        assert high_items[0]["count"] == 1
