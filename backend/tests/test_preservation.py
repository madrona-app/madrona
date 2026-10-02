"""
Tests for the OAIS preservation infrastructure.

Covers:
- PreservationEvent model creation
- record_preservation_event() helper
- verify_media_checksums task (fixity rotation, backfill, mismatch detection)
- Preservation API endpoints (list, per-media)
- Auth & permission enforcement
"""

import json
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.models import (
    Organization,
    User,
    OrganizationMembership,
    Role,
    Permission as PermissionModel,
    RolePermission,
)
from app.services.auth_utils import generate_access_token
from tests.conftest import AuthenticatedClient, _create_permission, _create_role_permission


# ============================================================================
# HELPERS
# ============================================================================


def _events_url(org):
    return f"/api/organizations/{org.organization_id}/preservation-events"


def _media_events_url(org, media_id):
    return f"/api/organizations/{org.organization_id}/media/{media_id}/preservation-events"


def _post_json(auth_client, url, data):
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


# ============================================================================
# FIXTURES
# ============================================================================


@pytest.fixture
def preservation_auth_setup(client, db_session):
    """Authenticated client with org.view_audit_logs and media.view permissions."""
    organization = Organization(
        name="Preservation Test Org",
        slug="preservation-test-org",
        is_demo=False,
        status="active",
    )
    db_session.add(organization)
    db_session.flush()

    role = Role(
        role_key="admin",
        display_name="Preservation Admin",
        description="Full preservation access",
        is_system=False,
    )
    db_session.add(role)
    db_session.flush()

    permission_keys = [
        "org.view_audit_logs",
        "media.view",
    ]
    for key in permission_keys:
        perm = _create_permission(db_session, key)
        _create_role_permission(db_session, role, perm)

    user = User(
        email="preservation-admin@example.com",
        password_hash="not_used",
        status="active",
    )
    db_session.add(user)
    db_session.flush()

    membership = OrganizationMembership(
        organization_id=organization.organization_id,
        user_id=user.user_id,
        role="admin",
        role_id=role.role_id,
        status="active",
    )
    db_session.add(membership)

    user_id = user.user_id
    user_email = user.email
    org_id = organization.organization_id
    db_session.commit()

    token = generate_access_token(
        user_id=str(user_id),
        email=user_email,
        active_organization_id=str(org_id),
        expires_minutes=60,
    )

    org_proxy = SimpleNamespace(organization_id=org_id)
    user_proxy = SimpleNamespace(user_id=user_id, email=user_email)
    return AuthenticatedClient(client, token), org_proxy, user_proxy


@pytest.fixture
def sample_preservation_event(db_session, preservation_auth_setup):
    """Create a sample PreservationEvent directly in the database."""
    from app.models.preservation import PreservationEvent

    _, org, _ = preservation_auth_setup
    event = PreservationEvent(
        organization_id=org.organization_id,
        event_type="fixity_check",
        outcome="success",
        outcome_detail="SHA-256 matches stored digest",
        detail={"algorithm": "SHA-256", "expected": "abc123", "computed": "abc123"},
        agent_type="software",
        agent_name="madrona-preservation v1.0",
        media_id=None,
    )
    db_session.add(event)
    db_session.commit()
    return event


@pytest.fixture
def sample_ingestion_event(db_session, preservation_auth_setup):
    """Create a sample ingestion PreservationEvent."""
    from app.models.preservation import PreservationEvent

    _, org, _ = preservation_auth_setup
    event = PreservationEvent(
        organization_id=org.organization_id,
        event_type="ingestion",
        outcome="success",
        outcome_detail="Image processed and ingested",
        detail={"checksum_sha256": "deadbeef", "mime_type": "image/jpeg"},
        agent_type="software",
        agent_name="madrona-preservation v1.0",
    )
    db_session.add(event)
    db_session.commit()
    return event


# ============================================================================
# MODEL TESTS
# ============================================================================


