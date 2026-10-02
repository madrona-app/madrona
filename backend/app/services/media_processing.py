"""
Media processing service for derivative generation and metadata extraction.

Architecture Overview:
======================

ARCHIVAL MASTER (Original File):
- The original uploaded file is ALWAYS preserved without modification
- Stored at: orgs/{org_id}/media/{folder}/{timestamp}_{uuid}.{ext}
- Referenced by Media.s3_key in the database
- This follows FADGI guidelines for archival master preservation
- Never processed, compressed, or modified after upload

DERIVATIVES (Access Copies):
- Generated FROM the archival master for web display and access
- Stored at: orgs/{org_id}/media/derivatives/{media_id}/{type}.{format}
- Multiple sizes and formats for different use cases
- Can be regenerated at any time from the archival master

Derivative Hierarchy (based on IIIF Image API and FADGI standards):
- ACCESS_MASTER (4000px): High-quality for downloads, IIIF deep zoom source
- LARGE (2000px): Lightbox / full-screen viewing
- MEDIUM (1200px): Standard web display
- SMALL (600px): Grid views, cards
- THUMBNAIL (200px): Lists, navigation
- SQUARE_THUMB (200x200): Avatar/icon displays (center crop)

Format Support:
- JPEG: Universal compatibility, progressive encoding
- WebP: Modern browsers, 30-50% smaller than JPEG
- PNG: Lossless, for graphics with transparency
- AVIF: Next-gen format, 50-70% smaller (limited support)

References:
- IIIF Image API 3.0: https://iiif.io/api/image/3.0/
- FADGI Guidelines: https://www.digitizationguidelines.gov/
- FADGI Archival Master: https://www.digitizationguidelines.gov/term.php?term=archivalmasterfile

This service handles:
- Generating image derivatives at multiple sizes
- Extracting EXIF/IPTC/XMP metadata from images
- Computing SHA-256 checksums for integrity verification
- Uploading derivatives to S3 with appropriate caching headers

Uses Pillow (PIL) for image processing.
"""
import hashlib
import io
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import Enum
from typing import Any, BinaryIO

from PIL import Image, ExifTags
from PIL.ExifTags import TAGS, GPSTAGS

from app.services.uploads import (
    get_media_bucket,
    get_s3_client,
    get_org_storage_region,
    DEFAULT_REGION,
)
from app.services.storage import get_storage_backend

logger = logging.getLogger(__name__)


class DerivativeType(str, Enum):
    """
    Types of derivatives that can be generated.

    Based on IIIF Image API recommendations and FADGI Technical Guidelines
    for Digitizing Cultural Heritage Materials (3rd Edition).

    The ORIGINAL file (archival master) is always preserved separately
    and is NOT a derivative - it's stored in Media.s3_key.

    Derivative hierarchy:
    - ACCESS_MASTER: High-res for downloads and IIIF deep zoom (3000-4000px)
    - LARGE: Full-screen / lightbox viewing (2000px)
    - MEDIUM: Standard web display (1200px)
    - SMALL: Grid views and cards (600px)
    - THUMBNAIL: Navigation and lists (200px)
    - SQUARE_THUMB: Avatar/icon displays (200x200 center crop)
    - POSTER: Video first frame (800px)

    References:
    - IIIF: https://iiif.io/api/image/3.0/
    - FADGI: https://www.digitizationguidelines.gov/guidelines/digitize-technical.html
    - Sanity IIIF sizes: 50, 200, 600, 1200, 2000px
    """
    # Standard derivatives (maintain aspect ratio)
    ACCESS_MASTER = 'access_master'  # 4000px - high-quality downloads, IIIF source
    LARGE = 'large'                  # 2000px - lightbox/full-screen
    MEDIUM = 'medium'                # 1200px - standard web display
    SMALL = 'small'                  # 600px - grid views, cards
    THUMBNAIL = 'thumbnail'          # 200px - lists, navigation

    # Special derivatives
    SQUARE_THUMB = 'square_thumb'    # 200x200 center crop - avatars, icons
    POSTER = 'poster'                # 800px - video first frame

    # 3D Model derivatives
    MODEL_THUMBNAIL = 'model_thumbnail'  # 200px - rendered preview of 3D model
    MODEL_PREVIEW = 'model_preview'      # 600px - larger rendered preview of 3D model

    # Legacy aliases (for backwards compatibility)
    PREVIEW = 'preview'              # Alias for SMALL (600px)
    WEB = 'web'                      # Alias for MEDIUM (1200px)


