"""Tests for CLIP Celery tasks."""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest


@pytest.fixture
def mock_session():
    """Shared mock session used by the _patch_task_app fixture."""
    return MagicMock()


@pytest.fixture(autouse=True)
def _patch_task_app(mock_session):
    """Bypass standalone DB session and skip PostgreSQL-only RLS in task base classes."""
    from contextlib import contextmanager

    @contextmanager
    def _noop_session():
        yield mock_session

    with patch("app.tasks.base.get_session", _noop_session), \
         patch("app.database.current_session", return_value=mock_session), \
         patch("app.tasks.clip.current_session", return_value=mock_session), \
         patch("app.tasks.rls_helpers.set_task_rls_context"):
        yield


class TestGenerateClipEmbedding:
    """Tests for generate_clip_embedding task.

    generate_clip_embedding uses current_session() (FastAPI/standalone session
    accessor) rather than Flask-era app.db.db.session. The _patch_task_app
    fixture patches current_session to return the shared mock_session.
    """

    @patch("app.config.get_settings")
    def test_disabled_returns_early(self, mock_settings):
        mock_settings.return_value = MagicMock(clip_enabled=False)

        from app.tasks.clip import generate_clip_embedding
        result = generate_clip_embedding(str(uuid4()), str(uuid4()))
        assert result["success"] is False
        assert "not enabled" in result["reason"].lower()

    @patch("app.config.get_settings")
    def test_media_not_found(self, mock_settings, mock_session):
        mock_settings.return_value = MagicMock(clip_enabled=True)
        mock_session.query.return_value.filter_by.return_value.first.return_value = None

        from app.tasks.clip import generate_clip_embedding
        result = generate_clip_embedding(str(uuid4()), str(uuid4()))
        assert result["success"] is False
        assert "not found" in result.get("error", "").lower()

    @patch("app.config.get_settings")
    def test_non_image_skipped(self, mock_settings, mock_session):
        mock_settings.return_value = MagicMock(clip_enabled=True)

        mock_media = MagicMock()
        mock_media.media_type = "video"
        mock_session.query.return_value.filter_by.return_value.first.return_value = mock_media

        from app.tasks.clip import generate_clip_embedding
        result = generate_clip_embedding(str(uuid4()), str(uuid4()))
        assert result["success"] is False
        assert "not an image" in result["reason"].lower()


class TestBulkGenerateEmbeddings:
    """Tests for bulk_generate_embeddings task.

    bulk_generate_embeddings uses current_session() (FastAPI/standalone session
    accessor). The _patch_task_app fixture patches current_session to return
    the shared mock_session.
    """

    @patch("app.tasks.clip.generate_clip_embedding")
    def test_bulk_skips_existing_embeddings(self, mock_task, mock_session):
        media1_id = uuid4()
        media2_id = uuid4()
        org_id = uuid4()

        # media1 already has embedding
        mock_session.query.return_value.filter_by.return_value.all.return_value = [
            MagicMock(media_id=media1_id),  # existing embedding
        ]
        # All image media
        mock_session.query.return_value.filter.return_value.all.return_value = [
            (media1_id,),
            (media2_id,),
        ]

        mock_task.delay = MagicMock()

        from app.tasks.clip import bulk_generate_embeddings
        result = bulk_generate_embeddings(str(org_id))
        assert result["success"] is True
        assert result["queued"] == 1
        mock_task.delay.assert_called_once()
