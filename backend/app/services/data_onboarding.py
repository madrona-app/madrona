"""
Data Onboarding Service

Service for migrating legacy data into profile-based modules (e.g., Collections).
Handles the workflow of analyzing, mapping, validating, enriching, and adopting
existing records into a target profile.

USAGE:
    from app.services.data_onboarding import DataOnboardingService

    service = DataOnboardingService()

    # Step 1: Analyze existing records against target profile
    analysis = service.analyze_records(
        records=legacy_records,
        target_profile="collections",
    )
    # Returns: field coverage, validation issues, suggested mappings

    # Step 2: Preview what onboarding would do
    preview = service.preview_onboarding(
        records=legacy_records,
        target_profile="collections",
        field_mappings={"old_title": "title", "artist_name": "creator"},
    )

    # Step 3: Execute onboarding
    result = service.execute_onboarding(
        records=legacy_records,
        target_profile="collections",
        field_mappings={"old_title": "title"},
        auto_enrich=True,
    )
"""

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Optional
from collections import Counter

from app.schemas.profiles import (
    get_profile,
    validate_against_profile,
    ValidationResult,
)
from app.services.ai_enrichment import AIEnrichmentService, EnrichmentSuggestion

logger = logging.getLogger(__name__)


class OnboardingStatus(str, Enum):
    """Status of an onboarding operation."""
    PENDING = "pending"
    ANALYZING = "analyzing"
    READY = "ready"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    FAILED = "failed"


@dataclass
class FieldAnalysis:
    """Analysis of a single field across records."""
    field_name: str
    record_count: int
    present_count: int
    coverage_percent: float
    sample_values: list[Any] = field(default_factory=list)
    value_types: list[str] = field(default_factory=list)
    is_empty_count: int = 0

    def to_dict(self) -> dict:
        return {
            "field_name": self.field_name,
            "record_count": self.record_count,
            "present_count": self.present_count,
            "coverage_percent": round(self.coverage_percent, 2),
            "sample_values": self.sample_values[:5],
            "value_types": self.value_types,
            "is_empty_count": self.is_empty_count,
        }


@dataclass
class MappingSuggestion:
    """Suggested mapping from source field to profile field."""
    source_field: str
    target_field: str
    confidence: float
    reason: str

    def to_dict(self) -> dict:
        return {
            "source_field": self.source_field,
            "target_field": self.target_field,
            "confidence": self.confidence,
            "reason": self.reason,
        }


@dataclass
class OnboardingAnalysis:
    """Result of analyzing records for onboarding."""
    record_count: int
    target_profile: str
    target_profile_version: str

    # Field analysis
    source_fields: list[FieldAnalysis] = field(default_factory=list)
    required_fields_coverage: dict[str, float] = field(default_factory=dict)
    recommended_fields_coverage: dict[str, float] = field(default_factory=dict)

    # Mapping suggestions
    suggested_mappings: list[MappingSuggestion] = field(default_factory=list)
    unmapped_source_fields: list[str] = field(default_factory=list)
    unmapped_target_fields: list[str] = field(default_factory=list)

    # Validation preview
    valid_count: int = 0
    invalid_count: int = 0
    common_issues: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "record_count": self.record_count,
            "target_profile": self.target_profile,
            "target_profile_version": self.target_profile_version,
            "source_fields": [f.to_dict() for f in self.source_fields],
            "required_fields_coverage": self.required_fields_coverage,
            "recommended_fields_coverage": self.recommended_fields_coverage,
            "suggested_mappings": [m.to_dict() for m in self.suggested_mappings],
            "unmapped_source_fields": self.unmapped_source_fields,
            "unmapped_target_fields": self.unmapped_target_fields,
            "valid_count": self.valid_count,
            "invalid_count": self.invalid_count,
            "common_issues": self.common_issues,
            "readiness_score": self._calculate_readiness_score(),
        }

    def _calculate_readiness_score(self) -> float:
        """Calculate how ready the data is for onboarding (0-100)."""
        if self.record_count == 0:
            return 0.0

        # Weight factors
        required_weight = 0.5
        recommended_weight = 0.2
        valid_weight = 0.3

        # Required fields coverage (average)
        if self.required_fields_coverage:
            required_score = sum(self.required_fields_coverage.values()) / len(self.required_fields_coverage)
        else:
            required_score = 100.0

        # Recommended fields coverage (average)
        if self.recommended_fields_coverage:
            recommended_score = sum(self.recommended_fields_coverage.values()) / len(self.recommended_fields_coverage)
        else:
            recommended_score = 100.0

        # Validation pass rate
        total = self.valid_count + self.invalid_count
        valid_score = (self.valid_count / total * 100) if total > 0 else 0

        return round(
            required_score * required_weight +
            recommended_score * recommended_weight +
            valid_score * valid_weight,
            1
        )


