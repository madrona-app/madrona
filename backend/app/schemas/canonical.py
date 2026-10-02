"""
Madrona Canonical Schema v1 - Pydantic Models and Validation.

This module defines the authoritative schema for canonical entity data.
All source connectors MUST normalize their data to CanonicalRecord (or CanonicalDraft)
before ingestion into the canonical store.

DESIGN PRINCIPLES:
    1. Single Source of Truth: This file defines what "canonical" means
    2. Stable Envelope: Downstream consumers (UI, API, destinations) can
       rely on these fields being present and consistently typed
    3. Extensible: Domain-specific fields go in `properties` dict and `extensions` list
    4. Lossless: Original source data preserved in extensions with namespace "source.<system>"

CANONICAL RECORD STRUCTURE:
    - id (string) [required]: Stable identifier (e.g., "mdrn:loc:12345")
    - type (enum) [required]: Object, Work, Agent, Place, Event, Media
    - label (string) [required]: Primary display title
    - description (string) [optional]: Longer description
    - status (string) [optional]: Record status
    - identifiers: list[Identifier]: External IDs (scheme, value)
    - classifications: list[Classification]: Subject/type classifications
    - properties: dict[str, Any]: Flexible domain-specific fields
    - relationships: list[Relationship]: Links to other entities
    - media: list[MediaReference]: Associated media files
    - rights: optional rights statement
    - extensions: list[Extension]: Namespaced raw/custom data
    - provenance: Provenance [required]: Source tracking
    - meta: Meta [required]: Schema version and timestamps

USAGE:
    from app.schemas.canonical import (
        CanonicalRecord,
        CanonicalDraft,
        validate_canonical_record,
        finalize_draft,
    )

    # In connector normalize():
    draft = CanonicalDraft(
        id="mdrn:loc:12345",
        type=CanonicalRecordType.WORK,
        label="Civil War Map",
        properties={"date": "1863"},
        extensions=[Extension(namespace="source.loc", type="LocRaw", data={...})],
    )

    # In ingestion:
    record = finalize_draft(draft, source_system="loc", source_id="12345")

MIGRATION PATH:
    Phase 1 (current): Warn on validation failures, continue storing
    Phase 2: Reject invalid records at ingestion
"""

from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from enum import Enum
from typing import Any

from pydantic import BaseModel, Field, field_validator, model_validator

logger = logging.getLogger(__name__)


# =============================================================================
# ENUMS
# =============================================================================

class CanonicalRecordType(str, Enum):
    """
    Controlled vocabulary for canonical entity types.

    These represent the core entity types in the Madrona data model.
    Connectors should map source-specific types to these categories.

    Type Selection Guidelines:
        - OBJECT: Physical items (artifacts, specimens, artworks)
        - WORK: Creative/intellectual works (documents, maps, publications)
        - AGENT: People, organizations, groups
        - PLACE: Geographic locations, sites
        - EVENT: Historical events, exhibitions, activities
        - MEDIA: Digital files (images, videos, audio)
    """
    OBJECT = "Object"
    WORK = "Work"
    AGENT = "Agent"
    PLACE = "Place"
    EVENT = "Event"
    MEDIA = "Media"


class MediaType(str, Enum):
    """Media file types for MediaReference."""
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    DOCUMENT = "document"
    MODEL_3D = "3d-model"
    OTHER = "other"


# =============================================================================
# NESTED MODELS
# =============================================================================

class Identifier(BaseModel):
    """
    External identifier with scheme and value.

    Examples:
        - scheme="source", value="loc:2018645678"
        - scheme="url", value="https://www.loc.gov/item/2018645678/"
        - scheme="doi", value="10.1234/example"
        - scheme="accession", value="ACC-2023-001"
    """
    scheme: str = Field(..., min_length=1, description="Identifier scheme (e.g., 'source', 'url', 'doi')")
    value: str = Field(..., min_length=1, description="Identifier value")


class Classification(BaseModel):
    """
    Subject or type classification.

    Examples:
        - scheme="lcsh", label="Civil War"
        - scheme="aat", id="300015636", label="Maps"
        - scheme="local", label="Historical Documents"
    """
    scheme: str = Field(..., min_length=1, description="Classification scheme (e.g., 'lcsh', 'aat', 'local')")
    id: str | None = Field(default=None, description="Classification ID within scheme")
    label: str | None = Field(default=None, description="Human-readable label")

    @model_validator(mode="after")
    def require_id_or_label(self) -> "Classification":
        """Require at least id or label to be present."""
        if self.id is None and self.label is None:
            raise ValueError("Classification must have at least 'id' or 'label'")
        return self


