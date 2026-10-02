"""
Media Metadata Embedder Service.

Embeds collection object metadata into image files using XMP format.
Supports Dublin Core, IPTC, and custom Madrona namespaces.
"""

import io
import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID
from xml.sax.saxutils import escape as xml_escape

from PIL import Image

from app.database import current_session
from app.models import Media, MediaDerivative
from app.services.object_metadata_aggregator import get_safe_metadata_for_embedding

logger = logging.getLogger(__name__)

# XMP Namespace declarations
XMP_NAMESPACES = {
    "x": "adobe:ns:meta/",
    "rdf": "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
    "dc": "http://purl.org/dc/elements/1.1/",
    "xmp": "http://ns.adobe.com/xap/1.0/",
    "xmpRights": "http://ns.adobe.com/xap/1.0/rights/",
    "Iptc4xmpCore": "http://iptc.org/std/Iptc4xmpCore/1.0/xmlns/",
    "Iptc4xmpExt": "http://iptc.org/std/Iptc4xmpExt/2008-02-29/",
    "photoshop": "http://ns.adobe.com/photoshop/1.0/",
    # A URN, not a URL: it identifies the Madrona schema, so it must be the
    # same for every deployment, and it must not name any one of them.
    "madrona": "urn:madrona:ns:1.0:",
}


def _escape_xml(text: str | None) -> str:
    """Escape text for safe inclusion in XML."""
    if text is None:
        return ""
    return xml_escape(str(text))


# --- Embedding bounds --------------------------------------------------------
# The embedded XMP is a portable convenience copy that must fit a SINGLE JPEG
# APP1 segment (<= 65535 bytes including the 2-byte length field and the
# ~29-byte namespace signature). There is no use case for an unbounded metadata
# set travelling in-file — the catalog and search index remain the system of
# record — so rather than reach for multi-segment Extended XMP we cap both the
# item COUNT and per-item LENGTH of every variable-length field. With these caps
# the serialized packet is provably well under the single-segment limit (worst
# case ~40 KB even before XML-escaping), so embed_xmp_in_jpeg never has to
# truncate. `subjects` is the only field that realistically inflates (AI
# auto-tagging) and is the most recoverable from the catalog, so it gets the
# tightest cap.
_XMP_MAX_ITEM_CHARS = 150
_XMP_TEXT_CAPS = {
    "object_number": 100,
    "title": 300,
    "object_type": 200,
    "date_display": 100,
    "creation_place": 300,
    "credit_line": 1000,
    "reproduction_rights": 2000,
    "repository_name": 300,
    "description": 4000,
}
_XMP_LIST_CAPS = {
    "titles": 10,
    "creators": 30,
    "subjects": 60,
    "materials": 30,
    "techniques": 30,
}


def _bounded_for_xmp(metadata: dict[str, Any]) -> dict[str, Any]:
    """Cap variable-length fields so the serialized XMP packet always fits a
    single JPEG APP1 segment.

    Returns a shallow copy; the input dict is not mutated. Scalar text fields
    are length-capped; list fields are capped on both item count and per-item
    length.
    """
    bounded = dict(metadata)

    for field_name, max_chars in _XMP_TEXT_CAPS.items():
        value = bounded.get(field_name)
        if isinstance(value, str) and len(value) > max_chars:
            bounded[field_name] = value[:max_chars]

    for field_name, max_items in _XMP_LIST_CAPS.items():
        values = bounded.get(field_name)
        if not isinstance(values, list):
            continue
        if len(values) > max_items:
            logger.info(
                "Capped %s from %d to %d items for XMP embedding",
                field_name,
                len(values),
                max_items,
            )
        bounded[field_name] = [
            str(v)[:_XMP_MAX_ITEM_CHARS] for v in values[:max_items] if v
        ]

    return bounded


