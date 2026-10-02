"""
Manifest-driven sandbox seeder.

Replaces the old per-provision Met API hammer (`seed_met_collections`).
Reads a checked-in JSON manifest with pre-mapped object data and
references to images already uploaded to a shared S3 prefix, then
materializes:

    CollectionObject + ObjectTitle + ObjectPart + Media + CollectionObjectMedia

…rows for the requesting org. No network calls. No per-row mapping
logic — that work was done once during the bootstrap script.

The manifest lives at:

    backend/app/services/sandbox_seeder/fixtures/met-manifest.json

…built by `backend/scripts/build_sandbox_manifest.py`. Each entry is
shaped:

    {
      "met_id": "436535",
      "object_number": "MET-436535",
      "object_fields": {<CollectionObject column values>},
      "titles": [{"title": "...", "title_type": "primary", "is_preferred": true}],
      "media": {
        "s3_key": "sandbox-fixtures/met/436535.jpg",
        "file_size": 1234567,
        "mime_type": "image/jpeg",
        "title": "...",
        "alt_text": "...",
        "credit": "...",
        ...
      }
    }

Image bytes live in `s3://madrona-media-{region}/sandbox-fixtures/met/<id>.jpg`,
shared across every sandbox org. The CDN URL builder is a pure prefix
concat; the application-layer permission gate keys off
`Media.organization_id` (= the sandbox's), not the s3_key prefix, so
sharing is safe.

Idempotent: skips any object_number already present in the target org.
Returns a counter dict for the saga step.
"""
from __future__ import annotations

import json
import logging
from datetime import date, datetime
from importlib import resources
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

from app.models import (
    CollectionObject,
    CollectionObjectMedia,
    Media,
)
from app.models.objects import ObjectTitle
from app.services.collections.creation.collection_object import create_collection_object
from app.fastapi_app.serializers.collections_helpers import _index_collection_object

logger = logging.getLogger(__name__)


# Source labels in the manifest map to the file under
# fixtures/<source>-manifest.json. Smithsonian/Rijks ship empty/absent
# manifests until their bootstraps run (Smithsonian needs an API key;
# Rijks does not but the bootstrap still has to run once). The seeder
# treats a missing manifest as a graceful skip — it returns a result
# with `skipped: true` rather than failing the saga step.
_KNOWN_SOURCES = ("met", "smithsonian", "rijks")


def _load_manifest(source: str) -> list[dict[str, Any]] | None:
    """Load manifest entries, or None when the file isn't shipped.

    The Met manifest ships in the repo. Smithsonian/Rijks ship only
    after their bootstraps run on a machine with the right credentials.
    The saga step treats a missing file as a graceful skip; callers
    must handle None.
    """
    if source not in _KNOWN_SOURCES:
        raise ValueError(f"Unknown manifest source '{source}'")
    pkg = "app.services.sandbox_seeder.fixtures"
    name = f"{source}-manifest.json"
    try:
        text = (resources.files(pkg) / name).read_text(encoding="utf-8")
    except FileNotFoundError:
        return None
    return json.loads(text)


def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except (ValueError, TypeError):
        return None


def _coerce_object_fields(raw: dict[str, Any]) -> dict[str, Any]:
    """Convert ISO-string dates → date(); pass through everything else."""
    fields = dict(raw)
    for key in ("creation_date_earliest", "creation_date_latest"):
        if key in fields:
            fields[key] = _parse_iso_date(fields[key])
    return fields


