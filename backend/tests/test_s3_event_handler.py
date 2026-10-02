"""Unit tests for app/services/s3_event_handler.py.

Mocks the DB session, Media model, and Celery task — these tests check the
filtering and dispatch logic only.
"""

from unittest.mock import MagicMock, patch
from uuid import uuid4

import pytest

from app.services.s3_event_handler import handle_s3_event


def _record(event_name="ObjectCreated:Put", bucket="b", key="orgs/abc/media/file.jpg", size=1234):
    return {
        "eventName": event_name,
        "s3": {
            "bucket": {"name": bucket},
            "object": {"key": key, "size": size},
        },
    }


class TestHandleS3Event:
    def test_returns_zero_for_empty_records(self):
        result = handle_s3_event({})
        assert result == {"processed": 0, "errors": []}
        result = handle_s3_event({"Records": []})
        assert result == {"processed": 0, "errors": []}

    def test_processes_object_created_record(self):
        org_id = uuid4()
        key = f"orgs/{org_id}/media/photo.jpg"
        event = {"Records": [_record(key=key, size=5000)]}

        session_mock = MagicMock()
        session_mock.query.return_value.filter_by.return_value.first.return_value = None

        with patch(
            "app.services.s3_event_handler.current_session", return_value=session_mock
        ):
            with patch("app.services.uploads.detect_media_type", return_value="image"):
                with patch("app.tasks.media.process_upload_task.delay") as task_delay:
                    with patch("app.models.Media") as media_cls:
                        media_instance = MagicMock()
                        media_instance.media_id = "new-id"
                        media_cls.return_value = media_instance
                        result = handle_s3_event(event)

        assert result["processed"] == 1
        assert result["errors"] == []
        # Created Media with parsed values
        ctor_kwargs = media_cls.call_args.kwargs
        assert ctor_kwargs["organization_id"] == org_id
        assert ctor_kwargs["s3_key"] == key
        assert ctor_kwargs["filename"] == "photo.jpg"
        assert ctor_kwargs["file_size"] == 5000
        assert ctor_kwargs["mime_type"] == "image/jpeg"
        assert ctor_kwargs["media_type"] == "image"
        assert ctor_kwargs["processing_status"] == "pending"
        # Triggered the celery task with the new media id
        task_delay.assert_called_once()

    def test_skips_non_object_created_event(self):
        event = {"Records": [_record(event_name="ObjectRemoved:Delete")]}
        with patch("app.services.s3_event_handler.current_session", return_value=MagicMock()):
            result = handle_s3_event(event)
        assert result == {"processed": 0, "errors": []}

    def test_skips_when_key_missing(self):
        event = {"Records": [_record(key="")]}
        with patch("app.services.s3_event_handler.current_session", return_value=MagicMock()):
            result = handle_s3_event(event)
        assert result == {"processed": 0, "errors": []}

    def test_skips_non_org_keyspace(self):
        event = {"Records": [_record(key="other/path/file.jpg")]}
        with patch("app.services.s3_event_handler.current_session", return_value=MagicMock()):
            result = handle_s3_event(event)
        assert result == {"processed": 0, "errors": []}

    def test_skips_when_org_id_not_uuid(self):
        event = {"Records": [_record(key="orgs/notauuid/media/file.jpg")]}
        with patch("app.services.s3_event_handler.current_session", return_value=MagicMock()):
            result = handle_s3_event(event)
        assert result == {"processed": 0, "errors": []}

    def test_skips_when_media_already_exists_for_key(self):
        org_id = uuid4()
        key = f"orgs/{org_id}/media/dup.jpg"
        event = {"Records": [_record(key=key)]}

        existing_media = MagicMock()
        session_mock = MagicMock()
        session_mock.query.return_value.filter_by.return_value.first.return_value = existing_media

        with patch(
            "app.services.s3_event_handler.current_session", return_value=session_mock
        ):
            with patch("app.tasks.media.process_upload_task.delay") as task_delay:
                result = handle_s3_event(event)

        assert result["processed"] == 0
        # Should not have triggered processing for the duplicate
        task_delay.assert_not_called()

    def test_collects_errors_and_continues(self):
        # Two records: first raises mid-processing, second succeeds.
        org_id = uuid4()
        good_key = f"orgs/{org_id}/media/ok.jpg"
        bad_key = f"orgs/{org_id}/media/boom.jpg"
        event = {
            "Records": [
                _record(key=bad_key),
                _record(key=good_key),
            ]
        }

        session_mock = MagicMock()
        # First .first() (for the bad record) raises; second returns None (no dup).
        session_mock.query.return_value.filter_by.return_value.first.side_effect = [
            RuntimeError("db down"),
            None,
        ]

        with patch(
            "app.services.s3_event_handler.current_session", return_value=session_mock
        ):
            with patch("app.services.uploads.detect_media_type", return_value="image"):
                with patch("app.tasks.media.process_upload_task.delay"):
                    with patch("app.models.Media") as media_cls:
                        media_instance = MagicMock()
                        media_instance.media_id = "x"
                        media_cls.return_value = media_instance
                        result = handle_s3_event(event)

        assert result["processed"] == 1
        assert len(result["errors"]) == 1
        assert "db down" in result["errors"][0]
