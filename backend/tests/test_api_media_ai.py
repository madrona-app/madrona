"""
Smoke tests for the Media AI API (app/api/media_ai.py).

Covers AI tagging configuration, tag mappings, per-media AI tags,
bulk operations, and authentication/authorization.

All Celery tasks and search services are mocked so tests run against SQLite.
"""

import json
from decimal import Decimal
from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.database import current_session
from app.models import (
    Media,
    MediaAIConfig,
    MediaAITag,
    MediaAITagMapping,
    MediaTagDefinition,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _post_json(auth_client, url, data):
    """Helper for POST with JSON body."""
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    """Helper for PUT with JSON body."""
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")


def _patch_json(auth_client, url, data):
    """Helper for PATCH with JSON body."""
    return auth_client.patch(url, data=json.dumps(data), content_type="application/json")


def _config_url(org):
    return f"/api/organizations/{org.organization_id}/media/ai-config"


def _mappings_url(org):
    return f"/api/organizations/{org.organization_id}/media/ai-mappings"


def _mapping_url(org, mapping_id):
    return f"/api/organizations/{org.organization_id}/media/ai-mappings/{mapping_id}"


def _media_ai_tags_url(org, media_id):
    return f"/api/organizations/{org.organization_id}/media/{media_id}/ai-tags"


def _ai_tag_url(org, media_id, ai_tag_id):
    return f"/api/organizations/{org.organization_id}/media/{media_id}/ai-tags/{ai_tag_id}"


def _reprocess_url(org, media_id):
    return f"/api/organizations/{org.organization_id}/media/{media_id}/ai-tags/reprocess"


def _suggestions_url(org):
    return f"/api/organizations/{org.organization_id}/media/ai-tags/suggestions"


def _bulk_reprocess_url(org):
    return f"/api/organizations/{org.organization_id}/media/ai-tags/bulk-reprocess"


def _reapply_url(org):
    return f"/api/organizations/{org.organization_id}/media/ai-tags/reapply-mappings"


def _stats_url(org):
    return f"/api/organizations/{org.organization_id}/media/ai-tags/stats"


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def admin_auth(auth_setup, db_session):
    """Extend the standard auth_setup with media.admin permission."""
    from app.models import OrganizationMembership, RolePermission, Permission as PermissionModel

    auth_client, org, user = auth_setup

    # Find the role for this user's membership
    membership = db_session.query(OrganizationMembership).filter_by(
        user_id=user.user_id,
        organization_id=org.organization_id,
    ).first()

    # Create the media.admin permission and attach to the role
    perm = PermissionModel(
        permission_key="media.admin",
        scope="media",
        action="admin",
        display_name="Media Admin",
        description="Full media admin access",
    )
    db_session.add(perm)
    db_session.flush()

    rp = RolePermission(
        role_id=membership.role_id,
        permission_id=perm.permission_id,
    )
    db_session.add(rp)
    db_session.commit()

    return auth_client, org, user


@pytest.fixture
def sample_media(admin_auth, db_session):
    """Create a sample Media record in the test org."""
    _, org, _ = admin_auth
    media = Media(
        organization_id=org.organization_id,
        s3_key=f"orgs/{org.organization_id}/media/images/test_{uuid4()}.jpg",
        filename="test_image.jpg",
        file_size=1024,
        mime_type="image/jpeg",
        media_type="image",
        ai_processing_status="completed",
    )
    db_session.add(media)
    db_session.commit()
    return media


@pytest.fixture
def sample_tag_definition(admin_auth, db_session):
    """Create a MediaTagDefinition for mapping tests."""
    _, org, user = admin_auth
    defn = MediaTagDefinition(
        organization_id=org.organization_id,
        tag_key="subject",
        display_name="Subject",
        description="Subject classification",
        is_required=False,
        sort_order=0,
        is_active=True,
        created_by=user.user_id,
    )
    db_session.add(defn)
    db_session.commit()
    return defn


@pytest.fixture
def sample_ai_tag(sample_media, admin_auth, db_session):
    """Create a sample MediaAITag attached to sample_media."""
    _, org, _ = admin_auth
    ai_tag = MediaAITag(
        organization_id=org.organization_id,
        media_id=sample_media.media_id,
        tag_type="label",
        tag_value="Painting",
        confidence=Decimal("0.9500"),
        provider="rekognition",
        mapping_status="pending",
    )
    db_session.add(ai_tag)
    db_session.commit()
    return ai_tag


# ============================================================================
# AI Config - GET and PUT
# ============================================================================


class TestGetAIConfig:
    def test_get_config_returns_defaults(self, admin_auth):
        """GET returns default config when none exists."""
        auth_client, org, _ = admin_auth
        resp = auth_client.get(_config_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        config = data["config"]
        assert config["config_id"] is None
        assert config["auto_tag_on_upload"] is True
        assert config["detect_labels"] is True
        assert config["detect_faces"] is False

    def test_get_config_requires_auth(self, client, admin_auth):
        """Unauthenticated request returns 401."""
        _, org, _ = admin_auth
        resp = client.get(_config_url(org))
        assert resp.status_code == 401


class TestUpdateAIConfig:
    def test_update_creates_config(self, admin_auth):
        """PUT creates a new config if none exists."""
        auth_client, org, _ = admin_auth
        resp = _put_json(auth_client, _config_url(org), {
            "auto_tag_on_upload": False,
            "detect_faces": True,
            "min_label_confidence": "0.85",
        })
        assert resp.status_code == 200
        config = resp.get_json()["config"]
        assert config["auto_tag_on_upload"] is False
        assert config["detect_faces"] is True
        assert config["min_label_confidence"] == "0.85"
        assert config["config_id"] is not None

    def test_update_config_idempotent(self, admin_auth):
        """PUT updates an existing config."""
        auth_client, org, _ = admin_auth
        # Create
        _put_json(auth_client, _config_url(org), {"detect_labels": False})
        # Update
        resp = _put_json(auth_client, _config_url(org), {"detect_labels": True})
        assert resp.status_code == 200
        assert resp.get_json()["config"]["detect_labels"] is True


# ============================================================================
# AI Mappings - CRUD
# ============================================================================


class TestListAIMappings:
    def test_list_mappings_empty(self, admin_auth):
        """GET returns empty list when no mappings exist."""
        auth_client, org, _ = admin_auth
        resp = auth_client.get(_mappings_url(org))
        assert resp.status_code == 200
        assert resp.get_json()["mappings"] == []


class TestCreateAIMapping:
    def test_create_mapping(self, admin_auth, sample_tag_definition):
        """POST creates a new AI tag mapping."""
        auth_client, org, _ = admin_auth
        resp = _post_json(auth_client, _mappings_url(org), {
            "ai_tag_type": "label",
            "ai_tag_value": "Painting",
            "definition_id": str(sample_tag_definition.definition_id),
            "mapped_value": "painting",
        })
        assert resp.status_code == 201
        mapping = resp.get_json()["mapping"]
        assert mapping["ai_tag_type"] == "label"
        assert mapping["ai_tag_value"] == "Painting"
        assert mapping["mapped_value"] == "painting"
        assert mapping["auto_apply"] is True
        assert mapping["definition"] is not None
        assert mapping["definition"]["tag_key"] == "subject"

    def test_create_mapping_missing_field(self, admin_auth, sample_tag_definition):
        """POST without required field returns 400."""
        auth_client, org, _ = admin_auth
        resp = _post_json(auth_client, _mappings_url(org), {
            "ai_tag_type": "label",
            # Missing ai_tag_value, definition_id, mapped_value
        })
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Missing required field" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_create_mapping_invalid_type(self, admin_auth, sample_tag_definition):
        """POST with invalid tag type returns 400."""
        auth_client, org, _ = admin_auth
        resp = _post_json(auth_client, _mappings_url(org), {
            "ai_tag_type": "invalid_type",
            "ai_tag_value": "Painting",
            "definition_id": str(sample_tag_definition.definition_id),
            "mapped_value": "painting",
        })
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid tag type" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_create_mapping_definition_not_found(self, admin_auth):
        """POST with non-existent definition returns 404."""
        auth_client, org, _ = admin_auth
        resp = _post_json(auth_client, _mappings_url(org), {
            "ai_tag_type": "label",
            "ai_tag_value": "Painting",
            "definition_id": str(uuid4()),
            "mapped_value": "painting",
        })
        assert resp.status_code == 404
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Tag definition not found" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_create_mapping_duplicate(self, admin_auth, sample_tag_definition):
        """POST with duplicate mapping returns 409."""
        auth_client, org, _ = admin_auth
        payload = {
            "ai_tag_type": "label",
            "ai_tag_value": "Duplicate",
            "definition_id": str(sample_tag_definition.definition_id),
            "mapped_value": "duplicate",
        }
        resp1 = _post_json(auth_client, _mappings_url(org), payload)
        assert resp1.status_code == 201
        resp2 = _post_json(auth_client, _mappings_url(org), payload)
        assert resp2.status_code == 409
        _e = resp2.get_json().get("error") or resp2.get_json().get("detail", "")
        _msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e))
        assert "already exists" in _msg


