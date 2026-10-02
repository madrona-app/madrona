"""
Authority-Backed Value Schemas

Provides structured schemas for CDWA-aligned fields that support optional
authority linking without changing existing Procedure/CDWA field semantics.

Key Design Principles:
- Authority URIs are OPTIONAL - fields remain usable without Linked Data knowledge
- Existing string values are preserved - backward compatible
- Multiple authorities per field supported (e.g., VIAF + Wikidata for same person)
- No ontology logic - pure data structure

Supported Authority Sources:
- VIAF (Virtual International Authority File)
- Getty ULAN (Union List of Artist Names)
- Getty AAT (Art & Architecture Thesaurus)
- Getty TGN (Thesaurus of Geographic Names)
- Wikidata
- LCNAF (Library of Congress Name Authority File)
- ORCID (for living researchers/conservators)
- ROR (Research Organization Registry)
- GeoNames

Example Usage:
    {
        "value": "Claude Monet",
        "authorities": [
            {"uri": "http://viaf.org/viaf/36915266", "source": "VIAF"},
            {"uri": "http://vocab.getty.edu/ulan/500019484", "source": "ULAN"},
            {"uri": "https://www.wikidata.org/entity/Q296", "source": "Wikidata"}
        ]
    }
"""

from typing import Optional
from pydantic import BaseModel, Field, field_validator
from enum import Enum


class AuthoritySource(str, Enum):
    """
    Supported external authority sources.

    These map to well-known Linked Data authorities used in
    cultural heritage contexts.
    """
    VIAF = "VIAF"                    # Virtual International Authority File
    ULAN = "ULAN"                    # Getty Union List of Artist Names
    AAT = "AAT"                      # Getty Art & Architecture Thesaurus
    TGN = "TGN"                      # Getty Thesaurus of Geographic Names
    WIKIDATA = "Wikidata"            # Wikidata
    LCNAF = "LCNAF"                  # Library of Congress Name Authority File
    ORCID = "ORCID"                  # ORCID identifiers for researchers
    ROR = "ROR"                      # Research Organization Registry
    GEONAMES = "GeoNames"            # GeoNames geographic database
    LOC_SUBJECTS = "LCSH"            # Library of Congress Subject Headings
    ICONCLASS = "Iconclass"          # Iconclass iconographic classification
    CUSTOM = "Custom"                # Institution-specific authority


# URI templates for building canonical URIs
AUTHORITY_URI_TEMPLATES = {
    AuthoritySource.VIAF: "http://viaf.org/viaf/{id}",
    AuthoritySource.ULAN: "http://vocab.getty.edu/ulan/{id}",
    AuthoritySource.AAT: "http://vocab.getty.edu/aat/{id}",
    AuthoritySource.TGN: "http://vocab.getty.edu/tgn/{id}",
    AuthoritySource.WIKIDATA: "https://www.wikidata.org/entity/{id}",
    AuthoritySource.LCNAF: "http://id.loc.gov/authorities/names/{id}",
    AuthoritySource.ORCID: "https://orcid.org/{id}",
    AuthoritySource.ROR: "https://ror.org/{id}",
    AuthoritySource.GEONAMES: "https://sws.geonames.org/{id}/",
    AuthoritySource.LOC_SUBJECTS: "http://id.loc.gov/authorities/subjects/{id}",
    AuthoritySource.ICONCLASS: "http://iconclass.org/{id}",
}