class Relationship(BaseModel):
    """
    Relationship to another entity.

    Examples:
        - type="creator", target="mdrn:agent:123", label="John Smith"
        - type="partOf", target="mdrn:collection:456", label="Civil War Maps Collection"
        - type="depicts", target="mdrn:place:789", role="subject"
    """
    type: str = Field(..., min_length=1, description="Relationship type (e.g., 'creator', 'partOf', 'depicts')")
    target: str = Field(..., min_length=1, description="Target entity ID (mdrn:... or source ref)")
    role: str | None = Field(default=None, description="Optional role qualifier")
    label: str | None = Field(default=None, description="Human-readable label for target")


class MediaReference(BaseModel):
    """
    Reference to associated media file.

    The id should be stable and deterministic for the same media asset.

    Examples:
        - id="mdrn:media:loc:12345:thumb", type="image", url="https://..."
        - id="mdrn:media:sia:abc:primary", type="image", label="Primary image"
    """
    id: str = Field(..., min_length=1, description="Stable media identifier")
    type: MediaType = Field(..., description="Media type")
    url: str | None = Field(default=None, description="URL to media file")
    label: str | None = Field(default=None, description="Display label")
    role: str | None = Field(default=None, description="Role (e.g., 'thumbnail', 'primary', 'alternate')")


class Extension(BaseModel):
    """
    Namespaced extension for source-specific or domain-specific data.

    Extensions allow connectors to preserve raw source data and add
    custom fields without polluting the canonical envelope.

    Namespace Convention:
        - "source.<system>": Raw source data (e.g., "source.loc", "source.smithsonian")
        - "domain.<name>": Domain-specific extensions
        - "custom.<org>": Organization-specific extensions

    Examples:
        - namespace="source.loc", type="LocRaw", data={...raw LOC fields...}
        - namespace="domain.museum", type="AccessionInfo", data={"number": "ACC-001"}

    Size Warning:
        Extensions with data > 1MB will trigger a warning during validation.
        Consider storing large raw payloads in a separate SourceRecord table.
    """
    namespace: str = Field(..., min_length=1, description="Extension namespace")
    type: str = Field(..., min_length=1, description="Extension type within namespace")
    data: dict[str, Any] = Field(default_factory=dict, description="Extension payload")


class ProvenanceSource(BaseModel):
    """Source system information within provenance."""
    system: str = Field(..., min_length=1, description="Source system identifier (e.g., 'loc', 'smithsonian')")
    dataset: str | None = Field(default=None, description="Dataset identifier if applicable")
    recordId: str = Field(..., min_length=1, description="Record ID in source system")


class Provenance(BaseModel):
    """
    Provenance tracking for canonical records.

    Tracks where the data came from and how it was processed.
    """
    source: ProvenanceSource = Field(..., description="Source system information")
    sourceRecordId: str | None = Field(default=None, description="Original source record identifier")
    snapshotId: str | None = Field(default=None, description="Snapshot/extraction identifier")
    mappingId: str | None = Field(default=None, description="Mapping configuration ID if applicable")
    transformId: str | None = Field(default=None, description="Transform version ID if applicable")
    pipelineId: str | None = Field(default=None, description="Pipeline ID that processed this record")
    ingestedAt: datetime = Field(..., description="UTC timestamp when record was ingested")


class Meta(BaseModel):
    """
    Metadata about the canonical record itself.
    """
    schemaVersion: str = Field(default="1.0.0", description="Canonical schema version")
    createdAt: datetime = Field(..., description="UTC timestamp when record was first created")
    updatedAt: datetime = Field(..., description="UTC timestamp when record was last updated")
    hash: str | None = Field(default=None, description="Content hash for change detection")
    profile: str | None = Field(default=None, description="Profile name this record conforms to (e.g., 'collections')")
    profileVersion: str | None = Field(default=None, description="Version of the profile when validated")


# =============================================================================
# CANONICAL RECORD MODELS
# =============================================================================

