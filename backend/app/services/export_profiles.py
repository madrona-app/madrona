"""
LOD Export Profiles

Configurable export profiles for different Linked Data consumers.

Design Principles:
1. EXPORT ONLY - Profiles never affect internal data storage
2. ADDITIVE - Start with base fields, profiles add/filter
3. CONSUMER-FOCUSED - Each profile optimized for specific use cases
4. CONFIGURABLE - Organizations can customize profiles

Supported Consumers:
- Research: Maximum detail, full provenance, all authority links
- Aggregator: Standardized metadata, DC/EDM compatible
- Public: Safe for display, no sensitive fields
- IIIF: Media-optimized for IIIF presentation
- Custom: Organization-defined profiles

Usage:
    from app.services.export_profiles import apply_export_profile, get_profile

    profile = get_profile("research")
    exported = apply_export_profile(collection_object, profile)
"""

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Set, Callable
from copy import deepcopy

logger = logging.getLogger(__name__)


# ============================================================================
# PROFILE TYPES AND ENUMS
# ============================================================================

class ProfileType(str, Enum):
    """Standard profile types."""
    RESEARCH = "research"           # Maximum detail for researchers
    AGGREGATOR = "aggregator"       # Standardized for harvesters (Europeana, DPLA)
    PUBLIC = "public"               # Safe for public web display
    IIIF = "iiif"                   # Optimized for IIIF manifests
    MINIMAL = "minimal"             # Bare minimum for listings
    CUSTOM = "custom"               # Organization-defined


class FieldCategory(str, Enum):
    """Categories for field grouping."""
    IDENTIFICATION = "identification"     # Object number, titles, names
    DESCRIPTION = "description"           # Descriptions, inscriptions
    CREATION = "creation"                 # Creator, date, place
    PHYSICAL = "physical"                 # Materials, techniques, dimensions
    SUBJECT = "subject"                   # Subjects, classifications
    PROVENANCE = "provenance"             # Ownership history
    RIGHTS = "rights"                     # Copyright, credit lines
    ACQUISITION = "acquisition"           # How acquired (may be sensitive)
    VALUATION = "valuation"               # Values, appraisals (sensitive)
    LOCATION = "location"                 # Current/normal location
    CONDITION = "condition"               # Condition information
    MEDIA = "media"                       # Images, documents
    RELATIONSHIPS = "relationships"       # Related objects, exhibitions
    ADMINISTRATIVE = "administrative"     # Internal notes, status
    AUTHORITY = "authority"               # Authority links (ULAN, AAT, etc.)


class AuthoritySource(str, Enum):
    """Supported authority sources."""
    ULAN = "ulan"           # Getty Union List of Artist Names
    AAT = "aat"             # Getty Art & Architecture Thesaurus
    TGN = "tgn"             # Getty Thesaurus of Geographic Names
    VIAF = "viaf"           # Virtual International Authority File
    WIKIDATA = "wikidata"   # Wikidata
    LCSH = "lcsh"           # Library of Congress Subject Headings
    ICONCLASS = "iconclass" # Iconclass
    GEONAMES = "geonames"   # GeoNames


class MediaInclusion(str, Enum):
    """How to include media in exports."""
    NONE = "none"                   # No media
    THUMBNAIL_ONLY = "thumbnail"    # Only thumbnails
    WEB_SIZE = "web"                # Web-optimized images
    FULL_SIZE = "full"              # Full resolution
    IIIF_REFS = "iiif"              # IIIF Image API references


# ============================================================================
# FIELD MAPPINGS
# ============================================================================

