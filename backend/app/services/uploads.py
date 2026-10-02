"""
S3 upload service for user and application media.

Regional Bucket Structure:
--------------------------
madrona-media-{region}/           - Regional buckets for org media
  orgs/{org_id}/
    collections/                  - Collection object media
    procedures/                   - Condition reports, loans, etc.
    documents/                    - General org documents

madrona-platform-{region}/        - Platform assets (avatars)
  users/{user_id}/avatars/

Supported Regions:
- us-west-2 (default)
- us-east-1
- ca-central-1
- eu-west-1
- eu-central-1

BYOB (Bring Your Own Bucket):
-----------------------------
Organizations can configure their own storage backends. Use the storage
abstraction layer for BYOB-aware operations:

    from app.services.storage import get_storage_backend
    storage = get_storage_backend(organization_id, db_session)
    await storage.put_object(key, body, content_type="image/jpeg")

The functions in this module continue to work for managed storage.
"""
import os
import re
import uuid
import logging
from datetime import datetime, timezone
from typing import BinaryIO
from enum import Enum

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# Bucket naming pattern - override with environment variables for custom naming
MEDIA_BUCKET_PREFIX = os.environ.get('S3_MEDIA_BUCKET_PREFIX', 'madrona-media')
PLATFORM_BUCKET_PREFIX = os.environ.get('S3_PLATFORM_BUCKET_PREFIX', 'madrona-platform')
DEFAULT_REGION = os.environ.get('AWS_REGION', 'us-west-2')

# CloudFront CDN URL (optional) - if set, media URLs will use CDN instead of S3 presigned
# Format: https://d1234567890.cloudfront.net or https://media.example.com
MEDIA_CDN_URL = os.environ.get('MEDIA_CDN_URL', '')

# Supported storage regions
SUPPORTED_REGIONS = [
    'us-west-2',      # Oregon (default)
    'us-east-1',      # Virginia
    'ca-central-1',   # Canada
    'eu-west-1',      # Ireland
    'eu-central-1',   # Frankfurt
]


class MediaType(str, Enum):
    """Types of media that can be uploaded."""
    IMAGE = 'image'
    VIDEO = 'video'
    AUDIO = 'audio'
    DOCUMENT = 'document'


class StorageLimitExceeded(Exception):
    """Raised when an upload would exceed the organization's storage limit."""
    def __init__(self, message: str, used_bytes: int, limit_bytes: int, file_size: int):
        super().__init__(message)
        self.used_bytes = used_bytes
        self.limit_bytes = limit_bytes
        self.file_size = file_size


# Allowed MIME types by media type
ALLOWED_TYPES = {
    MediaType.IMAGE: {
        'image/jpeg': 'jpg',
        'image/png': 'png',
        'image/gif': 'gif',
        'image/webp': 'webp',
        'image/svg+xml': 'svg',
        'image/tiff': 'tiff',
    },
    MediaType.VIDEO: {
        'video/mp4': 'mp4',
        'video/webm': 'webm',
        'video/quicktime': 'mov',
        'video/x-msvideo': 'avi',
    },
    MediaType.AUDIO: {
        'audio/mpeg': 'mp3',
        'audio/wav': 'wav',
        'audio/ogg': 'ogg',
        'audio/flac': 'flac',
        'audio/aac': 'aac',
    },
    MediaType.DOCUMENT: {
        'application/pdf': 'pdf',
        'application/msword': 'doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
        'application/vnd.ms-excel': 'xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
        'text/plain': 'txt',
        'text/csv': 'csv',
    },
}

# Max file sizes by media type
# No file size limits for org media uploads — museums routinely work with
# archival TIFFs, RAW files, and other large formats.

# Avatar-specific limits (smaller for profile pics)
AVATAR_MAX_SIZE = 5 * 1024 * 1024  # 5MB
AVATAR_ALLOWED_TYPES = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
}

# Magic byte signatures for file type verification.
# Maps MIME types to (offset, expected_bytes) tuples.
# For container formats (RIFF), a secondary check is included.
_MAGIC_BYTES: dict[str, list[tuple[int, bytes]]] = {
    'image/jpeg': [(0, b'\xff\xd8\xff')],
    'image/png': [(0, b'\x89PNG\r\n\x1a\n')],
    'image/gif': [(0, b'GIF8')],
    'image/webp': [(0, b'RIFF'), (8, b'WEBP')],
    'image/tiff': [(0, b'II\x2a\x00')],  # Little-endian; big-endian checked separately
    'image/svg+xml': [],  # Text-based; validated by content inspection below
    'application/pdf': [(0, b'%PDF')],
    'application/msword': [(0, b'\xd0\xcf\x11\xe0')],  # OLE2 compound document
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': [(0, b'PK\x03\x04')],
    'application/vnd.ms-excel': [(0, b'\xd0\xcf\x11\xe0')],
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': [(0, b'PK\x03\x04')],
    'audio/mpeg': [],  # MP3: FF FB/FA/F3 or ID3 tag — checked separately
    'audio/wav': [(0, b'RIFF'), (8, b'WAVE')],
    'audio/ogg': [(0, b'OggS')],
    'audio/flac': [(0, b'fLaC')],
    'video/mp4': [],  # ftyp box at offset 4 — checked separately
    'video/quicktime': [],  # Same as MP4
}

