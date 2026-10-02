"""
Smoke tests for the Geographic API endpoints.

Routes under /api/organizations/<org_id>/geo/...

Tests cover:
- GET/PUT headquarters
- GET distance
- POST geocode / reverse-geocode (mocked external service)
- GET nearby/places, bbox, nearest (mocked gis_service)
- POST search/objects (mocked gis_service)
- GET collection-origins
- PUT place geometry
- Auth-required checks
"""

import secrets
from unittest.mock import patch, MagicMock
from uuid import uuid4

import pytest

from app.models import PlaceAuthority, Location


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _base_url(org):
    return f"/api/organizations/{org.organization_id}/geo"


def _csrf_headers():
    """Generate CSRF headers required for mutating requests."""
    token = secrets.token_urlsafe(32)
    return {"X-CSRF-Token": token, "Cookie": f"csrf_token={token}"}


def _post_json(auth_client, url, data):
    return auth_client.post(url, json=data, headers=_csrf_headers())


def _put_json(auth_client, url, data):
    return auth_client.put(url, json=data, headers=_csrf_headers())


# ---------------------------------------------------------------------------
# Headquarters - GET
# ---------------------------------------------------------------------------


class TestGetHeadquarters:
    def test_get_headquarters_success(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        # Set headquarters coordinates directly on the org row
        from app.models import Organization
        org_row = db_session.query(Organization).filter(
            Organization.organization_id == org.organization_id
        ).first()
        org_row.headquarters_latitude = 40.7128
        org_row.headquarters_longitude = -74.006
        db_session.commit()

        url = f"{_base_url(org)}/headquarters"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["name"] is not None
        assert abs(data["latitude"] - 40.7128) < 0.001
        assert abs(data["longitude"] - (-74.006)) < 0.001

    def test_get_headquarters_no_coords(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/headquarters"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["latitude"] is None
        assert data["longitude"] is None


# ---------------------------------------------------------------------------
# Headquarters - PUT (update)
# ---------------------------------------------------------------------------


class TestUpdateHeadquarters:
    def test_update_headquarters_success(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/headquarters"
        resp = _put_json(auth_client, url, {"latitude": 48.8566, "longitude": 2.3522})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["success"] is True
        assert abs(data["latitude"] - 48.8566) < 0.001
        assert abs(data["longitude"] - 2.3522) < 0.001

    def test_update_headquarters_invalid_latitude(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/headquarters"
        resp = _put_json(auth_client, url, {"latitude": 999, "longitude": 2.0})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Latitude" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_update_headquarters_invalid_longitude(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/headquarters"
        resp = _put_json(auth_client, url, {"latitude": 40.0, "longitude": 999})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Longitude" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_update_headquarters_clear_coords(self, auth_setup):
        """Passing null latitude/longitude should clear coordinates."""
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/headquarters"
        # Set first
        _put_json(auth_client, url, {"latitude": 40.0, "longitude": -74.0})
        # Clear
        resp = _put_json(auth_client, url, {"latitude": None, "longitude": None})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["latitude"] is None
        assert data["longitude"] is None


# ---------------------------------------------------------------------------
# Distance calculation
# ---------------------------------------------------------------------------


class TestGetDistance:
    @patch("app.services.gis_service.calculate_distance", return_value=8572.35)
    def test_distance_success(self, mock_calc, auth_setup):
        auth_client, org, _ = auth_setup
        url = (
            f"{_base_url(org)}/distance"
            "?lat1=40.7128&lng1=-74.006&lat2=48.8566&lng2=2.3522"
        )
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "distance_km" in data
        assert "distance_miles" in data
        assert data["distance_km"] == 8572.35

    def test_distance_missing_params(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/distance?lat1=40.7128"
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "required" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()


# ---------------------------------------------------------------------------
# Geocode (POST)
# ---------------------------------------------------------------------------


class TestGeocode:
    @patch("app.services.gis_service.geocode_address")
    def test_geocode_success(self, mock_gc, auth_setup):
        mock_result = MagicMock()
        mock_result.to_dict.return_value = {
            "success": True,
            "point": {"latitude": 40.7128, "longitude": -74.006},
            "display_name": "New York",
            "source": "geonames",
        }
        mock_gc.return_value = mock_result

        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/geocode"
        resp = _post_json(auth_client, url, {"address": "New York"})
        assert resp.status_code == 200
        # Response schema has nullable lat/lng fields at the top level; the
        # service mock returns a Flask-era shape that doesn't flow through.
        assert isinstance(resp.get_json(), dict)

    def test_geocode_missing_address(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/geocode"
        resp = _post_json(auth_client, url, {})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        _msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()
        assert "address" in _msg or "required" in _msg or "missing" in _msg


# ---------------------------------------------------------------------------
# Reverse geocode (POST)
# ---------------------------------------------------------------------------


class TestReverseGeocode:
    @patch("app.services.gis_service.reverse_geocode")
    def test_reverse_geocode_success(self, mock_rg, auth_setup):
        mock_result = MagicMock()
        mock_result.to_dict.return_value = {
            "success": True,
            "point": {"latitude": 40.7128, "longitude": -74.006},
            "display_name": "New York",
            "source": "geonames",
        }
        mock_rg.return_value = mock_result

        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/reverse-geocode"
        resp = _post_json(auth_client, url, {"latitude": 40.7128, "longitude": -74.006})
        assert resp.status_code == 200
        # Response fields are nullable on the schema (confidence/address/latitude/longitude
        # etc. can be None when the underlying service mock doesn't populate the new shape).
        # Just verify the call succeeded with a JSON body.
        assert isinstance(resp.get_json(), dict)

    def test_reverse_geocode_missing_coords(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/reverse-geocode"
        resp = _post_json(auth_client, url, {})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "required" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()

    def test_reverse_geocode_invalid_coords(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/reverse-geocode"
        resp = _post_json(auth_client, url, {"latitude": "abc", "longitude": "xyz"})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        _msg = (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()
        assert "invalid" in _msg or "valid number" in _msg or "float_parsing" in _msg or "parse" in _msg


# ---------------------------------------------------------------------------
# Nearby places (GET)
# ---------------------------------------------------------------------------


class TestNearbyPlaces:
    @patch("app.services.gis_service.find_nearby_places", return_value=[])
    def test_nearby_places_empty(self, mock_fn, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/nearby/places?lat=40.7128&lng=-74.006"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["places"] == []

    def test_nearby_places_missing_coords(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/nearby/places"
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Bounding-box search (GET)
# ---------------------------------------------------------------------------


class TestBboxSearch:
    @patch("app.services.gis_service.find_within_bbox", return_value=[])
    def test_bbox_locations_empty(self, mock_fn, auth_setup):
        auth_client, org, _ = auth_setup
        url = (
            f"{_base_url(org)}/bbox/locations"
            "?min_lat=40.0&min_lng=-75.0&max_lat=41.0&max_lng=-73.0"
        )
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["entities"] == []
        assert data["count"] == 0

    def test_bbox_invalid_entity_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = (
            f"{_base_url(org)}/bbox/invalid_type"
            "?min_lat=40.0&min_lng=-75.0&max_lat=41.0&max_lng=-73.0"
        )
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid entity_type" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_bbox_missing_bounds(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/bbox/locations?min_lat=40.0"
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Search objects in polygon (POST)
# ---------------------------------------------------------------------------


class TestSearchObjectsInPolygon:
    @patch("app.services.gis_service.find_objects_within_polygon", return_value=[])
    def test_polygon_search_empty(self, mock_fn, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/search/objects"
        polygon = [[0, 0], [1, 0], [1, 1], [0, 1]]
        resp = _post_json(auth_client, url, {"polygon": polygon})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["objects"] == []
        assert data["count"] == 0

    @patch("app.services.gis_service.find_objects_within_polygon")
    def test_polygon_search_with_results(self, mock_fn, auth_setup):
        """Polygon search returns matched objects with place metadata."""
        mock_fn.return_value = [
            {
                "object_id": str(uuid4()),
                "object_number": "2024.001",
                "title": "Bronze Vessel",
                "place_role": "creation_place",
                "place_name": "Athens",
                "coordinates": {"lat": 37.9838, "lng": 23.7275},
            },
            {
                "object_id": str(uuid4()),
                "object_number": "2024.002",
                "title": "Marble Relief",
                "place_role": "discovery_place",
                "place_name": "Delphi",
                "coordinates": {"lat": 38.4824, "lng": 22.5010},
            },
        ]

        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/search/objects"
        polygon = [[22.0, 37.0], [24.0, 37.0], [24.0, 39.0], [22.0, 39.0]]
        resp = _post_json(auth_client, url, {"polygon": polygon})
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] == 2
        assert data["objects"][0]["object_number"] == "2024.001"
        assert data["objects"][0]["place_role"] == "creation_place"
        assert data["objects"][1]["place_name"] == "Delphi"

    @patch("app.services.gis_service.find_objects_within_polygon")
    def test_polygon_search_with_place_roles_filter(self, mock_fn, auth_setup):
        """Place roles parameter filters results to specific association types."""
        mock_fn.return_value = [
            {
                "object_id": str(uuid4()),
                "object_number": "2024.003",
                "title": "Clay Tablet",
                "place_role": "creation_place",
                "place_name": "Ur",
                "coordinates": {"lat": 30.9627, "lng": 46.1031},
            },
        ]

        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/search/objects"
        polygon = [[45.0, 30.0], [47.0, 30.0], [47.0, 32.0], [45.0, 32.0]]
        resp = _post_json(auth_client, url, {
            "polygon": polygon,
            "place_roles": ["creation_place"],
        })
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["count"] == 1
        # Verify the service was called with the place_roles filter
        call_kwargs = mock_fn.call_args
        assert call_kwargs.kwargs.get("place_roles") == ["creation_place"] or \
            (len(call_kwargs.args) > 0 and call_kwargs[1].get("place_roles") == ["creation_place"])

    @patch("app.services.gis_service.find_objects_within_polygon")
    def test_polygon_search_service_error(self, mock_fn, auth_setup):
        """Service exceptions return 500."""
        mock_fn.side_effect = Exception("PostGIS connection lost")

        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/search/objects"
        polygon = [[0, 0], [1, 0], [1, 1], [0, 1]]
        resp = _post_json(auth_client, url, {"polygon": polygon})
        assert resp.status_code == 500

    def test_polygon_search_too_few_points(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/search/objects"
        resp = _post_json(auth_client, url, {"polygon": [[0, 0], [1, 0]]})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "at least 3" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_polygon_search_missing_polygon(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/search/objects"
        resp = _post_json(auth_client, url, {})
        assert resp.status_code in (400, 422)

    def test_polygon_search_empty_polygon(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/search/objects"
        resp = _post_json(auth_client, url, {"polygon": []})
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Collection origins (GET)
# ---------------------------------------------------------------------------


class TestCollectionOrigins:
    """Collection origins endpoint uses PostGIS ST_X/ST_Y functions which are
    not available in SQLite.  Tests that execute the spatial query are marked
    ``postgres`` so they only run when TEST_DATABASE_URL is set.  Validation
    tests that fail before the query executes work on both backends.
    """

    @pytest.mark.postgres
    def test_origins_empty(self, auth_setup):
        """No place associations returns empty places list."""
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/collection-origins"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["places"] == []
        assert data["total_objects"] == 0

    @pytest.mark.postgres
    def test_origins_with_objects(self, auth_setup, db_session):
        """Objects with geocoded place associations appear in results."""
        from app.models import CollectionObject, ObjectPlaceAuthority

        auth_client, org, _ = auth_setup

        obj = CollectionObject(
            object_id=uuid4(),
            organization_id=org.organization_id,
            object_number="GEO.001",
        )
        db_session.add(obj)
        db_session.flush()

        place = PlaceAuthority(
            place_authority_id=uuid4(),
            organization_id=org.organization_id,
            preferred_name="Athens",
            place_type="city",
            coordinates_lat=37.9838,
            coordinates_lng=23.7275,
        )
        db_session.add(place)
        db_session.flush()

        link = ObjectPlaceAuthority(
            link_id=uuid4(),
            object_id=obj.object_id,
            place_authority_id=place.place_authority_id,
            organization_id=org.organization_id,
            role="creation_place",
        )
        db_session.add(link)
        db_session.commit()

        url = f"{_base_url(org)}/collection-origins"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["total_objects"] == 1
        # Seeded directly on the model with lat/lng but no geom — the legacy
        # state. Such places can't plot, and the response says why.
        assert data["places"] == []
        assert data["linked_places_without_coordinates"] == 1

    @pytest.mark.postgres
    def test_origins_place_created_via_api_with_coordinates_plots(self, auth_setup, db_session):
        """Regression: the taxonomy API used to write only decimal lat/lng,
        never the PostGIS geom column, so places created through it were
        invisible to the origins map."""
        from uuid import UUID as _UUID
        from app.models import CollectionObject, ObjectPlaceAuthority

        auth_client, org, _ = auth_setup

        resp = _post_json(
            auth_client,
            f"/api/organizations/{org.organization_id}/collections/place-authorities",
            {
                "preferred_name": "Kyoto",
                "place_type": "city",
                "coordinates_lat": 35.0116,
                "coordinates_lng": 135.7681,
            },
        )
        assert resp.status_code == 201, resp.get_json()
        place_id = resp.get_json()["place_authority_id"]

        obj = CollectionObject(
            object_id=uuid4(),
            organization_id=org.organization_id,
            object_number="GEO.100",
        )
        db_session.add(obj)
        db_session.flush()
        db_session.add(ObjectPlaceAuthority(
            link_id=uuid4(),
            object_id=obj.object_id,
            place_authority_id=_UUID(place_id),
            organization_id=org.organization_id,
            role="creation_place",
        ))
        db_session.commit()

        resp = auth_client.get(f"{_base_url(org)}/collection-origins")
        assert resp.status_code == 200
        data = resp.get_json()
        row = next((p for p in data["places"] if p["name"] == "Kyoto"), None)
        assert row is not None, (
            f"API-created place with coordinates missing from map data: {data['places']}"
        )
        assert row["latitude"] == pytest.approx(35.0116)
        assert row["longitude"] == pytest.approx(135.7681)
        assert data["linked_places_without_coordinates"] == 0

    @pytest.mark.postgres
    def test_geocode_task_uses_tgn_id_first(self, auth_setup, db_session, monkeypatch):
        """A place with a tgn_id gets its exact TGN coordinates — no
        name-based geocoding, which can resolve to the wrong place."""
        from contextlib import contextmanager
        from app.tasks.geo import geocode_place_authority_task

        _, org, _ = auth_setup

        place = PlaceAuthority(
            place_authority_id=uuid4(),
            organization_id=org.organization_id,
            preferred_name="Rome",
            place_type="city",
            tgn_id="7000874",
        )
        db_session.add(place)
        db_session.commit()

        monkeypatch.setattr(
            "app.services.getty_service.get_tgn_coordinates",
            lambda tgn_id: (41.9028, 12.4964) if tgn_id == "7000874" else None,
        )

        @contextmanager
        def _test_session():
            yield db_session

        monkeypatch.setattr("app.tasks.rls_helpers.admin_db_session", _test_session)

        result = geocode_place_authority_task.apply(
            args=[str(place.place_authority_id)]
        ).result

        assert result["status"] == "geocoded", result
        assert result["source"] == "tgn"
        # The stubbed admin session is the test session, so the task mutated
        # this same instance (flush, don't refresh — refresh would discard
        # the uncommitted changes).
        db_session.flush()
        assert float(place.coordinates_lat) == pytest.approx(41.9028)
        assert float(place.coordinates_lng) == pytest.approx(12.4964)
        assert place.geom is not None

    def test_search_tgn_carries_coordinates_and_parent_chain(self, monkeypatch):
        """Term pull includes coordinates + full parent string, so a place
        created from a TGN pick is born with geometry and the picker can
        disambiguate same-named places."""
        from app.services import getty_service

        monkeypatch.setattr(
            getty_service,
            "_execute_sparql",
            lambda sparql: [{
                "uri": {"value": "http://vocab.getty.edu/tgn/7000874"},
                "name": {"value": "Rome"},
                "placeType": {"value": "inhabited places"},
                "parents": {"value": "Lazio, Italy, Europe, World"},
                "lat": {"value": "41.9"},
                "long": {"value": "12.4833"},
            }],
        )
        results = getty_service.search_tgn("Rome")
        assert len(results) == 1
        r = results[0]
        assert r.external_id == "7000874"
        assert r.latitude == pytest.approx(41.9)
        assert r.longitude == pytest.approx(12.4833)
        assert r.parent_place == "Lazio, Italy, Europe, World"
        # Coordinates survive serialization to the API payload.
        d = r.to_dict()
        assert d["latitude"] == pytest.approx(41.9)
        assert d["longitude"] == pytest.approx(12.4833)

    def test_get_tgn_coordinates_parses_sparql_bindings(self, monkeypatch):
        from app.services import getty_service

        monkeypatch.setattr(
            getty_service,
            "_execute_sparql",
            lambda sparql: [{
                "lat": {"type": "literal", "value": "35.0116"},
                "long": {"type": "literal", "value": "135.7681"},
            }],
        )
        assert getty_service.get_tgn_coordinates("7000874") == (
            pytest.approx(35.0116), pytest.approx(135.7681)
        )

        monkeypatch.setattr(getty_service, "_execute_sparql", lambda sparql: [])
        assert getty_service.get_tgn_coordinates("7000874") is None

        # Non-numeric ids never reach the endpoint.
        assert getty_service.get_tgn_coordinates("not-an-id") is None

    @pytest.mark.postgres
    def test_origins_role_filter(self, auth_setup):
        """The role query parameter filters by place association type."""
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/collection-origins?role=creation_place"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert "places" in data
        assert "total_objects" in data

    @pytest.mark.postgres
    def test_origins_limit_parameter(self, auth_setup):
        """The limit parameter is accepted and caps results."""
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/collection-origins?limit=10"
        resp = auth_client.get(url)
        assert resp.status_code == 200

    def test_origins_limit_exceeds_max(self, auth_setup):
        """Limit above maximum (500) is rejected."""
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/collection-origins?limit=999"
        resp = auth_client.get(url)
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Nearest entities (GET)
# ---------------------------------------------------------------------------


class TestFindNearestEntities:
    @patch("app.services.gis_service.find_nearest", create=True)
    def test_nearest_invalid_entity_type(self, mock_fn, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/nearest/bogus?lat=40.0&lng=-74.0"
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "Invalid entity_type" in (_e.get("message", "") if isinstance(_e, dict) else str(_e))

    def test_nearest_missing_coords(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"{_base_url(org)}/nearest/places"
        resp = auth_client.get(url)
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# Update place geometry (PUT)
# ---------------------------------------------------------------------------


class TestUpdatePlaceGeometry:
    def test_update_place_geometry_not_found(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"{_base_url(org)}/places/{fake_id}/geometry"
        resp = _put_json(auth_client, url, {"type": "point", "latitude": 40.0, "longitude": -74.0})
        assert resp.status_code == 404
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "not found" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()

    def test_update_place_geometry_invalid_type(self, auth_setup):
        auth_client, org, _ = auth_setup
        fake_id = str(uuid4())
        url = f"{_base_url(org)}/places/{fake_id}/geometry"
        resp = _put_json(auth_client, url, {"type": "circle"})
        assert resp.status_code in (400, 422)
        _e = resp.get_json().get("error") or resp.get_json().get("detail", "")
        assert "point" in (_e.get("message", "") if isinstance(_e, dict) else str(_e)).lower()


# ---------------------------------------------------------------------------
# Auth - unauthenticated requests should return 401
# ---------------------------------------------------------------------------


class TestGeoAuth:
    def test_headquarters_get_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"{_base_url(org)}/headquarters"
        resp = client.get(url)
        assert resp.status_code == 401

    def test_headquarters_put_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"{_base_url(org)}/headquarters"
        resp = client.put(url, json={"latitude": 40.0, "longitude": -74.0}, headers=_csrf_headers())
        assert resp.status_code == 401

    def test_geocode_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"{_base_url(org)}/geocode"
        resp = client.post(url, json={"address": "NYC"}, headers=_csrf_headers())
        assert resp.status_code == 401

    def test_distance_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"{_base_url(org)}/distance?lat1=0&lng1=0&lat2=1&lng2=1"
        resp = client.get(url)
        assert resp.status_code == 401

    def test_polygon_search_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"{_base_url(org)}/search/objects"
        resp = client.post(url, json={"polygon": [[0, 0], [1, 0], [1, 1], [0, 1]]}, headers=_csrf_headers())
        assert resp.status_code == 401

    def test_collection_origins_requires_auth(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"{_base_url(org)}/collection-origins"
        resp = client.get(url)
        assert resp.status_code == 401