class CanonicalDraft(BaseModel):
    """
    Draft canonical record returned by connector.normalize().

    Connectors produce CanonicalDraft with provenance/meta optional.
    Ingestion finalizes drafts into full CanonicalRecord before persistence.

    This allows connectors to focus on data mapping while ingestion
    handles timestamps and provenance consistently.
    """
    # Required fields
    id: str = Field(..., min_length=1, description="Stable canonical identifier (e.g., 'mdrn:loc:12345')")
    type: CanonicalRecordType = Field(..., description="Entity type")
    label: str = Field(..., min_length=1, description="Primary display title")

    # Optional descriptive fields
    description: str | None = Field(default=None, description="Longer description")
    status: str | None = Field(default=None, description="Record status")

    # Structured fields with defaults
    identifiers: list[Identifier] = Field(default_factory=list, description="External identifiers")
    classifications: list[Classification] = Field(default_factory=list, description="Classifications/subjects")
    properties: dict[str, Any] = Field(default_factory=dict, description="Flexible domain-specific fields")
    relationships: list[Relationship] = Field(default_factory=list, description="Entity relationships")
    media: list[MediaReference] = Field(default_factory=list, description="Associated media")
    rights: str | None = Field(default=None, description="Rights statement")
    extensions: list[Extension] = Field(default_factory=list, description="Namespaced extensions")

    # Optional provenance/meta (filled by ingestion if not provided)
    provenance: Provenance | None = Field(default=None, description="Provenance (optional in draft)")
    meta: Meta | None = Field(default=None, description="Metadata (optional in draft)")

    @field_validator("properties", mode="before")
    @classmethod
    def ensure_properties_serializable(cls, v: Any) -> dict[str, Any]:
        """Ensure properties is JSON-serializable."""
        if v is None:
            return {}
        if not isinstance(v, dict):
            raise ValueError(f"properties must be a dict, got {type(v).__name__}")
        # Best-effort JSON serialization check
        try:
            json.dumps(v, default=str)
        except (TypeError, ValueError) as e:
            raise ValueError(f"properties must be JSON-serializable: {e}")
        return v

    model_config = {
        "extra": "forbid",  # Reject unknown fields at top level
        "json_encoders": {datetime: lambda v: v.isoformat().replace("+00:00", "Z")},
    }


class CanonicalRecord(CanonicalDraft):
    """
    Finalized canonical record for persistence.

    Extends CanonicalDraft with required provenance and meta fields.
    This is what gets stored in EntityCurrent.payload.
    """
    # Override to make required
    provenance: Provenance = Field(..., description="Provenance tracking (required)")
    meta: Meta = Field(..., description="Record metadata (required)")


# =============================================================================
# VALIDATION HELPERS
# =============================================================================

class ValidationResult(BaseModel):
    """Result of canonical schema validation."""
    is_valid: bool
    record: CanonicalRecord | None = None
    errors: list[str] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)

    def __bool__(self) -> bool:
        return self.is_valid


