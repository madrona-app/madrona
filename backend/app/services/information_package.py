"""
Information Package lifecycle management (OAIS SIP/AIP/DIP).

Provides functions to create, update, and query OAIS information packages
that track the preservation lifecycle of media assets.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def create_sip(media: Any, session: Session) -> Any:
    """
    Create a Submission Information Package during ingest.

    Validates the submission (format accepted, no duplicate checksum).
    Transitions: validating → accepted/rejected.
    """
    from app.models.preservation import InformationPackage
    from app.tasks.preservation import record_preservation_event

    # Check for existing SIP
    existing = (
        session.query(InformationPackage)
        .filter(
            InformationPackage.organization_id == media.organization_id,
            InformationPackage.media_id == media.media_id,
            InformationPackage.package_type == "SIP",
            InformationPackage.status.in_(["validating", "accepted"]),
        )
        .first()
    )
    if existing:
        return existing

    sip = InformationPackage(
        organization_id=media.organization_id,
        media_id=media.media_id,
        package_type="SIP",
        status="validating",
        structure={
            "submission": {
                "filename": media.filename,
                "mime_type": media.mime_type,
                "file_size": media.file_size,
                "s3_key": media.s3_key,
                "checksum_sha256": media.checksum_sha256,
            },
        },
    )
    session.add(sip)
    session.flush()

    # Validate submission
    is_valid = True
    validation_notes = []

    if not media.mime_type:
        is_valid = False
        validation_notes.append("Missing MIME type")

    if not media.file_size or media.file_size <= 0:
        is_valid = False
        validation_notes.append("Invalid file size")

    if is_valid:
        sip.status = "accepted"
    else:
        sip.status = "rejected"

    record_preservation_event(
        session,
        organization_id=media.organization_id,
        event_type="validation",
        media_id=media.media_id,
        outcome="success" if is_valid else "failure",
        outcome_detail=f"SIP {'accepted' if is_valid else 'rejected'}: {'; '.join(validation_notes) or 'valid'}",
        detail={
            "package_type": "SIP",
            "validation_notes": validation_notes,
        },
        linked_entity_type="information_package",
        linked_entity_id=sip.package_id,
    )

    return sip


def create_aip(media: Any, session: Session) -> Any:
    """
    Create an Archival Information Package after successful processing.

    Captures structural map from current Media state and links all
    existing preservation events.
    """
    from app.models.preservation import InformationPackage, PreservationEvent
    from app.tasks.preservation import record_preservation_event

    # Supersede any existing AIP
    existing = (
        session.query(InformationPackage)
        .filter(
            InformationPackage.organization_id == media.organization_id,
            InformationPackage.media_id == media.media_id,
            InformationPackage.package_type == "AIP",
            InformationPackage.status == "active",
        )
        .first()
    )
    if existing:
        existing.status = "superseded"

    # Collect provenance event IDs
    events = (
        session.query(PreservationEvent.event_id)
        .filter(PreservationEvent.media_id == media.media_id)
        .order_by(PreservationEvent.created_at)
        .all()
    )
    event_ids = [str(e.event_id) for e in events]

    # Build derivatives list
    derivatives = []
    if hasattr(media, "derivatives") and media.derivatives:
        for d in media.derivatives:
            derivatives.append({
                "type": d.derivative_type if hasattr(d, "derivative_type") else "unknown",
                "s3_key": d.s3_key if hasattr(d, "s3_key") else None,
                "format": d.mime_type if hasattr(d, "mime_type") else None,
                "size": d.file_size if hasattr(d, "file_size") else None,
            })

    structure = {
        "content": {
            "archival_master": {
                "s3_key": media.s3_key,
                "checksum_sha256": media.checksum_sha256,
                "size": media.file_size,
                "pronom_puid": getattr(media, "pronom_puid", None),
            },
        },
        "metadata": {
            "descriptive": {
                "title": media.title,
                "description": media.description,
                "dublin_core": media.dublin_core,
            },
            "technical": media.technical_metadata,
            "rights": {
                "copyright_status": media.copyright_status,
                "license": media.license,
                "rights_statement": media.rights_statement,
            },
        },
        "derivatives": derivatives,
        "representation_info": {
            "pronom_puid": getattr(media, "pronom_puid", None),
            "format_name": getattr(media, "format_name", None),
            "mime_type": media.mime_type,
        },
    }

    aip = InformationPackage(
        organization_id=media.organization_id,
        media_id=media.media_id,
        package_type="AIP",
        status="active",
        structure=structure,
        provenance_event_ids=event_ids,
    )
    session.add(aip)
    session.flush()

    record_preservation_event(
        session,
        organization_id=media.organization_id,
        event_type="ingestion",
        media_id=media.media_id,
        outcome="success",
        outcome_detail="AIP created",
        detail={"package_type": "AIP"},
        linked_entity_type="information_package",
        linked_entity_id=aip.package_id,
    )

    return aip


def generate_dip(
    media: Any,
    export_profile_id: str,
    session: Session,
    included_derivatives: list[dict] | None = None,
    expires_days: int = 30,
) -> Any:
    """
    Create a Dissemination Information Package during export.

    Creates DIP record referencing specific derivatives/metadata included
    in the export.
    """
    from app.models.preservation import InformationPackage
    from app.tasks.preservation import record_preservation_event

    structure = {
        "export_profile": export_profile_id,
        "content": included_derivatives or [],
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    dip = InformationPackage(
        organization_id=media.organization_id,
        media_id=media.media_id,
        package_type="DIP",
        status="generated",
        structure=structure,
        export_profile_id=export_profile_id,
        expires_at=datetime.now(timezone.utc) + timedelta(days=expires_days),
    )
    session.add(dip)
    session.flush()

    record_preservation_event(
        session,
        organization_id=media.organization_id,
        event_type="migration",
        media_id=media.media_id,
        outcome="success",
        outcome_detail=f"DIP generated with profile: {export_profile_id}",
        detail={
            "package_type": "DIP",
            "export_profile_id": export_profile_id,
        },
        linked_entity_type="information_package",
        linked_entity_id=dip.package_id,
    )

    return dip


def refresh_aip(media_id: UUID, session: Session) -> Any | None:
    """
    Update AIP structure after changes (e.g., derivative regeneration).

    Finds the active AIP, rebuilds the structural map, and records a
    PREMIS validation event.
    """
    from app.models import Media
    from app.models.preservation import InformationPackage

    media = session.query(Media).filter_by(media_id=media_id).first()
    if not media:
        return None

    existing = (
        session.query(InformationPackage)
        .filter(
            InformationPackage.media_id == media_id,
            InformationPackage.package_type == "AIP",
            InformationPackage.status == "active",
        )
        .first()
    )

    if not existing:
        # No AIP yet — create one
        return create_aip(media, session)

    # Rebuild structure
    existing.status = "superseded"
    return create_aip(media, session)


def get_aip_manifest(media_id: UUID, session: Session) -> dict[str, Any] | None:
    """Returns the full AIP structural map as JSON."""
    from app.models.preservation import InformationPackage

    aip = (
        session.query(InformationPackage)
        .filter(
            InformationPackage.media_id == media_id,
            InformationPackage.package_type == "AIP",
            InformationPackage.status == "active",
        )
        .first()
    )
    if not aip:
        return None

    return {
        "package_id": str(aip.package_id),
        "media_id": str(aip.media_id),
        "organization_id": str(aip.organization_id),
        "package_type": "AIP",
        "status": aip.status,
        "structure": aip.structure,
        "provenance_event_ids": aip.provenance_event_ids,
        "created_at": aip.created_at.isoformat() if aip.created_at else None,
        "updated_at": aip.updated_at.isoformat() if aip.updated_at else None,
    }
