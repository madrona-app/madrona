"""
Celery task for processing Guide document uploads.

Downloads document from S3, extracts text, chunks by headings,
embeds via Ollama, and inserts into reference_chunks with the
organization's ID for tenant-scoped RAG retrieval.
"""

import io
import logging
import re

from sqlalchemy import select

from app.celery_app import celery_app
from app.config import get_settings
from app.services.embedding_service import get_embedding
from app.tasks.rls_helpers import admin_db_session

logger = logging.getLogger(__name__)

# Chunk target size in characters (aim for ~500 tokens)
CHUNK_TARGET_CHARS = 1500  # stays under the 512-token Nomic v2 MoE embedder limit
CHUNK_OVERLAP_CHARS = 200


def _extract_text_pdf(content: bytes) -> str:
    """Extract text from PDF bytes."""
    try:
        import pypdf
        reader = pypdf.PdfReader(io.BytesIO(content))
        return "\n\n".join(page.extract_text() or "" for page in reader.pages)
    except Exception as e:
        logger.warning("PDF extraction failed: %s", e)
        return ""


def _extract_text_docx(content: bytes) -> str:
    """Extract text from DOCX bytes."""
    try:
        import docx
        doc = docx.Document(io.BytesIO(content))
        return "\n\n".join(p.text for p in doc.paragraphs if p.text.strip())
    except Exception as e:
        logger.warning("DOCX extraction failed: %s", e)
        return ""


def _extract_text(content: bytes, mime_type: str) -> str:
    """Extract text from document based on MIME type."""
    if mime_type == "application/pdf":
        return _extract_text_pdf(content)
    elif mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
        return _extract_text_docx(content)
    else:
        # text/plain, text/markdown
        return content.decode("utf-8", errors="replace")


def _chunk_text(text: str, filename: str) -> list[dict]:
    """
    Split text into chunks by headings or paragraph boundaries.

    Returns list of {section, content} dicts.
    """
    # Try to split by markdown headings or line-separated sections
    heading_pattern = re.compile(r'^(#{1,4})\s+(.+)$', re.MULTILINE)
    headings = list(heading_pattern.finditer(text))

    chunks = []

    if headings:
        # Split by headings
        for i, match in enumerate(headings):
            section_title = match.group(2).strip()
            start = match.end()
            end = headings[i + 1].start() if i + 1 < len(headings) else len(text)
            section_text = text[start:end].strip()

            if not section_text:
                continue

            # Further split large sections
            for sub_chunk in _split_large_chunk(section_text):
                chunks.append({"section": section_title, "content": sub_chunk})
    else:
        # No headings — split by paragraphs with target size
        paragraphs = re.split(r'\n\s*\n', text)
        current_chunk = ""
        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            if len(current_chunk) + len(para) > CHUNK_TARGET_CHARS and current_chunk:
                chunks.append({"section": None, "content": current_chunk.strip()})
                # Keep overlap
                current_chunk = current_chunk[-CHUNK_OVERLAP_CHARS:] + "\n\n" + para
            else:
                current_chunk += "\n\n" + para if current_chunk else para

        if current_chunk.strip():
            chunks.append({"section": None, "content": current_chunk.strip()})

    return chunks


def _split_large_chunk(text: str) -> list[str]:
    """Split a chunk that exceeds target size."""
    if len(text) <= CHUNK_TARGET_CHARS:
        return [text]

    result = []
    paragraphs = re.split(r'\n\s*\n', text)
    current = ""

    for para in paragraphs:
        if len(current) + len(para) > CHUNK_TARGET_CHARS and current:
            result.append(current.strip())
            current = current[-CHUNK_OVERLAP_CHARS:] + "\n\n" + para
        else:
            current += "\n\n" + para if current else para

    if current.strip():
        result.append(current.strip())

    return result


def _embed_text(text: str) -> list[float] | None:
    """Embed document text via the configured provider. Returns None on failure."""
    return get_embedding(text, task="search_document")


@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def process_guide_document(self, document_id: str):
    """
    Process an uploaded Guide document:
    1. Download from S3
    2. Extract text
    3. Chunk by headings
    4. Embed each chunk via Ollama
    5. Insert into reference_chunks with organization_id
    """
    from app.models.guide_document import GuideDocument
    from app.models.reference import ReferenceChunk

    settings = get_settings()

    # Cross-org system task: run as the BYPASSRLS owner role. A normal RLS
    # session has no org context here (the task only receives a document_id),
    # so the policy would hide the row and every reference_chunks insert. The
    # task self-scopes by stamping organization_id on each row it writes.
    with admin_db_session() as db:
        doc = db.execute(
            select(GuideDocument).where(GuideDocument.document_id == document_id)
        ).scalar_one_or_none()

        if not doc:
            logger.error("Guide document %s not found", document_id)
            return

        if doc.status not in ("uploaded", "error"):
            logger.info("Document %s already processed (status=%s)", document_id, doc.status)
            return

        doc.status = "processing"
        db.commit()

        try:
            # 1. Download from S3
            from app.services.storage import get_storage_backend
            storage = get_storage_backend(doc.organization_id, db)
            # Sync task: use the *_sync variant (the async get_object would
            # return an un-awaited coroutine here). It yields (bytes, metadata).
            content, _ = storage.get_object_sync(doc.file_key)

            # 2. Extract text
            text = _extract_text(content, doc.mime_type)
            if not text or len(text.strip()) < 50:
                doc.status = "error"
                doc.error_message = "Could not extract meaningful text from document."
                db.commit()
                return

            # 3. Chunk
            chunks = _chunk_text(text, doc.filename)
            if not chunks:
                doc.status = "error"
                doc.error_message = "Document produced no text chunks."
                db.commit()
                return

            # 4. Embed and insert
            source_label = f"guide:{doc.filename}"
            inserted = 0

            for chunk in chunks:
                embedding = _embed_text(chunk["content"])

                ref_chunk = ReferenceChunk(
                    organization_id=doc.organization_id,
                    source=source_label,
                    document=doc.filename,
                    section=chunk["section"],
                    content=chunk["content"],
                    visibility=doc.visibility,
                    embedding=embedding,
                    embedding_vec=embedding,
                )
                db.add(ref_chunk)
                inserted += 1

            doc.status = "ready"
            doc.chunk_count = inserted
            doc.error_message = None
            db.commit()

            logger.info(
                "Guide document processed: doc=%s chunks=%d org=%s",
                document_id, inserted, doc.organization_id,
            )

        except Exception as e:
            db.rollback()
            logger.error("Guide document processing failed: %s", e, exc_info=True)

            # Re-fetch after rollback
            doc = db.execute(
                select(GuideDocument).where(GuideDocument.document_id == document_id)
            ).scalar_one_or_none()
            if doc:
                doc.status = "error"
                doc.error_message = str(e)[:500]
                db.commit()

            raise self.retry(exc=e)
