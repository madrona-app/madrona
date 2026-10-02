"""
IIIF Presentation API 3.0 as Primary LOD Surface.

This service generates IIIF manifests that serve as the primary Linked Open Data
interface for Madrona Collections. Unlike the basic iiif_presentation service,
this version:

1. Uses stable URIs as manifest @id (from URI persistence layer)
2. Includes complete CDWA metadata mappings with authority links
3. Links media records back to collection objects
4. Provides LOD-ready seeAlso references to JSON-LD exports
5. Guarantees ID stability across entity lifecycle

Design Principles:
- IIIF manifests ARE the LOD documents (not a separate export)
- Stable URIs never change (tombstones/redirects for deleted/merged entities)
- Authority links (Getty, Wikidata) appear as seeAlso on relevant resources
- Media maintains bidirectional links to parent objects

IIIF Presentation API 3.0: https://iiif.io/api/presentation/3.0/
"""

import os
import logging
from datetime import datetime
from typing import Any, Optional, List, Dict
from uuid import UUID

from app.models import (
    Organization,
    CollectionObject,
    Media,
    CollectionObjectMedia,
)
from app.services.iiif_image import get_iiif_image_service, IIIFImageService
from app.services.uri_persistence import (
    build_uri,
    URIPersistenceService,
    ENTITY_TYPES,
    BASE_URI,
)

logger = logging.getLogger(__name__)

# Configuration
IIIF_BASE_URL = os.environ.get('IIIF_BASE_URL', 'https://iiif.madrona.io')
PUBLIC_UI_BASE_URL = os.environ.get('PUBLIC_UI_BASE_URL', 'https://collections.madrona.io')


# ============================================================================
# CDWA → IIIF METADATA MAPPING
# ============================================================================

# CDWA categories and their IIIF metadata labels
# Reference: CDWA (Categories for the Description of Works of Art)
CDWA_METADATA_MAP = {
    # CDWA 1: Object/Work
    "object_number": ("Object Number", "Identification"),
    "object_name": ("Object Name", "Identification"),
    "object_type": ("Object/Work Type", "Classification"),
    "classifications": ("Classification", "Classification"),
    "catalog_level": ("Catalog Level", "Identification"),

    # CDWA 2: Classification
    "category": ("Category", "Classification"),
    "style_period": ("Style/Period", "Classification"),

    # CDWA 3: Titles/Names
    "titles": ("Title", "Title/Name"),

    # CDWA 4: Creation
    "creators": ("Creator", "Creation"),
    "creation_date_display": ("Date", "Creation"),
    "creation_date_earliest": ("Earliest Date", "Creation"),
    "creation_date_latest": ("Latest Date", "Creation"),
    "creation_place": ("Place of Creation", "Creation"),
    "production_note": ("Production Note", "Creation"),

    # CDWA 5: Styles/Periods/Groups/Movements
    "style_period": ("Style/Period", "Style"),

    # CDWA 6: Measurements
    "measurements": ("Dimensions", "Physical Description"),

    # CDWA 7: Materials and Techniques
    "materials": ("Materials", "Physical Description"),
    "techniques": ("Techniques", "Physical Description"),

    # CDWA 8: Inscriptions/Marks
    "inscriptions": ("Inscriptions", "Physical Description"),

    # CDWA 9: State (prints)
    "state_description": ("State", "Physical Description"),

    # CDWA 10: Edition
    "edition": ("Edition", "Physical Description"),
    "copy_number": ("Copy Number", "Physical Description"),

    # CDWA 11: Facture/Physical Description
    "physical_description": ("Physical Description", "Physical Description"),
    "color": ("Color", "Physical Description"),
    "form": ("Form", "Physical Description"),

    # CDWA 12: Orientation/Arrangement
    "orientation": ("Orientation", "Physical Description"),
    "arrangement": ("Arrangement", "Physical Description"),

    # CDWA 13: Subject Matter
    "subjects": ("Subject", "Subject Matter"),
    "content_description": ("Subject Description", "Subject Matter"),
    "depicted_people": ("Depicted Person", "Subject Matter"),
    "depicted_places": ("Depicted Place", "Subject Matter"),
    "depicted_events": ("Depicted Event", "Subject Matter"),

    # CDWA 23: Ownership/Collecting History
    "provenance": ("Provenance", "Ownership History"),
    "credit_line": ("Credit Line", "Ownership History"),
    "acquisition_method": ("Acquisition Method", "Ownership History"),
    "acquisition_date": ("Acquisition Date", "Ownership History"),

    # CDWA 24: Copyright/Restrictions (field removed; rights managed by ObjectRight model)
    # "copyright_status": ("Copyright", "Rights"),

    # CDWA 28: Related Works
    "related_objects": ("Related Works", "Related Works"),

    # CDWA 29: Current Location
    "current_location": ("Current Location", "Location"),

    # Additional procedure fields
    "distinguishing_features": ("Distinguishing Features", "Physical Description"),
    "age": ("Age", "Physical Description"),
    "department_name": ("Department", "Administration"),
}


