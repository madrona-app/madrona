"""
Profile-specific projection defaults.

This module defines optimized display field paths for each profile type.
When resolving display fields, the system uses profile-specific paths
if the entity has a profile assigned, providing better field extraction
for domain-specific data.

USAGE:
    from app.schemas.profile_projections import (
        get_profile_projection_defaults,
        PROFILE_PROJECTIONS,
    )

    # Get defaults for a profile
    defaults = get_profile_projection_defaults("collections")
    # Returns: {"title": [...], "subtitle": [...], "thumbnail": [...], "snippet": [...]}

INTEGRATION WITH PROJECTION RESOLVER:
    The projection resolver uses profile projections as an additional fallback
    layer between dataset-level projections and organization defaults:

    Precedence:
    1. Dataset-level projection config
    2. Profile-specific defaults (if entity has profile)
    3. Organization projection config
    4. System defaults

SUPPORTED PROFILES:
    - collections: Museum/archive collection objects
    - media: Digital media assets (images, video, audio)
    - agent: People, organizations, groups
    - place: Geographic locations
    - event: Historical events, exhibitions
    - work: Creative/intellectual works (publications, manuscripts)
"""

from typing import Any


# =============================================================================
# PROFILE PROJECTION DEFAULTS
# =============================================================================

PROFILE_PROJECTIONS: dict[str, dict[str, list[str]]] = {
    # Collections profile - Museum/archive objects
    "collections": {
        "title": [
            "properties.title",
            "label",
            "properties.accession_number",
            "id",
        ],
        "subtitle": [
            "properties.object_type",
            "properties.classification",
            "properties.date_display",
            "type",
        ],
        "thumbnail": [
            "properties.thumbnail_url",
            "properties.primary_image_url",
            "media[role=thumbnail].url",
            "media[0].url",
        ],
        "snippet": [
            "properties.description",
            "properties.credit_line",
            "description",
        ],
        # Additional fields for collections
        "accession": [
            "properties.accession_number",
            "properties.object_number",
            "identifiers[scheme=accession].value",
        ],
        "creator": [
            "properties.creator",
            "properties.artist",
            "properties.maker",
        ],
        "date": [
            "properties.date_display",
            "properties.date_created",
            "properties.creation_date",
        ],
        "medium": [
            "properties.medium",
            "properties.materials",
            "properties.technique",
        ],
        "dimensions": [
            "properties.dimensions",
            "properties.size",
        ],
        "department": [
            "properties.department",
            "properties.collection",
        ],
    },

    # Media profile - Digital media assets
    "media": {
        "title": [
            "properties.title",
            "properties.filename",
            "label",
            "id",
        ],
        "subtitle": [
            "properties.media_type",
            "properties.mime_type",
            "properties.format",
            "type",
        ],
        "thumbnail": [
            "properties.thumbnail_url",
            "properties.preview_url",
            "properties.url",
        ],
        "snippet": [
            "properties.description",
            "properties.caption",
            "properties.alt_text",
            "description",
        ],
        # Additional fields for media
        "url": [
            "properties.url",
            "properties.source_url",
            "properties.download_url",
        ],
        "dimensions": [
            "properties.width",
            "properties.height",
        ],
        "duration": [
            "properties.duration",
            "properties.runtime",
        ],
        "rights": [
            "properties.rights_statement",
            "properties.license",
            "properties.copyright",
        ],
    },

    # Agent profile - People, organizations, groups
    "agent": {
        "title": [
            "properties.name",
            "properties.display_name",
            "label",
            "id",
        ],
        "subtitle": [
            "properties.agent_type",
            "properties.role",
            "properties.nationality",
            "type",
        ],
        "thumbnail": [
            "properties.image_url",
            "properties.portrait_url",
            "media[role=portrait].url",
            "media[0].url",
        ],
        "snippet": [
            "properties.biography",
            "properties.description",
            "description",
        ],
        # Additional fields for agents
        "dates": [
            "properties.life_dates",
            "properties.birth_date",
            "properties.active_dates",
        ],
        "nationality": [
            "properties.nationality",
            "properties.culture",
        ],
        "identifiers": [
            "identifiers[scheme=ulan].value",
            "identifiers[scheme=wikidata].value",
            "identifiers[scheme=viaf].value",
        ],
    },

    # Place profile - Geographic locations
    "place": {
        "title": [
            "properties.name",
            "properties.place_name",
            "label",
            "id",
        ],
        "subtitle": [
            "properties.place_type",
            "properties.country",
            "properties.region",
            "type",
        ],
        "thumbnail": [
            "properties.image_url",
            "media[0].url",
        ],
        "snippet": [
            "properties.description",
            "properties.historical_note",
            "description",
        ],
        # Additional fields for places
        "coordinates": [
            "properties.coordinates",
            "properties.latitude",
        ],
        "hierarchy": [
            "properties.part_of",
            "properties.country",
            "properties.region",
        ],
        "identifiers": [
            "identifiers[scheme=tgn].value",
            "identifiers[scheme=geonames].value",
        ],
    },

    # Event profile - Historical events, exhibitions
    "event": {
        "title": [
            "properties.title",
            "properties.name",
            "label",
            "id",
        ],
        "subtitle": [
            "properties.event_type",
            "properties.date_display",
            "type",
        ],
        "thumbnail": [
            "properties.image_url",
            "media[0].url",
        ],
        "snippet": [
            "properties.description",
            "properties.summary",
            "description",
        ],
        # Additional fields for events
        "dates": [
            "properties.date_display",
            "properties.start_date",
            "properties.date_range",
        ],
        "location": [
            "properties.location",
            "properties.venue",
        ],
    },

    # Work profile - Publications, manuscripts, intellectual works
    "work": {
        "title": [
            "properties.title",
            "label",
            "id",
        ],
        "subtitle": [
            "properties.work_type",
            "properties.publication_date",
            "type",
        ],
        "thumbnail": [
            "properties.cover_image_url",
            "properties.thumbnail_url",
            "media[0].url",
        ],
        "snippet": [
            "properties.abstract",
            "properties.description",
            "properties.summary",
            "description",
        ],
        # Additional fields for works
        "author": [
            "properties.author",
            "properties.creator",
        ],
        "publication": [
            "properties.publication_date",
            "properties.published_in",
            "properties.publisher",
        ],
        "identifiers": [
            "identifiers[scheme=doi].value",
            "identifiers[scheme=isbn].value",
        ],
    },
}