class TestUpdateAIMapping:
    def test_update_mapping(self, admin_auth, sample_tag_definition):
        """PUT updates an existing mapping."""
        auth_client, org, _ = admin_auth
        # Create
        resp = _post_json(auth_client, _mappings_url(org), {
            "ai_tag_type": "label",
            "ai_tag_value": "Updatable",
            "definition_id": str(sample_tag_definition.definition_id),
            "mapped_value": "original",
        })
        mapping_id = resp.get_json()["mapping"]["mapping_id"]

        # Update
        resp = _put_json(auth_client, _mapping_url(org, mapping_id), {
            "mapped_value": "updated",
            "auto_apply": False,
        })
        assert resp.status_code == 200
        mapping = resp.get_json()["mapping"]
        assert mapping["mapped_value"] == "updated"
        assert mapping["auto_apply"] is False

    def test_update_mapping_not_found(self, admin_auth):
        """PUT on non-existent mapping returns 404."""
        auth_client, org, _ = admin_auth
        resp = _put_json(auth_client, _mapping_url(org, uuid4()), {
            "mapped_value": "nope",
        })
        assert resp.status_code == 404


class TestDeleteAIMapping:
    def test_delete_mapping(self, admin_auth, sample_tag_definition):
        """DELETE removes a mapping."""
        auth_client, org, _ = admin_auth
        resp = _post_json(auth_client, _mappings_url(org), {
            "ai_tag_type": "label",
            "ai_tag_value": "Deletable",
            "definition_id": str(sample_tag_definition.definition_id),
            "mapped_value": "deletable",
        })
        mapping_id = resp.get_json()["mapping"]["mapping_id"]

        resp = auth_client.delete(_mapping_url(org, mapping_id))
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

    def test_delete_mapping_not_found(self, admin_auth):
        """DELETE on non-existent mapping returns 404."""
        auth_client, org, _ = admin_auth
        resp = auth_client.delete(_mapping_url(org, uuid4()))
        assert resp.status_code == 404


