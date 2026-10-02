"""
Location & Movement Analytical Report Definitions.

Registers 5 global-context analytical reports:
- Current Location Report
- Location History Report
- Objects Not at Normal Location (Displaced Objects)
- Empty Locations
- Environment Summary
"""
import logging
from typing import Any
from uuid import UUID

from sqlalchemy import select, and_

from sqlalchemy.orm import aliased
from sqlalchemy import or_

from app.database import current_session
from app.models.locations import Location, Movement, ObjectPart
from app.models import CollectionObject, Contact, User
from app.services.report_registry import ReportDefinition, get_registry
from app.services.report_definitions.tabular_exports import _tabular_renderer

logger = logging.getLogger(__name__)

MAX_REPORT_ROWS = 10_000


# ============================================================================
# HELPERS
# ============================================================================

def _format_value(value: Any) -> Any:
    """Format a value for export rows."""
    from app.services.collections_export import _format_value as fmt
    return fmt(value)


# ============================================================================
# REPORT 3 — Current Location Report
# ============================================================================

def _resolve_current_location(context_type, context_params, org_id):
    """
    Show what objects/parts are at each location.

    Optional context_params:
        location_id: Filter to a specific location and its descendants
    """
    session = current_session()
    location_filter_id = context_params.get("location_id")

    query = (
        select(
            Location.code.label("location_code"),
            Location.name.label("location_name"),
            Location.path.label("location_path"),
            CollectionObject.object_number,
            CollectionObject.object_name,
            ObjectPart.name.label("part_name"),
            ObjectPart.current_location_fitness.label("fitness"),
            ObjectPart.current_location_date.label("location_date"),
        )
        .select_from(ObjectPart)
        .join(Location, ObjectPart.current_location_id == Location.location_id)
        .join(CollectionObject, ObjectPart.object_id == CollectionObject.object_id)
        .where(
            ObjectPart.organization_id == org_id,
            ObjectPart.current_location_id.isnot(None),
        )
    )

    if location_filter_id:
        # Include the location itself and any descendants via path prefix
        loc = session.execute(
            select(Location.path).where(
                Location.location_id == UUID(str(location_filter_id)),
                Location.organization_id == org_id,
            )
        ).scalar()
        if loc:
            query = query.where(
                or_(
                    Location.location_id == UUID(str(location_filter_id)),
                    Location.path.like(f"{loc}/%"),
                )
            )

    query = query.order_by(Location.code, CollectionObject.object_number)
    query = query.limit(MAX_REPORT_ROWS)

    results = session.execute(query).all()

    col_defs = [
        {"field": "location_code", "label": "Location Code"},
        {"field": "location_name", "label": "Location Name"},
        {"field": "location_path", "label": "Path"},
        {"field": "object_number", "label": "Object Number"},
        {"field": "object_name", "label": "Object Name"},
        {"field": "part_name", "label": "Part Name"},
        {"field": "fitness", "label": "Fitness"},
        {"field": "location_date", "label": "Location Date"},
    ]

    rows = []
    for r in results:
        rows.append({
            "location_code": _format_value(r.location_code),
            "location_name": _format_value(r.location_name),
            "location_path": _format_value(r.location_path),
            "object_number": _format_value(r.object_number),
            "object_name": _format_value(r.object_name),
            "part_name": _format_value(r.part_name),
            "fitness": _format_value(r.fitness),
            "location_date": _format_value(r.location_date),
        })

    return rows, col_defs, {"total": len(rows), "source": "global"}


# ============================================================================
# REPORT 4 — Location History Report
# ============================================================================

