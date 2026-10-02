"""
Linked Data Readiness Validation

Non-blocking quality hints for LOD-readiness assessment.

Design Principles:
1. WARNINGS ONLY - Never errors, never blocking
2. OPTIONAL - LOD compliance is never required
3. QUALITY HINTS - Suggestions for improvement, not demands
4. PROGRESSIVE - Start simple, enhance over time
5. CONTEXTUAL - Different hints for different use cases

This module assesses how "ready" a record is for Linked Data export,
providing actionable suggestions without preventing any workflow.

Typical usage:
    result = assess_lod_readiness(collection_object)
    # result.score = 0.75  (75% ready)
    # result.hints = [LODHint(...), ...]
    # Use hints to display suggestions in UI
"""

import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Dict, List, Optional, Callable
from uuid import UUID

logger = logging.getLogger(__name__)


# ============================================================================
# HINT CATEGORIES AND SEVERITY
# ============================================================================

class HintCategory(str, Enum):
    """Categories for LOD readiness hints."""
    AUTHORITY = "authority"           # Authority/vocabulary links
    IDENTIFIER = "identifier"         # Stable identifiers
    DESCRIPTION = "description"       # Descriptive completeness
    RELATIONSHIP = "relationship"     # Links to other records
    MEDIA = "media"                   # Image/media availability
    RIGHTS = "rights"                 # Rights clarity
    PROVENANCE = "provenance"         # Provenance documentation


class HintImpact(str, Enum):
    """
    Impact level of the hint.

    These are NOT severity levels - they indicate how much
    addressing the hint would improve LOD-readiness.
    """
    HIGH = "high"           # Significant improvement if addressed
    MEDIUM = "medium"       # Moderate improvement
    LOW = "low"             # Minor improvement

    @property
    def weight(self) -> float:
        """Weight for score calculation."""
        return {"high": 1.0, "medium": 0.6, "low": 0.3}[self.value]


# ============================================================================
# LOD HINT MODEL
# ============================================================================

@dataclass
class LODHint:
    """
    A single LOD readiness hint.

    Hints are suggestions, not requirements. They provide
    actionable guidance for improving LOD compatibility.
    """
    # Unique hint identifier (for UI tracking/dismissal)
    hint_id: str

    # Category for grouping
    category: HintCategory

    # Impact level (not severity!)
    impact: HintImpact

    # User-friendly message (displayed in UI)
    message: str

    # Actionable suggestion
    suggestion: str

    # Field(s) this hint relates to
    fields: List[str] = field(default_factory=list)

    # Current value (for context)
    current_value: Optional[str] = None

    # Example of good value
    example: Optional[str] = None

    # Link to documentation/help
    help_url: Optional[str] = None

    # Whether this hint can be auto-fixed
    auto_fixable: bool = False

    def to_dict(self) -> Dict[str, Any]:
        """Convert to API response format."""
        return {
            "id": self.hint_id,
            "category": self.category.value,
            "impact": self.impact.value,
            "message": self.message,
            "suggestion": self.suggestion,
            "fields": self.fields,
            "currentValue": self.current_value,
            "example": self.example,
            "helpUrl": self.help_url,
            "autoFixable": self.auto_fixable,
        }


