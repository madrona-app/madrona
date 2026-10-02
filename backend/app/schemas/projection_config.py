"""
Madrona Projection Config v1 - Validation and Defaults.

This module defines the schema and validation for organization-level projection
configuration. Projections control how entity data is displayed (title, subtitle,
thumbnail, snippet) across entity detail, list, and search views.

DESIGN PRINCIPLES:
    1. Single JSONB blob per organization (stored in organizations.display_projections)
    2. Strict validation on write (PUT rejects invalid)
    3. Safe fallback on read (invalid stored config → log + use defaults)
    4. Path allowlist enforced (no extensions.*, no unknown prefixes)

CONFIG SCHEMA:
    {
        "version": "1.0",
        "profiles": {
            "entity_detail": { "title": [...], "subtitle": [...], "thumbnail": [...] },
            "entities_list": { "title": [...], "subtitle": [...], "thumbnail": [...] },
            "search": { "title": [...], "subtitle": [...], "snippet": [...], "thumbnail": [...] }
        }
    }

PRECEDENCE (resolved in service layer):
    Dataset projection → Org profile → System defaults

USAGE:
    from app.schemas.projection_config import (
        validate_projection_config,
        get_default_projection_config,
        normalize_projection_config,
        get_effective_projection,
    )

    # On PUT: validate strictly
    validated = validate_projection_config(user_input)  # raises ValidationError if invalid

    # On GET: normalize safely with fallback
    config = normalize_projection_config(org.display_projections)  # always returns valid config
"""

from __future__ import annotations

import logging
import re
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

logger = logging.getLogger(__name__)


# =============================================================================
# CONSTANTS
# =============================================================================

CURRENT_VERSION = "1.0"

VALID_SCOPES = frozenset({"entity_detail", "entities_list", "search"})

VALID_ROLES = frozenset({"title", "subtitle", "thumbnail", "snippet"})

# Required roles per scope (all scopes require title)
REQUIRED_ROLES = {
    "entity_detail": {"title"},
    "entities_list": {"title"},
    "search": {"title"},
}

# Allowed path prefixes - strictly enforced
# Paths must start with one of these (exact match or with dot/bracket suffix)
ALLOWED_PATH_PREFIXES = frozenset({
    "label",
    "description",
    "type",
    "id",
    "properties",
    "media",
    "identifiers",
    "classifications",
})

# Explicitly disallowed prefixes
DISALLOWED_PATH_PREFIXES = frozenset({
    "extensions",
})

# Regex pattern for valid path format
# Allows: label, properties.title, media[0].url, media[role=thumbnail].url, identifiers.0.value
PATH_PATTERN = re.compile(
    r'^[a-zA-Z_][a-zA-Z0-9_]*'  # Start with identifier
    r'(?:'
    r'\.[a-zA-Z_][a-zA-Z0-9_]*'  # .property
    r'|\[\d+\]'  # [0] array index
    r'|\[[a-zA-Z_][a-zA-Z0-9_]*=[^\]]+\]'  # [role=thumbnail] predicate
    r')*$'
)


# =============================================================================
# DEFAULT CONFIGURATION
# =============================================================================

DEFAULT_FALLBACKS = {
    "title": ["label", "properties.title", "id"],
    "subtitle": ["type"],
    "thumbnail": ["media[role=thumbnail].url"],
    "snippet": ["description"],
}


def get_default_projection_config() -> dict[str, Any]:
    """
    Return the system default projection configuration.

    This is used when:
    - Organization has no display_projections configured (NULL)
    - Organization has invalid display_projections (fallback with logging)

    Returns:
        Complete valid projection config with all scopes and default paths.
    """
    return {
        "version": CURRENT_VERSION,
        "profiles": {
            "entity_detail": {
                "title": DEFAULT_FALLBACKS["title"].copy(),
                "subtitle": DEFAULT_FALLBACKS["subtitle"].copy(),
                "thumbnail": DEFAULT_FALLBACKS["thumbnail"].copy(),
            },
            "entities_list": {
                "title": DEFAULT_FALLBACKS["title"].copy(),
                "subtitle": DEFAULT_FALLBACKS["subtitle"].copy(),
                "thumbnail": DEFAULT_FALLBACKS["thumbnail"].copy(),
            },
            "search": {
                "title": DEFAULT_FALLBACKS["title"].copy(),
                "subtitle": DEFAULT_FALLBACKS["subtitle"].copy(),
                "snippet": DEFAULT_FALLBACKS["snippet"].copy(),
                "thumbnail": DEFAULT_FALLBACKS["thumbnail"].copy(),
            },
        },
    }


# =============================================================================
# VALIDATION ERROR
# =============================================================================