# Dangerous SVG elements and attributes that enable XSS
_SVG_DANGEROUS_TAGS = re.compile(
    r'<\s*(script|iframe|object|embed|applet|form|meta|link|base)\b[^>]*>.*?</\s*\1\s*>|'
    r'<\s*(script|iframe|object|embed|applet|form|meta|link|base)\b[^>]*/?>',
    re.IGNORECASE | re.DOTALL,
)
_SVG_EVENT_HANDLERS = re.compile(
    r'\s+on\w+\s*=\s*["\'][^"\']*["\']',
    re.IGNORECASE,
)
_SVG_JAVASCRIPT_URLS = re.compile(
    r'((?:href|xlink:href|src|action)\s*=\s*)["\']?\s*javascript\s*:[^"\'>\s]*["\']?',
    re.IGNORECASE,
)


def validate_file_magic_bytes(file_content: bytes, claimed_type: str) -> None:
    """
    Verify that file content matches the claimed MIME type using magic bytes.

    Raises ValueError if the file content doesn't match the claimed type.
    Silently passes for types without known magic signatures (text/plain, text/csv, etc.).
    """
    # SVG: text-based, check for valid XML/SVG content
    if claimed_type == 'image/svg+xml':
        _validate_svg_content(file_content)
        return

    # MP3: multiple valid headers (ID3 tag or sync word)
    if claimed_type == 'audio/mpeg':
        if (file_content[:3] == b'ID3' or
                (len(file_content) >= 2 and file_content[0] == 0xff and (file_content[1] & 0xe0) == 0xe0)):
            return
        raise ValueError("File content does not match claimed type audio/mpeg")

    # MP4/QuickTime: ftyp box marker at offset 4
    if claimed_type in ('video/mp4', 'video/quicktime', 'video/x-msvideo'):
        if claimed_type == 'video/x-msvideo' and file_content[:4] == b'RIFF':
            return
        if len(file_content) >= 8 and file_content[4:8] == b'ftyp':
            return
        if len(file_content) >= 8 and file_content[4:8] in (b'moov', b'mdat', b'wide', b'free', b'skip'):
            return  # Some valid MP4s don't start with ftyp
        raise ValueError(f"File content does not match claimed type {claimed_type}")

    # TIFF: can be either little-endian (II) or big-endian (MM)
    if claimed_type == 'image/tiff':
        if file_content[:4] in (b'II\x2a\x00', b'MM\x00\x2a'):
            return
        raise ValueError("File content does not match claimed type image/tiff")

    # AAC: ADTS header or wrapped in MP4 container
    if claimed_type == 'audio/aac':
        if (len(file_content) >= 2 and file_content[0] == 0xff and (file_content[1] & 0xf0) == 0xf0):
            return
        if len(file_content) >= 8 and file_content[4:8] == b'ftyp':
            return  # AAC in MP4 container
        raise ValueError("File content does not match claimed type audio/aac")

    # Standard magic byte checks
    signatures = _MAGIC_BYTES.get(claimed_type)
    if signatures is None:
        # No signature defined for this type (text/plain, text/csv, etc.) — skip
        return

    if not signatures:
        # Empty list means type is handled by special case above
        return

    for offset, expected in signatures:
        end = offset + len(expected)
        if len(file_content) < end or file_content[offset:end] != expected:
            raise ValueError(
                f"File content does not match claimed type {claimed_type}"
            )


def _validate_svg_content(file_content: bytes) -> None:
    """Validate that content is actually SVG and strip/reject dangerous content."""
    try:
        text = file_content.decode('utf-8', errors='ignore')
    except Exception:
        raise ValueError("SVG file is not valid UTF-8 text")

    # Must contain an <svg element
    if not re.search(r'<\s*svg[\s>]', text, re.IGNORECASE):
        raise ValueError("File content does not appear to be a valid SVG")


def sanitize_svg(file_content: bytes) -> bytes:
    """
    Remove dangerous elements from SVG content.

    Strips <script>, event handlers (onclick, onload, etc.), and javascript: URLs.
    Returns sanitized SVG bytes.
    """
    try:
        text = file_content.decode('utf-8')
    except UnicodeDecodeError:
        raise ValueError("SVG file contains invalid UTF-8")

    # Remove dangerous tags
    text = _SVG_DANGEROUS_TAGS.sub('', text)
    # Remove event handler attributes
    text = _SVG_EVENT_HANDLERS.sub('', text)
    # Remove javascript: URLs (replace entire attribute value)
    text = _SVG_JAVASCRIPT_URLS.sub(r'\g<1>""', text)

    return text.encode('utf-8')


def get_media_bucket(region: str) -> str:
    """Get the media bucket name for a given region."""
    if region not in SUPPORTED_REGIONS:
        logger.warning("Unsupported region %s, falling back to %s", region, DEFAULT_REGION)
        region = DEFAULT_REGION
    return os.environ.get("S3_MEDIA_BUCKET") or f"{MEDIA_BUCKET_PREFIX}-{region}"


def get_platform_bucket(region: str = DEFAULT_REGION) -> str:
    """Get the platform bucket name (for avatars, etc.)."""
    return os.environ.get("S3_PLATFORM_BUCKET") or f"{PLATFORM_BUCKET_PREFIX}-{region}"


