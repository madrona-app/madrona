"""
Unit tests for scripts/lint_naive_datetime.py.

The lint exists to catch the bug class that 500'd /api/auth/activate
in May 2026 — comparing a naive `expires_at` against a tz-aware
`datetime.now(timezone.utc)`. Without these tests, a future change to
the AST checker could silently lose its sensitivity.

Two contracts to lock down:
  1. The lint flags the obvious pre-fix shape
  2. The lint accepts the canonical post-fix shape (lift to local,
     `if x.tzinfo is None: x = x.replace(...)`, then compare)
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path
import textwrap

import pytest


REPO_BACKEND = Path(__file__).resolve().parents[1]
LINT_SCRIPT = REPO_BACKEND / "scripts" / "lint_naive_datetime.py"


def _run_lint(target: Path) -> tuple[int, str]:
    result = subprocess.run(
        [sys.executable, str(LINT_SCRIPT), str(target)],
        capture_output=True,
        text=True,
    )
    return result.returncode, result.stdout + result.stderr


@pytest.fixture
def lint_dir(tmp_path: Path) -> Path:
    """A fresh dir the lint can scan, isolated from the real codebase."""
    d = tmp_path / "src"
    d.mkdir()
    return d


def _write(path: Path, source: str) -> None:
    path.write_text(textwrap.dedent(source).lstrip(), encoding="utf-8")


class TestLintFlagsBadPatterns:
    def test_pre_fix_pattern_is_flagged(self, lint_dir: Path):
        """Exactly the shape of today's /api/auth/activate 500."""
        _write(lint_dir / "bad.py", """
            from datetime import datetime, timezone

            def check(invitation):
                if invitation.expires_at < datetime.now(timezone.utc):
                    raise ValueError("expired")
        """)
        rc, out = _run_lint(lint_dir)
        assert rc == 1, f"expected lint to fail, got {rc}; output:\n{out}"
        assert "expires_at" in out
        assert "datetime.now" in out

    def test_naive_gt_comparison_is_flagged(self, lint_dir: Path):
        """Order-independent: `now() > obj.attr` is the same smell."""
        _write(lint_dir / "bad_reversed.py", """
            from datetime import datetime, timezone

            def is_expired(token):
                return datetime.now(timezone.utc) > token.used_at
        """)
        rc, out = _run_lint(lint_dir)
        assert rc == 1
        assert "used_at" in out

    def test_multiple_known_attrs_all_flagged(self, lint_dir: Path):
        _write(lint_dir / "many.py", """
            from datetime import datetime, timezone

            def f(obj):
                if obj.expires_at < datetime.now(timezone.utc): pass
                if obj.created_at < datetime.now(timezone.utc): pass
                if obj.last_sent_at > datetime.now(timezone.utc): pass
        """)
        rc, out = _run_lint(lint_dir)
        assert rc == 1
        # Each line should produce an issue
        assert out.count("datetime.now") >= 3


class TestLintAcceptsGoodPatterns:
    def test_tz_guarded_local_is_clean(self, lint_dir: Path):
        """The canonical post-fix pattern from /api/auth/activate."""
        _write(lint_dir / "good.py", """
            from datetime import datetime, timezone

            def check(invitation):
                expires_at = invitation.expires_at
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if expires_at < datetime.now(timezone.utc):
                    raise ValueError("expired")
        """)
        rc, out = _run_lint(lint_dir)
        assert rc == 0, f"expected clean lint, got rc={rc} output:\n{out}"

    def test_sqlalchemy_class_filter_is_not_flagged(self, lint_dir: Path):
        """`OrganizationInvitation.expires_at > datetime.now(...)` in
        a .filter() generates SQL, not a Python comparison. Lint must
        not flag PascalCase-rooted attribute access."""
        _write(lint_dir / "filter.py", """
            from datetime import datetime, timezone

            class OrganizationInvitation:
                expires_at = None

            def find_active(session):
                return (
                    session.query(OrganizationInvitation)
                    .filter(OrganizationInvitation.expires_at > datetime.now(timezone.utc))
                    .first()
                )
        """)
        rc, out = _run_lint(lint_dir)
        assert rc == 0, f"expected clean lint, got rc={rc} output:\n{out}"

    def test_unrelated_comparisons_not_flagged(self, lint_dir: Path):
        """`datetime.now() < some_int` or string comparisons aren't
        the bug class; lint should ignore them."""
        _write(lint_dir / "unrelated.py", """
            from datetime import datetime, timezone

            def f():
                if datetime.now(timezone.utc).hour < 12:
                    return "morning"
                return "afternoon"
        """)
        rc, out = _run_lint(lint_dir)
        assert rc == 0


class TestRepoClean:
    """Top-level: the live `app/` directory must lint clean.

    If a new pre-fix-shaped comparison lands without the tz guard,
    this test goes red and CI blocks the PR.
    """
    def test_app_directory_passes_lint(self):
        rc, out = _run_lint(REPO_BACKEND / "app")
        assert rc == 0, (
            f"lint_naive_datetime found {rc} issue(s) in app/. Output:\n{out}\n"
            "Fix each by lifting the attribute into a local, then:\n"
            "    if x.tzinfo is None:\n"
            "        x = x.replace(tzinfo=timezone.utc)\n"
            "    if x < datetime.now(timezone.utc):\n"
        )