class DerivativeFormat(str, Enum):
    """
    Output formats for derivatives.

    JPEG: Universal compatibility, good compression
    WEBP: Modern format, 30-50% smaller than JPEG at same quality
    PNG: Lossless, for graphics/transparency
    AVIF: Next-gen format, 50-70% smaller, limited browser support
    """
    JPEG = 'jpeg'
    WEBP = 'webp'
    PNG = 'png'
    AVIF = 'avif'


# Derivative size configurations (max dimension in pixels)
# Based on IIIF recommended sizes and FADGI guidelines
DERIVATIVE_SIZES = {
    DerivativeType.ACCESS_MASTER: 4000,  # Production master for high-quality use
    DerivativeType.LARGE: 2000,          # Lightbox / full-screen
    DerivativeType.MEDIUM: 1200,         # Standard web display
    DerivativeType.SMALL: 600,           # Grid views, cards
    DerivativeType.THUMBNAIL: 200,       # Lists, navigation
    DerivativeType.SQUARE_THUMB: 200,    # Square crop for avatars
    DerivativeType.POSTER: 800,          # Video poster frame
    # 3D Model derivatives
    DerivativeType.MODEL_THUMBNAIL: 200, # Rendered 3D model preview
    DerivativeType.MODEL_PREVIEW: 600,   # Larger rendered 3D model preview
    # Legacy aliases
    DerivativeType.PREVIEW: 600,         # Maps to SMALL
    DerivativeType.WEB: 1200,            # Maps to MEDIUM
}

# Default quality settings per format
QUALITY_SETTINGS = {
    DerivativeFormat.JPEG: 85,
    DerivativeFormat.WEBP: 82,   # WebP is more efficient, slightly lower quality = same visual
    DerivativeFormat.PNG: None,  # PNG is lossless
    DerivativeFormat.AVIF: 75,   # AVIF is very efficient
}

# Higher quality for access master (used for downloads)
ACCESS_MASTER_QUALITY = {
    DerivativeFormat.JPEG: 92,
    DerivativeFormat.WEBP: 90,
    DerivativeFormat.PNG: None,
    DerivativeFormat.AVIF: 85,
}

# Standard derivative set for image processing
# These are generated by default for all uploaded images
STANDARD_DERIVATIVES = [
    DerivativeType.ACCESS_MASTER,
    DerivativeType.LARGE,
    DerivativeType.MEDIUM,
    DerivativeType.SMALL,
    DerivativeType.THUMBNAIL,
    DerivativeType.SQUARE_THUMB,
]

# Minimal derivative set (for faster processing or storage constraints)
MINIMAL_DERIVATIVES = [
    DerivativeType.MEDIUM,
    DerivativeType.THUMBNAIL,
]


@dataclass
class DerivativeResult:
    """Result of generating a derivative."""
    derivative_type: str
    format: str
    s3_key: str
    width: int
    height: int
    file_size: int
    quality: int | None


@dataclass
class MetadataExtractionResult:
    """Result of extracting metadata from an image."""
    technical_metadata: dict[str, Any]
    iptc_metadata: dict[str, Any]
    xmp_metadata: dict[str, Any]
    dublin_core: dict[str, Any]
    width: int
    height: int


def compute_checksum(file_data: bytes) -> str:
    """Compute SHA-256 checksum of file data."""
    return hashlib.sha256(file_data).hexdigest()


def generate_derivative_s3_key(
    organization_id: str,
    media_id: str,
    derivative_type: DerivativeType,
    format: DerivativeFormat,
) -> str:
    """Generate S3 key for a derivative file."""
    return f"orgs/{organization_id}/media/derivatives/{media_id}/{derivative_type.value}.{format.value}"


def resize_image(
    image: Image.Image,
    max_dimension: int,
    maintain_aspect: bool = True,
) -> Image.Image:
    """
    Resize an image to fit within a maximum dimension.

    Args:
        image: PIL Image to resize
        max_dimension: Maximum width or height
        maintain_aspect: Whether to maintain aspect ratio

    Returns:
        Resized PIL Image
    """
    width, height = image.size

    if width <= max_dimension and height <= max_dimension:
        # Image is already smaller than target
        return image.copy()

    if maintain_aspect:
        # Calculate new dimensions maintaining aspect ratio
        if width > height:
            new_width = max_dimension
            new_height = int(height * (max_dimension / width))
        else:
            new_height = max_dimension
            new_width = int(width * (max_dimension / height))
    else:
        new_width = new_height = max_dimension

    # Use high-quality LANCZOS resampling
    return image.resize((new_width, new_height), Image.Resampling.LANCZOS)


