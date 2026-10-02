"""Presigned URLs must be signed for the public origin, not the internal one.

A presigned URL is consumed by the browser, outside the container network. Sign
it with the internal client and it points at http://seaweedfs:8333/... , which no
browser can resolve. The signature covers the Host header, so the host cannot
be rewritten afterwards — it has to be signed against S3_PUBLIC_ENDPOINT_URL in
the first place. uploads.get_s3_client(for_presigning=True) exists for this.

report_storage had its own get_s3_client that delegated to the shared one but
dropped the flag, so every report download 307'd the browser to an unresolvable
host. Three call sites were affected, including the 24-hour link minted for
notifications. Nothing failed: the endpoint returned a valid 307 and the tests
never followed it.
"""

import ast
from pathlib import Path

import pytest

APP = Path(__file__).resolve().parent.parent / "app"

# Paths that sign by another mechanism and are not in scope for this rule.
EXEMPT = {
    "services/cloudfront_signing.py",  # CloudFront key-pair signer, not S3
    "services/storage/s3.py",          # uses its own _presign_client, built public
}


def _functions_calling_presign(tree: ast.AST):
    """Yield (function_node, name) for every function that presigns a URL."""
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        for inner in ast.walk(node):
            if (
                isinstance(inner, ast.Call)
                and isinstance(inner.func, ast.Attribute)
                and inner.func.attr == "generate_presigned_url"
            ):
                yield node, node.name
                break


def _builds_a_presigning_client(fn: ast.AST) -> bool:
    for inner in ast.walk(fn):
        if not isinstance(inner, ast.Call):
            continue
        name = inner.func.attr if isinstance(inner.func, ast.Attribute) else getattr(inner.func, "id", None)
        if name not in {"get_s3_client", "_shared"}:
            continue
        for kw in inner.keywords:
            if kw.arg == "for_presigning" and isinstance(kw.value, ast.Constant) and kw.value.value is True:
                return True
    return False


def _sources():
    for path in sorted(APP.rglob("*.py")):
        rel = str(path.relative_to(APP))
        if rel in EXEMPT:
            continue
        text = path.read_text()
        if "generate_presigned_url" not in text:
            continue
        yield rel, path, ast.parse(text)


def test_every_presigning_function_uses_a_public_endpoint_client():
    offenders = []
    for rel, path, tree in _sources():
        for fn, name in _functions_calling_presign(tree):
            if not _builds_a_presigning_client(fn):
                offenders.append(f"{rel}::{name} (line {fn.lineno})")

    assert not offenders, (
        "These functions presign a URL without a for_presigning=True client, so "
        "the URL will carry the internal endpoint host and be unreachable from a "
        "browser:\n  " + "\n  ".join(offenders)
    )


def test_the_rule_has_something_to_check():
    """Guard the guard: if nothing presigns any more, this file is dead weight."""
    checked = [name for _, _, tree in _sources() for _, name in _functions_calling_presign(tree)]
    assert checked, "no presigning functions found — has the mechanism moved?"


def test_report_download_asks_for_a_presigning_client(monkeypatch):
    """The specific regression.

    conftest stubs boto3, so the signed string cannot be inspected here — the
    assertion is on the contract instead: generate_download_url must request a
    client built against the public endpoint. That is the single bit whose
    absence produced http://seaweedfs:8333 URLs.
    """
    from app.services import report_storage, uploads

    seen = {}
    real = uploads.get_s3_client

    def spy(region=uploads.DEFAULT_REGION, *, for_presigning=False):
        seen["for_presigning"] = for_presigning
        return real(region, for_presigning=for_presigning)

    monkeypatch.setattr(uploads, "get_s3_client", spy)

    report_storage.generate_download_url("orgs/o/reports/r/runs/x/report.pdf")

    assert seen.get("for_presigning") is True, (
        "generate_download_url built a client against the internal endpoint; "
        "presigned URLs must be signed for S3_PUBLIC_ENDPOINT_URL"
    )


# ---------------------------------------------------------------------------
# The inverse mistake: using the presigning client for a real S3 call.
# ---------------------------------------------------------------------------

REAL_S3_OPS = {
    "put_object", "get_object", "delete_object", "head_object",
    "list_objects_v2", "copy_object", "upload_fileobj", "download_fileobj",
}


def _presign_client_used_for_real_calls(tree):
    """Functions that build a for_presigning client and then actually call S3.

    The presigning client points at S3_PUBLIC_ENDPOINT_URL, which from inside
    the container is not a reachable host — signing is local, so that is fine
    for minting URLs and fatal for anything that opens a connection.
    media_dam.transform_image did both with one client and raised
    EndpointConnectionError against http://localhost:18080; upload_alternative
    and delete_alternative had it too, and no test or sweep reached them.
    """
    out = []
    for fn in ast.walk(tree):
        if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        presigning = [
            n for n in ast.walk(fn)
            if isinstance(n, ast.Call)
            and getattr(n.func, "id", None) == "get_s3_client"
            and any(k.arg == "for_presigning" and getattr(k.value, "value", None) is True
                    for k in n.keywords)
        ]
        if not presigning:
            continue
        # Which name holds it? Only flag when that same name makes a real call.
        names = set()
        for assign in ast.walk(fn):
            if isinstance(assign, ast.Assign) and assign.value in presigning:
                for t in assign.targets:
                    if isinstance(t, ast.Name):
                        names.add(t.id)
        ops = sorted({
            n.func.attr for n in ast.walk(fn)
            if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
            and n.func.attr in REAL_S3_OPS
            and isinstance(n.func.value, ast.Name) and n.func.value.id in names
        })
        if ops:
            out.append(f"{fn.name} (line {fn.lineno}): {ops}")
    return out


def test_presigning_client_is_never_used_for_real_s3_calls():
    offenders = []
    for path in sorted(APP.rglob("*.py")):
        rel = str(path.relative_to(APP))
        text = path.read_text()
        if "for_presigning" not in text:
            continue
        for hit in _presign_client_used_for_real_calls(ast.parse(text)):
            offenders.append(f"{rel}::{hit}")

    assert not offenders, (
        "A client built with for_presigning=True points at the public endpoint "
        "and cannot be reached from inside the container. Use the internal "
        "client for real operations and keep the presigning one for URLs:\n  "
        + "\n  ".join(offenders)
    )
