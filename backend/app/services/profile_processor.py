"""
Profile processor service for validating and enriching records against profiles.

Handles:
- Validating canonical records against configured profiles
- Applying enrichments to fix common validation issues
- Setting profile metadata on validated records
- Supporting different validation modes (strict, warn, none)
"""

import logging
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from app.schemas.profiles import (
    get_profile,
    validate_against_profile,
    ValidationResult,
)
from app.schemas.profiles.base import ValidationSeverity

logger = logging.getLogger(__name__)


@dataclass
class ProfileProcessingResult:
    """Result of processing records against a profile."""
    total_records: int = 0
    valid_count: int = 0
    invalid_count: int = 0
    enriched_count: int = 0
    rejected_records: list[dict] = field(default_factory=list)
    validation_issues: list[dict] = field(default_factory=list)


class ProfileValidationError(Exception):
    """Raised when profile validation fails in strict mode."""

    def __init__(self, message: str, issues: list[dict] = None):
        super().__init__(message)
        self.issues = issues or []


def get_profile_validation_mode(pipeline) -> str:
    """
    Get the effective validation mode for a pipeline.

    Args:
        pipeline: Pipeline model instance

    Returns:
        Validation mode: 'strict', 'warn', or 'none'
    """
    if not pipeline.target_profile:
        return "none"
    return pipeline.profile_validation_mode or "warn"


def validate_record_against_profile(
    record: dict,
    profile_name: str,
    validation_mode: str = "warn",
) -> tuple[bool, ValidationResult | None]:
    """
    Validate a single record against a profile.

    Args:
        record: The canonical record dict (normalized output)
        profile_name: Name of the profile to validate against
        validation_mode: 'strict', 'warn', or 'none'

    Returns:
        Tuple of (is_valid, validation_result)
        - In 'none' mode, always returns (True, None)
        - In 'warn' mode, returns (True, result) even with errors
        - In 'strict' mode, returns (False, result) if there are errors
    """
    if validation_mode == "none":
        return True, None

    profile = get_profile(profile_name)
    if not profile:
        logger.warning(f"Profile '{profile_name}' not found, skipping validation")
        return True, None

    # Build a canonical-like structure for validation
    # The normalized record may be flat, so we need to adapt it
    validation_record = _prepare_record_for_validation(record, profile_name)

    result = validate_against_profile(validation_record, profile_name)

    if validation_mode == "strict":
        return result.is_valid, result
    else:  # warn mode
        if not result.is_valid:
            logger.warning(
                f"Record '{record.get('entity_key', 'unknown')}' has validation issues "
                f"for profile '{profile_name}': {len(result.errors)} errors, {len(result.warnings)} warnings"
            )
        return True, result


def _prepare_record_for_validation(record: dict, profile_name: str) -> dict:
    """
    Prepare a normalized record for profile validation.

    The normalized record from connectors may have a different structure
    than what the profile validator expects. This function adapts it.

    Args:
        record: Normalized record from connector
        profile_name: Target profile name

    Returns:
        Record structured for profile validation
    """
    profile = get_profile(profile_name)
    if not profile:
        return record

    # Extract the canonical payload if nested
    payload = record.get("canonical_payload", record)

    # If the payload already has the canonical structure, use it directly
    if "type" in payload and "properties" in payload:
        return payload

    # Otherwise, build a validation structure from flat fields
    # Map common normalized fields to canonical structure
    validation_record = {
        "type": payload.get("type", _infer_type_from_profile(profile_name)),
        "properties": {},
        "relationships": payload.get("relationships", []),
    }

    # Extract properties - look for them in both top-level and nested locations
    properties = payload.get("properties", {})

    # If properties dict is empty, try extracting from flat structure
    if not properties:
        # Profile's all properties
        all_prop_names = (
            profile.required_properties +
            profile.recommended_properties +
            profile.optional_properties
        )

        for prop_name in all_prop_names:
            if prop_name in payload:
                properties[prop_name] = payload[prop_name]

        # Also check common mappings
        field_mappings = {
            "label": "title",
            "title": "title",
            "name": "name",
            "description": "description",
        }

        for source_field, target_prop in field_mappings.items():
            if source_field in payload and target_prop not in properties:
                properties[target_prop] = payload[source_field]

    validation_record["properties"] = properties
    return validation_record


