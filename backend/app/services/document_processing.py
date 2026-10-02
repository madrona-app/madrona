"""
Document processing service for thumbnail generation and metadata extraction.

Handles PDF and other document types (Word, Excel) for:
- Generating preview thumbnails from first page
- Extracting document metadata (page count, author, title, etc.)
- Computing checksums for integrity verification

Uses pypdfium2 (PDFium) for PDF processing.
"""
import hashlib
import io
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import Any, BinaryIO

from PIL import Image

from app.services.uploads import (
    get_media_bucket,
    get_s3_client,
    get_org_storage_region,
    DEFAULT_REGION,
)
from app.services.storage import get_storage_backend

logger = logging.getLogger(__name__)

# pypdfium2 wraps Google's PDFium (BSD-3-Clause) and is itself
# Apache-2.0/BSD-3-Clause. It replaces PyMuPDF, which is AGPL-3.0 unless you
# hold an Artifex commercial license — untenable for a network-served app we
# ship under a permissive license, since AGPL §13 would extend to every
# operator of the combined work.
try:
    import pypdfium2 as pdfium
    PDF_AVAILABLE = True
except ImportError:
    PDF_AVAILABLE = False
    logger.warning("pypdfium2 not available - PDF thumbnail generation disabled")


# Derivative sizes for documents
DOCUMENT_DERIVATIVE_SIZES = {
    'thumbnail': 200,      # For lists/navigation
    'preview': 600,        # For document preview cards
    'large_preview': 1200, # For lightbox/detail view
}

# Quality settings
JPEG_QUALITY = 85
PNG_DPI = 150  # DPI for PDF rendering


@dataclass
class DocumentDerivativeResult:
    """Result of generating a document derivative."""
    derivative_type: str
    format: str
    s3_key: str
    width: int
    height: int
    file_size: int


@dataclass
class DocumentMetadata:
    """Extracted document metadata."""
    page_count: int
    title: str | None = None
    author: str | None = None
    subject: str | None = None
    creator: str | None = None  # Application that created the document
    producer: str | None = None  # PDF producer
    creation_date: datetime | None = None
    modification_date: datetime | None = None
    keywords: list[str] | None = None
    encrypted: bool = False
    file_format: str | None = None


def extract_pdf_metadata(pdf_data: bytes) -> DocumentMetadata | None:
    """
    Extract metadata from a PDF file.

    Args:
        pdf_data: Raw PDF bytes

    Returns:
        DocumentMetadata object or None if extraction fails
    """
    if not PDF_AVAILABLE:
        logger.warning("pypdfium2 not available for metadata extraction")
        return None

    doc = None
    try:
        doc = pdfium.PdfDocument(pdf_data)

        # PDFium reports the standard Info-dictionary keys capitalised.
        metadata = doc.get_metadata_dict() or {}

        # Parse dates from PDF format
        creation_date = None
        mod_date = None

        if metadata.get('CreationDate'):
            creation_date = _parse_pdf_date(metadata['CreationDate'])
        if metadata.get('ModDate'):
            mod_date = _parse_pdf_date(metadata['ModDate'])

        # Parse keywords
        keywords = None
        if metadata.get('Keywords'):
            keywords = [k.strip() for k in metadata['Keywords'].split(',') if k.strip()]

        result = DocumentMetadata(
            page_count=len(doc),
            title=metadata.get('Title') or None,
            author=metadata.get('Author') or None,
            subject=metadata.get('Subject') or None,
            creator=metadata.get('Creator') or None,
            producer=metadata.get('Producer') or None,
            creation_date=creation_date,
            modification_date=mod_date,
            keywords=keywords,
            encrypted=_is_encrypted(doc),
            file_format='PDF',
        )

        return result

    except Exception as e:
        logger.error(f"Failed to extract PDF metadata: {e}")
        return None
    finally:
        if doc is not None:
            doc.close()



def _is_encrypted(doc) -> bool:
    """Whether the PDF declares a security handler.

    PDFium reports this only through the raw C API: a revision of -1 means no
    security handler. PyMuPDF exposed it as `doc.is_encrypted`, which has no
    pypdfium2 equivalent on the helper object.
    """
    try:
        import pypdfium2.raw as _raw
        return _raw.FPDF_GetSecurityHandlerRevision(doc) != -1
    except Exception:
        return False


