"""
Semantic Role Validation

Provides SOFT validation for semantic role tagging.

Key Principle: Validation is INFORMATIONAL, not ENFORCING.
- Invalid roles produce warnings, not errors
- Missing roles are completely acceptable
- Unknown roles are passed through unchanged

This is intentionally permissive to support:
- Legacy data without roles
- Custom roles not in the standard list
- Gradual adoption of role tagging
"""

import logging
from typing import Any, Dict, List, Optional, Tuple
from dataclasses import dataclass, field

from app.schemas.semantic_roles import (
    SemanticRole,
    ROLE_QUALIFIERS,
    RoleTaggedValue,
    FieldRoleConfig,
    DEFAULT_FIELD_CONFIGS,
    normalize_value_with_role,
)

logger = logging.getLogger(__name__)


# ============================================================================
# VALIDATION RESULT
# ============================================================================

@dataclass
class ValidationWarning:
    """A non-fatal validation warning."""
    field: str
    message: str
    value: Any = None
    suggestion: Optional[str] = None

    def __str__(self) -> str:
        if self.suggestion:
            return f"{self.field}: {self.message} (suggestion: {self.suggestion})"
        return f"{self.field}: {self.message}"


@dataclass
class RoleValidationResult:
    """
    Result of semantic role validation.

    Note: This NEVER prevents data from being saved.
    Warnings are informational only.
    """
    valid: bool = True  # Always True - we never reject data
    warnings: List[ValidationWarning] = field(default_factory=list)
    normalized_values: List[RoleTaggedValue] = field(default_factory=list)

    def add_warning(
        self,
        field: str,
        message: str,
        value: Any = None,
        suggestion: str = None
    ):
        """Add a validation warning (informational only)."""
        self.warnings.append(ValidationWarning(
            field=field,
            message=message,
            value=value,
            suggestion=suggestion
        ))

    @property
    def has_warnings(self) -> bool:
        return len(self.warnings) > 0

    def to_dict(self) -> Dict[str, Any]:
        return {
            "valid": self.valid,
            "warning_count": len(self.warnings),
            "warnings": [str(w) for w in self.warnings],
        }


# ============================================================================
# VALIDATION FUNCTIONS
# ============================================================================

def validate_role(role: str) -> Tuple[bool, Optional[str]]:
    """
    Check if a role is in the known role list.

    Returns:
        Tuple of (is_known, suggestion)
        - is_known: True if role is in SemanticRole enum
        - suggestion: Closest match if not known, None if known
    """
    # Check if it's a known role
    known_roles = {r.value for r in SemanticRole}
    if role in known_roles:
        return (True, None)

    # Find closest match for suggestion
    role_lower = role.lower().replace("-", "_").replace(" ", "_")

    # Direct match after normalization
    if role_lower in known_roles:
        return (False, role_lower)

    # Partial match
    for known in known_roles:
        if role_lower in known or known in role_lower:
            return (False, known)

    return (False, None)


def validate_qualifier(role: str, qualifier: str) -> Tuple[bool, Optional[str]]:
    """
    Check if a qualifier is suggested for a role.

    Returns:
        Tuple of (is_suggested, suggestion)
    """
    try:
        role_enum = SemanticRole(role)
    except ValueError:
        # Unknown role - can't validate qualifier
        return (True, None)

    suggested = ROLE_QUALIFIERS.get(role_enum, [])
    if not suggested:
        # No suggestions for this role - anything is fine
        return (True, None)

    if qualifier in suggested:
        return (True, None)

    # Find closest match
    qualifier_lower = qualifier.lower().replace("-", "_").replace(" ", "_")
    for s in suggested:
        if qualifier_lower in s or s in qualifier_lower:
            return (False, s)

    return (False, suggested[0] if suggested else None)


