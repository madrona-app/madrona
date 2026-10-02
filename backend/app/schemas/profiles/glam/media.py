"""
Media Profile

Profile for digital media assets in GLAM contexts.
Media records represent images, videos, audio files, and documents
associated with collection items and other records.
"""

from ..base import (
    Profile,
    PropertySchema,
    PropertyType,
    RelationshipSchema,
    ValidationRule,
    ValidationSeverity,
)
from ..registry import register_profile


def _validate_dimensions(record: dict) -> tuple[bool, str]:
    """Validate that image dimensions are positive if provided."""
    props = record.get("properties", {})
    width = props.get("width")
    height = props.get("height")

    if width is not None and width <= 0:
        return False, f"Width must be positive, got {width}"
    if height is not None and height <= 0:
        return False, f"Height must be positive, got {height}"

    return True, ""


MEDIA_PROFILE = Profile(
    name="media",
    version="1.0.0",
    description="Digital media assets including images, video, audio, and documents",
    canonical_type="MEDIA",

    required_properties=[
        "title",
        "media_type",
    ],

    recommended_properties=[
        "url",
        "mime_type",
        "description",
        "file_size",
        "width",
        "height",
    ],

    optional_properties=[
        "alt_text",
        "caption",
        "credit_line",
        "rights_statement",
        "license",
        "date_created",
        "date_digitized",
        "duration",
        "format",
        "resolution",
        "color_space",
        "bit_depth",
        "checksum",
        "original_filename",
        "storage_location",
        "thumbnail_url",
        "preview_url",
        "download_url",
        "is_primary",
        "sequence_number",
        "notes",
    ],

    property_schemas={
        "title": PropertySchema(
            type=PropertyType.STRING,
            description="Title or name of the media asset",
            min_length=1,
            max_length=500,
            ui_label="Title",
            example="Starry Night - High Resolution",
        ),
        "media_type": PropertySchema(
            type=PropertyType.STRING,
            description="Type of media",
            allowed_values=["image", "video", "audio", "document", "3d_model", "other"],
            ui_label="Media Type",
            example="image",
        ),
        "url": PropertySchema(
            type=PropertyType.URL,
            description="Primary URL to access the media",
            ui_label="URL",
        ),
        "mime_type": PropertySchema(
            type=PropertyType.STRING,
            description="MIME type of the file",
            ui_label="MIME Type",
            example="image/jpeg",
        ),
        "description": PropertySchema(
            type=PropertyType.STRING,
            description="Description of the media content",
            max_length=5000,
            ui_label="Description",
        ),
        "alt_text": PropertySchema(
            type=PropertyType.STRING,
            description="Alternative text for accessibility",
            max_length=1000,
            ui_label="Alt Text",
        ),
        "caption": PropertySchema(
            type=PropertyType.STRING,
            description="Display caption",
            max_length=2000,
            ui_label="Caption",
        ),
        "credit_line": PropertySchema(
            type=PropertyType.STRING,
            description="Attribution or credit line",
            ui_label="Credit Line",
            example="Photo: John Smith, 2023",
        ),
        "rights_statement": PropertySchema(
            type=PropertyType.STRING,
            description="Rights or copyright statement",
            ui_label="Rights Statement",
        ),
        "license": PropertySchema(
            type=PropertyType.STRING,
            description="License type (e.g., CC BY 4.0, Public Domain)",
            ui_label="License",
            example="CC BY 4.0",
        ),
        "file_size": PropertySchema(
            type=PropertyType.INTEGER,
            description="File size in bytes",
            min_value=0,
            ui_label="File Size",
        ),
        "width": PropertySchema(
            type=PropertyType.INTEGER,
            description="Width in pixels (for images/video)",
            min_value=1,
            ui_label="Width",
            example=4000,
        ),
        "height": PropertySchema(
            type=PropertyType.INTEGER,
            description="Height in pixels (for images/video)",
            min_value=1,
            ui_label="Height",
            example=3000,
        ),
        "duration": PropertySchema(
            type=PropertyType.FLOAT,
            description="Duration in seconds (for audio/video)",
            min_value=0,
            ui_label="Duration",
        ),
        "format": PropertySchema(
            type=PropertyType.STRING,
            description="File format",
            ui_label="Format",
            example="JPEG",
        ),
        "resolution": PropertySchema(
            type=PropertyType.STRING,
            description="Resolution (e.g., '300 dpi', '4K')",
            ui_label="Resolution",
        ),
        "color_space": PropertySchema(
            type=PropertyType.STRING,
            description="Color space (e.g., sRGB, Adobe RGB)",
            ui_label="Color Space",
            example="sRGB",
        ),
        "bit_depth": PropertySchema(
            type=PropertyType.INTEGER,
            description="Bit depth (e.g., 8, 16, 24)",
            ui_label="Bit Depth",
        ),
        "checksum": PropertySchema(
            type=PropertyType.STRING,
            description="File checksum for integrity verification",
            ui_label="Checksum",
        ),
        "original_filename": PropertySchema(
            type=PropertyType.STRING,
            description="Original filename when uploaded",
            ui_label="Original Filename",
        ),
        "storage_location": PropertySchema(
            type=PropertyType.STRING,
            description="Internal storage path or identifier",
            ui_label="Storage Location",
        ),
        "thumbnail_url": PropertySchema(
            type=PropertyType.URL,
            description="URL to thumbnail version",
            ui_label="Thumbnail URL",
        ),
        "preview_url": PropertySchema(
            type=PropertyType.URL,
            description="URL to preview/medium version",
            ui_label="Preview URL",
        ),
        "download_url": PropertySchema(
            type=PropertyType.URL,
            description="URL for downloading the original file",
            ui_label="Download URL",
        ),
        "date_created": PropertySchema(
            type=PropertyType.DATE,
            description="Date the original media was created",
            ui_label="Date Created",
        ),
        "date_digitized": PropertySchema(
            type=PropertyType.DATE,
            description="Date the media was digitized",
            ui_label="Date Digitized",
        ),
        "is_primary": PropertySchema(
            type=PropertyType.BOOLEAN,
            description="Whether this is the primary media for the related item",
            ui_label="Is Primary",
            example=True,
        ),
        "sequence_number": PropertySchema(
            type=PropertyType.INTEGER,
            description="Order in a sequence of related media",
            min_value=0,
            ui_label="Sequence Number",
        ),
        "notes": PropertySchema(
            type=PropertyType.STRING,
            description="Additional notes",
            ui_label="Notes",
        ),
    },

    relationships=[
        RelationshipSchema(
            relationship_type="depicts",
            target_profile="collections",
            description="Collection item this media depicts",
        ),
        RelationshipSchema(
            relationship_type="documents",
            target_profile="collections",
            description="Collection item this media documents",
        ),
        RelationshipSchema(
            relationship_type="creator",
            target_profile="agent",
            description="Creator of the media (photographer, videographer, etc.)",
        ),
        RelationshipSchema(
            relationship_type="rights_holder",
            target_profile="agent",
            description="Entity holding rights to this media",
        ),
        RelationshipSchema(
            relationship_type="location",
            target_profile="place",
            description="Place where the media was created/captured",
        ),
        RelationshipSchema(
            relationship_type="derived_from",
            target_profile="media",
            description="Source media this was derived from",
        ),
        RelationshipSchema(
            relationship_type="variant_of",
            target_profile="media",
            description="Related media variants (different sizes, formats)",
        ),
    ],

    validation_rules=[
        ValidationRule(
            name="positive_dimensions",
            description="Image dimensions must be positive",
            check=_validate_dimensions,
            severity=ValidationSeverity.ERROR,
        ),
    ],
)

# Register on import
register_profile(MEDIA_PROFILE)
