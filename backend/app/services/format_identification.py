"""
Format identification service: MIME-to-PRONOM lookup.

Maps media assets to PRONOM format identifiers using the FormatRegistryEntry
table, enabling format risk assessment without file-level scanning.
"""

import logging
import os
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


@dataclass
class FormatIdentificationResult:
    pronom_puid: str | None
    format_name: str | None
    risk_level: str | None
    matched_by: str  # "mime_type" or "extension" or "none"


def identify_format_by_mime(
    mime_type: str | None,
    filename: str | None,
    session: Session,
) -> FormatIdentificationResult:
    """
    Look up PRONOM PUID from FormatRegistryEntry by matching mime_type,
    falling back to file extension.

    Returns the best-matching entry. Prefers exact MIME match; falls back
    to extension-based lookup.
    """
    from app.models.preservation import FormatRegistryEntry

    if not mime_type and not filename:
        return FormatIdentificationResult(None, None, None, "none")

    # Load all registry entries (small table, ~35 rows — safe to cache in memory)
    entries = session.query(FormatRegistryEntry).all()

    # Try MIME type match first
    if mime_type:
        for entry in entries:
            if entry.mime_types and mime_type in entry.mime_types:
                return FormatIdentificationResult(
                    pronom_puid=entry.pronom_puid,
                    format_name=entry.name,
                    risk_level=entry.risk_level,
                    matched_by="mime_type",
                )

    # Fallback: match by file extension
    if filename:
        ext = os.path.splitext(filename)[1].lower()
        if ext:
            for entry in entries:
                if entry.extensions and ext in entry.extensions:
                    return FormatIdentificationResult(
                        pronom_puid=entry.pronom_puid,
                        format_name=entry.name,
                        risk_level=entry.risk_level,
                        matched_by="extension",
                    )

    return FormatIdentificationResult(None, None, None, "none")


def backfill_media_formats(session: Session, batch_size: int = 500) -> dict[str, Any]:
    """
    Batch update Media records that have mime_type but no pronom_puid.

    Returns summary dict with counts.
    """
    from app.models import Media
    from app.tasks.preservation import record_preservation_event

    media_items = (
        session.query(Media)
        .filter(
            Media.mime_type.isnot(None),
            Media.pronom_puid.is_(None),
            Media.processing_status == "completed",
        )
        .limit(batch_size)
        .all()
    )

    identified = 0
    skipped = 0

    for media in media_items:
        result = identify_format_by_mime(media.mime_type, media.filename, session)
        if result.pronom_puid:
            media.pronom_puid = result.pronom_puid
            media.format_name = result.format_name
            media.format_risk_level = result.risk_level
            identified += 1

            record_preservation_event(
                session,
                organization_id=media.organization_id,
                event_type="format_identification",
                media_id=media.media_id,
                outcome="success",
                outcome_detail=f"Identified as {result.format_name} ({result.pronom_puid})",
                detail={
                    "pronom_puid": result.pronom_puid,
                    "format_name": result.format_name,
                    "risk_level": result.risk_level,
                    "matched_by": result.matched_by,
                    "mime_type": media.mime_type,
                    "filename": media.filename,
                },
            )
        else:
            skipped += 1

    return {
        "processed": len(media_items),
        "identified": identified,
        "skipped": skipped,
    }


def get_format_risk_summary(org_id: UUID, session: Session) -> list[dict[str, Any]]:
    """
    Returns count of media by format and risk level for an organization.
    """
    from app.models import Media

    rows = (
        session.query(
            Media.format_risk_level,
            Media.format_name,
            Media.pronom_puid,
            func.count(Media.media_id).label("count"),
        )
        .filter(
            Media.organization_id == org_id,
            Media.pronom_puid.isnot(None),
        )
        .group_by(
            Media.format_risk_level,
            Media.format_name,
            Media.pronom_puid,
        )
        .order_by(
            Media.format_risk_level,
            func.count(Media.media_id).desc(),
        )
        .all()
    )

    return [
        {
            "risk_level": row.format_risk_level or "unknown",
            "format_name": row.format_name,
            "pronom_puid": row.pronom_puid,
            "count": row.count,
        }
        for row in rows
    ]
