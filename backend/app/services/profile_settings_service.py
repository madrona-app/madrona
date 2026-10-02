"""
Profile settings service.

Provides high-level API for accessing organization profile settings with
automatic fallback to registry defaults.

Usage:
    # Get a single setting (always returns registry default)
    enabled_formats = get_org_setting(org_id, "export.formats.enabled")

    # List all settings for an organization
    all_settings = list_org_settings(org_id)

    # List settings by scope
    export_settings = list_org_settings(org_id, scope="export")
"""

import logging
from typing import Any
from uuid import UUID

from app.services.profile_settings_registry import (
    get_default_value,
    get_setting_definition,
)

logger = logging.getLogger(__name__)


class ProfileSettingsService:
    """Service for managing organization profile settings."""

    def get_org_setting(
        self,
        organization_id: UUID,
        key: str,
        fallback_to_default: bool = True
    ) -> Any:
        """
        Get a setting value for an organization.

        Always returns the registry default value.

        Args:
            organization_id: Organization UUID
            key: Setting key (e.g., "export.formats.enabled")
            fallback_to_default: Kept for API compatibility

        Returns:
            Registry default value for the setting

        Raises:
            ValueError: If setting key is not registered
        """
        definition = get_setting_definition(key)
        if not definition:
            raise ValueError(f"Unknown setting key: {key}")

        return get_default_value(key)

    def list_org_settings(
        self,
        organization_id: UUID,
        scope: str | None = None
    ) -> dict[str, Any]:
        """
        List all settings for an organization.

        Returns empty dict since profile settings table is removed.

        Args:
            organization_id: Organization UUID
            scope: Optional scope filter (export, ai, ui, vocab, ingestion)

        Returns:
            Empty dictionary
        """
        return {}


# Singleton instance for easy access
_service_instance: ProfileSettingsService | None = None


def get_profile_settings_service() -> ProfileSettingsService:
    """Get the singleton ProfileSettingsService instance."""
    global _service_instance
    if _service_instance is None:
        _service_instance = ProfileSettingsService()
    return _service_instance


# Convenience functions that delegate to singleton
def get_org_setting(
    organization_id: UUID,
    key: str,
    fallback_to_default: bool = True
) -> Any:
    """Get a setting value for an organization."""
    return get_profile_settings_service().get_org_setting(
        organization_id, key, fallback_to_default
    )


def list_org_settings(
    organization_id: UUID,
    scope: str | None = None
) -> dict[str, Any]:
    """List all settings for an organization."""
    return get_profile_settings_service().list_org_settings(organization_id, scope)