def create_square_crop(
    image: Image.Image,
    size: int,
) -> Image.Image:
    """
    Create a square center crop of the image.

    This is useful for avatar/icon displays where a consistent
    square aspect ratio is needed.

    Args:
        image: PIL Image to crop
        size: Target size (both width and height)

    Returns:
        Square cropped and resized PIL Image
    """
    width, height = image.size

    # Determine crop box (center crop)
    if width > height:
        # Landscape: crop sides
        left = (width - height) // 2
        top = 0
        right = left + height
        bottom = height
    elif height > width:
        # Portrait: crop top/bottom
        left = 0
        top = (height - width) // 2
        right = width
        bottom = top + width
    else:
        # Already square
        left, top, right, bottom = 0, 0, width, height

    # Crop to square
    cropped = image.crop((left, top, right, bottom))

    # Resize to target size
    if cropped.width != size:
        cropped = cropped.resize((size, size), Image.Resampling.LANCZOS)

    return cropped


def convert_to_rgb(image: Image.Image) -> Image.Image:
    """Convert image to RGB mode for JPEG/WebP output."""
    if image.mode == 'RGBA':
        # Create white background for transparent images
        background = Image.new('RGB', image.size, (255, 255, 255))
        background.paste(image, mask=image.split()[3])
        return background
    elif image.mode != 'RGB':
        return image.convert('RGB')
    return image


def generate_derivative(
    image: Image.Image,
    derivative_type: DerivativeType,
    format: DerivativeFormat = DerivativeFormat.JPEG,
    quality: int | None = None,
) -> tuple[bytes, int, int]:
    """
    Generate a derivative of the given image.

    Args:
        image: PIL Image to process
        derivative_type: Type of derivative to generate
        format: Output format
        quality: Quality setting (optional, uses defaults based on derivative type)

    Returns:
        Tuple of (image_bytes, width, height)
    """
    max_dimension = DERIVATIVE_SIZES[derivative_type]

    # Handle square thumbnail specially (center crop)
    if derivative_type == DerivativeType.SQUARE_THUMB:
        resized = create_square_crop(image, max_dimension)
    else:
        resized = resize_image(image, max_dimension)

    # Convert to RGB for JPEG/WebP/AVIF
    if format in (DerivativeFormat.JPEG, DerivativeFormat.WEBP, DerivativeFormat.AVIF):
        resized = convert_to_rgb(resized)

    # Use provided quality, or access master quality, or default
    if quality is None:
        if derivative_type == DerivativeType.ACCESS_MASTER:
            quality = ACCESS_MASTER_QUALITY.get(format)
        else:
            quality = QUALITY_SETTINGS.get(format)

    # Save to bytes buffer
    buffer = io.BytesIO()
    save_kwargs = {'format': format.value.upper()}

    if quality is not None:
        save_kwargs['quality'] = quality

    if format == DerivativeFormat.JPEG:
        save_kwargs['optimize'] = True
        save_kwargs['progressive'] = True
    elif format == DerivativeFormat.WEBP:
        save_kwargs['method'] = 4  # Balanced quality/speed
    elif format == DerivativeFormat.PNG:
        save_kwargs['optimize'] = True
    elif format == DerivativeFormat.AVIF:
        # Pillow uses pillow-avif-plugin or built-in support
        save_kwargs['speed'] = 6  # Balanced encoding speed

    resized.save(buffer, **save_kwargs)

    return buffer.getvalue(), resized.width, resized.height


