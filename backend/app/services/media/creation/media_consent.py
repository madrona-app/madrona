"""Shared create logic for a MediaConsent record (release for media of people).

Extracted from the ``create_media_consent`` router so the draft applier and the
API route share one implementation. The caller owns the transaction.
"""

from __future__ import annotations

from uuid import UUID

from app.models.media import MediaConsent

from ._support import as_date, as_uuid, utcnow


def create_media_consent(
    session,
    organization_id: UUID,
    payload: dict,
    actor,
    *,
    open_approval: bool = True,
    proposed_by=None,
) -> MediaConsent:
    """Create a live MediaConsent row for ``payload['media_id']``. consent_date
    defaults to today (mirrors the router). Caller owns the transaction."""
    p = payload
    consent = MediaConsent(
        media_id=as_uuid(p["media_id"]),
        organization_id=organization_id,
        subject_name=(p.get("subject_name") or "").strip(),
        subject_role=p.get("subject_role"),
        consent_type=p.get("consent_type", "model_release"),
        consent_scope=p.get("consent_scope", "internal"),
        consent_date=as_date(p.get("consent_date")) or utcnow().date(),
        expiry_date=as_date(p.get("expiry_date")),
        consent_document_key=p.get("consent_document_key"),
        is_valid=p.get("is_valid", True),
        notes=p.get("notes"),
        created_by=actor,
    )
    session.add(consent)
    session.flush()
    return consent
