"""
Helper for embedding a signed-document summary in procedure serializers.

Each procedure (Object Entry, Object Exit, Acquisition, etc.) can
have one or more SignedDocument rows attached. For compliance/validation
purposes, the procedure serializer needs to expose *which* signed document
types are present so the frontend predicate registry can check "does this
acquisition have a signed deed of gift?" without a separate round-trip.

This helper returns a list of distinct document_type strings present on a
given procedure, which the serializer embeds as `signed_document_types`.
"""
from __future__ import annotations

from uuid import UUID

from sqlalchemy.orm import Session

from app.models.signed_documents import SignedDocument


def get_signed_document_types(
    db: Session,
    procedure_type: str,
    procedure_id: UUID | str,
) -> list[str]:
    """
    Return the distinct list of signed-document document_type values present
    for a given procedure. Used by procedure serializers.
    """
    rows = (
        db.query(SignedDocument.document_type)
        .filter(
            SignedDocument.procedure_type == procedure_type,
            SignedDocument.procedure_id == (
                UUID(str(procedure_id)) if not isinstance(procedure_id, UUID) else procedure_id
            ),
        )
        .distinct()
        .all()
    )
    return [row[0] for row in rows]
