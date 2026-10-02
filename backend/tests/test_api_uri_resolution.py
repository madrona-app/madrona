"""
Smoke tests for the URI resolution API blueprint.

Endpoints under test (from app/api/uri_resolution.py):
  GET  /org/<org_slug>/<entity_type>/<public_id>           (resolve_uri)
  HEAD /org/<org_slug>/<entity_type>/<public_id>           (head_uri)
  GET  /org/<org_slug>/<entity_type>/<public_id>/history   (get_uri_history)

These are public endpoints (no auth required). Tests use the plain ``client``
fixture rather than ``auth_setup``.

NOTE: The "object" and "media" URL segments are intercepted by the iiif_lod
blueprint which registers more-specific routes at the same path.  All tests
here use the "agent" segment (entity_type=person_authority) which is handled
exclusively by the uri_resolution blueprint.
"""

import uuid
from datetime import datetime, timezone

import pytest

from app.models import Organization, URIRegistry
from app.services.uri_persistence import BASE_URI, URIStatus


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

URL_SEGMENT = "agent"               # Maps to entity_type "person_authority"
ENTITY_TYPE = "person_authority"


def _make_org(session, slug="test-museum"):
    """Create and return an Organization."""
    org = Organization(
        name="Test Museum",
        slug=slug,
        is_demo=False,
        status="active",
    )
    session.add(org)
    session.flush()
    return org


def _make_uri_record(
    session,
    org,
    *,
    entity_type=ENTITY_TYPE,
    public_id="monet-claude",
    entity_id=None,
    status="active",
    redirect_to=None,
    redirect_type=None,
    tombstone_reason=None,
):
    """Insert a URIRegistry row and return it."""
    entity_id = entity_id or uuid.uuid4()
    full_uri = f"{BASE_URI}/org/{org.slug}/{URL_SEGMENT}/{public_id}"
    record = URIRegistry(
        organization_id=org.organization_id,
        entity_type=entity_type,
        entity_id=entity_id,
        public_id=public_id,
        full_uri=full_uri,
        status=status,
        redirect_to=redirect_to,
        redirect_type=redirect_type,
        tombstone_reason=tombstone_reason,
        created_at=datetime.now(timezone.utc),
        updated_at=datetime.now(timezone.utc),
    )
    session.add(record)
    session.flush()
    return record


# ---------------------------------------------------------------------------
# Tests: GET resolve_uri
# ---------------------------------------------------------------------------