def generate_all_derivatives(
    image_data: bytes,
    organization_id: str,
    media_id: str,
    formats: list[DerivativeFormat] | None = None,
    derivative_types: list[DerivativeType] | None = None,
    db_session=None,
    include_webp: bool = True,
    specs: list | None = None,
) -> list[DerivativeResult]:
    """
    Generate derivatives for an image following IIIF/FADGI standards.

    IMPORTANT: The original uploaded file (archival master) is preserved
    separately in Media.s3_key. This function only generates derivatives
    for web display and access - it never modifies the original.

    Derivative Hierarchy (based on IIIF and FADGI guidelines):
    - ACCESS_MASTER (4000px): High-quality downloads, IIIF deep zoom source
    - LARGE (2000px): Lightbox / full-screen viewing
    - MEDIUM (1200px): Standard web display
    - SMALL (600px): Grid views, cards
    - THUMBNAIL (200px): Lists, navigation
    - SQUARE_THUMB (200x200): Avatar/icon displays (center crop)

    Args:
        image_data: Raw image bytes (the archival master data)
        organization_id: Organization ID
        media_id: Media ID
        formats: Output formats to generate (default: JPEG + WebP)
        derivative_types: Which derivatives to generate (default: STANDARD_DERIVATIVES)
        db_session: SQLAlchemy session for region lookup
        include_webp: Whether to include WebP format (default: True)

    Returns:
        List of DerivativeResult objects

    References:
        - IIIF Image API 3.0: https://iiif.io/api/image/3.0/
        - FADGI Technical Guidelines: https://www.digitizationguidelines.gov/
        - Archival master definition: https://www.digitizationguidelines.gov/term.php?term=archivalmasterfile
    """
    # Default formats: JPEG for compatibility, WebP for modern browsers
    if formats is None:
        formats = [DerivativeFormat.JPEG]
        if include_webp:
            formats.append(DerivativeFormat.WEBP)

    # Default to standard derivative set
    if derivative_types is None:
        derivative_types = STANDARD_DERIVATIVES

    results = []

    try:
        # Open image from bytes
        image = Image.open(io.BytesIO(image_data))
        original_width, original_height = image.size

        # Get storage backend for this organization (BYOB-aware)
        if db_session:
            storage = get_storage_backend(organization_id, db_session)
        else:
            # Fallback to managed storage for the default region
            from app.services.storage import get_managed_storage_backend
            storage = get_managed_storage_backend(DEFAULT_REGION)

        # ── Spec-based path (database-driven) ──────────────────────
        if specs:
            for spec in specs:
                try:
                    max_dim = max(spec.max_width or 0, spec.max_height or 0)
                    if not max_dim:
                        continue

                    # Skip if original is smaller than the target
                    if spec.name == 'access_master':
                        if original_width <= max_dim and original_height <= max_dim:
                            logger.info("Skipping %s for media %s: original smaller than %dpx", spec.name, media_id, max_dim)
                            continue

                    # Resolve format enum
                    try:
                        fmt = DerivativeFormat(spec.format)
                    except ValueError:
                        logger.warning("Unsupported image format %s for spec %s, skipping", spec.format, spec.name)
                        continue

                    # Square crop for square_thumb
                    if spec.name == 'square_thumb':
                        resized = create_square_crop(image, max_dim)
                    else:
                        resized = resize_image(image, max_dim)

                    # RGB conversion for lossy formats
                    if fmt in (DerivativeFormat.JPEG, DerivativeFormat.WEBP, DerivativeFormat.AVIF):
                        resized = convert_to_rgb(resized)

                    # Quality from spec, or fallback to defaults
                    quality = spec.quality
                    if quality is None:
                        quality = QUALITY_SETTINGS.get(fmt)

                    # Save
                    buffer = io.BytesIO()
                    save_kwargs: dict[str, Any] = {'format': fmt.value.upper()}
                    if quality is not None:
                        save_kwargs['quality'] = quality
                    if fmt == DerivativeFormat.JPEG:
                        save_kwargs['optimize'] = True
                        save_kwargs['progressive'] = True
                    elif fmt == DerivativeFormat.WEBP:
                        save_kwargs['method'] = 4
                    elif fmt == DerivativeFormat.PNG:
                        save_kwargs['optimize'] = True
                    elif fmt == DerivativeFormat.AVIF:
                        save_kwargs['speed'] = 6
                    resized.save(buffer, **save_kwargs)
                    derivative_bytes = buffer.getvalue()

                    # S3 key
                    s3_key = f"orgs/{organization_id}/media/derivatives/{media_id}/{spec.name}.{fmt.value}"

                    content_type = f"image/{fmt.value}"
                    storage.put_object_sync(
                        key=s3_key,
                        body=derivative_bytes,
                        content_type=content_type,
                        cache_control='max-age=31536000',
                        tags={'FileType': 'derivative'},
                    )

                    results.append(DerivativeResult(
                        derivative_type=spec.name,
                        format=fmt.value,
                        s3_key=s3_key,
                        width=resized.width,
                        height=resized.height,
                        file_size=len(derivative_bytes),
                        quality=quality,
                    ))

                    logger.info(
                        "Generated %s.%s derivative for media %s: %dx%d, %d bytes",
                        spec.name, fmt.value, media_id, resized.width, resized.height, len(derivative_bytes)
                    )
                except Exception as e:
                    logger.error("Failed to generate %s derivative for media %s: %s", spec.name, media_id, e)
                    continue

            logger.info("Generated %d derivatives for media %s (spec-based, original: %dx%d)",
                        len(results), media_id, original_width, original_height)
            return results

        # ── Legacy path (hardcoded constants) ─────────────────────
        for derivative_type in derivative_types:
            # Skip access master if original is smaller than threshold
            max_dimension = DERIVATIVE_SIZES[derivative_type]
            if derivative_type == DerivativeType.ACCESS_MASTER:
                if original_width <= max_dimension and original_height <= max_dimension:
                    logger.info(
                        "Skipping ACCESS_MASTER for media %s: original (%dx%d) smaller than %dpx",
                        media_id, original_width, original_height, max_dimension
                    )
                    continue

            for format in formats:
                try:
                    # Generate derivative
                    derivative_bytes, width, height = generate_derivative(
                        image, derivative_type, format
                    )

                    # Generate S3 key
                    s3_key = generate_derivative_s3_key(
                        organization_id, media_id, derivative_type, format
                    )

                    # Upload to storage backend (BYOB-aware)
                    content_type = f"image/{format.value}"
                    storage.put_object_sync(
                        key=s3_key,
                        body=derivative_bytes,
                        content_type=content_type,
                        cache_control='max-age=31536000',  # 1 year cache
                        tags={'FileType': 'derivative'},  # Tag for lifecycle policy targeting
                    )

                    # Get actual quality used
                    if derivative_type == DerivativeType.ACCESS_MASTER:
                        quality = ACCESS_MASTER_QUALITY.get(format)
                    else:
                        quality = QUALITY_SETTINGS.get(format)

                    results.append(DerivativeResult(
                        derivative_type=derivative_type.value,
                        format=format.value,
                        s3_key=s3_key,
                        width=width,
                        height=height,
                        file_size=len(derivative_bytes),
                        quality=quality,
                    ))

                    logger.info(
                        "Generated %s.%s derivative for media %s: %dx%d, %d bytes",
                        derivative_type.value, format.value, media_id, width, height, len(derivative_bytes)
                    )

                except Exception as e:
                    logger.error(
                        "Failed to generate %s/%s derivative for media %s: %s",
                        derivative_type.value, format.value, media_id, e
                    )
                    continue

        logger.info(
            "Generated %d derivatives for media %s (original: %dx%d)",
            len(results), media_id, original_width, original_height
        )

        return results

    except Exception as e:
        logger.error("Failed to process image for media %s: %s", media_id, e)
        raise