class AuthorityLink(BaseModel):
    """
    A single authority link for a value.

    Links a display value to an external authority URI.
    """
    uri: str = Field(
        ...,
        description="Full URI to the authority record",
        examples=["http://viaf.org/viaf/36915266"]
    )
    source: str = Field(
        ...,
        description="Authority source identifier",
        examples=["VIAF", "ULAN", "Wikidata"]
    )
    label: Optional[str] = Field(
        None,
        description="Optional label from the authority (for display/verification)"
    )
    match_confidence: Optional[str] = Field(
        None,
        description="Confidence level: 'exact', 'probable', 'suggested'",
        examples=["exact", "probable", "suggested"]
    )

    @field_validator("source")
    @classmethod
    def normalize_source(cls, v: str) -> str:
        """Normalize common source name variations."""
        normalized = {
            "viaf": "VIAF",
            "ulan": "ULAN",
            "getty_ulan": "ULAN",
            "aat": "AAT",
            "getty_aat": "AAT",
            "tgn": "TGN",
            "getty_tgn": "TGN",
            "wikidata": "Wikidata",
            "wd": "Wikidata",
            "lcnaf": "LCNAF",
            "loc": "LCNAF",
            "orcid": "ORCID",
            "ror": "ROR",
            "geonames": "GeoNames",
            "lcsh": "LCSH",
            "iconclass": "Iconclass",
        }
        return normalized.get(v.lower(), v)


class AuthorityBackedValue(BaseModel):
    """
    A value with optional authority links.

    This is the core pattern for authority-backed fields. The `value` field
    contains the display string (what users see and edit), while `authorities`
    provides optional Linked Data connections.

    Example:
        {
            "value": "Claude Monet",
            "authorities": [
                {"uri": "http://viaf.org/viaf/36915266", "source": "VIAF"}
            ]
        }
    """
    value: str = Field(
        ...,
        description="Display value (the primary human-readable string)"
    )
    authorities: list[AuthorityLink] = Field(
        default_factory=list,
        description="Optional list of authority links"
    )
    note: Optional[str] = Field(
        None,
        description="Optional cataloger note about this value"
    )

    def has_authority(self, source: str) -> bool:
        """Check if this value has a link to a specific authority."""
        return any(a.source.lower() == source.lower() for a in self.authorities)

    def get_authority_uri(self, source: str) -> Optional[str]:
        """Get the URI for a specific authority source."""
        for a in self.authorities:
            if a.source.lower() == source.lower():
                return a.uri
        return None


# ============================================================================
# CDWA-ALIGNED FIELD SCHEMAS
# ============================================================================

class CreatorValue(AuthorityBackedValue):
    """
    Creator/artist entry with authority support.

    Extends AuthorityBackedValue with creator-specific fields per CDWA Category 10.

    Example:
        {
            "value": "Claude Monet",
            "role": "artist",
            "attribution": "attributed to",
            "authorities": [
                {"uri": "http://vocab.getty.edu/ulan/500019484", "source": "ULAN"},
                {"uri": "http://viaf.org/viaf/36915266", "source": "VIAF"}
            ]
        }
    """
    role: str = Field(
        default="creator",
        description="Role in creation: 'artist', 'maker', 'manufacturer', 'designer', 'architect', etc."
    )
    attribution: Optional[str] = Field(
        None,
        description="Attribution qualifier: 'attributed to', 'circle of', 'follower of', 'workshop of', 'after', 'manner of', 'school of'"
    )
    extent: Optional[str] = Field(
        None,
        description="Extent of involvement: 'design only', 'execution only', 'figures only'"
    )
    # Backward compatibility: still support ulan_id as a convenience
    ulan_id: Optional[str] = Field(
        None,
        description="DEPRECATED: Use authorities array instead. Getty ULAN ID for backward compatibility."
    )

    def model_post_init(self, __context):
        """Migrate legacy ulan_id to authorities array."""
        if self.ulan_id and not self.has_authority("ULAN"):
            self.authorities.append(AuthorityLink(
                uri=f"http://vocab.getty.edu/ulan/{self.ulan_id}",
                source="ULAN"
            ))


class MaterialValue(AuthorityBackedValue):
    """
    Material entry with authority support.

    Extends AuthorityBackedValue with material-specific fields per CDWA Category 7.

    Example:
        {
            "value": "oil paint",
            "part": "medium",
            "authorities": [
                {"uri": "http://vocab.getty.edu/aat/300015050", "source": "AAT"}
            ]
        }
    """
    part: Optional[str] = Field(
        None,
        description="Part of object this material applies to: 'support', 'medium', 'frame', 'mount'"
    )
    # Backward compatibility
    aat_id: Optional[str] = Field(
        None,
        description="DEPRECATED: Use authorities array instead. Getty AAT ID for backward compatibility."
    )

    def model_post_init(self, __context):
        """Migrate legacy aat_id to authorities array."""
        if self.aat_id and not self.has_authority("AAT"):
            self.authorities.append(AuthorityLink(
                uri=f"http://vocab.getty.edu/aat/{self.aat_id}",
                source="AAT"
            ))


