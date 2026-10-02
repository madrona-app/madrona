"""
Profile settings registry.

Authoritative definition of all profile settings with their types, defaults,
descriptions, and validation constraints. This module serves as the single
source of truth for profile settings structure and is used for:

1. Validation of setting reads/writes
2. Fallback defaults when settings are missing
3. Documentation of available settings
4. Type enforcement

All setting keys must be registered here to be used in the system.
"""

from typing import Any, Literal

# Type definitions for settings
SettingType = Literal["bool", "int", "text", "json", "enum", "string_list"]
SettingScope = Literal["export", "ai", "ui", "vocab", "ingestion"]


class SettingDefinition:
    """Definition of a single profile setting."""
    
    def __init__(
        self,
        key: str,
        scope: SettingScope,
        setting_type: SettingType,
        default_value: Any,
        description: str,
        allowed_values: list[Any] | None = None,
    ):
        self.key = key
        self.scope = scope
        self.setting_type = setting_type
        self.default_value = default_value
        self.description = description
        self.allowed_values = allowed_values
    
    def validate_value(self, value: Any) -> bool:
        """Validate that a value matches this setting's type and constraints."""
        # Type validation
        if self.setting_type == "bool" and not isinstance(value, bool):
            return False
        elif self.setting_type == "int" and not isinstance(value, int):
            return False
        elif self.setting_type == "text" and not isinstance(value, str):
            return False
        elif self.setting_type == "enum" and not isinstance(value, str):
            return False
        elif self.setting_type == "string_list" and not isinstance(value, list):
            return False
        elif self.setting_type == "json":
            # JSON can be any serializable type
            pass
        
        # Constraint validation
        if self.allowed_values and value not in self.allowed_values:
            return False
        
        return True


# Registry of all available profile settings
SETTING_DEFINITIONS: dict[str, SettingDefinition] = {
    "export.formats.enabled": SettingDefinition(
        key="export.formats.enabled",
        scope="export",
        setting_type="string_list",
        default_value=["jsonl", "json"],
        description="List of export formats available in the UI",
        allowed_values=None,  # Any format string is allowed
    ),
    "export.formats.default": SettingDefinition(
        key="export.formats.default",
        scope="export",
        setting_type="enum",
        default_value="jsonl",
        description="Default export format selected in the UI",
        allowed_values=["jsonl", "json", "dublin-core", "lido", "schema-org", "cdwa"],
    ),
    "ai.transformers.suggest": SettingDefinition(
        key="ai.transformers.suggest",
        scope="ai",
        setting_type="string_list",
        default_value=[],
        description="List of transformer formats to suggest in AI generation UI",
        allowed_values=None,  # Any format string is allowed
    ),
    "ui.timezone": SettingDefinition(
        key="ui.timezone",
        scope="ui",
        setting_type="text",
        default_value="America/New_York",
        description="IANA timezone identifier for displaying dates and times",
        allowed_values=None,  # Any valid IANA timezone identifier
    ),
    # Future settings can be added here:
    # "ui.theme": SettingDefinition(...),
    # "vocab.controlled_terms_enabled": SettingDefinition(...),
    # "ingestion.auto_classify": SettingDefinition(...),
}


def get_setting_definition(key: str) -> SettingDefinition | None:
    """Get the definition for a setting key."""
    return SETTING_DEFINITIONS.get(key)


def get_default_value(key: str) -> Any:
    """Get the default value for a setting key."""
    definition = get_setting_definition(key)
    if not definition:
        raise ValueError(f"Unknown setting key: {key}")
    return definition.default_value


def validate_setting(key: str, value: Any) -> bool:
    """Validate a setting key/value pair."""
    definition = get_setting_definition(key)
    if not definition:
        return False
    return definition.validate_value(value)


def list_settings_by_scope(scope: SettingScope) -> list[SettingDefinition]:
    """List all setting definitions for a given scope."""
    return [
        definition
        for definition in SETTING_DEFINITIONS.values()
        if definition.scope == scope
    ]


def list_all_settings() -> list[SettingDefinition]:
    """List all registered setting definitions."""
    return list(SETTING_DEFINITIONS.values())