def get_s3_client(region: str = DEFAULT_REGION, *, for_presigning: bool = False):
    """Get boto3 S3 client for a specific region.

    Honors S3_ENDPOINT_URL (S3-compatible, self-hosted) with
    path-style addressing, matching storage/factory.py's managed backend.

    for_presigning: build the client against S3_PUBLIC_ENDPOINT_URL instead.
    Presigned URLs are consumed by the *browser*, which is outside the
    container network — a URL signed for the internal host (``seaweedfs:8333``)
    is unresolvable there, and rewriting the host afterwards invalidates the
    signature because the Host header is signed. Signing is a local
    computation, so this client never needs to reach the endpoint itself.
    Falls back to S3_ENDPOINT_URL when no public URL is configured (i.e. on
    AWS, where both are the same).
    """
    if for_presigning:
        endpoint = os.environ.get("S3_PUBLIC_ENDPOINT_URL") or os.environ.get("S3_ENDPOINT_URL", "")
    else:
        endpoint = os.environ.get("S3_ENDPOINT_URL", "")
    if endpoint:
        from botocore.config import Config
        return boto3.client(
            's3', region_name=region, endpoint_url=endpoint,
            config=Config(s3={'addressing_style': 'path'}),
        )
    return boto3.client('s3', region_name=region)


def generate_s3_key(
    organization_id: str,
    media_type: str,
    filename: str,
) -> str:
    """Build a deterministic S3 key for a media upload.

    Same path shape as upload_media (orgs/{org}/media/{type-folder}/{date}_{id}.ext)
    so all upload paths produce keys with consistent prefixes.

    Used by `app.tasks.media.upload_from_url_task` and any future caller
    that needs to mint a key without going through the full upload_media
    pipeline.
    """
    extension = ""
    if "." in filename:
        extension = filename.rsplit(".", 1)[-1].lower()

    # Map media_type ('image', 'video', 'audio', 'document', '3d_model') to
    # the folder convention used elsewhere in this module.
    folder_map = {
        "image": "images",
        "video": "videos",
        "audio": "audio",
        "document": "documents",
        "3d_model": "models_3d",
    }
    media_folder = folder_map.get(media_type, "other")

    unique_id = uuid.uuid4().hex[:12]
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    suffix = f".{extension}" if extension else ""
    return (
        f"orgs/{organization_id}/media/{media_folder}/"
        f"{timestamp}_{unique_id}{suffix}"
    )


# =============================================================================
# Storage Limit Checking
# =============================================================================

def check_storage_limit(
    organization_id: str,
    file_size: int,
    db_session=None,
) -> tuple[int, int]:
    """
    Check if uploading a file would exceed the organization's storage limit.

    Args:
        organization_id: The organization's ID
        file_size: Size of the file to upload in bytes
        db_session: SQLAlchemy session (required)

    Returns:
        Tuple of (current_used_bytes, limit_bytes)

    Raises:
        StorageLimitExceeded: If the upload would exceed the limit
        ValueError: If organization not found or has no storage tier
    """
    if db_session is None:
        raise ValueError("db_session is required for storage limit checking")

    from app.models import Organization

    org = db_session.query(Organization).filter(
        Organization.organization_id == organization_id
    ).first()

    if not org:
        raise ValueError(f"Organization not found: {organization_id}")

    # Check storage limit — defaults to 10 TB if not explicitly set
    # Total usage includes S3 media (trigger-maintained) plus DB and search
    # (daily metering task). The unified quota covers all storage types.
    from app.models import Organization
    limit_gb = org.storage_limit_gb if org.storage_limit_gb is not None else Organization.DEFAULT_STORAGE_LIMIT_GB
    limit_bytes = limit_gb * 1024 * 1024 * 1024
    media_bytes = org.storage_used_bytes or 0
    db_bytes = org.db_used_bytes or 0
    search_bytes = org.search_used_bytes or 0
    used_bytes = media_bytes + db_bytes + search_bytes

    if used_bytes + file_size > limit_bytes:
        raise StorageLimitExceeded(
            f"Upload would exceed storage limit. "
            f"Used: {used_bytes / (1024**3):.2f} GB, "
            f"Limit: {limit_gb} GB, "
            f"File size: {file_size / (1024**2):.2f} MB",
            used_bytes=used_bytes,
            limit_bytes=limit_bytes,
            file_size=file_size,
        )

    return used_bytes, limit_bytes


def get_org_storage_region(organization_id: str, db_session) -> str:
    """Get the storage region for an organization."""
    from app.models import Organization

    org = db_session.query(Organization).filter(
        Organization.organization_id == organization_id
    ).first()

    if not org:
        logger.warning("Organization not found: %s, using default region", organization_id)
        return DEFAULT_REGION

    return org.storage_region or DEFAULT_REGION


def update_storage_used(organization_id: str, bytes_delta: int, db_session) -> int:
    """
    Return the current storage_used_bytes for an organization.

    NOTE: storage_used_bytes is now maintained automatically by a PostgreSQL
    trigger (trg_media_storage_used_bytes) on INSERT/UPDATE/DELETE of media
    rows. This function no longer performs manual updates — the trigger
    handles accounting atomically within the same transaction.

    Kept for backward compatibility with callers; returns current value.

    Args:
        organization_id: The organization's ID
        bytes_delta: Ignored (trigger handles accounting)
        db_session: SQLAlchemy session

    Returns:
        Current storage_used_bytes value
    """
    from app.models import Organization

    org = db_session.query(Organization).filter(
        Organization.organization_id == organization_id
    ).first()

    return org.storage_used_bytes if org else 0


