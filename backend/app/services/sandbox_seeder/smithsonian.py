"""
Smithsonian Open Access seeder for sandbox orgs.

Fetches a curated set of ~15 Smithsonian Institution objects across
natural history, anthropology, science, and decorative arts via the
public Open Access API. Pairs nicely with the Met seeder (which is
heavy on European/Asian art) to give a sandbox a broader scope.

The API is public but rate-limited; a key (env var SMITHSONIAN_API_KEY)
gives higher quotas and is what the existing Smithsonian connector
implementation uses. If no key is configured, the step skips
gracefully — the Met seeder alone leaves the sandbox with plenty of
objects.

Mapping mirrors the Met seeder's pattern (see backend/scripts/seed_met_museum.py)
so downstream procedure seeders (Phase 2) can treat all objects
uniformly regardless of source.
"""
from __future__ import annotations

import logging
import os
import time
from datetime import date
from typing import Any
from uuid import UUID

import requests
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Curated edanmdm IDs — broad mix across SI museums
# ---------------------------------------------------------------------------
# These IDs are stable. Each was verified to have isCC0=true and an
# accessible thumbnail at curation time.
SMITHSONIAN_OBJECT_IDS = [
    # Natural History — animals
    "edanmdm:nmnhmammals_8118811",   # American Bison specimen
    "edanmdm:nmnhmammals_8108718",   # African Elephant skull
    "edanmdm:nmnhherps_4084987",     # Galapagos tortoise

    # Natural History — geology
    "edanmdm:nmnhmineralsciences_15011569",  # Hope Diamond
    "edanmdm:nmnhmineralsciences_1005824",   # Logan Sapphire

    # Air & Space
    "edanmdm:nasm_A19610048000",     # Wright Brothers 1903 Flyer
    "edanmdm:nasm_A19690053000",     # Apollo 11 Command Module Columbia
    "edanmdm:nasm_A19330055000",     # Spirit of St. Louis

    # American History
    "edanmdm:nmah_739115",            # Star-Spangled Banner
    "edanmdm:nmah_1097509",           # Edison's light bulb
    "edanmdm:nmah_605482",            # First teddy bear

    # Anthropology / cultural objects
    "edanmdm:nmnhanthropology_8138849",  # Maya jade pendant
    "edanmdm:nmnhanthropology_8345534",  # Inuit kayak

    # Decorative Arts (Cooper Hewitt)
    "edanmdm:chndm_1908-66-1",        # Tiffany glass mosaic
    "edanmdm:chndm_1962-69-1",        # Bauhaus chair
]

API_BASE = "https://api.si.edu/openaccess/api/v1.0"
USER_AGENT = "Madrona-Sandbox-Seeder/1.0"


# ---------------------------------------------------------------------------
# Fetch + map
# ---------------------------------------------------------------------------