# Map fields to their categories
FIELD_CATEGORIES: Dict[str, FieldCategory] = {
    # Identification
    "object_id": FieldCategory.IDENTIFICATION,
    "object_number": FieldCategory.IDENTIFICATION,
    "other_numbers": FieldCategory.IDENTIFICATION,
    "accession_number": FieldCategory.IDENTIFICATION,
    "titles": FieldCategory.IDENTIFICATION,
    "object_name": FieldCategory.IDENTIFICATION,

    # Description
    "brief_description": FieldCategory.DESCRIPTION,
    "full_description": FieldCategory.DESCRIPTION,
    "inscription": FieldCategory.DESCRIPTION,
    "marks": FieldCategory.DESCRIPTION,
    "distinguishing_features": FieldCategory.DESCRIPTION,

    # Creation
    "creators": FieldCategory.CREATION,
    "creation_date_display": FieldCategory.CREATION,
    "creation_date_earliest": FieldCategory.CREATION,
    "creation_date_latest": FieldCategory.CREATION,
    "creation_place": FieldCategory.CREATION,
    "creation_place_details": FieldCategory.CREATION,
    "culture": FieldCategory.CREATION,
    "period": FieldCategory.CREATION,
    "dynasty": FieldCategory.CREATION,

    # Physical
    "materials": FieldCategory.PHYSICAL,
    "techniques": FieldCategory.PHYSICAL,
    "measurements": FieldCategory.PHYSICAL,
    "dimensions_display": FieldCategory.PHYSICAL,
    "edition": FieldCategory.PHYSICAL,
    "state": FieldCategory.PHYSICAL,

    # Subject
    "subjects": FieldCategory.SUBJECT,
    "classifications": FieldCategory.SUBJECT,
    "object_type": FieldCategory.SUBJECT,
    "style": FieldCategory.SUBJECT,
    "genre": FieldCategory.SUBJECT,

    # Provenance
    "provenance": FieldCategory.PROVENANCE,
    "provenance_structured": FieldCategory.PROVENANCE,
    "exhibition_history": FieldCategory.PROVENANCE,
    "publication_history": FieldCategory.PROVENANCE,

    # Rights
    "copyright_status": FieldCategory.RIGHTS,
    "copyright_holder": FieldCategory.RIGHTS,
    "credit_line": FieldCategory.RIGHTS,
    "rights_statement": FieldCategory.RIGHTS,
    "usage_restrictions": FieldCategory.RIGHTS,

    # Acquisition (often sensitive)
    "acquisition_method": FieldCategory.ACQUISITION,
    "acquisition_date": FieldCategory.ACQUISITION,
    "acquisition_source": FieldCategory.ACQUISITION,
    "donor_name": FieldCategory.ACQUISITION,
    "purchase_price": FieldCategory.ACQUISITION,

    # Valuation (sensitive)
    "insurance_value": FieldCategory.VALUATION,
    "market_value": FieldCategory.VALUATION,
    "appraisal_date": FieldCategory.VALUATION,
    "appraiser": FieldCategory.VALUATION,

    # Location
    "current_location": FieldCategory.LOCATION,
    "normal_location": FieldCategory.LOCATION,
    "location_details": FieldCategory.LOCATION,

    # Condition
    "condition_status": FieldCategory.CONDITION,
    "condition_date": FieldCategory.CONDITION,
    "condition_notes": FieldCategory.CONDITION,

    # Media
    "primary_image_id": FieldCategory.MEDIA,
    "media_links": FieldCategory.MEDIA,
    "thumbnail_url": FieldCategory.MEDIA,

    # Relationships
    "related_objects": FieldCategory.RELATIONSHIPS,
    "parent_object_id": FieldCategory.RELATIONSHIPS,
    "child_objects": FieldCategory.RELATIONSHIPS,
    "part_of_collection": FieldCategory.RELATIONSHIPS,

    # Administrative (internal)
    "internal_notes": FieldCategory.ADMINISTRATIVE,
    "cataloger": FieldCategory.ADMINISTRATIVE,
    "catalog_date": FieldCategory.ADMINISTRATIVE,
    "record_status": FieldCategory.ADMINISTRATIVE,
    "workflow_status": FieldCategory.ADMINISTRATIVE,
}


# ============================================================================
# EXPORT PROFILE MODEL
# ============================================================================