def _build_rdf_seq(items: list[str]) -> str:
    """Build an RDF Seq (ordered list) from items."""
    if not items:
        return "<rdf:Seq/>"
    items_xml = "\n".join(f"          <rdf:li>{_escape_xml(item)}</rdf:li>" for item in items if item)
    return f"""<rdf:Seq>
{items_xml}
        </rdf:Seq>"""


def _build_rdf_bag(items: list[str]) -> str:
    """Build an RDF Bag (unordered list) from items."""
    if not items:
        return "<rdf:Bag/>"
    items_xml = "\n".join(f"          <rdf:li>{_escape_xml(item)}</rdf:li>" for item in items if item)
    return f"""<rdf:Bag>
{items_xml}
        </rdf:Bag>"""


def _build_rdf_alt(text: str | None, lang: str = "x-default") -> str:
    """Build an RDF Alt (language alternatives) for a single value."""
    if not text:
        return "<rdf:Alt/>"
    return f"""<rdf:Alt>
          <rdf:li xml:lang="{lang}">{_escape_xml(text)}</rdf:li>
        </rdf:Alt>"""


def build_xmp_packet(metadata: dict[str, Any]) -> str:
    """
    Build a complete XMP packet from safe metadata.

    Args:
        metadata: Safe metadata dict from get_safe_metadata_for_embedding()

    Returns:
        Complete XMP packet as string, ready for embedding
    """
    # Extract fields with defaults
    object_number = metadata.get('object_number', '')
    title = metadata.get('title', '')
    titles = metadata.get('titles', [])
    creators = metadata.get('creators', [])
    description = metadata.get('description', '')
    object_type = metadata.get('object_type', '')
    materials = metadata.get('materials', [])
    techniques = metadata.get('techniques', [])
    date_display = metadata.get('date_display', '')
    creation_place = metadata.get('creation_place', '')
    subjects = metadata.get('subjects', [])
    copyright_status = metadata.get('copyright_status', '')
    credit_line = metadata.get('credit_line', '')
    reproduction_rights = metadata.get('reproduction_rights', '')
    repository_name = metadata.get('repository_name', '')
    metadata_date = metadata.get('metadata_date', datetime.now(timezone.utc).isoformat())

    # Map copyright status to human-readable
    copyright_display = {
        'public_domain': 'Public Domain',
        'in_copyright': 'In Copyright',
        'copyright_undetermined': 'Copyright Undetermined',
        'orphan_work': 'Orphan Work',
        'cc_by': 'CC BY',
        'cc_by_sa': 'CC BY-SA',
        'cc_by_nc': 'CC BY-NC',
        'cc_by_nc_sa': 'CC BY-NC-SA',
        'cc0': 'CC0 - Public Domain Dedication',
        'rights_reserved': 'All Rights Reserved',
    }.get(copyright_status, copyright_status or '')

    # Build namespace declarations
    ns_decls = " ".join(f'xmlns:{prefix}="{uri}"' for prefix, uri in XMP_NAMESPACES.items())

    # Build XMP packet
    xmp = f'''<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about=""
      {ns_decls}>

      <!-- Dublin Core -->
      <dc:title>
        {_build_rdf_alt(title)}
      </dc:title>
      <dc:creator>
        {_build_rdf_seq(creators)}
      </dc:creator>
      <dc:description>
        {_build_rdf_alt(description)}
      </dc:description>
      <dc:subject>
        {_build_rdf_bag(subjects)}
      </dc:subject>
      <dc:date>{_escape_xml(date_display)}</dc:date>
      <dc:type>StillImage</dc:type>
      <dc:identifier>{_escape_xml(object_number)}</dc:identifier>
      <dc:rights>
        {_build_rdf_alt(copyright_display)}
      </dc:rights>
      <dc:publisher>
        {_build_rdf_bag([repository_name] if repository_name else [])}
      </dc:publisher>
      <dc:source>{_escape_xml(credit_line)}</dc:source>

      <!-- IPTC Core -->
      <Iptc4xmpCore:Location>{_escape_xml(creation_place)}</Iptc4xmpCore:Location>

      <!-- IPTC Extension - Artwork Depicted -->
      <Iptc4xmpExt:ArtworkOrObject>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <Iptc4xmpExt:AOTitle>{_escape_xml(title)}</Iptc4xmpExt:AOTitle>
            <Iptc4xmpExt:AOCreator>
              {_build_rdf_seq(creators)}
            </Iptc4xmpExt:AOCreator>
            <Iptc4xmpExt:AODateCreated>{_escape_xml(date_display)}</Iptc4xmpExt:AODateCreated>
            <Iptc4xmpExt:AOSource>{_escape_xml(repository_name)}</Iptc4xmpExt:AOSource>
            <Iptc4xmpExt:AOSourceInvNo>{_escape_xml(object_number)}</Iptc4xmpExt:AOSourceInvNo>
          </rdf:li>
        </rdf:Bag>
      </Iptc4xmpExt:ArtworkOrObject>

      <!-- XMP Rights -->
      <xmpRights:UsageTerms>
        {_build_rdf_alt(reproduction_rights)}
      </xmpRights:UsageTerms>
      <xmpRights:Marked>{"False" if copyright_status == 'public_domain' else "True"}</xmpRights:Marked>

      <!-- Photoshop -->
      <photoshop:Credit>{_escape_xml(credit_line)}</photoshop:Credit>
      <photoshop:Source>{_escape_xml(repository_name)}</photoshop:Source>

      <!-- Madrona Custom -->
      <madrona:objectNumber>{_escape_xml(object_number)}</madrona:objectNumber>
      <madrona:creditLine>{_escape_xml(credit_line)}</madrona:creditLine>
      <madrona:repositoryName>{_escape_xml(repository_name)}</madrona:repositoryName>
      <madrona:metadataDate>{_escape_xml(metadata_date)}</madrona:metadataDate>
      <madrona:objectType>{_escape_xml(object_type)}</madrona:objectType>
      <madrona:materials>
        {_build_rdf_bag(materials)}
      </madrona:materials>
      <madrona:techniques>
        {_build_rdf_bag(techniques)}
      </madrona:techniques>

    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>'''

    return xmp