@dataclass
class OnboardingPreview:
    """Preview of what onboarding would produce."""
    record_count: int
    sample_records: list[dict] = field(default_factory=list)
    validation_results: list[dict] = field(default_factory=list)
    would_pass_count: int = 0
    would_fail_count: int = 0
    enrichment_suggestions: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "record_count": self.record_count,
            "sample_records": self.sample_records,
            "validation_results": self.validation_results,
            "would_pass_count": self.would_pass_count,
            "would_fail_count": self.would_fail_count,
            "enrichment_suggestions": self.enrichment_suggestions,
            "success_rate": round(
                self.would_pass_count / self.record_count * 100, 1
            ) if self.record_count > 0 else 0,
        }


@dataclass
class OnboardingResult:
    """Result of executing onboarding."""
    status: OnboardingStatus
    total_records: int = 0
    successful_count: int = 0
    failed_count: int = 0
    skipped_count: int = 0
    enriched_count: int = 0
    onboarded_records: list[dict] = field(default_factory=list)
    errors: list[dict] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "status": self.status.value,
            "total_records": self.total_records,
            "successful_count": self.successful_count,
            "failed_count": self.failed_count,
            "skipped_count": self.skipped_count,
            "enriched_count": self.enriched_count,
            "success_rate": round(
                self.successful_count / self.total_records * 100, 1
            ) if self.total_records > 0 else 0,
            "errors": self.errors[:20],  # Limit errors in output
        }


# =============================================================================
# Field Name Mapping Heuristics
# =============================================================================

# Common field name variations for matching
FIELD_ALIASES = {
    "title": ["title", "name", "object_title", "item_title", "display_title", "label"],
    "description": ["description", "desc", "summary", "abstract", "notes", "about"],
    "creator": ["creator", "artist", "author", "maker", "created_by", "artist_name"],
    "date_created": ["date_created", "creation_date", "date_made", "year", "date"],
    "date_display": ["date_display", "display_date", "date_string", "date_text"],
    "medium": ["medium", "materials", "material", "media", "technique"],
    "dimensions": ["dimensions", "size", "measurements", "dims"],
    "accession_number": ["accession_number", "accession", "acc_no", "object_number", "id_number"],
    "credit_line": ["credit_line", "credit", "acknowledgment", "gift_of"],
    "department": ["department", "dept", "division", "collection"],
    "classification": ["classification", "category", "type", "object_type", "class"],
    "culture": ["culture", "cultural_origin", "origin", "nationality"],
    "period": ["period", "era", "time_period", "historical_period"],
    "provenance": ["provenance", "ownership_history", "history"],
    "thumbnail_url": ["thumbnail_url", "thumbnail", "thumb", "image_url", "primary_image"],
}


def normalize_field_name(name: str) -> str:
    """Normalize a field name for comparison."""
    return name.strip().lower().replace("-", "_").replace(" ", "_")


def suggest_field_mapping(source_field: str, target_fields: list[str]) -> Optional[MappingSuggestion]:
    """
    Suggest a mapping from a source field to a target profile field.

    Uses heuristics based on common field name patterns.
    """
    normalized_source = normalize_field_name(source_field)

    # Direct match
    for target in target_fields:
        if normalize_field_name(target) == normalized_source:
            return MappingSuggestion(
                source_field=source_field,
                target_field=target,
                confidence=1.0,
                reason="Exact name match",
            )

    # Check aliases
    for target, aliases in FIELD_ALIASES.items():
        if target not in target_fields:
            continue
        normalized_aliases = [normalize_field_name(a) for a in aliases]
        if normalized_source in normalized_aliases:
            return MappingSuggestion(
                source_field=source_field,
                target_field=target,
                confidence=0.9,
                reason=f"Common alias for '{target}'",
            )

    # Partial match (source contains target or vice versa)
    for target in target_fields:
        norm_target = normalize_field_name(target)
        if norm_target in normalized_source or normalized_source in norm_target:
            return MappingSuggestion(
                source_field=source_field,
                target_field=target,
                confidence=0.6,
                reason="Partial name match",
            )

    return None