def extract_exif_metadata(image: Image.Image) -> dict[str, Any]:
    """Extract EXIF metadata from an image."""
    exif_data = {}

    try:
        exif = image._getexif()
        if exif is None:
            return exif_data

        for tag_id, value in exif.items():
            tag = TAGS.get(tag_id, tag_id)

            # Handle bytes
            if isinstance(value, bytes):
                try:
                    value = value.decode('utf-8', errors='ignore')
                except (UnicodeDecodeError, AttributeError):
                    continue

            # Handle special cases
            if tag == 'GPSInfo':
                gps_data = {}
                for gps_tag_id, gps_value in value.items():
                    gps_tag = GPSTAGS.get(gps_tag_id, gps_tag_id)
                    gps_data[gps_tag] = str(gps_value)
                exif_data['gps'] = gps_data
            else:
                # Convert to string for JSON serialization
                exif_data[tag] = str(value) if not isinstance(value, (str, int, float)) else value

    except Exception as e:
        logger.warning("Failed to extract EXIF data: %s", e)

    return exif_data


def extract_metadata(image_data: bytes) -> MetadataExtractionResult:
    """
    Extract all available metadata from an image.

    Args:
        image_data: Raw image bytes

    Returns:
        MetadataExtractionResult with extracted metadata
    """
    image = Image.open(io.BytesIO(image_data))
    width, height = image.size

    # Extract EXIF (technical metadata)
    exif_raw = extract_exif_metadata(image)

    # Build structured technical metadata
    technical_metadata = {
        'format': image.format,
        'mode': image.mode,
        'width': width,
        'height': height,
    }

    # Detect pyramidal TIFF — lets IIIF serve deep zoom from the original.
    # A pyramidal TIFF is tiled (TileWidth tag 322 present) AND multi-resolution
    # (SubIFDs tag 330 present, or multiple pages).
    if image.format == 'TIFF':
        try:
            tags = getattr(image, 'tag_v2', {}) or {}
            is_tiled = 322 in tags
            has_sub_ifds = 330 in tags
            is_multipage = getattr(image, 'n_frames', 1) > 1
            technical_metadata['is_pyramidal_tiff'] = (
                is_tiled and (has_sub_ifds or is_multipage)
            )
        except Exception as e:
            logger.debug("Pyramidal TIFF detection failed: %s", e)

    # Map common EXIF fields
    exif_mappings = {
        'Make': 'camera_make',
        'Model': 'camera_model',
        'DateTime': 'date_time',
        'DateTimeOriginal': 'date_time_original',
        'ExposureTime': 'exposure_time',
        'FNumber': 'f_number',
        'ISOSpeedRatings': 'iso',
        'FocalLength': 'focal_length',
        'Flash': 'flash',
        'Orientation': 'orientation',
        'Software': 'software',
        'Artist': 'artist',
        'Copyright': 'copyright',
    }

    for exif_key, tech_key in exif_mappings.items():
        if exif_key in exif_raw:
            technical_metadata[tech_key] = exif_raw[exif_key]

    # Extract GPS coordinates if available
    if 'gps' in exif_raw:
        gps = exif_raw['gps']
        technical_metadata['gps'] = gps

    # IPTC metadata (Pillow can extract some via info)
    iptc_metadata = {}
    try:
        # IPTC data may be in image.info
        if hasattr(image, 'info') and 'iptc' in image.info:
            iptc_metadata = image.info['iptc']
    except Exception as e:
        logger.debug("No IPTC data found: %s", e)

    # XMP metadata
    xmp_metadata = {}
    try:
        if hasattr(image, 'info') and 'xmp' in image.info:
            xmp_metadata = {'raw': image.info['xmp'].decode('utf-8', errors='ignore')}
    except Exception as e:
        logger.debug("No XMP data found: %s", e)

    # Build Dublin Core from available metadata
    dublin_core = {}

    if 'Artist' in exif_raw:
        dublin_core['dc_creator'] = exif_raw['Artist']
    if 'Copyright' in exif_raw:
        dublin_core['dc_rights'] = exif_raw['Copyright']
    if 'ImageDescription' in exif_raw:
        dublin_core['dc_description'] = exif_raw['ImageDescription']
    if 'DateTimeOriginal' in exif_raw:
        dublin_core['dc_date'] = exif_raw['DateTimeOriginal']

    dublin_core['dc_format'] = f"image/{image.format.lower()}" if image.format else None
    dublin_core['dc_type'] = 'StillImage'

    return MetadataExtractionResult(
        technical_metadata=technical_metadata,
        iptc_metadata=iptc_metadata,
        xmp_metadata=xmp_metadata,
        dublin_core=dublin_core,
        width=width,
        height=height,
    )


