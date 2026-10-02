"""Pydantic request and response models for geo router."""
from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, field_validator


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class GeocodeRequest(BaseModel):
    address: str
    country_code: str | None = None


class ReverseGeocodeRequest(BaseModel):
    latitude: float
    longitude: float


class PolygonSearchRequest(BaseModel):
    polygon: list[list[float]]
    place_roles: list[str] | None = None

    @field_validator('polygon')
    @classmethod
    def polygon_min_points(cls, v: list[list[float]]) -> list[list[float]]:
        if len(v) < 3:
            raise ValueError('polygon must have at least 3 coordinate pairs')
        return v


class UpdatePlaceGeometryRequest(BaseModel):
    type: Literal['point', 'polygon']
    latitude: float | None = None
    longitude: float | None = None
    coordinates: list[list[float]] | None = None

    @field_validator('coordinates')
    @classmethod
    def polygon_coords_min(cls, v: list[list[float]] | None) -> list[list[float]] | None:
        if v is not None and len(v) < 3:
            raise ValueError('polygon requires at least 3 coordinate pairs')
        return v


class UpdateHeadquartersRequest(BaseModel):
    latitude: float | None = None
    longitude: float | None = None

    @field_validator('latitude')
    @classmethod
    def validate_lat(cls, v: float | None) -> float | None:
        if v is not None and not -90 <= v <= 90:
            raise ValueError('Latitude must be between -90 and 90')
        return v

    @field_validator('longitude')
    @classmethod
    def validate_lng(cls, v: float | None) -> float | None:
        if v is not None and not -180 <= v <= 180:
            raise ValueError('Longitude must be between -180 and 180')
        return v


class CoordinatePair(BaseModel):
    latitude: float
    longitude: float


class UpdateVenueGeometryRequest(BaseModel):
    latitude: float
    longitude: float


class UpdateShipmentGeometryRequest(BaseModel):
    origin: CoordinatePair | None = None
    destination: CoordinatePair | None = None


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------


class GeocodeResponse(BaseModel):
    latitude: float | None = None
    longitude: float | None = None
    formatted_address: str | None = None
    place_id: str | None = None
    confidence: float | None = None
    source: str | None = None
    raw: Any = None


class NearbyPlacesResponse(BaseModel):
    places: list[Any]


class BboxSearchResponse(BaseModel):
    entities: list[Any]
    count: int


class PolygonSearchResponse(BaseModel):
    objects: list[Any]
    count: int


class NearestEntitiesResponse(BaseModel):
    entities: list[Any]


class DistanceResponse(BaseModel):
    distance_km: float
    distance_miles: float


class PlaceGeometryUpdateResponse(BaseModel):
    success: bool
    place_authority_id: str
    geometry_type: str


class LoanNetworkResponse(BaseModel):
    organization: Any
    contacts: list[Any]


class HeadquartersResponse(BaseModel):
    name: str | None = None
    latitude: float | None = None
    longitude: float | None = None


class HeadquartersUpdateResponse(BaseModel):
    success: bool
    latitude: float | None = None
    longitude: float | None = None


class TourRouteResponse(BaseModel):
    exhibition: Any
    venues: list[Any]


class CollectionOriginsResponse(BaseModel):
    total_objects: int
    places: list[Any]
    # Linked places with no geometry — they exist but can't plot on the map.
    linked_places_without_coordinates: int = 0


class VenueGeometryUpdateResponse(BaseModel):
    success: bool
    exhibition_venue_id: str


class ExhibitionShipmentsResponse(BaseModel):
    exhibition: Any
    shipments: list[Any]


class ShipmentGeometryUpdateResponse(BaseModel):
    success: bool
    shipment_id: str
