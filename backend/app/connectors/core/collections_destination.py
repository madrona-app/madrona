"""
Collections destination connector.

Writes canonical records from flow.entity_current into the collections
schema as CollectionObject records with related data (titles, creators,
other numbers, inscriptions, etc.).

Designed to work with any source connector that produces canonical
records — TMS, PastPerfect, CSV imports, etc. The canonical payload
must include properties with the standard field names.

Upsert logic:
- Match on (organization_id, object_number) to determine create vs update
- On update: overwrite all mapped fields, delete+recreate related records
- Preserves object_id across updates (stable UUID)

Does NOT handle:
- Media file ingestion (separate media connector)
- Location creation (maps location text to existing locations or stores as note)
- Loan/exhibition procedure creation (those are operational, not migration data)
"""

import logging
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy.orm import Session

from app.services.nagpra_restrictions import display_restricted_ids
from app.connectors.base import BaseTargetConnector
from app.models.objects import (
    CollectionObject,
    ObjectTitle,
    ObjectOtherNumber,
    ObjectClassification,
    ObjectInscription,
)

logger = logging.getLogger(__name__)


def _parse_date(val: Any) -> date | None:
    """Parse a date from various formats. Returns None on failure."""
    if val is None:
        return None
    if isinstance(val, date):
        return val
    if isinstance(val, datetime):
        return val.date()
    s = str(val).strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            return datetime.strptime(s[:len(fmt) + 4], fmt).date()
        except (ValueError, IndexError):
            continue
    # Try year-only
    try:
        year = int(s[:4])
        if 1000 <= year <= 2100:
            return date(year, 1, 1)
    except (ValueError, IndexError):
        pass
    return None


def _parse_year(val: Any) -> int | None:
    """Parse a year integer from various formats."""
    if val is None:
        return None
    try:
        v = int(val)
        return v if v != 0 else None
    except (ValueError, TypeError):
        return None


def _safe_str(val: Any, max_len: int | None = None) -> str | None:
    """Convert to string, strip, return None if empty."""
    if val is None:
        return None
    s = str(val).strip()
    if not s:
        return None
    if max_len:
        s = s[:max_len]
    return s


def _safe_decimal(val: Any) -> Decimal | None:
    """Convert to Decimal, return None for 0 or None."""
    if val is None:
        return None
    try:
        d = Decimal(str(val))
        return d if d != 0 else None
    except Exception:
        return None


# TMS ObjectStatus → Madrona object_status mapping
STATUS_MAP = {
    "Permanent Collection": "accessioned",
    "Deaccessioned": "deaccessioned",
    "(unknown)": "pending",
}


class CollectionsTargetConnector(BaseTargetConnector):
    """
    Target connector that writes canonical entities into Madrona Collections.

    Creates/updates CollectionObject records with titles, creators,
    alternate numbers, inscriptions, and other related data.

    Configuration:
        dry_run: If true, roll back instead of committing (default: false)
    """

    direction = "target"

    def validate_config(self) -> None:
        pass  # No required config — writes to the local database

    def publish_records(self, entities: list[dict[str, Any]]) -> None:
        """Publish canonical entities to Collections."""
        from app.database import get_session

        dry_run = self.config.get("dry_run", False)
        org_id = UUID(str(self.organization_id))

        # Build canonical record format from entity payloads
        canonical_records = []
        for entity in entities:
            payload = entity.get("payload", {})
            if not payload:
                continue
            canonical_records.append({
                "entity_key": entity.get("entity_key"),
                "object_number": entity.get("object_number") or payload.get("properties", {}).get("object_number"),
                "payload": payload,
            })

        # get_session(), not next(get_db()): get_db is an async generator now —
        # it has to be, so the context session actually reaches the endpoint —
        # and next() cannot drive one. get_session() is the sync equivalent and
        # it commits, rolls back and closes.
        with get_session() as db:
            result = import_canonical_to_collections(
                db, org_id, canonical_records, dry_run=dry_run,
            )
            logger.info(
                "Collections publish: created=%d updated=%d skipped=%d errors=%d",
                result["created"], result["updated"], result["skipped"], result["errors"],
            )
            if result["error_details"]:
                for err in result["error_details"][:5]:
                    logger.warning("  %s", err)

    def publish_change_log(self, changes: list[dict[str, Any]]) -> None:
        """Change log is handled by the canonical store — no-op here."""
        pass


