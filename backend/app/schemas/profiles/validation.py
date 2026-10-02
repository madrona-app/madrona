"""
Profile Validation

Functions for validating canonical records against profiles.
"""

import re
from typing import Any, Optional, Union
from urllib.parse import urlparse

from .base import (
    Profile,
    PropertySchema,
    PropertyType,
    ValidationIssue,
    ValidationResult,
    ValidationSeverity,
    ProfileValidationError,
)
from .registry import get_profile_or_raise, resolve_profile_with_inheritance


def validate_against_profile(
    record: dict,
    profile_name: str,
    strict: bool = False,
    resolve_inheritance: bool = True,
) -> ValidationResult:
    """
    Validate a canonical record against a profile.

    Args:
        record: The canonical record as a dictionary
        profile_name: Name of the profile to validate against
        strict: If True, raise ProfileValidationError on validation failure
        resolve_inheritance: If True, include inherited properties from parent profiles

    Returns:
        ValidationResult with all issues found

    Raises:
        ProfileValidationError: If strict=True and validation fails
        KeyError: If profile_name is not found
    """
    if resolve_inheritance:
        profile = resolve_profile_with_inheritance(profile_name)
    else:
        profile = get_profile_or_raise(profile_name)

    issues: list[ValidationIssue] = []
    properties = record.get("properties", {})

    # Check canonical type constraint
    if profile.canonical_type:
        record_type = record.get("type")
        if record_type != profile.canonical_type:
            issues.append(ValidationIssue(
                field="type",
                message=f"Profile '{profile_name}' requires type '{profile.canonical_type}', got '{record_type}'",
                severity=ValidationSeverity.ERROR,
                rule="canonical_type_match",
                value=record_type,
            ))

    # Check required properties
    issues.extend(check_required_properties(properties, profile))

    # Check recommended properties (warnings)
    issues.extend(check_recommended_properties(properties, profile))

    # Validate property schemas
    for prop_name, prop_value in properties.items():
        schema = profile.get_property_schema(prop_name)
        if schema:
            prop_issues = validate_property(prop_name, prop_value, schema)
            issues.extend(prop_issues)

    # Check relationships
    relationships = record.get("relationships", [])
    issues.extend(check_relationships(relationships, profile))

    # Run custom validation rules
    for rule in profile.validation_rules:
        try:
            is_valid, message = rule.check(record)
            if not is_valid:
                issues.append(ValidationIssue(
                    field="record",
                    message=message,
                    severity=rule.severity,
                    rule=rule.name,
                ))
        except Exception as e:
            issues.append(ValidationIssue(
                field="record",
                message=f"Validation rule '{rule.name}' raised exception: {e}",
                severity=ValidationSeverity.WARNING,
                rule=rule.name,
            ))

    # Build result
    has_errors = any(i.severity == ValidationSeverity.ERROR for i in issues)
    result = ValidationResult(
        is_valid=not has_errors,
        profile_name=profile.name,
        profile_version=profile.version,
        issues=issues,
    )

    if strict and not result.is_valid:
        raise ProfileValidationError(result)

    return result


def check_required_properties(
    properties: dict,
    profile: Profile,
) -> list[ValidationIssue]:
    """
    Check that all required properties exist.

    Args:
        properties: The properties dict from a canonical record
        profile: The profile to check against

    Returns:
        List of validation issues for missing required properties
    """
    issues = []

    for prop_name in profile.required_properties:
        if prop_name not in properties:
            issues.append(ValidationIssue(
                field=f"properties.{prop_name}",
                message=f"Required property '{prop_name}' is missing",
                severity=ValidationSeverity.ERROR,
                rule="required_property",
            ))
        elif properties[prop_name] is None:
            issues.append(ValidationIssue(
                field=f"properties.{prop_name}",
                message=f"Required property '{prop_name}' is null",
                severity=ValidationSeverity.ERROR,
                rule="required_property_not_null",
                value=None,
            ))
        elif isinstance(properties[prop_name], str) and not properties[prop_name].strip():
            issues.append(ValidationIssue(
                field=f"properties.{prop_name}",
                message=f"Required property '{prop_name}' is empty",
                severity=ValidationSeverity.ERROR,
                rule="required_property_not_empty",
                value=properties[prop_name],
            ))

    return issues


