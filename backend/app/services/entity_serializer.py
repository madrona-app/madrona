"""
Entity Payload Serializer for API Responses.

Provides consistent serialization of entity payloads for API responses,
handling both canonical and legacy payload formats.

DESIGN:
- Both canonical and legacy payloads return the same envelope structure
- Frontend checks payload.meta.schemaVersion to display legacy badge
- Legacy payloads have all original data preserved in the payload

USAGE:
    from app.services.entity_serializer import serialize_entity_payload

    # In API endpoint:
    entity = db.session.query(EntityCurrent).first()
    response_payload = serialize_entity_payload(entity.payload, entity.entity_key)
"""

import logging
from typing import Any

from app.schemas.canonical import (
    is_canonical_payload,
    is_legacy_payload,
    PayloadStatus,
)

logger = logging.getLogger(__name__)


def serialize_entity_payload(
    payload: dict[str, Any],
    entity_key: str | None = None,
    include_status: bool = True,
) -> dict[str, Any]:
    """
    Serialize an entity payload for API response.

    Ensures consistent structure for both canonical and legacy payloads.
    Adds a _status field to indicate payload type for debugging.

    Args:
        payload: Entity payload dict
        entity_key: Entity key for logging context
        include_status: If True, adds _status field (default True)

    Returns:
        Serialized payload dict ready for API response

    Behavior:
        - Canonical payloads: returned as-is
        - Legacy payloads (wrapped): returned as-is (already has meta/provenance)
        - Legacy payloads (unwrapped): should not occur in normal operation
    """
    if not isinstance(payload, dict):
        logger.warning(
            "invalid_payload_type",
            extra={
                "event_type": "serialization_warning",
                "entity_key": entity_key,
                "payload_type": type(payload).__name__,
            },
        )
        return {"_error": "Invalid payload type", "_status": "invalid"}

    # Determine status
    status: PayloadStatus
    if is_canonical_payload(payload):
        status = PayloadStatus.CANONICAL
    elif is_legacy_payload(payload):
        status = PayloadStatus.LEGACY
    else:
        # Unwrapped legacy - should not happen in normal operation
        status = PayloadStatus.LEGACY
        logger.warning(
            "unwrapped_legacy_payload",
            extra={
                "event_type": "serialization_warning",
                "entity_key": entity_key,
                "keys": sorted(payload.keys())[:10],
            },
        )

    # Return payload with optional status field
    if include_status:
        return {
            **payload,
            "_status": status.value,
        }
    return payload


def serialize_entity_for_api(
    entity: Any,  # EntityCurrent
    include_payload_status: bool = True,
) -> dict[str, Any]:
    """
    Serialize an EntityCurrent instance for API response.

    Provides consistent structure for all entity responses.

    Args:
        entity: EntityCurrent instance
        include_payload_status: If True, adds _status to payload

    Returns:
        Dict suitable for JSON response
    """
    payload = entity.payload if isinstance(entity.payload, dict) else {}

    serialized_payload = serialize_entity_payload(
        payload,
        entity_key=entity.entity_key,
        include_status=include_payload_status,
    )

    return {
        "entity_key": entity.entity_key,
        "entity_type": entity.entity_type,
        "dataset_id": str(entity.dataset_id) if entity.dataset_id else None,
        "source_system": entity.source_system,
        "source_id": entity.source_id,
        "canonical_url": entity.canonical_url,
        "payload": serialized_payload,
        "payload_hash": entity.payload_hash,
        "extracted_at": entity.extracted_at.isoformat() if entity.extracted_at else None,
        "last_seen_at": entity.last_seen_at.isoformat() if entity.last_seen_at else None,
        "updated_at": entity.updated_at.isoformat() if entity.updated_at else None,
        "last_run_id": str(entity.last_run_id) if entity.last_run_id else None,
    }


def get_payload_display_info(payload: dict[str, Any]) -> dict[str, Any]:
    """
    Extract display-relevant information from a payload.

    Used by frontend to show appropriate UI elements.

    Args:
        payload: Entity payload dict

    Returns:
        Dict with:
            - is_legacy: bool
            - is_canonical: bool
            - schema_version: str or None
            - label: str (best-effort display label)
            - type: str (canonical type or "legacy")
    """
    if not isinstance(payload, dict):
        return {
            "is_legacy": True,
            "is_canonical": False,
            "schema_version": None,
            "label": "(Invalid payload)",
            "type": "unknown",
        }

    is_legacy = is_legacy_payload(payload)
    is_canonical = is_canonical_payload(payload)

    # Extract schema version
    meta = payload.get("meta", {})
    schema_version = meta.get("schemaVersion") if isinstance(meta, dict) else None

    # Extract best label
    label = (
        payload.get("label")
        or payload.get("title")
        or payload.get("name")
        or "(Untitled)"
    )

    # Extract type
    if is_canonical:
        record_type = payload.get("type", "Object")
    elif is_legacy:
        record_type = "legacy"
    else:
        record_type = "unknown"

    return {
        "is_legacy": is_legacy,
        "is_canonical": is_canonical,
        "schema_version": schema_version,
        "label": label,
        "type": record_type,
    }
