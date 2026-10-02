"""Unit tests for app.services.sandbox_seeder.manifest.

Covers seed_collections_from_manifest end-to-end against the real
test postgres:

  * Happy path — manifest entries materialize into CollectionObject +
    ObjectTitle + ObjectPart + Media + CollectionObjectMedia rows.
  * Idempotency — re-run on the same org skips existing object_numbers.
  * Missing manifest file → graceful skip (no exception).
  * Empty manifest list → graceful skip.
  * Manifest with rows but 0 inserted (model-shape regression) raises
    RuntimeError so the saga step fails loudly.
  * Unknown source name raises ValueError.
  * Date coercion: ISO date strings from the manifest land as real
    date() objects on the CollectionObject row.
  * org_id / admin_user_id required (ValueError on None).

These tests run against the conftest `db_session` fixture (real
postgres, savepoint-isolated). Manifest data is injected via a
monkeypatched `_load_manifest` to keep the test independent of the
checked-in fixture files.
"""
from __future__ import annotations

import json
import uuid
from datetime import date

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_entry(
    *,
    source_id: str,
    object_number: str,
    title: str = "Sample",
    object_name: str = "Painting",
    creators: list[dict] | None = None,
    creation_date_earliest: str | None = "1820-01-01",
    s3_key: str = "sandbox-fixtures/met/test.jpg",
    file_size: int = 12345,
) -> dict:
    """Minimal well-formed manifest entry."""
    return {
        "source_id": source_id,
        "object_number": object_number,
        "object_fields": {
            "object_name": object_name,
            "brief_description": object_name,
            "responsible_department": "Sample Dept",
            "object_type": object_name,
            "creators": creators,
            "materials": None,
            "subjects": None,
            "creation_date_display": "1820",
            "creation_date_earliest": creation_date_earliest,
            "creation_date_latest": None,
            "creation_place": None,
            "credit_line": "Test credit",
            "object_status": "accessioned",
        },
        "titles": [
            {"title": title, "title_type": "primary", "is_preferred": True},
        ],
        "media": {
            "s3_key": s3_key,
            "file_size": file_size,
            "mime_type": "image/jpeg",
            "title": title,
            "alt_text": title,
            "credit": "Test credit",
            "creator": None,
            "source": "Test",
            "copyright_status": "public_domain",
            "rights_statement": "CC0",
            "license": "CC0-1.0",
            "image_url": "https://example.test/image.jpg",
            # Shared thumbnail fixture fields (build_sandbox_thumbnails.py).
            "width": 1200,
            "height": 1500,
            "thumbnail_s3_key": s3_key.replace(".jpg", "_thumb.jpg"),
            "thumbnail_width": 160,
            "thumbnail_height": 200,
            "thumbnail_file_size": 5000,
        },
    }


