"""
Smoke tests for the Entities Current API.

Routes under /api/entities-current and /api/entities-current/export.
Tests cover query (list), export, filtering, pagination, and auth.
"""

import json
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models import EntityCurrent


def _make_entity(db_session, org_id, entity_key, entity_type="object", **overrides):
    """Create an EntityCurrent row directly in the DB."""
    now = datetime.now(timezone.utc)
    defaults = dict(
        organization_id=org_id,
        entity_key=entity_key,
        entity_type=entity_type,
        source_system="test",
        source_id=entity_key,
        payload={"title": f"Entity {entity_key}"},
        payload_hash="abc123",
        sources={},
        extracted_at=now,
        last_seen_at=now,
        updated_at=now,
        is_deleted=False,
    )
    defaults.update(overrides)
    entity = EntityCurrent(**defaults)
    db_session.add(entity)
    db_session.commit()
    return entity


# ============================================================================
# Query (List) Entities
# ============================================================================


class TestQueryEntities:
    def test_query_empty(self, auth_setup, db_session):
        """Querying entities for an org with no data returns empty list."""
        auth_client, org, _ = auth_setup
        url = f"/api/entities-current?organization_id={org.organization_id}"

        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["items"] == []
        assert len(data["items"]) == 0
        assert data["next_cursor"] is None

    def test_query_returns_entities(self, auth_setup, db_session):
        """Querying entities returns inserted records."""
        auth_client, org, _ = auth_setup
        _make_entity(db_session, org.organization_id, "key-a")
        _make_entity(db_session, org.organization_id, "key-b")

        url = f"/api/entities-current?organization_id={org.organization_id}"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 2
        # Should contain both entity keys
        keys = {e["entity_key"] for e in data["items"]}
        assert keys == {"key-a", "key-b"}

    def test_query_filter_by_entity_type(self, auth_setup, db_session):
        """Filtering by entity_type returns only matching entities."""
        auth_client, org, _ = auth_setup
        _make_entity(db_session, org.organization_id, "obj-1", entity_type="object")
        _make_entity(db_session, org.organization_id, "person-1", entity_type="person")

        url = (
            f"/api/entities-current"
            f"?organization_id={org.organization_id}"
            f"&entity_type=person"
        )
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert len(data["items"]) == 1
        assert data["items"][0]["entity_type"] == "person"

    def test_query_missing_organization_id(self, auth_setup):
        """Omitting organization_id returns 400."""
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/entities-current")
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert "organization_id" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", "")))).lower()

    def test_query_invalid_limit(self, auth_setup):
        """Non-integer limit returns 400."""
        auth_client, org, _ = auth_setup
        url = f"/api/entities-current?organization_id={org.organization_id}&limit=abc"
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert "limit" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", "")))).lower()


# ============================================================================
# Export Entities
# ============================================================================


class TestExportEntities:
    def test_export_jsonl_empty(self, auth_setup, db_session):
        """Exporting with no entities returns empty JSONL."""
        auth_client, org, _ = auth_setup
        url = (
            f"/api/entities-current/export"
            f"?organization_id={org.organization_id}"
            f"&format=jsonl"
        )
        resp = auth_client.get(url)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("application/x-ndjson")
        assert resp.content.strip() == b""

    def test_export_jsonl_with_data(self, auth_setup, db_session):
        """Exporting entities as JSONL produces valid lines."""
        auth_client, org, _ = auth_setup
        _make_entity(db_session, org.organization_id, "export-1")
        _make_entity(db_session, org.organization_id, "export-2")

        url = (
            f"/api/entities-current/export"
            f"?organization_id={org.organization_id}"
            f"&format=jsonl"
        )
        resp = auth_client.get(url)
        assert resp.status_code == 200
        lines = [l for l in resp.text.strip().split("\n") if l]
        assert len(lines) == 2
        # Each line should be valid JSON
        for line in lines:
            record = json.loads(line)
            assert "entity_key" in record

    def test_export_invalid_format(self, auth_setup):
        """Requesting an unsupported format returns 400."""
        auth_client, org, _ = auth_setup
        url = (
            f"/api/entities-current/export"
            f"?organization_id={org.organization_id}"
            f"&format=csv"
        )
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        assert "format" in (data.get("error").get("message", "") if isinstance(data.get("error"), dict) else (data.get("error") or str(data.get("detail", "")))).lower()

    def test_export_missing_organization_id(self, auth_setup):
        """Omitting organization_id on export returns 400."""
        auth_client, _, _ = auth_setup
        resp = auth_client.get("/api/entities-current/export?format=jsonl")
        assert resp.status_code in (400, 422)
        data = resp.get_json()
        _e = data.get("error") or data.get("detail", "")
        _msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()
        assert "organization_id" in _msg or "organization" in _msg


# ============================================================================
# Auth Required
# ============================================================================


class TestEntitiesCurrentAuth:
    def test_query_requires_auth(self, client, auth_setup, db_session):
        """Unauthenticated request to query entities returns 401."""
        _, org, _ = auth_setup
        url = f"/api/entities-current?organization_id={org.organization_id}"
        resp = client.get(url)
        assert resp.status_code == 401

    def test_export_requires_auth(self, client, auth_setup, db_session):
        """Unauthenticated request to export entities returns 401."""
        _, org, _ = auth_setup
        url = (
            f"/api/entities-current/export"
            f"?organization_id={org.organization_id}"
            f"&format=jsonl"
        )
        resp = client.get(url)
        assert resp.status_code == 401
