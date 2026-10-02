"""
Tests for the CMS Extension features (Phases 1-8).

Covers:
- Phase 2/7/8: Discover config extended fields (theming, footer, integrations, analytics)
- Phase 3: Venue public API
- Phase 4: Exhibition public API
- Phase 5: Event public API (enhanced + detail)
- Discover /info endpoint returns new Phase 2/7/8 fields

Note: Content CMS tables (pages, content_blocks, menu_items) are excluded from
the SQLite test metadata, so menu/block tests require @pytest.mark.postgres.
"""

import json
import uuid
from datetime import datetime, timedelta
from unittest.mock import patch

import pytest

from app.models import (
    Organization,
    DiscoverConfig,
    Event,
    Exhibition,
    Venue,
)


# =============================================================================
# Helpers
# =============================================================================


def _create_org(db_session, slug="test-museum", name="Test Museum"):
    org = Organization(
        name=name,
        slug=slug,
        is_demo=False,
        status="active",
    )
    db_session.add(org)
    db_session.flush()
    return org


def _create_venue(db_session, org, **overrides):
    defaults = {
        "organization_id": org.organization_id,
        "name": "Main Building",
        "description": "The main museum building",
        "address": "123 Art Street, Seattle, WA 98101",
        "slug": "main-building",
        "phone": "(206) 555-0100",
        "email": "visit@testmuseum.org",
        "website_url": "https://testmuseum.org",
        "is_public": True,
        "sort_order": 0,
        "hours": {
            "monday": {"open": "10:00", "close": "17:00"},
            "tuesday": {"open": "10:00", "close": "17:00"},
            "wednesday": {"open": "10:00", "close": "21:00"},
        },
        "admission": {
            "tiers": [
                {"label": "Adults", "price": "$25"},
                {"label": "Seniors", "price": "$20"},
                {"label": "Children", "price": "Free"},
            ],
            "free_days": "First Thursday of every month",
        },
        "parking_info": "Garage underneath the building",
        "accessibility_info": "Wheelchair accessible",
        "ticketing_url": "https://tickets.testmuseum.org",
    }
    defaults.update(overrides)
    venue = Venue(**defaults)
    db_session.add(venue)
    db_session.flush()
    return venue


def _create_exhibition(db_session, org, venue=None, **overrides):
    defaults = {
        "organization_id": org.organization_id,
        "title": "Impressionist Masters",
        "description": "A survey of Impressionism",
        "exhibition_type": "temporary",
        "status": "open",
        "is_public": True,
        "public_url_slug": "impressionist-masters",
        "planned_start_date": datetime.now().date() - timedelta(days=30),
        "planned_end_date": datetime.now().date() + timedelta(days=60),
        "short_description": "Explore the world of Impressionism",
        "subtitle": "From Monet to Renoir",
        "is_featured": False,
        "tags": ["impressionism", "painting"],
    }
    if venue:
        defaults["venue_id"] = venue.venue_id
    defaults.update(overrides)
    exh = Exhibition(**defaults)
    db_session.add(exh)
    db_session.flush()
    return exh


def _create_event(db_session, org, venue=None, **overrides):
    defaults = {
        "organization_id": org.organization_id,
        "event_reference_number": f"EVT-{uuid.uuid4().hex[:6].upper()}",
        "title": "Gallery Talk: Impressionism",
        "event_type": "program",
        "status": "scheduled",
        "audience": "public",
        "start_at": datetime.now() + timedelta(days=7),
        "end_at": datetime.now() + timedelta(days=7, hours=2),
        "description": "Join us for an engaging gallery talk.",
        "slug": "gallery-talk-impressionism",
        "short_description": "A guided tour of the Impressionist galleries",
        "price": "$15",
        "price_member": "Free",
        "age_range": "All ages",
        "is_featured": False,
        "series_name": "Art Talks",
        "tags": ["talk", "impressionism"],
    }
    if venue:
        defaults["venue_id"] = venue.venue_id
    defaults.update(overrides)
    event = Event(**defaults)
    db_session.add(event)
    db_session.flush()
    return event


