"""
GIS Service - Spatial query and geocoding functions.

Provides PostGIS spatial query capabilities and geocoding services for the
Madrona collections management system.

USAGE:
    from app.services.gis_service import (
        geocode_address,
        reverse_geocode,
        find_nearby_places,
        find_within_bbox,
        find_within_polygon,
        calculate_distance,
        create_point,
        create_polygon,
    )

    # Geocode an address
    result = geocode_address("123 Main St, New York, NY")

    # Find places within 50km radius
    places = find_nearby_places(db, lat=40.7128, lng=-74.0060, radius_km=50)

    # Search for objects within drawn polygon
    objects = find_objects_within_polygon(db, org_id, polygon_coords)
"""

import hashlib
import json
import logging
import os
from dataclasses import dataclass, asdict
from decimal import Decimal
from typing import Any
from uuid import UUID

import requests
from geoalchemy2 import WKTElement
from geoalchemy2.functions import ST_DWithin, ST_Distance, ST_MakePoint, ST_SetSRID, ST_Within
from shapely.geometry import Point, Polygon, shape
from shapely import wkt
from geoalchemy2.types import Geography
from sqlalchemy import cast, func, select, and_
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# =============================================================================
# CONFIGURATION
# =============================================================================

DEFAULT_TIMEOUT = 10
GEONAMES_USERNAME = os.getenv("GEONAMES_USERNAME", "demo")

# Redis cache TTL for geocoding results (7 days)
GEOCODE_CACHE_TTL = 7 * 24 * 60 * 60


# =============================================================================
# REDIS CACHING HELPERS
# =============================================================================

def _get_cache_key(prefix: str, *args) -> str:
    """Generate a cache key from prefix and arguments."""
    key_data = ":".join(str(arg) for arg in args)
    key_hash = hashlib.md5(key_data.encode()).hexdigest()[:16]
    return f"geo:{prefix}:{key_hash}"


def _cache_get(key: str) -> dict | None:
    """Get a value from Redis cache."""
    try:
        from app.services.redis_client import get_redis_client
        redis = get_redis_client()
        if redis.is_available() and redis.client:
            data = redis.client.get(key)
            if data:
                return json.loads(data)
    except Exception as e:
        logger.debug(f"Cache get failed for {key}: {e}")
    return None


def _cache_set(key: str, value: dict, ttl: int = GEOCODE_CACHE_TTL) -> None:
    """Set a value in Redis cache with TTL."""
    try:
        from app.services.redis_client import get_redis_client
        redis = get_redis_client()
        if redis.is_available() and redis.client:
            redis.client.set(key, json.dumps(value), ex=ttl)
    except Exception as e:
        logger.debug(f"Cache set failed for {key}: {e}")


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class GeoPoint:
    """A geographic point with latitude and longitude."""
    latitude: float
    longitude: float

    def to_wkt(self) -> str:
        """Convert to WKT format."""
        return f"POINT({self.longitude} {self.latitude})"

    def to_wkt_element(self, srid: int = 4326) -> WKTElement:
        """Convert to GeoAlchemy2 WKTElement."""
        return WKTElement(self.to_wkt(), srid=srid)

    def to_dict(self) -> dict[str, float]:
        """Convert to dictionary."""
        return {"latitude": self.latitude, "longitude": self.longitude}


@dataclass
class GeocodeResult:
    """Result from a geocoding operation."""
    success: bool
    point: GeoPoint | None = None
    display_name: str | None = None
    address_components: dict[str, Any] | None = None
    source: str | None = None
    error: str | None = None

    def to_dict(self) -> dict[str, Any]:
        result = {"success": self.success}
        if self.point:
            result["point"] = self.point.to_dict()
        if self.display_name:
            result["display_name"] = self.display_name
        if self.address_components:
            result["address_components"] = self.address_components
        if self.source:
            result["source"] = self.source
        if self.error:
            result["error"] = self.error
        return result


# =============================================================================
# GEOMETRY HELPERS
# =============================================================================

