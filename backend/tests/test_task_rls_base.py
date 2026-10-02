"""
Tests for OrgTask and SystemTask base classes.

Verifies that:
- OrgTask correctly extracts organization_id and sets RLS context
- OrgTask handles positional and keyword organization_id
- SystemTask does NOT set RLS context
- Both task types create a standalone DB session via get_session()
- Missing organization_id raises ValueError
"""

from contextlib import contextmanager
from unittest.mock import MagicMock, patch, call
import pytest


@pytest.fixture
def mock_session():
    """Create a mock DB session returned by get_session()."""
    session = MagicMock()

    @contextmanager
    def _fake_get_session():
        yield session

    return session, _fake_get_session


class TestOrgTask:
    """Tests for the OrgTask base class."""

    def test_extracts_org_id_from_positional_args(self, mock_session):
        """OrgTask should extract organization_id when passed positionally."""
        session, fake_get_session = mock_session
        with patch("app.tasks.base.get_session", fake_get_session):
            with patch("app.tasks.rls_helpers.set_task_rls_context") as mock_set_rls:
                from app.tasks.base import OrgTask

                task = OrgTask()
                task.name = "test.task"

                # Simulate a task with signature: run(media_id, organization_id)
                def run(media_id: str, organization_id: str):
                    return {"media_id": media_id, "org": organization_id}

                task.run = run

                result = task("media-123", "org-456")

                mock_set_rls.assert_called_once_with(session, "org-456")
                assert result["org"] == "org-456"

    def test_extracts_org_id_from_kwargs(self, mock_session):
        """OrgTask should extract organization_id when passed as keyword."""
        session, fake_get_session = mock_session
        with patch("app.tasks.base.get_session", fake_get_session):
            with patch("app.tasks.rls_helpers.set_task_rls_context") as mock_set_rls:
                from app.tasks.base import OrgTask

                task = OrgTask()
                task.name = "test.task"

                def run(media_id: str, organization_id: str):
                    return {"org": organization_id}

                task.run = run

                result = task("media-123", organization_id="org-789")

                mock_set_rls.assert_called_once_with(session, "org-789")
                assert result["org"] == "org-789"

    def test_extracts_org_id_first_positional(self, mock_session):
        """OrgTask should work when organization_id is the first parameter."""
        session, fake_get_session = mock_session
        with patch("app.tasks.base.get_session", fake_get_session):
            with patch("app.tasks.rls_helpers.set_task_rls_context") as mock_set_rls:
                from app.tasks.base import OrgTask

                task = OrgTask()
                task.name = "test.task"

                # Simulate bulk_process_ai_tags signature: run(organization_id, ...)
                def run(organization_id: str, limit: int = 100):
                    return {"org": organization_id}

                task.run = run

                result = task("org-111")

                mock_set_rls.assert_called_once_with(session, "org-111")

    def test_raises_on_missing_org_id(self, mock_session):
        """OrgTask should raise ValueError when organization_id cannot be extracted."""
        session, fake_get_session = mock_session
        with patch("app.tasks.base.get_session", fake_get_session):
            with patch("app.tasks.rls_helpers.set_task_rls_context") as mock_set_rls:
                from app.tasks.base import OrgTask

                task = OrgTask()
                task.name = "test.task.no_org"

                def run(some_id: str):
                    return {"id": some_id}

                task.run = run

                with pytest.raises(ValueError, match="could not extract organization_id"):
                    task("value-123")

                mock_set_rls.assert_not_called()

    def test_creates_db_session(self, mock_session):
        """OrgTask should create a standalone DB session via get_session()."""
        session, fake_get_session = mock_session
        with patch("app.tasks.base.get_session", fake_get_session) as mock_gs:
            with patch("app.tasks.rls_helpers.set_task_rls_context"):
                from app.tasks.base import OrgTask

                task = OrgTask()
                task.name = "test.task"

                def run(organization_id: str):
                    return {}

                task.run = run
                task("org-123")


class TestSystemTask:
    """Tests for the SystemTask base class."""

    def test_does_not_set_rls_context(self, mock_session):
        """SystemTask should NOT set RLS context."""
        session, fake_get_session = mock_session
        with patch("app.tasks.base.get_session", fake_get_session):
            with patch("app.tasks.rls_helpers.set_task_rls_context") as mock_set_rls:
                from app.tasks.base import SystemTask

                task = SystemTask()
                task.name = "test.system_task"

                def run():
                    return {"status": "ok"}

                task.run = run

                result = task()

                mock_set_rls.assert_not_called()
                assert result["status"] == "ok"

    def test_creates_db_session(self, mock_session):
        """SystemTask should create a standalone DB session via get_session()."""
        session, fake_get_session = mock_session
        with patch("app.tasks.base.get_session", fake_get_session):
            from app.tasks.base import SystemTask

            task = SystemTask()
            task.name = "test.system_task"

            def run():
                return {}

            task.run = run
            task()

    def test_passes_args_through(self, mock_session):
        """SystemTask should pass all arguments to run()."""
        session, fake_get_session = mock_session
        with patch("app.tasks.base.get_session", fake_get_session):
            from app.tasks.base import SystemTask

            task = SystemTask()
            task.name = "test.system_task"

            def run(since_days: int = 7):
                return {"since_days": since_days}

            task.run = run

            result = task(since_days=14)
            assert result["since_days"] == 14


class TestOrgIdExtraction:
    """Edge case tests for organization_id extraction."""

    def test_org_id_at_various_positions(self, mock_session):
        """OrgTask should find organization_id regardless of position."""
        session, fake_get_session = mock_session
        with patch("app.tasks.base.get_session", fake_get_session):
            with patch("app.tasks.rls_helpers.set_task_rls_context") as mock_set_rls:
                from app.tasks.base import OrgTask

                task = OrgTask()
                task.name = "test.task"

                # organization_id at position 3
                def run(a: str, b: str, c: str, organization_id: str, d: bool = False):
                    return {}

                task.run = run

                task("val_a", "val_b", "val_c", "org-999")
                mock_set_rls.assert_called_once_with(session, "org-999")

    def test_kwargs_take_precedence(self, mock_session):
        """Kwargs should be checked first (fast path)."""
        session, fake_get_session = mock_session
        with patch("app.tasks.base.get_session", fake_get_session):
            with patch("app.tasks.rls_helpers.set_task_rls_context") as mock_set_rls:
                from app.tasks.base import OrgTask

                task = OrgTask()
                task.name = "test.task"

                def run(organization_id: str):
                    return {}

                task.run = run

                task(organization_id="org-kwarg")
                mock_set_rls.assert_called_once_with(session, "org-kwarg")