# =============================================================================
# User Media (Avatars)
# =============================================================================

def upload_avatar(
    user_id: str,
    file_data: BinaryIO,
    content_type: str,
    filename: str | None = None,
) -> str:
    """
    Upload a user avatar to S3.

    S3 Key: users/{user_id}/avatars/{unique_id}.{ext}

    Args:
        user_id: The user's ID
        file_data: File-like object containing image data
        content_type: MIME type of the image
        filename: Original filename (optional, for extension detection)

    Returns:
        The S3 key of the uploaded file

    Raises:
        ValueError: If file type is not allowed or file is too large
        ClientError: If S3 upload fails
    """
    # Validate content type
    if content_type not in AVATAR_ALLOWED_TYPES:
        raise ValueError(f"File type '{content_type}' not allowed. Allowed types: {', '.join(AVATAR_ALLOWED_TYPES.keys())}")

    # Read file data to check size
    file_content = file_data.read()
    if len(file_content) > AVATAR_MAX_SIZE:
        raise ValueError(f"File too large. Maximum size is {AVATAR_MAX_SIZE // (1024 * 1024)}MB")

    # Verify file content matches claimed MIME type
    validate_file_magic_bytes(file_content, content_type)

    # Generate unique filename with user-scoped path
    extension = AVATAR_ALLOWED_TYPES[content_type]
    unique_id = uuid.uuid4().hex[:8]
    s3_key = f"users/{user_id}/avatars/{unique_id}.{extension}"

    # Upload to S3 (platform bucket)
    bucket = get_platform_bucket()
    s3_client = get_s3_client()
    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=file_content,
            ContentType=content_type,
            CacheControl='max-age=31536000',  # 1 year cache
        )
        logger.info("Uploaded avatar for user %s: %s", user_id, s3_key)
        return s3_key
    except ClientError as e:
        logger.error("Failed to upload avatar for user %s: %s", user_id, e)
        raise


def delete_avatar(s3_key: str) -> bool:
    """
    Delete an avatar from S3.

    Args:
        s3_key: The S3 key of the file to delete

    Returns:
        True if deleted successfully, False otherwise
    """
    return delete_file(s3_key, bucket=get_platform_bucket())


def get_avatar_url(s3_key: str, expiry_seconds: int = 3600) -> str | None:
    """
    Generate a presigned URL for accessing an avatar.

    Args:
        s3_key: The S3 key of the avatar
        expiry_seconds: URL expiry time in seconds (default 1 hour)

    Returns:
        Presigned URL or None if generation fails
    """
    return get_presigned_url(s3_key, expiry_seconds, bucket=get_platform_bucket())


def get_avatar_public_url(s3_key: str) -> str | None:
    """
    Get a CloudFront or direct S3 URL for an avatar.
    For now, returns a presigned URL with long expiry.

    In production, this should use CloudFront for better caching.
    """
    # Use 24-hour presigned URL for now
    return get_presigned_url(s3_key, expiry_seconds=86400, bucket=get_platform_bucket())


# =============================================================================
# Organization Media (Media Application)
# =============================================================================

def upload_org_media(
    organization_id: str,
    file_data: BinaryIO,
    content_type: str,
    media_type: MediaType | None = None,
    filename: str | None = None,
    subfolder: str | None = None,
    db_session=None,
    check_limits: bool = True,
) -> tuple[str, int]:
    """
    Upload a media file for an organization (Media application).

    S3 Key: orgs/{org_id}/media/{media_type_folder}/{unique_id}.{ext}

    Args:
        organization_id: The organization's ID
        file_data: File-like object containing the media
        content_type: MIME type of the file
        media_type: Type of media (auto-detected from content_type if not provided)
        filename: Original filename (optional)
        subfolder: Optional subfolder within the media directory
        db_session: SQLAlchemy session (required for limit checking)
        check_limits: Whether to check storage limits (default True)

    Returns:
        Tuple of (s3_key, file_size_bytes)

    Raises:
        ValueError: If file type is not allowed or file is too large
        StorageLimitExceeded: If upload would exceed storage limit
        ClientError: If S3 upload fails
    """
    # Auto-detect media type from content_type if not provided
    if media_type is None:
        media_type = detect_media_type(content_type)
        if media_type is None:
            raise ValueError(f"Unsupported file type: {content_type}")

    # Validate content type for this media type
    allowed = ALLOWED_TYPES.get(media_type, {})
    if content_type not in allowed:
        raise ValueError(f"File type '{content_type}' not allowed for {media_type.value}. Allowed: {', '.join(allowed.keys())}")

    # Read file data to check size
    file_content = file_data.read()
    file_size = len(file_content)
    # Verify file content matches claimed MIME type (prevents Content-Type spoofing)
    validate_file_magic_bytes(file_content, content_type)

    # Sanitize SVG files to strip XSS vectors (script tags, event handlers, javascript: URLs)
    if content_type == 'image/svg+xml':
        file_content = sanitize_svg(file_content)
        file_size = len(file_content)

    # Check storage limits
    if check_limits and db_session:
        check_storage_limit(organization_id, file_size, db_session)

    # Get organization's storage region
    if db_session:
        region = get_org_storage_region(organization_id, db_session)
    else:
        region = DEFAULT_REGION

    # Generate unique filename with org-scoped path
    extension = allowed[content_type]
    unique_id = uuid.uuid4().hex[:12]
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%d')

    # Build path: orgs/{org_id}/media/{type}/{subfolder?}/{date}_{unique_id}.{ext}
    media_folder = f"{media_type.value}s"  # images, videos, audio, documents
    if subfolder:
        s3_key = f"orgs/{organization_id}/media/{media_folder}/{subfolder}/{timestamp}_{unique_id}.{extension}"
    else:
        s3_key = f"orgs/{organization_id}/media/{media_folder}/{timestamp}_{unique_id}.{extension}"

    # Upload to S3 (regional media bucket)
    bucket = get_media_bucket(region)
    s3_client = get_s3_client(region)
    try:
        s3_client.put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=file_content,
            ContentType=content_type,
            CacheControl='max-age=86400',  # 1 day cache for media
            Tagging='FileType=original',  # Tag for S3 lifecycle policy targeting
        )
        logger.info("Uploaded media for org %s to %s/%s (%d bytes)", organization_id, bucket, s3_key, file_size)

        # Update storage usage
        if db_session:
            update_storage_used(organization_id, file_size, db_session)

        return s3_key, file_size
    except ClientError as e:
        logger.error("Failed to upload media for org %s: %s", organization_id, e)
        raise