def create_point(lat: float, lng: float, srid: int = 4326) -> WKTElement:
    """
    Create a PostGIS POINT geometry.

    Args:
        lat: Latitude (Y coordinate)
        lng: Longitude (X coordinate)
        srid: Spatial reference ID (default: 4326 for WGS84)

    Returns:
        WKTElement suitable for database insertion
    """
    return WKTElement(f"POINT({lng} {lat})", srid=srid)


def create_polygon(coordinates: list[list[float]], srid: int = 4326) -> WKTElement:
    """
    Create a PostGIS POLYGON geometry.

    Args:
        coordinates: List of [lng, lat] pairs forming the polygon ring.
                    The first and last points should be the same to close the ring.
        srid: Spatial reference ID (default: 4326 for WGS84)

    Returns:
        WKTElement suitable for database insertion
    """
    # Ensure polygon is closed
    if coordinates[0] != coordinates[-1]:
        coordinates = coordinates + [coordinates[0]]

    coord_str = ", ".join(f"{c[0]} {c[1]}" for c in coordinates)
    return WKTElement(f"POLYGON(({coord_str}))", srid=srid)


def parse_geojson_geometry(geojson: dict[str, Any]) -> WKTElement | None:
    """
    Parse a GeoJSON geometry object into a WKTElement.

    Args:
        geojson: GeoJSON geometry object with 'type' and 'coordinates'

    Returns:
        WKTElement or None if parsing fails
    """
    try:
        geom = shape(geojson)
        return WKTElement(geom.wkt, srid=4326)
    except Exception as e:
        logger.warning(f"Failed to parse GeoJSON geometry: {e}")
        return None


# =============================================================================
# GEOCODING FUNCTIONS
# =============================================================================

def geocode_address(
    address: str,
    country_code: str | None = None,
    use_cache: bool = True,
) -> GeocodeResult:
    """
    Geocode an address to coordinates using GeoNames.

    Results are cached in Redis for 7 days to reduce API calls.

    Args:
        address: Full or partial address string
        country_code: Optional ISO country code to limit search
        use_cache: Whether to use Redis cache (default: True)

    Returns:
        GeocodeResult with coordinates if found
    """
    if not address or len(address) < 3:
        return GeocodeResult(success=False, error="Address too short")

    # Check cache first
    cache_key = _get_cache_key("geocode", address.lower().strip(), country_code or "")
    if use_cache:
        cached = _cache_get(cache_key)
        if cached:
            logger.debug(f"Geocode cache hit for '{address}'")
            # Reconstruct GeocodeResult from cached dict
            point = None
            if cached.get("point"):
                point = GeoPoint(**cached["point"])
            return GeocodeResult(
                success=cached.get("success", False),
                point=point,
                display_name=cached.get("display_name"),
                address_components=cached.get("address_components"),
                source=cached.get("source"),
                error=cached.get("error"),
            )

    try:
        params = {
            "q": address,
            "maxRows": 1,
            "username": GEONAMES_USERNAME,
            "style": "full",
        }
        if country_code:
            params["country"] = country_code

        response = requests.get(
            "http://api.geonames.org/searchJSON",
            params=params,
            timeout=DEFAULT_TIMEOUT,
        )
        response.raise_for_status()

        data = response.json()
        results = data.get("geonames", [])

        if not results:
            result = GeocodeResult(success=False, error="No results found")
            # Cache negative results for shorter time (1 hour)
            if use_cache:
                _cache_set(cache_key, result.to_dict(), ttl=3600)
            return result

        api_result = results[0]
        lat = float(api_result.get("lat", 0))
        lng = float(api_result.get("lng", 0))

        result = GeocodeResult(
            success=True,
            point=GeoPoint(latitude=lat, longitude=lng),
            display_name=api_result.get("name"),
            address_components={
                "country": api_result.get("countryName"),
                "country_code": api_result.get("countryCode"),
                "admin_name": api_result.get("adminName1"),
                "admin_name2": api_result.get("adminName2"),
                "feature_class": api_result.get("fcl"),
            },
            source="geonames",
        )

        # Cache successful result
        if use_cache:
            cache_data = result.to_dict()
            if result.point:
                cache_data["point"] = result.point.to_dict()
            _cache_set(cache_key, cache_data)

        return result

    except requests.RequestException as e:
        logger.warning(f"Geocoding failed for '{address}': {e}")
        return GeocodeResult(success=False, error=str(e))
    except Exception as e:
        logger.error(f"Geocoding error for '{address}': {e}")
        return GeocodeResult(success=False, error=str(e))


