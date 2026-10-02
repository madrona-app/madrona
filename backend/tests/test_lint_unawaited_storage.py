"""Guard: no synchronous caller may invoke an async StorageBackend method.

The bug class this exists for, found in `routers/guide_documents.py`:

    def delete_document(...):              # sync handler
        storage.delete_object(doc.file_key)   # async method
        db.delete(doc); db.commit()

`delete_object` is `async def`, so calling it from a sync function builds a
coroutine and discards it. No request is made, nothing raises, the enclosing
try/except sees success — and the commit then destroys the only record of the
object's key. Every guide document ever "deleted" was still in the bucket,
unreferenced and unfindable. Python emits a RuntimeWarning for the un-awaited
coroutine, which nothing was watching.

It is a quiet failure with a loud consequence, and the fix is invisible in
review (`delete_object` vs `delete_object_sync` differ by a suffix), so it is
worth a structural check rather than vigilance. Each backend provides *_sync
variants for exactly these callers, and StorageBackend declares them.
"""
from __future__ import annotations

import ast
from pathlib import Path

APP = Path(__file__).resolve().parents[1] / "app"
BASE = APP / "services" / "storage" / "base.py"

# Receivers that plausibly hold a StorageBackend. Deliberately narrow: boto3's
# client shares method names with this interface (`put_object`, `head_object`),
# and those calls are correctly synchronous, so matching on the method name
# alone produces false positives.
STORAGE_RECEIVERS = {
    "storage",
    "backend",
    "storage_backend",
    "target_backend",
    "source_backend",
}


def _async_method_names() -> set[str]:
    tree = ast.parse(BASE.read_text())
    return {
        item.name
        for node in ast.walk(tree)
        if isinstance(node, ast.ClassDef) and node.name == "StorageBackend"
        for item in node.body
        if isinstance(item, ast.AsyncFunctionDef)
    }


def _receiver(call: ast.Call) -> str:
    value = call.func.value
    if isinstance(value, ast.Name):
        return value.id
    if isinstance(value, ast.Attribute):
        return value.attr
    return "<expr>"


def _offenders() -> list[str]:
    async_methods = _async_method_names()
    found: list[str] = []
    for path in APP.rglob("*.py"):
        try:
            tree = ast.parse(path.read_text())
        except SyntaxError:
            continue
        for fn in ast.walk(tree):
            if not isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
                continue
            if isinstance(fn, ast.AsyncFunctionDef):
                continue  # an async caller can legitimately await these
            awaited = {
                id(node.value)
                for node in ast.walk(fn)
                if isinstance(node, ast.Await)
            }
            for node in ast.walk(fn):
                if (
                    isinstance(node, ast.Call)
                    and isinstance(node.func, ast.Attribute)
                    and node.func.attr in async_methods
                    and _receiver(node) in STORAGE_RECEIVERS
                    and id(node) not in awaited
                ):
                    rel = path.relative_to(APP.parent)
                    found.append(
                        f"{rel}:{node.lineno} {_receiver(node)}.{node.func.attr}() "
                        f"in sync def {fn.name}()"
                    )
    return sorted(found)


def test_storage_interface_declares_sync_delete():
    """The sync variant must stay on the interface, not just on the backends.

    It was previously implemented by all three backends and declared by none,
    so nothing stopped a caller reaching for the async one.
    """
    assert "delete_object_sync" in BASE.read_text(), (
        "StorageBackend no longer declares delete_object_sync; sync callers "
        "have nothing safe to call."
    )


def test_no_sync_caller_invokes_an_async_storage_method():
    offenders = _offenders()
    assert not offenders, (
        "Synchronous code is calling an async StorageBackend method. The "
        "coroutine is never awaited, so the operation silently does not "
        "happen and nothing raises. Use the *_sync variant.\n  "
        + "\n  ".join(offenders)
    )


def test_the_guard_detects_the_original_bug(tmp_path):
    """The check must fail on the shape it was written for — not be vacuous."""
    import textwrap

    sample = tmp_path / "sample.py"
    sample.write_text(
        textwrap.dedent(
            """
            def delete_document(storage, doc, db):
                storage.delete_object(doc.file_key)
                db.delete(doc)
            """
        )
    )
    tree = ast.parse(sample.read_text())
    async_methods = _async_method_names()
    hits = [
        node
        for fn in ast.walk(tree)
        if isinstance(fn, ast.FunctionDef)
        for node in ast.walk(fn)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in async_methods
        and _receiver(node) in STORAGE_RECEIVERS
    ]
    assert hits, "the detector no longer recognises the original bug shape"