class TechniqueValue(AuthorityBackedValue):
    """
    Technique entry with authority support.

    Extends AuthorityBackedValue with technique-specific fields per CDWA Category 8.

    Example:
        {
            "value": "impasto",
            "authorities": [
                {"uri": "http://vocab.getty.edu/aat/300053839", "source": "AAT"}
            ]
        }
    """
    # Backward compatibility
    aat_id: Optional[str] = Field(
        None,
        description="DEPRECATED: Use authorities array instead. Getty AAT ID for backward compatibility."
    )

    def model_post_init(self, __context):
        """Migrate legacy aat_id to authorities array."""
        if self.aat_id and not self.has_authority("AAT"):
            self.authorities.append(AuthorityLink(
                uri=f"http://vocab.getty.edu/aat/{self.aat_id}",
                source="AAT"
            ))


class PlaceValue(AuthorityBackedValue):
    """
    Place entry with authority support.

    Extends AuthorityBackedValue with place-specific fields per CDWA Category 11.

    Example:
        {
            "value": "Paris, France",
            "place_type": "creation_place",
            "authorities": [
                {"uri": "http://vocab.getty.edu/tgn/7008038", "source": "TGN"},
                {"uri": "https://www.wikidata.org/entity/Q90", "source": "Wikidata"}
            ]
        }
    """
    place_type: Optional[str] = Field(
        None,
        description="Type of place reference: 'creation_place', 'discovery_place', 'depicted_place', 'origin'"
    )
    coordinates: Optional[dict] = Field(
        None,
        description="Optional coordinates: {'lat': float, 'lon': float}"
    )
    # Backward compatibility
    tgn_id: Optional[str] = Field(
        None,
        description="DEPRECATED: Use authorities array instead. Getty TGN ID for backward compatibility."
    )

    def model_post_init(self, __context):
        """Migrate legacy tgn_id to authorities array."""
        if self.tgn_id and not self.has_authority("TGN"):
            self.authorities.append(AuthorityLink(
                uri=f"http://vocab.getty.edu/tgn/{self.tgn_id}",
                source="TGN"
            ))


class ClassificationValue(AuthorityBackedValue):
    """
    Classification/object type entry with authority support.

    Extends AuthorityBackedValue with classification-specific fields per CDWA Category 4.

    Example:
        {
            "value": "paintings (visual works)",
            "classification_system": "AAT",
            "authorities": [
                {"uri": "http://vocab.getty.edu/aat/300033618", "source": "AAT"}
            ]
        }
    """
    classification_system: Optional[str] = Field(
        None,
        description="Classification system used: 'AAT', 'Nomenclature', 'local'"
    )
    is_primary: bool = Field(
        default=False,
        description="Whether this is the primary classification"
    )


class SubjectValue(AuthorityBackedValue):
    """
    Subject/iconography entry with authority support.

    Extends AuthorityBackedValue with subject-specific fields per CDWA Category 13.

    Example:
        {
            "value": "water lilies",
            "subject_type": "depicted_subject",
            "authorities": [
                {"uri": "http://vocab.getty.edu/aat/300132399", "source": "AAT"}
            ]
        }
    """
    subject_type: Optional[str] = Field(
        None,
        description="Type of subject: 'depicted_subject', 'theme', 'iconography'"
    )


# ============================================================================
# UTILITY FUNCTIONS
# ============================================================================

def build_authority_uri(source: AuthoritySource, identifier: str) -> str:
    """
    Build a canonical URI for an authority identifier.

    Args:
        source: The authority source
        identifier: The identifier within that source

    Returns:
        Full URI string

    Example:
        >>> build_authority_uri(AuthoritySource.ULAN, "500019484")
        "http://vocab.getty.edu/ulan/500019484"
    """
    template = AUTHORITY_URI_TEMPLATES.get(source)
    if not template:
        raise ValueError(f"Unknown authority source: {source}")
    return template.format(id=identifier)


