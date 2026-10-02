"""get_db must stay async, or current_session() breaks on every request.

FastAPI runs a *sync* generator dependency in a worker thread. A ContextVar set
there lives in that thread's own copy of the context and is discarded when the
dependency returns, so the endpoint — running in a different thread, with a
context copied from the request's async context — never sees it. An *async*
dependency sets it in the request's own context, and anyio copies that into the
threadpool when it calls the endpoint.

While get_db was sync, every service that read the session from context raised

    RuntimeError: No database session available.

on every request that reached it. There are ~179 such call sites across 32
modules, and the failures were being patched one endpoint at a time — sla/status,
media/duplicates, the four media download-request endpoints — by threading a
session through by hand. Making the dependency async fixed all of them at once.

The property is invisible: nothing about a sync `def get_db` looks wrong, and
the suite passed with it. Hence this file.
"""

import ast
import inspect
from pathlib import Path

import pytest

from app.database import get_db


def test_get_db_is_an_async_generator():
    assert inspect.isasyncgenfunction(get_db), (
        "get_db must be an async generator. As a sync one, the session it binds "
        "to the context is invisible to every endpoint, and current_session() "
        "raises RuntimeError instead of returning it."
    )


def test_context_propagates_from_an_async_dependency_but_not_a_sync_one():
    """The mechanism itself, so the reason survives even if get_db moves.

    If a future FastAPI makes sync dependencies propagate context, this fails
    and the constraint above can be relaxed on purpose rather than by accident.
    """
    from contextvars import ContextVar

    from fastapi import Depends, FastAPI
    from fastapi.testclient import TestClient

    probe: ContextVar[str | None] = ContextVar("probe", default=None)
    app = FastAPI()

    def sync_dep():
        probe.set("sync")
        yield

    async def async_dep():
        probe.set("async")
        yield

    @app.get("/sync")
    def read_after_sync_dep(_=Depends(sync_dep)):
        return {"seen": probe.get()}

    @app.get("/async")
    def read_after_async_dep(_=Depends(async_dep)):
        return {"seen": probe.get()}

    client = TestClient(app)
    assert client.get("/sync").json()["seen"] is None
    assert client.get("/async").json()["seen"] == "async"


def test_no_route_drives_get_db_by_hand():
    """`next(get_db())` cannot work against an async generator.

    Two connector destinations did this. It also skipped get_db's commit and,
    being outside FastAPI, was never covered. get_session() is the sync
    equivalent and handles commit, rollback and close.
    """
    app_dir = Path(__file__).resolve().parent.parent / "app"
    offenders = []
    for path in sorted(app_dir.rglob("*.py")):
        text = path.read_text()
        if "get_db()" not in text:
            continue
        for node in ast.walk(ast.parse(text)):
            if (
                isinstance(node, ast.Call)
                and getattr(node.func, "id", None) == "next"
                and node.args
                and isinstance(node.args[0], ast.Call)
                and getattr(node.args[0].func, "id", None) == "get_db"
            ):
                offenders.append(f"{path.relative_to(app_dir)}:{node.lineno}")

    assert not offenders, (
        "next(get_db()) cannot drive an async generator; use get_session():\n  "
        + "\n  ".join(offenders)
    )
