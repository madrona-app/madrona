"""
Reference data seeder — populate a sandbox org with the baseline rows
that downstream procedure records (loans, acquisitions, conservation
treatments) need to point at: departments, storage locations, contacts.

Idempotent: every insert checks (org_id, key) first and skips on
re-run. Returns a small counter dict for the saga step to record.

Locations and contacts route through the shared ``creation/*`` services
(``create_location`` / ``create_constituent``) — the same code the API
routers and draft applier run — so seeded rows are byte-identical to
user-created ones (canonical path/depth derivation, ``created_by`` audit,
variant-name child aggregate). Departments have no create service and are
inserted directly.
"""
from __future__ import annotations

import logging
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.contacts import Contact
from app.models.departments import Department
from app.models.locations import Location
from app.services.collections.creation.constituent import create_constituent
from app.services.collections.creation.location import create_location

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Static seed data — small, hand-picked, museum-realistic
# ---------------------------------------------------------------------------

# (code, name, color, sort_order)
_DEPARTMENTS: list[tuple[str, str, str, int]] = [
    ("CUR", "Curatorial", "#5A7A52", 1),
    ("CON", "Conservation", "#8E6B3B", 2),
    ("REG", "Registrar", "#4A5A6B", 3),
    ("COL", "Collections Management", "#6B7A7E", 4),
    ("PHO", "Photography & Imaging", "#8E3B2F", 5),
]

# Hierarchical: (code, name, parent_code_or_None, location_type)
# location_type values must match the check_location_type CHECK constraint
# in collections.locations: building / wing / floor / room / area /
# cabinet / shelving_unit / shelf / drawer / bin / box / case / frame /
# rack / pallet / external / other. "Gallery" → "area" (gallery isn't a
# constraint value; "area" is the closest match for an exhibition room).
_LOCATIONS: list[tuple[str, str, str | None, str]] = [
    # Top-level building / site
    # location_type uses the values the frontend Zod enum accepts
    # (building|floor|room|case|shelf|drawer|other) — a subset of the DB
    # CHECK constraint. "wing"/"area" satisfy the DB but the UI rejects them,
    # so wings are typed "floor" and galleries "room"; the display names still
    # read "Wing"/"Gallery".
    ("MAIN", "Main Building", None, "building"),
    ("STG", "Storage Wing", "MAIN", "floor"),
    ("GAL", "Galleries", "MAIN", "floor"),
    ("OFF", "Offsite Storage", None, "building"),

    # Storage rooms (under STG)
    ("STG-101", "Climate-Controlled Storage 101", "STG", "room"),
    ("STG-102", "Painting Storage 102", "STG", "room"),
    ("STG-103", "Sculpture Storage 103", "STG", "room"),
    ("STG-104", "Works on Paper Storage 104", "STG", "room"),
    ("STG-201", "Object Storage 201", "STG", "room"),
    ("STG-202", "Textile Storage 202", "STG", "room"),

    # Galleries — typed "room" (a Zod-valid display space). Display label
    # still says "Gallery" so the demo UI reads naturally.
    ("GAL-A", "Gallery A — European Painting", "GAL", "room"),
    ("GAL-B", "Gallery B — Asian Art", "GAL", "room"),
    ("GAL-C", "Gallery C — American Wing", "GAL", "room"),
    ("GAL-D", "Gallery D — Decorative Arts", "GAL", "room"),
    ("GAL-E", "Gallery E — Special Exhibitions", "GAL", "room"),

    # Workrooms
    ("LAB-CON", "Conservation Lab", "MAIN", "room"),
    ("LAB-PHO", "Photography Studio", "MAIN", "room"),
    ("REG-RECV", "Registrar Receiving", "MAIN", "room"),

    # Offsite
    ("OFF-A", "Offsite Vault A", "OFF", "room"),
    ("OFF-B", "Offsite Vault B", "OFF", "room"),
]

# (constituent_type, name, role, organization_name, email, categories)
_CONTACTS: list[tuple[str, str, str | None, str | None, str | None, list[str]]] = [
    # People — internal-feeling (curators, conservators)
    ("person", "Dr. Helen Carmichael", "Senior Curator", None,
     "h.carmichael@example.org", ["staff", "curator"]),
    ("person", "Dr. Marcus Reyes", "Conservator (Paintings)", None,
     "m.reyes@example.org", ["staff", "conservator"]),
    ("person", "Naomi Tanaka", "Registrar", None,
     "n.tanaka@example.org", ["staff", "registrar"]),
    ("person", "Owen Brennan", "Photographer", None,
     "o.brennan@example.org", ["staff"]),

    # External lenders / partners
    ("organization", "The Cleveland Museum of Art", None, "The Cleveland Museum of Art",
     "loans@clevelandart.example", ["lender", "institution"]),
    ("organization", "Rijksmuseum Amsterdam", None, "Rijksmuseum",
     "international.loans@rijksmuseum.example", ["lender", "institution"]),
    ("organization", "Museum of Fine Arts, Boston", None, "MFA Boston",
     "registrar@mfa.example", ["lender", "institution"]),

    # Donors / private collectors
    ("person", "Catherine Whitfield", "Trustee, Donor", None,
     "c.whitfield@example.org", ["donor"]),
    ("person", "Dr. Eleanor Voss", "Estate Donor", None,
     None, ["donor", "deceased"]),
    ("organization", "The Whitfield Foundation", None, "Whitfield Foundation",
     "grants@whitfield-foundation.example", ["donor", "foundation"]),

    # Vendors
    ("organization", "Crozier Fine Arts", None, "Crozier Fine Arts",
     "logistics@crozier.example", ["vendor", "shipper"]),
    ("organization", "AXA Art Insurance", None, "AXA Art",
     "claims@axaart.example", ["vendor", "insurer"]),
    ("organization", "Tru Vue", None, "Tru Vue",
     "sales@truvue.example", ["vendor", "framing"]),

    # Researchers / authors
    ("person", "Dr. Lila Okonkwo", "Provenance Researcher", None,
     "l.okonkwo@example.org", ["researcher"]),
    ("person", "Prof. Daniel Park", "Visiting Scholar", "University of Chicago",
     "d.park@uchicago.example", ["researcher", "academic"]),
]


