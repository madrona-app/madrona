"""An unreachable backing service answers 503, not 500.

A search cluster or object store being down is an outage, not a fault in the
request. Answering 500 misleads client retry policies and buries real
application bugs in Sentry alongside infrastructure noise.
"""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.fastapi_app.exception_handlers import (
    _DEPENDENCY_UNAVAILABLE,
    _dependency_unavailable_types,
    register_exception_handlers,
)


def _app_raising(exc: BaseException) -> TestClient:
    app = FastAPI()
    register_exception_handlers(app)

    @app.get("/boom")
    async def boom():  # noqa: ANN202
        raise exc

    return TestClient(app, raise_server_exceptions=False)


class TestDependencyUnavailable:
    def test_resolves_the_expected_libraries(self):
        names = {f"{t.__module__}.{t.__name__}" for t in _dependency_unavailable_types()}
        assert "opensearchpy.exceptions.ConnectionError" in names
        assert "botocore.exceptions.ConnectionError" in names
        assert "redis.exceptions.ConnectionError" in names

    def test_never_captures_the_builtin_connection_error(self):
        """The builtin would swallow ordinary socket failures in app code."""
        assert ConnectionError not in _DEPENDENCY_UNAVAILABLE
        for t in _DEPENDENCY_UNAVAILABLE:
            assert t is not ConnectionError
            assert t is not TimeoutError

    def test_opensearch_outage_is_503(self):
        from opensearchpy.exceptions import ConnectionError as OSConnectionError

        resp = _app_raising(OSConnectionError("N/A", "cluster down", None)).get("/boom")
        assert resp.status_code == 503
        assert resp.json()["error"]["code"] == "service_unavailable"

    def test_object_store_outage_is_503(self):
        from botocore.exceptions import EndpointConnectionError

        resp = _app_raising(
            EndpointConnectionError(endpoint_url="http://seaweedfs:8333")
        ).get("/boom")
        assert resp.status_code == 503
        assert resp.json()["error"]["code"] == "service_unavailable"

    def test_redis_outage_is_503(self):
        from redis.exceptions import ConnectionError as RedisConnectionError

        resp = _app_raising(RedisConnectionError("no route to host")).get("/boom")
        assert resp.status_code == 503

    @pytest.mark.parametrize(
        "exc",
        [
            ValueError("a real bug"),
            KeyError("missing"),
            ConnectionError("a plain socket error from application code"),
        ],
    )
    def test_ordinary_failures_are_still_500(self, exc):
        resp = _app_raising(exc).get("/boom")
        assert resp.status_code == 500
        assert resp.json()["error"]["code"] == "internal_error"


class TestPydanticValidationIs422:
    """A model built by hand inside a handler still means bad input, not a bug."""

    def test_validation_error_is_422_not_500(self):
        from pydantic import BaseModel

        class Body(BaseModel):
            q: str

        app = FastAPI()
        register_exception_handlers(app)

        @app.post("/manual")
        async def manual(data: dict):  # noqa: ANN202 - mirrors the real pattern
            Body(**data)
            return {"ok": True}

        client = TestClient(app, raise_server_exceptions=False)
        assert client.post("/manual", json={"q": "fine"}).status_code == 200

        resp = client.post("/manual", json={"q": {"not": "a string"}})
        assert resp.status_code == 422
        body = resp.json()
        assert body["error"]["code"] == "validation_error"
        assert "q" in body["error"]["message"]
