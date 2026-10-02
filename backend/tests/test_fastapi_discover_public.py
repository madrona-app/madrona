"""
Tests for discover_public FastAPI router — 12 public endpoints.
"""

import uuid
from datetime import datetime, timedelta

import pytest

from app.database import get_db
from app.services.auth_utils import generate_access_token, hash_password


# ---------------------------------------------------------------------------
# App fixture
# ---------------------------------------------------------------------------


@pytest.fixture(scope="session")
def fastapi_discover_app():
    from fastapi import FastAPI
    from app.fastapi_app.routers.discover_public import router as discover_public_router
    from app.fastapi_app.exception_handlers import register_exception_handlers
    from app.fastapi_app.middleware.csrf import CSRFMiddleware
    from app.fastapi_app.middleware.content_type import ContentTypeMiddleware
    from app.fastapi_app.middleware.security_headers import SecurityHeadersMiddleware
    from app.fastapi_app.middleware.request_logging import RequestLoggingMiddleware

    app = FastAPI()
    app.add_middleware(CSRFMiddleware)
    app.add_middleware(ContentTypeMiddleware)
    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RequestLoggingMiddleware)

    register_exception_handlers(app)
    app.include_router(discover_public_router)

    return app


@pytest.fixture()
def client(fastapi_discover_app, app, db_session):
    from fastapi.testclient import TestClient
    from app.database import get_admin_db

    def _override_session():
        # The discover_public router was flipped from get_db to
        # get_admin_db (May 14 2026) — these are intentional public
        # endpoints that don't need RLS because access control is
        # the SQL-level is_published / is_discoverable filters.
        # Override both names so this local test fixture works either
        # way; in tests we route both back to the seed db_session.
        yield db_session

    fastapi_discover_app.dependency_overrides[get_db] = _override_session
    fastapi_discover_app.dependency_overrides[get_admin_db] = _override_session

    with TestClient(fastapi_discover_app) as c:
        yield c

    fastapi_discover_app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Shared fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def test_org(db_session):
    from app.models import Organization
    org = Organization(
        name="Discover Test Museum",
        slug=f"discover-test-{uuid.uuid4().hex[:8]}",
        status="active",
        is_demo=False,
        timezone="America/New_York",
    )
    db_session.add(org)
    db_session.flush()
    return org


@pytest.fixture()
def test_object(db_session, test_org):
    from app.models import CollectionObject
    obj = CollectionObject(
        object_id=uuid.uuid4(),
        organization_id=test_org.organization_id,
        object_number="2024.001",
        brief_description="A test object",
        object_type="painting",
        is_discoverable=True,
    )
    db_session.add(obj)
    db_session.flush()
    return obj


@pytest.fixture()
def test_config(db_session, test_org):
    from app.models import DiscoverConfig
    config = DiscoverConfig(
        organization_id=test_org.organization_id,
        page_title="Explore Our Collection",
        page_subtitle="Discover art and artifacts",
        show_object_count=True,
        default_view_mode="grid",
        default_sort="relevance",
    )
    db_session.add(config)
    db_session.flush()
    return config


@pytest.fixture()
def test_venue(db_session, test_org):
    from app.models import Venue
    venue = Venue(
        venue_id=uuid.uuid4(),
        organization_id=test_org.organization_id,
        name="Main Gallery",
        slug=f"main-gallery-{uuid.uuid4().hex[:8]}",
        description="The main exhibition space",
        is_public=True,
        sort_order=0,
    )
    db_session.add(venue)
    db_session.flush()
    return venue


@pytest.fixture()
def test_exhibition(db_session, test_org, test_venue):
    from app.models import Exhibition
    exh = Exhibition(
        exhibition_id=uuid.uuid4(),
        organization_id=test_org.organization_id,
        title="Modern Art Show",
        public_url_slug=f"modern-art-{uuid.uuid4().hex[:8]}",
        exhibition_type="temporary",
        status="open",
        is_public=True,
        venue_id=test_venue.venue_id,
        planned_start_date=datetime.now().date(),
        planned_end_date=(datetime.now() + timedelta(days=90)).date(),
        short_description="A showcase of modern art",
    )
    db_session.add(exh)
    db_session.flush()
    return exh