def _infer_type_from_profile(profile_name: str) -> str:
    """Infer canonical type from profile name."""
    type_map = {
        "collections": "OBJECT",
        "media": "MEDIA",
        "agent": "AGENT",
        "place": "PLACE",
        "event": "EVENT",
        "work": "WORK",
    }
    return type_map.get(profile_name, "OBJECT")


def apply_profile_metadata(
    record: dict,
    profile_name: str,
    profile_version: str,
) -> dict:
    """
    Apply profile metadata to a record.

    Sets meta.profile and meta.profileVersion on the record.

    Args:
        record: The canonical record dict
        profile_name: Name of the profile
        profile_version: Version of the profile

    Returns:
        Record with profile metadata added
    """
    # Get or create the canonical payload
    if "canonical_payload" in record:
        payload = record["canonical_payload"]
    else:
        payload = record

    # Get or create meta section
    if "meta" not in payload:
        payload["meta"] = {}

    # Set profile metadata
    payload["meta"]["profile"] = profile_name
    payload["meta"]["profileVersion"] = profile_version

    return record


def process_records_with_profile(
    records: list[dict],
    profile_name: str,
    validation_mode: str = "warn",
    apply_enrichments: bool = False,
) -> tuple[list[dict], ProfileProcessingResult]:
    """
    Process a batch of records against a profile.

    Validates records, optionally enriches them, and returns processed records
    along with processing statistics.

    Args:
        records: List of normalized records
        profile_name: Target profile name
        validation_mode: 'strict' (reject invalid), 'warn' (log warnings), 'none' (skip)
        apply_enrichments: If True, apply enrichment functions to fix issues

    Returns:
        Tuple of (processed_records, result)
        - In strict mode, processed_records excludes invalid records
        - In warn/none mode, all records are included
    """
    profile = get_profile(profile_name)
    if not profile:
        logger.warning(f"Profile '{profile_name}' not found")
        return records, ProfileProcessingResult(total_records=len(records))

    result = ProfileProcessingResult(total_records=len(records))
    processed_records = []

    for record in records:
        entity_key = record.get("entity_key", "unknown")

        # Apply enrichments if requested (before validation)
        if apply_enrichments:
            enriched, was_enriched = enrich_record_for_profile(record, profile_name)
            if was_enriched:
                result.enriched_count += 1
                record = enriched

        # Validate against profile
        is_valid, validation_result = validate_record_against_profile(
            record, profile_name, validation_mode
        )

        if validation_result:
            # Track validation issues
            for issue in validation_result.issues:
                result.validation_issues.append({
                    "entity_key": entity_key,
                    "field": issue.field,
                    "message": issue.message,
                    "severity": issue.severity.value,
                    "rule": issue.rule,
                })

        if is_valid:
            result.valid_count += 1
            # Apply profile metadata to valid records
            record = apply_profile_metadata(record, profile_name, profile.version)
            processed_records.append(record)
        else:
            result.invalid_count += 1
            result.rejected_records.append({
                "entity_key": entity_key,
                "issues": [
                    {
                        "field": i.field,
                        "message": i.message,
                        "severity": i.severity.value,
                    }
                    for i in (validation_result.errors if validation_result else [])
                ],
            })

            # In non-strict mode, still include the record
            if validation_mode != "strict":
                processed_records.append(record)

    return processed_records, result


# =============================================================================
# ENRICHMENT FUNCTIONS
# =============================================================================

def enrich_record_for_profile(
    record: dict,
    profile_name: str,
) -> tuple[dict, bool]:
    """
    Apply enrichments to a record to help it meet profile requirements.

    Enrichments are non-destructive transformations that add or normalize
    data without removing existing values.

    Args:
        record: The normalized record
        profile_name: Target profile name

    Returns:
        Tuple of (enriched_record, was_enriched)
    """
    was_enriched = False
    enriched = dict(record)  # Shallow copy

    # Get the payload to enrich
    if "canonical_payload" in enriched:
        payload = enriched["canonical_payload"]
    else:
        payload = enriched

    properties = payload.get("properties", {})

    # Apply profile-specific enrichments
    enrichments = _get_enrichments_for_profile(profile_name)

    for enrichment in enrichments:
        result, applied = enrichment(payload, properties, profile_name)
        if applied:
            was_enriched = True
            if "canonical_payload" in enriched:
                enriched["canonical_payload"] = result
            else:
                enriched = result

    return enriched, was_enriched