@dataclass
class ExportProfile:
    """
    Configuration for a LOD export profile.

    Profiles control what data is included in exports without
    affecting internal storage.
    """
    # Profile identification
    profile_id: str
    name: str
    description: str
    profile_type: ProfileType

    # Target format hints
    target_format: str = "json-ld"  # json-ld, iiif, dc, edm

    # Field inclusion rules
    included_categories: Set[FieldCategory] = field(default_factory=set)
    excluded_categories: Set[FieldCategory] = field(default_factory=set)
    included_fields: Set[str] = field(default_factory=set)
    excluded_fields: Set[str] = field(default_factory=set)

    # Authority preferences
    include_authorities: bool = True
    authority_sources: Set[AuthoritySource] = field(default_factory=set)
    require_authority_links: bool = False  # Only include values with authorities

    # Media handling
    media_inclusion: MediaInclusion = MediaInclusion.IIIF_REFS
    include_iiif_manifest: bool = True

    # Value transformations
    redact_sensitive: bool = False      # Replace sensitive values with "[redacted]"
    anonymize_donors: bool = False       # Replace donor names
    suppress_location: bool = False      # Hide exact locations

    # Metadata enrichment
    add_source_attribution: bool = True  # Add data source info
    add_license_info: bool = True        # Add license/rights info
    add_access_date: bool = False        # Add export timestamp

    # Schema.org / JSON-LD
    include_context: bool = True
    context_url: str = "https://schema.org/"
    additional_contexts: List[str] = field(default_factory=list)

    # Organization customization (stored as JSON)
    custom_field_mappings: Dict[str, str] = field(default_factory=dict)
    custom_transformations: Dict[str, Any] = field(default_factory=dict)

    def should_include_field(self, field_name: str) -> bool:
        """Determine if a field should be included in export."""
        # Explicit exclusion takes precedence
        if field_name in self.excluded_fields:
            return False

        # Explicit inclusion
        if field_name in self.included_fields:
            return True

        # Category-based rules
        category = FIELD_CATEGORIES.get(field_name)
        if category:
            if category in self.excluded_categories:
                return False
            if self.included_categories and category not in self.included_categories:
                return False

        # Default: include if no restrictions
        return True

    def should_include_authority(self, source: str) -> bool:
        """Determine if an authority source should be included."""
        if not self.include_authorities:
            return False
        if not self.authority_sources:
            return True  # Include all if not specified
        try:
            return AuthoritySource(source.lower()) in self.authority_sources
        except ValueError:
            return True  # Include unknown sources by default

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for API response."""
        return {
            "profileId": self.profile_id,
            "name": self.name,
            "description": self.description,
            "profileType": self.profile_type.value,
            "targetFormat": self.target_format,
            "includedCategories": [c.value for c in self.included_categories],
            "excludedCategories": [c.value for c in self.excluded_categories],
            "includedFields": list(self.included_fields),
            "excludedFields": list(self.excluded_fields),
            "includeAuthorities": self.include_authorities,
            "authoritySources": [s.value for s in self.authority_sources],
            "requireAuthorityLinks": self.require_authority_links,
            "mediaInclusion": self.media_inclusion.value,
            "includeIiifManifest": self.include_iiif_manifest,
            "redactSensitive": self.redact_sensitive,
            "anonymizeDonors": self.anonymize_donors,
            "suppressLocation": self.suppress_location,
            "addSourceAttribution": self.add_source_attribution,
            "addLicenseInfo": self.add_license_info,
        }


# ============================================================================
# BUILT-IN PROFILES
# ============================================================================

BUILTIN_PROFILES: Dict[str, ExportProfile] = {
    # -------------------------------------------------------------------------
    # RESEARCH PROFILE
    # Maximum detail for scholarly use
    # -------------------------------------------------------------------------
    "research": ExportProfile(
        profile_id="research",
        name="Research",
        description="Maximum detail for scholarly research. Includes all available "
                    "metadata, full provenance, structured dates, and complete "
                    "authority links.",
        profile_type=ProfileType.RESEARCH,
        target_format="json-ld",
        # Include everything except truly internal fields
        excluded_categories={FieldCategory.ADMINISTRATIVE},
        excluded_fields={"internal_notes", "workflow_status"},
        # Full authority support
        include_authorities=True,
        authority_sources=set(AuthoritySource),  # All sources
        require_authority_links=False,
        # Full media
        media_inclusion=MediaInclusion.IIIF_REFS,
        include_iiif_manifest=True,
        # No redaction for research
        redact_sensitive=False,
        anonymize_donors=False,
        suppress_location=False,
        # Rich metadata
        add_source_attribution=True,
        add_license_info=True,
        add_access_date=True,
        # JSON-LD context
        include_context=True,
        context_url="https://schema.org/",
        additional_contexts=[
            "http://www.cidoc-crm.org/cidoc-crm/",
        ],
    ),

    # -------------------------------------------------------------------------
    # AGGREGATOR PROFILE
    # Standardized for Europeana, DPLA, etc.
    # -------------------------------------------------------------------------
    "aggregator": ExportProfile(
        profile_id="aggregator",
        name="Aggregator",
        description="Standardized metadata for cultural heritage aggregators "
                    "(Europeana, DPLA). Dublin Core compatible with clear "
                    "rights information.",
        profile_type=ProfileType.AGGREGATOR,
        target_format="edm",  # Europeana Data Model
        # Core descriptive fields only
        included_categories={
            FieldCategory.IDENTIFICATION,
            FieldCategory.DESCRIPTION,
            FieldCategory.CREATION,
            FieldCategory.PHYSICAL,
            FieldCategory.SUBJECT,
            FieldCategory.RIGHTS,
            FieldCategory.MEDIA,
        },
        excluded_fields={
            "other_numbers",
            "internal_notes",
            "workflow_status",
            "purchase_price",
            "insurance_value",
        },
        # Authority links are important for aggregators
        include_authorities=True,
        authority_sources={
            AuthoritySource.AAT,
            AuthoritySource.ULAN,
            AuthoritySource.TGN,
            AuthoritySource.VIAF,
            AuthoritySource.WIKIDATA,
        },
        require_authority_links=False,
        # Web-sized images with IIIF
        media_inclusion=MediaInclusion.IIIF_REFS,
        include_iiif_manifest=True,
        # Protect sensitive data
        redact_sensitive=True,
        anonymize_donors=True,
        suppress_location=True,
        # Required attributions
        add_source_attribution=True,
        add_license_info=True,
        add_access_date=False,
        # DC-compatible context
        include_context=True,
        context_url="http://purl.org/dc/terms/",
        additional_contexts=[
            "http://www.europeana.eu/schemas/edm/",
        ],
    ),

    # -------------------------------------------------------------------------
    # PUBLIC PROFILE
    # Safe for public web display
    # -------------------------------------------------------------------------
    "public": ExportProfile(
        profile_id="public",
        name="Public",
        description="Safe for public web display. Excludes sensitive information "
                    "like valuations, donor details, and exact locations.",
        profile_type=ProfileType.PUBLIC,
        target_format="json-ld",
        # Public-safe categories
        included_categories={
            FieldCategory.IDENTIFICATION,
            FieldCategory.DESCRIPTION,
            FieldCategory.CREATION,
            FieldCategory.PHYSICAL,
            FieldCategory.SUBJECT,
            FieldCategory.RIGHTS,
            FieldCategory.MEDIA,
            FieldCategory.RELATIONSHIPS,
        },
        # Explicitly exclude sensitive
        excluded_categories={
            FieldCategory.VALUATION,
            FieldCategory.ACQUISITION,
            FieldCategory.ADMINISTRATIVE,
            FieldCategory.CONDITION,
        },
        excluded_fields={
            "donor_name",
            "purchase_price",
            "insurance_value",
            "market_value",
            "internal_notes",
            "current_location",
            "location_details",
        },
        # Include authorities for enrichment
        include_authorities=True,
        authority_sources={
            AuthoritySource.ULAN,
            AuthoritySource.AAT,
            AuthoritySource.WIKIDATA,
        },
        require_authority_links=False,
        # Web images only
        media_inclusion=MediaInclusion.WEB_SIZE,
        include_iiif_manifest=True,
        # Full protection
        redact_sensitive=True,
        anonymize_donors=True,
        suppress_location=True,
        # Attribution required
        add_source_attribution=True,
        add_license_info=True,
        add_access_date=False,
        # Schema.org for SEO
        include_context=True,
        context_url="https://schema.org/",
    ),

    # -------------------------------------------------------------------------
    # IIIF PROFILE
    # Optimized for IIIF manifests
    # -------------------------------------------------------------------------
    "iiif": ExportProfile(
        profile_id="iiif",
        name="IIIF",
        description="Optimized for IIIF Presentation API manifests. Focuses on "
                    "visual metadata with full image references.",
        profile_type=ProfileType.IIIF,
        target_format="iiif",
        # IIIF-relevant fields
        included_categories={
            FieldCategory.IDENTIFICATION,
            FieldCategory.DESCRIPTION,
            FieldCategory.CREATION,
            FieldCategory.RIGHTS,
            FieldCategory.MEDIA,
        },
        included_fields={
            "object_id",
            "object_number",
            "titles",
            "object_name",
            "brief_description",
            "creators",
            "creation_date_display",
            "creation_place",
            "materials",
            "techniques",
            "measurements",
            "copyright_status",
            "credit_line",
            "rights_statement",
            "primary_image_id",
            "media_links",
        },
        # Basic authorities
        include_authorities=True,
        authority_sources={
            AuthoritySource.ULAN,
            AuthoritySource.AAT,
        },
        require_authority_links=False,
        # Full IIIF support
        media_inclusion=MediaInclusion.IIIF_REFS,
        include_iiif_manifest=True,
        # Public-safe
        redact_sensitive=True,
        anonymize_donors=True,
        suppress_location=True,
        # Minimal extras
        add_source_attribution=True,
        add_license_info=True,
        add_access_date=False,
        # IIIF context
        include_context=True,
        context_url="http://iiif.io/api/presentation/3/context.json",
    ),

    # -------------------------------------------------------------------------
    # MINIMAL PROFILE
    # Bare minimum for listings
    # -------------------------------------------------------------------------
    "minimal": ExportProfile(
        profile_id="minimal",
        name="Minimal",
        description="Bare minimum metadata for listings and search results. "
                    "Only essential identification fields.",
        profile_type=ProfileType.MINIMAL,
        target_format="json-ld",
        # Only identification
        included_categories={FieldCategory.IDENTIFICATION},
        included_fields={
            "object_id",
            "object_number",
            "titles",
            "object_name",
            "thumbnail_url",
            "primary_image_id",
        },
        # No authorities in minimal
        include_authorities=False,
        require_authority_links=False,
        # Thumbnail only
        media_inclusion=MediaInclusion.THUMBNAIL_ONLY,
        include_iiif_manifest=False,
        # No sensitive data anyway
        redact_sensitive=True,
        anonymize_donors=True,
        suppress_location=True,
        # Minimal metadata
        add_source_attribution=False,
        add_license_info=False,
        add_access_date=False,
        # Simple context
        include_context=True,
        context_url="https://schema.org/",
    ),
}


# ============================================================================
# PROFILE APPLICATION
# ============================================================================

def get_profile(profile_id: str) -> Optional[ExportProfile]:
    """
    Get an export profile by ID.

    Args:
        profile_id: Profile identifier (e.g., "research", "public")

    Returns:
        ExportProfile or None if not found
    """
    return BUILTIN_PROFILES.get(profile_id)


def get_all_profiles() -> Dict[str, ExportProfile]:
    """Get all available export profiles."""
    return BUILTIN_PROFILES.copy()


def apply_export_profile(
    data: Dict[str, Any],
    profile: ExportProfile,
    base_url: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Apply an export profile to object data.

    This filters, transforms, and enriches the data according
    to the profile configuration.

    Args:
        data: Raw object data (dict)
        profile: Export profile to apply
        base_url: Base URL for generating URIs

    Returns:
        Filtered and transformed data
    """
    result = {}

    # 1. Filter fields based on profile rules
    for field_name, value in data.items():
        if value is None:
            continue
        if not profile.should_include_field(field_name):
            continue
        result[field_name] = deepcopy(value)

    # 2. Filter authority links
    if profile.include_authorities:
        result = _filter_authorities(result, profile)
    else:
        result = _strip_authorities(result)

    # 3. Apply transformations
    if profile.redact_sensitive:
        result = _redact_sensitive_fields(result)

    if profile.anonymize_donors:
        result = _anonymize_donors(result)

    if profile.suppress_location:
        result = _suppress_location(result)

    # 4. Handle media
    result = _transform_media(result, profile, base_url)

    # 5. Add metadata enrichment
    if profile.add_source_attribution:
        result["_source"] = {
            "provider": "Madrona Collections",
            "exportProfile": profile.profile_id,
        }

    if profile.add_license_info and "rights_statement" not in result:
        # Add default rights if not present
        if data.get("copyright_status"):
            result["_rights"] = {
                "status": data.get("copyright_status"),
            }

    if profile.add_access_date:
        from datetime import datetime, timezone
        result["_exportedAt"] = datetime.now(timezone.utc).isoformat() + "Z"

    # 6. Add JSON-LD context if requested
    if profile.include_context:
        contexts = [profile.context_url]
        contexts.extend(profile.additional_contexts)
        if len(contexts) == 1:
            result["@context"] = contexts[0]
        else:
            result["@context"] = contexts

    # 7. Apply custom mappings
    if profile.custom_field_mappings:
        result = _apply_custom_mappings(result, profile.custom_field_mappings)

    return result


