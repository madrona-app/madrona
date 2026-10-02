"""
Two whole-codebase guards for the failure mode that produced most of the
runtime bugs found in this repository: code that is syntactically fine and
imports fine, but raises the moment a particular line is reached.

Nothing catches those. The unit suite does not execute these paths, the type
checker does not run on Python here, and a review reads them as correct
because the intended name is obvious from context. They surfaced only as
production errors, one at a time.

Instances found and fixed, all of the same shape:

  geo.py                      returned `geom_type`, assigned nowhere
  collections_constituents.py called get_org_media_url with no visible import
  tasks/ulan.py               used `db` where the block binds `session` (x4)
  services/uploads.py         called uuid4() where the module imports `uuid`

And separately, a dependency imported but never declared:

  services/report_document_renderer.py imported jinja2, absent from
  requirements.txt — a fresh install could not import the module at all, and
  CI died at test collection because of it.
"""

from __future__ import annotations

import importlib
import pathlib
import pkgutil
import shutil
import subprocess

import pytest

_BACKEND = pathlib.Path(__file__).resolve().parent.parent
_APP = _BACKEND / "app"

# app/models is excluded: SQLAlchemy declares relationships as quoted forward
# references (Mapped["Organization"]) that ruff cannot resolve, producing ~277
# unavoidable reports. The bugs above were all outside models, and every
# genuine forward reference elsewhere carries an explicit noqa with a reason.
_SCANNED = ("app/tasks", "app/services", "app/fastapi_app", "app/search", "app/connectors")


def _ruff() -> str | None:
    for candidate in (_BACKEND / "venv" / "bin" / "ruff", "ruff"):
        found = shutil.which(str(candidate))
        if found:
            return found
    return None


class TestNoUndefinedNames:
    def test_every_name_used_is_defined(self):
        """
        F821. A name that is read but never bound is a NameError waiting for
        the line to execute — which is exactly how each bug above shipped.
        """
        ruff = _ruff()
        if not ruff:
            pytest.skip("ruff is not installed; `pip install ruff` to run this gate")

        dirs = [str(_BACKEND / d) for d in _SCANNED if (_BACKEND / d).is_dir()]
        proc = subprocess.run(
            [ruff, "check", "--select", "F821", "--output-format", "concise", *dirs],
            capture_output=True, text=True, cwd=_BACKEND,
        )
        if proc.returncode != 0:
            pytest.fail(
                "undefined names — each will raise NameError when reached:\n"
                + proc.stdout.strip()
            )


class TestEveryModuleImports:
    """
    Catches a dependency that is imported but not declared. Importing the
    package is the cheapest possible proxy for "a fresh install can run this",
    and it is the check CI was implicitly performing when jinja2 broke
    collection.
    """

    @staticmethod
    def _module_names() -> list[str]:
        names = []
        for mod in pkgutil.walk_packages([str(_APP)], prefix="app."):
            name = mod.name
            # Optional heavy extras are installed only when their feature is
            # enabled (requirements-ml.txt), so importing them here would fail
            # for an environment reason rather than a packaging bug.
            #
            # audio_processing is deliberately NOT on this list. mutagen is
            # unbundled too (requirements-copyleft.txt), but that module guards
            # the import and is meant to degrade to "no embedded tag metadata"
            # — so it MUST import without mutagen, and this is the only test
            # that says so. It was excluded here once, and the exclusion hid a
            # NameError that took the module down on every default install:
            # five helpers annotated `mutagen.FileType`, and Python evaluates
            # annotations at def time. Putting it back on this list would
            # re-open that hole.
            if any(part in name for part in ("clip_service", "whisper_service")):
                continue
            names.append(name)
        return names

    @staticmethod
    def _is_missing_system_library(exc: Exception) -> bool:
        """
        A missing shared object is an environment gap, not a packaging bug.

        pyodbc needs unixODBC, which the Docker image installs but a bare
        developer machine may not. That is categorically different from a
        Python dependency missing out of requirements.txt, which is what this
        test exists to catch.
        """
        text = str(exc)
        return isinstance(exc, ImportError) and (
            "Library not loaded" in text or "cannot open shared object file" in text
        )

    def test_all_modules_import_without_error(self):
        failures, env_gaps = [], []
        for name in self._module_names():
            try:
                importlib.import_module(name)
            except Exception as exc:  # noqa: BLE001 - reporting, not handling
                if self._is_missing_system_library(exc):
                    env_gaps.append(f"{name}: {exc}".split("(")[0])
                else:
                    failures.append(f"{name}: {type(exc).__name__}: {exc}")

        assert failures == [], (
            "modules that cannot be imported — a fresh install would fail the "
            "same way:\n  " + "\n  ".join(failures)
        )
        if env_gaps:
            pytest.skip(
                "imported everything except modules needing an absent system "
                "library:\n  " + "\n  ".join(env_gaps)
            )

    def test_the_scan_actually_covers_the_codebase(self):
        """Guard against the walk silently finding nothing."""
        names = self._module_names()
        assert len(names) > 200, f"expected the whole app package, walked only {len(names)}"