@dataclass
class LODReadinessResult:
    """
    Result of LOD readiness assessment.

    The score is informational only - it does not gate any functionality.
    """
    # Score from 0.0 to 1.0 (percentage ready)
    score: float

    # List of hints for improvement
    hints: List[LODHint] = field(default_factory=list)

    # Counts by category
    hints_by_category: Dict[str, int] = field(default_factory=dict)

    # Counts by impact
    hints_by_impact: Dict[str, int] = field(default_factory=dict)

    # What's already good
    strengths: List[str] = field(default_factory=list)

    # Overall readiness level
    @property
    def level(self) -> str:
        """Human-readable readiness level."""
        if self.score >= 0.9:
            return "excellent"
        elif self.score >= 0.7:
            return "good"
        elif self.score >= 0.5:
            return "fair"
        elif self.score >= 0.3:
            return "basic"
        else:
            return "minimal"

    @property
    def level_message(self) -> str:
        """User-friendly level description."""
        messages = {
            "excellent": "This record is well-prepared for Linked Data sharing.",
            "good": "This record has good Linked Data foundations.",
            "fair": "This record has some Linked Data elements in place.",
            "basic": "This record has basic information that could be enhanced.",
            "minimal": "This record could benefit from additional metadata.",
        }
        return messages[self.level]

    def to_dict(self) -> Dict[str, Any]:
        """Convert to API response format."""
        return {
            "score": round(self.score, 2),
            "level": self.level,
            "levelMessage": self.level_message,
            "hints": [h.to_dict() for h in self.hints],
            "hintsByCategory": self.hints_by_category,
            "hintsByImpact": self.hints_by_impact,
            "strengths": self.strengths,
            "totalHints": len(self.hints),
        }


# ============================================================================
# VALIDATION RULES
# ============================================================================

