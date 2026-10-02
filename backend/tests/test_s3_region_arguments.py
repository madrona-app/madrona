"""
get_s3_client() and get_media_bucket() take an AWS region. Several callers
passed an organization id instead.

boto3 rejects a UUID outright — "expected string or bytes-like object, got
'UUID'" — which is how the media transform endpoint and the upload-from-URL
task failed. get_media_bucket was quieter about it: an unrecognised region
just logs a warning and falls back, so that half of the mistake produced no
error at all and survived.

This audits every call site rather than the three that were caught, because
the failure only appears when the line actually runs.
"""

from __future__ import annotations

import ast
import pathlib

_APP = pathlib.Path(__file__).resolve().parent.parent / "app"
_REGION_FUNCS = {"get_s3_client", "get_media_bucket", "get_platform_bucket"}
# Names that are an organization, not a region.
_ORG_ISH = ("org_id", "org_uuid", "organization_id", "organization_uuid")


def _org_shaped_region_args() -> list[str]:
    bad: list[str] = []
    for path in sorted(_APP.rglob("*.py")):
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)):
                continue
            if node.func.id not in _REGION_FUNCS or not node.args:
                continue
            first = node.args[0]
            name = first.id if isinstance(first, ast.Name) else None
            if name and any(tok in name for tok in _ORG_ISH):
                rel = path.relative_to(_APP.parent)
                bad.append(f"{rel}:{node.lineno} {node.func.id}({name})")
    return bad


def test_no_caller_passes_an_organization_as_a_region():
    bad = _org_shaped_region_args()
    assert bad == [], (
        "these pass an organization id where an AWS region is expected:\n  "
        + "\n  ".join(bad)
    )


def test_the_audit_detects_a_known_bad_call(tmp_path):
    """Guard against the audit quietly matching nothing."""
    global _APP

    offender = tmp_path / "app" / "bad.py"
    offender.parent.mkdir(parents=True)
    offender.write_text("get_s3_client(org_uuid)\n")

    original = _APP
    try:
        _APP = tmp_path / "app"
        assert _org_shaped_region_args(), "audit failed to flag a known bad call"
    finally:
        _APP = original