class ProjectionConfigValidationError(ValueError):
    """Raised when projection config validation fails."""

    def __init__(self, message: str, field: str | None = None, details: dict | None = None):
        self.message = message
        self.field = field
        self.details = details or {}
        super().__init__(message)

    def to_dict(self) -> dict:
        """Convert to JSON-serializable dict for API responses."""
        result = {"error": self.message}
        if self.field:
            result["field"] = self.field
        if self.details:
            result["details"] = self.details
        return result


# =============================================================================
# PATH VALIDATION
# =============================================================================

def validate_path(path: str) -> tuple[bool, str | None]:
    """
    Validate a single field path against the allowlist.

    Args:
        path: Dot-notation path like "properties.title" or "media[0].url"

    Returns:
        Tuple of (is_valid, error_message)
    """
    if not path or not isinstance(path, str):
        return False, "Path must be a non-empty string"

    path = path.strip()
    if not path:
        return False, "Path must be a non-empty string"

    # Check path format
    if not PATH_PATTERN.match(path):
        return False, f"Invalid path format: '{path}'"

    # Extract the top-level prefix (before first dot or bracket)
    prefix_match = re.match(r'^([a-zA-Z_][a-zA-Z0-9_]*)', path)
    if not prefix_match:
        return False, f"Invalid path start: '{path}'"

    prefix = prefix_match.group(1)

    # Check against disallowed prefixes
    if prefix in DISALLOWED_PATH_PREFIXES:
        return False, f"Path prefix '{prefix}' is not allowed (extensions.* disallowed in v1)"

    # Check against allowed prefixes
    if prefix not in ALLOWED_PATH_PREFIXES:
        return False, f"Path prefix '{prefix}' is not allowed. Allowed: {', '.join(sorted(ALLOWED_PATH_PREFIXES))}"

    return True, None


def validate_paths(paths: list[str], role: str, scope: str) -> list[str]:
    """
    Validate a list of paths for a role.

    Args:
        paths: List of path strings
        role: Role name (title, subtitle, etc.)
        scope: Scope name (entity_detail, etc.)

    Returns:
        List of validation errors (empty if valid)
    """
    errors = []

    if not isinstance(paths, list):
        errors.append(f"{scope}.{role}: must be an array of strings")
        return errors

    for i, path in enumerate(paths):
        is_valid, error = validate_path(path)
        if not is_valid:
            errors.append(f"{scope}.{role}[{i}]: {error}")

    return errors


# =============================================================================
# PROFILE VALIDATION
# =============================================================================

def validate_profile(profile: dict, scope: str) -> list[str]:
    """
    Validate a single scope profile.

    Args:
        profile: Profile dict with role -> paths mapping
        scope: Scope name for error messages

    Returns:
        List of validation errors (empty if valid)
    """
    errors = []

    if not isinstance(profile, dict):
        errors.append(f"profiles.{scope}: must be an object")
        return errors

    # Check for unknown roles
    for role in profile.keys():
        if role not in VALID_ROLES:
            errors.append(f"profiles.{scope}.{role}: unknown role. Allowed: {', '.join(sorted(VALID_ROLES))}")

    # Check required roles
    required = REQUIRED_ROLES.get(scope, {"title"})
    for role in required:
        if role not in profile:
            errors.append(f"profiles.{scope}.{role}: required role is missing")
        elif not profile[role]:
            errors.append(f"profiles.{scope}.{role}: must have at least one path (cannot be empty)")

    # Validate paths for each role
    for role, paths in profile.items():
        if role in VALID_ROLES:
            errors.extend(validate_paths(paths, role, scope))

    return errors


# =============================================================================
# MAIN VALIDATION FUNCTION
# =============================================================================

def validate_projection_config(config: dict | None) -> dict[str, Any]:
    """
    Validate a projection configuration strictly.

    This is used for PUT requests - invalid config is rejected with detailed errors.

    Args:
        config: The projection config to validate

    Returns:
        The validated config (possibly with minor normalization)

    Raises:
        ProjectionConfigValidationError: If validation fails
    """
    if config is None:
        raise ProjectionConfigValidationError(
            "Configuration is required",
            field="config"
        )

    if not isinstance(config, dict):
        raise ProjectionConfigValidationError(
            "Configuration must be an object",
            field="config"
        )

    errors = []

    # Validate version
    version = config.get("version")
    if version is None:
        errors.append("version: required field is missing")
    elif version != CURRENT_VERSION:
        errors.append(f"version: must be '{CURRENT_VERSION}', got '{version}'")

    # Validate profiles exists
    profiles = config.get("profiles")
    if profiles is None:
        errors.append("profiles: required field is missing")
    elif not isinstance(profiles, dict):
        errors.append("profiles: must be an object")
    else:
        # Check for required scopes
        for scope in VALID_SCOPES:
            if scope not in profiles:
                errors.append(f"profiles.{scope}: required scope is missing")

        # Check for unknown scopes
        for scope in profiles.keys():
            if scope not in VALID_SCOPES:
                errors.append(f"profiles.{scope}: unknown scope. Allowed: {', '.join(sorted(VALID_SCOPES))}")

        # Validate each profile
        for scope, profile in profiles.items():
            if scope in VALID_SCOPES:
                errors.extend(validate_profile(profile, scope))

    if errors:
        raise ProjectionConfigValidationError(
            f"Projection config validation failed: {len(errors)} error(s)",
            details={"errors": errors}
        )

    return config