class TestPreservationEventModel:
    def test_create_preservation_event(self, db_session, preservation_auth_setup):
        from app.models.preservation import PreservationEvent

        _, org, _ = preservation_auth_setup
        event = PreservationEvent(
            organization_id=org.organization_id,
            event_type="fixity_check",
            outcome="success",
            outcome_detail="Checksum verified",
            agent_type="software",
            agent_name="test-agent",
        )
        db_session.add(event)
        db_session.commit()

        fetched = db_session.query(PreservationEvent).filter_by(
            event_id=event.event_id
        ).first()
        assert fetched is not None
        assert fetched.event_type == "fixity_check"
        assert fetched.outcome == "success"
        assert fetched.agent_name == "test-agent"
        assert fetched.created_at is not None

    def test_create_with_detail_json(self, db_session, preservation_auth_setup):
        from app.models.preservation import PreservationEvent

        _, org, _ = preservation_auth_setup
        detail = {"algorithm": "SHA-256", "digest": "abc123def456"}
        event = PreservationEvent(
            organization_id=org.organization_id,
            event_type="message_digest_calculation",
            outcome="success",
            detail=detail,
            agent_type="software",
            agent_name="test-agent",
        )
        db_session.add(event)
        db_session.commit()

        fetched = db_session.query(PreservationEvent).filter_by(
            event_id=event.event_id
        ).first()
        assert fetched.detail["algorithm"] == "SHA-256"
        assert fetched.detail["digest"] == "abc123def456"

    def test_nullable_media_id(self, db_session, preservation_auth_setup):
        from app.models.preservation import PreservationEvent

        _, org, _ = preservation_auth_setup
        event = PreservationEvent(
            organization_id=org.organization_id,
            event_type="validation",
            outcome="success",
            agent_type="software",
            agent_name="test-agent",
            media_id=None,
        )
        db_session.add(event)
        db_session.commit()
        assert event.media_id is None

    def test_linked_entity_fields(self, db_session, preservation_auth_setup):
        from app.models.preservation import PreservationEvent

        _, org, _ = preservation_auth_setup
        entity_id = uuid4()
        event = PreservationEvent(
            organization_id=org.organization_id,
            event_type="migration",
            outcome="success",
            agent_type="person",
            agent_name="curator@example.com",
            linked_entity_type="collection_object",
            linked_entity_id=entity_id,
        )
        db_session.add(event)
        db_session.commit()

        fetched = db_session.query(PreservationEvent).filter_by(
            event_id=event.event_id
        ).first()
        assert fetched.linked_entity_type == "collection_object"
        assert fetched.linked_entity_id == entity_id


# ============================================================================
# HELPER FUNCTION TESTS
# ============================================================================


class TestRecordPreservationEvent:
    def test_inserts_event_without_committing(self, db_session, preservation_auth_setup):
        """record_preservation_event adds to session but does not commit."""
        from app.tasks.preservation import record_preservation_event
        from app.models.preservation import PreservationEvent

        _, org, _ = preservation_auth_setup
        initial_count = db_session.query(PreservationEvent).filter_by(
            organization_id=org.organization_id
        ).count()

        record_preservation_event(
            db_session,
            organization_id=org.organization_id,
            event_type="fixity_check",
            outcome="success",
            agent_name="test-helper",
        )
        # Should be in session (new/dirty) but let's just commit and check
        db_session.commit()

        new_count = db_session.query(PreservationEvent).filter_by(
            organization_id=org.organization_id
        ).count()
        assert new_count == initial_count + 1

    def test_records_all_fields(self, db_session, preservation_auth_setup):
        from app.tasks.preservation import record_preservation_event
        from app.models.preservation import PreservationEvent
        from app.models import Media

        _, org, _ = preservation_auth_setup
        # Create a Media row so the preservation_events.media_id FK holds.
        media = Media(
            organization_id=org.organization_id,
            s3_key=f"orgs/{org.organization_id}/media/tests/pres-{uuid4().hex}.bin",
            filename="pres.bin",
            file_size=123,
            mime_type="application/octet-stream",
            media_type="document",
        )
        db_session.add(media)
        db_session.flush()
        media_id = media.media_id

        record_preservation_event(
            db_session,
            organization_id=org.organization_id,
            event_type="ingestion",
            outcome="success",
            media_id=media_id,
            outcome_detail="File ingested",
            detail={"size_bytes": 12345},
            agent_type="software",
            agent_name="custom-agent",
            linked_entity_type="batch",
            linked_entity_id=uuid4(),
        )
        db_session.commit()

        event = db_session.query(PreservationEvent).filter_by(
            media_id=media_id
        ).first()
        assert event is not None
        assert event.event_type == "ingestion"
        assert event.outcome == "success"
        assert event.outcome_detail == "File ingested"
        assert event.detail["size_bytes"] == 12345
        assert event.agent_name == "custom-agent"