# =============================================================================
# Data Onboarding Service
# =============================================================================

class DataOnboardingService:
    """Service for onboarding legacy data into profile-based modules."""

    def __init__(self):
        self._enrichment_service: Optional[AIEnrichmentService] = None

    @property
    def enrichment_service(self) -> AIEnrichmentService:
        """Lazy-load enrichment service."""
        if self._enrichment_service is None:
            self._enrichment_service = AIEnrichmentService()
        return self._enrichment_service

    def analyze_records(
        self,
        records: list[dict[str, Any]],
        target_profile: str,
    ) -> OnboardingAnalysis:
        """
        Analyze records to understand their structure and readiness for onboarding.

        Args:
            records: List of records to analyze
            target_profile: Name of the target profile

        Returns:
            OnboardingAnalysis with field coverage, suggestions, and issues
        """
        profile = get_profile(target_profile)
        if not profile:
            raise ValueError(f"Unknown profile: {target_profile}")

        analysis = OnboardingAnalysis(
            record_count=len(records),
            target_profile=target_profile,
            target_profile_version=profile.version,
        )

        if not records:
            return analysis

        # Analyze source fields
        all_fields: dict[str, FieldAnalysis] = {}
        for record in records:
            properties = record.get("properties", {})
            # Also check top-level fields
            for key in ["label", "type", "id"]:
                if key in record:
                    properties[key] = record[key]

            for field_name, value in properties.items():
                if field_name not in all_fields:
                    all_fields[field_name] = FieldAnalysis(
                        field_name=field_name,
                        record_count=len(records),
                        present_count=0,
                        coverage_percent=0.0,
                    )

                fa = all_fields[field_name]
                if value is not None:
                    fa.present_count += 1
                    if len(fa.sample_values) < 5:
                        fa.sample_values.append(value)
                    value_type = type(value).__name__
                    if value_type not in fa.value_types:
                        fa.value_types.append(value_type)
                    if value == "" or value == [] or value == {}:
                        fa.is_empty_count += 1

        # Calculate coverage
        for fa in all_fields.values():
            fa.coverage_percent = (fa.present_count / len(records)) * 100

        analysis.source_fields = sorted(
            all_fields.values(),
            key=lambda f: f.coverage_percent,
            reverse=True,
        )

        # Get target profile fields
        target_fields = profile.get_all_properties()

        # Suggest mappings
        source_field_names = list(all_fields.keys())
        mapped_sources = set()
        mapped_targets = set()

        for source_field in source_field_names:
            suggestion = suggest_field_mapping(source_field, target_fields)
            if suggestion:
                analysis.suggested_mappings.append(suggestion)
                mapped_sources.add(source_field)
                mapped_targets.add(suggestion.target_field)

        analysis.unmapped_source_fields = [
            f for f in source_field_names if f not in mapped_sources
        ]
        analysis.unmapped_target_fields = [
            f for f in target_fields if f not in mapped_targets
        ]

        # Calculate required/recommended field coverage
        for req_field in profile.required_properties:
            # Check if we have a mapping for this field
            coverage = 0.0
            for mapping in analysis.suggested_mappings:
                if mapping.target_field == req_field:
                    source_fa = all_fields.get(mapping.source_field)
                    if source_fa:
                        coverage = source_fa.coverage_percent
                    break
            analysis.required_fields_coverage[req_field] = coverage

        for rec_field in profile.recommended_properties:
            coverage = 0.0
            for mapping in analysis.suggested_mappings:
                if mapping.target_field == rec_field:
                    source_fa = all_fields.get(mapping.source_field)
                    if source_fa:
                        coverage = source_fa.coverage_percent
                    break
            analysis.recommended_fields_coverage[rec_field] = coverage

        # Validate sample records
        issue_counter: Counter = Counter()
        for record in records[:100]:  # Sample first 100
            # Apply suggested mappings for validation
            mapped_record = self._apply_mappings(
                record,
                {m.source_field: m.target_field for m in analysis.suggested_mappings},
            )
            result = validate_against_profile(mapped_record, target_profile)
            if result.is_valid:
                analysis.valid_count += 1
            else:
                analysis.invalid_count += 1
                for issue in result.issues:
                    issue_counter[f"{issue.field}: {issue.message}"] += 1

        # Get most common issues
        analysis.common_issues = [
            {"issue": issue, "count": count}
            for issue, count in issue_counter.most_common(10)
        ]

        return analysis

    def preview_onboarding(
        self,
        records: list[dict[str, Any]],
        target_profile: str,
        field_mappings: dict[str, str],
        sample_size: int = 5,
        include_enrichment: bool = False,
    ) -> OnboardingPreview:
        """
        Preview what onboarded records would look like.

        Args:
            records: Records to preview
            target_profile: Target profile name
            field_mappings: Mapping of source field -> target field
            sample_size: Number of sample records to include
            include_enrichment: Whether to include AI enrichment suggestions

        Returns:
            OnboardingPreview with sample transformed records
        """
        profile = get_profile(target_profile)
        if not profile:
            raise ValueError(f"Unknown profile: {target_profile}")

        preview = OnboardingPreview(record_count=len(records))

        for i, record in enumerate(records):
            # Apply mappings
            transformed = self._apply_mappings(record, field_mappings)
            transformed = self._prepare_for_profile(transformed, target_profile)

            # Validate
            result = validate_against_profile(transformed, target_profile)

            if result.is_valid:
                preview.would_pass_count += 1
            else:
                preview.would_fail_count += 1

            # Add to samples
            if i < sample_size:
                preview.sample_records.append(transformed)
                preview.validation_results.append(result.to_dict())

                # Get enrichment suggestions if requested
                if include_enrichment:
                    suggestions = self.enrichment_service.suggest_missing_fields(
                        transformed,
                        profile_name=target_profile,
                    )
                    preview.enrichment_suggestions.append({
                        "record_index": i,
                        "suggestions": [s.to_dict() for s in suggestions],
                    })

        return preview

    def execute_onboarding(
        self,
        records: list[dict[str, Any]],
        target_profile: str,
        field_mappings: dict[str, str],
        auto_enrich: bool = False,
        enrich_fields: Optional[list[str]] = None,
        skip_invalid: bool = False,
        min_enrichment_confidence: float = 0.7,
    ) -> OnboardingResult:
        """
        Execute onboarding to transform and adopt records into a profile.

        Args:
            records: Records to onboard
            target_profile: Target profile name
            field_mappings: Mapping of source field -> target field
            auto_enrich: Whether to automatically apply AI enrichment
            enrich_fields: Specific fields to enrich (None = all missing)
            skip_invalid: Skip records that fail validation
            min_enrichment_confidence: Minimum confidence for auto-applying enrichment

        Returns:
            OnboardingResult with transformed records and statistics
        """
        profile = get_profile(target_profile)
        if not profile:
            raise ValueError(f"Unknown profile: {target_profile}")

        result = OnboardingResult(
            status=OnboardingStatus.IN_PROGRESS,
            total_records=len(records),
        )

        for i, record in enumerate(records):
            try:
                # Apply field mappings
                transformed = self._apply_mappings(record, field_mappings)
                transformed = self._prepare_for_profile(transformed, target_profile)

                # Enrich if requested
                if auto_enrich:
                    enriched, enrichment_applied = self._enrich_record(
                        transformed,
                        target_profile,
                        enrich_fields,
                        min_enrichment_confidence,
                    )
                    transformed = enriched
                    if enrichment_applied:
                        result.enriched_count += 1

                # Validate
                validation = validate_against_profile(transformed, target_profile)

                if not validation.is_valid:
                    if skip_invalid:
                        result.skipped_count += 1
                        result.errors.append({
                            "index": i,
                            "record_id": record.get("id"),
                            "reason": "validation_failed",
                            "issues": [
                                {"field": issue.field, "message": issue.message}
                                for issue in validation.errors[:5]
                            ],
                        })
                        continue
                    else:
                        # Include anyway but note the issues
                        transformed["_validation_issues"] = [
                            {"field": issue.field, "message": issue.message}
                            for issue in validation.issues
                        ]

                result.onboarded_records.append(transformed)
                result.successful_count += 1

            except Exception as e:
                logger.error(f"Error onboarding record {i}: {e}")
                result.failed_count += 1
                result.errors.append({
                    "index": i,
                    "record_id": record.get("id"),
                    "reason": "error",
                    "error": str(e),
                })

        result.status = OnboardingStatus.COMPLETED
        return result

    def _apply_mappings(
        self,
        record: dict[str, Any],
        field_mappings: dict[str, str],
    ) -> dict[str, Any]:
        """Apply field mappings to transform a record."""
        result = {
            "id": record.get("id"),
            "type": record.get("type"),
            "label": record.get("label"),
            "properties": {},
            "meta": record.get("meta", {}).copy(),
        }

        source_props = record.get("properties", {})

        # Also consider top-level fields as sources
        all_sources = {**source_props}
        for key in ["label", "type", "id"]:
            if key in record:
                all_sources[key] = record[key]

        # Apply mappings
        for source_field, target_field in field_mappings.items():
            if source_field in all_sources:
                result["properties"][target_field] = all_sources[source_field]

        # Copy unmapped fields to properties (preserving original data)
        mapped_sources = set(field_mappings.keys())
        for field_name, value in source_props.items():
            if field_name not in mapped_sources and field_name not in result["properties"]:
                result["properties"][field_name] = value

        return result

    def _prepare_for_profile(
        self,
        record: dict[str, Any],
        target_profile: str,
    ) -> dict[str, Any]:
        """Prepare a record for a specific profile."""
        profile = get_profile(target_profile)
        if not profile:
            return record

        # Set profile metadata
        record["meta"] = record.get("meta", {})
        record["meta"]["profile"] = target_profile
        record["meta"]["profile_version"] = profile.version

        # Set type if profile requires it
        if profile.canonical_type and not record.get("type"):
            record["type"] = profile.canonical_type

        # Set label from title if not present
        if not record.get("label"):
            props = record.get("properties", {})
            record["label"] = props.get("title") or props.get("name") or record.get("id")

        return record

    def _enrich_record(
        self,
        record: dict[str, Any],
        target_profile: str,
        enrich_fields: Optional[list[str]],
        min_confidence: float,
    ) -> tuple[dict[str, Any], bool]:
        """
        Enrich a record with AI-suggested values.

        Returns:
            Tuple of (enriched_record, was_enriched)
        """
        suggestions = self.enrichment_service.suggest_missing_fields(
            record,
            profile_name=target_profile,
            fields_to_suggest=enrich_fields,
            min_confidence=min_confidence,
        )

        if not suggestions:
            return record, False

        # Apply suggestions
        properties = record.get("properties", {})
        applied = False

        for suggestion in suggestions:
            if suggestion.confidence >= min_confidence:
                properties[suggestion.field] = suggestion.value
                applied = True

                # Track enrichment in meta
                if "enrichments" not in record.get("meta", {}):
                    record["meta"]["enrichments"] = []
                record["meta"]["enrichments"].append({
                    "field": suggestion.field,
                    "value": suggestion.value,
                    "confidence": suggestion.confidence,
                    "source": suggestion.source,
                })

        record["properties"] = properties
        return record, applied


# =============================================================================
# Module-Level Functions
# =============================================================================

_service: Optional[DataOnboardingService] = None


def get_onboarding_service() -> DataOnboardingService:
    """Get or create the data onboarding service singleton."""
    global _service
    if _service is None:
        _service = DataOnboardingService()
    return _service


def analyze_for_onboarding(
    records: list[dict[str, Any]],
    target_profile: str,
) -> OnboardingAnalysis:
    """Convenience function to analyze records for onboarding."""
    return get_onboarding_service().analyze_records(records, target_profile)


def preview_onboarding(
    records: list[dict[str, Any]],
    target_profile: str,
    field_mappings: dict[str, str],
) -> OnboardingPreview:
    """Convenience function to preview onboarding."""
    return get_onboarding_service().preview_onboarding(
        records, target_profile, field_mappings
    )


def onboard_records(
    records: list[dict[str, Any]],
    target_profile: str,
    field_mappings: dict[str, str],
    auto_enrich: bool = False,
) -> OnboardingResult:
    """Convenience function to execute onboarding."""
    return get_onboarding_service().execute_onboarding(
        records, target_profile, field_mappings, auto_enrich=auto_enrich
    )
