"""
Profile Registry

Central registry for all defined profiles. Profiles register themselves
when imported, making them available throughout the application.
"""

from typing import Optional

from .base import Profile


# Global profile registry
PROFILE_REGISTRY: dict[str, Profile] = {}


def register_profile(profile: Profile) -> None:
    """
    Register a profile in the global registry.

    Args:
        profile: The Profile instance to register

    Raises:
        ValueError: If a profile with the same name is already registered
    """
    if profile.name in PROFILE_REGISTRY:
        existing = PROFILE_REGISTRY[profile.name]
        if existing.version != profile.version:
            raise ValueError(
                f"Profile '{profile.name}' already registered with version "
                f"{existing.version}, cannot register version {profile.version}"
            )
        # Same version, skip (idempotent)
        return

    # If profile extends another, validate parent exists
    if profile.extends:
        if profile.extends not in PROFILE_REGISTRY:
            raise ValueError(
                f"Profile '{profile.name}' extends '{profile.extends}', "
                f"but parent profile is not registered"
            )

    PROFILE_REGISTRY[profile.name] = profile


def get_profile(name: str) -> Optional[Profile]:
    """
    Get a profile by name.

    Args:
        name: The profile name

    Returns:
        The Profile instance, or None if not found
    """
    return PROFILE_REGISTRY.get(name)


def get_profile_or_raise(name: str) -> Profile:
    """
    Get a profile by name, raising if not found.

    Args:
        name: The profile name

    Returns:
        The Profile instance

    Raises:
        KeyError: If profile is not found
    """
    profile = get_profile(name)
    if profile is None:
        available = list(PROFILE_REGISTRY.keys())
        raise KeyError(
            f"Profile '{name}' not found. Available profiles: {available}"
        )
    return profile


def list_profiles() -> list[str]:
    """
    List all registered profile names.

    Returns:
        List of profile names
    """
    return list(PROFILE_REGISTRY.keys())


def get_all_profiles() -> dict[str, Profile]:
    """
    Get all registered profiles.

    Returns:
        Dictionary of profile name to Profile instance
    """
    return dict(PROFILE_REGISTRY)


def resolve_profile_with_inheritance(name: str) -> Profile:
    """
    Resolve a profile, merging in inherited properties from parent profiles.

    Args:
        name: The profile name

    Returns:
        A Profile with all inherited properties merged in

    Note:
        This creates a new Profile instance with merged properties.
        The original profile in the registry is not modified.
    """
    profile = get_profile_or_raise(name)

    if not profile.extends:
        return profile

    # Recursively resolve parent
    parent = resolve_profile_with_inheritance(profile.extends)

    # Merge properties (child overrides parent)
    merged_required = list(set(parent.required_properties + profile.required_properties))
    merged_recommended = list(set(parent.recommended_properties + profile.recommended_properties))
    merged_optional = list(set(parent.optional_properties + profile.optional_properties))

    # Merge schemas (child overrides parent)
    merged_schemas = {**parent.property_schemas, **profile.property_schemas}

    # Merge relationships (combine both)
    merged_relationships = parent.relationships + profile.relationships

    # Merge validation rules (combine both)
    merged_rules = parent.validation_rules + profile.validation_rules

    return Profile(
        name=profile.name,
        version=profile.version,
        description=profile.description,
        extends=profile.extends,
        required_properties=merged_required,
        recommended_properties=merged_recommended,
        optional_properties=merged_optional,
        property_schemas=merged_schemas,
        relationships=merged_relationships,
        validation_rules=merged_rules,
        canonical_type=profile.canonical_type or parent.canonical_type,
    )