def import_canonical_to_collections(
    db: Session,
    organization_id: UUID,
    canonical_records: list[dict[str, Any]],
    *,
    dry_run: bool = False,
) -> dict[str, Any]:
    """
    Import canonical records into the collections schema.

    Args:
        db: SQLAlchemy session
        organization_id: Target organization UUID
        canonical_records: List of canonical records (output of connector.normalize())
        dry_run: If True, roll back instead of committing

    Returns:
        Summary dict with counts of created, updated, skipped, errors
    """
    stats = {"created": 0, "updated": 0, "skipped": 0, "errors": 0, "error_details": []}
    now = datetime.now(timezone.utc)

    for record in canonical_records:
        try:
            _import_one(db, organization_id, record, stats, now)
        except Exception as e:
            stats["errors"] += 1
            obj_num = record.get("object_number", record.get("entity_key", "?"))
            stats["error_details"].append(f"{obj_num}: {e}")
            logger.exception("Error importing %s", obj_num)
            db.rollback()

    if dry_run:
        db.rollback()
        logger.info("Dry run — rolled back. Would have created=%d updated=%d",
                     stats["created"], stats["updated"])
    else:
        db.commit()

    return stats


def _import_one(
    db: Session,
    organization_id: UUID,
    record: dict[str, Any],
    stats: dict,
    now: datetime,
) -> None:
    """Import a single canonical record."""
    props = record.get("payload", {}).get("properties", {})
    object_number = _safe_str(props.get("object_number"), 100)

    if not object_number:
        stats["skipped"] += 1
        return

    # Check if object already exists
    existing = db.query(CollectionObject).filter(
        CollectionObject.organization_id == organization_id,
        CollectionObject.object_number == object_number,
    ).first()

    if existing:
        obj = existing
        is_new = False
    else:
        obj = CollectionObject(
            object_id=uuid4(),
            organization_id=organization_id,
            object_number=object_number,
        )
        is_new = True

    # ── Map flat fields ──────────────────────────────────────────────

    obj.object_name = _safe_str(props.get("object_name"), 255)
    obj.brief_description = _safe_str(props.get("description"))
    obj.responsible_department = _safe_str(props.get("department"), 100)
    obj.object_type = _safe_str(props.get("classification"), 100)
    obj.physical_description = _safe_str(props.get("medium"))
    obj.credit_line = _safe_str(props.get("credit_line"), 500)
    obj.provenance = _safe_str(props.get("provenance"))
    obj.comments = _safe_str(props.get("notes"))
    obj.creation_date_display = _safe_str(props.get("dated"), 100)

    # Public discoverability is a consent decision, not a mapped field.
    #
    # Two problems with `obj.is_discoverable = bool(props.get("public_access"))`
    # on every upsert: a source that simply omits the key silently un-published
    # everything it touched, and a source that asserts it re-published objects
    # whose NAGPRA display consent had been revoked in Madrona — the import
    # quietly undid the revocation the single-object endpoint refuses with a
    # 409. Absent key now means "no opinion"; an asserted True still has to
    # clear the NAGPRA display gate (43 CFR 10 duty of care).
    if "public_access" in props:
        wants_discoverable = bool(props.get("public_access"))
        if wants_discoverable and not is_new and display_restricted_ids(
            db, organization_id, [obj.object_id]
        ):
            logger.warning(
                "Import left object %s undiscoverable: NAGPRA action without "
                "granted display consent overrides the source's public_access",
                obj.object_id,
            )
        else:
            obj.is_discoverable = wants_discoverable

    # Date range
    date_begin = _parse_year(props.get("date_begin"))
    date_end = _parse_year(props.get("date_end"))
    if date_begin:
        obj.creation_date_earliest = date(date_begin, 1, 1)
    if date_end:
        obj.creation_date_latest = date(date_end, 12, 31)

    # Inscriptions → flat fields (structured inscriptions via link table below)
    obj.distinguishing_features = _safe_str(props.get("signed"))
    if props.get("markings"):
        existing_features = obj.distinguishing_features or ""
        markings = _safe_str(props.get("markings"))
        if markings and markings not in existing_features:
            obj.distinguishing_features = (existing_features + "\n" + markings).strip() if existing_features else markings

    # Dimensions text
    dim_text = _safe_str(props.get("dimensions_text"))
    if not dim_text:
        # Try to build from structured dimensions
        dim_parts = []
        for d in props.get("dimensions", []):
            display = d.get("display")
            if display:
                desc = d.get("description", "")
                dim_parts.append(f"{desc}: {display}".strip(": "))
        if dim_parts:
            dim_text = "; ".join(dim_parts)
    # Store in full_description if no dedicated dimensions text field
    if dim_text and not obj.full_description:
        obj.full_description = dim_text

    # Status
    status_text = props.get("object_status", "")
    obj.object_status = STATUS_MAP.get(status_text, "pending")

    # Acquisition
    ACQUISITION_METHOD_MAP = {
        "gift": "gift",
        "purchase": "purchase",
        "bequest": "bequest",
        "transfer": "transfer",
        "exchange": "exchange",
        "field collection": "field_collection",
        "found in collection": "found_in_collection",
    }
    accession = props.get("accession")
    if accession:
        raw_method = _safe_str(accession.get("method"), 50)
        if raw_method:
            obj.acquisition_method = ACQUISITION_METHOD_MAP.get(raw_method.lower())
        obj.acquisition_source = _safe_str(accession.get("source"), 255)
        obj.acquisition_cost = _safe_decimal(accession.get("value"))
        obj.accession_date = _parse_date(accession.get("date"))
        obj.acquisition_reason = _safe_str(accession.get("justification"))

    # Context (culture, period, style)
    context = props.get("context")
    if context:
        obj.style_period = _safe_str(context.get("period"), 100) or _safe_str(context.get("style"), 100)
        obj.associated_cultural_affinity = _safe_str(context.get("culture"), 255)

    # Creators (JSONB on CollectionObject for now — simpler than ObjectCreator link table)
    creators = props.get("creators", [])
    if creators:
        obj.creators = [
            {
                "name": c.get("name"),
                "role": c.get("role", "Artist"),
                "date": c.get("date"),
            }
            for c in creators if c.get("name")
        ]

    # Exhibition history (JSONB)
    exhibitions = props.get("exhibitions", [])
    if exhibitions:
        obj.exhibition_history = [
            {
                "title": ex.get("title"),
                "begin_date": ex.get("begin_date"),
                "end_date": ex.get("end_date"),
                "section": ex.get("section"),
            }
            for ex in exhibitions if ex.get("title")
        ]

    # Location — store as note (location authority matching is a separate step)
    current_location = _safe_str(props.get("current_location"))
    if current_location:
        obj.current_location_note = current_location

    if is_new:
        db.add(obj)
        db.flush()  # get object_id assigned
        stats["created"] += 1
    else:
        db.flush()
        stats["updated"] += 1

    # ── Related records (delete + recreate on update) ────────────────

    object_id = obj.object_id

    if not is_new:
        # Clear existing related records for clean reimport
        db.query(ObjectTitle).filter(ObjectTitle.object_id == object_id).delete()
        db.query(ObjectOtherNumber).filter(ObjectOtherNumber.object_id == object_id).delete()
        db.query(ObjectInscription).filter(ObjectInscription.object_id == object_id).delete()

    # Titles
    for i, t in enumerate(props.get("titles", [])):
        title_text = _safe_str(t.get("title"))
        if not title_text:
            continue
        title_type = t.get("title_type", "Primary")
        db.add(ObjectTitle(
            link_id=uuid4(),
            organization_id=organization_id,
            object_id=object_id,
            title=title_text,
            title_type=title_type if title_type != "(not entered)" else None,
            is_preferred=(i == 0),
            display_order=t.get("display_order", i),
        ))

    # Alternate numbers
    for i, an in enumerate(props.get("alt_numbers", [])):
        num = _safe_str(an.get("number"))
        if not num:
            continue
        db.add(ObjectOtherNumber(
            link_id=uuid4(),
            organization_id=organization_id,
            object_id=object_id,
            number_type=an.get("description", "Previous Number") or "Previous Number",
            number_value=num,
            display_order=i,
        ))

    # Inscriptions (from TMS Signed/Inscribed fields)
    inscribed = _safe_str(props.get("inscribed"))
    if inscribed:
        db.add(ObjectInscription(
            link_id=uuid4(),
            organization_id=organization_id,
            object_id=object_id,
            content=inscribed,
            inscription_type="inscription",
            display_order=0,
        ))

    db.flush()