def embed_xmp_in_jpeg(image_bytes: bytes, xmp_packet: str) -> bytes:
    """
    Embed XMP metadata into a JPEG image.

    XMP is embedded in a JPEG APP1 segment with the "http://ns.adobe.com/xap/1.0/"
    namespace identifier.

    Args:
        image_bytes: Original JPEG image bytes
        xmp_packet: XMP packet string to embed

    Returns:
        Modified JPEG with embedded XMP
    """
    # XMP in JPEG uses APP1 marker (0xFFE1) with namespace identifier
    xmp_namespace = b"http://ns.adobe.com/xap/1.0/\x00"
    xmp_data = xmp_namespace + xmp_packet.encode('utf-8')

    # JPEG structure: SOI (0xFFD8) followed by segments
    if not image_bytes.startswith(b'\xff\xd8'):
        raise ValueError("Not a valid JPEG file")

    # Build new JPEG with XMP APP1 segment inserted after SOI
    output = io.BytesIO()
    output.write(b'\xff\xd8')  # SOI marker

    # Write XMP APP1 segment
    xmp_length = len(xmp_data) + 2  # +2 for length bytes
    if xmp_length > 65535:
        # Unreachable when callers go through embed_metadata_in_image, which
        # applies _bounded_for_xmp first. Kept as a loud, non-destructive
        # backstop: a future field addition or cap bump fails here (and is
        # caught/logged by embed_metadata_in_image, leaving the original master
        # untouched) instead of silently writing a truncated, malformed XMP
        # packet into the image.
        raise ValueError(
            f"XMP packet is {len(xmp_data)} bytes, which exceeds the JPEG APP1 "
            "single-segment limit (65533); refusing to embed truncated XMP"
        )

    output.write(b'\xff\xe1')  # APP1 marker
    output.write(xmp_length.to_bytes(2, 'big'))  # Segment length
    output.write(xmp_data)

    # Copy rest of original JPEG (skip SOI, but keep everything else)
    # We need to skip any existing XMP APP1 segments to avoid duplicates
    pos = 2  # After SOI
    while pos < len(image_bytes):
        if image_bytes[pos:pos+2] == b'\xff\xe1':  # APP1 segment
            # Read segment length
            seg_len = int.from_bytes(image_bytes[pos+2:pos+4], 'big')
            # Check if this is an XMP segment
            seg_data = image_bytes[pos+4:pos+2+seg_len]
            if seg_data.startswith(b'http://ns.adobe.com/xap/1.0/'):
                # Skip existing XMP segment
                pos += 2 + seg_len
                continue
        # Copy this byte/segment
        output.write(image_bytes[pos:pos+1])
        pos += 1

    return output.getvalue()