def check_recommended_properties(
    properties: dict,
    profile: Profile,
) -> list[ValidationIssue]:
    """
    Check recommended properties (warnings only).

    Args:
        properties: The properties dict from a canonical record
        profile: The profile to check against

    Returns:
        List of validation warnings for missing recommended properties
    """
    issues = []

    for prop_name in profile.recommended_properties:
        if prop_name not in properties or properties[prop_name] is None:
            issues.append(ValidationIssue(
                field=f"properties.{prop_name}",
                message=f"Recommended property '{prop_name}' is missing",
                severity=ValidationSeverity.WARNING,
                rule="recommended_property",
            ))

    return issues


def validate_property(
    prop_name: str,
    value: Any,
    schema: PropertySchema,
) -> list[ValidationIssue]:
    """
    Validate a single property value against its schema.

    Args:
        prop_name: The property name
        value: The property value
        schema: The PropertySchema to validate against

    Returns:
        List of validation issues found
    """
    issues = []

    if value is None:
        # Null values handled by required/recommended checks
        return issues

    # Type validation
    type_issue = validate_property_type(prop_name, value, schema.type)
    if type_issue:
        issues.append(type_issue)
        # Skip further validation if type is wrong
        return issues

    # String-specific validations
    if schema.type == PropertyType.STRING and isinstance(value, str):
        if schema.min_length is not None and len(value) < schema.min_length:
            issues.append(ValidationIssue(
                field=f"properties.{prop_name}",
                message=f"String length {len(value)} is less than minimum {schema.min_length}",
                severity=ValidationSeverity.ERROR,
                rule="min_length",
                value=value,
            ))

        if schema.max_length is not None and len(value) > schema.max_length:
            issues.append(ValidationIssue(
                field=f"properties.{prop_name}",
                message=f"String length {len(value)} exceeds maximum {schema.max_length}",
                severity=ValidationSeverity.ERROR,
                rule="max_length",
                value=value,
            ))

        if schema.pattern is not None:
            if not re.match(schema.pattern, value):
                issues.append(ValidationIssue(
                    field=f"properties.{prop_name}",
                    message=f"Value does not match pattern '{schema.pattern}'",
                    severity=ValidationSeverity.ERROR,
                    rule="pattern",
                    value=value,
                ))

    # Numeric validations
    if schema.type in (PropertyType.INTEGER, PropertyType.FLOAT):
        if schema.min_value is not None and value < schema.min_value:
            issues.append(ValidationIssue(
                field=f"properties.{prop_name}",
                message=f"Value {value} is less than minimum {schema.min_value}",
                severity=ValidationSeverity.ERROR,
                rule="min_value",
                value=value,
            ))

        if schema.max_value is not None and value > schema.max_value:
            issues.append(ValidationIssue(
                field=f"properties.{prop_name}",
                message=f"Value {value} exceeds maximum {schema.max_value}",
                severity=ValidationSeverity.ERROR,
                rule="max_value",
                value=value,
            ))

    # Allowed values (enum) validation
    if schema.allowed_values is not None:
        if value not in schema.allowed_values:
            issues.append(ValidationIssue(
                field=f"properties.{prop_name}",
                message=f"Value '{value}' not in allowed values: {schema.allowed_values}",
                severity=ValidationSeverity.ERROR,
                rule="allowed_values",
                value=value,
            ))

    # URL validation
    if schema.type == PropertyType.URL and isinstance(value, str):
        url_issue = validate_url(prop_name, value)
        if url_issue:
            issues.append(url_issue)

    # Email validation
    if schema.type == PropertyType.EMAIL and isinstance(value, str):
        email_issue = validate_email(prop_name, value)
        if email_issue:
            issues.append(email_issue)

    return issues