def delete_org_media(
    s3_key: str,
    organization_id: str | None = None,
    file_size: int | None = None,
    db_session=None,
    region: str | None = None,
) -> bool:
    """
    Delete an organization media file from S3.

    Args:
        s3_key: The S3 key of the file to delete
        organization_id: The organization's ID (for storage tracking)
        file_size: Size of file being deleted (for storage tracking)
        db_session: SQLAlchemy session (for storage tracking)
        region: Storage region (auto-detected from org if not provided)

    Returns:
        True if deleted successfully, False otherwise
    """
    # Validate that this is an org media file (security check)
    if not s3_key.startswith('orgs/'):
        logger.warning("Attempted to delete non-org media file: %s", s3_key)
        return False

    # Get region
    if region is None and db_session and organization_id:
        region = get_org_storage_region(organization_id, db_session)
    elif region is None:
        region = DEFAULT_REGION

    bucket = get_media_bucket(region)
    success = delete_file(s3_key, bucket=bucket, region=region)

    # Update storage usage on successful delete
    if success and db_session and organization_id and file_size:
        update_storage_used(organization_id, -file_size, db_session)

    return success


class MediaUrlType(str, Enum):
    """Types of media URL access."""
    VIEW = 'view'           # View/stream media (default)
    DOWNLOAD = 'download'   # Download original file
    THUMBNAIL = 'thumbnail' # Download thumbnail/preview


def get_org_media_url(
    s3_key: str,
    organization_id: str | None = None,
    db_session=None,
    region: str | None = None,
    expiry_seconds: int = 3600,
    use_cdn: bool = True,
    # New parameters for permission-based URL generation
    user_id: str | None = None,
    media_id: str | None = None,
    url_type: MediaUrlType = MediaUrlType.VIEW,
    is_published: bool | None = None,
    skip_permission_check: bool = False,
) -> str | None:
    """
    Generate a URL for accessing organization media.

    If CloudFront signing is configured, returns a signed CloudFront URL.
    If MEDIA_CDN_URL is configured without signing, returns an unsigned CDN URL.
    Otherwise, returns a presigned S3 URL.

    Permission checks (when user_id is provided and skip_permission_check=False):
    - DOWNLOAD url_type requires media.download_original permission
    - THUMBNAIL url_type requires media.download_derivatives permission
    - Unpublished media (is_published=False) requires media.view_unpublished

    Args:
        s3_key: The S3 key of the media file
        organization_id: The organization's ID (for region lookup and permissions)
        db_session: SQLAlchemy session (for region lookup)
        region: Storage region (auto-detected from org if not provided)
        expiry_seconds: URL expiry time in seconds (default 1 hour)
        use_cdn: If True and CDN is configured, return CDN URL (default True)
        user_id: User ID for permission checks (optional - no check if not provided)
        media_id: Media ID for logging/auditing (optional)
        url_type: Type of URL access (VIEW, DOWNLOAD, THUMBNAIL)
        is_published: Whether the media is published (for view_unpublished check)
        skip_permission_check: If True, skip permission checks (default False)

    Returns:
        Media URL or None if generation fails or permission denied
    """
    if not s3_key:
        return None

    # Permission checks when user_id is provided
    if user_id and organization_id and not skip_permission_check:
        if not _check_media_url_permission(
            user_id=user_id,
            organization_id=organization_id,
            url_type=url_type,
            is_published=is_published,
            session=db_session,
        ):
            logger.warning(
                "Permission denied for media URL",
                extra={
                    "user_id": user_id,
                    "organization_id": organization_id,
                    "media_id": media_id,
                    "url_type": url_type.value if url_type else None,
                    "is_published": is_published,
                }
            )
            return None

    # Try CloudFront signed URL first (if configured)
    if use_cdn and MEDIA_CDN_URL:
        from app.services.cloudfront_signing import (
            is_cloudfront_configured,
            get_signed_url,
        )

        if is_cloudfront_configured():
            signed_url = get_signed_url(s3_key, expiry_seconds)
            if signed_url:
                return signed_url

        # Fall back to unsigned CDN URL
        return f"{MEDIA_CDN_URL.rstrip('/')}/{s3_key}"

    # Fall back to storage backend presigned URL (BYOB-aware)
    if organization_id and db_session:
        from app.services.storage import get_storage_backend
        storage = get_storage_backend(organization_id, db_session)
        try:
            return storage.generate_presigned_download_url_sync(
                key=s3_key,
                expires_in=expiry_seconds,
            )
        except Exception as e:
            logger.warning("Failed to generate presigned URL via storage backend: %s", e)
            # Fall back to legacy method

    # Legacy S3 presigned URL fallback
    if region is None and db_session and organization_id:
        region = get_org_storage_region(organization_id, db_session)
    elif region is None:
        region = DEFAULT_REGION

    bucket = get_media_bucket(region)
    return get_presigned_url(s3_key, expiry_seconds, bucket=bucket, region=region)


