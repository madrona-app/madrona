"""
Geographic API endpoints (FastAPI).

Provides GIS capabilities:
- Geocoding / reverse geocoding
- Spatial queries (nearby, bbox, polygon search)
- Distance calculations
- Place/venue geometry updates
- Visualization data (loan network, tour routes, collection origins, shipments)

Migrated from app/api/geo.py.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from sqlalchemy import case, func, or_
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    CollectionObject,
    Contact,
    Exhibition,
    ExhibitionVenue,
    Location,
    LoanIn,
    LoanOut,
    ObjectPlaceAuthority,
    Organization,
    PlaceAuthority,
    Venue,
)
from app.fastapi_app.schemas.geo import (
    BboxSearchResponse,
    CollectionOriginsResponse,
    CoordinatePair,
    DistanceResponse,
    ExhibitionShipmentsResponse,
    GeocodeRequest,
    GeocodeResponse,
    HeadquartersResponse,
    HeadquartersUpdateResponse,
    LoanNetworkResponse,
    NearbyPlacesResponse,
    NearestEntitiesResponse,
    PlaceGeometryUpdateResponse,
    PolygonSearchRequest,
    PolygonSearchResponse,
    ReverseGeocodeRequest,
    ShipmentGeometryUpdateResponse,
    TourRouteResponse,
    UpdateHeadquartersRequest,
    UpdatePlaceGeometryRequest,
    UpdateShipmentGeometryRequest,
    UpdateVenueGeometryRequest,
    VenueGeometryUpdateResponse,
)
from app.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter(tags=["geo"])


# ---------------------------------------------------------------------------
# Shared serialization helpers for geo entities
# ---------------------------------------------------------------------------

def _serialize_geo_entity(entity, entity_type: str) -> dict:
    """Serialize a geo entity (place, contact, or location) to a dict."""
    if entity_type == "places":
        return {
            "place_authority_id": str(entity.place_authority_id),
            "preferred_name": entity.preferred_name,
            "place_type": entity.place_type,
            "country_code": entity.country_code,
            "coordinates": {
                "lat": float(entity.coordinates_lat) if entity.coordinates_lat else None,
                "lng": float(entity.coordinates_lng) if entity.coordinates_lng else None,
            },
        }
    elif entity_type == "contacts":
        return {
            "contact_id": str(entity.constituent_id),
            "name": entity.name,
            "organization_name": entity.organization_name,
            "contact_type": entity.constituent_type,
        }
    elif entity_type == "locations":
        return {
            "location_id": str(entity.location_id),
            "name": entity.name,
            "code": entity.code,
            "location_type": entity.location_type,
            "is_external": entity.is_external,
        }
    return {}


# ============================================================================
# GEOCODING ENDPOINTS
# ============================================================================


@router.post("/api/organizations/{organization_id}/geo/geocode", response_model=GeocodeResponse, summary="Geocode")
def geocode(
    organization_id: UUID,
    body: GeocodeRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Geocode an address to coordinates."""
    from app.services.gis_service import geocode_address

    result = geocode_address(body.address, country_code=body.country_code)
    return result.to_dict()


