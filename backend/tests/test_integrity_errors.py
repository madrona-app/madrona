"""IntegrityError -> HTTP: only a unique violation is a 409 "may already exist".

Routes reported every IntegrityError as a duplicate, so a value a CHECK
refused or a reference to a missing record read as "may already exist".
app/fastapi_app/integrity_errors.py tells them apart; the routers that used
the blanket 409 now go through it.
"""

from __future__ import annotations

import ast
import json
import uuid
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

from app.fastapi_app.integrity_errors import integrity_http_error

ROUTERS = Path(__file__).resolve().parents[1] / "app" / "fastapi_app" / "routers"


def _org(db_session):
    from app.models import Organization

    org = Organization(name="IE Org", slug=f"ie-{uuid.uuid4().hex[:8]}", status="active")
    db_session.add(org)
    db_session.commit()
    return org


def _flush_error(db_session, *rows) -> IntegrityError:
    with pytest.raises(IntegrityError) as info:
        with db_session.begin_nested():
            db_session.add_all(rows)
            db_session.flush()
    return info.value


def _obj(org_id, number="IE-1", status="accessioned"):
    from app.models import CollectionObject

    return CollectionObject(
        organization_id=org_id, object_number=number, object_name="x", object_status=status
    )


def _citation(org_id, full="f"):
    from app.models import Citation

    return Citation(organization_id=org_id, citation_type="book", brief_citation="b", full_citation=full)


class TestIntegrityHttpError:
    def test_unique_violation_is_a_conflict(self, db_session):
        org = _org(db_session)
        db_session.add(_obj(org.organization_id, "IE-DUP"))
        db_session.commit()
        exc = _flush_error(db_session, _obj(org.organization_id, "IE-DUP"))
        err = integrity_http_error(exc, "An object may already exist")
        assert err.status_code == 409
        assert err.detail == "An object may already exist"

    def test_check_violation_is_400_naming_the_column(self, db_session):
        org = _org(db_session)
        exc = _flush_error(db_session, _obj(org.organization_id, "IE-2", status="active"))
        err = integrity_http_error(exc, "duplicate")
        assert err.status_code == 400
        assert err.detail["code"] == "invalid_value"
        assert err.detail["field"] == "object_status"

    def test_foreign_key_violation_is_400_naming_the_column(self, db_session):
        exc = _flush_error(db_session, _citation(uuid.uuid4()))
        err = integrity_http_error(exc, "duplicate")
        assert err.status_code == 400
        assert err.detail["code"] == "invalid_reference"
        assert err.detail["field"] == "organization_id"

    def test_not_null_violation_is_400_naming_the_column(self, db_session):
        org = _org(db_session)
        exc = _flush_error(db_session, _citation(org.organization_id, full=None))
        err = integrity_http_error(exc, "duplicate")
        assert err.status_code == 400
        assert err.detail == {"code": "missing_field", "message": "Missing: full_citation", "field": "full_citation"}


class TestRoutes:
    def test_check_violation_on_event_update_is_not_reported_as_a_conflict(self, auth_setup):
        client, org, _ = auth_setup
        base = f"/api/organizations/{org.organization_id}/collections/events"
        resp = client.post(
            base, data=json.dumps({"title": "Talk", "event_type": "program"}), content_type="application/json"
        )
        assert resp.status_code == 201, resp.get_json()
        event_id = resp.get_json()["event_id"]

        resp = client.put(
            f"{base}/{event_id}", data=json.dumps({"status": "postponed"}), content_type="application/json"
        )
        assert resp.status_code == 400, resp.get_json()
        assert resp.get_json()["error"]["field"] == "status"

    def test_duplicate_reproduction_number_is_still_409(self, auth_setup):
        client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collections/reproduction-requests"
        payload = {"request_number": "RR-DUP", "requester_name": "N", "reproduction_type": "scan"}
        first = client.post(url, data=json.dumps(payload), content_type="application/json")
        assert first.status_code == 201, first.get_json()
        second = client.post(url, data=json.dumps(payload), content_type="application/json")
        assert second.status_code == 409
        assert "may already exist" in json.dumps(second.get_json())


def test_no_router_reports_every_integrity_error_as_a_conflict():
    """An ``except IntegrityError`` whose only response is a 409 treats CHECK,
    foreign-key and not-null violations as duplicates. Delete handlers (a
    restricting foreign key is the conflict there) are exempt."""
    offenders = []
    for path in sorted(ROUTERS.glob("*.py")):
        src = path.read_text()
        for node in ast.walk(ast.parse(src)):
            if not (isinstance(node, ast.ExceptHandler) and getattr(node.type, "id", None) == "IntegrityError"):
                continue
            if any(isinstance(n, ast.If) for b in node.body for n in ast.walk(b)):
                continue
            for stmt in node.body:
                call = getattr(stmt, "exc", None) if isinstance(stmt, ast.Raise) else None
                if not (isinstance(call, ast.Call) and getattr(call.func, "id", None) == "HTTPException"):
                    continue
                kw = {k.arg: k.value for k in call.keywords}
                code = kw.get("status_code")
                detail = ast.get_source_segment(src, kw["detail"]) if "detail" in kw else ""
                if isinstance(code, ast.Constant) and code.value == 409 and not any(
                    w in detail for w in ("Cannot delete", "existing references", "existing contents", "still")
                ):
                    offenders.append(f"{path.name}:{node.lineno}")
    assert not offenders, f"use integrity_http_error: {offenders}"