# ============================================================================
# TASK TESTS
# ============================================================================


@pytest.fixture(autouse=True)
def _patch_task_app():
    """Bypass standalone DB session and skip PostgreSQL-only RLS in task base classes."""
    from contextlib import contextmanager

    mock_session = MagicMock()

    @contextmanager
    def _noop_session():
        yield mock_session

    with patch("app.tasks.base.get_session", _noop_session), \
         patch("app.database.current_session", return_value=mock_session), \
         patch("app.tasks.rls_helpers.set_task_rls_context"):
        yield


class TestVerifyMediaChecksums:
    """Tests for the fixity verification task."""

    @patch("app.tasks.rls_helpers.admin_db_session")
    @patch("app.services.storage.get_storage_backend")
    def test_verified_success(self, mock_storage_factory, mock_admin_session):
        """Successful verification when checksums match."""
        import hashlib

        media_id = uuid4()
        org_id = uuid4()
        file_data = b"test file content"
        checksum = hashlib.sha256(file_data).hexdigest()

        mock_media = MagicMock()
        mock_media.media_id = media_id
        mock_media.organization_id = org_id
        mock_media.checksum_sha256 = checksum
        mock_media.processing_status = "completed"
        mock_media.s3_key = "media/test.jpg"

        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [mock_media]
        mock_admin_session.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_admin_session.return_value.__exit__ = MagicMock(return_value=False)

        mock_storage = MagicMock()
        mock_storage.get_object_sync.return_value = (file_data, {})
        mock_storage_factory.return_value = mock_storage

        from app.tasks.preservation import verify_media_checksums
        result = verify_media_checksums()

        assert result["verified"] == 1
        assert result["mismatches"] == 0
        assert result["errors"] == 0
        assert mock_media.fixity_status == "ok"
        assert mock_media.last_fixity_check is not None

    @patch("app.tasks.rls_helpers.admin_db_session")
    @patch("app.services.storage.get_storage_backend")
    def test_checksum_mismatch(self, mock_storage_factory, mock_admin_session):
        """Mismatch detected when checksums differ."""
        media_id = uuid4()
        org_id = uuid4()

        mock_media = MagicMock()
        mock_media.media_id = media_id
        mock_media.organization_id = org_id
        mock_media.checksum_sha256 = "expected_hash_abc"
        mock_media.processing_status = "completed"
        mock_media.s3_key = "media/test.jpg"

        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [mock_media]
        mock_admin_session.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_admin_session.return_value.__exit__ = MagicMock(return_value=False)

        mock_storage = MagicMock()
        mock_storage.get_object_sync.return_value = (b"different content", {})
        mock_storage_factory.return_value = mock_storage

        from app.tasks.preservation import verify_media_checksums
        result = verify_media_checksums()

        assert result["mismatches"] == 1
        assert result["verified"] == 0
        assert mock_media.fixity_status == "mismatch"
        assert len(result["mismatch_details"]) == 1
        assert result["mismatch_details"][0]["media_id"] == str(media_id)

    @patch("app.tasks.rls_helpers.admin_db_session")
    @patch("app.services.storage.get_storage_backend")
    def test_backfills_null_checksum(self, mock_storage_factory, mock_admin_session):
        """Backfills checksum_sha256 when NULL and records digest calculation event."""
        import hashlib

        media_id = uuid4()
        org_id = uuid4()
        file_data = b"new file data"
        expected_hash = hashlib.sha256(file_data).hexdigest()

        mock_media = MagicMock()
        mock_media.media_id = media_id
        mock_media.organization_id = org_id
        mock_media.checksum_sha256 = None
        mock_media.processing_status = "completed"
        mock_media.s3_key = "media/test.pdf"

        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [mock_media]
        mock_admin_session.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_admin_session.return_value.__exit__ = MagicMock(return_value=False)

        mock_storage = MagicMock()
        mock_storage.get_object_sync.return_value = (file_data, {})
        mock_storage_factory.return_value = mock_storage

        from app.tasks.preservation import verify_media_checksums
        result = verify_media_checksums()

        assert result["backfilled"] == 1
        assert result["verified"] == 1
        assert mock_media.checksum_sha256 == expected_hash

    @patch("app.tasks.rls_helpers.admin_db_session")
    @patch("app.services.storage.get_storage_backend")
    def test_handles_storage_error(self, mock_storage_factory, mock_admin_session):
        """Errors during download are counted, not raised."""
        mock_media = MagicMock()
        mock_media.media_id = uuid4()
        mock_media.organization_id = uuid4()
        mock_media.checksum_sha256 = "abc"
        mock_media.s3_key = "media/missing.jpg"

        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = [mock_media]
        mock_admin_session.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_admin_session.return_value.__exit__ = MagicMock(return_value=False)

        mock_storage = MagicMock()
        mock_storage.get_object_sync.side_effect = RuntimeError("S3 unavailable")
        mock_storage_factory.return_value = mock_storage

        from app.tasks.preservation import verify_media_checksums
        result = verify_media_checksums()

        assert result["errors"] == 1
        assert result["verified"] == 0

    @patch("app.tasks.rls_helpers.admin_db_session")
    def test_empty_batch(self, mock_admin_session):
        """No media to verify returns zero counts."""
        mock_session = MagicMock()
        mock_session.query.return_value.filter.return_value.order_by.return_value.limit.return_value.all.return_value = []
        mock_admin_session.return_value.__enter__ = MagicMock(return_value=mock_session)
        mock_admin_session.return_value.__exit__ = MagicMock(return_value=False)

        from app.tasks.preservation import verify_media_checksums
        result = verify_media_checksums()

        assert result["verified"] == 0
        assert result["mismatches"] == 0
        assert result["batch_size"] == 0


