"""
Background tasks for GIS operations.

Provides async geocoding tasks for batch processing:
- batch_geocode_contacts_task: Geocode contacts that have addresses but no geometry

These tasks enable efficient background processing of geocoding operations
without blocking the request cycle.
"""

import logging
from typing import Any
from uuid import UUID

from celery import Task

from app.celery_app import celery_app
from app.database import current_session
from app.tasks.base import OrgTask, SystemTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=OrgTask,
    bind=True,
    name='app.tasks.geo.batch_geocode_contacts',
    max_retries=3,
    default_retry_delay=60,
    autoretry_for=(Exception,),
    retry_backoff=True,
    retry_backoff_max=300,
    soft_time_limit=300,
    time_limit=600,
    queue='default',
)
def batch_geocode_contacts_task(
    self: Task,
    organization_id: str,
    limit: int = 100,
) -> dict[str, Any]:
    """
    Batch geocode contacts that have addresses but no geometry.

    Finds contacts with address JSONB but no geom column populated,
    geocodes them using GeoNames, and updates the database.

    Args:
        organization_id: UUID of the organization to process
        limit: Maximum contacts to process in one batch (default: 100)

    Returns:
        Result dict with counts: processed, geocoded, failed, errors
    """
    logger.info(f"Starting batch geocode for org {organization_id} (limit={limit})")

    try:
        from app.services.gis_service import batch_geocode_contacts

        results = batch_geocode_contacts(
            db=current_session(),
            organization_id=UUID(organization_id),
            limit=limit,
        )

        logger.info(
            f"Batch geocode complete for org {organization_id}: "
            f"{results['geocoded']} geocoded, {results['failed']} failed"
        )

        return results

    except Exception as e:
        logger.error(f"Batch geocode failed for org {organization_id}: {e}")
        raise


@celery_app.task(
    base=SystemTask,
    bind=True,
    name='app.tasks.geo.geocode_single_contact',
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
    soft_time_limit=30,
    time_limit=60,
    queue='default',
)
def geocode_single_contact_task(
    self: Task,
    contact_id: str,
) -> dict[str, Any]:
    """
    Geocode a single contact's address.

    Args:
        contact_id: UUID of the contact to geocode

    Returns:
        Result dict with status and coordinates if successful
    """
    logger.info(f"Geocoding contact {contact_id}")

    try:
        from app.models import Contact
        from app.services.gis_service import geocode_contact_address, create_point
        from app.tasks.rls_helpers import admin_db_session

        # No org_id available — use admin session (BYPASSRLS)
        with admin_db_session() as session:
            contact = session.query(Contact).get(UUID(contact_id))

            if not contact:
                return {
                    "status": "not_found",
                    "contact_id": contact_id,
                }

            if not contact.address:
                return {
                    "status": "skipped",
                    "reason": "No address on contact",
                    "contact_id": contact_id,
                }

            if contact.geom is not None:
                return {
                    "status": "skipped",
                    "reason": "Already has geometry",
                    "contact_id": contact_id,
                }

            result = geocode_contact_address(contact.address)

            if result.success and result.point:
                contact.geom = create_point(
                    result.point.latitude,
                    result.point.longitude,
                )

                return {
                    "status": "geocoded",
                    "contact_id": contact_id,
                    "coordinates": {
                        "latitude": result.point.latitude,
                        "longitude": result.point.longitude,
                    },
                    "display_name": result.display_name,
                }
            else:
                return {
                    "status": "failed",
                    "contact_id": contact_id,
                    "error": result.error,
                }

    except Exception as e:
        logger.error(f"Failed to geocode contact {contact_id}: {e}")
        raise