# ---------------------------------------------------------------------------
# Idempotent inserts
# ---------------------------------------------------------------------------

def _seed_departments(session: Session, org_id: UUID) -> int:
    """Insert departments. Returns count of new rows created."""
    created = 0
    for code, name, color, sort_order in _DEPARTMENTS:
        existing = (
            session.query(Department)
            .filter_by(organization_id=org_id, code=code)
            .first()
        )
        if existing:
            continue
        dept = Department(
            organization_id=org_id,
            code=code,
            name=name,
            color=color,
            sort_order=sort_order,
            description=f"Sandbox demo department: {name}",
            path="/",
            depth=0,
            is_active=True,
        )
        session.add(dept)
        created += 1
    session.flush()
    return created


def _seed_locations(
    session: Session, org_id: UUID, admin_user_id: UUID | None
) -> int:
    """Insert locations with hierarchy via ``create_location``. Returns the
    count of new rows.

    The shared service owns path/depth derivation, code handling, and the
    ``created_by``/``updated_by`` audit fields. We resolve each row's
    ``parent_code`` to a UUID from rows already present (prior run or earlier
    in this batch) and hand the service an explicit ``code`` + ``parent_id``.
    ``_LOCATIONS`` is ordered parents-before-children, so a single pass works.
    """
    created = 0
    code_to_id: dict[str, UUID] = {}

    # Pre-load any already-existing rows so re-runs don't try to re-create.
    for row in (
        session.query(Location).filter(Location.organization_id == org_id).all()
    ):
        code_to_id[row.code] = row.location_id

    for code, name, parent_code, ltype in _LOCATIONS:
        if code in code_to_id:
            continue  # already present from a prior run

        parent_id = code_to_id.get(parent_code) if parent_code else None
        if parent_code and parent_id is None:
            # Parent not yet inserted — _LOCATIONS is ordered, but be defensive.
            logger.warning(
                "sandbox seeder: location %s references unknown parent %s; skipping",
                code, parent_code,
            )
            continue

        loc = create_location(
            session,
            org_id,
            {
                "name": name,
                "location_type": ltype,
                "code": code,
                "parent_id": parent_id,
            },
            admin_user_id,
        )
        code_to_id[code] = loc.location_id
        created += 1

    return created


def _seed_contacts(
    session: Session, org_id: UUID, admin_user_id: UUID | None
) -> int:
    """Insert contacts (constituents) via ``create_constituent``. Returns the
    count of new rows. Idempotency is by name.

    ``Contact`` is an alias of ``Constituent`` (same table), so the shared
    constituent create service is the canonical path here too.
    """
    created = 0
    for ctype, name, role, org_name, email, categories in _CONTACTS:
        existing = (
            session.query(Contact)
            .filter_by(organization_id=org_id, name=name)
            .first()
        )
        if existing:
            continue
        create_constituent(
            session,
            org_id,
            {
                "constituent_type": ctype,
                "name": name,
                "role": role,
                "organization_name": org_name,
                "email": email,
                "contact_categories": categories,
            },
            admin_user_id,
        )
        created += 1
    session.flush()
    return created


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def seed_reference_data(
    session: Session, org_id: UUID, admin_user_id: UUID | None = None
) -> dict[str, Any]:
    """
    Seed reference data for a sandbox demo org.

    Idempotent: re-running on the same org skips already-existing rows.

    Args:
        session: SQLAlchemy session (caller manages commit boundaries).
        org_id: UUID of the demo organization.
        admin_user_id: actor recorded as ``created_by`` on locations and
            constituents (routed through the shared create services). Optional
            so existing bare-signature callers/tests still work; real
            provisioning passes the job's admin user.

    Returns:
        Dict with `departments_created`, `locations_created`,
        `contacts_created` counters. Counts reflect rows added by THIS
        invocation, not the total in the org.
    """
    if org_id is None:
        raise ValueError("seed_reference_data requires an org_id")

    departments = _seed_departments(session, org_id)
    locations = _seed_locations(session, org_id, admin_user_id)
    contacts = _seed_contacts(session, org_id, admin_user_id)
    session.commit()

    return {
        "departments_created": departments,
        "locations_created": locations,
        "contacts_created": contacts,
    }