def validate_value_roles(
    value: Any,
    field_name: str = None,
    config: FieldRoleConfig = None
) -> RoleValidationResult:
    """
    Validate semantic roles on a single value.

    This is SOFT validation - it produces warnings but never rejects data.

    Args:
        value: The value to validate (any format)
        field_name: Optional field name for context
        config: Optional field configuration

    Returns:
        RoleValidationResult with any warnings
    """
    result = RoleValidationResult()

    # Normalize the value
    normalized = normalize_value_with_role(value, field_name)
    result.normalized_values.append(normalized)

    # If no role, that's completely fine
    if not normalized.role:
        return result

    # Check if role is known
    is_known, suggestion = validate_role(normalized.role)
    if not is_known:
        result.add_warning(
            field=field_name or "value",
            message=f"Unknown role '{normalized.role}'",
            value=normalized.value,
            suggestion=suggestion
        )

    # Check qualifier if present
    if normalized.role_qualifier:
        is_suggested, qual_suggestion = validate_qualifier(
            normalized.role,
            normalized.role_qualifier
        )
        if not is_suggested:
            result.add_warning(
                field=field_name or "value",
                message=f"Unusual qualifier '{normalized.role_qualifier}' for role '{normalized.role}'",
                value=normalized.value,
                suggestion=qual_suggestion
            )

    # Check if role matches field's expected role
    if config and config.default_role:
        if normalized.role != config.default_role:
            # Not a warning - just informational
            logger.debug(
                f"Value has role '{normalized.role}' but field '{field_name}' "
                f"typically uses '{config.default_role}'"
            )

    # Check authority sources
    if config and normalized.authorities and config.suggested_authority_sources:
        for auth in normalized.authorities:
            source = auth.get("source")
            if source and source not in config.suggested_authority_sources:
                result.add_warning(
                    field=field_name or "value",
                    message=f"Authority source '{source}' not typical for this field",
                    value=normalized.value,
                    suggestion=f"Consider: {', '.join(config.suggested_authority_sources)}"
                )

    return result


def validate_field_values(
    values: List[Any],
    field_name: str
) -> RoleValidationResult:
    """
    Validate semantic roles on a list of field values.

    Args:
        values: List of values to validate
        field_name: Field name for context and configuration lookup

    Returns:
        Combined RoleValidationResult
    """
    result = RoleValidationResult()
    config = DEFAULT_FIELD_CONFIGS.get(field_name)

    for value in values:
        value_result = validate_value_roles(value, field_name, config)
        result.warnings.extend(value_result.warnings)
        result.normalized_values.extend(value_result.normalized_values)

    return result


def validate_object_roles(
    data: Dict[str, Any],
    fields: List[str] = None
) -> Dict[str, RoleValidationResult]:
    """
    Validate semantic roles across multiple fields of an object.

    Args:
        data: Object data dictionary
        fields: List of fields to validate (default: all known fields)

    Returns:
        Dict mapping field names to validation results
    """
    if fields is None:
        fields = list(DEFAULT_FIELD_CONFIGS.keys())

    results = {}

    for field_name in fields:
        if field_name not in data:
            continue

        value = data[field_name]

        # Handle both single values and lists
        if isinstance(value, list):
            results[field_name] = validate_field_values(value, field_name)
        else:
            results[field_name] = validate_value_roles(
                value,
                field_name,
                DEFAULT_FIELD_CONFIGS.get(field_name)
            )

    return results


# ============================================================================
# NORMALIZATION FUNCTIONS
# ============================================================================

def normalize_object_roles(
    data: Dict[str, Any],
    apply_defaults: bool = True
) -> Dict[str, Any]:
    """
    Normalize semantic roles across an object's fields.

    This converts various input formats to consistent RoleTaggedValue format,
    optionally applying default roles from field configuration.

    Args:
        data: Object data dictionary
        apply_defaults: Whether to apply default roles from field config

    Returns:
        Normalized data dictionary
    """
    result = dict(data)

    for field_name, config in DEFAULT_FIELD_CONFIGS.items():
        if field_name not in data:
            continue

        value = data[field_name]

        # Determine default role
        default_role = config.default_role if apply_defaults else None

        # Handle lists
        if isinstance(value, list):
            result[field_name] = [
                normalize_value_with_role(v, field_name, default_role).model_dump(
                    exclude_none=True
                )
                for v in value
            ]
        elif value is not None:
            result[field_name] = normalize_value_with_role(
                value, field_name, default_role
            ).model_dump(exclude_none=True)

    return result


def strip_roles(data: Dict[str, Any]) -> Dict[str, Any]:
    """
    Strip semantic role hints from data, leaving only values.

    Useful for backward compatibility with systems that don't understand roles.

    Args:
        data: Object data dictionary with role-tagged values

    Returns:
        Data with roles stripped, keeping only value/name/term
    """
    result = dict(data)

    for field_name in DEFAULT_FIELD_CONFIGS.keys():
        if field_name not in data:
            continue

        value = data[field_name]

        if isinstance(value, list):
            result[field_name] = [
                _extract_simple_value(v) for v in value
            ]
        elif isinstance(value, dict):
            result[field_name] = _extract_simple_value(value)

    return result


def _extract_simple_value(value: Any) -> Any:
    """Extract simple value from role-tagged format."""
    if isinstance(value, dict):
        # Return just the value, preserving authorities if present
        simple = {
            "value": value.get("value") or value.get("name") or value.get("term")
        }
        if value.get("authorities"):
            simple["authorities"] = value["authorities"]
        if value.get("note"):
            simple["note"] = value["note"]
        return simple
    return value