@celery_app.task(
    base=SystemTask,
    bind=True,
    name='app.tasks.geo.geocode_place_authority',
    max_retries=3,
    default_retry_delay=30,
    autoretry_for=(Exception,),
    retry_backoff=True,
    soft_time_limit=30,
    time_limit=60,
    queue='default',
)
def geocode_place_authority_task(
    self: Task,
    place_authority_id: str,
) -> dict[str, Any]:
    """
    Geocode a place authority by its name to populate geometry.

    Useful for place authorities that have a name but no coordinates.
    Place authorities are global reference data, so this uses admin_db_session.

    Args:
        place_authority_id: UUID of the place authority

    Returns:
        Result dict with status and coordinates if successful
    """
    logger.info(f"Geocoding place authority {place_authority_id}")

    try:
        from app.models import PlaceAuthority
        from app.services.gis_service import geocode_address, create_point
        from app.tasks.rls_helpers import admin_db_session

        # Place authorities are global reference data — use admin session (BYPASSRLS)
        with admin_db_session() as session:
            place = session.query(PlaceAuthority).get(UUID(place_authority_id))

            if not place:
                return {
                    "status": "not_found",
                    "place_authority_id": place_authority_id,
                }

            if place.geom is not None:
                return {
                    "status": "skipped",
                    "reason": "Already has geometry",
                    "place_authority_id": place_authority_id,
                }

            # TGN-first: an id pins the exact place record, where a name
            # search can resolve to the wrong one ("Rome" exists on several
            # continents). Only fall back to GeoNames when there's no TGN id
            # or TGN has no coordinates.
            if place.tgn_id:
                from app.services.getty_service import get_tgn_coordinates
                coords = get_tgn_coordinates(place.tgn_id)
                if coords:
                    place.geom = create_point(coords[0], coords[1])
                    place.coordinates_lat = coords[0]
                    place.coordinates_lng = coords[1]
                    return {
                        "status": "geocoded",
                        "source": "tgn",
                        "place_authority_id": place_authority_id,
                        "preferred_name": place.preferred_name,
                        "coordinates": {
                            "latitude": coords[0],
                            "longitude": coords[1],
                        },
                    }

            # Build search string from place name and hierarchy
            search_parts = [place.preferred_name]
            if place.country_code:
                search_parts.append(place.country_code)

            search_string = ", ".join(search_parts)

            result = geocode_address(search_string, country_code=place.country_code)

            if result.success and result.point:
                place.geom = create_point(
                    result.point.latitude,
                    result.point.longitude,
                )
                # Also update legacy decimal fields
                place.coordinates_lat = result.point.latitude
                place.coordinates_lng = result.point.longitude

                return {
                    "status": "geocoded",
                    "place_authority_id": place_authority_id,
                    "preferred_name": place.preferred_name,
                    "coordinates": {
                        "latitude": result.point.latitude,
                        "longitude": result.point.longitude,
                    },
                }
            else:
                return {
                    "status": "failed",
                    "place_authority_id": place_authority_id,
                    "error": result.error,
                }

    except Exception as e:
        logger.error(f"Failed to geocode place authority {place_authority_id}: {e}")
        raise


@celery_app.task(
    base=OrgTask,
    name='app.tasks.geo.batch_geocode_places_without_coordinates',
    soft_time_limit=600,
    time_limit=900,
    queue='default',
)
def batch_geocode_places_without_coordinates_task(
    organization_id: str,
    limit: int = 50,
) -> dict[str, Any]:
    """
    Find and geocode place authorities that have no coordinates.

    Args:
        organization_id: UUID of the organization
        limit: Maximum places to process

    Returns:
        Result dict with counts
    """
    logger.info(f"Batch geocoding places for org {organization_id}")

    try:
        from app.models import PlaceAuthority
        from app.services.gis_service import geocode_address, create_point
        from sqlalchemy import and_

        # Find places without geometry
        places = current_session().query(PlaceAuthority).filter(
            and_(
                PlaceAuthority.organization_id == UUID(organization_id),
                PlaceAuthority.geom.is_(None),
                PlaceAuthority.status == "active",
            )
        ).limit(limit).all()

        if not places:
            return {
                "status": "completed",
                "processed": 0,
                "geocoded": 0,
                "failed": 0,
            }

        geocoded = 0
        failed = 0

        for place in places:
            try:
                # TGN-first, same rationale as geocode_place_authority_task.
                if place.tgn_id:
                    from app.services.getty_service import get_tgn_coordinates
                    coords = get_tgn_coordinates(place.tgn_id)
                    if coords:
                        place.geom = create_point(coords[0], coords[1])
                        place.coordinates_lat = coords[0]
                        place.coordinates_lng = coords[1]
                        geocoded += 1
                        continue

                search_parts = [place.preferred_name]
                if place.country_code:
                    search_parts.append(place.country_code)

                result = geocode_address(
                    ", ".join(search_parts),
                    country_code=place.country_code
                )

                if result.success and result.point:
                    place.geom = create_point(
                        result.point.latitude,
                        result.point.longitude,
                    )
                    place.coordinates_lat = result.point.latitude
                    place.coordinates_lng = result.point.longitude
                    geocoded += 1
                else:
                    failed += 1

            except Exception as e:
                logger.warning(f"Failed to geocode place {place.place_authority_id}: {e}")
                failed += 1

        current_session().commit()

        logger.info(f"Batch geocode places complete: {geocoded} geocoded, {failed} failed")

        return {
            "status": "completed",
            "processed": len(places),
            "geocoded": geocoded,
            "failed": failed,
        }

    except Exception as e:
        logger.error(f"Batch geocode places failed: {e}")
        return {
            "status": "failed",
            "error": str(e),
        }