def _resolve_location_history(context_type, context_params, org_id):
    """
    Movement history across the organization.

    Optional context_params:
        object_id: Filter to a specific object
        location_id: Filter movements involving a specific location (from or to)
    """
    session = current_session()

    from_loc = aliased(Location, name="from_loc")
    to_loc = aliased(Location, name="to_loc")

    query = (
        select(
            Movement.movement_reference_number.label("reference"),
            CollectionObject.object_number,
            CollectionObject.object_name,
            from_loc.name.label("from_location"),
            to_loc.name.label("to_location"),
            Movement.movement_date.label("date"),
            Movement.reason,
            Movement.movement_method.label("method"),
            Movement.handler_name,
            Movement.status,
            Movement.condition_note,
        )
        .select_from(Movement)
        .join(CollectionObject, Movement.object_id == CollectionObject.object_id)
        .outerjoin(from_loc, Movement.from_location_id == from_loc.location_id)
        .join(to_loc, Movement.to_location_id == to_loc.location_id)
        .where(Movement.organization_id == org_id)
    )

    object_id = context_params.get("object_id")
    location_id = context_params.get("location_id")

    if object_id:
        query = query.where(Movement.object_id == UUID(str(object_id)))

    if location_id:
        lid = UUID(str(location_id))
        query = query.where(
            or_(
                Movement.from_location_id == lid,
                Movement.to_location_id == lid,
            )
        )

    query = query.order_by(Movement.movement_date.desc())
    query = query.limit(MAX_REPORT_ROWS)

    results = session.execute(query).all()

    col_defs = [
        {"field": "reference", "label": "Reference"},
        {"field": "object_number", "label": "Object Number"},
        {"field": "object_name", "label": "Object Name"},
        {"field": "from_location", "label": "From"},
        {"field": "to_location", "label": "To"},
        {"field": "date", "label": "Date"},
        {"field": "reason", "label": "Reason"},
        {"field": "method", "label": "Method"},
        {"field": "handler_name", "label": "Handler"},
        {"field": "status", "label": "Status"},
        {"field": "condition_note", "label": "Condition Note"},
    ]

    rows = []
    for r in results:
        rows.append({
            "reference": _format_value(r.reference),
            "object_number": _format_value(r.object_number),
            "object_name": _format_value(r.object_name),
            "from_location": _format_value(r.from_location),
            "to_location": _format_value(r.to_location),
            "date": _format_value(r.date),
            "reason": _format_value(r.reason),
            "method": _format_value(r.method),
            "handler_name": _format_value(r.handler_name),
            "status": _format_value(r.status),
            "condition_note": _format_value(r.condition_note),
        })

    return rows, col_defs, {"total": len(rows), "source": "global"}


# ============================================================================
# REPORT 5 — Displaced Objects (Not at Normal Location)
# ============================================================================

def _resolve_displaced_objects(context_type, context_params, org_id):
    """
    Objects/parts whose current location differs from their home location.
    """
    session = current_session()

    current_loc = aliased(Location, name="current_loc")
    home_loc = aliased(Location, name="home_loc")

    query = (
        select(
            CollectionObject.object_number,
            CollectionObject.object_name,
            ObjectPart.name.label("part_name"),
            current_loc.name.label("current_location"),
            home_loc.name.label("home_location"),
            ObjectPart.current_location_date.label("since_date"),
            ObjectPart.current_location_fitness.label("fitness"),
        )
        .select_from(ObjectPart)
        .join(CollectionObject, ObjectPart.object_id == CollectionObject.object_id)
        .join(current_loc, ObjectPart.current_location_id == current_loc.location_id)
        .join(home_loc, ObjectPart.home_location_id == home_loc.location_id)
        .where(
            ObjectPart.organization_id == org_id,
            ObjectPart.current_location_id.isnot(None),
            ObjectPart.home_location_id.isnot(None),
            ObjectPart.current_location_id != ObjectPart.home_location_id,
        )
        .order_by(CollectionObject.object_number)
        .limit(MAX_REPORT_ROWS)
    )

    results = session.execute(query).all()

    col_defs = [
        {"field": "object_number", "label": "Object Number"},
        {"field": "object_name", "label": "Object Name"},
        {"field": "part_name", "label": "Part"},
        {"field": "current_location", "label": "Current Location"},
        {"field": "home_location", "label": "Home Location"},
        {"field": "since_date", "label": "Since Date"},
        {"field": "fitness", "label": "Fitness"},
    ]

    rows = []
    for r in results:
        rows.append({
            "object_number": _format_value(r.object_number),
            "object_name": _format_value(r.object_name),
            "part_name": _format_value(r.part_name),
            "current_location": _format_value(r.current_location),
            "home_location": _format_value(r.home_location),
            "since_date": _format_value(r.since_date),
            "fitness": _format_value(r.fitness),
        })

    return rows, col_defs, {"total": len(rows), "source": "global"}


# ============================================================================
# REPORT 6 — Empty Locations
# ============================================================================

def _resolve_empty_locations(context_type, context_params, org_id):
    """
    Active locations with zero objects currently stored.
    """
    session = current_session()

    query = (
        select(
            Location.code,
            Location.name,
            Location.location_type,
            Location.path,
            Location.capacity,
            Location.climate_controlled,
            Location.security_level,
            Location.condition,
        )
        .where(
            Location.organization_id == org_id,
            Location.current_count == 0,
            Location.status == "active",
        )
        .order_by(Location.code)
        .limit(MAX_REPORT_ROWS)
    )

    results = session.execute(query).all()

    col_defs = [
        {"field": "code", "label": "Code"},
        {"field": "name", "label": "Name"},
        {"field": "location_type", "label": "Type"},
        {"field": "path", "label": "Path"},
        {"field": "capacity", "label": "Capacity"},
        {"field": "climate_controlled", "label": "Climate Controlled"},
        {"field": "security_level", "label": "Security Level"},
        {"field": "condition", "label": "Condition"},
    ]

    rows = []
    for r in results:
        rows.append({
            "code": _format_value(r.code),
            "name": _format_value(r.name),
            "location_type": _format_value(r.location_type),
            "path": _format_value(r.path),
            "capacity": _format_value(r.capacity),
            "climate_controlled": _format_value(r.climate_controlled),
            "security_level": _format_value(r.security_level),
            "condition": _format_value(r.condition),
        })

    return rows, col_defs, {"total": len(rows), "source": "global"}