class LODReadinessChecker:
    """
    Checker for LOD readiness of collection objects.

    All checks are non-blocking and produce hints only.
    """

    def __init__(self):
        self.checks: List[Callable] = [
            self._check_creators_authority,
            self._check_materials_authority,
            self._check_techniques_authority,
            self._check_place_reference,
            self._check_subjects_authority,
            self._check_stable_identifier,
            self._check_title_present,
            self._check_description_present,
            self._check_date_precision,
            self._check_classification_authority,
            self._check_media_present,
            self._check_rights_clarity,
            self._check_provenance_present,
            self._check_dimensions_present,
            self._check_related_records,
        ]

    def assess(self, obj: Any) -> LODReadinessResult:
        """
        Assess LOD readiness of a collection object.

        Args:
            obj: CollectionObject model or dict representation

        Returns:
            LODReadinessResult with score and hints
        """
        # Convert to dict if needed
        if hasattr(obj, '__dict__'):
            data = self._model_to_dict(obj)
        else:
            data = obj

        hints = []
        strengths = []
        max_possible_score = 0.0
        achieved_score = 0.0

        # Run all checks
        for check in self.checks:
            try:
                result = check(data)
                if result:
                    hint, weight, is_strength = result
                    max_possible_score += weight
                    if hint:
                        hints.append(hint)
                    else:
                        achieved_score += weight
                        if is_strength:
                            strengths.append(is_strength)
            except Exception as e:
                logger.warning(f"LOD check failed: {check.__name__}: {e}")
                continue

        # Calculate score
        if max_possible_score > 0:
            score = achieved_score / max_possible_score
        else:
            score = 1.0

        # Count by category and impact
        by_category = {}
        by_impact = {}
        for hint in hints:
            cat = hint.category.value
            imp = hint.impact.value
            by_category[cat] = by_category.get(cat, 0) + 1
            by_impact[imp] = by_impact.get(imp, 0) + 1

        return LODReadinessResult(
            score=score,
            hints=hints,
            hints_by_category=by_category,
            hints_by_impact=by_impact,
            strengths=strengths,
        )

    def _model_to_dict(self, obj: Any) -> Dict[str, Any]:
        """Convert a model to dict, handling SQLAlchemy models."""
        if hasattr(obj, 'to_dict'):
            return obj.to_dict()

        # Handle SQLAlchemy models
        data = {}
        for key in dir(obj):
            if not key.startswith('_'):
                try:
                    value = getattr(obj, key)
                    if not callable(value):
                        data[key] = value
                except (AttributeError, TypeError):
                    pass  # Skip attributes that can't be accessed
        return data

    # ========================================================================
    # INDIVIDUAL CHECKS
    # Each returns: (LODHint or None, weight, strength_message or None)
    # ========================================================================

    def _check_creators_authority(self, data: Dict) -> tuple:
        """Check if creators have authority references."""
        weight = 1.0  # High importance
        creators = data.get('creators', [])

        if not creators:
            return (None, 0, None)  # No creators to check

        # Check each creator for authority links
        without_authority = []
        for creator in creators:
            if isinstance(creator, dict):
                name = creator.get('value') or creator.get('name')
                has_auth = bool(
                    creator.get('authorities') or
                    creator.get('ulan_id') or
                    creator.get('viaf_id') or
                    creator.get('wikidata_id')
                )
                if name and not has_auth:
                    without_authority.append(name)

        if without_authority:
            return (
                LODHint(
                    hint_id="creator_authority",
                    category=HintCategory.AUTHORITY,
                    impact=HintImpact.HIGH,
                    message=f"Creator without authority link: {without_authority[0]}",
                    suggestion="Link creators to ULAN, VIAF, or Wikidata for better discoverability",
                    fields=["creators"],
                    current_value=without_authority[0],
                    example='{"value": "Claude Monet", "authorities": [{"uri": "http://vocab.getty.edu/ulan/500019484", "source": "ULAN"}]}',
                    help_url="/docs/authority-linking",
                    auto_fixable=True,
                ),
                weight,
                None
            )

        return (None, weight, "Creators linked to authority records")

    def _check_materials_authority(self, data: Dict) -> tuple:
        """Check if materials have AAT references."""
        weight = 0.6
        materials = data.get('materials', [])

        if not materials:
            return (None, 0, None)

        without_authority = []
        for mat in materials:
            if isinstance(mat, dict):
                term = mat.get('value') or mat.get('term') or mat.get('name')
                has_auth = bool(
                    mat.get('authorities') or
                    mat.get('aat_id')
                )
                if term and not has_auth:
                    without_authority.append(term)

        if without_authority:
            return (
                LODHint(
                    hint_id="material_authority",
                    category=HintCategory.AUTHORITY,
                    impact=HintImpact.MEDIUM,
                    message=f"Material without vocabulary link: {without_authority[0]}",
                    suggestion="Link materials to Getty AAT for standardized terminology",
                    fields=["materials"],
                    current_value=without_authority[0],
                    example='{"value": "Oil paint", "authorities": [{"uri": "http://vocab.getty.edu/aat/300015050", "source": "AAT"}]}',
                    auto_fixable=True,
                ),
                weight,
                None
            )

        return (None, weight, "Materials linked to AAT")

    def _check_techniques_authority(self, data: Dict) -> tuple:
        """Check if techniques have AAT references."""
        weight = 0.5
        techniques = data.get('techniques', [])

        if not techniques:
            return (None, 0, None)

        without_authority = []
        for tech in techniques:
            if isinstance(tech, dict):
                term = tech.get('value') or tech.get('term') or tech.get('name')
                has_auth = bool(
                    tech.get('authorities') or
                    tech.get('aat_id')
                )
                if term and not has_auth:
                    without_authority.append(term)

        if without_authority:
            return (
                LODHint(
                    hint_id="technique_authority",
                    category=HintCategory.AUTHORITY,
                    impact=HintImpact.MEDIUM,
                    message=f"Technique without vocabulary link: {without_authority[0]}",
                    suggestion="Link techniques to Getty AAT",
                    fields=["techniques"],
                    current_value=without_authority[0],
                    auto_fixable=True,
                ),
                weight,
                None
            )

        return (None, weight, "Techniques linked to AAT")

    def _check_place_reference(self, data: Dict) -> tuple:
        """Check if places have geographic references."""
        weight = 0.7

        place = data.get('creation_place')
        place_details = data.get('creation_place_details', {}) or {}

        if not place:
            return (None, 0, None)

        has_ref = bool(
            place_details.get('tgn_id') or
            place_details.get('geonames_id') or
            place_details.get('coordinates') or
            place_details.get('wikidata_id')
        )

        if not has_ref:
            return (
                LODHint(
                    hint_id="place_reference",
                    category=HintCategory.AUTHORITY,
                    impact=HintImpact.MEDIUM,
                    message=f"Place without geographic reference: {place}",
                    suggestion="Link places to Getty TGN or GeoNames for location data",
                    fields=["creation_place", "creation_place_details"],
                    current_value=place,
                    example='{"creation_place": "Paris, France", "creation_place_details": {"tgn_id": "7008038"}}',
                    auto_fixable=True,
                ),
                weight,
                None
            )

        return (None, weight, "Place linked to geographic authority")

    def _check_subjects_authority(self, data: Dict) -> tuple:
        """Check if subjects have vocabulary references."""
        weight = 0.5
        subjects = data.get('subjects', [])

        if not subjects:
            return (None, 0, None)

        # Simple subjects (strings) don't have authorities
        string_subjects = [s for s in subjects if isinstance(s, str)]

        if string_subjects:
            return (
                LODHint(
                    hint_id="subject_authority",
                    category=HintCategory.AUTHORITY,
                    impact=HintImpact.LOW,
                    message=f"Subject term could have vocabulary link: {string_subjects[0]}",
                    suggestion="Consider linking subjects to AAT, LCSH, or Iconclass",
                    fields=["subjects"],
                    current_value=string_subjects[0],
                    auto_fixable=True,
                ),
                weight,
                None
            )

        return (None, weight, None)

    def _check_stable_identifier(self, data: Dict) -> tuple:
        """Check if record has a stable identifier."""
        weight = 1.0

        object_number = data.get('object_number')
        object_id = data.get('object_id')

        if not object_number and not object_id:
            return (
                LODHint(
                    hint_id="stable_id",
                    category=HintCategory.IDENTIFIER,
                    impact=HintImpact.HIGH,
                    message="Record lacks a stable identifier",
                    suggestion="Ensure record has an object number for persistent identification",
                    fields=["object_number"],
                ),
                weight,
                None
            )

        return (None, weight, "Has stable identifier")

    def _check_title_present(self, data: Dict) -> tuple:
        """Check if record has a title."""
        weight = 0.8

        titles = data.get('titles', [])
        object_name = data.get('object_name')

        has_title = bool(titles) or bool(object_name)

        if not has_title:
            return (
                LODHint(
                    hint_id="title_missing",
                    category=HintCategory.DESCRIPTION,
                    impact=HintImpact.HIGH,
                    message="Record has no title or object name",
                    suggestion="Add a title for discoverability",
                    fields=["titles", "object_name"],
                ),
                weight,
                None
            )

        return (None, weight, "Has title")

    def _check_description_present(self, data: Dict) -> tuple:
        """Check if record has a description."""
        weight = 0.6

        brief = data.get('brief_description')
        full = data.get('full_description')

        if not brief and not full:
            return (
                LODHint(
                    hint_id="description_missing",
                    category=HintCategory.DESCRIPTION,
                    impact=HintImpact.MEDIUM,
                    message="Record has no description",
                    suggestion="Add a brief description to help users understand the object",
                    fields=["brief_description"],
                ),
                weight,
                None
            )

        # Check description quality
        desc = brief or full
        if len(desc) < 50:
            return (
                LODHint(
                    hint_id="description_brief",
                    category=HintCategory.DESCRIPTION,
                    impact=HintImpact.LOW,
                    message="Description is very brief",
                    suggestion="Consider expanding the description for richer metadata",
                    fields=["brief_description"],
                    current_value=desc[:50] + "..." if len(desc) > 50 else desc,
                ),
                weight * 0.5,
                None
            )

        return (None, weight, "Has description")

    def _check_date_precision(self, data: Dict) -> tuple:
        """Check date precision for LOD."""
        weight = 0.5

        display_date = data.get('creation_date_display')
        earliest = data.get('creation_date_earliest')
        latest = data.get('creation_date_latest')

        if not display_date and not earliest:
            return (
                LODHint(
                    hint_id="date_missing",
                    category=HintCategory.DESCRIPTION,
                    impact=HintImpact.MEDIUM,
                    message="No creation date specified",
                    suggestion="Add creation date information when known",
                    fields=["creation_date_display", "creation_date_earliest"],
                ),
                weight,
                None
            )

        # Has display but no parsed dates
        if display_date and not earliest:
            return (
                LODHint(
                    hint_id="date_not_parsed",
                    category=HintCategory.DESCRIPTION,
                    impact=HintImpact.LOW,
                    message="Date could have structured values",
                    suggestion="Add earliest/latest dates for better date querying",
                    fields=["creation_date_earliest", "creation_date_latest"],
                    current_value=display_date,
                ),
                weight * 0.5,
                None
            )

        return (None, weight, "Has structured date")

    def _check_classification_authority(self, data: Dict) -> tuple:
        """Check if classifications have vocabulary links."""
        weight = 0.5

        classifications = data.get('classifications', [])
        object_type = data.get('object_type')

        if not classifications and not object_type:
            return (
                LODHint(
                    hint_id="classification_missing",
                    category=HintCategory.AUTHORITY,
                    impact=HintImpact.MEDIUM,
                    message="No classification or object type",
                    suggestion="Add classification terms for better categorization",
                    fields=["classifications", "object_type"],
                ),
                weight,
                None
            )

        # Check for AAT links
        has_aat = False
        for cls in classifications:
            if isinstance(cls, dict):
                if cls.get('authorities') or cls.get('aat_id'):
                    has_aat = True
                    break

        if classifications and not has_aat:
            return (
                LODHint(
                    hint_id="classification_authority",
                    category=HintCategory.AUTHORITY,
                    impact=HintImpact.LOW,
                    message="Classifications could have AAT links",
                    suggestion="Link classification terms to Getty AAT",
                    fields=["classifications"],
                    auto_fixable=True,
                ),
                weight * 0.5,
                None
            )

        return (None, weight, None)

    def _check_media_present(self, data: Dict) -> tuple:
        """Check if record has associated media."""
        weight = 0.8

        # Check for media links
        media_links = data.get('media_links', [])
        has_media = bool(media_links)

        # Alternative: check for primary_image_id or similar
        if not has_media:
            primary_image = data.get('primary_image_id') or data.get('thumbnail_url')
            has_media = bool(primary_image)

        if not has_media:
            return (
                LODHint(
                    hint_id="media_missing",
                    category=HintCategory.MEDIA,
                    impact=HintImpact.HIGH,
                    message="No images linked to this record",
                    suggestion="Add images for visual discovery and IIIF compatibility",
                    fields=["media_links"],
                ),
                weight,
                None
            )

        return (None, weight, "Has linked media")

    def _check_rights_clarity(self, data: Dict) -> tuple:
        """Check if rights/copyright is clearly specified."""
        weight = 0.6

        copyright_status = data.get('copyright_status')
        credit_line = data.get('credit_line')

        if not copyright_status:
            return (
                LODHint(
                    hint_id="rights_unclear",
                    category=HintCategory.RIGHTS,
                    impact=HintImpact.MEDIUM,
                    message="Copyright status not specified",
                    suggestion="Specify copyright status for clear rights information",
                    fields=["copyright_status"],
                ),
                weight,
                None
            )

        if not credit_line:
            return (
                LODHint(
                    hint_id="credit_missing",
                    category=HintCategory.RIGHTS,
                    impact=HintImpact.LOW,
                    message="No credit line specified",
                    suggestion="Add a credit line for proper attribution",
                    fields=["credit_line"],
                ),
                weight * 0.5,
                None
            )

        return (None, weight, "Has rights information")

    def _check_provenance_present(self, data: Dict) -> tuple:
        """Check if provenance is documented."""
        weight = 0.4

        provenance = data.get('provenance')
        structured = data.get('provenance_structured', [])

        if not provenance and not structured:
            return (
                LODHint(
                    hint_id="provenance_missing",
                    category=HintCategory.PROVENANCE,
                    impact=HintImpact.LOW,
                    message="No provenance information",
                    suggestion="Document ownership history when available",
                    fields=["provenance"],
                ),
                weight,
                None
            )

        return (None, weight, None)

    def _check_dimensions_present(self, data: Dict) -> tuple:
        """Check if dimensions are documented."""
        weight = 0.4

        measurements = data.get('measurements', [])

        if not measurements:
            return (
                LODHint(
                    hint_id="dimensions_missing",
                    category=HintCategory.DESCRIPTION,
                    impact=HintImpact.LOW,
                    message="No dimensions recorded",
                    suggestion="Add measurements for physical description",
                    fields=["measurements"],
                ),
                weight,
                None
            )

        return (None, weight, None)

    def _check_related_records(self, data: Dict) -> tuple:
        """Check for relationships to other records."""
        weight = 0.3

        # Check various relationship fields
        has_relationships = any([
            data.get('related_objects'),
            data.get('parent_object_id'),
            data.get('child_objects'),
            data.get('related_acquisitions'),
        ])

        if not has_relationships:
            return (
                LODHint(
                    hint_id="relationships_none",
                    category=HintCategory.RELATIONSHIP,
                    impact=HintImpact.LOW,
                    message="No related records linked",
                    suggestion="Link to related objects, acquisitions, or exhibitions when applicable",
                    fields=["related_objects"],
                ),
                weight,
                None
            )

        return (None, weight, "Has related records")


