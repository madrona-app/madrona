"""
Signed Documents router — polymorphic signed-document attachments for
procedures (Object Entry, Object Exit, Acquisition, Loans In/Out,
Deaccession, Movement).

Endpoints:
- GET    /api/organizations/{org}/signed-documents?procedure_type=X&procedure_id=Y
- POST   /api/organizations/{org}/signed-documents     (multipart upload + metadata)
- PATCH  /api/organizations/{org}/signed-documents/{id}
- DELETE /api/organizations/{org}/signed-documents/{id}

E-signature integration endpoints (Phase 2, stubbed):
- POST /api/organizations/{org}/signed-documents/{id}/send-for-signature
- POST /api/webhooks/signed-documents/{provider}
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models.locations import Movement
from app.models.media import Media
from app.models.procedures import (
    Acquisition,
    Deaccession,
    LoanIn,
    LoanOut,
    ObjectEntry,
    ObjectExit,
)
from app.models.signed_documents import PROCEDURE_TYPES, SignedDocument
from app.permissions import Permission
from app.services.uploads import (
    StorageLimitExceeded,
    detect_media_type,
    get_org_media_url,
    upload_org_media,
)
from app.services.api_security import sanitize_error_message


router = APIRouter(tags=["collections-signed-documents"])


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


# Map procedure_type → (Model, PK attribute name). Used to validate that the
# referenced procedure exists and belongs to the organization before we attach
# a signed document to it.
_PROCEDURE_LOOKUP: dict[str, tuple[type, str]] = {
    "object_entry": (ObjectEntry, "entry_id"),
    "object_exit": (ObjectExit, "exit_id"),
    "acquisition": (Acquisition, "acquisition_id"),
    "loan_in": (LoanIn, "loan_in_id"),
    "loan_out": (LoanOut, "loan_out_id"),
    "deaccession": (Deaccession, "deaccession_id"),
    "movement": (Movement, "movement_id"),
}


def _validate_procedure(
    db: Session,
    organization_id: UUID,
    procedure_type: str,
    procedure_id: UUID,
) -> None:
    """Raise 404 if the referenced procedure doesn't exist for this org."""
    if procedure_type not in PROCEDURE_TYPES:
        raise HTTPException(status_code=400, detail={
            "code": "bad_request",
            "message": f"Unknown procedure_type: {procedure_type}",
        })

    model, pk_attr = _PROCEDURE_LOOKUP[procedure_type]
    pk_col = getattr(model, pk_attr)
    exists = (
        db.query(model)
        .filter(pk_col == procedure_id, model.organization_id == organization_id)
        .first()
    )
    if not exists:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": f"{procedure_type} not found",
        })


def _serialize_signed_document(doc: SignedDocument, db: Session) -> dict[str, Any]:
    """Serialize a SignedDocument row, resolving the media URL if present."""
    media_url: str | None = None
    media_filename: str | None = None
    media_mime_type: str | None = None
    if doc.media_id and doc.media:
        media_filename = doc.media.filename
        media_mime_type = doc.media.mime_type
        if doc.media.s3_key:
            media_url = get_org_media_url(
                doc.media.s3_key,
                organization_id=str(doc.organization_id),
            )

    return {
        "signed_document_id": str(doc.signed_document_id),
        "organization_id": str(doc.organization_id),
        "procedure_type": doc.procedure_type,
        "procedure_id": str(doc.procedure_id),
        "document_type": doc.document_type,
        "label": doc.label,
        "media_id": str(doc.media_id) if doc.media_id else None,
        "media_filename": media_filename,
        "media_mime_type": media_mime_type,
        "media_url": media_url,
        "reference": doc.reference,
        "esign_provider": doc.esign_provider,
        "esign_envelope_id": doc.esign_envelope_id,
        "esign_status": doc.esign_status,
        "esign_recipients": doc.esign_recipients,
        "esign_sent_at": doc.esign_sent_at.isoformat() if doc.esign_sent_at else None,
        "esign_completed_at": (
            doc.esign_completed_at.isoformat() if doc.esign_completed_at else None
        ),
        "created_at": doc.created_at.isoformat() if doc.created_at else None,
        "created_by": str(doc.created_by) if doc.created_by else None,
        "updated_at": doc.updated_at.isoformat() if doc.updated_at else None,
        "version": doc.version,
    }


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/api/organizations/{organization_id}/signed-documents",
    response_model=dict,
    summary="List signed documents for a procedure",
)
def list_signed_documents(
    organization_id: UUID,
    procedure_type: str = Query(...),
    procedure_id: UUID = Query(...),
    document_type: str | None = Query(None),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_VIEW)),
    db: Session = Depends(get_db),
):
    """List signed documents attached to a specific procedure record."""
    _validate_procedure(db, organization_id, procedure_type, procedure_id)

    query = (
        db.query(SignedDocument)
        .filter(
            SignedDocument.organization_id == organization_id,
            SignedDocument.procedure_type == procedure_type,
            SignedDocument.procedure_id == procedure_id,
        )
        .order_by(SignedDocument.created_at.desc())
    )
    if document_type:
        query = query.filter(SignedDocument.document_type == document_type)

    docs = query.all()
    return {
        "signed_documents": [_serialize_signed_document(d, db) for d in docs],
        "count": len(docs),
    }