def reverse_geocode(lat: float, lng: float, use_cache: bool = True) -> GeocodeResult:
    """
    Reverse geocode coordinates to an address using GeoNames.

    Results are cached in Redis for 7 days to reduce API calls.
    Coordinates are rounded to 4 decimal places (~11m precision) for cache key.

    Args:
        lat: Latitude
        lng: Longitude
        use_cache: Whether to use Redis cache (default: True)

    Returns:
        GeocodeResult with address information if found
    """
    # Round coordinates for cache key (4 decimals = ~11m precision)
    cache_lat = round(lat, 4)
    cache_lng = round(lng, 4)
    cache_key = _get_cache_key("reverse", cache_lat, cache_lng)

    if use_cache:
        cached = _cache_get(cache_key)
        if cached:
            logger.debug(f"Reverse geocode cache hit for ({lat}, {lng})")
            point = None
            if cached.get("point"):
                point = GeoPoint(**cached["point"])
            return GeocodeResult(
                success=cached.get("success", False),
                point=point,
                display_name=cached.get("display_name"),
                address_components=cached.get("address_components"),
                source=cached.get("source"),
                error=cached.get("error"),
            )

    try:
        params = {
            "lat": lat,
            "lng": lng,
            "username": GEONAMES_USERNAME,
        }

        response = requests.get(
            "http://api.geonames.org/findNearbyPlaceNameJSON",
            params=params,
            timeout=DEFAULT_TIMEOUT,
        )
        response.raise_for_status()

        data = response.json()
        results = data.get("geonames", [])

        if not results:
            result = GeocodeResult(success=False, error="No nearby places found")
            if use_cache:
                _cache_set(cache_key, result.to_dict(), ttl=3600)
            return result

        api_result = results[0]

        result = GeocodeResult(
            success=True,
            point=GeoPoint(latitude=lat, longitude=lng),
            display_name=api_result.get("name"),
            address_components={
                "country": api_result.get("countryName"),
                "country_code": api_result.get("countryCode"),
                "admin_name": api_result.get("adminName1"),
                "distance_km": api_result.get("distance"),
            },
            source="geonames",
        )

        # Cache successful result
        if use_cache:
            cache_data = result.to_dict()
            if result.point:
                cache_data["point"] = result.point.to_dict()
            _cache_set(cache_key, cache_data)

        return result

    except requests.RequestException as e:
        logger.warning(f"Reverse geocoding failed for ({lat}, {lng}): {e}")
        return GeocodeResult(success=False, error=str(e))
    except Exception as e:
        logger.error(f"Reverse geocoding error for ({lat}, {lng}): {e}")
        return GeocodeResult(success=False, error=str(e))


# =============================================================================
# SPATIAL QUERY FUNCTIONS
# =============================================================================

def find_nearby_places(
    db: Session,
    lat: float,
    lng: float,
    radius_km: float,
    organization_id: UUID,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """
    Find PlaceAuthority records within a radius of a point.

    Args:
        db: Database session
        lat: Center latitude
        lng: Center longitude
        radius_km: Search radius in kilometers
        organization_id: Organization to search within
        limit: Maximum results to return

    Returns:
        List of place dictionaries with distance
    """
    from app.models import PlaceAuthority

    # Convert km to meters for ST_DWithin (uses geography)
    radius_meters = radius_km * 1000

    # Create the center point
    center = func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326)

    # Query places within radius, ordered by distance
    stmt = (
        select(
            PlaceAuthority,
            func.ST_Distance(
                cast(func.ST_Transform(PlaceAuthority.geom, 4326), Geography),
                cast(center, Geography)
            ).label("distance_m")
        )
        .where(
            and_(
                PlaceAuthority.organization_id == organization_id,
                PlaceAuthority.geom.isnot(None),
                func.ST_DWithin(
                    cast(PlaceAuthority.geom, Geography),
                    cast(center, Geography),
                    radius_meters
                )
            )
        )
        .order_by("distance_m")
        .limit(limit)
    )

    results = db.execute(stmt).all()

    return [
        {
            "place_authority_id": str(place.place_authority_id),
            "preferred_name": place.preferred_name,
            "place_type": place.place_type,
            "country_code": place.country_code,
            "distance_km": round(distance_m / 1000, 2) if distance_m else None,
            "coordinates": {
                "lat": float(place.coordinates_lat) if place.coordinates_lat else None,
                "lng": float(place.coordinates_lng) if place.coordinates_lng else None,
            },
        }
        for place, distance_m in results
    ]


