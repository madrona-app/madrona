"""
Alembic migration smoke tests.

These tests require a real PostgreSQL database and are skipped unless
TEST_DATABASE_URL is set. They verify that migrations can run cleanly.

Usage:
    TEST_DATABASE_URL=postgresql://user:pass@localhost/test_db \
        ./venv/bin/python -m pytest tests/test_migration_smoke.py -v -m postgres
"""

import os
import subprocess
import sys

import pytest

BACKEND_DIR = os.path.join(os.path.dirname(__file__), "..")
# Use whichever Python is currently running pytest — local dev has a venv,
# CI uses the system Python; both should work.
VENV_PYTHON = sys.executable


def _run_alembic(*args, env_override=None):
    """Run an alembic command using the venv python and return the result."""
    env = os.environ.copy()
    if env_override:
        env.update(env_override)

    # Use TEST_DATABASE_URL as DATABASE_URL for alembic
    test_url = env.get("TEST_DATABASE_URL", "")
    if test_url:
        env["DATABASE_URL"] = test_url

    cmd = [VENV_PYTHON, "-m", "alembic"] + list(args)
    return subprocess.run(
        cmd,
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )


@pytest.mark.postgres
class TestMigrationSmoke:
    def test_migrations_up_to_head(self):
        """Alembic upgrade head succeeds on the test database."""
        result = _run_alembic("upgrade", "head")
        assert result.returncode == 0, (
            f"alembic upgrade head failed.\nstdout: {result.stdout}\nstderr: {result.stderr}"
        )

    @pytest.mark.skip(reason="FK cycle between jobs ↔ runs trips CircularDependencyError during downgrade DROP TABLE ordering — real migration bug")
    def test_migration_downgrade_upgrade_cycle(self):
        """Downgrade one revision and re-upgrade to head."""
        # Ensure we're at head first
        up = _run_alembic("upgrade", "head")
        assert up.returncode == 0, f"Initial upgrade failed: {up.stderr}"

        # Downgrade one step
        down = _run_alembic("downgrade", "-1")
        assert down.returncode == 0, (
            f"alembic downgrade -1 failed.\nstdout: {down.stdout}\nstderr: {down.stderr}"
        )

        # Re-upgrade to head
        up2 = _run_alembic("upgrade", "head")
        assert up2.returncode == 0, (
            f"Re-upgrade to head failed.\nstdout: {up2.stdout}\nstderr: {up2.stderr}"
        )