def process_image_upload(
    image_data: bytes,
    organization_id: str,
    media_id: str,
    db_session=None,
    generate_webp: bool = True,
    derivative_set: str = 'standard',
) -> dict[str, Any]:
    """
    Process an uploaded image: extract metadata and generate derivatives.

    This is the main entry point for image processing. The original uploaded
    file (archival master) is already stored separately in S3 before this
    function is called - this function only generates derivatives for web
    display and access.

    Archival Master Preservation:
    - The original file uploaded by the user is NEVER modified
    - It is stored at: orgs/{org_id}/media/{folder}/{timestamp}_{uuid}.{ext}
    - This preserves the exact bits uploaded for long-term archival
    - All derivatives are generated FROM this original but stored separately

    Derivative Generation (based on IIIF/FADGI standards):
    - ACCESS_MASTER (4000px): High-quality for downloads/IIIF
    - LARGE (2000px): Lightbox viewing
    - MEDIUM (1200px): Standard web display
    - SMALL (600px): Grid views
    - THUMBNAIL (200px): Navigation/lists
    - SQUARE_THUMB (200x200): Avatar/icon displays

    Args:
        image_data: Raw image bytes (the archival master)
        organization_id: Organization ID
        media_id: Media ID
        db_session: SQLAlchemy session
        generate_webp: Whether to generate WebP derivatives (default: True)
        derivative_set: Which derivative set to use: 'standard' or 'minimal'

    Returns:
        Dict with metadata and derivative results
    """
    # Compute checksum of original (archival master)
    checksum = compute_checksum(image_data)

    # Extract metadata from original
    metadata = extract_metadata(image_data)

    # Try database-driven config first, fall back to hardcoded
    db_specs = None
    if db_session:
        from app.services.derivative_config import get_derivative_specs
        db_specs = get_derivative_specs(organization_id, 'image', db_session)

    if db_specs:
        derivatives = generate_all_derivatives(
            image_data=image_data,
            organization_id=organization_id,
            media_id=media_id,
            db_session=db_session,
            specs=db_specs,
        )
    else:
        # Legacy fallback
        if derivative_set == 'minimal':
            derivative_types = MINIMAL_DERIVATIVES
        else:
            derivative_types = STANDARD_DERIVATIVES

        derivatives = generate_all_derivatives(
            image_data=image_data,
            organization_id=organization_id,
            media_id=media_id,
            derivative_types=derivative_types,
            db_session=db_session,
            include_webp=generate_webp,
        )

    return {
        'checksum_sha256': checksum,
        'width': metadata.width,
        'height': metadata.height,
        'technical_metadata': metadata.technical_metadata,
        'iptc_metadata': metadata.iptc_metadata,
        'xmp_metadata': metadata.xmp_metadata,
        'dublin_core': metadata.dublin_core,
        'derivatives': [
            {
                'derivative_type': d.derivative_type,
                'format': d.format,
                's3_key': d.s3_key,
                'width': d.width,
                'height': d.height,
                'file_size': d.file_size,
                'quality': d.quality,
            }
            for d in derivatives
        ],
    }