def _create_discover_config(db_session, org, **overrides):
    defaults = {
        "organization_id": org.organization_id,
        "page_title": "Our Collection",
        "show_object_count": True,
        "default_view_mode": "grid",
        "default_sort": "relevance",
    }
    defaults.update(overrides)
    config = DiscoverConfig(**defaults)
    db_session.add(config)
    db_session.flush()
    return config


def _post_json(auth_client, url, data):
    return auth_client.post(url, data=json.dumps(data), content_type="application/json")


def _put_json(auth_client, url, data):
    return auth_client.put(url, data=json.dumps(data), content_type="application/json")



# =============================================================================
# Phase 2/7/8: Discover Info returns extended fields
# =============================================================================


class TestDiscoverInfoExtendedFields:
    """GET /api/discover/<slug>/info returns Phase 2/7/8 config fields."""

    def test_info_returns_theming_fields(self, client, db_session):
        org = _create_org(db_session, slug="theme-museum")
        _create_discover_config(
            db_session, org,
            secondary_color="#6B7A7E",
            background_color="#F6F2EC",
            text_color="#1C1C1C",
            heading_font_family="Playfair Display",
            body_font_family="Inter",
            button_style="pill",
            header_style="transparent",
            google_fonts=["Playfair Display", "Inter"],
            custom_css=".hero { color: red; }",
        )
        db_session.commit()

        resp = client.get("/api/discover/theme-museum/info")
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["secondary_color"] == "#6B7A7E"
        assert data["background_color"] == "#F6F2EC"
        assert data["text_color"] == "#1C1C1C"
        assert data["heading_font_family"] == "Playfair Display"
        assert data["body_font_family"] == "Inter"
        assert data["button_style"] == "pill"
        assert data["header_style"] == "transparent"
        assert data["google_fonts"] == ["Playfair Display", "Inter"]
        assert data["custom_css"] == ".hero { color: red; }"

    def test_info_returns_footer_fields(self, client, db_session):
        org = _create_org(db_session, slug="footer-museum")
        _create_discover_config(
            db_session, org,
            footer_columns=[
                {"heading": "Visit", "type": "hours", "content": "Mon-Fri: 10am-5pm"},
                {"heading": "Links", "type": "links", "content": "About | /about"},
            ],
            land_acknowledgment="We acknowledge the Coast Salish people.",
        )
        db_session.commit()

        resp = client.get("/api/discover/footer-museum/info")
        assert resp.status_code == 200
        data = resp.get_json()

        assert len(data["footer_columns"]) == 2
        assert data["footer_columns"][0]["heading"] == "Visit"
        assert data["land_acknowledgment"] == "We acknowledge the Coast Salish people."

    def test_info_returns_integration_fields(self, client, db_session):
        org = _create_org(db_session, slug="integ-museum")
        _create_discover_config(
            db_session, org,
            external_integrations={
                "ticketing": {"base_url": "https://tickets.example.com", "button_text": "Buy Tickets"},
                "membership": {"url": "https://join.example.com", "button_text": "Join"},
            },
        )
        db_session.commit()

        resp = client.get("/api/discover/integ-museum/info")
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["external_integrations"]["ticketing"]["base_url"] == "https://tickets.example.com"
        assert data["external_integrations"]["membership"]["button_text"] == "Join"

    def test_info_returns_analytics_fields(self, client, db_session):
        org = _create_org(db_session, slug="analytics-museum")
        _create_discover_config(
            db_session, org,
            analytics_config={
                "ga_id": "G-TEST12345",
                "gtm_id": "GTM-TEST",
                "plausible_domain": "museum.example.com",
            },
        )
        db_session.commit()

        resp = client.get("/api/discover/analytics-museum/info")
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["analytics_config"]["ga_id"] == "G-TEST12345"
        assert data["analytics_config"]["gtm_id"] == "GTM-TEST"
        assert data["analytics_config"]["plausible_domain"] == "museum.example.com"

    def test_info_defaults_for_new_fields(self, client, db_session):
        """New fields default to None/empty when no config exists."""
        org = _create_org(db_session, slug="default-museum")
        db_session.commit()

        resp = client.get("/api/discover/default-museum/info")
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["secondary_color"] is None
        assert data["background_color"] is None
        assert data["text_color"] is None
        assert data["button_style"] == "rounded"
        assert data["header_style"] == "solid"
        assert data["google_fonts"] is None
        assert data["footer_columns"] is None
        assert data["land_acknowledgment"] is None
        assert data["external_integrations"] is None
        assert data["analytics_config"] is None