def _filter_authorities(data: Dict, profile: ExportProfile) -> Dict:
    """Filter authority links based on profile preferences."""
    result = deepcopy(data)

    authority_fields = ["creators", "materials", "techniques", "subjects", "classifications"]

    for field_name in authority_fields:
        if field_name not in result:
            continue

        values = result[field_name]
        if not isinstance(values, list):
            continue

        filtered_values = []
        for item in values:
            if not isinstance(item, dict):
                if not profile.require_authority_links:
                    filtered_values.append(item)
                continue

            # Filter authorities within the item
            if "authorities" in item:
                filtered_auths = [
                    auth for auth in item["authorities"]
                    if profile.should_include_authority(auth.get("source", ""))
                ]
                if filtered_auths:
                    item = deepcopy(item)
                    item["authorities"] = filtered_auths
                elif profile.require_authority_links:
                    continue  # Skip items without matching authorities
                else:
                    item = deepcopy(item)
                    item.pop("authorities", None)

            filtered_values.append(item)

        result[field_name] = filtered_values

    return result


def _strip_authorities(data: Dict) -> Dict:
    """Remove all authority links from data."""
    result = deepcopy(data)

    authority_fields = ["creators", "materials", "techniques", "subjects", "classifications"]

    for field_name in authority_fields:
        if field_name not in result:
            continue

        values = result[field_name]
        if not isinstance(values, list):
            continue

        stripped_values = []
        for item in values:
            if isinstance(item, dict):
                item = deepcopy(item)
                item.pop("authorities", None)
                item.pop("ulan_id", None)
                item.pop("aat_id", None)
                item.pop("tgn_id", None)
                item.pop("viaf_id", None)
                item.pop("wikidata_id", None)
            stripped_values.append(item)

        result[field_name] = stripped_values

    return result