def get_derivative_url(
    s3_key: str,
    organization_id: str,
    db_session=None,
    expiry_seconds: int = 3600,
) -> str | None:
    """
    Generate a presigned URL for a derivative.

    Args:
        s3_key: S3 key of the derivative
        organization_id: Organization ID
        db_session: SQLAlchemy session
        expiry_seconds: URL expiry time

    Returns:
        Presigned URL or None
    """
    from app.services.uploads import get_presigned_url

    if db_session:
        region = get_org_storage_region(organization_id, db_session)
    else:
        region = DEFAULT_REGION

    bucket = get_media_bucket(region)
    return get_presigned_url(s3_key, expiry_seconds, bucket=bucket, region=region)


def delete_derivatives(
    organization_id: str,
    media_id: str,
    db_session=None,
) -> bool:
    """
    Delete all derivatives for a media item.

    Args:
        organization_id: Organization ID
        media_id: Media ID
        db_session: SQLAlchemy session

    Returns:
        True if successful
    """
    try:
        # Get storage backend for this organization (BYOB-aware)
        if db_session:
            storage = get_storage_backend(organization_id, db_session)
        else:
            from app.services.storage import get_managed_storage_backend
            storage = get_managed_storage_backend(DEFAULT_REGION)

        # List all derivatives for this media
        prefix = f"orgs/{organization_id}/media/derivatives/{media_id}/"

        objects, _ = storage.list_objects_sync(prefix=prefix)

        if not objects:
            return True

        # Delete all derivatives in batch
        keys_to_delete = [obj.key for obj in objects]
        failed = storage.delete_objects_sync(keys_to_delete) if hasattr(storage, 'delete_objects_sync') else []

        # Fallback to individual deletes if batch not available
        if not hasattr(storage, 'delete_objects_sync'):
            for obj in objects:
                storage.delete_object_sync(obj.key)
                logger.info("Deleted derivative: %s", obj.key)
        elif not failed:
            for key in keys_to_delete:
                logger.info("Deleted derivative: %s", key)

        return len(failed) == 0

    except Exception as e:
        logger.error("Failed to delete derivatives for media %s: %s", media_id, e)
        return False


