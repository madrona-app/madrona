"""Tests for the organization collection scope profile (issue #77).

Covers the API round-trip and the Guide scope-block builder that surfaces
collection coverage/limitations to the agent.
"""

import pytest

from app.models import OrganizationCollectionProfile
from app.services.collection_scope import build_collection_scope_block

pytestmark = pytest.mark.postgres


class TestCollectionProfileAPI:
    def test_get_empty_profile_returns_shell(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.get(f"/api/organizations/{org.organization_id}/collection-profile")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["organization_id"] == str(org.organization_id)
        assert data["scope_note"] is None

    def test_put_then_get_round_trips(self, auth_setup):
        client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/collection-profile"
        body = {
            "scope_note": "Regional fine art, 1850-1950.",
            "coverage": {"date_range": "1850-1950", "record_types": ["paintings", "prints"]},
            "completeness": "partial",
            "extent_note": "~4,000 of an estimated 12,000 objects cataloged.",
            "known_gaps": "Works on paper not yet digitized; no provenance for WWII-era acquisitions.",
            "digitization_status": "partial",
        }
        put = client.put(url, json=body)
        assert put.status_code == 200, put.get_json()

        got = client.get(url).get_json()
        assert got["completeness"] == "partial"
        assert got["digitization_status"] == "partial"
        assert got["coverage"]["date_range"] == "1850-1950"
        assert "Works on paper" in got["known_gaps"]

    def test_put_rejects_invalid_completeness(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.put(
            f"/api/organizations/{org.organization_id}/collection-profile",
            json={"completeness": "totally-complete"},
        )
        assert resp.status_code in (400, 422)


class TestScopeBlockBuilder:
    def test_returns_none_without_profile(self, db_session, auth_setup):
        _, org, _ = auth_setup
        assert build_collection_scope_block(db_session, org.organization_id) is None

    def test_renders_disclosure_block(self, db_session, auth_setup):
        _, org, _ = auth_setup
        db_session.add(OrganizationCollectionProfile(
            organization_id=org.organization_id,
            scope_note="Regional fine art.",
            coverage={"date_range": "1850-1950", "record_types": ["paintings", "prints"]},
            completeness="partial",
            extent_note="~4,000 of ~12,000 cataloged.",
            known_gaps="Works on paper not digitized.",
            digitization_status="partial",
        ))
        db_session.commit()

        block = build_collection_scope_block(db_session, org.organization_id)
        assert block is not None
        # Carries the disclosure instruction so the agent can't imply completeness.
        assert "Collection scope" in block
        assert "DISCLOSE" in block
        # Renders the structured fields.
        assert "Completeness: partial" in block
        assert "Digitization: partial" in block
        assert "Works on paper not digitized" in block
        assert "paintings, prints" in block

    def test_empty_profile_renders_nothing(self, db_session, auth_setup):
        _, org, _ = auth_setup
        db_session.add(OrganizationCollectionProfile(organization_id=org.organization_id))
        db_session.commit()
        assert build_collection_scope_block(db_session, org.organization_id) is None
