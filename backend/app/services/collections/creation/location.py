"""Shared create logic for Location.

Extracted from the inline ``create_location`` router so the draft applier and
the API route share one implementation: code auto-generation, parent-derived
path/depth, and the optional-field copy. The caller owns the transaction.
"""

from __future__ import annotations

from uuid import UUID

from app.models import Location

# Optional fields copied verbatim from the payload when present (parity with
# the router's optional_fields list).
_OPTIONAL_FIELDS = (
    "alternate_names", "address", "contact_name", "contact_email",
    "contact_phone", "coordinates", "grid_reference", "floor_plan_coordinates",
    "capacity", "capacity_note", "temperature_min", "temperature_max",
    "humidity_min", "humidity_max", "light_level", "light_level_lux",
    "uv_filtered", "environment_note", "default_fitness", "condition",
    "condition_note", "security_level", "security_note", "access_restricted",
    "access_requirements", "access_note", "accessibility", "description",
    "note", "established_date",
)

_TYPE_PREFIXES = {
    "building": "BLD",
    "floor": "FL",
    "room": "RM",
    "case": "CS",
    "shelf": "SH",
    "drawer": "DR",
    "other": "LOC",
}


def _as_uuid(value) -> UUID | None:
    if value is None or isinstance(value, UUID):
        return value
    return UUID(str(value))


def _autogen_code(location_type: str, name: str) -> str:
    prefix = _TYPE_PREFIXES.get(location_type, "LOC")
    words = name.split()
    if len(words) > 1:
        abbrev = "".join(w[0].upper() for w in words if w)[:6]
    else:
        abbrev = name[:6].upper().replace(" ", "")
    return f"{prefix}-{abbrev}"


def create_location(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> Location:
    """Create a live Location. The caller owns the transaction.

    ``open_approval``/``proposed_by`` are accepted for signature uniformity;
    locations are not approval-gated and record no separate proposer.

    Writes the resolved ``code`` back into ``payload`` so a caller relying on it
    (e.g. the router's duplicate-code 409 message) sees the generated value —
    mirroring the original router, which mutated ``data["code"]``.
    """
    p = payload
    name = p["name"]
    location_type = p["location_type"]

    code = p.get("code")
    if not code:
        code = _autogen_code(location_type, name)
        p["code"] = code  # parity: surface the generated code to the caller

    parent_id = p.get("parent_id")
    if parent_id:
        parent = (
            session.query(Location)
            .filter(
                Location.location_id == _as_uuid(parent_id),
                Location.organization_id == organization_id,
            )
            .first()
        )
        if parent is None:
            raise ValueError(f"parent location {parent_id} not found")
        path = f"{parent.path}/{code}"
        depth = parent.depth + 1
    else:
        path = code
        depth = 0

    loc = Location(
        organization_id=organization_id,
        parent_id=_as_uuid(parent_id) if parent_id else None,
        path=path,
        depth=depth,
        name=name,
        code=code,
        location_type=location_type,
        barcode=p.get("barcode"),
        is_external=p.get("is_external", False),
        climate_controlled=p.get("climate_controlled", False),
        created_by=actor,
        updated_by=actor,
    )

    for field in _OPTIONAL_FIELDS:
        if field in p:
            setattr(loc, field, p[field])

    session.add(loc)
    session.flush()
    return loc