# ============================================================================
# REPORT 7 — Environment Summary
# ============================================================================

def _resolve_environment_summary(context_type, context_params, org_id):
    """
    Environmental conditions across all active locations.
    """
    session = current_session()

    query = (
        select(
            Location.code,
            Location.name,
            Location.location_type,
            Location.climate_controlled,
            Location.temperature_min,
            Location.temperature_max,
            Location.humidity_min,
            Location.humidity_max,
            Location.light_level,
            Location.light_level_lux,
            Location.uv_filtered,
            Location.current_count,
            Location.condition,
        )
        .where(
            Location.organization_id == org_id,
            Location.status == "active",
        )
        .order_by(Location.code)
        .limit(MAX_REPORT_ROWS)
    )

    results = session.execute(query).all()

    col_defs = [
        {"field": "code", "label": "Code"},
        {"field": "name", "label": "Name"},
        {"field": "location_type", "label": "Type"},
        {"field": "climate_controlled", "label": "Climate Controlled"},
        {"field": "temperature_min", "label": "Temp Min"},
        {"field": "temperature_max", "label": "Temp Max"},
        {"field": "humidity_min", "label": "Humidity Min"},
        {"field": "humidity_max", "label": "Humidity Max"},
        {"field": "light_level", "label": "Light Level"},
        {"field": "light_level_lux", "label": "Lux"},
        {"field": "uv_filtered", "label": "UV Filtered"},
        {"field": "current_count", "label": "Current Count"},
        {"field": "condition", "label": "Condition"},
    ]

    rows = []
    for r in results:
        rows.append({
            "code": _format_value(r.code),
            "name": _format_value(r.name),
            "location_type": _format_value(r.location_type),
            "climate_controlled": _format_value(r.climate_controlled),
            "temperature_min": _format_value(r.temperature_min),
            "temperature_max": _format_value(r.temperature_max),
            "humidity_min": _format_value(r.humidity_min),
            "humidity_max": _format_value(r.humidity_max),
            "light_level": _format_value(r.light_level),
            "light_level_lux": _format_value(r.light_level_lux),
            "uv_filtered": _format_value(r.uv_filtered),
            "current_count": _format_value(r.current_count),
            "condition": _format_value(r.condition),
        })

    return rows, col_defs, {"total": len(rows), "source": "global"}


# ============================================================================
# REGISTRATION
# ============================================================================

registry = get_registry()

_LOCATION_REPORTS = [
    ReportDefinition(
        report_key="current_location_report",
        name="Current Location Report",
        description="Shows which objects and parts are at each location.",
        category="Location & Movement",
        style="tabular",
        context_types=["global"],
        record_types=[],
        supported_formats=["csv", "excel", "pdf"],
        resolver=_resolve_current_location,
        renderer=_tabular_renderer,
        default_format="excel",
    ),
    ReportDefinition(
        report_key="location_history_report",
        name="Location History Report",
        description="Movement history showing all object relocations.",
        category="Location & Movement",
        style="tabular",
        context_types=["global"],
        record_types=[],
        supported_formats=["csv", "excel", "pdf"],
        resolver=_resolve_location_history,
        renderer=_tabular_renderer,
        default_format="excel",
    ),
    ReportDefinition(
        report_key="displaced_objects_report",
        name="Objects Not at Normal Location",
        description="Objects whose current location differs from their assigned home location.",
        category="Location & Movement",
        style="tabular",
        context_types=["global"],
        record_types=[],
        supported_formats=["csv", "excel", "pdf"],
        resolver=_resolve_displaced_objects,
        renderer=_tabular_renderer,
        default_format="excel",
    ),
    ReportDefinition(
        report_key="empty_locations_report",
        name="Empty Locations",
        description="Active storage locations with no objects currently stored.",
        category="Location & Movement",
        style="tabular",
        context_types=["global"],
        record_types=[],
        supported_formats=["csv", "excel", "pdf"],
        resolver=_resolve_empty_locations,
        renderer=_tabular_renderer,
        default_format="excel",
    ),
    ReportDefinition(
        report_key="environment_summary_report",
        name="Environment Summary",
        description="Environmental conditions (climate, temperature, humidity, light) across all active locations.",
        category="Location & Movement",
        style="tabular",
        context_types=["global"],
        record_types=[],
        supported_formats=["csv", "excel", "pdf"],
        resolver=_resolve_environment_summary,
        renderer=_tabular_renderer,
        default_format="excel",
    ),
]

for defn in _LOCATION_REPORTS:
    registry.register(defn)
