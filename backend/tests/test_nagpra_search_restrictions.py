"""
NAGPRA duty-of-care gates: publishing guard + search-index redaction.

Two gates, tested end-to-end:

- Display gate: no code path may set ``is_discoverable = True`` on an object
  whose NAGPRA action lacks granted display consent (single toggle, bulk
  toggle, publish-by-criteria), and revoking consent unpublishes the object.

- Access gate: the search transformer never indexes sensitive record content
  or generates a semantic embedding for an object whose NAGPRA action lacks
  granted access consent (ingestion-time exclusion, not query-time filtering).
"""

from __future__ import annotations

import json
from uuid import uuid4

import pytest

from app.models import CollectionObject, NagpraAction
from app.search.collections.transformer import (
    NAGPRA_REDACTED_FIELDS,
    CollectionObjectTransformer,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _seed_object(db_session, org_id, *, num=None, is_discoverable=False, **fields):
    obj = CollectionObject(
        organization_id=org_id,
        object_number=num or f"NAG-{uuid4().hex[:8]}",
        is_discoverable=is_discoverable,
        **fields,
    )
    db_session.add(obj)
    db_session.commit()
    return obj


def _seed_nagpra(db_session, org_id, object_id, *, display="restricted", access="restricted"):
    action = NagpraAction(
        organization_id=org_id,
        object_id=object_id,
        action_number=f"NA-{uuid4().hex[:8]}",
        origin_type="collections_review",
        nagpra_category="sacred_object",
        display_consent=display,
        access_consent=access,
    )
    db_session.add(action)
    db_session.commit()
    return action


def _toggle_url(org, obj):
    return (
        f"/api/organizations/{org.organization_id}"
        f"/collections/objects/{obj.object_id}/discoverable"
    )


# ---------------------------------------------------------------------------
# Display gate — single toggle
# ---------------------------------------------------------------------------


class TestSingleToggleGate:
    def test_blocked_without_granted_display_consent(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id)
        _seed_nagpra(db_session, org.organization_id, obj.object_id, display="restricted")

        resp = client.patch(
            _toggle_url(org, obj),
            data=json.dumps({"is_discoverable": True}),
            content_type="application/json",
        )
        assert resp.status_code == 409
        assert "nagpra_display_restricted" in json.dumps(resp.get_json())

        db_session.refresh(obj)
        assert obj.is_discoverable is False

    @pytest.mark.parametrize("consent", ["requested", "denied", "conditional"])
    def test_all_non_granted_consents_block(self, auth_setup, db_session, consent):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id)
        _seed_nagpra(db_session, org.organization_id, obj.object_id, display=consent)

        resp = client.patch(
            _toggle_url(org, obj),
            data=json.dumps({"is_discoverable": True}),
            content_type="application/json",
        )
        assert resp.status_code == 409

    def test_allowed_with_granted_display_consent(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id)
        _seed_nagpra(db_session, org.organization_id, obj.object_id, display="granted")

        resp = client.patch(
            _toggle_url(org, obj),
            data=json.dumps({"is_discoverable": True}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["is_discoverable"] is True

    def test_unpublish_always_allowed(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, is_discoverable=True)
        _seed_nagpra(db_session, org.organization_id, obj.object_id, display="denied")

        resp = client.patch(
            _toggle_url(org, obj),
            data=json.dumps({"is_discoverable": False}),
            content_type="application/json",
        )
        assert resp.status_code == 200
        assert resp.get_json()["is_discoverable"] is False

    def test_object_without_nagpra_action_unaffected(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id)

        resp = client.patch(
            _toggle_url(org, obj),
            data=json.dumps({"is_discoverable": True}),
            content_type="application/json",
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Display gate — bulk toggle and publish-by-criteria
# ---------------------------------------------------------------------------


class TestBulkPublishGates:
    def test_bulk_toggle_skips_restricted(self, auth_setup, db_session):
        client, org, _ = auth_setup
        allowed = _seed_object(db_session, org.organization_id)
        restricted = _seed_object(db_session, org.organization_id)
        _seed_nagpra(db_session, org.organization_id, restricted.object_id, display="restricted")

        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/objects/bulk-discoverable",
            data=json.dumps({
                "object_ids": [str(allowed.object_id), str(restricted.object_id)],
                "is_discoverable": True,
            }),
            content_type="application/json",
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["updated"] == 1
        assert body["skipped"] == [
            {"object_id": str(restricted.object_id), "reason": "nagpra_display_restricted"}
        ]

        db_session.refresh(allowed)
        db_session.refresh(restricted)
        assert allowed.is_discoverable is True
        assert restricted.is_discoverable is False

    def test_bulk_unpublish_ignores_gate(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, is_discoverable=True)
        _seed_nagpra(db_session, org.organization_id, obj.object_id, display="denied")

        resp = client.post(
            f"/api/organizations/{org.organization_id}/collections/objects/bulk-discoverable",
            data=json.dumps({
                "object_ids": [str(obj.object_id)],
                "is_discoverable": False,
            }),
            content_type="application/json",
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["updated"] == 1
        assert body["skipped"] == []

    def test_publish_by_criteria_skips_restricted(self, auth_setup, db_session):
        client, org, _ = auth_setup
        allowed = _seed_object(db_session, org.organization_id, object_type="Basket")
        restricted = _seed_object(db_session, org.organization_id, object_type="Basket")
        _seed_nagpra(db_session, org.organization_id, restricted.object_id, display="restricted")

        url = f"/api/organizations/{org.organization_id}/collections/discover/publish-by-criteria"

        # Dry run reports how many matched objects are restricted
        resp = client.post(
            url,
            data=json.dumps({
                "criteria": {"object_type": "Basket"},
                "is_discoverable": True,
                "dry_run": True,
            }),
            content_type="application/json",
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["matched_count"] == 2
        assert body["restricted_count"] == 1

        # Execute skips the restricted object
        resp = client.post(
            url,
            data=json.dumps({
                "criteria": {"object_type": "Basket"},
                "is_discoverable": True,
            }),
            content_type="application/json",
        )
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["updated_count"] == 1
        assert body["skipped_restricted"] == 1

        db_session.refresh(allowed)
        db_session.refresh(restricted)
        assert allowed.is_discoverable is True
        assert restricted.is_discoverable is False


# ---------------------------------------------------------------------------
# Display gate — consent revocation unpublishes
# ---------------------------------------------------------------------------


class TestConsentRevocation:
    def test_revoking_display_consent_unpublishes(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, is_discoverable=True)
        action = _seed_nagpra(
            db_session, org.organization_id, obj.object_id, display="granted",
        )

        resp = client.put(
            f"/api/organizations/{org.organization_id}"
            f"/collections/nagpra-actions/{action.action_id}",
            data=json.dumps({"display_consent": "denied"}),
            content_type="application/json",
        )
        assert resp.status_code == 200

        db_session.refresh(obj)
        assert obj.is_discoverable is False
        assert obj.discoverable_at is None

    def test_creating_restricted_action_unpublishes(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, is_discoverable=True)

        resp = client.post(
            f"/api/organizations/{org.organization_id}"
            f"/collections/objects/{obj.object_id}/nagpra",
            data=json.dumps({"origin_type": "collections_review"}),
            content_type="application/json",
        )
        assert resp.status_code in (200, 201)

        db_session.refresh(obj)
        assert obj.is_discoverable is False


# ---------------------------------------------------------------------------
# Access gate — ingestion-time redaction in the search transformer
# ---------------------------------------------------------------------------


class TestIndexRedaction:
    SENSITIVE_KWARGS = dict(
        full_description="Ceremonial object used in restricted rituals.",
        provenance="Removed from a named burial site in 1922.",
        creation_place="Named sacred site",
        subjects=[{"term": "ceremony", "type": "topic"}],
        associated_people=[{"name": "Named individual", "role": "custodian"}],
    )

    def test_restricted_object_is_redacted(self, auth_setup, db_session):
        _, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, **self.SENSITIVE_KWARGS)
        _seed_nagpra(db_session, org.organization_id, obj.object_id, access="restricted")

        doc = CollectionObjectTransformer().transform(obj)

        for field in NAGPRA_REDACTED_FIELDS:
            assert field not in doc, f"{field} must not be indexed for restricted objects"
        # Identity fields stay indexed so staff can still locate the record
        assert doc["object_number"] == obj.object_number
        assert doc["object_id"] == str(obj.object_id)

    def test_restricted_object_gets_no_embedding_text(self, auth_setup, db_session):
        _, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, **self.SENSITIVE_KWARGS)
        _seed_nagpra(db_session, org.organization_id, obj.object_id, access="restricted")

        assert CollectionObjectTransformer().compose_semantic_text(obj) is None

    def test_granted_access_indexes_in_full(self, auth_setup, db_session):
        _, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, **self.SENSITIVE_KWARGS)
        _seed_nagpra(db_session, org.organization_id, obj.object_id, access="granted")

        transformer = CollectionObjectTransformer()
        doc = transformer.transform(obj)
        assert doc["full_description"] == self.SENSITIVE_KWARGS["full_description"]
        assert doc["provenance"] == self.SENSITIVE_KWARGS["provenance"]
        assert transformer.compose_semantic_text(obj) is not None

    def test_object_without_action_indexes_in_full(self, auth_setup, db_session):
        _, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, **self.SENSITIVE_KWARGS)

        doc = CollectionObjectTransformer().transform(obj)
        assert doc["full_description"] == self.SENSITIVE_KWARGS["full_description"]

    def test_detached_object_fails_closed(self, auth_setup, db_session):
        _, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, **self.SENSITIVE_KWARGS)
        db_session.expunge(obj)

        from app.services.nagpra_restrictions import is_access_restricted_for_index
        assert is_access_restricted_for_index(obj) is True

    def test_deleting_action_lifts_redaction(self, auth_setup, db_session):
        client, org, _ = auth_setup
        obj = _seed_object(db_session, org.organization_id, **self.SENSITIVE_KWARGS)
        action = _seed_nagpra(
            db_session, org.organization_id, obj.object_id, access="restricted",
        )
        assert CollectionObjectTransformer().compose_semantic_text(obj) is None

        resp = client.delete(
            f"/api/organizations/{org.organization_id}"
            f"/collections/nagpra-actions/{action.action_id}",
        )
        assert resp.status_code == 200

        db_session.refresh(obj)
        assert CollectionObjectTransformer().compose_semantic_text(obj) is not None
