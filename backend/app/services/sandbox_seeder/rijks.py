"""
Rijksmuseum seeder for sandbox orgs.

Fetches a curated set of ~10 famous Dutch Golden Age + earlier paintings
and prints from the Rijksmuseum's public collection. Adds European
breadth on top of the Met's mix.

The Rijksmuseum API requires a free key from data.rijksmuseum.nl. If
RIJKSMUSEUM_API_KEY is not set, this step skips gracefully.

API: https://www.rijksmuseum.nl/api/{lang}/collection/{object_number}?key={key}
Image URLs come from the `webImage.url` field of the response.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any
from uuid import UUID

import requests
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Curated Rijksmuseum object numbers — 10 well-known, all CC0
# ---------------------------------------------------------------------------
RIJKS_OBJECT_NUMBERS = [
    "SK-C-5",         # The Night Watch — Rembrandt
    "SK-A-2099",      # The Milkmaid — Vermeer
    "SK-A-1718",      # Self-Portrait — Van Gogh
    "SK-A-180",       # The Merry Family — Jan Steen
    "SK-A-2860",      # Portrait of a Young Woman — Hals
    "BK-NM-12400-477", # Delftware tile
    "RP-T-1898-A-3915", # Drawing — Rembrandt
    "SK-A-3262",      # Garden of the Hesperides — drawing
    "SK-A-217",       # The Threatened Swan — Asselijn
    "SK-A-4691",      # The Jewish Bride — Rembrandt
]

API_BASE = "https://www.rijksmuseum.nl/api/en/collection"
USER_AGENT = "Madrona-Sandbox-Seeder/1.0"


def _fetch_record(object_number: str, api_key: str) -> dict | None:
    """Fetch a single object record. Returns None on failure."""
    url = f"{API_BASE}/{object_number}"
    try:
        resp = requests.get(
            url,
            params={"key": api_key, "format": "json"},
            headers={"User-Agent": USER_AGENT},
            timeout=15,
        )
        resp.raise_for_status()
        return resp.json().get("artObject")
    except (requests.RequestException, ValueError) as e:
        logger.warning("Rijks fetch failed for %s: %s", object_number, e)
        return None


def _map_to_madrona(
    record: dict,
    org_id: UUID,
    user_id: UUID,
) -> dict:
    """Map Rijksmuseum artObject → CollectionObject kwargs."""
    object_number = record.get("objectNumber", "")
    title = record.get("title") or "Untitled"
    long_title = record.get("longTitle") or title

    creators: list[dict[str, Any]] = []
    principal_makers = record.get("principalMakers") or []
    for maker in principal_makers[:3]:
        if maker.get("name"):
            creators.append({
                "name": maker["name"],
                "role": maker.get("roles", [None])[0] if maker.get("roles") else None,
                "attribution": maker.get("qualification") or None,
                "authority_id": None,
                "ulan_id": None,
            })
    # Fallback to principalMaker (string) if structured list missing.
    if not creators and record.get("principalMaker"):
        creators.append({
            "name": record["principalMaker"],
            "role": None,
            "attribution": None,
            "authority_id": None,
            "ulan_id": None,
        })

    classifications = []
    obj_types = record.get("objectTypes") or []
    for ot in obj_types[:5]:
        classifications.append({"term": ot})

    materials = []
    for m in (record.get("materials") or [])[:5]:
        materials.append({"name": m, "part": None, "vocabulary_term_id": None})

    techniques = []
    for t in (record.get("techniques") or [])[:5]:
        techniques.append({"name": t})

    subjects = []
    for tag in (record.get("subTitle", "").split(",") if record.get("subTitle") else []):
        tag = tag.strip()
        if tag:
            subjects.append({"term": tag, "type": "topic", "vocabulary_term_id": None})

    # Date display from dating block
    dating = record.get("dating", {}) or {}
    creation_date_display = (
        dating.get("presentingDate")
        or dating.get("yearLate")
        or None
    )

    # Earliest/latest dates if numeric
    creation_date_earliest = None
    creation_date_latest = None
    try:
        if dating.get("yearEarly"):
            from datetime import date as _date
            ye = int(dating["yearEarly"])
            if 1 <= ye <= 2100:
                creation_date_earliest = _date(ye, 1, 1)
        if dating.get("yearLate"):
            from datetime import date as _date
            yl = int(dating["yearLate"])
            if 1 <= yl <= 2100:
                creation_date_latest = _date(yl, 12, 31)
    except (TypeError, ValueError):
        pass

    physical_description = record.get("physicalMedium") or None

    return {
        "organization_id": org_id,
        "object_number": f"RIJKS-{object_number}",
        "object_name": title[:255],
        "titles": [{
            "title": long_title,
            "title_type": "primary",
            "is_preferred": True,
        }],
        "brief_description": record.get("description") or None,
        "responsible_department": "Rijksmuseum",
        "object_type": (obj_types[0] if obj_types else None),
        "classifications": classifications or None,
        "materials": materials or None,
        "techniques": techniques or None,
        "subjects": subjects or None,
        "physical_description": physical_description,
        "creators": creators or None,
        "creation_date_display": creation_date_display,
        "creation_date_earliest": creation_date_earliest,
        "creation_date_latest": creation_date_latest,
        "creation_place": (record.get("productionPlaces") or [None])[0],
        "credit_line": "Rijksmuseum Amsterdam",
        "object_status": "accessioned",
        "created_by": user_id,
        "updated_by": user_id,
    }


def seed_rijks_collections(
    session: Session,
    *,
    org_id: UUID,
    admin_user_id: UUID,
) -> dict[str, Any]:
    """
    Seed ~10 curated Rijksmuseum CC0 paintings/prints.

    Skips gracefully if RIJKSMUSEUM_API_KEY is not configured. Per-object
    failures are tolerated (count under `errors`); the step does not raise.

    Args:
        session: SQLAlchemy session (caller commits).
        org_id: UUID of the demo organization.
        admin_user_id: UUID for created_by/updated_by.

    Returns:
        Counter dict: source, objects_seeded_total, objects_added_this_run,
        skipped, errors.
    """
    api_key = os.environ.get("RIJKSMUSEUM_API_KEY", "").strip()
    if not api_key:
        logger.info(
            "Rijksmuseum seeder: RIJKSMUSEUM_API_KEY not set — skipping. "
            "Add the key to staging secrets to enable Rijks objects."
        )
        return {
            "source": "rijks",
            "skipped": True,
            "reason": "RIJKSMUSEUM_API_KEY not configured",
        }

    from app.models import CollectionObject, Media, CollectionObjectMedia
    from app.services.uploads import MediaType, upload_org_media
    from app.tasks.media import process_upload_task

    before = (
        session.query(CollectionObject)
        .filter(
            CollectionObject.organization_id == org_id,
            CollectionObject.object_number.like("RIJKS-%"),
        )
        .count()
    )

    created = 0
    skipped = 0
    errors = 0
    images_uploaded = 0
    media_ids_to_process: list[UUID] = []

    for i, obj_num in enumerate(RIJKS_OBJECT_NUMBERS, 1):
        if i > 1:
            time.sleep(0.3)

        existing = (
            session.query(CollectionObject)
            .filter(
                CollectionObject.organization_id == org_id,
                CollectionObject.object_number == f"RIJKS-{obj_num}",
            )
            .first()
        )
        if existing:
            skipped += 1
            continue

        record = _fetch_record(obj_num, api_key)
        if record is None:
            errors += 1
            continue

        try:
            fields = _map_to_madrona(record, org_id, admin_user_id)
            obj = CollectionObject(**fields)
            session.add(obj)
            session.flush()

            # Image — webImage.url is the full-resolution direct link.
            web_image = record.get("webImage") or {}
            image_url = web_image.get("url")
            if image_url:
                try:
                    img_resp = requests.get(
                        image_url,
                        headers={"User-Agent": USER_AGENT},
                        timeout=30,
                    )
                    img_resp.raise_for_status()
                    image_bytes = img_resp.content
                    mime = "image/jpeg"  # Rijks API serves JPEG
                    s3_key, file_size = upload_org_media(
                        organization_id=str(org_id),
                        media_type=MediaType.IMAGE,
                        file_bytes=image_bytes,
                        filename=f"rijks_{obj_num}.jpg",
                        content_type=mime,
                    )
                    media = Media(
                        organization_id=org_id,
                        s3_key=s3_key,
                        filename=f"rijks_{obj_num}.jpg",
                        file_size=file_size,
                        mime_type=mime,
                        media_type="image",
                        title=fields["object_name"],
                        credit="Rijksmuseum, Amsterdam (CC0)",
                        license="CC0",
                        rights_statement="Public domain — Rijksmuseum Amsterdam",
                        source="Rijksmuseum",
                        width=web_image.get("width") or None,
                        height=web_image.get("height") or None,
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
                        "Rijks image upload failed for %s: %s", obj_num, e
                    )

            session.commit()
            created += 1
        except Exception as e:
            session.rollback()
            logger.warning("Rijks object create failed for %s: %s", obj_num, e)
            errors += 1
            continue

    for mid in media_ids_to_process:
        try:
            process_upload_task.delay(str(mid), str(org_id))
        except Exception as e:  # pragma: no cover
            logger.warning("Failed to queue media processing for %s: %s", mid, e)

    after = before + created

    return {
        "source": "rijks",
        "objects_seeded_total": after,
        "objects_added_this_run": created,
        "objects_already_present": skipped,
        "objects_in_curated_list": len(RIJKS_OBJECT_NUMBERS),
        "images_uploaded": images_uploaded,
        "errors": errors,
    }