@pytest.fixture()
def test_location(db_session, test_org):
    from app.models import Location
    loc = Location(
        location_id=uuid.uuid4(),
        organization_id=test_org.organization_id,
        name="Room A",
        code=f"ROOM-A-{uuid.uuid4().hex[:6]}",
        path="/room-a",
        depth=0,
        location_type="room",
        status="active",
    )
    db_session.add(loc)
    db_session.flush()
    return loc


@pytest.fixture()
def test_event(db_session, test_org, test_venue, test_location):
    from app.models import Event
    event = Event(
        event_id=uuid.uuid4(),
        organization_id=test_org.organization_id,
        title="Gallery Talk",
        slug=f"gallery-talk-{uuid.uuid4().hex[:8]}",
        event_reference_number=f"EVT-{uuid.uuid4().hex[:8]}",
        event_type="program",
        status="scheduled",
        audience="public",
        start_at=datetime.now() + timedelta(days=7),
        end_at=datetime.now() + timedelta(days=7, hours=2),
        description="A guided gallery talk",
        short_description="Join us for a talk",
        venue_id=test_venue.venue_id,
        location_id=test_location.location_id,
        is_featured=True,
    )
    db_session.add(event)
    db_session.flush()
    return event


@pytest.fixture()
def test_constituent(db_session, test_org):
    """A STAFF constituent: linked to a user account.

    The link is what makes this person staff — see Constituent.user_id. The
    public staff endpoint lists only linked constituents, because
    `constituent_type == "person"` also covers donors, lenders, collectors and
    artists' estates, and the endpoint is anonymous and returns email.
    """
    from app.models import Constituent, User
    u = User(
        user_id=uuid.uuid4(),
        email="jane.doe@example.com",
        email_status="verified",
        status="active",
        mfa_version=0,
        recovery_codes_required=False,
    )
    db_session.add(u)
    db_session.flush()
    c = Constituent(
        constituent_id=uuid.uuid4(),
        organization_id=test_org.organization_id,
        user_id=u.user_id,
        name="Jane Doe",
        display_name="Dr. Jane Doe",
        constituent_type="person",
        is_active=True,
        department="Curatorial",
        role="Curator",
        sort_name="Doe, Jane",
    )
    db_session.add(c)
    db_session.flush()
    return c


@pytest.fixture
def test_donor_constituent(db_session, test_org):
    """A person who is NOT staff: no user account. Must never be published."""
    from app.models import Constituent
    c = Constituent(
        constituent_id=uuid.uuid4(),
        organization_id=test_org.organization_id,
        name="Wealthy Donor",
        display_name="Wealthy Donor",
        constituent_type="person",
        is_active=True,
        department="Curatorial",
        email="donor@private.example.com",
        sort_name="Donor, Wealthy",
    )
    db_session.add(c)
    db_session.flush()
    return c


# ---------------------------------------------------------------------------
# Tests: Info endpoint
# ---------------------------------------------------------------------------


class TestDiscoverInfo:
    def test_get_info(self, client, test_org, test_config, test_object):
        resp = client.get(f"/api/discover/{test_org.slug}/info")
        assert resp.status_code == 200
        data = resp.json()
        assert data["organization_name"] == "Discover Test Museum"
        assert data["total_discoverable"] >= 1
        assert data["page_title"] == "Explore Our Collection"

    def test_get_info_not_found(self, client):
        resp = client.get("/api/discover/nonexistent-slug/info")
        assert resp.status_code == 404

    def test_get_info_no_config(self, client, test_org):
        resp = client.get(f"/api/discover/{test_org.slug}/info")
        assert resp.status_code == 200
        data = resp.json()
        assert data["page_title"] is None