def _parse_pdf_date(date_str: str) -> datetime | None:
    """Parse PDF date format (D:YYYYMMDDHHmmSS) to datetime."""
    if not date_str:
        return None

    try:
        # Remove 'D:' prefix if present
        if date_str.startswith('D:'):
            date_str = date_str[2:]

        # Handle timezone suffix (e.g., +00'00')
        if '+' in date_str or '-' in date_str[1:]:
            # Remove timezone for simple parsing
            for sep in ['+', '-']:
                if sep in date_str[1:]:
                    date_str = date_str[:date_str.index(sep, 1)]
                    break

        # Parse based on length
        if len(date_str) >= 14:
            return datetime.strptime(date_str[:14], '%Y%m%d%H%M%S')
        elif len(date_str) >= 8:
            return datetime.strptime(date_str[:8], '%Y%m%d')

    except Exception as e:
        logger.debug(f"Failed to parse PDF date '{date_str}': {e}")

    return None


def render_pdf_page(
    pdf_data: bytes,
    page_number: int = 0,
    dpi: int = PNG_DPI,
) -> Image.Image | None:
    """
    Render a PDF page to a PIL Image.

    Args:
        pdf_data: Raw PDF bytes
        page_number: Page to render (0-indexed)
        dpi: Resolution for rendering

    Returns:
        PIL Image or None if rendering fails
    """
    if not PDF_AVAILABLE:
        logger.warning("pypdfium2 not available for PDF rendering")
        return None

    doc = None
    try:
        doc = pdfium.PdfDocument(pdf_data)

        if page_number >= len(doc):
            logger.warning(f"Page {page_number} not found in PDF with {len(doc)} pages")
            return None

        page = doc[page_number]

        # PDF user space is 72 DPI, so the render scale is the ratio.
        img = page.render(scale=dpi / 72).to_pil().convert("RGB")
        return img

    except Exception as e:
        logger.error(f"Failed to render PDF page: {e}")
        return None
    finally:
        if doc is not None:
            doc.close()


def generate_document_thumbnail(
    image: Image.Image,
    max_dimension: int,
    format: str = 'jpeg',
) -> tuple[bytes, int, int]:
    """
    Generate a thumbnail from a rendered document page.

    Args:
        image: PIL Image of rendered page
        max_dimension: Maximum width or height
        format: Output format ('jpeg' or 'png')

    Returns:
        Tuple of (image_bytes, width, height)
    """
    # Calculate new dimensions maintaining aspect ratio
    width, height = image.size

    if width > height:
        new_width = min(width, max_dimension)
        new_height = int(height * (new_width / width))
    else:
        new_height = min(height, max_dimension)
        new_width = int(width * (new_height / height))

    # Resize with high quality
    resized = image.resize((new_width, new_height), Image.Resampling.LANCZOS)

    # Convert to RGB if needed (for JPEG)
    if format.lower() == 'jpeg' and resized.mode != 'RGB':
        resized = resized.convert('RGB')

    # Save to buffer
    buffer = io.BytesIO()

    if format.lower() == 'jpeg':
        resized.save(buffer, format='JPEG', quality=JPEG_QUALITY, optimize=True, progressive=True)
    else:
        resized.save(buffer, format='PNG', optimize=True)

    return buffer.getvalue(), new_width, new_height


