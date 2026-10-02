"""
Guide document management endpoints.

Museums upload their own documents (PDF, DOCX, TXT, MD) to enrich their
Guide assistant's knowledge base. Documents are chunked, embedded, and stored
in reference_chunks with the organization's ID for tenant-scoped RAG.

Each document has a visibility setting:
- "internal" (default) — only searchable by staff
- "public" — also searchable by visitors via the embedded widget

Documents default to internal so nothing leaks to visitors unless the
museum admin explicitly marks it as public.
"""

import logging
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.guide import GuideContext, require_guide_admin
from app.services.guide_usage import documents_used
from app.models.guide_document import GuideDocument
from app.models.reference import ReferenceChunk

logger = logging.getLogger(__name__)

router = APIRouter(tags=["guide"])

# Allowed MIME types for document upload
ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",  # .docx
    "text/plain",
    "text/markdown",
}

VALID_VISIBILITIES = {"public", "internal"}

MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024  # 20 MB


@router.get("/api/guide/documents", summary="List documents")
def list_documents(
    guide_ctx: GuideContext = Depends(require_guide_admin),
    db: Session = Depends(get_db),
):
    """List all documents uploaded by this organization."""
    docs = (
        db.execute(
            select(GuideDocument)
            .where(GuideDocument.organization_id == guide_ctx.organization_id)
            .order_by(GuideDocument.created_at.desc())
        )
        .scalars()
        .all()
    )

    return {
        "documents": [
            {
                "document_id": str(d.document_id),
                "filename": d.filename,
                "file_size_bytes": d.file_size_bytes,
                "mime_type": d.mime_type,
                "status": d.status,
                "visibility": d.visibility,
                "chunk_count": d.chunk_count,
                "error_message": d.error_message,
                "created_at": d.created_at.isoformat(),
            }
            for d in docs
        ]
    }


@router.post("/api/guide/documents/upload", status_code=201, summary="Upload document")
async def upload_document(
    file: UploadFile = File(...),
    visibility: str = Form(default="internal"),
    guide_ctx: GuideContext = Depends(require_guide_admin),
    db: Session = Depends(get_db),
):
    """
    Upload a document for RAG processing.

    Accepts PDF, DOCX, TXT, and MD files up to 20 MB.

    visibility controls who can search this document's content:
    - "internal" (default) — staff only
    - "public" — staff and visitors

    Documents default to internal. The admin must explicitly set
    visibility to "public" to make content available to visitors.
    """
    if visibility not in VALID_VISIBILITIES:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_visibility", "message": "visibility must be 'public' or 'internal'"},
        )

    # Validate MIME type
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_file_type",
                "message": f"Unsupported file type: {file.content_type}. Accepted: PDF, DOCX, TXT, MD.",
            },
        )

    # Read file content and validate size
    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail={"code": "file_too_large", "message": "File must be under 20 MB."},
        )

    # Metered by document count, not storage; the per-file size cap above is a
    # separate guard.
    from app.services.guide_limits import resolve_max_documents

    config = guide_ctx.config or {}
    max_documents = resolve_max_documents(config)

    if documents_used(guide_ctx.organization_id, db) >= max_documents:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "document_limit_reached",
                "message": f"Document limit reached ({max_documents}).",
            },
        )

    # Store in S3.
    #
    # The key carries a uuid because it used to be derived from the filename
    # alone: two uploads of "policy.pdf" produced two rows sharing one object,
    # the second silently overwriting the first's bytes. That was survivable
    # only while deletes were broken and never removed anything. Now that a
    # delete really deletes, a shared key would mean removing one document
    # destroyed a different one's file, so the key has to identify the row.
    org_id = guide_ctx.organization_id
    file_key = f"guide/{org_id}/documents/{uuid4()}/{file.filename}"

    try:
        from app.services.storage import get_storage_backend
        storage = get_storage_backend(org_id, db)
        await storage.put_object(file_key, content, content_type=file.content_type)
    except Exception as e:
        logger.error("S3 upload failed for guide document: %s", e)
        raise HTTPException(
            status_code=500,
            detail={"code": "upload_failed", "message": "Failed to upload document. Please try again."},
        )

    # Create DB record
    doc = GuideDocument(
        organization_id=org_id,
        filename=file.filename or "untitled",
        file_key=file_key,
        file_size_bytes=len(content),
        mime_type=file.content_type,
        status="uploaded",
        visibility=visibility,
        uploaded_by=guide_ctx.auth.user_id,
    )
    db.add(doc)
    # Flush (not commit) so the INSERT runs inside the request's RLS-scoped
    # transaction and the server-generated PK is populated. The org RLS context
    # is SET LOCAL, so it's cleared when commit ends the transaction — any
    # post-commit refresh()/lazy-load then runs with no org context, the policy
    # hides the just-written row, and it raises InvalidRequestError. So capture
    # everything we return while the instance is still live. See 58549a39.
    db.flush()
    result = {
        "document_id": str(doc.document_id),
        "filename": doc.filename,
        "status": doc.status,
        "visibility": doc.visibility,
        "message": "Document uploaded. Processing will begin shortly.",
    }
    db.commit()

    # Dispatch Celery task for async processing
    try:
        from app.tasks.guide_documents import process_guide_document
        process_guide_document.delay(result["document_id"])
    except Exception as e:
        logger.warning("Failed to dispatch guide document processing task: %s", e)

    return result