def validate_property_type(
    prop_name: str,
    value: Any,
    expected_type: PropertyType,
) -> Optional[ValidationIssue]:
    """
    Validate that a value matches the expected type.

    Args:
        prop_name: The property name
        value: The value to check
        expected_type: The expected PropertyType

    Returns:
        ValidationIssue if type doesn't match, None otherwise
    """
    type_checks = {
        PropertyType.STRING: lambda v: isinstance(v, str),
        PropertyType.INTEGER: lambda v: isinstance(v, int) and not isinstance(v, bool),
        PropertyType.FLOAT: lambda v: isinstance(v, (int, float)) and not isinstance(v, bool),
        PropertyType.BOOLEAN: lambda v: isinstance(v, bool),
        PropertyType.ARRAY: lambda v: isinstance(v, list),
        PropertyType.OBJECT: lambda v: isinstance(v, dict),
        PropertyType.DATE: lambda v: isinstance(v, str),  # Flexible date strings
        PropertyType.DATETIME: lambda v: isinstance(v, str),
        PropertyType.URL: lambda v: isinstance(v, str),
        PropertyType.EMAIL: lambda v: isinstance(v, str),
    }

    check = type_checks.get(expected_type, lambda v: True)

    if not check(value):
        return ValidationIssue(
            field=f"properties.{prop_name}",
            message=f"Expected type '{expected_type.value}', got '{type(value).__name__}'",
            severity=ValidationSeverity.ERROR,
            rule="type_check",
            value=str(value)[:100],  # Truncate for readability
        )

    return None


def validate_url(prop_name: str, value: str) -> Optional[ValidationIssue]:
    """Validate that a string is a valid URL."""
    try:
        result = urlparse(value)
        if not all([result.scheme, result.netloc]):
            return ValidationIssue(
                field=f"properties.{prop_name}",
                message=f"Invalid URL format: '{value}'",
                severity=ValidationSeverity.WARNING,  # Warning, not error
                rule="url_format",
                value=value,
            )
    except Exception:
        return ValidationIssue(
            field=f"properties.{prop_name}",
            message=f"Invalid URL: '{value}'",
            severity=ValidationSeverity.WARNING,
            rule="url_format",
            value=value,
        )
    return None


def validate_email(prop_name: str, value: str) -> Optional[ValidationIssue]:
    """Validate that a string is a valid email format."""
    # Simple email regex - not exhaustive but catches most issues
    email_pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$'
    if not re.match(email_pattern, value):
        return ValidationIssue(
            field=f"properties.{prop_name}",
            message=f"Invalid email format: '{value}'",
            severity=ValidationSeverity.WARNING,
            rule="email_format",
            value=value,
        )
    return None


def check_relationships(
    relationships: list[dict],
    profile: Profile,
) -> list[ValidationIssue]:
    """
    Check that required relationships exist.

    Args:
        relationships: The relationships list from a canonical record
        profile: The profile to check against

    Returns:
        List of validation issues for missing or invalid relationships
    """
    issues = []

    for rel_schema in profile.relationships:
        if rel_schema.required:
            # Count relationships of this type to the target profile
            matching = [
                r for r in relationships
                if r.get("type") == rel_schema.relationship_type
            ]

            if not matching:
                issues.append(ValidationIssue(
                    field="relationships",
                    message=(
                        f"Required relationship '{rel_schema.relationship_type}' "
                        f"to '{rel_schema.target_profile}' is missing"
                    ),
                    severity=ValidationSeverity.ERROR,
                    rule="required_relationship",
                ))

        if rel_schema.max_count is not None:
            matching = [
                r for r in relationships
                if r.get("type") == rel_schema.relationship_type
            ]

            if len(matching) > rel_schema.max_count:
                issues.append(ValidationIssue(
                    field="relationships",
                    message=(
                        f"Relationship '{rel_schema.relationship_type}' has "
                        f"{len(matching)} instances, maximum is {rel_schema.max_count}"
                    ),
                    severity=ValidationSeverity.ERROR,
                    rule="max_relationship_count",
                ))

    return issues