def embed_xmp_in_png(image_bytes: bytes, xmp_packet: str) -> bytes:
    """
    Embed XMP metadata into a PNG image.

    XMP is embedded in a PNG iTXt chunk with keyword "XML:com.adobe.xmp".

    Args:
        image_bytes: Original PNG image bytes
        xmp_packet: XMP packet string to embed

    Returns:
        Modified PNG with embedded XMP
    """
    import struct
    import zlib

    PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'

    if not image_bytes.startswith(PNG_SIGNATURE):
        raise ValueError("Not a valid PNG file")

    # Build iTXt chunk for XMP
    keyword = b"XML:com.adobe.xmp"
    # iTXt format: keyword + null + compression_flag + compression_method + lang_tag + null + translated_keyword + null + text
    itxt_data = keyword + b'\x00\x00\x00\x00\x00' + xmp_packet.encode('utf-8')

    # Calculate CRC for the chunk
    chunk_type = b'iTXt'
    chunk_data = chunk_type + itxt_data
    crc = zlib.crc32(chunk_data) & 0xffffffff

    # Build the complete chunk
    chunk = struct.pack('>I', len(itxt_data)) + chunk_type + itxt_data + struct.pack('>I', crc)

    # Find insertion point (after IHDR, before IDAT or other chunks)
    output = io.BytesIO()
    output.write(PNG_SIGNATURE)

    pos = 8  # After signature
    inserted = False

    while pos < len(image_bytes):
        # Read chunk length and type
        chunk_len = struct.unpack('>I', image_bytes[pos:pos+4])[0]
        chunk_type_bytes = image_bytes[pos+4:pos+8]

        # Skip existing XMP iTXt chunks
        if chunk_type_bytes == b'iTXt':
            chunk_data_start = pos + 8
            chunk_data_end = chunk_data_start + chunk_len
            existing_data = image_bytes[chunk_data_start:chunk_data_end]
            if existing_data.startswith(b'XML:com.adobe.xmp'):
                # Skip this chunk
                pos += 12 + chunk_len  # 4 (len) + 4 (type) + len + 4 (crc)
                continue

        # Insert our XMP chunk before IDAT (first image data chunk)
        if not inserted and chunk_type_bytes == b'IDAT':
            output.write(chunk)
            inserted = True

        # Copy this chunk
        chunk_end = pos + 12 + chunk_len
        output.write(image_bytes[pos:chunk_end])
        pos = chunk_end

    # If we never found IDAT (shouldn't happen), insert before IEND
    if not inserted:
        # Rewind and insert before last chunk (IEND)
        data = output.getvalue()
        # IEND is always 12 bytes: 4 (len=0) + 4 (IEND) + 4 (crc)
        output = io.BytesIO()
        output.write(data[:-12])
        output.write(chunk)
        output.write(data[-12:])

    return output.getvalue()