def _redact_sensitive_fields(data: Dict) -> Dict:
    """Redact sensitive field values."""
    result = deepcopy(data)

    sensitive_fields = [
        "insurance_value", "market_value", "purchase_price",
        "appraisal_value", "replacement_value",
    ]

    for field_name in sensitive_fields:
        if field_name in result:
            result[field_name] = "[redacted]"

    return result


def _anonymize_donors(data: Dict) -> Dict:
    """Replace donor names with generic text."""
    result = deepcopy(data)

    donor_fields = ["donor_name", "acquisition_source"]

    for field_name in donor_fields:
        if field_name in result and result[field_name]:
            # Keep "Gift of" prefix if present
            value = result[field_name]
            if isinstance(value, str):
                if value.lower().startswith("gift of"):
                    result[field_name] = "Gift of a private donor"
                elif value.lower().startswith("bequest of"):
                    result[field_name] = "Bequest of a private donor"
                else:
                    result[field_name] = "Private donor"

    return result


def _suppress_location(data: Dict) -> Dict:
    """Remove or generalize location information."""
    result = deepcopy(data)

    # Remove specific location fields
    location_fields = ["current_location", "location_details", "storage_unit", "shelf"]
    for field_name in location_fields:
        result.pop(field_name, None)

    # Keep only general location (e.g., "On display" vs specific gallery)
    if "normal_location" in result:
        loc = result["normal_location"]
        if isinstance(loc, str):
            if any(term in loc.lower() for term in ["gallery", "display", "exhibition"]):
                result["normal_location"] = "On display"
            elif any(term in loc.lower() for term in ["storage", "vault", "reserve"]):
                result["normal_location"] = "In storage"
            else:
                result.pop("normal_location", None)

    return result