def validate_canonical_record(
    data: dict[str, Any],
    strict: bool = False,
) -> ValidationResult:
    """
    Validate a dict against the CanonicalRecord schema.

    Args:
        data: Dictionary to validate
        strict: If True, warnings become errors

    Returns:
        ValidationResult with is_valid, parsed record, errors, and warnings
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(data, dict):
        return ValidationResult(
            is_valid=False,
            errors=[f"Expected dict, got {type(data).__name__}"],
        )

    # CRITICAL: Check for unknown top-level keys
    # This catches source-native keys that leaked into the payload
    unknown_keys = check_unknown_top_level_keys(data)
    if unknown_keys:
        errors.append(
            f"Unknown top-level keys not allowed: {unknown_keys}. "
            "Source-specific data must go in extensions[].data only."
        )
        return ValidationResult(
            is_valid=False,
            errors=errors,
        )

    try:
        record = CanonicalRecord.model_validate(data)
        return ValidationResult(
            is_valid=True,
            record=record,
            warnings=warnings,
        )
    except Exception as e:
        errors.append(str(e))
        return ValidationResult(
            is_valid=False,
            errors=errors,
            warnings=warnings,
        )


def validate_canonical_draft(
    data: dict[str, Any],
) -> ValidationResult:
    """
    Validate a dict against the CanonicalDraft schema.

    Use this to validate connector normalize() output before finalization.

    Args:
        data: Dictionary to validate

    Returns:
        ValidationResult with is_valid, errors, and warnings
    """
    errors: list[str] = []
    warnings: list[str] = []

    if not isinstance(data, dict):
        return ValidationResult(
            is_valid=False,
            errors=[f"Expected dict, got {type(data).__name__}"],
        )

    # CRITICAL: Check for unknown top-level keys BEFORE Pydantic validation
    # This catches source-native keys that leaked into the payload
    unknown_keys = check_unknown_top_level_keys(data)
    if unknown_keys:
        errors.append(
            f"Unknown top-level keys not allowed: {unknown_keys}. "
            "Source-specific data must go in extensions[].data only."
        )
        return ValidationResult(
            is_valid=False,
            errors=errors,
        )

    try:
        draft = CanonicalDraft.model_validate(data)

        # Check for label fallback (title missing from source)
        if draft.label and draft.label.startswith(("LOC Item ", "Smithsonian Object ", "Untitled")):
            warnings.append(f"Label appears to be a fallback: '{draft.label}' - source may be missing title")

        # Check extension sizes (warn if any > 1MB)
        for ext in draft.extensions:
            try:
                ext_size = len(json.dumps(ext.data, default=str))
                if ext_size > 1_000_000:  # 1MB
                    warnings.append(
                        f"Extension '{ext.namespace}:{ext.type}' is large ({ext_size // 1000}KB). "
                        "Consider storing large raw payloads separately."
                    )
            except (TypeError, ValueError):
                pass  # Skip size check if can't serialize

        return ValidationResult(
            is_valid=True,
            warnings=warnings,
        )
    except Exception as e:
        errors.append(str(e))
        return ValidationResult(
            is_valid=False,
            errors=errors,
            warnings=warnings,
        )


# =============================================================================
# SEMANTIC HASH COMPUTATION
# =============================================================================
#
# SEMANTIC HASH POLICY
# ====================
# The canonical hash (`meta.hash`) represents the SEMANTIC CONTENT of a record.
# It is used for:
#   - Change detection: Only semantic changes trigger "updated" events
#   - Idempotency: Re-ingesting same content produces same hash
#   - Deduplication: Same content from retries is recognized
#
# INCLUDED IN HASH (semantic fields):
#   - id, type, label, description, status
#   - identifiers (sorted by scheme, value)
#   - classifications (sorted by scheme, id, label)
#   - properties (recursively sorted keys)
#   - relationships (sorted by type, target, role, label)
#   - media (sorted by id, url, role, type)
#   - rights (stable object)
#   - meta.schemaVersion (part of content identity)
#   - provenance.source (system, dataset, recordId - stable source pointer)
#
# EXCLUDED FROM HASH (volatile/operational fields):
#   - meta.createdAt, meta.updatedAt, meta.hash (timestamps, self-reference)
#   - provenance.ingestedAt (changes every ingest)
#   - provenance.snapshotId, mappingId, transformId, routeId (per-run metadata)
#   - extensions.data (by default - see HASH_INCLUDE_EXTENSION_DATA)
#
# EXTENSION DATA POLICY:
#   By default, extension.data is EXCLUDED from semantic hash because:
#   1. Source systems add/remove fields frequently (causes spurious changes)
#   2. Raw source data often contains volatile metadata (timestamps, API versions)
#   3. Semantic content should be in canonical fields, not raw extensions
#
#   Only extension.namespace and extension.type are included in hash.
#   Set HASH_INCLUDE_EXTENSION_DATA=True to include full extension data.
#
# =============================================================================

# Configuration: Whether to include extension.data in semantic hash
# Default: False (recommended) - only namespace/type are hashed
HASH_INCLUDE_EXTENSION_DATA = False


def stable_json_dumps(obj: Any) -> str:
    """
    Serialize object to JSON with stable, deterministic ordering.

    This function ensures:
    - Dict keys are sorted recursively at all levels
    - Lists maintain their order (semantic ordering preserved)
    - No whitespace (compact representation)
    - Consistent handling of None, booleans, numbers

    Args:
        obj: Any JSON-serializable object

    Returns:
        Deterministic JSON string

    Example:
        >>> stable_json_dumps({"b": 1, "a": {"d": 2, "c": 3}})
        '{"a":{"c":3,"d":2},"b":1}'
    """
    def _sort_recursive(item: Any) -> Any:
        """Recursively sort dict keys, preserving list order."""
        if isinstance(item, dict):
            # Sort keys and recurse into values
            return {k: _sort_recursive(v) for k, v in sorted(item.items())}
        elif isinstance(item, list):
            # Preserve list order but recurse into elements
            return [_sort_recursive(elem) for elem in item]
        else:
            return item

    sorted_obj = _sort_recursive(obj)
    return json.dumps(sorted_obj, separators=(",", ":"), ensure_ascii=False, default=str)


def _sort_identifiers(identifiers: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Sort identifiers by (scheme, value) for stable ordering."""
    if not identifiers:
        return []
    return sorted(
        identifiers,
        key=lambda x: (x.get("scheme", ""), x.get("value", ""))
    )


