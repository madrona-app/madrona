"""
Personal conversation attachments (per-user RAG).

A regular Guide user drops a document into a conversation; it is chunked,
embedded, and stored as reference_chunks scoped to that conversation
(conversation_id set) so it RAGs into THAT chat only — never the org Corpus or
the public widget (see reference_tools._search_chunks for the isolation).

Gated by require_guide_app only (ANY Guide user) — deliberately NOT
require_guide_admin: building the shared Corpus is an admin task, but attaching
a doc to your own conversation is not. Ingest is synchronous (small ad-hoc
docs), reusing the corpus extract/chunk helpers; large-doc async is a future
optimization.
"""

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.guide import GuideContext, require_guide_app
from app.fastapi_app.routers.guide_documents import (
    ALLOWED_MIME_TYPES,
    MAX_FILE_SIZE_BYTES,
)
from app.models.agent import Conversation
from app.models.reference import ReferenceChunk
from app.services.embedding_service import get_embedding

logger = logging.getLogger(__name__)

router = APIRouter(tags=["guide"])

ATTACHMENT_SOURCE = "conversation_attachment"


def _require_own_conversation(conversation_id: UUID, guide_ctx: GuideContext, db: Session) -> Conversation:
    """The conversation must exist, belong to the caller's org, and — if owned by
    a user — be the caller's own. Prevents attaching to someone else's chat."""
    conv = db.get(Conversation, conversation_id)
    if not conv or conv.organization_id != guide_ctx.organization_id:
        raise HTTPException(
            status_code=404,
            detail={"code": "not_found", "message": "Conversation not found"},
        )
    if conv.user_id and guide_ctx.auth.user_id and conv.user_id != guide_ctx.auth.user_id:
        raise HTTPException(
            status_code=403,
            detail={"code": "forbidden", "message": "Not your conversation"},
        )
    return conv


@router.post(
    "/api/guide/conversations/{conversation_id}/attachments",
    status_code=201,
    summary="Attach a document to a conversation (personal RAG)",
)
async def upload_conversation_attachment(
    conversation_id: UUID,
    file: UploadFile = File(...),
    guide_ctx: GuideContext = Depends(require_guide_app),
    db: Session = Depends(get_db),
):
    _require_own_conversation(conversation_id, guide_ctx, db)

    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "invalid_file_type",
                "message": f"Unsupported file type: {file.content_type}. Accepted: PDF, DOCX, TXT, MD.",
            },
        )
    content = await file.read()
    if len(content) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail={"code": "file_too_large", "message": "File must be under 20 MB."},
        )

    # Reuse the corpus ingest helpers (imported lazily to avoid pulling the
    # Celery task graph into the request import path).
    from app.tasks.guide_documents import _chunk_text, _extract_text

    text = _extract_text(content, file.content_type)
    if not text.strip():
        raise HTTPException(
            status_code=400,
            detail={"code": "empty_document", "message": "No extractable text in the file."},
        )

    inserted = 0
    for ch in _chunk_text(text, file.filename):
        vec = get_embedding(ch["content"], task="search_document")
        if not vec:
            continue
        db.add(ReferenceChunk(
            source=ATTACHMENT_SOURCE,
            document=file.filename,
            section=ch.get("section"),
            content=ch["content"],
            organization_id=guide_ctx.organization_id,
            conversation_id=conversation_id,
            uploaded_by_user_id=guide_ctx.auth.user_id,
            visibility=None,  # personal — never public/visitor-searchable
            embedding_vec=vec,
        ))
        inserted += 1

    if inserted == 0:
        raise HTTPException(
            status_code=503,
            detail={"code": "embedding_unavailable", "message": "Could not process the document right now."},
        )
    db.commit()
    return {"filename": file.filename, "chunks": inserted}


@router.get(
    "/api/guide/conversations/{conversation_id}/attachments",
    summary="List a conversation's attachments",
)
def list_conversation_attachments(
    conversation_id: UUID,
    guide_ctx: GuideContext = Depends(require_guide_app),
    db: Session = Depends(get_db),
):
    _require_own_conversation(conversation_id, guide_ctx, db)
    rows = db.execute(
        select(ReferenceChunk.document, func.count().label("chunks"))
        .where(
            ReferenceChunk.conversation_id == conversation_id,
            ReferenceChunk.source == ATTACHMENT_SOURCE,
        )
        .group_by(ReferenceChunk.document)
        .order_by(ReferenceChunk.document)
    ).all()
    return {"attachments": [{"document": r.document, "chunks": r.chunks} for r in rows]}


@router.delete(
    "/api/guide/conversations/{conversation_id}/attachments/{document}",
    status_code=204,
    summary="Remove an attachment from a conversation",
)
def delete_conversation_attachment(
    conversation_id: UUID,
    document: str,
    guide_ctx: GuideContext = Depends(require_guide_app),
    db: Session = Depends(get_db),
):
    _require_own_conversation(conversation_id, guide_ctx, db)
    db.execute(
        delete(ReferenceChunk).where(
            ReferenceChunk.conversation_id == conversation_id,
            ReferenceChunk.source == ATTACHMENT_SOURCE,
            ReferenceChunk.document == document,
        )
    )
    db.commit()