def _get_enrichments_for_profile(profile_name: str) -> list:
    """Get list of enrichment functions for a profile."""
    # Common enrichments that apply to all profiles
    common_enrichments = [
        _enrich_normalize_dates,
        _enrich_title_from_label,
        _enrich_name_from_label,
        _enrich_infer_type,
    ]

    # Profile-specific enrichments
    profile_enrichments = {
        "collections": [
            _enrich_collections_identifier,
            _enrich_collections_credit_line,
        ],
        "media": [
            _enrich_media_type,
        ],
        "agent": [
            _enrich_agent_type,
        ],
    }

    return common_enrichments + profile_enrichments.get(profile_name, [])


# -----------------------------------------------------------------------------
# Individual enrichment functions
# -----------------------------------------------------------------------------

def _enrich_normalize_dates(payload: dict, properties: dict, profile_name: str) -> tuple[dict, bool]:
    """Normalize date fields to ISO format."""
    date_fields = ["date_created", "date_display", "start_date", "end_date", "birth_date", "death_date"]
    was_enriched = False

    for field in date_fields:
        if field in properties and properties[field]:
            original = properties[field]
            normalized = _normalize_date_string(original)
            if normalized != original:
                properties[field] = normalized
                was_enriched = True

    if "properties" not in payload:
        payload["properties"] = properties

    return payload, was_enriched


def _normalize_date_string(date_str: str) -> str:
    """
    Normalize a date string to ISO format if possible.

    Handles common formats like:
    - "January 15, 2024" -> "2024-01-15"
    - "1889" -> "1889"
    - "ca. 1890" -> "ca. 1890" (preserve uncertainty markers)
    """
    if not isinstance(date_str, str):
        return date_str

    # Already in ISO format
    if len(date_str) == 10 and date_str[4] == "-" and date_str[7] == "-":
        return date_str

    # Year only
    if date_str.isdigit() and len(date_str) == 4:
        return date_str

    # Has uncertainty marker (ca., circa, c., approximately, etc.)
    uncertainty_markers = ["ca.", "c.", "circa", "approximately", "about", "~"]
    for marker in uncertainty_markers:
        if date_str.lower().startswith(marker):
            return date_str  # Preserve as-is

    # Try to parse common formats
    from datetime import datetime as dt
    common_formats = [
        "%B %d, %Y",      # January 15, 2024
        "%b %d, %Y",      # Jan 15, 2024
        "%d %B %Y",       # 15 January 2024
        "%d/%m/%Y",       # 15/01/2024
        "%m/%d/%Y",       # 01/15/2024
        "%Y/%m/%d",       # 2024/01/15
    ]

    for fmt in common_formats:
        try:
            parsed = dt.strptime(date_str, fmt)
            return parsed.strftime("%Y-%m-%d")
        except ValueError:
            continue

    return date_str  # Return original if can't parse


def _enrich_title_from_label(payload: dict, properties: dict, profile_name: str) -> tuple[dict, bool]:
    """Add title property from label if missing."""
    if "title" not in properties and "label" in payload:
        properties["title"] = payload["label"]
        if "properties" not in payload:
            payload["properties"] = properties
        return payload, True
    return payload, False


def _enrich_name_from_label(payload: dict, properties: dict, profile_name: str) -> tuple[dict, bool]:
    """Add name property from label for agent/place profiles."""
    if profile_name in ["agent", "place"]:
        if "name" not in properties and "label" in payload:
            properties["name"] = payload["label"]
            if "properties" not in payload:
                payload["properties"] = properties
            return payload, True
    return payload, False


def _enrich_infer_type(payload: dict, properties: dict, profile_name: str) -> tuple[dict, bool]:
    """Infer canonical type from profile if not set."""
    if "type" not in payload:
        payload["type"] = _infer_type_from_profile(profile_name)
        return payload, True
    return payload, False


