"""
Madrona Projection Resolver - Display Field Resolution.

This module implements the projection resolution algorithm that resolves
canonical field paths to display values for entity rendering.

ALGORITHM:
    For each role (title, subtitle, thumbnail, snippet):
    1. Try dataset-level paths (if present and valid)
    2. Fall back to org profile paths
    3. Fall back to system defaults

    Title must NEVER be blank - ultimate fallback is record.id

PATH SYNTAX:
    - Simple: "label", "description", "type", "id"
    - Nested: "properties.title", "properties.creator.name"
    - Array index: "media[0].url", "identifiers[1].value"
    - Predicate: "media[role=thumbnail].url", "identifiers[scheme=doi].value"

USAGE:
    from app.schemas.projection_resolver import resolve_display_fields

    result = resolve_display_fields(
        record=entity_payload,
        scope="entity_detail",
        org_config=org.display_projections,
    )
    # result = {"title": "Civil War Map", "subtitle": "Work", "thumbnailUrl": "https://..."}
"""

from __future__ import annotations

import logging
import re
from typing import Any

from app.schemas.projection_config import (
    get_default_projection_config,
    normalize_projection_config,
    VALID_SCOPES,
    DEFAULT_FALLBACKS,
    ALLOWED_PATH_PREFIXES,
    DISALLOWED_PATH_PREFIXES,
)
from app.schemas.profile_projections import get_profile_paths_for_role

logger = logging.getLogger(__name__)


# =============================================================================
# DISPLAY FIELDS RESULT
# =============================================================================