def _check_media_url_permission(
    user_id: str,
    organization_id: str,
    url_type: MediaUrlType,
    is_published: bool | None = None,
    session=None,
) -> bool:
    """
    Check if user has permission for the requested media URL type.

    Args:
        user_id: User ID
        organization_id: Organization ID
        url_type: Type of URL access
        is_published: Whether the media is published

    Returns:
        True if user has permission, False otherwise
    """
    from app.services.rbac_service import check_permission
    from app.permissions import Permission

    # Check unpublished media access
    if is_published is False:
        if not check_permission(user_id, organization_id, Permission.MEDIA_VIEW_UNPUBLISHED, session=session):
            return False

    # Check based on URL type
    if url_type == MediaUrlType.DOWNLOAD:
        return check_permission(user_id, organization_id, Permission.MEDIA_DOWNLOAD_ORIGINAL, session=session)
    elif url_type == MediaUrlType.THUMBNAIL:
        return check_permission(user_id, organization_id, Permission.MEDIA_DOWNLOAD_DERIVATIVES, session=session)
    else:
        # VIEW type - just needs basic media.view (already checked at route level)
        return True


def list_org_media(
    organization_id: str,
    media_type: MediaType | None = None,
    prefix: str | None = None,
    max_keys: int = 1000,
    db_session=None,
    region: str | None = None,
) -> list[dict]:
    """
    List media files for an organization.

    Args:
        organization_id: The organization's ID
        media_type: Optional filter by media type
        prefix: Optional additional prefix filter
        max_keys: Maximum number of results
        db_session: SQLAlchemy session (for region lookup)
        region: Storage region (auto-detected from org if not provided)

    Returns:
        List of file metadata dicts with keys: key, size, last_modified
    """
    # Get region
    if region is None and db_session:
        region = get_org_storage_region(organization_id, db_session)
    elif region is None:
        region = DEFAULT_REGION

    bucket = get_media_bucket(region)
    s3_client = get_s3_client(region)

    # Build prefix
    if media_type:
        base_prefix = f"orgs/{organization_id}/media/{media_type.value}s/"
    else:
        base_prefix = f"orgs/{organization_id}/media/"

    if prefix:
        base_prefix = f"{base_prefix}{prefix}"

    try:
        response = s3_client.list_objects_v2(
            Bucket=bucket,
            Prefix=base_prefix,
            MaxKeys=max_keys,
        )

        files = []
        for obj in response.get('Contents', []):
            files.append({
                'key': obj['Key'],
                'size': obj['Size'],
                'last_modified': obj['LastModified'].isoformat(),
            })
        return files
    except ClientError as e:
        logger.error("Failed to list media for org %s: %s", organization_id, e)
        return []


# =============================================================================
# Generic Utilities
# =============================================================================

def detect_media_type(content_type: str) -> MediaType | None:
    """Detect MediaType from MIME content type."""
    for media_type, allowed_types in ALLOWED_TYPES.items():
        if content_type in allowed_types:
            return media_type
    return None


def delete_file(s3_key: str, bucket: str | None = None, region: str = DEFAULT_REGION) -> bool:
    """
    Delete a file from S3.

    Args:
        s3_key: The S3 key of the file to delete
        bucket: S3 bucket name (defaults to platform bucket)
        region: AWS region

    Returns:
        True if deleted successfully, False otherwise
    """
    if not s3_key:
        return False

    if bucket is None:
        bucket = get_platform_bucket(region)

    s3_client = get_s3_client(region)
    try:
        s3_client.delete_object(Bucket=bucket, Key=s3_key)
        logger.info("Deleted file: %s/%s", bucket, s3_key)
        return True
    except ClientError as e:
        logger.error("Failed to delete file %s/%s: %s", bucket, s3_key, e)
        return False


def get_presigned_url(
    s3_key: str,
    expiry_seconds: int = 3600,
    bucket: str | None = None,
    region: str = DEFAULT_REGION,
) -> str | None:
    """
    Generate a presigned URL for accessing a file.

    Args:
        s3_key: The S3 key of the file
        expiry_seconds: URL expiry time in seconds (default 1 hour)
        bucket: S3 bucket name (defaults to platform bucket)
        region: AWS region

    Returns:
        Presigned URL or None if generation fails
    """
    if not s3_key:
        return None

    if bucket is None:
        bucket = get_platform_bucket(region)

    s3_client = get_s3_client(region, for_presigning=True)
    try:
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': bucket,
                'Key': s3_key,
            },
            ExpiresIn=expiry_seconds,
        )
        return url
    except ClientError as e:
        logger.error("Failed to generate presigned URL for %s/%s: %s", bucket, s3_key, e)
        return None