def parse_authority_uri(uri: str) -> tuple[Optional[AuthoritySource], Optional[str]]:
    """
    Parse an authority URI to extract source and identifier.

    Args:
        uri: The authority URI

    Returns:
        Tuple of (source, identifier) or (None, None) if unrecognized

    Example:
        >>> parse_authority_uri("http://vocab.getty.edu/ulan/500019484")
        (AuthoritySource.ULAN, "500019484")
    """
    import re

    patterns = [
        (AuthoritySource.VIAF, r"viaf\.org/viaf/(\d+)"),
        (AuthoritySource.ULAN, r"vocab\.getty\.edu/ulan/(\d+)"),
        (AuthoritySource.AAT, r"vocab\.getty\.edu/aat/(\d+)"),
        (AuthoritySource.TGN, r"vocab\.getty\.edu/tgn/(\d+)"),
        (AuthoritySource.WIKIDATA, r"wikidata\.org/entity/(Q\d+)"),
        (AuthoritySource.LCNAF, r"id\.loc\.gov/authorities/names/(\w+)"),
        (AuthoritySource.ORCID, r"orcid\.org/([\d-]+)"),
        (AuthoritySource.ROR, r"ror\.org/([\w\d]+)"),
        (AuthoritySource.GEONAMES, r"geonames\.org/(\d+)"),
    ]

    for source, pattern in patterns:
        match = re.search(pattern, uri)
        if match:
            return source, match.group(1)

    return None, None


def normalize_authority_value(data: dict) -> dict:
    """
    Normalize an authority-backed value, handling various input formats.

    Supports:
    - Plain string: {"value": "Claude Monet"}
    - String with name key: {"name": "Claude Monet"}
    - Full structure: {"value": "...", "authorities": [...]}
    - Legacy ulan_id/aat_id fields

    Args:
        data: Raw input data

    Returns:
        Normalized dict with value and authorities keys
    """
    if isinstance(data, str):
        return {"value": data, "authorities": []}

    if not isinstance(data, dict):
        return {"value": str(data), "authorities": []}

    # Normalize value field
    value = data.get("value") or data.get("name") or data.get("term") or ""

    # Collect authorities
    authorities = list(data.get("authorities", []))

    # Migrate legacy ID fields
    if data.get("ulan_id") and not any(a.get("source") == "ULAN" for a in authorities):
        authorities.append({
            "uri": f"http://vocab.getty.edu/ulan/{data['ulan_id']}",
            "source": "ULAN"
        })

    if data.get("aat_id") and not any(a.get("source") == "AAT" for a in authorities):
        authorities.append({
            "uri": f"http://vocab.getty.edu/aat/{data['aat_id']}",
            "source": "AAT"
        })

    if data.get("tgn_id") and not any(a.get("source") == "TGN" for a in authorities):
        authorities.append({
            "uri": f"http://vocab.getty.edu/tgn/{data['tgn_id']}",
            "source": "TGN"
        })

    if data.get("viaf_id") and not any(a.get("source") == "VIAF" for a in authorities):
        authorities.append({
            "uri": f"http://viaf.org/viaf/{data['viaf_id']}",
            "source": "VIAF"
        })

    if data.get("wikidata_id") and not any(a.get("source") == "Wikidata" for a in authorities):
        authorities.append({
            "uri": f"https://www.wikidata.org/entity/{data['wikidata_id']}",
            "source": "Wikidata"
        })

    result = {
        "value": value,
        "authorities": authorities,
    }

    # Preserve other fields (role, attribution, part, etc.)
    preserved_fields = [
        "role", "attribution", "extent", "part", "place_type",
        "coordinates", "classification_system", "is_primary",
        "subject_type", "note"
    ]
    for field in preserved_fields:
        if field in data:
            result[field] = data[field]

    return result