# ============================================================================
# Per-Media AI Tags
# ============================================================================


class TestGetMediaAITags:
    def test_get_ai_tags_empty(self, admin_auth, sample_media):
        """GET returns empty tags for media with no AI tags."""
        auth_client, org, _ = admin_auth
        # Create a second media with no tags
        media2 = Media(
            organization_id=org.organization_id,
            s3_key=f"orgs/{org.organization_id}/media/images/empty_{uuid4()}.jpg",
            filename="empty.jpg",
            file_size=512,
            mime_type="image/jpeg",
            media_type="image",
        )
        current_session().add(media2)
        current_session().commit()

        resp = auth_client.get(_media_ai_tags_url(org, media2.media_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["ai_tags"] == []
        assert data["media_id"] == str(media2.media_id)

    def test_get_ai_tags_with_data(self, admin_auth, sample_media, sample_ai_tag):
        """GET returns AI tags for a media item."""
        auth_client, org, _ = admin_auth
        resp = auth_client.get(_media_ai_tags_url(org, sample_media.media_id))
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["ai_tags"]) == 1
        tag = data["ai_tags"][0]
        assert tag["tag_type"] == "label"
        assert tag["tag_value"] == "Painting"
        assert tag["mapping_status"] == "pending"

    def test_get_ai_tags_media_not_found(self, admin_auth):
        """GET with non-existent media returns 404."""
        auth_client, org, _ = admin_auth
        resp = auth_client.get(_media_ai_tags_url(org, uuid4()))
        assert resp.status_code == 404
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Media not found" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))


class TestUpdateAITagStatus:
    def test_update_ai_tag_status(self, admin_auth, sample_media, sample_ai_tag):
        """PATCH updates the mapping_status of an AI tag."""
        auth_client, org, _ = admin_auth
        resp = _patch_json(
            auth_client,
            _ai_tag_url(org, sample_media.media_id, sample_ai_tag.ai_tag_id),
            {"mapping_status": "rejected"},
        )
        assert resp.status_code == 200
        assert resp.get_json()["ai_tag"]["mapping_status"] == "rejected"

    def test_update_ai_tag_invalid_status(self, admin_auth, sample_media, sample_ai_tag):
        """PATCH with invalid status returns 400."""
        auth_client, org, _ = admin_auth
        resp = _patch_json(
            auth_client,
            _ai_tag_url(org, sample_media.media_id, sample_ai_tag.ai_tag_id),
            {"mapping_status": "bogus"},
        )
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid status" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_update_ai_tag_not_found(self, admin_auth, sample_media):
        """PATCH on non-existent AI tag returns 404."""
        auth_client, org, _ = admin_auth
        resp = _patch_json(
            auth_client,
            _ai_tag_url(org, sample_media.media_id, uuid4()),
            {"mapping_status": "rejected"},
        )
        assert resp.status_code == 404


class TestDeleteAITag:
    @patch("app.search.media.service.MediaSearchService")
    def test_delete_ai_tag(self, mock_search_cls, admin_auth, sample_media, sample_ai_tag):
        """DELETE removes an AI tag."""
        mock_search_cls.return_value.is_available.return_value = False
        auth_client, org, _ = admin_auth
        resp = auth_client.delete(
            _ai_tag_url(org, sample_media.media_id, sample_ai_tag.ai_tag_id)
        )
        assert resp.status_code == 200
        assert resp.get_json()["success"] is True

    def test_delete_ai_tag_not_found(self, admin_auth, sample_media):
        """DELETE on non-existent AI tag returns 404."""
        auth_client, org, _ = admin_auth
        resp = auth_client.delete(
            _ai_tag_url(org, sample_media.media_id, uuid4())
        )
        assert resp.status_code == 404


# ============================================================================
# Reprocess
# ============================================================================


class TestReprocessAITags:
    @patch("app.tasks.ai_tagging.process_media_ai_tags")
    def test_reprocess(self, mock_task, admin_auth, sample_media):
        """POST queues AI reprocessing for a media item."""
        mock_task.delay.return_value = MagicMock(id="task-123")
        auth_client, org, _ = admin_auth
        resp = _post_json(
            auth_client,
            _reprocess_url(org, sample_media.media_id),
            {},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["task_id"] == "task-123"
        mock_task.delay.assert_called_once()

    @patch("app.tasks.ai_tagging.process_media_ai_tags")
    def test_reprocess_media_not_found(self, mock_task, admin_auth):
        """POST on non-existent media returns 404."""
        auth_client, org, _ = admin_auth
        resp = _post_json(
            auth_client,
            _reprocess_url(org, uuid4()),
            {},
        )
        assert resp.status_code == 404


# ============================================================================
# Bulk Operations
# ============================================================================


class TestBulkReprocess:
    @patch("app.tasks.ai_tagging.bulk_process_ai_tags")
    def test_bulk_reprocess(self, mock_task, admin_auth):
        """POST queues bulk AI reprocessing."""
        mock_task.delay.return_value = MagicMock(id="bulk-task-456")
        auth_client, org, _ = admin_auth
        resp = _post_json(auth_client, _bulk_reprocess_url(org), {})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["task_id"] == "bulk-task-456"
        mock_task.delay.assert_called_once()


class TestReapplyMappings:
    @patch("app.tasks.ai_tagging.reapply_ai_tag_mappings")
    def test_reapply_mappings(self, mock_task, admin_auth):
        """POST queues mapping reapplication."""
        mock_task.delay.return_value = MagicMock(id="reapply-789")
        auth_client, org, _ = admin_auth
        resp = _post_json(auth_client, _reapply_url(org), {})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert data["task_id"] == "reapply-789"


# ============================================================================
# Stats
# ============================================================================


class TestGetAITaggingStats:
    def test_stats_empty(self, admin_auth):
        """GET returns zero stats when nothing exists."""
        auth_client, org, _ = admin_auth
        resp = auth_client.get(_stats_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total_media"] == 0
        assert data["total_ai_tags"] == 0
        assert data["unmapped_tags_count"] == 0

    def test_stats_with_data(self, admin_auth, sample_media, sample_ai_tag):
        """GET returns correct counts after data exists."""
        auth_client, org, _ = admin_auth
        resp = auth_client.get(_stats_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total_media"] >= 1
        assert data["total_ai_tags"] >= 1
        assert data["unmapped_tags_count"] >= 1  # sample_ai_tag is 'pending'


# ============================================================================
# Suggestions
# ============================================================================


class TestGetUnmappedSuggestions:
    @pytest.mark.postgres
    def test_suggestions_empty(self, admin_auth):
        """GET returns empty suggestions when no unmapped tags exist.

        Marked postgres because the endpoint uses array_agg which is not
        available in SQLite.
        """
        auth_client, org, _ = admin_auth
        resp = auth_client.get(_suggestions_url(org))
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["suggestions"] == []
        assert data["total"] == 0


# ============================================================================
# Authorization
# ============================================================================


class TestMediaAIAuth:
    def test_get_config_requires_auth(self, client, admin_auth):
        """GET ai-config without auth returns 401."""
        _, org, _ = admin_auth
        resp = client.get(_config_url(org))
        assert resp.status_code == 401

    def test_list_mappings_requires_auth(self, client, admin_auth):
        """GET ai-mappings without auth returns 401."""
        _, org, _ = admin_auth
        resp = client.get(_mappings_url(org))
        assert resp.status_code == 401

    def test_get_ai_tags_requires_auth(self, client, admin_auth, sample_media):
        """GET per-media ai-tags without auth returns 401."""
        _, org, _ = admin_auth
        resp = client.get(_media_ai_tags_url(org, sample_media.media_id))
        assert resp.status_code == 401

    def test_reprocess_requires_auth(self, client, admin_auth, sample_media):
        """POST reprocess without auth returns 401."""
        _, org, _ = admin_auth
        resp = client.post(
            _reprocess_url(org, sample_media.media_id),
            data=json.dumps({}),
            content_type="application/json",
        )
        assert resp.status_code == 401

    def test_stats_requires_auth(self, client, admin_auth):
        """GET stats without auth returns 401."""
        _, org, _ = admin_auth
        resp = client.get(_stats_url(org))
        assert resp.status_code == 401