class IIIFLODService:
    """
    IIIF Presentation API service optimized for Linked Open Data.

    This service treats IIIF manifests as the primary LOD interface:
    - Stable URIs from the URI persistence layer
    - Complete CDWA metadata with authority links
    - seeAlso links to JSON-LD export
    - Homepage links to public UI
    """

    def __init__(
        self,
        base_url: str = None,
        image_service: IIIFImageService = None,
        uri_service: URIPersistenceService = None
    ):
        self.base_url = base_url or IIIF_BASE_URL
        if not self.base_url.endswith('/'):
            self.base_url += '/'
        self.image_service = image_service or get_iiif_image_service()
        self.uri_service = uri_service

    def generate_manifest(
        self,
        obj: CollectionObject,
        media_items: List[CollectionObjectMedia],
        organization: Organization,
        org_slug: str = None,
    ) -> Dict[str, Any]:
        """
        Generate a IIIF Presentation 3.0 manifest as primary LOD document.

        The manifest @id uses the stable entity URI from the persistence layer,
        ensuring that the identifier never changes even if internal IDs change.

        Args:
            obj: CollectionObject model
            media_items: List of CollectionObjectMedia links (with media loaded)
            organization: Organization model
            org_slug: Organization URL slug (for URI building)

        Returns:
            IIIF Presentation 3.0 manifest with LOD extensions
        """
        org_slug = org_slug or organization.slug or str(organization.organization_id)[:8]

        # Build stable URI for manifest @id
        # The manifest IS the LOD representation of the object
        manifest_uri = self._get_stable_manifest_uri(obj, org_slug)

        manifest = {
            "@context": [
                "http://iiif.io/api/presentation/3/context.json",
                # Add schema.org context for enhanced metadata
                {"schema": "https://schema.org/"}
            ],
            "id": manifest_uri,
            "type": "Manifest",
            "label": self._create_language_map(self._get_display_title(obj)),

            # IIIF 3.0 metadata array with complete CDWA mapping
            "metadata": self._build_cdwa_metadata(obj, org_slug),

            # Canvases containing images
            "items": [],

            # LOD Links
            "seeAlso": self._build_see_also(obj, org_slug),
            "homepage": self._build_homepage(obj, org_slug),
        }

        # Summary from description
        if obj.brief_description:
            manifest["summary"] = self._create_language_map(obj.brief_description)

        # Rights statement (copyright fields moved to ObjectRight model)
        copyright_status = getattr(obj, 'copyright_status', None)
        if copyright_status:
            manifest["rights"] = self._get_rights_uri(copyright_status)

        # Required statement (attribution)
        if organization.name:
            manifest["requiredStatement"] = {
                "label": self._create_language_map("Attribution"),
                "value": self._create_language_map(
                    f"Provided by {organization.name}"
                )
            }

        # Provider (organization as LOD resource)
        manifest["provider"] = [self._build_provider(organization, org_slug)]

        # Thumbnail from primary image
        primary_media = self._get_primary_media(media_items)
        if primary_media and primary_media.media:
            manifest["thumbnail"] = [self._create_thumbnail(primary_media.media)]

        # Create canvases for each image
        for idx, link in enumerate(media_items):
            if link.media and link.media.media_type == 'image':
                canvas = self._create_canvas(
                    link.media,
                    idx + 1,
                    link.caption_override,
                    obj,
                    org_slug
                )
                manifest["items"].append(canvas)

        # NavDate for sorting in collections
        if obj.creation_date_earliest:
            manifest["navDate"] = obj.creation_date_earliest.isoformat()

        return manifest

    def generate_collection_manifest(
        self,
        collection_id: str,
        objects: List[CollectionObject],
        label: str,
        description: str = None,
        organization: Organization = None,
        org_slug: str = None,
    ) -> Dict[str, Any]:
        """
        Generate a IIIF Collection manifest for a group of objects.

        Args:
            collection_id: Unique identifier for the collection
            objects: List of CollectionObject models
            label: Collection label/title
            description: Optional description
            organization: Organization model
            org_slug: Organization URL slug

        Returns:
            IIIF Presentation 3.0 collection manifest
        """
        org_slug = org_slug or (organization.slug if organization else 'default')

        collection = {
            "@context": "http://iiif.io/api/presentation/3/context.json",
            "id": f"{self.base_url}org/{org_slug}/collection/{collection_id}",
            "type": "Collection",
            "label": self._create_language_map(label),
            "items": [],
        }

        if description:
            collection["summary"] = self._create_language_map(description)

        if organization:
            collection["provider"] = [self._build_provider(organization, org_slug)]

        # Add references to object manifests with stable URIs
        for obj in objects:
            manifest_uri = self._get_stable_manifest_uri(obj, org_slug)
            collection["items"].append({
                "id": manifest_uri,
                "type": "Manifest",
                "label": self._create_language_map(self._get_display_title(obj)),
            })

        return collection

    # ========================================================================
    # STABLE URI GENERATION
    # ========================================================================

    def _get_stable_manifest_uri(self, obj: CollectionObject, org_slug: str) -> str:
        """
        Get the stable URI for an object's manifest.

        The manifest URI is the object's stable LOD identifier.
        Uses object_number as the human-readable public ID.
        """
        # Use object_number as human-readable public ID
        public_id = self._slugify(obj.object_number)
        return f"{BASE_URI}/org/{org_slug}/object/{public_id}/manifest"

    def _get_stable_canvas_uri(
        self,
        media: Media,
        obj: CollectionObject,
        org_slug: str,
        sequence: int
    ) -> str:
        """Get stable URI for a canvas (image in context of object)."""
        obj_public_id = self._slugify(obj.object_number)
        return f"{BASE_URI}/org/{org_slug}/object/{obj_public_id}/canvas/{sequence}"

    def _get_stable_media_uri(self, media: Media, org_slug: str) -> str:
        """Get stable URI for a media item."""
        # Use first 8 chars of media_id for public ID
        public_id = str(media.media_id)[:8]
        return f"{BASE_URI}/org/{org_slug}/media/{public_id}"

    # ========================================================================
    # CDWA METADATA BUILDING
    # ========================================================================

    def _build_cdwa_metadata(
        self,
        obj: CollectionObject,
        org_slug: str
    ) -> List[Dict[str, Any]]:
        """
        Build IIIF metadata array from CDWA-aligned fields.

        Each metadata entry includes:
        - Label (CDWA-aligned display label)
        - Value (formatted field value)

        Authority-backed values include seeAlso links in the value.
        """
        metadata = []

        # Object Number (always first)
        if obj.object_number:
            metadata.append(self._metadata_entry(
                "Object Number", obj.object_number
            ))

        # Titles (CDWA 3)
        title_value = self._get_display_title(obj)
        if title_value and title_value != "Untitled":
            # Include all titles if multiple
            if obj.title_links and len(obj.title_links) > 1:
                titles_list = [t.title for t in obj.title_links if t.title]
                metadata.append(self._metadata_entry(
                    "Title", "; ".join(titles_list)
                ))

        # Object Type and Classification (CDWA 1-2)
        if obj.object_type:
            metadata.append(self._metadata_entry_with_authority(
                "Type", obj.object_type,
                self._extract_type_authority(obj)
            ))

        if hasattr(obj, 'classification_links') and obj.classification_links:
            terms = [cl.lookup_value.label for cl in obj.classification_links if cl.lookup_value and cl.lookup_value.label]
            if terms:
                metadata.append(self._metadata_entry_with_authority(
                    "Classification", "; ".join(terms), []
                ))

        # Creator/Maker (CDWA 4)
        if obj.creators:
            for creator in obj.creators:
                creator_name = creator.get("value") or creator.get("name")
                if creator_name:
                    role = creator.get("role", "creator")
                    attribution = creator.get("attribution", "")

                    # Build display value
                    display = creator_name
                    if attribution:
                        display = f"{attribution} {creator_name}"
                    if role and role != "creator":
                        display = f"{display} ({role})"

                    # Extract authority URIs
                    authorities = creator.get("authorities", [])
                    if not authorities and creator.get("ulan_id"):
                        authorities = [{
                            "uri": f"http://vocab.getty.edu/ulan/{creator['ulan_id']}",
                            "source": "ULAN"
                        }]

                    metadata.append(self._metadata_entry_with_authority(
                        "Creator", display, authorities
                    ))

        # Date (CDWA 4)
        if obj.creation_date_display:
            metadata.append(self._metadata_entry(
                "Date", obj.creation_date_display
            ))
        elif obj.creation_date_earliest:
            date_str = str(obj.creation_date_earliest.year)
            if obj.creation_date_latest and obj.creation_date_latest != obj.creation_date_earliest:
                date_str = f"{obj.creation_date_earliest.year}-{obj.creation_date_latest.year}"
            metadata.append(self._metadata_entry("Date", date_str))

        # Place of Creation (CDWA 4)
        if obj.creation_place:
            authorities = []
            if obj.creation_place_details:
                tgn_id = obj.creation_place_details.get("tgn_id")
                if tgn_id:
                    authorities = [{
                        "uri": f"http://vocab.getty.edu/tgn/{tgn_id}",
                        "source": "TGN"
                    }]
            metadata.append(self._metadata_entry_with_authority(
                "Place of Creation", obj.creation_place, authorities
            ))

        # Materials (CDWA 7)
        if obj.materials:
            materials = []
            all_authorities = []
            for mat in obj.materials:
                term = mat.get("value") or mat.get("term") or mat.get("name")
                if term:
                    materials.append(term)
                    # Collect authorities
                    if mat.get("authorities"):
                        all_authorities.extend(mat["authorities"])
                    elif mat.get("aat_id"):
                        all_authorities.append({
                            "uri": f"http://vocab.getty.edu/aat/{mat['aat_id']}",
                            "source": "AAT"
                        })
            if materials:
                metadata.append(self._metadata_entry_with_authority(
                    "Materials", "; ".join(materials), all_authorities
                ))

        # Techniques (CDWA 7)
        if obj.techniques:
            techniques = []
            all_authorities = []
            for tech in obj.techniques:
                term = tech.get("value") or tech.get("term") or tech.get("name")
                if term:
                    techniques.append(term)
                    if tech.get("authorities"):
                        all_authorities.extend(tech["authorities"])
                    elif tech.get("aat_id"):
                        all_authorities.append({
                            "uri": f"http://vocab.getty.edu/aat/{tech['aat_id']}",
                            "source": "AAT"
                        })
            if techniques:
                metadata.append(self._metadata_entry_with_authority(
                    "Techniques", "; ".join(techniques), all_authorities
                ))

        # Dimensions (CDWA 6)
        dimensions = self._format_dimensions(obj)
        if dimensions:
            metadata.append(self._metadata_entry("Dimensions", dimensions))

        # Physical Description (CDWA 11)
        if obj.physical_description:
            metadata.append(self._metadata_entry(
                "Physical Description", obj.physical_description
            ))

        # Inscriptions (CDWA 8)
        if obj.inscription_links:
            inscriptions_text = self._format_inscriptions(obj.inscription_links)
            if inscriptions_text:
                metadata.append(self._metadata_entry(
                    "Inscriptions", inscriptions_text
                ))

        # Edition (CDWA 10)
        if obj.edition:
            edition_text = obj.edition
            if obj.copy_number:
                edition_text = f"{edition_text}, {obj.copy_number}"
            if obj.edition_size:
                edition_text = f"{edition_text} (edition of {obj.edition_size})"
            metadata.append(self._metadata_entry("Edition", edition_text))

        # State (CDWA 9)
        if obj.state_description:
            state_text = obj.state_description
            if obj.state_number and obj.total_states:
                state_text = f"State {obj.state_number}/{obj.total_states}: {state_text}"
            metadata.append(self._metadata_entry("State", state_text))

        # Style/Period (CDWA 5)
        if obj.style_period:
            metadata.append(self._metadata_entry("Style/Period", obj.style_period))

        # Subject (CDWA 13)
        if obj.subjects:
            subjects = [s for s in obj.subjects if isinstance(s, str)]
            if subjects:
                metadata.append(self._metadata_entry(
                    "Subject", "; ".join(subjects)
                ))

        # Depicted People (CDWA 13)
        if obj.depicted_people:
            people = []
            for person in obj.depicted_people:
                name = person.get("name") or person.get("value")
                if name:
                    people.append(name)
            if people:
                metadata.append(self._metadata_entry(
                    "Depicted Person", "; ".join(people)
                ))

        # Provenance (CDWA 23)
        if obj.provenance:
            # Truncate if very long
            prov = obj.provenance
            if len(prov) > 500:
                prov = prov[:497] + "..."
            metadata.append(self._metadata_entry("Provenance", prov))

        # Credit Line (CDWA 23)
        if obj.credit_line:
            metadata.append(self._metadata_entry("Credit Line", obj.credit_line))

        # Current Location (CDWA 29)
        if obj.current_location:
            metadata.append(self._metadata_entry(
                "Current Location", obj.current_location
            ))

        # Department
        if obj.department_id and hasattr(obj, 'department') and obj.department:
            metadata.append(self._metadata_entry(
                "Department", obj.department.name
            ))

        return metadata

    def _metadata_entry(self, label: str, value: str) -> Dict[str, Any]:
        """Create a simple IIIF metadata entry."""
        return {
            "label": self._create_language_map(label),
            "value": self._create_language_map(str(value))
        }

    def _metadata_entry_with_authority(
        self,
        label: str,
        value: str,
        authorities: List[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Create a IIIF metadata entry with authority links.

        Authority URIs are included in the value as linked text.
        IIIF viewers that support HTML can render these as links.
        """
        entry = {
            "label": self._create_language_map(label),
            "value": self._create_language_map(str(value))
        }

        # Add seeAlso for authority references
        if authorities:
            # Filter valid URIs
            valid_auths = [a for a in authorities if a.get("uri")]
            if valid_auths:
                # Store as custom extension for LOD-aware clients
                entry["seeAlso"] = [
                    {
                        "id": auth["uri"],
                        "type": "Dataset",
                        "label": self._create_language_map(
                            auth.get("source", "Authority Record")
                        ),
                        "format": "application/ld+json"
                    }
                    for auth in valid_auths
                ]

        return entry

    # ========================================================================
    # SEE ALSO AND HOMEPAGE
    # ========================================================================

    def _build_see_also(
        self,
        obj: CollectionObject,
        org_slug: str
    ) -> List[Dict[str, Any]]:
        """
        Build seeAlso references to related LOD resources.

        Links to:
        - JSON-LD export of the object
        - Schema.org representation
        """
        public_id = self._slugify(obj.object_number)

        see_also = [
            # JSON-LD export
            {
                "id": f"{BASE_URI}/org/{org_slug}/object/{public_id}.jsonld",
                "type": "Dataset",
                "label": self._create_language_map("JSON-LD (Schema.org)"),
                "format": "application/ld+json",
                "profile": "https://schema.org/"
            },
            # Stable object URI (dereferenceable)
            {
                "id": build_uri(org_slug, "collection_object", public_id),
                "type": "Dataset",
                "label": self._create_language_map("Linked Data URI"),
                "format": "application/ld+json"
            }
        ]

        return see_also

    def _build_homepage(
        self,
        obj: CollectionObject,
        org_slug: str
    ) -> List[Dict[str, Any]]:
        """Build homepage references to human-readable pages."""
        return [
            {
                "id": f"{PUBLIC_UI_BASE_URL}/org/{org_slug}/objects/{obj.object_id}",
                "type": "Text",
                "label": self._create_language_map("View in Collection"),
                "format": "text/html",
                "language": ["en"]
            }
        ]

    def _build_provider(
        self,
        organization: Organization,
        org_slug: str
    ) -> Dict[str, Any]:
        """Build provider (organization) as LOD resource."""
        provider = {
            "id": f"{BASE_URI}/org/{org_slug}",
            "type": "Agent",
            "label": self._create_language_map(organization.name or org_slug),
        }

        # Add homepage if organization has website
        website = getattr(organization, 'website', None)
        if website:
            provider["homepage"] = [{
                "id": website,
                "type": "Text",
                "format": "text/html"
            }]

        # Add logo if available
        logo = getattr(organization, 'logo_url', None)
        if logo:
            provider["logo"] = [{
                "id": logo,
                "type": "Image",
                "format": "image/png"
            }]

        return provider

    # ========================================================================
    # CANVAS CREATION
    # ========================================================================

    def _create_canvas(
        self,
        media: Media,
        sequence: int,
        caption: str = None,
        obj: CollectionObject = None,
        org_slug: str = None,
    ) -> Dict[str, Any]:
        """
        Create a IIIF Canvas for a media item.

        Canvas includes:
        - Stable URI as @id
        - Image annotation with IIIF Image service
        - Link back to parent object via partOf
        """
        # Build stable canvas URI
        if obj and org_slug:
            canvas_id = self._get_stable_canvas_uri(media, obj, org_slug, sequence)
        else:
            canvas_id = f"{self.base_url}canvas/{media.media_id}"

        # Use actual dimensions or defaults
        width = media.width or 1000
        height = media.height or 1000

        canvas = {
            "id": canvas_id,
            "type": "Canvas",
            "label": self._create_language_map(
                caption or media.title or f"Image {sequence}"
            ),
            "width": width,
            "height": height,
            "items": [
                {
                    "id": f"{canvas_id}/page",
                    "type": "AnnotationPage",
                    "items": [
                        self._create_image_annotation(media, canvas_id, width, height)
                    ],
                }
            ],
        }

        # Add thumbnail
        canvas["thumbnail"] = [self._create_thumbnail(media)]

        # Add metadata about the media itself
        canvas["metadata"] = self._build_media_metadata(media)

        # Link back to parent object
        if obj and org_slug:
            manifest_uri = self._get_stable_manifest_uri(obj, org_slug)
            canvas["partOf"] = [{
                "id": manifest_uri,
                "type": "Manifest"
            }]

        # Add seeAlso to media's own LOD representation
        if org_slug:
            media_uri = self._get_stable_media_uri(media, org_slug)
            canvas["seeAlso"] = [{
                "id": media_uri,
                "type": "Dataset",
                "format": "application/ld+json"
            }]

        return canvas

    def _create_image_annotation(
        self,
        media: Media,
        canvas_id: str,
        width: int,
        height: int,
    ) -> Dict[str, Any]:
        """Create an image annotation for a canvas."""
        annotation_id = f"{canvas_id}/annotation"

        # Get IIIF image info URL
        if self.image_service and self.image_service.is_available():
            image_service_id = self.image_service.get_info_url(media).replace('/info.json', '')
            image_body = {
                "id": f"{image_service_id}/full/max/0/default.jpg",
                "type": "Image",
                "format": "image/jpeg",
                "width": width,
                "height": height,
                "service": [
                    {
                        "id": image_service_id,
                        "type": "ImageService3",
                        "profile": "level2",
                    }
                ],
            }
        else:
            # Fallback to static image
            image_body = {
                "id": f"{self.base_url}media/{media.media_id}/full.jpg",
                "type": "Image",
                "format": media.mime_type or "image/jpeg",
                "width": width,
                "height": height,
            }

        return {
            "id": annotation_id,
            "type": "Annotation",
            "motivation": "painting",
            "body": image_body,
            "target": canvas_id,
        }

    def _build_media_metadata(self, media: Media) -> List[Dict[str, Any]]:
        """Build metadata for a media item."""
        metadata = []

        if media.title:
            metadata.append(self._metadata_entry("Title", media.title))

        if media.description:
            metadata.append(self._metadata_entry("Description", media.description))

        if media.original_filename:
            metadata.append(self._metadata_entry("Filename", media.original_filename))

        if media.width and media.height:
            metadata.append(self._metadata_entry(
                "Image Size", f"{media.width} x {media.height} pixels"
            ))

        if media.file_size:
            size_mb = media.file_size / (1024 * 1024)
            metadata.append(self._metadata_entry(
                "File Size", f"{size_mb:.2f} MB"
            ))

        # Photography date if available
        photo_date = getattr(media, 'date_taken', None)
        if photo_date:
            metadata.append(self._metadata_entry("Date Taken", str(photo_date)))

        # Photographer/Creator
        photographer = getattr(media, 'photographer', None)
        if photographer:
            metadata.append(self._metadata_entry("Photographer", photographer))

        return metadata

    def _create_thumbnail(self, media: Media) -> Dict[str, Any]:
        """Create a thumbnail object."""
        if self.image_service and self.image_service.is_available():
            thumbnail_url = self.image_service.get_thumbnail_url(media, width=200)
        else:
            thumbnail_url = f"{self.base_url}media/{media.media_id}/thumbnail.jpg"

        width = 200
        height = 200 if not media.width else int(200 * (media.height or 1) / (media.width or 1))

        return {
            "id": thumbnail_url,
            "type": "Image",
            "format": "image/jpeg",
            "width": width,
            "height": height,
        }

    # ========================================================================
    # HELPER METHODS
    # ========================================================================

    @staticmethod
    def _get_display_title(obj: CollectionObject) -> str:
        """Get the preferred display title from the object's title_links."""
        if obj.title_links:
            preferred = next((t for t in obj.title_links if t.is_preferred), None)
            if preferred:
                return preferred.title or "Untitled"
            if obj.title_links:
                return obj.title_links[0].title or "Untitled"
        return obj.object_name or "Untitled"

    @staticmethod
    def _get_primary_media(
        media_items: List[CollectionObjectMedia]
    ) -> Optional[CollectionObjectMedia]:
        """Get the primary media item."""
        return next(
            (m for m in media_items if m.is_primary and m.media),
            media_items[0] if media_items else None
        )

    @staticmethod
    def _create_language_map(text: str, lang: str = "en") -> Dict[str, List[str]]:
        """Create a IIIF language map from a string."""
        return {lang: [text]}

    @staticmethod
    def _slugify(text: str) -> str:
        """Convert text to a URL-safe slug."""
        import re
        import unicodedata

        # Normalize unicode
        text = unicodedata.normalize('NFKD', str(text))
        text = text.encode('ascii', 'ignore').decode('ascii')

        # Lowercase
        text = text.lower()

        # Replace separators with hyphens
        text = re.sub(r'[./\\]', '-', text)

        # Remove non-alphanumeric (except hyphens)
        text = re.sub(r'[^a-z0-9-]', '', text)

        # Collapse multiple hyphens
        text = re.sub(r'-+', '-', text)

        # Strip leading/trailing hyphens
        text = text.strip('-')

        return text or 'object'

    def _format_dimensions(self, obj: CollectionObject) -> Optional[str]:
        """Format dimensions from measurements field."""
        measurements = getattr(obj, 'measurements', None)
        if not measurements:
            return None

        if isinstance(measurements, list):
            # Handle array of measurements
            parts = []
            for m in measurements:
                if isinstance(m, dict):
                    dim_type = m.get('type', '')
                    value = m.get('value')
                    unit = m.get('unit', 'cm')
                    if value:
                        parts.append(f"{dim_type}: {value} {unit}")
            return "; ".join(parts) if parts else None

        if isinstance(measurements, dict):
            parts = []
            unit = measurements.get('unit', 'cm')
            for key in ['height', 'width', 'depth', 'diameter', 'weight']:
                value = measurements.get(key)
                if value:
                    parts.append(f"{key}: {value} {unit}")
            return ", ".join(parts) if parts else None

        return None

    def _format_inscriptions(self, inscription_links) -> Optional[str]:
        """Format inscription_links as text."""
        if not inscription_links:
            return None

        parts = []
        for insc in inscription_links:
            text = insc.content
            if text:
                insc_type = insc.inscription_type or ''
                location = insc.location_on_object or ''

                display = text
                if insc_type:
                    display = f"[{insc_type}] {display}"
                if location:
                    display = f"{display} ({location})"

                parts.append(display)

        return "; ".join(parts) if parts else None

    def _extract_type_authority(self, obj: CollectionObject) -> List[Dict[str, str]]:
        """Extract authority URIs for object type."""
        # Object type might have AAT reference
        # This would typically come from a vocabulary lookup
        return []

    def _extract_classification_authorities(
        self,
        classifications: List[Dict]
    ) -> List[Dict[str, str]]:
        """Extract authority URIs from classifications."""
        authorities = []
        for c in classifications:
            if c.get("authorities"):
                authorities.extend(c["authorities"])
            elif c.get("aat_id"):
                authorities.append({
                    "uri": f"http://vocab.getty.edu/aat/{c['aat_id']}",
                    "source": "AAT"
                })
        return authorities

    def _get_rights_uri(self, copyright_status: str) -> str:
        """Get a rights URI from copyright status."""
        rights_map = {
            'public_domain': 'https://creativecommons.org/publicdomain/mark/1.0/',
            'cc0': 'https://creativecommons.org/publicdomain/zero/1.0/',
            'cc_by': 'https://creativecommons.org/licenses/by/4.0/',
            'cc_by_sa': 'https://creativecommons.org/licenses/by-sa/4.0/',
            'cc_by_nc': 'https://creativecommons.org/licenses/by-nc/4.0/',
            'cc_by_nc_sa': 'https://creativecommons.org/licenses/by-nc-sa/4.0/',
            'cc_by_nc_nd': 'https://creativecommons.org/licenses/by-nc-nd/4.0/',
            'in_copyright': 'https://rightsstatements.org/vocab/InC/1.0/',
            'rights_reserved': 'https://rightsstatements.org/vocab/InC/1.0/',
            'copyright_undetermined': 'https://rightsstatements.org/vocab/UND/1.0/',
            'orphan_work': 'https://rightsstatements.org/vocab/InC-OW-EU/1.0/',
            'no_known_copyright': 'https://rightsstatements.org/vocab/NKC/1.0/',
        }
        return rights_map.get(copyright_status, 'https://rightsstatements.org/vocab/CNE/1.0/')


# ============================================================================
# MODULE-LEVEL SINGLETON
# ============================================================================

_iiif_lod_service: Optional[IIIFLODService] = None


def get_iiif_lod_service() -> IIIFLODService:
    """Get or create the IIIF LOD service singleton."""
    global _iiif_lod_service
    if _iiif_lod_service is None:
        _iiif_lod_service = IIIFLODService()
    return _iiif_lod_service