def _sort_classifications(classifications: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Sort classifications by (scheme, id, label) for stable ordering."""
    if not classifications:
        return []
    return sorted(
        classifications,
        key=lambda x: (
            x.get("scheme", ""),
            x.get("id") or "",
            x.get("label") or ""
        )
    )


def _sort_relationships(relationships: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Sort relationships by (type, target, role, label) for stable ordering."""
    if not relationships:
        return []
    return sorted(
        relationships,
        key=lambda x: (
            x.get("type", ""),
            x.get("target", ""),
            x.get("role") or "",
            x.get("label") or ""
        )
    )


def _sort_media(media: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    """Sort media references by (id, url, role, type) for stable ordering."""
    if not media:
        return []
    return sorted(
        media,
        key=lambda x: (
            x.get("id", ""),
            x.get("url") or "",
            x.get("role") or "",
            x.get("type") or ""
        )
    )


def _sort_extensions(
    extensions: list[dict[str, Any]] | None,
    include_data: bool = False
) -> list[dict[str, Any]]:
    """
    Sort extensions by (namespace, type) for stable ordering.

    Args:
        extensions: List of extension dicts
        include_data: If True, include extension.data in output (default: False)

    Returns:
        Sorted list with optionally trimmed extension data
    """
    if not extensions:
        return []

    sorted_exts = sorted(
        extensions,
        key=lambda x: (x.get("namespace", ""), x.get("type", ""))
    )

    if include_data:
        return sorted_exts
    else:
        # Only include namespace and type, not data
        return [
            {"namespace": ext.get("namespace", ""), "type": ext.get("type", "")}
            for ext in sorted_exts
        ]


def canonical_hash_material(
    record: dict[str, Any],
    include_extension_data: bool | None = None
) -> dict[str, Any]:
    """
    Extract the semantic content for hash computation.

    This function creates a normalized representation of the canonical record
    containing only the fields that represent semantic content. Volatile
    operational fields (timestamps, run IDs, etc.) are excluded.

    Args:
        record: Canonical record dict
        include_extension_data: Whether to include extension.data in hash material.
                               If None, uses global HASH_INCLUDE_EXTENSION_DATA setting.

    Returns:
        Dict containing only semantic fields, sorted for stable hashing

    Semantic Fields (included):
        - id, type, label, description, status
        - identifiers (sorted)
        - classifications (sorted)
        - properties (recursively sorted)
        - relationships (sorted)
        - media (sorted)
        - rights
        - meta.schemaVersion
        - provenance.source (system, dataset, recordId)
        - extensions (namespace, type only - unless include_extension_data=True)

    Volatile Fields (excluded):
        - meta.createdAt, meta.updatedAt, meta.hash
        - provenance.ingestedAt, snapshotId, mappingId, transformId, routeId
        - provenance.sourceRecordId (derived from source.recordId)
    """
    if include_extension_data is None:
        include_extension_data = HASH_INCLUDE_EXTENSION_DATA

    material: dict[str, Any] = {}

    # Core semantic fields (always included)
    for field in ("id", "type", "label", "description", "status"):
        if field in record and record[field] is not None:
            material[field] = record[field]

    # Sorted array fields
    if record.get("identifiers"):
        material["identifiers"] = _sort_identifiers(record["identifiers"])

    if record.get("classifications"):
        material["classifications"] = _sort_classifications(record["classifications"])

    if record.get("relationships"):
        material["relationships"] = _sort_relationships(record["relationships"])

    if record.get("media"):
        material["media"] = _sort_media(record["media"])

    # Properties dict (will be recursively sorted by stable_json_dumps)
    if record.get("properties"):
        material["properties"] = record["properties"]

    # Rights (stable object, included as-is)
    if record.get("rights"):
        material["rights"] = record["rights"]

    # Extensions (namespace/type only by default)
    if record.get("extensions"):
        material["extensions"] = _sort_extensions(
            record["extensions"],
            include_data=include_extension_data
        )

    # Meta: only schemaVersion (timestamps and hash excluded)
    if record.get("meta") and isinstance(record["meta"], dict):
        meta = record["meta"]
        if meta.get("schemaVersion"):
            material["meta"] = {"schemaVersion": meta["schemaVersion"]}

    # Provenance: only stable source pointer (all per-run fields excluded)
    if record.get("provenance") and isinstance(record["provenance"], dict):
        prov = record["provenance"]
        prov_material: dict[str, Any] = {}

        # Include source coordinates (stable identity)
        if prov.get("source") and isinstance(prov["source"], dict):
            source = prov["source"]
            source_material: dict[str, Any] = {}
            for field in ("system", "dataset", "recordId"):
                if source.get(field) is not None:
                    source_material[field] = source[field]
            if source_material:
                prov_material["source"] = source_material

        if prov_material:
            material["provenance"] = prov_material

    return material


def compute_canonical_hash(
    record: dict[str, Any],
    include_extension_data: bool | None = None
) -> str:
    """
    Compute stable semantic hash of canonical record for change detection.

    CRITICAL: This hash must be SEMANTICALLY STABLE, meaning:
    - Same content → same hash across re-ingests
    - Same content → same hash across retries
    - Same content → same hash regardless of ingest time

    The hash changes ONLY when semantic content changes:
    - Label, description, or status changes
    - Identifiers, classifications, relationships, or media changes
    - Properties values change
    - Rights information changes
    - Schema version changes

    The hash does NOT change when:
    - Timestamps change (createdAt, updatedAt, ingestedAt)
    - Run metadata changes (runId, snapshotId, mappingId, transformId, routeId)
    - List ordering differs (identifiers, classifications, etc.)
    - Dict key ordering differs (properties, etc.)
    - Extension raw data changes (unless HASH_INCLUDE_EXTENSION_DATA=True)

    Args:
        record: Canonical record dict
        include_extension_data: Override for extension data inclusion (default: use global setting)

    Returns:
        SHA256 hex digest of semantic content

    Example:
        >>> record = {"id": "123", "type": "Object", "label": "Test"}
        >>> compute_canonical_hash(record)
        'a1b2c3...'  # Stable across re-ingests
    """
    # Extract only semantic fields
    material = canonical_hash_material(record, include_extension_data)

    # Serialize with stable ordering
    canonical_json = stable_json_dumps(material)

    # Compute SHA256
    return hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()


def finalize_draft(
    draft: CanonicalDraft | dict[str, Any],
    source_system: str,
    source_id: str,
    dataset_id: str | None = None,
    pipeline_id: str | None = None,
    existing_created_at: datetime | None = None,
) -> CanonicalRecord:
    """
    Finalize a CanonicalDraft into a full CanonicalRecord.

    Fills in provenance and meta fields that connectors don't need to handle.

    Args:
        draft: CanonicalDraft instance or dict
        source_system: Source system identifier
        source_id: Record ID in source system
        dataset_id: Optional dataset identifier
        pipeline_id: Optional pipeline identifier
        existing_created_at: If updating, preserve original createdAt

    Returns:
        Finalized CanonicalRecord ready for persistence
    """
    now = datetime.now(timezone.utc)

    # Convert dict to CanonicalDraft if needed
    if isinstance(draft, dict):
        draft = CanonicalDraft.model_validate(draft)

    # Build provenance
    # Note: sourceRecordId is intentionally omitted as it duplicates source.recordId
    provenance = draft.provenance or Provenance(
        source=ProvenanceSource(
            system=source_system,
            dataset=dataset_id,
            recordId=source_id,
        ),
        pipelineId=pipeline_id,
        ingestedAt=now,
    )

    # Update ingestedAt if provenance existed but ingestedAt wasn't set
    if provenance.ingestedAt is None:
        provenance = provenance.model_copy(update={"ingestedAt": now})

    # Build meta
    created_at = existing_created_at or now
    meta = draft.meta or Meta(
        schemaVersion="1.0.0",
        createdAt=created_at,
        updatedAt=now,
    )

    # Always update updatedAt
    meta = meta.model_copy(update={"updatedAt": now})

    # Build record dict for hash computation
    record_dict = draft.model_dump()
    record_dict["provenance"] = provenance.model_dump()
    record_dict["meta"] = meta.model_dump()

    # Compute hash (excluding updatedAt)
    content_hash = compute_canonical_hash(record_dict)
    meta = meta.model_copy(update={"hash": content_hash})

    # Create final record
    return CanonicalRecord(
        id=draft.id,
        type=draft.type,
        label=draft.label,
        description=draft.description,
        status=draft.status,
        identifiers=draft.identifiers,
        classifications=draft.classifications,
        properties=draft.properties,
        relationships=draft.relationships,
        media=draft.media,
        rights=draft.rights,
        extensions=draft.extensions,
        provenance=provenance,
        meta=meta,
    )


# =============================================================================
# ALLOWED CANONICAL KEYS
# =============================================================================

# Required top-level fields for a payload to be considered canonical
CANONICAL_REQUIRED_FIELDS = frozenset({"id", "type", "label", "provenance", "meta"})

# ALL allowed top-level fields in a canonical record
# This is the authoritative list - any other keys are violations
CANONICAL_ALLOWED_FIELDS = frozenset({
    # Required fields
    "id",
    "type",
    "label",
    "provenance",
    "meta",
    # Optional descriptive fields
    "description",
    "status",
    # Structured array/dict fields
    "identifiers",
    "classifications",
    "properties",
    "relationships",
    "media",
    "rights",
    "extensions",
})


def check_unknown_top_level_keys(payload: dict[str, Any]) -> list[str]:
    """
    Check for unknown top-level keys in a canonical payload.

    Source-specific keys (e.g., 'descriptiveNonRepeating', 'freetext') must NOT
    appear at top level. They belong in extensions[].data only.

    Args:
        payload: Canonical payload dict

    Returns:
        List of unknown keys found (empty if valid)

    Example:
        >>> check_unknown_top_level_keys({"id": "x", "type": "Work", "label": "Y", "freetext": {}})
        ['freetext']
    """
    if not isinstance(payload, dict):
        return []
    return sorted(set(payload.keys()) - CANONICAL_ALLOWED_FIELDS)


# =============================================================================
# LEGACY PAYLOAD POLICY
# =============================================================================
#
# POLICY OVERVIEW:
# ================
# A "legacy payload" is any entity payload that fails is_canonical_payload().
# This includes pre-canonical records ingested before schema enforcement.
#
# HANDLING POLICY:
# ----------------
# 1. READABLE: Legacy payloads remain accessible via API/UI
# 2. MARKED: Legacy payloads are wrapped with explicit markers:
#    - meta.schemaVersion = "legacy"
#    - meta.validationStatus = "legacy"
#    - provenance.migrationRequired = true
# 3. PROTECTED: New ingests should NOT produce legacy payloads
#    - All connectors must use CanonicalDraft/CanonicalRecord
#    - Legacy creation only occurs for deprecated/emergency paths
# 4. OBSERVABLE: Legacy payload encounters are logged with:
#    - entity_key, source_system, source_id
#    - route/run context if available
# 5. MIGRATABLE: Legacy records can be identified and re-processed:
#    - Query by meta.schemaVersion = "legacy"
#    - Migration tool: backend/scripts/migrate_legacy_payloads.py
#
# DETECTION:
# ----------
# - is_canonical_payload(): Structural check for canonical envelope
# - is_legacy_payload(): Check if payload has legacy markers
# - get_payload_status(): Full status info including validation state
#
# API RESPONSE FORMAT:
# --------------------
# Both canonical and legacy payloads use the same envelope structure.
# Frontend checks payload.meta.schemaVersion to display legacy badge.
# Legacy payloads include original data in the payload itself (merged).
#
# =============================================================================


class PayloadStatus(str, Enum):
    """Status of an entity payload."""
    CANONICAL = "canonical"      # Valid canonical record
    CANONICAL_INVALID = "canonical_invalid"  # Has structure but fails validation
    LEGACY = "legacy"            # Legacy (pre-canonical) format
    UNKNOWN = "unknown"          # Cannot determine status


class LegacyPayloadInfo(BaseModel):
    """Information about a legacy payload for reporting and migration."""
    entity_key: str | None = None
    source_system: str | None = None
    source_id: str | None = None
    status: PayloadStatus = PayloadStatus.UNKNOWN
    is_wrapped: bool = False     # Has legacy wrapper (meta.schemaVersion="legacy")
    validation_errors: list[str] = Field(default_factory=list)
    original_keys: list[str] = Field(default_factory=list)  # Top-level keys in original


def is_legacy_payload(payload: dict[str, Any]) -> bool:
    """
    Check if a payload is marked as legacy (wrapped legacy record).

    A payload is considered legacy if:
    - meta.schemaVersion == "legacy"
    - meta.validationStatus == "legacy"
    - provenance.migrationRequired == True

    Args:
        payload: Entity payload dict

    Returns:
        True if payload has legacy markers, False otherwise
    """
    if not isinstance(payload, dict):
        return False

    meta = payload.get("meta")
    if isinstance(meta, dict):
        if meta.get("schemaVersion") == "legacy":
            return True
        if meta.get("validationStatus") == "legacy":
            return True

    provenance = payload.get("provenance")
    if isinstance(provenance, dict):
        if provenance.get("migrationRequired") is True:
            return True

    return False


def get_payload_status(payload: dict[str, Any]) -> LegacyPayloadInfo:
    """
    Get comprehensive status information about a payload.

    Returns status, validation errors, and metadata useful for
    reporting and migration.

    Args:
        payload: Entity payload dict

    Returns:
        LegacyPayloadInfo with status and metadata
    """
    info = LegacyPayloadInfo()

    if not isinstance(payload, dict):
        info.status = PayloadStatus.UNKNOWN
        return info

    # Extract identifying info
    info.entity_key = payload.get("id") or payload.get("entity_key")
    info.original_keys = sorted(payload.keys())

    # Try to get source info
    provenance = payload.get("provenance")
    if isinstance(provenance, dict):
        source = provenance.get("source")
        if isinstance(source, dict):
            info.source_system = source.get("system")
            info.source_id = source.get("recordId")

    # Check for legacy markers
    if is_legacy_payload(payload):
        info.status = PayloadStatus.LEGACY
        info.is_wrapped = True
        return info

    # Check if canonical
    if is_canonical_payload(payload):
        # Validate to check if it's valid or just structurally canonical
        result = validate_canonical_record(payload)
        if result.is_valid:
            info.status = PayloadStatus.CANONICAL
        else:
            info.status = PayloadStatus.CANONICAL_INVALID
            info.validation_errors = result.errors
        return info

    # Neither canonical nor wrapped legacy - it's raw legacy
    info.status = PayloadStatus.LEGACY
    info.is_wrapped = False
    return info


def is_canonical_payload(payload: dict[str, Any]) -> bool:
    """
    Check if a payload dict follows the canonical schema structure.

    This is used to distinguish legacy (pre-canonical) payloads from
    canonical payloads when reading from the database.

    Args:
        payload: Entity payload dict

    Returns:
        True if payload has canonical structure, False if legacy

    Note:
        This is a quick structural check, not full validation.
        Use validate_canonical_record() for complete validation.
    """
    if not isinstance(payload, dict):
        return False

    # Check for required top-level fields
    if not CANONICAL_REQUIRED_FIELDS.issubset(payload.keys()):
        return False

    # Check type is valid enum value
    try:
        CanonicalRecordType(payload.get("type"))
    except (ValueError, TypeError):
        return False

    # Check provenance and meta are dicts with expected keys
    provenance = payload.get("provenance")
    if not isinstance(provenance, dict) or "source" not in provenance:
        return False

    meta = payload.get("meta")
    if not isinstance(meta, dict) or "schemaVersion" not in meta:
        return False

    return True


# =============================================================================
# CONNECTOR HELPERS
# =============================================================================

def create_source_extension(
    source_system: str,
    raw_data: dict[str, Any],
    type_suffix: str = "Raw",
) -> Extension:
    """
    Create a standard source extension for preserving raw connector data.

    Args:
        source_system: Source system name (e.g., "loc", "smithsonian")
        raw_data: Raw source record to preserve
        type_suffix: Type suffix (default "Raw")

    Returns:
        Extension with namespace="source.<system>" and type="<System>Raw"
    """
    system_capitalized = source_system.capitalize()
    return Extension(
        namespace=f"source.{source_system}",
        type=f"{system_capitalized}{type_suffix}",
        data=raw_data,
    )


def create_media_reference(
    source_system: str,
    source_id: str,
    url: str,
    media_type: MediaType = MediaType.IMAGE,
    role: str = "thumbnail",
    label: str | None = None,
) -> MediaReference:
    """
    Create a MediaReference with deterministic ID.

    Args:
        source_system: Source system name
        source_id: Source record ID
        url: Media URL
        media_type: Type of media
        role: Media role (thumbnail, primary, etc.)
        label: Optional display label

    Returns:
        MediaReference with stable ID
    """
    return MediaReference(
        id=f"mdrn:media:{source_system}:{source_id}:{role}",
        type=media_type,
        url=url,
        role=role,
        label=label,
    )