# ---------------------------------------------------------------------------
# Tests: Search endpoint
# ---------------------------------------------------------------------------


class TestDiscoverSearch:
    def test_search_no_opensearch(self, client, test_org):
        resp = client.get(f"/api/discover/{test_org.slug}/search")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] == 0
        assert data["hits"] == []

    def test_search_not_found(self, client):
        resp = client.get("/api/discover/nonexistent/search")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Tests: Object detail
# ---------------------------------------------------------------------------


class TestDiscoverObject:
    def test_get_object_by_uuid(self, client, test_org, test_object):
        resp = client.get(f"/api/discover/{test_org.slug}/objects/{test_object.object_id}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["object_id"] == str(test_object.object_id)
        assert data["object_number"] == "2024.001"
        assert data["object_type"] == "painting"

    def test_get_object_by_number(self, client, test_org, test_object):
        resp = client.get(f"/api/discover/{test_org.slug}/objects/2024.001")
        assert resp.status_code == 200
        data = resp.json()
        assert data["object_id"] == str(test_object.object_id)

    def test_get_object_not_found(self, client, test_org):
        resp = client.get(f"/api/discover/{test_org.slug}/objects/{uuid.uuid4()}")
        assert resp.status_code == 404

    def test_get_object_org_not_found(self, client):
        resp = client.get(f"/api/discover/nonexistent/objects/{uuid.uuid4()}")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Tests: Related objects
# ---------------------------------------------------------------------------


class TestRelatedObjects:
    def test_related_no_opensearch(self, client, test_org, test_object):
        resp = client.get(f"/api/discover/{test_org.slug}/objects/{test_object.object_id}/related")
        assert resp.status_code == 200
        data = resp.json()
        assert data["hits"] == []

    def test_related_not_found(self, client, test_org):
        resp = client.get(f"/api/discover/{test_org.slug}/objects/{uuid.uuid4()}/related")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Tests: Featured objects
# ---------------------------------------------------------------------------


class TestFeaturedObjects:
    def test_featured_no_config(self, client, test_org):
        resp = client.get(f"/api/discover/{test_org.slug}/featured")
        assert resp.status_code == 200
        assert resp.json()["hits"] == []

    def test_featured_with_config(self, client, test_org, test_config, test_object, db_session):
        test_config.featured_object_ids = [str(test_object.object_id)]
        db_session.flush()
        resp = client.get(f"/api/discover/{test_org.slug}/featured")
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["hits"]) == 1
        assert data["hits"][0]["object_id"] == str(test_object.object_id)

    def test_featured_not_found(self, client):
        resp = client.get("/api/discover/nonexistent/featured")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Tests: Events
# ---------------------------------------------------------------------------