def get_presigned_upload_url(
    s3_key: str,
    content_type: str,
    expiry_seconds: int = 3600,
    bucket: str | None = None,
    region: str = DEFAULT_REGION,
) -> dict | None:
    """
    Generate a presigned URL for uploading a file directly from the client.

    Useful for large file uploads to avoid proxying through the backend.

    Args:
        s3_key: The S3 key where the file will be uploaded
        content_type: Expected MIME type of the upload
        expiry_seconds: URL expiry time in seconds (default 1 hour)
        bucket: S3 bucket name
        region: AWS region

    Returns:
        Dict with 'url' and 'fields' for the presigned POST, or None if generation fails
    """
    if bucket is None:
        bucket = get_media_bucket(region)

    s3_client = get_s3_client(region)
    try:
        response = s3_client.generate_presigned_post(
            Bucket=bucket,
            Key=s3_key,
            Fields={'Content-Type': content_type},
            Conditions=[
                {'Content-Type': content_type},
                ['content-length-range', 1, 50 * 1024 * 1024 * 1024],  # 50GB upper bound
            ],
            ExpiresIn=expiry_seconds,
        )
        return response
    except ClientError as e:
        logger.error("Failed to generate presigned upload URL for %s/%s: %s", bucket, s3_key, e)
        return None


# =============================================================================
# BYOB (Bring Your Own Bucket) Support
# =============================================================================


def get_org_storage_backend(organization_id: str, db_session):
    """
    Get the storage backend for an organization (BYOB-aware).

    This returns the appropriate storage backend based on the organization's
    storage configuration. For most orgs, this returns a backend for
    Madrona's managed S3 buckets. For BYOB orgs, it returns a backend
    configured with their custom storage.

    Args:
        organization_id: The organization's ID
        db_session: SQLAlchemy session

    Returns:
        StorageBackend instance

    Example:
        storage = get_org_storage_backend(org_id, db)
        await storage.put_object("orgs/.../file.jpg", data, content_type="image/jpeg")
    """
    from app.services.storage import get_storage_backend
    return get_storage_backend(organization_id, db_session)


def upload_org_media_byob(
    organization_id: str,
    file_data: BinaryIO,
    content_type: str,
    media_type: MediaType | None = None,
    filename: str | None = None,
    subfolder: str | None = None,
    db_session=None,
    check_limits: bool = True,
) -> tuple[str, int]:
    """
    Upload a media file using the organization's storage backend (BYOB-aware).

    This is the BYOB-aware version of upload_org_media(). It checks if the
    organization has a custom storage configuration and uses the appropriate
    backend.

    Args:
        organization_id: The organization's ID
        file_data: File-like object containing the media
        content_type: MIME type of the file
        media_type: Type of media (auto-detected if not provided)
        filename: Original filename (optional)
        subfolder: Optional subfolder within the media directory
        db_session: SQLAlchemy session (required)
        check_limits: Whether to check storage limits (default True)

    Returns:
        Tuple of (s3_key, file_size_bytes)
    """
    from app.services.storage import get_storage_backend
    from app.models import OrganizationStorageConfig

    # Check if org has BYOB storage
    byob_config = db_session.query(OrganizationStorageConfig).filter_by(
        organization_id=organization_id
    ).first()

    # Use BYOB path if configured with non-managed storage
    if byob_config and byob_config.provider != "managed":
        return _upload_org_media_via_backend(
            organization_id=organization_id,
            file_data=file_data,
            content_type=content_type,
            media_type=media_type,
            filename=filename,
            subfolder=subfolder,
            db_session=db_session,
            check_limits=check_limits,
        )

    # Use standard managed storage path
    return upload_org_media(
        organization_id=organization_id,
        file_data=file_data,
        content_type=content_type,
        media_type=media_type,
        filename=filename,
        subfolder=subfolder,
        db_session=db_session,
        check_limits=check_limits,
    )


def _upload_org_media_via_backend(
    organization_id: str,
    file_data: BinaryIO,
    content_type: str,
    media_type: MediaType | None = None,
    filename: str | None = None,
    subfolder: str | None = None,
    db_session=None,
    check_limits: bool = True,
) -> tuple[str, int]:
    """
    Internal: Upload media using the storage backend abstraction.
    """
    from app.services.storage import get_storage_backend

    # Auto-detect media type
    if media_type is None:
        media_type = detect_media_type(content_type)
        if media_type is None:
            raise ValueError(f"Unsupported file type: {content_type}")

    # Validate content type
    allowed = ALLOWED_TYPES.get(media_type, {})
    if content_type not in allowed:
        raise ValueError(
            f"File type '{content_type}' not allowed for {media_type.value}. "
            f"Allowed: {', '.join(allowed.keys())}"
        )

    # Read file data
    file_content = file_data.read()
    file_size = len(file_content)

    # Verify file content matches claimed MIME type (prevents Content-Type spoofing)
    validate_file_magic_bytes(file_content, content_type)

    # Sanitize SVG files to strip XSS vectors
    if content_type == 'image/svg+xml':
        file_content = sanitize_svg(file_content)
        file_size = len(file_content)

    # Check storage limits
    if check_limits and db_session:
        check_storage_limit(organization_id, file_size, db_session)

    # Generate S3 key
    extension = allowed[content_type]
    unique_id = uuid.uuid4().hex[:12]
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%d')

    media_folder = f"{media_type.value}s"
    if subfolder:
        s3_key = f"orgs/{organization_id}/media/{media_folder}/{subfolder}/{timestamp}_{unique_id}.{extension}"
    else:
        s3_key = f"orgs/{organization_id}/media/{media_folder}/{timestamp}_{unique_id}.{extension}"

    # Get storage backend and upload
    storage = get_storage_backend(organization_id, db_session)

    try:
        storage.put_object_sync(
            key=s3_key,
            body=file_content,
            content_type=content_type,
            cache_control="max-age=86400",
            tags={"FileType": "original"},
        )
        logger.info(
            "Uploaded media for org %s via %s backend: %s (%d bytes)",
            organization_id,
            storage.provider_name,
            s3_key,
            file_size,
        )

        # Update storage usage (only for managed storage - BYOB orgs handle their own)
        # For now, we still track for analytics purposes
        if db_session:
            update_storage_used(organization_id, file_size, db_session)

        return s3_key, file_size

    except Exception as e:
        logger.error(
            "Failed to upload media for org %s via %s backend: %s",
            organization_id,
            storage.provider_name,
            e,
        )
        raise