def find_within_bbox(
    db: Session,
    entity_class,
    min_lat: float,
    min_lng: float,
    max_lat: float,
    max_lng: float,
    organization_id: UUID,
    limit: int = 100,
) -> list:
    """
    Find entities within a bounding box.

    Args:
        db: Database session
        entity_class: SQLAlchemy model class with geom column
        min_lat: Minimum latitude (south)
        min_lng: Minimum longitude (west)
        max_lat: Maximum latitude (north)
        max_lng: Maximum longitude (east)
        organization_id: Organization to search within
        limit: Maximum results

    Returns:
        List of entities within the bounding box
    """
    # Create bounding box envelope
    bbox = func.ST_MakeEnvelope(min_lng, min_lat, max_lng, max_lat, 4326)

    stmt = (
        select(entity_class)
        .where(
            and_(
                entity_class.organization_id == organization_id,
                entity_class.geom.isnot(None),
                func.ST_Within(entity_class.geom, bbox)
            )
        )
        .limit(limit)
    )

    return db.scalars(stmt).all()


def find_objects_within_polygon(
    db: Session,
    organization_id: UUID,
    polygon_coords: list[list[float]],
    place_roles: list[str] | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """
    Find collection objects with PlaceAuthority links within a polygon.

    This enables map-based spatial search: draw an area on the map to find
    all objects with creation place, discovery place, etc. within that region.

    Args:
        db: Database session
        organization_id: Organization to search within
        polygon_coords: List of [lng, lat] coordinate pairs forming the polygon
        place_roles: Optional filter by place roles (e.g., ['creation_place', 'discovery_place'])
        limit: Maximum results

    Returns:
        List of object dictionaries with their place associations
    """
    from app.models import CollectionObject, ObjectPlaceAuthority, PlaceAuthority

    # Create polygon geometry
    polygon = create_polygon(polygon_coords)

    # Build query joining objects to places
    conditions = [
        ObjectPlaceAuthority.organization_id == organization_id,
        PlaceAuthority.geom.isnot(None),
        func.ST_Within(PlaceAuthority.geom, polygon),
    ]

    if place_roles:
        conditions.append(ObjectPlaceAuthority.role.in_(place_roles))

    stmt = (
        select(
            CollectionObject,
            ObjectPlaceAuthority.role,
            PlaceAuthority.preferred_name.label("place_name"),
            PlaceAuthority.coordinates_lat,
            PlaceAuthority.coordinates_lng,
        )
        .join(ObjectPlaceAuthority, CollectionObject.object_id == ObjectPlaceAuthority.object_id)
        .join(PlaceAuthority, ObjectPlaceAuthority.place_authority_id == PlaceAuthority.place_authority_id)
        .where(and_(*conditions))
        .distinct(CollectionObject.object_id)
        .limit(limit)
    )

    results = db.execute(stmt).all()

    return [
        {
            "object_id": str(obj.object_id),
            "object_number": obj.object_number,
            "title": obj.title,
            "place_role": role,
            "place_name": place_name,
            "coordinates": {
                "lat": float(lat) if lat else None,
                "lng": float(lng) if lng else None,
            },
        }
        for obj, role, place_name, lat, lng in results
    ]


def calculate_distance(
    lat1: float,
    lng1: float,
    lat2: float,
    lng2: float,
) -> float:
    """
    Calculate the distance between two points in kilometers.

    Uses the Haversine formula for spherical Earth approximation.

    Args:
        lat1, lng1: First point coordinates
        lat2, lng2: Second point coordinates

    Returns:
        Distance in kilometers
    """
    from math import radians, cos, sin, asin, sqrt

    # Earth radius in km
    R = 6371

    lat1, lng1, lat2, lng2 = map(radians, [lat1, lng1, lat2, lng2])

    dlat = lat2 - lat1
    dlng = lng2 - lng1

    a = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlng / 2) ** 2
    c = 2 * asin(sqrt(a))

    return R * c