class DisplayFields:
    """Result of display field resolution."""

    def __init__(
        self,
        title: str,
        subtitle: str | None = None,
        thumbnail_url: str | None = None,
        snippet: str | None = None,
    ):
        self.title = title
        self.subtitle = subtitle
        self.thumbnail_url = thumbnail_url
        self.snippet = snippet

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary with camelCase keys."""
        result: dict[str, Any] = {"title": self.title}
        if self.subtitle is not None:
            result["subtitle"] = self.subtitle
        if self.thumbnail_url is not None:
            result["thumbnailUrl"] = self.thumbnail_url
        if self.snippet is not None:
            result["snippet"] = self.snippet
        return result


# =============================================================================
# PATH RESOLUTION
# =============================================================================

# Regex patterns for path parsing
ARRAY_INDEX_PATTERN = re.compile(r'^(\w+)\[(\d+)\]$')  # media[0]
PREDICATE_PATTERN = re.compile(r'^(\w+)\[(\w+)=([^\]]+)\]$')  # media[role=thumbnail]


def is_path_allowed(path: str) -> bool:
    """
    Check if a path is in the allowed list.

    Args:
        path: Dot-notation path

    Returns:
        True if path uses allowed prefixes, False otherwise
    """
    if not path or not isinstance(path, str):
        return False

    path = path.strip()
    if not path:
        return False

    # Extract the top-level prefix
    prefix_match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)', path)
    if not prefix_match:
        return False

    prefix = prefix_match.group(1)

    # Check against disallowed
    if prefix in DISALLOWED_PATH_PREFIXES:
        return False

    # Check against allowed
    return prefix in ALLOWED_PATH_PREFIXES


def resolve_path_segment(obj: Any, segment: str) -> Any:
    """
    Resolve a single path segment against an object.

    Handles:
    - Simple property: "label" -> obj["label"]
    - Array index: "media[0]" -> obj["media"][0]
    - Predicate: "media[role=thumbnail]" -> first media where role=="thumbnail"

    Args:
        obj: Object to resolve against (dict or list)
        segment: Path segment to resolve

    Returns:
        Resolved value or None if not found
    """
    if obj is None:
        return None

    # Check for array index: fieldName[0]
    index_match = ARRAY_INDEX_PATTERN.match(segment)
    if index_match:
        field_name = index_match.group(1)
        index = int(index_match.group(2))

        if isinstance(obj, dict) and field_name in obj:
            arr = obj[field_name]
            if isinstance(arr, list) and 0 <= index < len(arr):
                return arr[index]
        return None

    # Check for predicate: fieldName[key=value]
    predicate_match = PREDICATE_PATTERN.match(segment)
    if predicate_match:
        field_name = predicate_match.group(1)
        pred_key = predicate_match.group(2)
        pred_value = predicate_match.group(3)

        if isinstance(obj, dict) and field_name in obj:
            arr = obj[field_name]
            if isinstance(arr, list):
                # Find first item matching predicate
                for item in arr:
                    if isinstance(item, dict) and item.get(pred_key) == pred_value:
                        return item
        return None

    # Simple property access
    if isinstance(obj, dict):
        return obj.get(segment)

    return None


def resolve_path(record: dict[str, Any], path: str) -> Any:
    """
    Resolve a dot-notation path against a canonical record.

    Examples:
        "label" -> record["label"]
        "properties.title" -> record["properties"]["title"]
        "media[0].url" -> record["media"][0]["url"]
        "media[role=thumbnail].url" -> first media where role=="thumbnail", then .url

    Args:
        record: Canonical record dict
        path: Dot-notation path

    Returns:
        Resolved value or None if path doesn't resolve
    """
    if not path or not isinstance(path, str):
        return None

    path = path.strip()
    if not path:
        return None

    # Check if path is allowed
    if not is_path_allowed(path):
        return None

    # Split path and resolve each segment
    segments = path.split(".")
    current = record

    for segment in segments:
        current = resolve_path_segment(current, segment)
        if current is None:
            return None

    return current


def resolve_value(record: dict[str, Any], paths: list[str]) -> str | None:
    """
    Resolve a value from a record using fallback paths.

    Tries each path in order, returning the first non-empty value.
    Arrays are joined with ", ".

    Args:
        record: Canonical record dict
        paths: List of paths to try in order

    Returns:
        Resolved string value or None if nothing resolves
    """
    for path in paths:
        try:
            value = resolve_path(record, path)

            if value is None:
                continue

            # Handle different value types
            if isinstance(value, str):
                value = value.strip()
                if value:
                    return value
            elif isinstance(value, list):
                # Join array values with ", "
                string_values = []
                for item in value:
                    if isinstance(item, str) and item.strip():
                        string_values.append(item.strip())
                    elif isinstance(item, dict):
                        # Try to extract a label or value from dict items
                        label = item.get("label") or item.get("value") or item.get("name")
                        if label and isinstance(label, str):
                            string_values.append(label.strip())
                if string_values:
                    return ", ".join(string_values)
            elif isinstance(value, (int, float)):
                return str(value)
            elif isinstance(value, dict):
                # Try to extract label/value from dict
                label = value.get("label") or value.get("value") or value.get("name")
                if label and isinstance(label, str):
                    return label.strip()

        except Exception as e:
            # Log but continue to next path
            logger.debug(f"Error resolving path '{path}': {e}")
            continue

    return None


# =============================================================================
# MAIN RESOLVER
# =============================================================================

def get_paths_for_role_with_precedence(
    role: str,
    scope: str,
    org_config: dict[str, Any] | None = None,
    profile_name: str | None = None,
) -> list[str]:
    """
    Get paths for a role with precedence: org → profile → defaults.

    Args:
        role: Role name (title, subtitle, thumbnail, snippet)
        scope: Scope name (entity_detail, entities_list, search)
        org_config: Optional org-level projection config
        profile_name: Optional profile name for profile-specific paths

    Returns:
        List of paths to try in order
    """
    # 1. Org-level paths
    if org_config:
        normalized = normalize_projection_config(org_config)
        profile = normalized.get("profiles", {}).get(scope, {})
        if profile and isinstance(profile, dict):
            paths = profile.get(role)
            if paths and isinstance(paths, list) and len(paths) > 0:
                return paths

    # 2. Profile-specific paths
    if profile_name:
        profile_paths = get_profile_paths_for_role(profile_name, role)
        if profile_paths:
            return profile_paths

    # 3. System defaults
    defaults = get_default_projection_config()
    profile = defaults.get("profiles", {}).get(scope, {})
    if profile and isinstance(profile, dict):
        paths = profile.get(role)
        if paths and isinstance(paths, list):
            return paths

    # Ultimate fallback to DEFAULT_FALLBACKS
    return DEFAULT_FALLBACKS.get(role, [])


def resolve_display_fields(
    record: dict[str, Any],
    scope: str,
    org_config: dict[str, Any] | None = None,
    profile_name: str | None = None,
) -> dict[str, Any]:
    """
    Resolve display fields for a canonical record.

    Applies projection configuration with precedence:
    1. Org profile paths
    2. Profile-specific paths (if profile_name provided or found in record.meta.profile)
    3. System defaults

    Title is guaranteed to never be blank - falls back to record.id.

    Args:
        record: Canonical record dict or CanonicalRecord instance
        scope: Scope name (entity_detail, entities_list, search)
        org_config: Optional org-level projection config
        profile_name: Optional explicit profile name (if not provided, extracted from record)

    Returns:
        Dict with resolved display fields:
        {
            "title": str (required, never blank),
            "subtitle": str | None,
            "thumbnailUrl": str | None,
            "snippet": str | None
        }
    """
    # Convert Pydantic model to dict if needed
    if hasattr(record, "model_dump"):
        record = record.model_dump()

    if not isinstance(record, dict):
        # If not a dict, return minimal result with id fallback
        return {"title": str(record) if record else "Unknown"}

    # Validate scope
    if scope not in VALID_SCOPES:
        logger.warning(f"Invalid scope '{scope}', using 'entity_detail'")
        scope = "entity_detail"

    # Extract profile from record if not explicitly provided
    if not profile_name:
        meta = record.get("meta", {})
        if isinstance(meta, dict):
            profile_name = meta.get("profile")

    result: dict[str, Any] = {}

    # Resolve title (required, never blank)
    title_paths = get_paths_for_role_with_precedence("title", scope, org_config, profile_name)
    title = resolve_value(record, title_paths)

    # Title fallback: record.id
    if not title:
        title = record.get("id")

    # Ultimate fallback
    if not title:
        title = "Untitled"

    result["title"] = title

    # Resolve subtitle (optional)
    subtitle_paths = get_paths_for_role_with_precedence("subtitle", scope, org_config, profile_name)
    subtitle = resolve_value(record, subtitle_paths)
    if subtitle:
        result["subtitle"] = subtitle

    # Resolve thumbnail (optional)
    thumbnail_paths = get_paths_for_role_with_precedence("thumbnail", scope, org_config, profile_name)
    thumbnail_url = resolve_value(record, thumbnail_paths)
    if thumbnail_url:
        result["thumbnailUrl"] = thumbnail_url

    # Resolve snippet (optional, typically only for search scope)
    snippet_paths = get_paths_for_role_with_precedence("snippet", scope, org_config, profile_name)
    snippet = resolve_value(record, snippet_paths)
    if snippet:
        result["snippet"] = snippet

    return result


def resolve_display_fields_typed(
    record: dict[str, Any],
    scope: str,
    org_config: dict[str, Any] | None = None,
    profile_name: str | None = None,
) -> DisplayFields:
    """
    Resolve display fields and return as typed DisplayFields object.

    Same as resolve_display_fields() but returns typed object instead of dict.
    """
    result = resolve_display_fields(record, scope, org_config, profile_name)
    return DisplayFields(
        title=result["title"],
        subtitle=result.get("subtitle"),
        thumbnail_url=result.get("thumbnailUrl"),
        snippet=result.get("snippet"),
    )