def seed_collections_from_manifest(
    session: Session,
    *,
    org_id: UUID,
    admin_user_id: UUID,
    source: str = "met",
) -> dict[str, Any]:
    """Materialize the manifest into the sandbox org.

    Args:
        session: SQLAlchemy session (caller manages commit boundaries
            — we issue one commit at the end).
        org_id: target sandbox org.
        admin_user_id: created_by/updated_by audit value.
        source: manifest selector. Currently 'met' only.

    Returns:
        Counter dict for the saga step.
    """
    if org_id is None or admin_user_id is None:
        raise ValueError("seed_collections_from_manifest requires org_id and admin_user_id")

    entries = _load_manifest(source)
    if entries is None:
        logger.info(
            "manifest %s not shipped — skipping. Run "
            "backend/scripts/build_sandbox_manifest.py --source %s to populate.",
            source, source,
        )
        return {
            "source": source,
            "skipped": True,
            "reason": "manifest not available",
            "objects_added_this_run": 0,
            "objects_skipped_existing": 0,
            "manifest_size": 0,
        }
    if not entries:
        logger.warning("manifest %s is empty", source)
        return {
            "source": source,
            "skipped": True,
            "reason": "manifest is empty",
            "objects_added_this_run": 0,
            "objects_skipped_existing": 0,
            "manifest_size": 0,
        }

    objects_created = 0
    titles_created = 0
    parts_created = 0
    media_created = 0
    media_links_created = 0
    skipped_existing = 0

    for entry in entries:
        object_number = entry["object_number"]

        # Idempotency: skip if this MET-<id> already exists for the org.
        existing = (
            session.query(CollectionObject)
            .filter(
                CollectionObject.organization_id == org_id,
                CollectionObject.object_number == object_number,
            )
            .first()
        )
        if existing:
            skipped_existing += 1
            continue

        # Route through the real create service so a seeded object is treated
        # exactly like a user-created one: field coercion, created_by/updated_by,
        # and an auto-created default ObjectPart. is_discoverable is set as a
        # deliberate publish act so the demo's Discover gallery + public IIIF
        # expose the object (every anonymous surface gates on is_discoverable).
        # Pre-coerce the scraped manifest fields defensively (junk dates -> None)
        # before handing to the create service, which assumes already-clean input.
        payload = {
            **_coerce_object_fields(entry.get("object_fields") or {}),
            "object_number": object_number,
            "is_discoverable": True,
        }
        obj = create_collection_object(session, org_id, payload, admin_user_id)
        objects_created += 1
        parts_created += 1  # create_collection_object creates the default part

        for idx, t in enumerate(entry.get("titles") or []):
            title_text = t.get("title")
            if not title_text:
                continue
            session.add(ObjectTitle(
                organization_id=org_id,
                object_id=obj.object_id,
                title=title_text,
                title_type=t.get("title_type"),
                is_preferred=bool(t.get("is_preferred", False)),
                display_order=idx,
                created_by=admin_user_id,
            ))
            titles_created += 1

        session.flush()  # titles visible before we index
        # Index into OpenSearch exactly as the create route does, so the object
        # is searchable/listable immediately. Guarded: no-ops if OpenSearch is
        # unavailable (e.g. unit tests); the provisioning index_search step is
        # the backstop that reindexes the whole org.
        _index_collection_object(obj)

        media_meta = entry.get("media")
        if media_meta and media_meta.get("s3_key"):
            media_row = Media(
                organization_id=org_id,
                s3_key=media_meta["s3_key"],
                # Filename used for display + downloads; mirror the s3 key tail.
                filename=media_meta["s3_key"].rsplit("/", 1)[-1],
                file_size=int(media_meta.get("file_size") or 0),
                mime_type=media_meta.get("mime_type") or "image/jpeg",
                media_type="image",
                title=media_meta.get("title"),
                alt_text=media_meta.get("alt_text"),
                credit=media_meta.get("credit"),
                creator=media_meta.get("creator"),
                source=media_meta.get("source"),
                copyright_status=media_meta.get("copyright_status"),
                rights_statement=media_meta.get("rights_statement"),
                license=media_meta.get("license"),
                # Mirror the upload route: created 'pending'; the real processing
                # task owns the full derivative ladder, dimensions,
                # thumbnail_s3_key, search indexing, and the flip to 'completed'.
                processing_status="pending",
                is_published=True,
                created_by=admin_user_id,
                updated_by=admin_user_id,
            )
            session.add(media_row)
            session.flush()
            media_created += 1

            # Generate the full derivative ladder through the SAME task a real
            # upload uses (the shared original is already in S3). Mirror the
            # route's failure handling so a queue/processing hiccup degrades to a
            # viewable original instead of aborting the seed.
            try:
                from app.tasks.media import process_upload_task
                process_upload_task.delay(
                    str(media_row.media_id), str(org_id), generate_webp=False
                )
            except Exception as e:
                logger.warning(
                    "media processing enqueue failed for %s: %s", media_row.media_id, e
                )
                media_row.processing_status = "completed"

            # CollectionObjectMedia has a composite PK (object_id, media_id)
            # and no organization_id column — tenancy lives on the linked
            # CollectionObject + Media rows.
            session.add(CollectionObjectMedia(
                object_id=obj.object_id,
                media_id=media_row.media_id,
                is_primary=True,
                sort_order=0,
                usage_type="main",
                created_by=admin_user_id,
            ))
            media_links_created += 1

    session.commit()

    result = {
        "source": source,
        "manifest_size": len(entries),
        "objects_added_this_run": objects_created,
        "objects_skipped_existing": skipped_existing,
        "titles_created": titles_created,
        "parts_created": parts_created,
        "media_created": media_created,
        "media_links_created": media_links_created,
    }

    # Loud failure when we add 0 on a fresh org. Mirrors the existing
    # met-seeder guard — prevents the silent "empty demo org" mode that
    # bit us when the per-object loop swallowed TypeErrors.
    if skipped_existing == 0 and objects_created == 0:
        raise RuntimeError(
            f"Manifest '{source}' produced 0 rows on a fresh org. "
            f"Likely an empty manifest or a model-shape regression. Saw: {result}"
        )

    logger.info("manifest seeder (%s): %s", source, result)
    return result