@router.post("/api/organizations/{organization_id}/geo/reverse-geocode", response_model=GeocodeResponse, summary="Reverse geocode endpoint")
def reverse_geocode_endpoint(
    organization_id: UUID,
    body: ReverseGeocodeRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Reverse geocode coordinates to an address."""
    from app.services.gis_service import reverse_geocode

    result = reverse_geocode(body.latitude, body.longitude)
    return result.to_dict()


# ============================================================================
# SPATIAL QUERY ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{organization_id}/geo/nearby/places", response_model=NearbyPlacesResponse, summary="Nearby places")
def nearby_places(
    organization_id: UUID,
    lat: float = Query(...),
    lng: float = Query(...),
    radius_km: float = Query(50),
    limit: int = Query(50, le=100),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Find place authorities within a radius of a point."""
    from app.services.gis_service import find_nearby_places

    places = find_nearby_places(
        db=db,
        lat=lat,
        lng=lng,
        radius_km=radius_km,
        organization_id=organization_id,
        limit=limit,
    )
    return {"places": places}


@router.get("/api/organizations/{organization_id}/geo/bbox/{entity_type}", response_model=BboxSearchResponse, summary="Bbox search")
def bbox_search(
    organization_id: UUID,
    entity_type: str,
    min_lat: float = Query(...),
    min_lng: float = Query(...),
    max_lat: float = Query(...),
    max_lng: float = Query(...),
    limit: int = Query(100, le=500),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Find entities within a bounding box."""
    from app.services.gis_service import find_within_bbox

    entity_classes = {
        "places": PlaceAuthority,
        "contacts": Contact,
        "locations": Location,
    }

    if entity_type not in entity_classes:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid entity_type. Must be one of: {', '.join(entity_classes.keys())}",
        )

    entity_class = entity_classes[entity_type]
    entities = find_within_bbox(
        db=db,
        entity_class=entity_class,
        min_lat=min_lat,
        min_lng=min_lng,
        max_lat=max_lat,
        max_lng=max_lng,
        organization_id=organization_id,
        limit=limit,
    )

    serialized = [_serialize_geo_entity(e, entity_type) for e in entities]
    return {"entities": serialized, "count": len(serialized)}


@router.post("/api/organizations/{organization_id}/geo/search/objects", response_model=PolygonSearchResponse, summary="Search objects in polygon")
def search_objects_in_polygon(
    organization_id: UUID,
    body: PolygonSearchRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Find collection objects with place associations within a polygon."""
    from app.services.gis_service import find_objects_within_polygon

    try:
        objects = find_objects_within_polygon(
            db=db,
            organization_id=organization_id,
            polygon_coords=body.polygon,
            place_roles=body.place_roles,
            limit=100,
        )
    except Exception as e:
        logger.error("Polygon search failed: %s", e)
        raise HTTPException(status_code=500, detail="Failed to execute spatial query")

    return {"objects": objects, "count": len(objects)}


@router.get("/api/organizations/{organization_id}/geo/nearest/{entity_type}", response_model=NearestEntitiesResponse, summary="Find nearest entities")
def find_nearest_entities(
    organization_id: UUID,
    entity_type: str,
    lat: float = Query(...),
    lng: float = Query(...),
    limit: int = Query(5, le=20),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Find the nearest entities to a point."""
    from app.services.gis_service import find_nearest

    entity_classes = {
        "places": PlaceAuthority,
        "contacts": Contact,
        "locations": Location,
    }

    if entity_type not in entity_classes:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid entity_type. Must be one of: {', '.join(entity_classes.keys())}",
        )

    entity_class = entity_classes[entity_type]
    results = find_nearest(
        db=db,
        entity_class=entity_class,
        lat=lat,
        lng=lng,
        organization_id=organization_id,
        limit=limit,
    )

    serialized = [
        {
            "entity": _serialize_geo_entity(entity, entity_type),
            "distance_km": round(distance_km, 2) if distance_km else None,
        }
        for entity, distance_km in results
    ]
    return {"entities": serialized}


# ============================================================================
# DISTANCE CALCULATION
# ============================================================================


@router.get("/api/organizations/{organization_id}/geo/distance", response_model=DistanceResponse, summary="Get distance")
def get_distance(
    organization_id: UUID,
    lat1: float = Query(...),
    lng1: float = Query(...),
    lat2: float = Query(...),
    lng2: float = Query(...),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Calculate distance between two points."""
    from app.services.gis_service import calculate_distance

    distance_km = calculate_distance(lat1, lng1, lat2, lng2)
    distance_miles = distance_km * 0.621371

    return {
        "distance_km": round(distance_km, 2),
        "distance_miles": round(distance_miles, 2),
    }


# ============================================================================
# PLACE AUTHORITY GEOMETRY UPDATE
# ============================================================================


@router.put("/api/organizations/{organization_id}/geo/places/{place_authority_id}/geometry", response_model=PlaceGeometryUpdateResponse, summary="Update place geometry")
def update_place_geometry(
    organization_id: UUID,
    place_authority_id: UUID,
    body: UpdatePlaceGeometryRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update the geometry for a place authority."""
    from app.services.gis_service import create_point, create_polygon

    place = db.query(PlaceAuthority).filter(
        PlaceAuthority.place_authority_id == place_authority_id,
        PlaceAuthority.organization_id == organization_id,
    ).first()

    if not place:
        raise HTTPException(status_code=404, detail="Place authority not found")

    try:
        if body.type == "point":
            lat = body.latitude
            lng = body.longitude
            if lat is None or lng is None:
                raise HTTPException(status_code=400, detail="latitude and longitude required for point type")
            place.geom = create_point(lat, lng)
            place.coordinates_lat = lat
            place.coordinates_lng = lng

        elif body.type == "polygon":
            if not body.coordinates:
                raise HTTPException(status_code=400, detail="coordinates required for polygon type")
            place.geom_area = create_polygon(body.coordinates)

        db.commit()

        return {
            "success": True,
            "place_authority_id": str(place.place_authority_id),
            # Echo back what was actually stored. This read `geom_type`,
            # a name never assigned anywhere in the module, so every
            # successful call raised NameError before it could return.
            "geometry_type": body.type,
        }

    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid coordinate format: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update place geometry: %s", e)
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update geometry")


# ============================================================================
# VISUALIZATION DATA ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{organization_id}/geo/loans/network", response_model=LoanNetworkResponse, summary="Get loan network")
def get_loan_network(
    organization_id: UUID,
    active_only: bool = Query(False),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get loan network data for LoanNetworkMap visualization."""
    from geoalchemy2.functions import ST_X, ST_Y

    loans_out_subq = (
        db.query(
            LoanOut.borrower_contact_id.label("contact_id"),
            func.count(LoanOut.loan_out_id).label("total_count"),
            func.sum(
                case((LoanOut.status.in_(["approved", "on_loan", "in_transit"]), 1), else_=0)
            ).label("active_count"),
        )
        .filter(LoanOut.organization_id == organization_id)
        .filter(LoanOut.borrower_contact_id.isnot(None))
        .group_by(LoanOut.borrower_contact_id)
        .subquery()
    )

    loans_in_subq = (
        db.query(
            LoanIn.lender_id.label("contact_id"),
            func.count(LoanIn.loan_in_id).label("total_count"),
            func.sum(
                case((LoanIn.status.in_(["approved", "on_loan", "in_transit"]), 1), else_=0)
            ).label("active_count"),
        )
        .filter(LoanIn.organization_id == organization_id)
        .filter(LoanIn.lender_id.isnot(None))
        .group_by(LoanIn.lender_id)
        .subquery()
    )

    query = (
        db.query(
            Contact.constituent_id,
            Contact.name,
            Contact.organization_name,
            ST_Y(Contact.geom).label("latitude"),
            ST_X(Contact.geom).label("longitude"),
            func.coalesce(loans_out_subq.c.total_count, 0).label("loans_out_count"),
            func.coalesce(loans_out_subq.c.active_count, 0).label("loans_out_active"),
            func.coalesce(loans_in_subq.c.total_count, 0).label("loans_in_count"),
            func.coalesce(loans_in_subq.c.active_count, 0).label("loans_in_active"),
        )
        .outerjoin(loans_out_subq, Contact.constituent_id == loans_out_subq.c.contact_id)
        .outerjoin(loans_in_subq, Contact.constituent_id == loans_in_subq.c.contact_id)
        .filter(Contact.organization_id == organization_id)
        .filter(Contact.geom.isnot(None))
        .filter(
            or_(
                loans_out_subq.c.total_count > 0,
                loans_in_subq.c.total_count > 0,
            )
        )
    )

    if active_only:
        query = query.filter(
            or_(
                loans_out_subq.c.active_count > 0,
                loans_in_subq.c.active_count > 0,
            )
        )

    results = query.all()

    contacts = []
    for row in results:
        active_loans = (row.loans_out_active or 0) + (row.loans_in_active or 0)
        contacts.append({
            "contact_id": str(row.constituent_id),
            "name": row.organization_name or row.name,
            "latitude": float(row.latitude) if row.latitude else None,
            "longitude": float(row.longitude) if row.longitude else None,
            "loans_out_count": row.loans_out_count or 0,
            "loans_in_count": row.loans_in_count or 0,
            "active_loans": active_loans,
        })

    org = db.query(Organization).filter(
        Organization.organization_id == organization_id
    ).first()

    organization_data = {
        "name": org.name if org else None,
        "latitude": float(org.headquarters_latitude) if org and org.headquarters_latitude else None,
        "longitude": float(org.headquarters_longitude) if org and org.headquarters_longitude else None,
    }

    return {"organization": organization_data, "contacts": contacts}


@router.get("/api/organizations/{organization_id}/geo/headquarters", response_model=HeadquartersResponse, summary="Get headquarters")
def get_headquarters(
    organization_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get the organization's headquarters coordinates."""
    org = db.query(Organization).filter(
        Organization.organization_id == organization_id
    ).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    return {
        "name": org.name,
        "latitude": float(org.headquarters_latitude) if org.headquarters_latitude else None,
        "longitude": float(org.headquarters_longitude) if org.headquarters_longitude else None,
    }


@router.put("/api/organizations/{organization_id}/geo/headquarters", response_model=HeadquartersUpdateResponse, summary="Update headquarters")
def update_headquarters(
    organization_id: UUID,
    body: UpdateHeadquartersRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update the organization's headquarters coordinates."""
    org = db.query(Organization).filter(
        Organization.organization_id == organization_id
    ).first()

    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    org.headquarters_latitude = body.latitude
    org.headquarters_longitude = body.longitude
    db.commit()

    return {
        "success": True,
        "latitude": float(org.headquarters_latitude) if org.headquarters_latitude else None,
        "longitude": float(org.headquarters_longitude) if org.headquarters_longitude else None,
    }


@router.get("/api/organizations/{organization_id}/geo/exhibitions/{exhibition_id}/tour-route", response_model=TourRouteResponse, summary="Get tour route")
def get_tour_route(
    organization_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get tour route data for TourRouteMap visualization."""
    from geoalchemy2.functions import ST_X, ST_Y

    exhibition = db.query(Exhibition).filter(
        Exhibition.exhibition_id == exhibition_id,
        Exhibition.organization_id == organization_id,
    ).first()

    if not exhibition:
        raise HTTPException(status_code=404, detail="Exhibition not found")

    venues_query = (
        db.query(
            ExhibitionVenue.exhibition_venue_id,
            ExhibitionVenue.external_venue_name,
            ExhibitionVenue.external_venue_address,
            ExhibitionVenue.tour_order,
            ExhibitionVenue.planned_start_date,
            ExhibitionVenue.planned_end_date,
            ExhibitionVenue.actual_start_date,
            ExhibitionVenue.actual_end_date,
            ExhibitionVenue.status,
            Venue.name.label("internal_venue_name"),
            func.coalesce(ST_Y(Venue.geom), ST_Y(ExhibitionVenue.geom)).label("latitude"),
            func.coalesce(ST_X(Venue.geom), ST_X(ExhibitionVenue.geom)).label("longitude"),
        )
        .outerjoin(Venue, ExhibitionVenue.venue_id == Venue.venue_id)
        .filter(ExhibitionVenue.exhibition_id == exhibition_id)
        .order_by(ExhibitionVenue.tour_order)
    )

    results = venues_query.all()

    venues = []
    for row in results:
        name = row.internal_venue_name or row.external_venue_name or "Unknown Venue"
        start_date = row.actual_start_date or row.planned_start_date
        end_date = row.actual_end_date or row.planned_end_date

        venues.append({
            "venue_id": str(row.exhibition_venue_id),
            "name": name,
            "city": row.external_venue_address,
            "latitude": float(row.latitude) if row.latitude else None,
            "longitude": float(row.longitude) if row.longitude else None,
            "sequence_order": row.tour_order,
            "start_date": start_date.isoformat() if start_date else None,
            "end_date": end_date.isoformat() if end_date else None,
            "status": row.status,
        })

    return {
        "exhibition": {
            "exhibition_id": str(exhibition.exhibition_id),
            "title": exhibition.title,
            "is_touring": exhibition.is_touring if hasattr(exhibition, "is_touring") else len(venues) > 1,
        },
        "venues": venues,
    }


@router.get("/api/organizations/{organization_id}/geo/collection-origins", response_model=CollectionOriginsResponse, summary="Get collection origins")
def get_collection_origins(
    organization_id: UUID,
    role: str = Query(None),
    limit: int = Query(200, le=500),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get collection origin data for CollectionOriginMap visualization."""
    from geoalchemy2.functions import ST_X, ST_Y

    query = (
        db.query(
            PlaceAuthority.place_authority_id,
            PlaceAuthority.preferred_name,
            PlaceAuthority.place_type,
            PlaceAuthority.hierarchy_path,
            ST_Y(PlaceAuthority.geom).label("latitude"),
            ST_X(PlaceAuthority.geom).label("longitude"),
            ObjectPlaceAuthority.role,
            func.count(ObjectPlaceAuthority.object_id.distinct()).label("object_count"),
        )
        .join(
            ObjectPlaceAuthority,
            PlaceAuthority.place_authority_id == ObjectPlaceAuthority.place_authority_id,
        )
        .join(
            CollectionObject,
            ObjectPlaceAuthority.object_id == CollectionObject.object_id,
        )
        .filter(PlaceAuthority.organization_id == organization_id)
        .filter(PlaceAuthority.geom.isnot(None))
    )

    if role:
        query = query.filter(ObjectPlaceAuthority.role == role)

    query = (
        query.group_by(
            PlaceAuthority.place_authority_id,
            PlaceAuthority.preferred_name,
            PlaceAuthority.place_type,
            PlaceAuthority.hierarchy_path,
            PlaceAuthority.geom,
            ObjectPlaceAuthority.role,
        )
        .order_by(func.count(ObjectPlaceAuthority.object_id.distinct()).desc())
        .limit(limit)
    )

    results = query.all()

    places = []
    for row in results:
        places.append({
            "place_id": str(row.place_authority_id),
            "name": row.preferred_name,
            "hierarchy": row.hierarchy_path,
            "latitude": float(row.latitude) if row.latitude else None,
            "longitude": float(row.longitude) if row.longitude else None,
            "object_count": row.object_count,
            "role": row.role,
            "place_type": row.place_type,
        })

    total_objects = db.query(
        func.count(CollectionObject.object_id.distinct())
    ).filter(CollectionObject.organization_id == organization_id).scalar() or 0

    # Linked places that can't plot because they have no geometry — lets the
    # UI distinguish "no associations yet" from "associations exist but the
    # places need coordinates".
    linked_places_without_coordinates = (
        db.query(func.count(PlaceAuthority.place_authority_id.distinct()))
        .join(
            ObjectPlaceAuthority,
            PlaceAuthority.place_authority_id == ObjectPlaceAuthority.place_authority_id,
        )
        .filter(PlaceAuthority.organization_id == organization_id)
        .filter(PlaceAuthority.geom.is_(None))
        .scalar()
        or 0
    )

    return {
        "total_objects": total_objects,
        "places": places,
        "linked_places_without_coordinates": linked_places_without_coordinates,
    }


# ============================================================================
# EXHIBITION VENUE GEOMETRY UPDATE
# ============================================================================


@router.put("/api/organizations/{organization_id}/geo/venues/{exhibition_venue_id}/geometry", response_model=VenueGeometryUpdateResponse, summary="Update venue geometry")
def update_venue_geometry(
    organization_id: UUID,
    exhibition_venue_id: UUID,
    body: UpdateVenueGeometryRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update the geometry for an exhibition venue."""
    from app.services.gis_service import create_point

    venue = (
        db.query(ExhibitionVenue)
        .join(Exhibition, ExhibitionVenue.exhibition_id == Exhibition.exhibition_id)
        .filter(
            ExhibitionVenue.exhibition_venue_id == exhibition_venue_id,
            Exhibition.organization_id == organization_id,
        )
        .first()
    )

    if not venue:
        raise HTTPException(status_code=404, detail="Exhibition venue not found")

    try:
        venue.geom = create_point(body.latitude, body.longitude)
        db.commit()
        return {"success": True, "exhibition_venue_id": str(venue.exhibition_venue_id)}
    except Exception as e:
        logger.error("Failed to update venue geometry: %s", e)
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update geometry")


# ============================================================================
# SHIPMENT ROUTE VISUALIZATION
# ============================================================================


@router.get("/api/organizations/{organization_id}/geo/exhibitions/{exhibition_id}/shipments", response_model=ExhibitionShipmentsResponse, summary="Get exhibition shipments")
def get_exhibition_shipments(
    organization_id: UUID,
    exhibition_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """Get shipment route data for ShipmentRouteMap visualization."""
    from geoalchemy2.functions import ST_X, ST_Y
    from app.models import Shipment, ShipmentItem, ShipmentReference

    exhibition = db.query(Exhibition).filter(
        Exhibition.exhibition_id == exhibition_id,
        Exhibition.organization_id == organization_id,
    ).first()

    if not exhibition:
        raise HTTPException(status_code=404, detail="Exhibition not found")

    shipments_query = (
        db.query(
            Shipment.shipment_id,
            Shipment.shipment_number,
            Shipment.direction,
            Shipment.status,
            Shipment.shipment_type,
            Shipment.remarks,
            ST_Y(Shipment.origin_geom).label("origin_lat"),
            ST_X(Shipment.origin_geom).label("origin_lng"),
            ST_Y(Shipment.destination_geom).label("dest_lat"),
            ST_X(Shipment.destination_geom).label("dest_lng"),
            Shipment.estimated_dispatch_date,
            Shipment.estimated_arrival_date,
            Shipment.actual_arrival_date,
            func.count(ShipmentItem.shipment_item_id).label("object_count"),
        )
        .join(ShipmentReference, Shipment.shipment_id == ShipmentReference.shipment_id)
        .outerjoin(ShipmentItem, Shipment.shipment_id == ShipmentItem.shipment_id)
        .filter(
            ShipmentReference.procedure_type == "exhibition_venue",
            ShipmentReference.procedure_id == exhibition_id,
            Shipment.organization_id == organization_id,
        )
        .group_by(Shipment.shipment_id)
        .order_by(Shipment.estimated_dispatch_date.asc().nullslast())
    )

    results = shipments_query.all()

    shipments = []
    for row in results:
        shipments.append({
            "shipment_id": str(row.shipment_id),
            "shipment_number": row.shipment_number,
            "direction": row.direction,
            "status": row.status,
            "carrier": None,
            "tracking_number": None,
            "origin": None,
            "origin_coordinates": {
                "lat": float(row.origin_lat) if row.origin_lat else None,
                "lng": float(row.origin_lng) if row.origin_lng else None,
            } if row.origin_lat or row.origin_lng else None,
            "destination": None,
            "destination_coordinates": {
                "lat": float(row.dest_lat) if row.dest_lat else None,
                "lng": float(row.dest_lng) if row.dest_lng else None,
            } if row.dest_lat or row.dest_lng else None,
            "ship_date": row.estimated_dispatch_date.isoformat() if row.estimated_dispatch_date else None,
            "expected_arrival": row.estimated_arrival_date.isoformat() if row.estimated_arrival_date else None,
            "actual_arrival": row.actual_arrival_date.isoformat() if row.actual_arrival_date else None,
            "object_count": row.object_count or 0,
        })

    return {
        "exhibition": {
            "exhibition_id": str(exhibition.exhibition_id),
            "title": exhibition.title,
        },
        "shipments": shipments,
    }


@router.put("/api/organizations/{organization_id}/geo/shipments/{shipment_id}/geometry", response_model=ShipmentGeometryUpdateResponse, summary="Update shipment geometry")
def update_shipment_geometry(
    organization_id: UUID,
    shipment_id: UUID,
    body: UpdateShipmentGeometryRequest,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update the origin and/or destination geometry for a shipment."""
    from app.services.gis_service import create_point
    from app.models import Shipment

    if not body.origin and not body.destination:
        raise HTTPException(
            status_code=400,
            detail="At least one of origin or destination must be provided",
        )

    shipment = db.query(Shipment).filter(
        Shipment.shipment_id == shipment_id,
        Shipment.organization_id == organization_id,
    ).first()

    if not shipment:
        raise HTTPException(status_code=404, detail="Shipment not found")

    try:
        if body.origin:
            shipment.origin_geom = create_point(body.origin.latitude, body.origin.longitude)

        if body.destination:
            shipment.destination_geom = create_point(body.destination.latitude, body.destination.longitude)

        db.commit()
        return {"success": True, "shipment_id": str(shipment.shipment_id)}

    except (TypeError, ValueError) as e:
        raise HTTPException(status_code=400, detail=f"Invalid coordinate format: {e}")
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Failed to update shipment geometry: %s", e)
        db.rollback()
        raise HTTPException(status_code=500, detail="Failed to update geometry")