class UpdateVisibilityRequest(BaseModel):
    visibility: str


@router.patch("/api/guide/documents/{document_id}", summary="Update document")
def update_document(
    document_id: UUID,
    body: UpdateVisibilityRequest,
    guide_ctx: GuideContext = Depends(require_guide_admin),
    db: Session = Depends(get_db),
):
    """
    Update a document's visibility.

    When visibility changes, the associated reference_chunks are updated
    to match so the RAG filter takes effect immediately.
    """
    if body.visibility not in VALID_VISIBILITIES:
        raise HTTPException(
            status_code=400,
            detail={"code": "invalid_visibility", "message": "visibility must be 'public' or 'internal'"},
        )

    doc = db.execute(
        select(GuideDocument).where(
            GuideDocument.document_id == document_id,
            GuideDocument.organization_id == guide_ctx.organization_id,
        )
    ).scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Document not found"})

    old_visibility = doc.visibility
    doc.visibility = body.visibility

    # Propagate to reference_chunks so the filter takes effect immediately
    if old_visibility != body.visibility:
        db.execute(
            update(ReferenceChunk)
            .where(
                ReferenceChunk.organization_id == guide_ctx.organization_id,
                ReferenceChunk.source == f"guide:{doc.filename}",
            )
            .values(visibility=body.visibility)
        )

    db.commit()

    return {
        "document_id": str(document_id),
        "visibility": doc.visibility,
    }


@router.delete("/api/guide/documents/{document_id}", summary="Delete document")
def delete_document(
    document_id: UUID,
    guide_ctx: GuideContext = Depends(require_guide_admin),
    db: Session = Depends(get_db),
):
    """Delete a document and its associated reference chunks."""
    doc = db.execute(
        select(GuideDocument).where(
            GuideDocument.document_id == document_id,
            GuideDocument.organization_id == guide_ctx.organization_id,
        )
    ).scalar_one_or_none()

    if not doc:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Document not found"})

    # Delete associated reference chunks
    db.execute(
        delete(ReferenceChunk).where(
            ReferenceChunk.organization_id == guide_ctx.organization_id,
            ReferenceChunk.source == f"guide:{doc.filename}",
        )
    )

    # Delete the stored object BEFORE the row that records its key.
    #
    # This called the async `delete_object` from a sync handler, so it built a
    # coroutine that was never awaited: no request was ever made to storage,
    # the try/except had nothing to catch, and the commit below then destroyed
    # the only record of file_key. Every guide document ever "deleted" is
    # still in the bucket, unreferenced and unfindable.
    #
    # If the delete genuinely fails we keep the row, so the object stays
    # reachable and can be retried, rather than being silently orphaned.
    from app.services.storage import get_storage_backend

    storage = get_storage_backend(guide_ctx.organization_id, db)
    try:
        storage.delete_object_sync(doc.file_key)
    except Exception as e:
        logger.exception("Failed to delete stored object %s", doc.file_key)
        raise HTTPException(status_code=502, detail={
            "code": "storage_error",
            "message": "Could not delete the stored file; the document was kept.",
        }) from e

    db.delete(doc)
    db.commit()

    return {"deleted": True, "document_id": str(document_id)}