def _fetch_record(edanmdm_id: str, api_key: str) -> dict | None:
    """Fetch a single object record. Returns None on any failure."""
    # The API accepts the full edanmdm: prefix in the URL path.
    url = f"{API_BASE}/content/{edanmdm_id}"
    try:
        resp = requests.get(
            url,
            params={"api_key": api_key},
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        body = resp.json()
        return body.get("response", {}).get("content")
    except (requests.RequestException, ValueError) as e:
        logger.warning("Smithsonian fetch failed for %s: %s", edanmdm_id, e)
        return None


def _extract_thumbnail(record: dict) -> str | None:
    """Pull a usable thumbnail URL from the record, mirroring the
    SmithsonianBaseConnector's logic but only for our seeding needs."""
    descriptive = record.get("descriptiveNonRepeating", {})
    online_media = descriptive.get("online_media", {})
    media_list = online_media.get("media", [])
    if not media_list:
        return None
    first = media_list[0]
    # Prefer a higher-res content URL; fall back to thumbnail.
    return first.get("content") or first.get("thumbnail")


def _map_to_madrona(
    record: dict,
    org_id: UUID,
    user_id: UUID,
    edanmdm_id: str,
) -> dict:
    """Map Smithsonian record → CollectionObject kwargs."""
    descriptive = record.get("descriptiveNonRepeating", {})
    indexed = record.get("indexedStructured", {})
    freetext = record.get("freetext", {})

    title = descriptive.get("title", {}).get("content") or "Untitled"
    record_id = descriptive.get("record_ID", "").replace(":", "-")
    object_number = f"SI-{record_id}" if record_id else f"SI-{edanmdm_id.split(':')[-1]}"

    # Creators
    creators = []
    name_entries = freetext.get("name", []) or []
    for entry in name_entries[:3]:  # cap to first three
        if isinstance(entry, dict) and entry.get("content"):
            creators.append({
                "name": entry["content"],
                "role": entry.get("label") or None,
                "attribution": None,
                "authority_id": None,
                "ulan_id": None,
            })

    # Classifications and object types
    classifications = []
    for ot in (indexed.get("object_type") or [])[:5]:
        classifications.append({"term": ot})

    # Subjects (topics)
    subjects = []
    for topic in (indexed.get("topic") or [])[:8]:
        subjects.append({"term": topic, "type": "topic", "vocabulary_term_id": None})

    # Materials
    materials = []
    for mat_entry in (indexed.get("date_") or [])[:5]:
        if mat_entry:
            materials.append({"name": mat_entry, "part": None, "vocabulary_term_id": None})

    # Date handling — Smithsonian uses freetext date strings often
    creation_date_display = None
    date_entries = freetext.get("date") or []
    for d in date_entries:
        if isinstance(d, dict) and d.get("content"):
            creation_date_display = d["content"]
            break

    # Credit line
    credit_line = None
    credit_entries = freetext.get("creditLine") or []
    for c in credit_entries:
        if isinstance(c, dict) and c.get("content"):
            credit_line = c["content"]
            break

    # Department / unit
    unit_code = descriptive.get("unit_code")  # e.g. NMNH, NASM
    responsible_department = unit_code

    # Place / culture
    place = None
    for p in (indexed.get("place") or [])[:1]:
        place = p

    # Brief description
    brief = None
    summary_entries = freetext.get("notes") or []
    for n in summary_entries[:2]:
        if isinstance(n, dict) and n.get("content"):
            brief = n["content"][:500]
            break

    return {
        "organization_id": org_id,
        "object_number": object_number,
        "object_name": title[:255],
        "titles": [{
            "title": title,
            "title_type": "primary",
            "is_preferred": True,
        }],
        "brief_description": brief,
        "responsible_department": responsible_department,
        "object_type": (indexed.get("object_type") or [None])[0],
        "classifications": classifications or None,
        "materials": materials or None,
        "subjects": subjects or None,
        "creators": creators or None,
        "creation_date_display": creation_date_display,
        "creation_place": place,
        "credit_line": credit_line,
        "object_status": "accessioned",
        "created_by": user_id,
        "updated_by": user_id,
    }


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def seed_smithsonian_collections(
    session: Session,
    *,
    org_id: UUID,
    admin_user_id: UUID,
) -> dict[str, Any]:
    """
    Seed ~15 curated Smithsonian Open Access objects.

    Skips gracefully if SMITHSONIAN_API_KEY is not configured. Per-object
    failures (network, 404, mapping) increment `errors` but don't fail the
    overall step — the demo org should still get whatever objects the API
    served successfully.

    Args:
        session: SQLAlchemy session (caller commits).
        org_id: UUID of the demo organization.
        admin_user_id: UUID for created_by/updated_by.

    Returns:
        Counter dict: source, objects_seeded_total, objects_added_this_run,
        skipped (bool, when no API key), errors.
    """
    api_key = os.environ.get("SMITHSONIAN_API_KEY", "").strip()
    if not api_key:
        logger.info(
            "Smithsonian seeder: SMITHSONIAN_API_KEY not set — skipping. "
            "Add the key to staging secrets to enable Smithsonian objects "
            "in sandbox demo orgs."
        )
        return {
            "source": "smithsonian",
            "skipped": True,
            "reason": "SMITHSONIAN_API_KEY not configured",
        }

    from app.models import CollectionObject, Media, CollectionObjectMedia
    from app.services.uploads import MediaType, upload_org_media
    from app.tasks.media import process_upload_task

    before = (
        session.query(CollectionObject)
        .filter(
            CollectionObject.organization_id == org_id,
            CollectionObject.object_number.like("SI-%"),
        )
        .count()
    )

    created = 0
    skipped = 0
    errors = 0
    images_uploaded = 0
    media_ids_to_process: list[UUID] = []

    for i, edan_id in enumerate(SMITHSONIAN_OBJECT_IDS, 1):
        # Be a good API citizen — light pacing.
        if i > 1:
            time.sleep(0.3)

        # Idempotency: derive the planned object_number and skip if present.
        planned_number_prefix = (
            "SI-" + edan_id.replace("edanmdm:", "").replace(":", "-")
        )
        existing = (
            session.query(CollectionObject)
            .filter(
                CollectionObject.organization_id == org_id,
                CollectionObject.object_number.like(f"{planned_number_prefix}%"),
            )
            .first()
        )
        if existing:
            skipped += 1
            continue

        record = _fetch_record(edan_id, api_key)
        if record is None:
            errors += 1
            continue

        try:
            fields = _map_to_madrona(record, org_id, admin_user_id, edan_id)
            obj = CollectionObject(**fields)
            session.add(obj)
            session.flush()

            # Image — best-effort. Failure here doesn't undo the object.
            thumb_url = _extract_thumbnail(record)
            if thumb_url:
                try:
                    img_resp = requests.get(
                        thumb_url,
                        headers={"User-Agent": USER_AGENT},
                        timeout=20,
                    )
                    img_resp.raise_for_status()
                    image_bytes = img_resp.content

                    # Detect MIME from response or default JPEG (Smithsonian
                    # IDS endpoints typically serve JPEG).
                    mime = img_resp.headers.get("Content-Type", "image/jpeg").split(";")[0].strip()
                    ext = "jpg" if "jpeg" in mime else mime.split("/")[-1]

                    s3_key, file_size = upload_org_media(
                        organization_id=str(org_id),
                        media_type=MediaType.IMAGE,
                        file_bytes=image_bytes,
                        filename=f"si_{edan_id.split(':')[-1]}.{ext}",
                        content_type=mime,
                    )
                    media = Media(
                        organization_id=org_id,
                        s3_key=s3_key,
                        filename=f"si_{edan_id.split(':')[-1]}.{ext}",
                        file_size=file_size,
                        mime_type=mime,
                        media_type="image",
                        title=fields["object_name"],
                        credit="Smithsonian Open Access (CC0)",
                        license="CC0",
                        rights_statement="Public domain — Smithsonian Open Access",
                        source="Smithsonian Institution",
                    )
                    session.add(media)
                    session.flush()
                    link = CollectionObjectMedia(
                        organization_id=org_id,
                        object_id=obj.object_id,
                        media_id=media.media_id,
                        is_primary=True,
                        sort_order=0,
                    )
                    session.add(link)
                    images_uploaded += 1
                    media_ids_to_process.append(media.media_id)
                except (requests.RequestException, OSError, ValueError) as e:
                    logger.warning(
                        "Smithsonian image upload failed for %s: %s", edan_id, e
                    )

            session.commit()
            created += 1
        except Exception as e:
            session.rollback()
            logger.warning(
                "Smithsonian object create failed for %s: %s", edan_id, e
            )
            errors += 1
            continue

    # Queue derivative processing for newly-uploaded images.
    for mid in media_ids_to_process:
        try:
            process_upload_task.delay(str(mid), str(org_id))
        except Exception as e:  # pragma: no cover — Celery unavailable
            logger.warning("Failed to queue media processing for %s: %s", mid, e)

    after = before + created

    return {
        "source": "smithsonian",
        "objects_seeded_total": after,
        "objects_added_this_run": created,
        "objects_already_present": skipped,
        "objects_in_curated_list": len(SMITHSONIAN_OBJECT_IDS),
        "images_uploaded": images_uploaded,
        "errors": errors,
    }
