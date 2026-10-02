"""
Two periodic tasks failed on every single run for months without any test
noticing, because neither had one:

- app.tasks.auth.cleanup_expired_tokens passed structlog-style keyword
  arguments to a stdlib logger, raising TypeError after the deletes had
  already been committed (94 events, daily since 2026-05-16).
- app.tasks.preservation.replicate_to_backup imported an OrganizationSetting
  model that does not exist anywhere in app.models, raising ImportError before
  doing anything (97 events, daily since 2026-05-23).
- app.tasks.discover.check_due_publish_schedules_task loaded its schedules
  inside `with admin_db_session()` and then used them after the block had
  closed that session. The status writes went to detached instances and were
  discarded, so objects were published and the schedule stayed `pending` —
  re-publishing them on every beat, forever, with nothing recorded as failed.

The logger test is written against the whole package rather than the one call
site, because the failure mode is invisible until the line is reached at
runtime — exactly how it survived.
"""

from __future__ import annotations

import ast
import pathlib
from contextlib import contextmanager
from unittest.mock import MagicMock, patch

# Keyword arguments stdlib logging actually accepts.
_LEGAL_LOG_KWARGS = {"exc_info", "stack_info", "stacklevel", "extra"}
_LOG_METHODS = {
    "debug", "info", "warning", "warn", "error", "critical", "exception", "log",
}

_APP_ROOT = pathlib.Path(__file__).resolve().parent.parent / "app"


def _stdlib_logger_kwarg_violations() -> list[str]:
    """Every ``logger.info(msg, foo=1)`` on a stdlib logger, as 'path:line'."""
    violations: list[str] = []

    for path in sorted(_APP_ROOT.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:
            continue

        stdlib_loggers = {
            target.id
            for node in ast.walk(tree)
            if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call)
            and isinstance(node.value.func, ast.Attribute)
            and node.value.func.attr == "getLogger"
            for target in node.targets
            if isinstance(target, ast.Name)
        }
        if not stdlib_loggers:
            continue

        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr in _LOG_METHODS
                and isinstance(node.func.value, ast.Name)
                and node.func.value.id in stdlib_loggers
            ):
                bad = [
                    kw.arg for kw in node.keywords
                    if kw.arg is not None and kw.arg not in _LEGAL_LOG_KWARGS
                ]
                if bad:
                    rel = path.relative_to(_APP_ROOT.parent)
                    violations.append(f"{rel}:{node.lineno} ({', '.join(bad)})")

    return violations


class TestStdlibLoggersRejectStructlogKwargs:
    def test_no_call_site_passes_unsupported_keywords(self):
        violations = _stdlib_logger_kwarg_violations()
        assert violations == [], (
            "stdlib logging.Logger raises TypeError on unexpected keyword "
            "arguments; these call sites will fail when reached:\n  "
            + "\n  ".join(violations)
        )

    def test_the_audit_can_actually_detect_a_violation(self, tmp_path):
        """Guard against the audit silently matching nothing."""
        global _APP_ROOT
        original = _APP_ROOT
        offender = tmp_path / "app" / "bad.py"
        offender.parent.mkdir(parents=True)
        offender.write_text(
            "import logging\n"
            "logger = logging.getLogger(__name__)\n"
            "logger.info('done', total=1)\n"
        )
        try:
            _APP_ROOT = tmp_path / "app"
            assert _stdlib_logger_kwarg_violations(), "audit failed to flag a known bad call"
        finally:
            _APP_ROOT = original


class TestReplicateToBackupDoesNotCrash:
    def test_reports_not_configured_instead_of_raising(self):
        from app.tasks.preservation import replicate_to_backup

        @contextmanager
        def _fake_session():
            yield MagicMock()

        with patch("app.tasks.rls_helpers.admin_db_session", _fake_session):
            result = replicate_to_backup()

        assert result["status"] == "not_configured"
        assert result["replicated"] == 0
        assert result["errors"] == 0

    def test_no_organization_has_a_backup_target_yet(self):
        """
        Per-org backup storage is not modelled. If this ever returns targets,
        the replication path below it starts copying objects — which writes to
        `backup/<key>` in the org's own bucket, doubling stored bytes rather
        than producing an off-site copy. Decide that deliberately.
        """
        from app.tasks.preservation import _backup_targets

        assert _backup_targets(MagicMock()) == []


class TestPublishScheduleStatusIsActuallyPersisted:
    """The failure was not that publishing broke — it was that it never stopped.

    Objects were flipped on a live session, so that half worked. The schedule's
    own status was written to an instance detached when admin_db_session()
    closed, so it stayed `pending` and came back due on the next beat. A test
    that only checked "did the object publish" would have passed throughout.
    """

    def test_schedule_is_marked_executed_and_object_is_published(
        self, auth_setup, db_session
    ):
        from datetime import datetime, timedelta, timezone

        from app.models import CollectionObject, PublishSchedule
        from app.tasks.discover import check_due_publish_schedules_task

        _client, organization, _user = auth_setup

        obj = CollectionObject(
            organization_id=organization.organization_id,
            object_number="PUB-SCHED-1",
            is_discoverable=False,
        )
        db_session.add(obj)
        db_session.flush()

        schedule = PublishSchedule(
            organization_id=organization.organization_id,
            action="publish",
            scheduled_for=datetime.now(timezone.utc) - timedelta(minutes=5),
            status="pending",
            object_ids=[str(obj.object_id)],
            created_by=_user.user_id,
        )
        db_session.add(schedule)
        db_session.flush()

        @contextmanager
        def _admin_is_the_test_session():
            yield db_session

        # .run(), not the task itself: SystemTask.__call__ opens a *new*
        # get_session() and rebinds the current_session contextvar, so the task
        # would run against a session that cannot see this test's uncommitted
        # fixtures. .run() is the function body, which is what is under test.
        #
        # set_task_rls_context is deliberately NOT patched: it sets a GUC, the
        # test role is superuser, and letting it run keeps the ordering
        # (context, then read) honest.
        with patch("app.tasks.rls_helpers.admin_db_session", _admin_is_the_test_session):
            result = check_due_publish_schedules_task.run()

        assert result["success"] is True, result
        assert result["due_count"] == 1, result
        assert result["executed_count"] == 1, result

        db_session.refresh(schedule)
        db_session.refresh(obj)
        assert obj.is_discoverable is True, "the object should have been published"
        assert schedule.status == "executed", (
            "the schedule is still pending — it will run again on every beat"
        )
        assert schedule.executed_at is not None

    def test_no_due_schedules_is_not_an_error(self, db_session):
        from app.tasks.discover import check_due_publish_schedules_task

        @contextmanager
        def _admin_is_the_test_session():
            yield db_session

        with patch("app.tasks.rls_helpers.admin_db_session", _admin_is_the_test_session):
            result = check_due_publish_schedules_task.run()
        assert result["success"] is True