class TestPublicEvents:
    def test_list_events(self, client, test_org, test_event):
        resp = client.get(f"/api/discover/{test_org.slug}/events")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        assert data["data"][0]["title"] == "Gallery Talk"

    def test_list_events_not_found(self, client):
        resp = client.get("/api/discover/nonexistent/events")
        assert resp.status_code == 404

    def test_get_event_detail(self, client, test_org, test_event):
        resp = client.get(f"/api/discover/{test_org.slug}/events/{test_event.slug}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Gallery Talk"
        assert data["venue_name"] == "Main Gallery"

    def test_get_event_not_found(self, client, test_org):
        resp = client.get(f"/api/discover/{test_org.slug}/events/nonexistent-slug")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Tests: Staff
# ---------------------------------------------------------------------------


class TestPublicStaff:
    def test_list_staff(self, client, test_org, test_constituent):
        resp = client.get(f"/api/discover/{test_org.slug}/staff")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        assert data["data"][0]["name"] == "Dr. Jane Doe"
        assert data["data"][0]["department"] == "Curatorial"

    def test_list_staff_filter_department(self, client, test_org, test_constituent):
        resp = client.get(f"/api/discover/{test_org.slug}/staff?department=Curatorial")
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1

        resp = client.get(f"/api/discover/{test_org.slug}/staff?department=Marketing")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    def test_list_staff_not_found(self, client):
        resp = client.get("/api/discover/nonexistent/staff")
        assert resp.status_code == 404

    def test_non_staff_person_is_not_published(
        self, client, test_org, test_constituent, test_donor_constituent
    ):
        """Donors, lenders and other person constituents are not staff.

        Constituent is the unified person/organization record, so filtering on
        constituent_type == "person" published the institution's whole contact
        book — names, emails and biographies — to an anonymous caller on a
        BYPASSRLS session. Only constituents linked to a user account are staff.
        """
        resp = client.get(f"/api/discover/{test_org.slug}/staff")
        assert resp.status_code == 200
        names = [row["name"] for row in resp.json()["data"]]
        emails = [row["email"] for row in resp.json()["data"]]
        assert "Dr. Jane Doe" in names
        assert "Wealthy Donor" not in names
        assert "donor@private.example.com" not in emails

    def test_department_filter_does_not_reach_non_staff(
        self, client, test_org, test_donor_constituent
    ):
        """The donor shares the staff member's department; that must not
        smuggle them into a filtered listing."""
        resp = client.get(f"/api/discover/{test_org.slug}/staff?department=Curatorial")
        assert resp.status_code == 200
        assert all(row["name"] != "Wealthy Donor" for row in resp.json()["data"])


# ---------------------------------------------------------------------------
# Tests: Venues
# ---------------------------------------------------------------------------


class TestPublicVenues:
    def test_list_venues(self, client, test_org, test_venue):
        resp = client.get(f"/api/discover/{test_org.slug}/venues")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        assert data["data"][0]["name"] == "Main Gallery"

    def test_get_venue_detail(self, client, test_org, test_venue, test_exhibition):
        resp = client.get(f"/api/discover/{test_org.slug}/venues/{test_venue.slug}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["name"] == "Main Gallery"
        assert len(data["exhibitions"]) >= 1

    def test_get_venue_not_found(self, client, test_org):
        resp = client.get(f"/api/discover/{test_org.slug}/venues/nonexistent")
        assert resp.status_code == 404

    def test_list_venues_not_found(self, client):
        resp = client.get("/api/discover/nonexistent/venues")
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# Tests: Exhibitions
# ---------------------------------------------------------------------------


class TestPublicExhibitions:
    def test_list_exhibitions(self, client, test_org, test_exhibition):
        resp = client.get(f"/api/discover/{test_org.slug}/exhibitions")
        assert resp.status_code == 200
        data = resp.json()
        assert data["total"] >= 1
        assert data["data"][0]["title"] == "Modern Art Show"

    def test_list_exhibitions_filter_status(self, client, test_org, test_exhibition):
        resp = client.get(f"/api/discover/{test_org.slug}/exhibitions?status=open")
        assert resp.status_code == 200
        assert resp.json()["total"] >= 1

        resp = client.get(f"/api/discover/{test_org.slug}/exhibitions?status=past")
        assert resp.status_code == 200
        assert resp.json()["total"] == 0

    def test_get_exhibition_detail(self, client, test_org, test_exhibition):
        resp = client.get(f"/api/discover/{test_org.slug}/exhibitions/{test_exhibition.public_url_slug}")
        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "Modern Art Show"
        assert data["venue_name"] == "Main Gallery"

    def test_get_exhibition_not_found(self, client, test_org):
        resp = client.get(f"/api/discover/{test_org.slug}/exhibitions/nonexistent")
        assert resp.status_code == 404

    def test_list_exhibitions_not_found(self, client):
        resp = client.get("/api/discover/nonexistent/exhibitions")
        assert resp.status_code == 404