@router.post(
    "/api/organizations/{organization_id}/signed-documents",
    status_code=201,
    response_model=dict,
    summary="Attach a signed document to a procedure",
)
def create_signed_document(
    organization_id: UUID,
    procedure_type: str = Form(...),
    procedure_id: UUID = Form(...),
    document_type: str = Form(...),
    label: str | None = Form(None),
    reference: str | None = Form(None),
    file: UploadFile | None = File(None),
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Attach a signed document to a procedure. Supports:

    1. Uploading a scan (multipart file) — the most common path.
    2. Creating a text-only reference row (no file) for paper workflows
       where the signed document lives in a physical file.

    At least one of ``file`` or ``reference`` must be provided.
    """
    _validate_procedure(db, organization_id, procedure_type, procedure_id)

    if not file and not (reference and reference.strip()):
        raise HTTPException(status_code=422, detail={
            "code": "validation_error",
            "message": "Either a file upload or a text reference is required.",
        })

    media = None
    if file and file.filename:
        content_type = file.content_type or "application/octet-stream"
        media_type = detect_media_type(content_type)
        if not media_type:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": f"Unsupported file type: {content_type}",
            })

        try:
            s3_key, file_size = upload_org_media(
                organization_id=str(organization_id),
                file_data=file.file,
                content_type=content_type,
                media_type=media_type,
                filename=file.filename,
                db_session=db,
            )
        except StorageLimitExceeded as e:
            raise HTTPException(status_code=413, detail={
                "code": "STORAGE_LIMIT_EXCEEDED",
                "message": sanitize_error_message(e),
                "details": {
                    "used_bytes": e.used_bytes,
                    "limit_bytes": e.limit_bytes,
                    "file_size": e.file_size,
                },
            })
        except ValueError as e:
            raise HTTPException(status_code=400, detail={
                "code": "bad_request",
                "message": sanitize_error_message(e),
            })

        media = Media(
            organization_id=organization_id,
            s3_key=s3_key,
            filename=file.filename,
            file_size=file_size,
            mime_type=content_type,
            media_type=media_type.value,
            title=file.filename,
            processing_status="completed",
            created_by=auth.user_id,
        )
        db.add(media)
        db.flush()

    doc = SignedDocument(
        organization_id=organization_id,
        procedure_type=procedure_type,
        procedure_id=procedure_id,
        document_type=document_type,
        label=label,
        media_id=media.media_id if media else None,
        reference=reference.strip() if reference else None,
        created_by=auth.user_id,
        updated_by=auth.user_id,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    return _serialize_signed_document(doc, db)


@router.patch(
    "/api/organizations/{organization_id}/signed-documents/{signed_document_id}",
    response_model=dict,
    summary="Update a signed document's metadata",
)
def update_signed_document(
    organization_id: UUID,
    signed_document_id: UUID,
    data: dict,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Update label, reference, or document_type on an existing row."""
    doc = (
        db.query(SignedDocument)
        .filter(
            SignedDocument.signed_document_id == signed_document_id,
            SignedDocument.organization_id == organization_id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Signed document not found",
        })

    for field in ("label", "reference", "document_type"):
        if field in data:
            setattr(doc, field, data[field])

    doc.updated_by = auth.user_id
    doc.updated_at = datetime.now(timezone.utc)
    doc.version = (doc.version or 1) + 1
    db.commit()
    db.refresh(doc)

    return _serialize_signed_document(doc, db)


@router.delete(
    "/api/organizations/{organization_id}/signed-documents/{signed_document_id}",
    response_model=dict,
    summary="Remove a signed document attachment",
)
def delete_signed_document(
    organization_id: UUID,
    signed_document_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.COLLECTIONS_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete the signed document row. The underlying media is preserved."""
    doc = (
        db.query(SignedDocument)
        .filter(
            SignedDocument.signed_document_id == signed_document_id,
            SignedDocument.organization_id == organization_id,
        )
        .first()
    )
    if not doc:
        raise HTTPException(status_code=404, detail={
            "code": "not_found",
            "message": "Signed document not found",
        })

    db.delete(doc)
    db.commit()
    return {"success": True}