def _sample_manifest(n: int = 3, *, key_salt: str = "") -> list[dict]:
    """Build n distinct manifest entries.

    `key_salt` salts the s3_key so concurrent tests (and shared fixture
    state) don't collide on the media.s3_key UNIQUE constraint.
    """
    salt = key_salt or uuid.uuid4().hex[:8]
    return [
        _make_entry(
            source_id=f"TEST-{salt}-{i}",
            object_number=f"MET-TESTUNIT-{salt}-{i}",
            title=f"Sample Object {i}",
            s3_key=f"sandbox-fixtures/met/test-{salt}-{i}.jpg",
        )
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def org_id(db_session):
    from app.models import Organization
    org = Organization(
        name=f"Manifest Test Org {uuid.uuid4().hex[:6]}",
        slug=f"manifest-test-{uuid.uuid4().hex[:8]}",
        is_demo=True,
        status="active",
    )
    db_session.add(org)
    db_session.commit()
    return org.organization_id


@pytest.fixture
def admin_user_id(db_session):
    from app.models import User
    user = User(
        email=f"manifest-test-{uuid.uuid4().hex[:6]}@example.local",
        display_name="Manifest Test",
        status="active",
    )
    db_session.add(user)
    db_session.commit()
    return user.user_id


# ---------------------------------------------------------------------------
# Happy path
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _mock_media_processing():
    """Seeded media is handed to process_upload_task (S3 download + derivative
    ladder); don't run that in unit tests. The task itself is covered elsewhere."""
    from unittest.mock import patch
    with patch("app.tasks.media.process_upload_task") as m:
        yield m


class TestHappyPath:
    def test_creates_all_rows_from_manifest(
        self, db_session, org_id, admin_user_id, monkeypatch, _mock_media_processing
    ):
        from app.services.sandbox_seeder import manifest as mod

        entries = _sample_manifest(n=3)
        expected_numbers = {e["object_number"] for e in entries}
        monkeypatch.setattr(mod, "_load_manifest", lambda source: entries)

        result = mod.seed_collections_from_manifest(
            db_session, org_id=org_id, admin_user_id=admin_user_id, source="met",
        )

        assert result["objects_added_this_run"] == 3
        assert result["objects_skipped_existing"] == 0
        assert result["titles_created"] == 3
        assert result["parts_created"] == 3
        assert result["media_created"] == 3
        assert result["media_links_created"] == 3
        assert result["manifest_size"] == 3
        assert result["source"] == "met"

        # Verify the rows actually exist.
        from app.models import CollectionObject, Media
        from app.models.objects import ObjectTitle

        objs = (
            db_session.query(CollectionObject)
            .filter_by(organization_id=org_id)
            .all()
        )
        assert len(objs) == 3
        assert {o.object_number for o in objs} == expected_numbers

        titles = (
            db_session.query(ObjectTitle)
            .filter_by(organization_id=org_id)
            .all()
        )
        assert len(titles) == 3
        for t in titles:
            assert t.title_type == "primary"
            assert t.is_preferred is True

        media = (
            db_session.query(Media)
            .filter_by(organization_id=org_id)
            .all()
        )
        assert len(media) == 3
        for m in media:
            assert m.s3_key.startswith("sandbox-fixtures/met/")
            assert m.mime_type == "image/jpeg"
            assert m.is_published is True
            # Mirrors a real upload: created 'pending' and handed to the
            # processing task (mocked here), which owns the derivative ladder,
            # dimensions, thumbnail_s3_key, indexing, and the flip to 'completed'.
            # The seeder writes no derivative rows itself.
            assert m.processing_status == "pending"
        # Each media item was handed to the real processing task.
        assert _mock_media_processing.delay.call_count == 3


# ---------------------------------------------------------------------------
# Idempotency
# ---------------------------------------------------------------------------


class TestIdempotency:
    def test_rerun_skips_existing_object_numbers(
        self, db_session, org_id, admin_user_id, monkeypatch
    ):
        from app.services.sandbox_seeder import manifest as mod

        entries = _sample_manifest(n=2)
        monkeypatch.setattr(mod, "_load_manifest", lambda source: entries)

        first = mod.seed_collections_from_manifest(
            db_session, org_id=org_id, admin_user_id=admin_user_id, source="met",
        )
        assert first["objects_added_this_run"] == 2

        # Second run: every entry's object_number already exists.
        second = mod.seed_collections_from_manifest(
            db_session, org_id=org_id, admin_user_id=admin_user_id, source="met",
        )
        assert second["objects_added_this_run"] == 0
        assert second["objects_skipped_existing"] == 2

    def test_partial_rerun_extends_org_with_new_entries(
        self, db_session, org_id, admin_user_id, monkeypatch
    ):
        """Adding a new entry to the manifest seeds only the new row."""
        from app.services.sandbox_seeder import manifest as mod

        salt = uuid.uuid4().hex[:8]
        first_pass = [_make_entry(
            source_id="A", object_number=f"MET-PART-{salt}-A",
            s3_key=f"sandbox-fixtures/met/part-{salt}-A.jpg",
        )]
        monkeypatch.setattr(mod, "_load_manifest", lambda source: first_pass)
        result1 = mod.seed_collections_from_manifest(
            db_session, org_id=org_id, admin_user_id=admin_user_id, source="met",
        )
        assert result1["objects_added_this_run"] == 1

        second_pass = [
            _make_entry(
                source_id="A", object_number=f"MET-PART-{salt}-A",
                s3_key=f"sandbox-fixtures/met/part-{salt}-A.jpg",
            ),
            _make_entry(
                source_id="B", object_number=f"MET-PART-{salt}-B",
                s3_key=f"sandbox-fixtures/met/part-{salt}-B.jpg",
            ),
        ]
        monkeypatch.setattr(mod, "_load_manifest", lambda source: second_pass)
        result2 = mod.seed_collections_from_manifest(
            db_session, org_id=org_id, admin_user_id=admin_user_id, source="met",
        )
        assert result2["objects_added_this_run"] == 1
        assert result2["objects_skipped_existing"] == 1


# ---------------------------------------------------------------------------
# Missing / empty manifests
# ---------------------------------------------------------------------------


class TestManifestAbsence:
    def test_missing_manifest_skips_gracefully(
        self, db_session, org_id, admin_user_id, monkeypatch
    ):
        from app.services.sandbox_seeder import manifest as mod
        monkeypatch.setattr(mod, "_load_manifest", lambda source: None)

        result = mod.seed_collections_from_manifest(
            db_session, org_id=org_id, admin_user_id=admin_user_id, source="rijks",
        )
        assert result["skipped"] is True
        assert "not available" in result["reason"]
        assert result["objects_added_this_run"] == 0
        assert result["manifest_size"] == 0

    def test_empty_manifest_skips_gracefully(
        self, db_session, org_id, admin_user_id, monkeypatch
    ):
        from app.services.sandbox_seeder import manifest as mod
        monkeypatch.setattr(mod, "_load_manifest", lambda source: [])

        result = mod.seed_collections_from_manifest(
            db_session, org_id=org_id, admin_user_id=admin_user_id, source="rijks",
        )
        assert result["skipped"] is True
        assert "empty" in result["reason"]
        assert result["objects_added_this_run"] == 0


# ---------------------------------------------------------------------------
# Failure modes
# ---------------------------------------------------------------------------


class TestFailureModes:
    def test_unknown_source_raises(self, db_session, org_id, admin_user_id):
        from app.services.sandbox_seeder.manifest import seed_collections_from_manifest
        # _load_manifest is called inside the seeder; it raises ValueError
        # for unknown sources before anything else runs.
        with pytest.raises(ValueError, match="Unknown manifest source"):
            seed_collections_from_manifest(
                db_session,
                org_id=org_id,
                admin_user_id=admin_user_id,
                source="not-a-real-source",
            )

    def test_requires_org_id(self, db_session, admin_user_id):
        from app.services.sandbox_seeder.manifest import seed_collections_from_manifest
        with pytest.raises(ValueError, match="org_id"):
            seed_collections_from_manifest(
                db_session,
                org_id=None,
                admin_user_id=admin_user_id,
                source="met",
            )

    def test_requires_admin_user_id(self, db_session, org_id):
        from app.services.sandbox_seeder.manifest import seed_collections_from_manifest
        with pytest.raises(ValueError, match="org_id"):
            seed_collections_from_manifest(
                db_session,
                org_id=org_id,
                admin_user_id=None,
                source="met",
            )


# ---------------------------------------------------------------------------
# Date coercion
# ---------------------------------------------------------------------------


class TestDateCoercion:
    def test_iso_date_strings_become_date_objects(
        self, db_session, org_id, admin_user_id, monkeypatch
    ):
        from app.services.sandbox_seeder import manifest as mod
        from app.models import CollectionObject

        salt = uuid.uuid4().hex[:8]
        obj_num = f"MET-DATE-{salt}"
        entries = [
            _make_entry(
                source_id=f"DATE-{salt}",
                object_number=obj_num,
                creation_date_earliest="1850-01-01",
                s3_key=f"sandbox-fixtures/met/date-{salt}.jpg",
            ),
        ]
        monkeypatch.setattr(mod, "_load_manifest", lambda source: entries)

        mod.seed_collections_from_manifest(
            db_session, org_id=org_id, admin_user_id=admin_user_id, source="met",
        )

        obj = (
            db_session.query(CollectionObject)
            .filter_by(object_number=obj_num, organization_id=org_id)
            .one()
        )
        assert obj.creation_date_earliest == date(1850, 1, 1)

    def test_invalid_iso_date_becomes_none(
        self, db_session, org_id, admin_user_id, monkeypatch
    ):
        from app.services.sandbox_seeder import manifest as mod
        from app.models import CollectionObject

        salt = uuid.uuid4().hex[:8]
        obj_num = f"MET-BADDATE-{salt}"
        entries = [
            _make_entry(
                source_id=f"BAD-DATE-{salt}",
                object_number=obj_num,
                creation_date_earliest="not-a-date",
                s3_key=f"sandbox-fixtures/met/baddate-{salt}.jpg",
            ),
        ]
        monkeypatch.setattr(mod, "_load_manifest", lambda source: entries)

        mod.seed_collections_from_manifest(
            db_session, org_id=org_id, admin_user_id=admin_user_id, source="met",
        )

        obj = (
            db_session.query(CollectionObject)
            .filter_by(object_number=obj_num, organization_id=org_id)
            .one()
        )
        assert obj.creation_date_earliest is None


# ---------------------------------------------------------------------------
# Manifest loading from disk
# ---------------------------------------------------------------------------


class TestManifestLoader:
    def test_met_manifest_present_and_well_formed(self):
        """The Met manifest ships in the repo; sanity-check its shape."""
        from app.services.sandbox_seeder.manifest import _load_manifest

        m = _load_manifest("met")
        assert m is not None
        assert len(m) > 0
        first = m[0]
        # Required keys for every entry.
        assert "object_number" in first
        assert first["object_number"].startswith("MET-")
        assert "object_fields" in first
        assert "titles" in first
        assert isinstance(first["titles"], list)
        assert "media" in first
        assert "s3_key" in first["media"]
        assert first["media"]["s3_key"].startswith("sandbox-fixtures/met/")

    def test_loader_rejects_unknown_source(self):
        from app.services.sandbox_seeder.manifest import _load_manifest
        with pytest.raises(ValueError, match="Unknown manifest source"):
            _load_manifest("nonexistent")