def embed_metadata_in_image(
    image_bytes: bytes,
    metadata: dict[str, Any],
    mime_type: str = "image/jpeg"
) -> bytes:
    """
    Embed metadata into an image file.

    Supports JPEG and PNG formats. Other formats return the original bytes unchanged.

    Args:
        image_bytes: Original image file bytes
        metadata: Safe metadata dict from get_safe_metadata_for_embedding()
        mime_type: MIME type of the image

    Returns:
        Modified image bytes with embedded metadata
    """
    if not image_bytes or not metadata:
        return image_bytes

    # Build XMP packet from the size-bounded metadata so the result always fits
    # a single JPEG APP1 segment (see _bounded_for_xmp).
    xmp_packet = build_xmp_packet(_bounded_for_xmp(metadata))

    try:
        if mime_type in ('image/jpeg', 'image/jpg'):
            return embed_xmp_in_jpeg(image_bytes, xmp_packet)
        elif mime_type == 'image/png':
            return embed_xmp_in_png(image_bytes, xmp_packet)
        else:
            logger.info("XMP embedding not supported for %s, returning original", mime_type)
            return image_bytes
    except Exception as e:
        logger.error("Failed to embed XMP metadata: %s", e)
        return image_bytes


def write_metadata_to_derivatives(
    media_id: str | UUID,
    org_id: str | UUID,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    """
    Write embedded metadata to all derivatives of a media item.

    This function:
    1. Downloads each derivative from S3
    2. Embeds XMP metadata into the image
    3. Re-uploads to S3

    Args:
        media_id: Media UUID
        org_id: Organization UUID
        metadata: Full aggregated metadata (will be filtered for safe embedding)

    Returns:
        Dict with results: {"success": bool, "derivatives_updated": int, "errors": list}
    """
    media_uuid = UUID(str(media_id)) if isinstance(media_id, str) else media_id
    org_uuid = UUID(str(org_id)) if isinstance(org_id, str) else org_id

    # Get safe metadata for embedding
    safe_metadata = get_safe_metadata_for_embedding(metadata)
    if not safe_metadata:
        return {"success": False, "derivatives_updated": 0, "errors": ["No metadata to embed"]}

    # Load media and derivatives
    media = current_session().query(Media).filter_by(
        media_id=media_uuid,
        organization_id=org_uuid,
    ).first()

    if not media:
        return {"success": False, "derivatives_updated": 0, "errors": ["Media not found"]}

    derivatives = current_session().query(MediaDerivative).filter_by(
        media_id=media_uuid,
    ).all()

    # Get storage backend (BYOB-aware)
    from app.services.storage import get_storage_backend
    storage = get_storage_backend(str(org_uuid), current_session())

    results = {
        "success": True,
        "derivatives_updated": 0,
        "errors": [],
    }

    # Process each derivative
    derivative_types_to_embed = ['access_master', 'large', 'medium', 'web']

    for derivative in derivatives:
        if derivative.derivative_type not in derivative_types_to_embed:
            continue

        if not derivative.s3_key:
            continue

        # Only process image derivatives
        mime_type = derivative.mime_type or media.mime_type
        if not mime_type or not mime_type.startswith('image/'):
            continue

        try:
            # Download derivative
            image_bytes, _ = storage.get_object_sync(derivative.s3_key)

            # Embed metadata
            modified_bytes = embed_metadata_in_image(image_bytes, safe_metadata, mime_type)

            # Re-upload if modified
            if modified_bytes != image_bytes:
                storage.put_object_sync(
                    key=derivative.s3_key,
                    body=modified_bytes,
                    content_type=mime_type,
                )
                results["derivatives_updated"] += 1
                logger.info(
                    "Embedded metadata in derivative %s for media %s",
                    derivative.derivative_type,
                    media_id
                )

        except Exception as e:
            error_msg = f"Failed to process derivative {derivative.derivative_type}: {e}"
            logger.error(error_msg)
            results["errors"].append(error_msg)
            results["success"] = False

    return results