def process_pdf_upload(
    pdf_data: bytes,
    organization_id: str,
    media_id: str,
    db_session=None,
) -> dict[str, Any]:
    """
    Process a PDF upload: extract metadata and generate thumbnails.

    Args:
        pdf_data: Raw PDF bytes
        organization_id: Organization ID
        media_id: Media record ID
        db_session: Database session for creating derivative records

    Returns:
        Dict with processing results including metadata and derivative info
    """
    from app.models import MediaDerivative

    result = {
        'success': False,
        'page_count': None,
        'technical_metadata': {},
        'dublin_core': {},
        'derivatives': [],
        'thumbnail_s3_key': None,
        'checksum_sha256': None,
    }

    # Compute checksum
    result['checksum_sha256'] = hashlib.sha256(pdf_data).hexdigest()

    # Extract metadata
    metadata = extract_pdf_metadata(pdf_data)

    if metadata:
        result['page_count'] = metadata.page_count
        result['technical_metadata'] = {
            'page_count': metadata.page_count,
            'encrypted': metadata.encrypted,
            'file_format': metadata.file_format,
            'creator_tool': metadata.creator,
            'producer': metadata.producer,
        }

        # Map to Dublin Core
        result['dublin_core'] = {
            'dc_title': metadata.title,
            'dc_creator': metadata.author,
            'dc_subject': metadata.subject,
            'dc_date': metadata.creation_date.isoformat() if metadata.creation_date else None,
            'dc_format': 'application/pdf',
            'dc_type': 'Text',
        }

        if metadata.keywords:
            result['dublin_core']['dc_subject'] = ', '.join(metadata.keywords)

    # Render first page for thumbnails
    rendered_page = render_pdf_page(pdf_data, page_number=0)

    if rendered_page is None:
        logger.warning(f"Could not render PDF page for thumbnails: {media_id}")
        result['success'] = True  # Still successful, just no thumbnails
        return result

    # Get storage backend for this organization (BYOB-aware)
    if db_session:
        storage = get_storage_backend(organization_id, db_session)
    else:
        from app.services.storage import get_managed_storage_backend
        storage = get_managed_storage_backend(DEFAULT_REGION)

    # Generate derivatives — use DB specs if available, else hardcoded
    doc_specs = None
    if db_session:
        from app.services.derivative_config import get_derivative_specs
        doc_specs = get_derivative_specs(organization_id, 'document', db_session)

    if doc_specs:
        derivatives_to_generate = [
            (spec.name, max(spec.max_width or 0, spec.max_height or 0))
            for spec in doc_specs
        ]
    else:
        derivatives_to_generate = [
            ('thumbnail', DOCUMENT_DERIVATIVE_SIZES['thumbnail']),
            ('preview', DOCUMENT_DERIVATIVE_SIZES['preview']),
            ('large_preview', DOCUMENT_DERIVATIVE_SIZES['large_preview']),
        ]

    for derivative_type, max_dim in derivatives_to_generate:
        try:
            # Generate thumbnail
            img_bytes, width, height = generate_document_thumbnail(
                rendered_page, max_dim, format='jpeg'
            )

            # Upload to storage backend (BYOB-aware)
            s3_key = f"orgs/{organization_id}/media/derivatives/{media_id}/{derivative_type}.jpeg"

            storage.put_object_sync(
                key=s3_key,
                body=img_bytes,
                content_type='image/jpeg',
                cache_control='max-age=31536000',  # 1 year cache for immutable derivatives
            )

            # Create derivative record
            if db_session:
                derivative = MediaDerivative(
                    media_id=media_id,
                    organization_id=organization_id,
                    derivative_type=derivative_type,
                    format='jpeg',
                    s3_key=s3_key,
                    width=width,
                    height=height,
                    file_size=len(img_bytes),
                    quality=JPEG_QUALITY,
                )
                db_session.add(derivative)

            result['derivatives'].append({
                'type': derivative_type,
                'format': 'jpeg',
                's3_key': s3_key,
                'width': width,
                'height': height,
                'file_size': len(img_bytes),
            })

            # Set thumbnail key (use the smallest)
            if derivative_type == 'thumbnail':
                result['thumbnail_s3_key'] = s3_key

            logger.info(f"Generated {derivative_type} derivative for document {media_id}: {width}x{height}")

        except Exception as e:
            logger.error(f"Failed to generate {derivative_type} derivative for {media_id}: {e}")

    if db_session:
        db_session.commit()

    result['success'] = True
    return result


def process_document_upload(
    document_data: bytes,
    organization_id: str,
    media_id: str,
    mime_type: str,
    db_session=None,
) -> dict[str, Any]:
    """
    Process a document upload based on its MIME type.

    Args:
        document_data: Raw document bytes
        organization_id: Organization ID
        media_id: Media record ID
        mime_type: Document MIME type
        db_session: Database session

    Returns:
        Dict with processing results
    """
    # Route to appropriate processor based on MIME type
    if mime_type == 'application/pdf':
        return process_pdf_upload(document_data, organization_id, media_id, db_session)

    # For other document types, just compute checksum and basic metadata
    result = {
        'success': True,
        'page_count': None,
        'technical_metadata': {
            'file_format': _get_format_from_mime(mime_type),
        },
        'dublin_core': {
            'dc_format': mime_type,
            'dc_type': 'Text',
        },
        'derivatives': [],
        'thumbnail_s3_key': None,
        'checksum_sha256': hashlib.sha256(document_data).hexdigest(),
    }

    logger.info(f"Processed document {media_id} (no thumbnail for {mime_type})")
    return result


def _get_format_from_mime(mime_type: str) -> str:
    """Get human-readable format name from MIME type."""
    mime_to_format = {
        'application/pdf': 'PDF',
        'application/msword': 'Microsoft Word (DOC)',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'Microsoft Word (DOCX)',
        'application/vnd.ms-excel': 'Microsoft Excel (XLS)',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'Microsoft Excel (XLSX)',
        'text/plain': 'Plain Text',
        'text/csv': 'CSV',
    }
    return mime_to_format.get(mime_type, mime_type)
