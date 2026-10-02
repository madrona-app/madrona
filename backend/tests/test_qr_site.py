"""Tests for the museum-level site QR endpoint and the batch label NameError fix.

Covers:
  - GET /api/organizations/{org}/qr/site  (auth, content-type, slug in filename)
  - POST /api/organizations/{org}/collections/barcodes/labels/batch
    happy path — regression guard for the undefined `label_format` NameError.
"""

from __future__ import annotations

import json

from app.models import CollectionObject


def _site_qr_url(org) -> str:
    return f"/api/organizations/{org.organization_id}/qr/site"


def _batch_url(org) -> str:
    return f"/api/organizations/{org.organization_id}/collections/barcodes/labels/batch"


def _seed_object(db_session, org_id, *, object_number="QR-OBJ-1") -> CollectionObject:
    obj = CollectionObject(organization_id=org_id, object_number=object_number)
    db_session.add(obj)
    db_session.commit()
    return obj


# ---------------------------------------------------------------------------
# Site QR
# ---------------------------------------------------------------------------


class TestSiteQr:
    def test_png_default(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_site_qr_url(org), query_string={"format": "png"})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/png"
        # PNG magic bytes
        assert resp.content[:8] == b"\x89PNG\r\n\x1a\n"

    def test_svg(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_site_qr_url(org), query_string={"format": "svg"})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "image/svg+xml"
        assert b"<svg" in resp.content

    def test_filename_carries_org_slug(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_site_qr_url(org), query_string={"format": "png"})
        disposition = resp.headers["content-disposition"]
        # org fixture slug is "test-org"
        assert "test-org-guide-qr.png" in disposition

    def test_invalid_format_rejected(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(_site_qr_url(org), query_string={"format": "gif"})
        assert resp.status_code == 400

    def test_requires_authentication(self, client, auth_setup):
        # auth_setup creates the org; `client` (no auth header) must be refused.
        _, org, _ = auth_setup
        resp = client.get(_site_qr_url(org), query_string={"format": "png"})
        assert resp.status_code in (401, 403)


# ---------------------------------------------------------------------------
# Batch labels — NameError regression guard
# ---------------------------------------------------------------------------


class TestBatchLabelsHappyPath:
    def test_batch_creates_labels_with_requested_format(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj1 = _seed_object(db_session, org.organization_id, object_number="BQ-1")
        obj2 = _seed_object(db_session, org.organization_id, object_number="BQ-2")
        resp = client.post(
            _batch_url(org),
            data=json.dumps(
                {
                    "label_format": "qr",
                    "entries": [
                        {"entity_type": "collection_object", "entity_id": str(obj1.object_id)},
                        {"entity_type": "collection_object", "entity_id": str(obj2.object_id)},
                    ],
                }
            ),
            content_type="application/json",
        )
        assert resp.status_code == 201
        body = resp.get_json()
        assert body["count"] == 2
        assert "batch_id" in body
        # Every created label carries the requested format (the NameError fix).
        assert all(label["label_format"] == "qr" for label in body["labels"])

def test_qr_payload_is_absolute_url():
    """QR codes are scanned by phone cameras — the payload must be an
    absolute URL, not a bare path (long-standing bug, fixed with the site QR)."""
    from app.services.qr_service import QRService
    url = QRService._public_url("/c/test-org?src=qr")
    assert url.startswith("http"), url
    assert url.endswith("/c/test-org?src=qr")
