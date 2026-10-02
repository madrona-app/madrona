"""
Internal role definitions and inheritance for Madrona.

Contains the InternalRole enum, role inheritance map, display labels,
and related helper functions.
"""
from __future__ import annotations

from enum import Enum
from typing import Dict, List

__all__ = [
    "InternalRole",
    "ROLE_INHERITANCE_MAP",
    "ROLE_LABELS",
    "get_role_inheritance_chain",
    "validate_role_inheritance",
    "get_role_label",
]


# ==================== Internal Role Definitions ====================
# Stable internal role identifiers that NEVER change
# These are NOT user-facing labels

class InternalRole(str, Enum):
    """
    Internal role identifiers with stable IDs.

    These role IDs are INTERNAL and must never change.
    They map to permission sets and are independent of user-facing labels.

    User-facing labels are defined in the role_profiles DB table and
    can be overridden per-organization via org_role_labels.

    Role Hierarchy (inheritance chain):
    viewer → publisher → curator → registrar → admin → platform_admin

    Each role inherits all permissions from roles below it in the hierarchy.
    platform_admin is the only role with platform.admin access.
    """

    PLATFORM_ADMIN = "platform_admin"
    """Platform administrator - Cross-org provisioning and platform management"""

    ORG_ADMIN = "admin"
    """Organization administrator - Full access to all organization features"""

    DATA_ENGINEER = "registrar"
    """Registrar - Configure connectors, routes, and mappings"""

    DATA_ANALYST = "curator"
    """Curator - Execute runs and query/export data"""

    DATA_PUBLISHER = "publisher"
    """Publisher - Execute runs and export data (no query)"""

    VIEWER = "viewer"
    """Viewer - Read-only access to data and runs"""


# ==================== Role Inheritance Map ====================
# Defines role hierarchy for permission inheritance

ROLE_INHERITANCE_MAP: Dict[str, str | None] = {
    # Role hierarchy (child → parent):
    # viewer is the base role (no parent)
    InternalRole.VIEWER.value: None,
    # publisher inherits from viewer
    InternalRole.DATA_PUBLISHER.value: InternalRole.VIEWER.value,
    # curator inherits from publisher (and transitively from viewer)
    InternalRole.DATA_ANALYST.value: InternalRole.DATA_PUBLISHER.value,
    # registrar inherits from curator (and all below)
    InternalRole.DATA_ENGINEER.value: InternalRole.DATA_ANALYST.value,
    # admin inherits from registrar (and all below)
    InternalRole.ORG_ADMIN.value: InternalRole.DATA_ENGINEER.value,
    # platform_admin inherits from admin (and all below) + gets platform.admin
    InternalRole.PLATFORM_ADMIN.value: InternalRole.ORG_ADMIN.value,
}


def get_role_inheritance_chain(role_key: str) -> List[str]:
    """
    Get the full inheritance chain for a role (includes the role itself).

    Returns roles in order from most specific to most general.
    Example: registrar → [registrar, curator, publisher, viewer]

    Args:
        role_key: Internal role identifier

    Returns:
        List of role keys in inheritance order (self first, ancestors after)

    Raises:
        ValueError: If role_key is not in inheritance map or cycle detected
    """
    if role_key not in ROLE_INHERITANCE_MAP:
        raise ValueError(f"Unknown role: {role_key}")

    chain = [role_key]
    visited = {role_key}
    current = role_key

    # Walk up the inheritance chain
    while ROLE_INHERITANCE_MAP[current] is not None:
        parent = ROLE_INHERITANCE_MAP[current]

        # Detect cycles
        if parent in visited:
            raise ValueError(f"Cycle detected in role inheritance: {' → '.join(chain)} → {parent}")

        chain.append(parent)
        visited.add(parent)
        current = parent

        # Safety: prevent infinite loops
        if len(chain) > 10:
            raise ValueError(f"Role inheritance chain too long (possible cycle): {' → '.join(chain)}")

    return chain


def validate_role_inheritance() -> bool:
    """
    Validate that role inheritance map is well-formed (no cycles, all roles present).

    Returns:
        True if valid

    Raises:
        ValueError: If validation fails
    """
    # Check all internal roles are in the map
    for role in InternalRole:
        if role.value not in ROLE_INHERITANCE_MAP:
            raise ValueError(f"Role {role.value} missing from ROLE_INHERITANCE_MAP")

    # Check for orphaned roles in map
    valid_roles = {role.value for role in InternalRole}
    for role_key, parent_key in ROLE_INHERITANCE_MAP.items():
        if role_key not in valid_roles:
            raise ValueError(f"Unknown role in inheritance map: {role_key}")
        if parent_key is not None and parent_key not in valid_roles:
            raise ValueError(f"Unknown parent role in inheritance map: {parent_key}")

    # Validate each role's inheritance chain (will raise on cycles)
    for role in InternalRole:
        get_role_inheritance_chain(role.value)

    return True


# ==================== Role Display Labels ====================
# Canonical display labels for museum roles.
# The role_profiles DB table is the primary source; this is the fallback.

ROLE_LABELS: Dict[str, str] = {
    InternalRole.PLATFORM_ADMIN.value: "Platform Administrator",
    InternalRole.ORG_ADMIN.value: "Organization Administrator",
    InternalRole.DATA_ENGINEER.value: "Registrar",
    InternalRole.DATA_ANALYST.value: "Curator",
    InternalRole.DATA_PUBLISHER.value: "Publisher",
    InternalRole.VIEWER.value: "Viewer",
}


def get_role_label(role_key: str) -> str:
    """
    Get display label for a role.

    Args:
        role_key: Internal role identifier ('admin', 'registrar', etc.)

    Returns:
        Display label for the role
    """
    return ROLE_LABELS.get(role_key, role_key.replace('_', ' ').title())
