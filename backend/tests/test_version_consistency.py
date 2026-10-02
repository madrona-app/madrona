"""
The product version is declared in three places that cannot import each other,
and repeated nowhere else.

Before this test existed the version appeared six times: pyproject.toml,
app/__init__.py, frontend/package.json, a literal in app/asgi.py, a literal in
the GET / handler, and a hand-maintained backend/openapi.yaml (since deleted —
it was stale and referenced by nothing). Nothing compared them. The two literals were the ones an integrator actually sees — the
published OpenAPI document and the API root — so a bump that missed them would
have reported a version the code was not.

The promise in UPGRADING.md is a promise about a version number. It is worth a
test that the number is one number.
"""

import json
import re
import tomllib
from pathlib import Path

import pytest

from app import __version__

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parent

# "1.2.3" or "1.2.3-rc1" in quotes. Deliberately not matching two-part
# versions: pinned dependencies like "3.12" are not what this is looking for.
SEMVER_LITERAL = re.compile(r"""['"]\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?['"]""")


def test_backend_pyproject_matches_app_version():
    pyproject = tomllib.loads((BACKEND / "pyproject.toml").read_text())
    assert pyproject["project"]["version"] == __version__, (
        "backend/pyproject.toml and app/__init__.py disagree about the version"
    )


def test_frontend_package_matches_app_version():
    package_json = REPO / "frontend" / "package.json"
    if not package_json.exists():
        # The backend container does not carry the frontend tree.
        pytest.skip("frontend/package.json is not present in this tree")
    assert json.loads(package_json.read_text())["version"] == __version__, (
        "frontend/package.json and app/__init__.py disagree about the version"
    )


@pytest.mark.parametrize(
    "relative_path",
    ["app/asgi.py", "app/fastapi_app/routers/health.py"],
)
def test_user_visible_version_is_not_a_literal(relative_path):
    """
    These two report the version outward — the OpenAPI document and GET /.
    Both must derive it from app.__version__, so neither may carry a version
    literal of its own.
    """
    source = (BACKEND / relative_path).read_text()
    found = SEMVER_LITERAL.findall(source)
    assert not found, (
        f"{relative_path} contains a hardcoded version literal {found}. "
        "Use app.utils.version.get_app_version() instead — see app/__init__.py."
    )