# =============================================================================
# PUBLIC API
# =============================================================================

def get_profile_projection_defaults(profile_name: str) -> dict[str, list[str]] | None:
    """
    Get projection defaults for a specific profile.

    Args:
        profile_name: Name of the profile (e.g., "collections", "media")

    Returns:
        Dictionary mapping role names to path lists, or None if profile not found.
    """
    return PROFILE_PROJECTIONS.get(profile_name)


def get_profile_paths_for_role(
    profile_name: str,
    role: str,
    fallback: list[str] | None = None,
) -> list[str]:
    """
    Get paths for a specific role from a profile's projection defaults.

    Args:
        profile_name: Name of the profile
        role: Role name (title, subtitle, thumbnail, snippet, or profile-specific)
        fallback: Fallback paths if profile or role not found

    Returns:
        List of paths for the role, or fallback if not found.
    """
    profile_defaults = PROFILE_PROJECTIONS.get(profile_name)
    if not profile_defaults:
        return fallback or []

    return profile_defaults.get(role, fallback or [])


def list_supported_profiles() -> list[str]:
    """
    List all profiles with projection defaults.

    Returns:
        List of profile names.
    """
    return list(PROFILE_PROJECTIONS.keys())


def get_profile_display_roles(profile_name: str) -> list[str]:
    """
    Get all display roles available for a profile.

    Args:
        profile_name: Name of the profile

    Returns:
        List of role names (includes standard and profile-specific roles).
    """
    profile_defaults = PROFILE_PROJECTIONS.get(profile_name)
    if not profile_defaults:
        return []
    return list(profile_defaults.keys())


def merge_profile_with_config(
    profile_name: str | None,
    config_paths: dict[str, list[str]],
    roles: list[str] | None = None,
) -> dict[str, list[str]]:
    """
    Merge profile defaults with explicit config, profile paths come first.

    Args:
        profile_name: Profile name (or None to skip profile merge)
        config_paths: Explicit configuration paths
        roles: Roles to merge (defaults to standard display roles)

    Returns:
        Merged paths dictionary with profile paths taking precedence.
    """
    if roles is None:
        roles = ["title", "subtitle", "thumbnail", "snippet"]

    result = {}
    profile_defaults = PROFILE_PROJECTIONS.get(profile_name) if profile_name else {}

    for role in roles:
        profile_paths = profile_defaults.get(role, []) if profile_defaults else []
        config_role_paths = config_paths.get(role, [])

        # Profile paths first, then config paths (deduplicated)
        merged = list(profile_paths)
        for path in config_role_paths:
            if path not in merged:
                merged.append(path)

        result[role] = merged

    return result