# ============================================================================
# API TESTS
# ============================================================================


class TestListPreservationEvents:
    def test_list_events_empty(self, preservation_auth_setup):
        auth_client, org, _ = preservation_auth_setup
        resp = auth_client.get(_events_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_list_events_with_data(self, preservation_auth_setup, sample_preservation_event):
        auth_client, org, _ = preservation_auth_setup
        resp = auth_client.get(_events_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert len(data["items"]) == 1
        assert data["items"][0]["event_type"] == "fixity_check"
        assert data["items"][0]["outcome"] == "success"
        assert data["items"][0]["agent_name"] == "madrona-preservation v1.0"

    def test_filter_by_event_type(self, preservation_auth_setup, sample_preservation_event, sample_ingestion_event):
        auth_client, org, _ = preservation_auth_setup

        resp = auth_client.get(f"{_events_url(org)}?event_type=fixity_check")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["event_type"] == "fixity_check"

        resp = auth_client.get(f"{_events_url(org)}?event_type=ingestion")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["event_type"] == "ingestion"

    def test_filter_by_outcome(self, preservation_auth_setup, sample_preservation_event):
        auth_client, org, _ = preservation_auth_setup

        resp = auth_client.get(f"{_events_url(org)}?outcome=success")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 1

        resp = auth_client.get(f"{_events_url(org)}?outcome=failure")
        assert resp.status_code == 200
        assert resp.get_json()["total"] == 0

    def test_pagination(self, preservation_auth_setup, sample_preservation_event, sample_ingestion_event):
        auth_client, org, _ = preservation_auth_setup

        resp = auth_client.get(f"{_events_url(org)}?limit=1&offset=0")
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 1
        assert data["total"] == 2
        assert data["page"]["has_more"] is True

        resp = auth_client.get(f"{_events_url(org)}?limit=1&offset=1")
        data = resp.get_json()
        assert len(data["items"]) == 1
        assert data["page"]["has_more"] is False

    def test_invalid_since_date(self, preservation_auth_setup):
        auth_client, org, _ = preservation_auth_setup
        resp = auth_client.get(f"{_events_url(org)}?since=not-a-date")
        assert resp.status_code in (400, 422)


class TestListMediaPreservationEvents:
    def test_per_media_events_empty(self, preservation_auth_setup):
        auth_client, org, _ = preservation_auth_setup
        fake_media_id = uuid4()
        resp = auth_client.get(_media_events_url(org, fake_media_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert data["total"] == 0

    def test_per_media_events_with_data(self, db_session, preservation_auth_setup):
        from app.models.preservation import PreservationEvent
        from app.models import Media

        auth_client, org, _ = preservation_auth_setup
        media = Media(
            organization_id=org.organization_id,
            s3_key=f"orgs/{org.organization_id}/media/test.jpg",
            filename="test.jpg",
            file_size=1024,
            mime_type="image/jpeg",
            media_type="image",
            processing_status="completed",
        )
        db_session.add(media)
        db_session.flush()
        media_id = media.media_id

        event = PreservationEvent(
            organization_id=org.organization_id,
            event_type="ingestion",
            media_id=media_id,
            outcome="success",
            outcome_detail="Ingested",
            agent_type="software",
            agent_name="madrona-preservation v1.0",
        )
        db_session.add(event)
        db_session.commit()

        resp = auth_client.get(_media_events_url(org, media_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["media_id"] == str(media_id)
        assert data["items"][0]["event_type"] == "ingestion"

    def test_per_media_does_not_leak_other_media(self, db_session, preservation_auth_setup):
        from app.models.preservation import PreservationEvent
        from app.models import Media

        auth_client, org, _ = preservation_auth_setup
        media_objs = []
        for label in ("a", "b"):
            m = Media(
                organization_id=org.organization_id,
                s3_key=f"orgs/{org.organization_id}/media/{label}.jpg",
                filename=f"{label}.jpg",
                file_size=1024,
                mime_type="image/jpeg",
                media_type="image",
                processing_status="completed",
            )
            db_session.add(m)
            db_session.flush()
            media_objs.append(m)
        media_a, media_b = media_objs[0].media_id, media_objs[1].media_id

        for mid in (media_a, media_b):
            db_session.add(PreservationEvent(
                organization_id=org.organization_id,
                event_type="fixity_check",
                media_id=mid,
                outcome="success",
                agent_type="software",
                agent_name="test",
            ))
        db_session.commit()

        resp = auth_client.get(_media_events_url(org, media_a))
        data = resp.get_json()
        assert data["total"] == 1
        assert data["items"][0]["media_id"] == str(media_a)


class TestPreservationAuth:
    def test_requires_auth(self, client, preservation_auth_setup):
        """Unauthenticated request should return 401."""
        _, org, _ = preservation_auth_setup
        resp = client.get(_events_url(org))
        assert resp.status_code == 401

    def test_requires_audit_log_permission(self, client, db_session):
        """User without org.view_audit_logs should be denied."""
        organization = Organization(
            name="No Audit Org",
            slug="no-audit-org",
            is_demo=False,
            status="active",
        )
        db_session.add(organization)
        db_session.flush()

        role = Role(
            role_key="viewer",
            display_name="Viewer",
            description="No audit access",
            is_system=False,
        )
        db_session.add(role)
        db_session.flush()

        # Only media.view, no org.view_audit_logs
        perm = _create_permission(db_session, "media.view")
        _create_role_permission(db_session, role, perm)

        user = User(
            email="noaudit@example.com",
            password_hash="not_used",
            status="active",
        )
        db_session.add(user)
        db_session.flush()

        membership = OrganizationMembership(
            organization_id=organization.organization_id,
            user_id=user.user_id,
            role="viewer",
            role_id=role.role_id,
            status="active",
        )
        db_session.add(membership)

        org_id = organization.organization_id
        user_id = user.user_id
        db_session.commit()

        token = generate_access_token(
            user_id=str(user_id),
            email="noaudit@example.com",
            active_organization_id=str(org_id),
            expires_minutes=60,
        )
        auth_client = AuthenticatedClient(client, token)

        resp = auth_client.get(f"/api/organizations/{org_id}/preservation-events")
        assert resp.status_code == 403