def get_org_media_url_byob(
    s3_key: str,
    organization_id: str,
    db_session=None,
    expiry_seconds: int = 3600,
    use_cdn: bool = True,
    filename: str | None = None,
) -> str | None:
    """
    Generate a URL for accessing organization media (BYOB-aware).

    This is the BYOB-aware version of get_org_media_url(). It checks if the
    organization has a custom storage configuration and generates URLs
    accordingly.

    Args:
        s3_key: The S3 key of the media file
        organization_id: The organization's ID
        db_session: SQLAlchemy session
        expiry_seconds: URL expiry time in seconds (default 1 hour)
        use_cdn: If True and CDN is configured, return CDN URL
        filename: Optional filename for Content-Disposition

    Returns:
        Media URL or None if generation fails
    """
    from app.services.storage.factory import get_media_url
    return get_media_url(
        key=s3_key,
        organization_id=organization_id,
        db_session=db_session,
        expiry_seconds=expiry_seconds,
        use_cdn=use_cdn,
        filename=filename,
    )


def delete_org_media_byob(
    s3_key: str,
    organization_id: str,
    file_size: int | None = None,
    db_session=None,
) -> bool:
    """
    Delete an organization media file (BYOB-aware).

    This is the BYOB-aware version of delete_org_media(). It checks if the
    organization has a custom storage configuration and deletes from the
    appropriate backend.

    Args:
        s3_key: The S3 key of the file to delete
        organization_id: The organization's ID
        file_size: Size of file being deleted (for storage tracking)
        db_session: SQLAlchemy session

    Returns:
        True if deleted successfully, False otherwise
    """
    from app.services.storage import get_storage_backend
    from app.models import OrganizationStorageConfig

    # Validate that this is an org media file
    if not s3_key.startswith('orgs/'):
        logger.warning("Attempted to delete non-org media file: %s", s3_key)
        return False

    # Check if org has BYOB storage
    byob_config = None
    if db_session:
        byob_config = db_session.query(OrganizationStorageConfig).filter_by(
            organization_id=organization_id
        ).first()

    # Use BYOB path if configured
    if byob_config and byob_config.provider != "managed":
        try:
            storage = get_storage_backend(organization_id, db_session)
            success = storage.delete_object_sync(s3_key)

            if success and db_session and file_size:
                update_storage_used(organization_id, -file_size, db_session)

            return success
        except Exception as e:
            logger.error(
                "Failed to delete media for org %s via BYOB backend: %s",
                organization_id,
                e,
            )
            return False

    # Use standard managed storage path
    return delete_org_media(
        s3_key=s3_key,
        organization_id=organization_id,
        file_size=file_size,
        db_session=db_session,
    )


def upload_org_branding_file(
    file_bytes: bytes,
    filename: str | None,
    content_type: str,
    organization_id: str,
    file_type: str,
) -> str:
    """Upload an organization branding asset (logo or signature).

    Produces an S3 key under `orgs/{org_id}/branding/{file_type}/...` using
    the regional media bucket. Returns the s3_key (the caller stores it on
    OrganizationBranding.logo_s3_key / signature_s3_key).
    """
    if not content_type or not content_type.startswith("image/"):
        raise ValueError("Branding file must be an image")

    extension = (filename.rsplit(".", 1)[-1].lower() if filename and "." in filename else None)
    if not extension:
        extension = MIME_TO_EXT.get(content_type, "bin") if "MIME_TO_EXT" in globals() else "bin"  # noqa: F821 - guarded by the globals() check on this line

    unique_id = uuid.uuid4().hex
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d")
    s3_key = f"orgs/{organization_id}/branding/{file_type}/{timestamp}_{unique_id}.{extension}"

    region = DEFAULT_REGION
    bucket = get_media_bucket(region)
    s3_client = get_s3_client(region)
    s3_client.put_object(
        Bucket=bucket,
        Key=s3_key,
        Body=file_bytes,
        ContentType=content_type,
        CacheControl="max-age=86400",
        Tagging="FileType=branding",
    )
    logger.info(
        "Uploaded branding %s for org %s to %s/%s (%d bytes)",
        file_type, organization_id, bucket, s3_key, len(file_bytes),
    )
    return s3_key