# =============================================================================
# Phase 2/7/8: Discover Config Admin API (PUT)
# =============================================================================


class TestDiscoverConfigAdmin:
    """PUT /api/organizations/<org_id>/collections/discover-config extended fields."""

    def test_update_theming_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/collections/discover-config"

        resp = _put_json(auth_client, url, {
            "secondary_color": "#AABBCC",
            "background_color": "#FFFFFF",
            "text_color": "#000000",
            "heading_font_family": "Georgia",
            "body_font_family": "Arial",
            "button_style": "pill",
            "header_style": "gradient",
            "google_fonts": ["Georgia", "Arial"],
            "custom_css": "body { font-size: 16px; }",
        })
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["secondary_color"] == "#AABBCC"
        assert data["background_color"] == "#FFFFFF"
        assert data["button_style"] == "pill"
        assert data["header_style"] == "gradient"
        assert data["google_fonts"] == ["Georgia", "Arial"]
        assert data["custom_css"] == "body { font-size: 16px; }"

    def test_update_footer_columns(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/collections/discover-config"

        columns = [
            {"heading": "Visit Us", "type": "hours", "content": "Mon-Fri: 10-5"},
            {"heading": "About", "type": "text", "content": "A world-class museum."},
        ]
        resp = _put_json(auth_client, url, {
            "footer_columns": columns,
            "land_acknowledgment": "We honor the original inhabitants.",
        })
        assert resp.status_code == 200
        data = resp.get_json()

        assert len(data["footer_columns"]) == 2
        assert data["footer_columns"][0]["heading"] == "Visit Us"
        assert data["land_acknowledgment"] == "We honor the original inhabitants."

    def test_update_external_integrations(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/collections/discover-config"

        resp = _put_json(auth_client, url, {
            "external_integrations": {
                "ticketing": {"base_url": "https://tix.example.com", "button_text": "Tickets"},
                "donate": {"url": "https://donate.example.com", "button_text": "Give"},
            },
        })
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["external_integrations"]["ticketing"]["base_url"] == "https://tix.example.com"
        assert data["external_integrations"]["donate"]["button_text"] == "Give"

    def test_update_analytics_config(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/collections/discover-config"

        resp = _put_json(auth_client, url, {
            "analytics_config": {
                "ga_id": "G-NEWID123",
                "plausible_domain": "test.org",
            },
        })
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["analytics_config"]["ga_id"] == "G-NEWID123"
        assert data["analytics_config"]["plausible_domain"] == "test.org"

    def test_invalid_button_style_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/collections/discover-config"

        resp = _put_json(auth_client, url, {"button_style": "neon"})
        assert resp.status_code in (400, 422)

    def test_invalid_header_style_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/collections/discover-config"

        resp = _put_json(auth_client, url, {"header_style": "glowing"})
        assert resp.status_code in (400, 422)

    def test_invalid_hex_color_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/collections/discover-config"

        resp = _put_json(auth_client, url, {"secondary_color": "not-a-color"})
        assert resp.status_code in (400, 422)

    def test_too_many_google_fonts_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/collections/discover-config"

        resp = _put_json(auth_client, url, {
            "google_fonts": ["A", "B", "C", "D", "E", "F"],  # 6, max is 5
        })
        assert resp.status_code in (400, 422)

    def test_too_many_footer_columns_rejected(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/collections/discover-config"

        resp = _put_json(auth_client, url, {
            "footer_columns": [
                {"heading": f"Col{i}", "type": "text", "content": "x"}
                for i in range(5)  # 5, max is 4
            ],
        })
        assert resp.status_code in (400, 422)

    def test_get_config_returns_new_fields(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup

        url = f"/api/organizations/{org.organization_id}/collections/discover-config"

        # First create config with extended fields
        _put_json(auth_client, url, {
            "secondary_color": "#112233",
            "button_style": "square",
            "external_integrations": {"shop": {"url": "https://shop.test", "button_text": "Shop"}},
        })

        # Then GET and verify
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["secondary_color"] == "#112233"
        assert data["button_style"] == "square"
        assert data["external_integrations"]["shop"]["url"] == "https://shop.test"


# =============================================================================
# Phase 3: Venue Public API
# =============================================================================


class TestVenueListPublic:
    """GET /api/discover/<org_slug>/venues"""

    def test_list_venues(self, client, db_session):
        org = _create_org(db_session, slug="venue-museum")
        _create_venue(db_session, org, name="Main Building", slug="main", sort_order=0)
        _create_venue(db_session, org, name="Annex", slug="annex", sort_order=1)
        db_session.commit()

        resp = client.get("/api/discover/venue-museum/venues")
        assert resp.status_code == 200
        data = resp.get_json()["data"]

        assert len(data) == 2
        assert data[0]["name"] == "Main Building"
        assert data[1]["name"] == "Annex"

    def test_list_excludes_private_venues(self, client, db_session):
        org = _create_org(db_session, slug="private-venue-museum")
        _create_venue(db_session, org, name="Public", slug="public", is_public=True)
        _create_venue(db_session, org, name="Private", slug="private", is_public=False)
        db_session.commit()

        resp = client.get("/api/discover/private-venue-museum/venues")
        assert resp.status_code == 200
        data = resp.get_json()["data"]

        assert len(data) == 1
        assert data[0]["name"] == "Public"

    def test_list_venues_empty(self, client, db_session):
        _create_org(db_session, slug="empty-venue-museum")
        db_session.commit()

        resp = client.get("/api/discover/empty-venue-museum/venues")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert data == []

    def test_list_venues_unknown_org(self, client, db_session):
        resp = client.get("/api/discover/nonexistent/venues")
        assert resp.status_code == 404

    def test_list_venues_returns_expected_fields(self, client, db_session):
        org = _create_org(db_session, slug="fields-museum")
        _create_venue(
            db_session, org,
            name="Gallery",
            slug="gallery",
            address="456 Museum Ave",
            phone="(555) 123-4567",
            hours={"monday": {"open": "10:00", "close": "17:00"}},
            admission={"tiers": [{"label": "Adult", "price": "$20"}]},
            ticketing_url="https://tickets.example.com",
        )
        db_session.commit()

        resp = client.get("/api/discover/fields-museum/venues")
        assert resp.status_code == 200
        venue = resp.get_json()["data"][0]

        assert venue["name"] == "Gallery"
        assert venue["slug"] == "gallery"
        assert venue["address"] == "456 Museum Ave"
        assert venue["phone"] == "(555) 123-4567"
        assert venue["hours"]["monday"]["open"] == "10:00"
        assert venue["admission"]["tiers"][0]["label"] == "Adult"
        assert venue["ticketing_url"] == "https://tickets.example.com"


class TestVenueDetailPublic:
    """GET /api/discover/<org_slug>/venues/<venue_slug>"""

    def test_get_venue_detail(self, client, db_session):
        org = _create_org(db_session, slug="detail-venue-museum")
        _create_venue(
            db_session, org,
            name="Main Gallery",
            slug="main-gallery",
            parking_info="Free parking lot",
            accessibility_info="ADA compliant",
        )
        db_session.commit()

        resp = client.get("/api/discover/detail-venue-museum/venues/main-gallery")
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["name"] == "Main Gallery"
        assert data["parking_info"] == "Free parking lot"
        assert data["accessibility_info"] == "ADA compliant"

    def test_get_venue_not_found(self, client, db_session):
        _create_org(db_session, slug="nf-venue-museum")
        db_session.commit()

        resp = client.get("/api/discover/nf-venue-museum/venues/no-such-venue")
        assert resp.status_code == 404

    def test_get_private_venue_returns_404(self, client, db_session):
        org = _create_org(db_session, slug="priv-detail-museum")
        _create_venue(db_session, org, slug="hidden", is_public=False)
        db_session.commit()

        resp = client.get("/api/discover/priv-detail-museum/venues/hidden")
        assert resp.status_code == 404

    def test_venue_detail_includes_upcoming_exhibitions(self, client, db_session):
        org = _create_org(db_session, slug="exh-venue-museum")
        venue = _create_venue(db_session, org, slug="gallery-a")
        _create_exhibition(
            db_session, org, venue=venue,
            title="Spring Show",
            public_url_slug="spring-show",
            status="open",
        )
        _create_exhibition(
            db_session, org, venue=venue,
            title="Past Show",
            public_url_slug="past-show",
            status="closed",
        )
        db_session.commit()

        resp = client.get("/api/discover/exh-venue-museum/venues/gallery-a")
        assert resp.status_code == 200
        data = resp.get_json()

        # Only open/in_preparation exhibitions should appear
        exh_titles = [e["title"] for e in data.get("exhibitions", [])]
        assert "Spring Show" in exh_titles
        assert "Past Show" not in exh_titles


# =============================================================================
# Phase 4: Exhibition Public API
# =============================================================================


class TestExhibitionListPublic:
    """GET /api/discover/<org_slug>/exhibitions"""

    def test_list_exhibitions(self, client, db_session):
        org = _create_org(db_session, slug="exh-list-museum")
        _create_exhibition(db_session, org, title="Show A", public_url_slug="show-a", status="open")
        _create_exhibition(db_session, org, title="Show B", public_url_slug="show-b", status="open")
        db_session.commit()

        resp = client.get("/api/discover/exh-list-museum/exhibitions")
        assert resp.status_code == 200
        body = resp.get_json()
        assert body["total"] >= 2

    def test_list_exhibitions_filter_by_status_open(self, client, db_session):
        org = _create_org(db_session, slug="exh-status-museum")
        _create_exhibition(db_session, org, title="Open", public_url_slug="open-show", status="open")
        _create_exhibition(db_session, org, title="Closed", public_url_slug="closed-show", status="closed")
        db_session.commit()

        resp = client.get("/api/discover/exh-status-museum/exhibitions?status=open")
        assert resp.status_code == 200
        titles = [e["title"] for e in resp.get_json()["data"]]
        assert "Open" in titles
        assert "Closed" not in titles

    def test_list_exhibitions_filter_by_status_past(self, client, db_session):
        org = _create_org(db_session, slug="exh-past-museum")
        _create_exhibition(db_session, org, title="Archived", public_url_slug="archived", status="archived")
        _create_exhibition(db_session, org, title="Current", public_url_slug="current", status="open")
        db_session.commit()

        resp = client.get("/api/discover/exh-past-museum/exhibitions?status=past")
        assert resp.status_code == 200
        titles = [e["title"] for e in resp.get_json()["data"]]
        assert "Archived" in titles
        assert "Current" not in titles

    def test_list_exhibitions_filter_by_venue(self, client, db_session):
        org = _create_org(db_session, slug="exh-venue-filter")
        venue_a = _create_venue(db_session, org, name="Venue A", slug="venue-a")
        venue_b = _create_venue(db_session, org, name="Venue B", slug="venue-b")
        _create_exhibition(db_session, org, venue=venue_a, title="At A", public_url_slug="at-a")
        _create_exhibition(db_session, org, venue=venue_b, title="At B", public_url_slug="at-b")
        db_session.commit()

        resp = client.get("/api/discover/exh-venue-filter/exhibitions?venue=venue-a")
        assert resp.status_code == 200
        titles = [e["title"] for e in resp.get_json()["data"]]
        assert "At A" in titles
        assert "At B" not in titles

    def test_list_exhibitions_filter_featured(self, client, db_session):
        org = _create_org(db_session, slug="exh-feat-museum")
        _create_exhibition(db_session, org, title="Featured", public_url_slug="feat", is_featured=True)
        _create_exhibition(db_session, org, title="Normal", public_url_slug="norm", is_featured=False)
        db_session.commit()

        resp = client.get("/api/discover/exh-feat-museum/exhibitions?featured=true")
        assert resp.status_code == 200
        titles = [e["title"] for e in resp.get_json()["data"]]
        assert "Featured" in titles
        assert "Normal" not in titles

    def test_list_exhibitions_pagination(self, client, db_session):
        org = _create_org(db_session, slug="exh-page-museum")
        for i in range(5):
            _create_exhibition(
                db_session, org,
                title=f"Show {i}",
                public_url_slug=f"show-{i}",
            )
        db_session.commit()

        resp = client.get("/api/discover/exh-page-museum/exhibitions?limit=2&offset=0")
        assert resp.status_code == 200
        body = resp.get_json()
        assert len(body["data"]) == 2
        assert body["total"] == 5

    def test_list_exhibitions_excludes_private(self, client, db_session):
        org = _create_org(db_session, slug="exh-priv-museum")
        _create_exhibition(db_session, org, title="Public", public_url_slug="pub", is_public=True)
        _create_exhibition(db_session, org, title="Private", public_url_slug="priv", is_public=False)
        db_session.commit()

        resp = client.get("/api/discover/exh-priv-museum/exhibitions")
        assert resp.status_code == 200
        titles = [e["title"] for e in resp.get_json()["data"]]
        assert "Public" in titles
        assert "Private" not in titles

    def test_list_exhibitions_unknown_org(self, client, db_session):
        resp = client.get("/api/discover/nonexistent/exhibitions")
        assert resp.status_code == 404


class TestExhibitionDetailPublic:
    """GET /api/discover/<org_slug>/exhibitions/<slug>"""

    def test_get_exhibition_detail(self, client, db_session):
        org = _create_org(db_session, slug="exh-detail-museum")
        venue = _create_venue(db_session, org, slug="main")
        _create_exhibition(
            db_session, org, venue=venue,
            title="Modern Art Now",
            public_url_slug="modern-art",
            subtitle="Contemporary Voices",
            description="A comprehensive look at modern art.",
            short_description="Modern art survey",
            credits="Curated by Jane Smith",
            visitor_info="Allow 2 hours for your visit",
            ticketing_url="https://tickets.example.com/modern-art",
            tags=["modern", "contemporary"],
        )
        db_session.commit()

        resp = client.get("/api/discover/exh-detail-museum/exhibitions/modern-art")
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["title"] == "Modern Art Now"
        assert data["subtitle"] == "Contemporary Voices"
        assert data["description"] == "A comprehensive look at modern art."
        assert data["short_description"] == "Modern art survey"
        assert data["credits"] == "Curated by Jane Smith"
        assert data["visitor_info"] == "Allow 2 hours for your visit"
        assert data["ticketing_url"] == "https://tickets.example.com/modern-art"
        assert "modern" in data["tags"]

    def test_get_exhibition_not_found(self, client, db_session):
        _create_org(db_session, slug="exh-nf-museum")
        db_session.commit()

        resp = client.get("/api/discover/exh-nf-museum/exhibitions/no-such-show")
        assert resp.status_code == 404

    def test_get_private_exhibition_returns_404(self, client, db_session):
        org = _create_org(db_session, slug="exh-priv-detail")
        _create_exhibition(
            db_session, org,
            public_url_slug="hidden-show",
            is_public=False,
        )
        db_session.commit()

        resp = client.get("/api/discover/exh-priv-detail/exhibitions/hidden-show")
        assert resp.status_code == 404

    def test_exhibition_detail_includes_venue_info(self, client, db_session):
        org = _create_org(db_session, slug="exh-venue-detail")
        venue = _create_venue(db_session, org, name="West Wing", slug="west-wing")
        _create_exhibition(
            db_session, org, venue=venue,
            title="Sculpture Garden",
            public_url_slug="sculpture-garden",
        )
        db_session.commit()

        resp = client.get("/api/discover/exh-venue-detail/exhibitions/sculpture-garden")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("venue_name") == "West Wing"
        assert data.get("venue_slug") == "west-wing"


# =============================================================================
# Phase 5: Event Public API
# =============================================================================


class TestEventListPublic:
    """GET /api/discover/<org_slug>/events — enhanced filters."""

    def test_list_public_events(self, client, db_session):
        org = _create_org(db_session, slug="evt-list-museum")
        _create_event(db_session, org, slug="talk-1")
        _create_event(db_session, org, slug="talk-2")
        db_session.commit()

        resp = client.get("/api/discover/evt-list-museum/events")
        assert resp.status_code == 200
        data = resp.get_json()["data"]
        assert len(data) >= 2

    def test_list_events_excludes_non_public(self, client, db_session):
        org = _create_org(db_session, slug="evt-priv-museum")
        _create_event(db_session, org, slug="public-evt", audience="public")
        _create_event(db_session, org, slug="internal-evt", audience="internal")
        db_session.commit()

        resp = client.get("/api/discover/evt-priv-museum/events")
        assert resp.status_code == 200
        slugs = [e.get("slug", "") for e in resp.get_json()["data"]]
        assert "public-evt" in slugs
        assert "internal-evt" not in slugs

    def test_list_events_filter_by_venue(self, client, db_session):
        org = _create_org(db_session, slug="evt-venue-museum")
        venue = _create_venue(db_session, org, slug="hall-a")
        _create_event(db_session, org, venue=venue, slug="at-hall")
        _create_event(db_session, org, slug="no-venue")
        db_session.commit()

        resp = client.get("/api/discover/evt-venue-museum/events?venue=hall-a")
        assert resp.status_code == 200
        slugs = [e.get("slug", "") for e in resp.get_json()["data"]]
        assert "at-hall" in slugs
        assert "no-venue" not in slugs

    def test_list_events_filter_by_series(self, client, db_session):
        org = _create_org(db_session, slug="evt-series-museum")
        _create_event(db_session, org, slug="art-talk", series_name="Art Talks")
        _create_event(db_session, org, slug="film-night", series_name="Film Nights")
        db_session.commit()

        resp = client.get("/api/discover/evt-series-museum/events?series=Art%20Talks")
        assert resp.status_code == 200
        slugs = [e.get("slug", "") for e in resp.get_json()["data"]]
        assert "art-talk" in slugs
        assert "film-night" not in slugs

    def test_list_events_filter_by_date_range(self, client, db_session):
        org = _create_org(db_session, slug="evt-date-museum")
        now = datetime.now()
        _create_event(
            db_session, org, slug="next-week",
            start_at=now + timedelta(days=7),
            end_at=now + timedelta(days=7, hours=2),
        )
        _create_event(
            db_session, org, slug="next-month",
            start_at=now + timedelta(days=35),
            end_at=now + timedelta(days=35, hours=2),
        )
        db_session.commit()

        date_from = (now + timedelta(days=1)).strftime("%Y-%m-%d")
        date_to = (now + timedelta(days=14)).strftime("%Y-%m-%d")
        resp = client.get(f"/api/discover/evt-date-museum/events?date_from={date_from}&date_to={date_to}")
        assert resp.status_code == 200
        slugs = [e.get("slug", "") for e in resp.get_json()["data"]]
        assert "next-week" in slugs
        assert "next-month" not in slugs

    def test_list_events_returns_extended_fields(self, client, db_session):
        org = _create_org(db_session, slug="evt-fields-museum")
        _create_event(
            db_session, org,
            slug="rich-event",
            price="$25",
            price_member="$15",
            age_range="12+",
            is_featured=True,
            series_name="Signature Series",
            tags=["art", "lecture"],
            short_description="A rich event",
        )
        db_session.commit()

        resp = client.get("/api/discover/evt-fields-museum/events")
        assert resp.status_code == 200
        event = next(
            (e for e in resp.get_json()["data"] if e.get("slug") == "rich-event"),
            None,
        )
        assert event is not None
        assert event["price"] == "$25"
        assert event["price_member"] == "$15"
        assert event["age_range"] == "12+"
        assert event["is_featured"] is True
        assert event["series_name"] == "Signature Series"
        assert event["short_description"] == "A rich event"

    def test_list_events_unknown_org(self, client, db_session):
        resp = client.get("/api/discover/nonexistent/events")
        assert resp.status_code == 404


class TestEventDetailPublic:
    """GET /api/discover/<org_slug>/events/<slug>"""

    def test_get_event_detail(self, client, db_session):
        org = _create_org(db_session, slug="evt-detail-museum")
        _create_event(
            db_session, org,
            title="Opening Night",
            slug="opening-night",
            description="A grand opening celebration",
            short_description="Grand opening",
            price="$50",
            price_member="$30",
            age_range="21+",
            series_name="Galas",
            tags=["gala", "opening"],
        )
        db_session.commit()

        resp = client.get("/api/discover/evt-detail-museum/events/opening-night")
        assert resp.status_code == 200
        data = resp.get_json()

        assert data["title"] == "Opening Night"
        assert data["slug"] == "opening-night"
        assert data["description"] == "A grand opening celebration"
        assert data["short_description"] == "Grand opening"
        assert data["price"] == "$50"
        assert data["price_member"] == "$30"
        assert data["age_range"] == "21+"
        assert data["series_name"] == "Galas"
        assert "gala" in data["tags"]

    def test_get_event_not_found(self, client, db_session):
        _create_org(db_session, slug="evt-nf-museum")
        db_session.commit()

        resp = client.get("/api/discover/evt-nf-museum/events/no-such-event")
        assert resp.status_code == 404

    def test_get_non_public_event_returns_404(self, client, db_session):
        org = _create_org(db_session, slug="evt-priv-detail")
        _create_event(db_session, org, slug="internal-only", audience="internal")
        db_session.commit()

        resp = client.get("/api/discover/evt-priv-detail/events/internal-only")
        assert resp.status_code == 404

    def test_event_detail_includes_venue_info(self, client, db_session):
        org = _create_org(db_session, slug="evt-venue-detail")
        venue = _create_venue(db_session, org, name="Grand Hall", slug="grand-hall")
        _create_event(db_session, org, venue=venue, slug="hall-event")
        db_session.commit()

        resp = client.get("/api/discover/evt-venue-detail/events/hall-event")
        assert resp.status_code == 200
        data = resp.get_json()
        assert data.get("venue_name") == "Grand Hall"
        assert data.get("venue_slug") == "grand-hall"

    def test_event_detail_includes_linked_exhibition(self, client, db_session):
        org = _create_org(db_session, slug="evt-exh-link")
        exh = _create_exhibition(
            db_session, org,
            title="Related Show",
            public_url_slug="related-show",
        )
        _create_event(
            db_session, org,
            slug="exh-event",
            exhibition_id=exh.exhibition_id,
        )
        db_session.commit()

        resp = client.get("/api/discover/evt-exh-link/events/exh-event")
        assert resp.status_code == 200
        data = resp.get_json()

        exh_data = data.get("exhibition")
        assert exh_data is not None
        assert exh_data["title"] == "Related Show"
        assert exh_data["public_url_slug"] == "related-show"