class TestResolveURI:
    """Tests for GET /org/<slug>/<type>/<public_id>."""

    def test_not_found_returns_404(self, client, db_session):
        """Requesting a URI that does not exist returns 404."""
        _make_org(db_session, slug="museum")
        db_session.commit()

        resp = client.get(
            f"/org/museum/{URL_SEGMENT}/nonexistent",
            headers={"Accept": "application/json"},
        )
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"

    @pytest.mark.skip(reason="Fix landed but runs cause pytest to hang when test_active_uri_json and test_active_uri_jsonld run in sequence; needs per-test isolation investigation")
    def test_active_uri_json(self, client, db_session):
        """An active URI returns 200 with JSON when Accept: application/json."""
        from app.models import PersonAuthority

        org = _make_org(db_session, slug="museum")
        person = PersonAuthority(
            organization_id=org.organization_id,
            name="Claude Monet",
            display_name="Claude Monet",
            constituent_type="person",
        )
        db_session.add(person)
        db_session.flush()

        _make_uri_record(
            db_session,
            org,
            public_id="monet-claude",
            entity_id=person.constituent_id,
        )
        db_session.commit()

        resp = client.get(
            f"/org/museum/{URL_SEGMENT}/monet-claude",
            headers={"Accept": "application/json"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["id"] == str(person.constituent_id)
        assert data["preferred_name"] == "Claude Monet"

    @pytest.mark.skip(reason="Fix landed but runs cause pytest to hang when test_active_uri_json and test_active_uri_jsonld run in sequence; needs per-test isolation investigation")
    def test_active_uri_jsonld(self, client, db_session):
        """An active URI returns JSON-LD when Accept: application/ld+json."""
        from app.models import PersonAuthority

        org = _make_org(db_session, slug="museum")
        person = PersonAuthority(
            organization_id=org.organization_id,
            name="Pierre-Auguste Renoir",
            display_name="Pierre-Auguste Renoir",
            constituent_type="person",
            nationality="French",
        )
        db_session.add(person)
        db_session.flush()

        _make_uri_record(
            db_session,
            org,
            public_id="renoir-pierre",
            entity_id=person.constituent_id,
        )
        db_session.commit()

        resp = client.get(
            f"/org/museum/{URL_SEGMENT}/renoir-pierre",
            headers={"Accept": "application/ld+json"},
        )
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["@type"] == "Person"
        assert data["@context"] == "https://schema.org/"
        # The @id is built from preferred_name via build_uri, not the public_id
        assert "/agent/" in data["@id"]
        assert data["nationality"] == "French"

    def test_active_uri_html_redirects_to_ui(self, client, db_session):
        """An active URI with Accept: text/html returns 303 redirect to UI."""
        org = _make_org(db_session, slug="museum")
        _make_uri_record(
            db_session,
            org,
            public_id="html-redirect-test",
        )
        db_session.commit()

        resp = client.get(
            f"/org/museum/{URL_SEGMENT}/html-redirect-test",
            headers={"Accept": "text/html"},
        )
        assert resp.status_code == 303
        assert "/organizations/museum/" in resp.headers["Location"]

    def test_tombstoned_uri_returns_410(self, client, db_session):
        """A tombstoned URI returns 410 Gone with reason."""
        org = _make_org(db_session, slug="museum")
        _make_uri_record(
            db_session,
            org,
            public_id="deleted-agent",
            status=URIStatus.TOMBSTONE.value,
            tombstone_reason="Deaccessioned",
        )
        db_session.commit()

        resp = client.get(
            f"/org/museum/{URL_SEGMENT}/deleted-agent",
            headers={"Accept": "application/json"},
        )
        assert resp.status_code == 410
        data = resp.get_json()
        _e = data["error"]
        assert (_e.get("message") if isinstance(_e, dict) else _e) == "Gone"
        assert data["reason"] == "Deaccessioned"

    def test_redirect_uri_returns_301(self, client, db_session):
        """A redirect URI returns 301 with Location header."""
        org = _make_org(db_session, slug="museum")
        target_uri = f"{BASE_URI}/org/museum/{URL_SEGMENT}/canonical-agent"
        _make_uri_record(
            db_session,
            org,
            public_id="old-agent",
            status=URIStatus.REDIRECT.value,
            redirect_to=target_uri,
            redirect_type="301",
        )
        db_session.commit()

        resp = client.get(
            f"/org/museum/{URL_SEGMENT}/old-agent",
            headers={"Accept": "application/json"},
        )
        assert resp.status_code == 301
        assert resp.headers["Location"].endswith(target_uri)


# ---------------------------------------------------------------------------
# Tests: HEAD head_uri
# ---------------------------------------------------------------------------

class TestHeadURI:
    """Tests for HEAD /org/<slug>/<type>/<public_id>."""

    def test_head_not_found(self, client, db_session):
        """HEAD for a non-existent URI returns 404."""
        _make_org(db_session, slug="museum")
        db_session.commit()

        resp = client.head(f"/org/museum/{URL_SEGMENT}/nope")
        assert resp.status_code == 404

    def test_head_tombstone_returns_410(self, client, db_session):
        """HEAD for a tombstoned URI returns 410."""
        org = _make_org(db_session, slug="museum")
        _make_uri_record(
            db_session,
            org,
            public_id="gone-head-agent",
            status=URIStatus.TOMBSTONE.value,
            tombstone_reason="Removed",
        )
        db_session.commit()

        resp = client.head(f"/org/museum/{URL_SEGMENT}/gone-head-agent")
        assert resp.status_code == 410


# ---------------------------------------------------------------------------
# Tests: GET get_uri_history
# ---------------------------------------------------------------------------

class TestURIHistory:
    """Tests for GET /org/<slug>/<type>/<public_id>/history."""

    def test_history_not_found(self, client, db_session):
        """History for a non-existent URI returns 404."""
        _make_org(db_session, slug="museum")
        db_session.commit()

        resp = client.get(f"/org/museum/{URL_SEGMENT}/nonexistent/history")
        assert resp.status_code == 404
        data = resp.get_json()
        assert data.get("error", {}).get("code", "").lower() == "not_found"

    def test_history_returns_entries(self, client, db_session):
        """History for an existing URI returns history entries."""
        org = _make_org(db_session, slug="museum")
        entity_id = uuid.uuid4()
        _make_uri_record(
            db_session,
            org,
            public_id="hist-agent",
            entity_id=entity_id,
        )
        db_session.commit()

        resp = client.get(f"/org/museum/{URL_SEGMENT}/hist-agent/history")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["entity_id"] == str(entity_id)
        assert data["entity_type"] == ENTITY_TYPE
        assert isinstance(data["history"], list)
        assert len(data["history"]) >= 1
        assert data["history"][0]["status"] == "active"