def find_nearest(
    db: Session,
    entity_class,
    lat: float,
    lng: float,
    organization_id: UUID,
    limit: int = 5,
) -> list[tuple[Any, float]]:
    """
    Find the nearest entities to a point.

    Args:
        db: Database session
        entity_class: SQLAlchemy model class with geom column
        lat: Target latitude
        lng: Target longitude
        organization_id: Organization to search within
        limit: Number of nearest results

    Returns:
        List of (entity, distance_km) tuples ordered by distance
    """
    center = func.ST_SetSRID(func.ST_MakePoint(lng, lat), 4326)

    stmt = (
        select(
            entity_class,
            func.ST_Distance(
                cast(entity_class.geom, Geography),
                cast(center, Geography)
            ).label("distance_m")
        )
        .where(
            and_(
                entity_class.organization_id == organization_id,
                entity_class.geom.isnot(None),
            )
        )
        .order_by("distance_m")
        .limit(limit)
    )

    results = db.execute(stmt).all()

    return [(entity, distance_m / 1000 if distance_m else None) for entity, distance_m in results]


# =============================================================================
# CONTACT GEOCODING
# =============================================================================

def geocode_contact_address(address_json: dict[str, Any] | None) -> GeocodeResult:
    """
    Geocode a contact's JSONB address field.

    Expects address format:
    {
        "street": "123 Main St",
        "city": "New York",
        "state": "NY",
        "postal_code": "10001",
        "country": "USA"
    }

    Args:
        address_json: Contact address as JSONB dict

    Returns:
        GeocodeResult with coordinates if successful
    """
    if not address_json:
        return GeocodeResult(success=False, error="No address provided")

    # Build address string from components
    parts = []
    for key in ["street", "street2", "city", "state", "postal_code", "country"]:
        if value := address_json.get(key):
            parts.append(value)

    if not parts:
        return GeocodeResult(success=False, error="Address has no valid components")

    address_str = ", ".join(parts)
    country_code = address_json.get("country_code")

    return geocode_address(address_str, country_code=country_code)


# =============================================================================
# BATCH OPERATIONS (for Celery tasks)
# =============================================================================

def batch_geocode_contacts(
    db: Session,
    organization_id: UUID,
    limit: int = 100,
) -> dict[str, Any]:
    """
    Batch geocode contacts that have addresses but no geometry.

    Intended to be called from a Celery task.

    Args:
        db: Database session
        organization_id: Organization to process
        limit: Maximum contacts to process in one batch

    Returns:
        Summary of geocoding results
    """
    from app.models import Contact

    # Find contacts with address but no geom
    stmt = (
        select(Contact)
        .where(
            and_(
                Contact.organization_id == organization_id,
                Contact.address.isnot(None),
                Contact.geom.is_(None),
            )
        )
        .limit(limit)
    )

    contacts = db.scalars(stmt).all()

    results = {
        "processed": 0,
        "geocoded": 0,
        "failed": 0,
        "errors": [],
    }

    for contact in contacts:
        results["processed"] += 1

        geocode_result = geocode_contact_address(contact.address)

        if geocode_result.success and geocode_result.point:
            contact.geom = create_point(
                geocode_result.point.latitude,
                geocode_result.point.longitude,
            )
            results["geocoded"] += 1
        else:
            results["failed"] += 1
            if geocode_result.error:
                results["errors"].append({
                    "contact_id": str(contact.contact_id),
                    "error": geocode_result.error,
                })

    db.commit()
    return results