def apply_watermark_to_image(
    image_data: bytes,
    watermark_type: str,
    config: dict[str, Any],
) -> bytes:
    """
    Apply a watermark to an image.

    Args:
        image_data: Raw image bytes
        watermark_type: 'text' or 'image'
        config: Watermark configuration containing:
            For text: text, position, opacity, font_size, color
            For image: image_data or image_s3_key, position, opacity, scale

    Returns:
        Watermarked image bytes
    """
    from PIL import ImageDraw, ImageFont, ImageEnhance

    image = Image.open(io.BytesIO(image_data))

    # Convert to RGBA for transparency support
    if image.mode != 'RGBA':
        image = image.convert('RGBA')

    # Create watermark layer
    watermark_layer = Image.new('RGBA', image.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(watermark_layer)

    # Get position
    position = config.get('position', 'bottom-right')
    opacity = config.get('opacity', 0.5)

    if watermark_type == 'text':
        text = config.get('text', '© Copyright')
        font_size = config.get('font_size', 24)
        color = config.get('color', '#ffffff')

        # Parse color (supports hex like #ffffff)
        if color.startswith('#'):
            r = int(color[1:3], 16)
            g = int(color[3:5], 16)
            b = int(color[5:7], 16)
        else:
            r, g, b = 255, 255, 255

        # Calculate alpha from opacity
        alpha = int(opacity * 255)

        # Try to load a font, fall back to default
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", font_size)
        except (OSError, IOError):
            try:
                font = ImageFont.truetype("arial.ttf", font_size)
            except (OSError, IOError):
                font = ImageFont.load_default()

        # Get text bounding box
        bbox = draw.textbbox((0, 0), text, font=font)
        text_width = bbox[2] - bbox[0]
        text_height = bbox[3] - bbox[1]

        # Calculate position
        x, y = _calculate_watermark_position(
            image.size, (text_width, text_height), position, margin=20
        )

        # Draw text
        draw.text((x, y), text, font=font, fill=(r, g, b, alpha))

    elif watermark_type == 'image':
        watermark_image_data = config.get('image_data')
        if watermark_image_data:
            # Load watermark image
            wm_image = Image.open(io.BytesIO(watermark_image_data))

            # Scale watermark
            scale = config.get('scale', 0.25)
            wm_width = int(image.width * scale)
            wm_height = int(wm_image.height * (wm_width / wm_image.width))
            wm_image = wm_image.resize((wm_width, wm_height), Image.Resampling.LANCZOS)

            # Convert to RGBA
            if wm_image.mode != 'RGBA':
                wm_image = wm_image.convert('RGBA')

            # Apply opacity
            if opacity < 1.0:
                alpha_channel = wm_image.split()[3]
                alpha_channel = alpha_channel.point(lambda p: int(p * opacity))
                wm_image.putalpha(alpha_channel)

            # Calculate position
            x, y = _calculate_watermark_position(
                image.size, wm_image.size, position, margin=20
            )

            # Paste watermark
            watermark_layer.paste(wm_image, (x, y), wm_image)

    # Composite watermark layer onto image
    result = Image.alpha_composite(image, watermark_layer)

    # Convert back to RGB if original wasn't RGBA
    result = result.convert('RGB')

    # Save to bytes
    output = io.BytesIO()
    result.save(output, format='JPEG', quality=95)
    return output.getvalue()


def _calculate_watermark_position(
    image_size: tuple[int, int],
    watermark_size: tuple[int, int],
    position: str,
    margin: int = 20,
) -> tuple[int, int]:
    """
    Calculate x, y coordinates for watermark placement.

    Args:
        image_size: (width, height) of the image
        watermark_size: (width, height) of the watermark
        position: Position string (e.g., 'bottom-right', 'center', 'top-left')
        margin: Margin from edges in pixels

    Returns:
        (x, y) coordinates for watermark placement
    """
    img_width, img_height = image_size
    wm_width, wm_height = watermark_size

    positions = {
        'top-left': (margin, margin),
        'top-center': ((img_width - wm_width) // 2, margin),
        'top-right': (img_width - wm_width - margin, margin),
        'center-left': (margin, (img_height - wm_height) // 2),
        'center': ((img_width - wm_width) // 2, (img_height - wm_height) // 2),
        'center-right': (img_width - wm_width - margin, (img_height - wm_height) // 2),
        'bottom-left': (margin, img_height - wm_height - margin),
        'bottom-center': ((img_width - wm_width) // 2, img_height - wm_height - margin),
        'bottom-right': (img_width - wm_width - margin, img_height - wm_height - margin),
    }

    return positions.get(position, positions['bottom-right'])