# =============================================================================
# NORMALIZATION (SAFE READ)
# =============================================================================

def normalize_projection_config(config: dict | None, org_id: str | None = None) -> dict[str, Any]:
    """
    Normalize a projection configuration, falling back to defaults on error.

    This is used for GET requests - invalid stored config triggers a warning log
    and returns defaults instead of failing.

    Args:
        config: The stored projection config (may be None or invalid)
        org_id: Optional org ID for logging context

    Returns:
        A valid, complete projection config (defaults if input was invalid)
    """
    if config is None:
        return get_default_projection_config()

    try:
        # Try strict validation first
        validate_projection_config(config)
        return config
    except ProjectionConfigValidationError as e:
        # Log the error and fall back to defaults
        org_context = f" for org {org_id}" if org_id else ""
        logger.warning(
            f"Invalid projection config{org_context}, using defaults: {e.message}",
            extra={"org_id": org_id, "errors": e.details.get("errors", [])}
        )
        return get_default_projection_config()


# =============================================================================
# PROFILE ACCESS HELPERS
# =============================================================================

def get_profile_for_scope(
    config: dict | None,
    scope: str,
    org_id: str | None = None
) -> dict[str, list[str]]:
    """
    Get the profile for a specific scope, with safe fallback.

    Args:
        config: The projection config (may be None or invalid)
        scope: The scope to get (entity_detail, entities_list, search)
        org_id: Optional org ID for logging context

    Returns:
        Profile dict with role -> paths mapping
    """
    normalized = normalize_projection_config(config, org_id)
    return normalized.get("profiles", {}).get(scope, {})


def get_paths_for_role(
    config: dict | None,
    scope: str,
    role: str,
    org_id: str | None = None
) -> list[str]:
    """
    Get the paths for a specific role in a scope, with safe fallback.

    Args:
        config: The projection config (may be None or invalid)
        scope: The scope (entity_detail, entities_list, search)
        role: The role (title, subtitle, thumbnail, snippet)
        org_id: Optional org ID for logging context

    Returns:
        List of paths for the role, or default fallback paths
    """
    profile = get_profile_for_scope(config, scope, org_id)
    paths = profile.get(role)

    if paths and isinstance(paths, list) and len(paths) > 0:
        return paths

    # Return default fallback for this role
    return DEFAULT_FALLBACKS.get(role, [])


# =============================================================================
# PYDANTIC MODELS (for API request/response serialization)
# =============================================================================

class ProfileConfig(BaseModel):
    """Configuration for a single scope profile."""
    title: list[str] = Field(..., min_length=1, description="Paths for title resolution (required, non-empty)")
    subtitle: list[str] = Field(default_factory=list, description="Paths for subtitle resolution")
    thumbnail: list[str] = Field(default_factory=list, description="Paths for thumbnail resolution")
    snippet: list[str] = Field(default_factory=list, description="Paths for snippet resolution (search only)")

    @field_validator("title", "subtitle", "thumbnail", "snippet", mode="before")
    @classmethod
    def validate_path_list(cls, v, info):
        if v is None:
            return []
        if not isinstance(v, list):
            raise ValueError(f"{info.field_name} must be a list of strings")
        return v

    @field_validator("title", "subtitle", "thumbnail", "snippet", mode="after")
    @classmethod
    def validate_paths(cls, v, info):
        errors = []
        for i, path in enumerate(v):
            is_valid, error = validate_path(path)
            if not is_valid:
                errors.append(f"{info.field_name}[{i}]: {error}")
        if errors:
            raise ValueError("; ".join(errors))
        return v


class ProjectionConfigModel(BaseModel):
    """Pydantic model for projection configuration."""
    version: str = Field(CURRENT_VERSION, description="Schema version (must be '1.0')")
    profiles: dict[str, ProfileConfig] = Field(..., description="Profiles by scope")

    @field_validator("version")
    @classmethod
    def validate_version(cls, v):
        if v != CURRENT_VERSION:
            raise ValueError(f"version must be '{CURRENT_VERSION}'")
        return v

    @model_validator(mode="after")
    def validate_required_scopes(self):
        missing = VALID_SCOPES - set(self.profiles.keys())
        if missing:
            raise ValueError(f"Missing required scopes: {', '.join(sorted(missing))}")
        unknown = set(self.profiles.keys()) - VALID_SCOPES
        if unknown:
            raise ValueError(f"Unknown scopes: {', '.join(sorted(unknown))}")
        return self