def _transform_media(
    data: Dict,
    profile: ExportProfile,
    base_url: Optional[str]
) -> Dict:
    """Transform media references based on profile."""
    result = deepcopy(data)

    if profile.media_inclusion == MediaInclusion.NONE:
        result.pop("media_links", None)
        result.pop("primary_image_id", None)
        result.pop("thumbnail_url", None)
        return result

    if profile.media_inclusion == MediaInclusion.THUMBNAIL_ONLY:
        result.pop("media_links", None)
        # Keep only thumbnail
        return result

    if profile.media_inclusion == MediaInclusion.IIIF_REFS:
        # Convert media links to IIIF Image API references
        if "media_links" in result and base_url:
            iiif_refs = []
            for media in result.get("media_links", []):
                if isinstance(media, dict):
                    media_id = media.get("media_id")
                    if media_id:
                        iiif_refs.append({
                            "@id": f"{base_url}/iiif/2/{media_id}",
                            "@type": "ImageService2",
                            "profile": "http://iiif.io/api/image/2/level2.json",
                        })
            if iiif_refs:
                result["iiif_images"] = iiif_refs

    return result


def _apply_custom_mappings(
    data: Dict,
    mappings: Dict[str, str]
) -> Dict:
    """Apply custom field name mappings."""
    result = {}

    for field_name, value in data.items():
        # Check if there's a custom mapping
        mapped_name = mappings.get(field_name, field_name)
        result[mapped_name] = value

    return result