def _enrich_collections_identifier(payload: dict, properties: dict, profile_name: str) -> tuple[dict, bool]:
    """Try to infer accession_number from other identifiers."""
    if "accession_number" in properties and properties["accession_number"]:
        return payload, False

    # Check identifiers list
    identifiers = payload.get("identifiers", [])
    for ident in identifiers:
        if isinstance(ident, dict):
            scheme = ident.get("scheme", "").lower()
            if scheme in ["accession", "accession_number", "acc", "object_number"]:
                properties["accession_number"] = ident.get("value")
                if "properties" not in payload:
                    payload["properties"] = properties
                return payload, True

    # Check for object_number or inventory_number
    for alt_field in ["object_number", "inventory_number"]:
        if alt_field in properties and properties[alt_field]:
            properties["accession_number"] = properties[alt_field]
            if "properties" not in payload:
                payload["properties"] = properties
            return payload, True

    return payload, False


def _enrich_collections_credit_line(payload: dict, properties: dict, profile_name: str) -> tuple[dict, bool]:
    """Generate credit_line from donor/acquisition info if missing."""
    if "credit_line" in properties and properties["credit_line"]:
        return payload, False

    # Try to build from other fields
    parts = []
    if "donor" in properties:
        parts.append(f"Gift of {properties['donor']}")
    elif "acquisition_method" in properties:
        parts.append(properties["acquisition_method"])

    if "acquisition_date" in properties:
        parts.append(str(properties["acquisition_date"]))

    if parts:
        properties["credit_line"] = ", ".join(parts)
        if "properties" not in payload:
            payload["properties"] = properties
        return payload, True

    return payload, False


def _enrich_media_type(payload: dict, properties: dict, profile_name: str) -> tuple[dict, bool]:
    """Infer media_type from mime_type or url if missing."""
    if "media_type" in properties and properties["media_type"]:
        return payload, False

    # Try to infer from mime_type
    mime_type = properties.get("mime_type", "")
    if mime_type:
        if mime_type.startswith("image/"):
            properties["media_type"] = "image"
        elif mime_type.startswith("video/"):
            properties["media_type"] = "video"
        elif mime_type.startswith("audio/"):
            properties["media_type"] = "audio"
        elif mime_type.startswith("application/pdf") or mime_type.startswith("text/"):
            properties["media_type"] = "document"
        else:
            properties["media_type"] = "other"

        if "properties" not in payload:
            payload["properties"] = properties
        return payload, True

    # Try to infer from URL extension
    url = properties.get("url", "") or payload.get("url", "")
    if url:
        lower_url = url.lower()
        if any(ext in lower_url for ext in [".jpg", ".jpeg", ".png", ".gif", ".webp", ".tiff", ".bmp"]):
            properties["media_type"] = "image"
        elif any(ext in lower_url for ext in [".mp4", ".mov", ".avi", ".webm", ".mkv"]):
            properties["media_type"] = "video"
        elif any(ext in lower_url for ext in [".mp3", ".wav", ".flac", ".ogg", ".m4a"]):
            properties["media_type"] = "audio"
        elif any(ext in lower_url for ext in [".pdf", ".doc", ".docx", ".txt"]):
            properties["media_type"] = "document"
        else:
            properties["media_type"] = "other"

        if "properties" not in payload:
            payload["properties"] = properties
        return payload, True

    return payload, False


def _enrich_agent_type(payload: dict, properties: dict, profile_name: str) -> tuple[dict, bool]:
    """Infer agent_type if missing."""
    if "agent_type" in properties and properties["agent_type"]:
        return payload, False

    # Default to "unknown" if we can't determine
    # Could potentially use heuristics (presence of birth_date suggests person, etc.)
    has_person_fields = any(
        f in properties for f in ["birth_date", "death_date", "gender", "biography"]
    )
    has_org_fields = any(
        f in properties for f in ["founding_date", "dissolution_date", "members"]
    )

    if has_person_fields and not has_org_fields:
        properties["agent_type"] = "person"
    elif has_org_fields and not has_person_fields:
        properties["agent_type"] = "organization"
    else:
        properties["agent_type"] = "unknown"

    if "properties" not in payload:
        payload["properties"] = properties
    return payload, True