# ============================================================================
# QUICK ASSESSMENT FUNCTIONS
# ============================================================================

def assess_lod_readiness(obj: Any) -> LODReadinessResult:
    """
    Assess LOD readiness of a collection object.

    This is the main entry point for LOD readiness checks.

    Args:
        obj: CollectionObject model or dict

    Returns:
        LODReadinessResult with score and hints
    """
    checker = LODReadinessChecker()
    return checker.assess(obj)


def get_quick_lod_score(obj: Any) -> float:
    """
    Get just the LOD readiness score (0.0 to 1.0).

    Use this for list views where full hints aren't needed.
    """
    result = assess_lod_readiness(obj)
    return result.score


def get_lod_hints_for_field(obj: Any, field_name: str) -> List[LODHint]:
    """
    Get LOD hints relevant to a specific field.

    Use this in field-level UI to show contextual hints.
    """
    result = assess_lod_readiness(obj)
    return [h for h in result.hints if field_name in h.fields]


# ============================================================================
# BATCH ASSESSMENT
# ============================================================================

def assess_batch_lod_readiness(
    objects: List[Any]
) -> Dict[str, Any]:
    """
    Assess LOD readiness for a batch of objects.

    Returns aggregate statistics and per-object scores.
    """
    results = []
    total_score = 0.0
    all_hints_by_category = {}

    for obj in objects:
        result = assess_lod_readiness(obj)

        obj_id = (
            obj.get('object_id') if isinstance(obj, dict)
            else getattr(obj, 'object_id', None)
        )

        results.append({
            "object_id": str(obj_id) if obj_id else None,
            "score": result.score,
            "level": result.level,
            "hint_count": len(result.hints),
        })

        total_score += result.score

        for cat, count in result.hints_by_category.items():
            all_hints_by_category[cat] = all_hints_by_category.get(cat, 0) + count

    avg_score = total_score / len(objects) if objects else 0.0

    return {
        "averageScore": round(avg_score, 2),
        "objectCount": len(objects),
        "hintsByCategory": all_hints_by_category,
        "objects": results,
    }