# ============================================================================
# PROFILE SERIALIZATION FOR STORAGE
# ============================================================================

def profile_from_dict(data: Dict[str, Any]) -> ExportProfile:
    """Create an ExportProfile from a dictionary (e.g., from database)."""
    return ExportProfile(
        profile_id=data["profileId"],
        name=data["name"],
        description=data.get("description", ""),
        profile_type=ProfileType(data.get("profileType", "custom")),
        target_format=data.get("targetFormat", "json-ld"),
        included_categories={
            FieldCategory(c) for c in data.get("includedCategories", [])
        },
        excluded_categories={
            FieldCategory(c) for c in data.get("excludedCategories", [])
        },
        included_fields=set(data.get("includedFields", [])),
        excluded_fields=set(data.get("excludedFields", [])),
        include_authorities=data.get("includeAuthorities", True),
        authority_sources={
            AuthoritySource(s) for s in data.get("authoritySources", [])
        },
        require_authority_links=data.get("requireAuthorityLinks", False),
        media_inclusion=MediaInclusion(data.get("mediaInclusion", "iiif")),
        include_iiif_manifest=data.get("includeIiifManifest", True),
        redact_sensitive=data.get("redactSensitive", False),
        anonymize_donors=data.get("anonymizeDonors", False),
        suppress_location=data.get("suppressLocation", False),
        add_source_attribution=data.get("addSourceAttribution", True),
        add_license_info=data.get("addLicenseInfo", True),
        add_access_date=data.get("addAccessDate", False),
        include_context=data.get("includeContext", True),
        context_url=data.get("contextUrl", "https://schema.org/"),
        additional_contexts=data.get("additionalContexts", []),
        custom_field_mappings=data.get("customFieldMappings", {}),
        custom_transformations=data.get("customTransformations", {}),
    )
