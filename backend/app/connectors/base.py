"""
Connector base classes for Madrona v1.

Defines the standard interfaces that all connectors must implement.
Connectors are dynamically loaded from connector_definitions.implementation_key
and instantiated with validated configuration.

Per the Madrona API Contract v1.1:
- BaseSourceConnector: extract() and normalize() for pulling data
- BaseTargetConnector: publish_records() and publish_change_log() for pushing data

Canonical Schema v1:
- normalize() MUST return a CanonicalDraft (or CanonicalRecord) envelope
- The envelope contains: id, type, label, properties, extensions, etc.
- Raw source data should be preserved in extensions with namespace "source.<system>"
- Ingestion will finalize drafts by adding provenance and meta fields
"""

from abc import ABC, abstractmethod
import logging
from typing import Any, Iterable, Literal

logger = logging.getLogger(__name__)


class BaseConnector(ABC):
    """
    Base class for all connectors.

    All connectors must specify their direction and implement config validation.
    """

    direction: Literal["source", "target", "both"]

    def __init__(self, config: dict[str, Any], organization_id: str):
        """
        Initialize connector with validated configuration.

        Args:
            config: Validated configuration dictionary (already validated against config_schema)
            organization_id: Organization identifier for multi-organization support
        """
        self.config = config
        self.organization_id = organization_id
        self.validate_config()

    @abstractmethod
    def validate_config(self) -> None:
        """
        Validate connector-specific configuration requirements.

        This is called after JSON schema validation to perform any additional
        connector-specific validation (e.g., API key format, URL reachability).

        Raises:
            ValueError: If configuration is invalid
        """
        pass


class BaseSourceConnector(BaseConnector):
    """
    Base class for source connectors that extract data from external systems.

    Source connectors pull data from external APIs/databases and normalize it
    into canonical format for storage in entity_current.

    Canonical Schema Requirement:
        The normalize() method MUST return a CanonicalDraft envelope containing:
        - id: Stable identifier (e.g., "mdrn:loc:12345")
        - type: CanonicalRecordType enum value (Object, Work, Agent, Place, Event, Media)
        - label: Primary display title (required, non-empty)
        - properties: Flexible dict for domain-specific fields
        - extensions: List of Extension objects for raw source data

        Raw source payloads should be stored in extensions with:
        - namespace: "source.<system>" (e.g., "source.loc")
        - type: "<System>Raw" (e.g., "LocRaw")
        - data: Original source record

    Example normalize() output:
        {
            "entity_key": "loc:12345",
            "source_system": "loc",
            "source_id": "12345",
            "payload": {
                "id": "mdrn:loc:12345",
                "type": "Work",
                "label": "Civil War Map",
                "properties": {"date": "1863", "creator": "Smith"},
                "extensions": [
                    {"namespace": "source.loc", "type": "LocRaw", "data": {...}}
                ]
            }
        }
    """

    direction: Literal["source"] = "source"

    @abstractmethod
    def extract(
        self, cursor: dict[str, Any] | None = None, limit: int | None = None
    ) -> Iterable[dict[str, Any]]:
        """
        Extract raw records from the source system.

        Args:
            cursor: Optional cursor for incremental extraction (e.g., {"since": "2026-01-01T00:00:00Z"})
            limit: Optional maximum number of records to extract

        Yields:
            Raw record dictionaries from the source system

        Example:
            for record in connector.extract(cursor={"since": "2026-01-01"}, limit=100):
                # record is raw data from source API
                pass
        """
        pass

    @abstractmethod
    def normalize(self, record: dict[str, Any]) -> dict[str, Any]:
        """
        Normalize a raw source record into CanonicalDraft format.

        REQUIRED: Connectors MUST return a CanonicalDraft envelope.

        Args:
            record: Raw record from extract()

        Returns:
            Dict with envelope fields:
            - entity_key: Unique identifier (e.g., "loc:12345")
            - source_system: System name (e.g., "loc")
            - source_id: Original ID in source system
            - payload: CanonicalDraft dict containing:
                - id: Stable canonical ID (e.g., "mdrn:loc:12345")
                - type: CanonicalRecordType value ("Object", "Work", etc.)
                - label: Primary display title (required)
                - description: Optional longer description
                - identifiers: List of {scheme, value} identifier objects
                - classifications: List of {scheme, label} classification objects
                - properties: Flexible dict for domain-specific fields
                - media: List of MediaReference objects for images/files
                - extensions: List of Extension objects (MUST include raw source data)

        Implementation Guide:
            1. Generate stable id: f"mdrn:{source_system}:{source_id}"
            2. Choose appropriate type: Work for documents/maps, Object for physical items
            3. Extract label from best available title field
            4. Map source fields to canonical properties
            5. Preserve raw source data in extensions:
               Extension(namespace="source.<system>", type="<System>Raw", data=record)

        Example:
            def normalize(self, record: dict[str, Any]) -> dict[str, Any]:
                source_id = record.get("id", "unknown")
                return {
                    "entity_key": f"loc:{source_id}",
                    "source_system": "loc",
                    "source_id": source_id,
                    "payload": {
                        "id": f"mdrn:loc:{source_id}",
                        "type": "Work",
                        "label": record.get("title", f"LOC Item {source_id}"),
                        "properties": {
                            "date": record.get("date"),
                            "creator": record.get("contributor", [None])[0],
                        },
                        "extensions": [{
                            "namespace": "source.loc",
                            "type": "LocRaw",
                            "data": record,
                        }],
                    },
                }
        """
        pass

    def validate_normalized_output(self, output: dict[str, Any]) -> tuple[bool, list[str]]:
        """
        Validate that normalize() output conforms to canonical schema.

        This is a helper method for connector authors to verify their output.
        Called automatically in debug/dev mode during pipeline execution.

        Args:
            output: The dict returned by normalize()

        Returns:
            Tuple of (is_valid, error_messages)

        Usage:
            # In your normalize() implementation during development:
            result = {...}
            is_valid, errors = self.validate_normalized_output(result)
            if not is_valid:
                logger.warning(f"Canonical validation errors: {errors}")
            return result
        """
        errors = []

        # Check envelope fields
        required_envelope = ["entity_key", "source_system", "source_id", "payload"]
        for field in required_envelope:
            if field not in output:
                errors.append(f"Missing envelope field: {field}")

        payload = output.get("payload", {})
        if not isinstance(payload, dict):
            errors.append(f"payload must be dict, got {type(payload).__name__}")
            return False, errors

        # Check canonical draft fields
        if "id" not in payload:
            errors.append("payload.id is required")
        if "type" not in payload:
            errors.append("payload.type is required")
        if "label" not in payload:
            errors.append("payload.label is required")
        elif not payload.get("label"):
            errors.append("payload.label cannot be empty")

        # Check type is valid
        valid_types = {"Object", "Work", "Agent", "Place", "Event", "Media"}
        if payload.get("type") and payload["type"] not in valid_types:
            errors.append(f"payload.type must be one of {valid_types}, got {payload['type']}")

        # Check extensions contain raw source data
        extensions = payload.get("extensions", [])
        if not isinstance(extensions, list):
            errors.append("payload.extensions must be a list")
        else:
            has_source_extension = any(
                isinstance(ext, dict) and ext.get("namespace", "").startswith("source.")
                for ext in extensions
            )
            if not has_source_extension:
                errors.append("payload.extensions should include raw source data (namespace='source.<system>')")

        return len(errors) == 0, errors


class BaseTargetConnector(BaseConnector):
    """
    Base class for target connectors that publish data to external systems.

    Target connectors receive canonical entity data and change events,
    then publish them to external systems (e.g., Google Sheets, DAM systems).
    """

    direction: Literal["target"] = "target"

    @abstractmethod
    def publish_records(self, entities: list[dict[str, Any]]) -> None:
        """
        Publish current canonical records to target system.

        Args:
            entities: List of entity dicts with canonical payload from entity_current

        Example:
            >>> connector.publish_records([
            ...     {
            ...         "entity_key": "loc:123",
            ...         "payload": {
            ...             "id": "mdrn:loc:123",
            ...             "type": "Work",
            ...             "label": "Civil War Map",
            ...             ...
            ...         }
            ...     }
            ... ])
        """
        raise NotImplementedError("publish_records() must be implemented by target connectors")

    @abstractmethod
    def publish_change_log(self, changes: list[dict[str, Any]]) -> None:
        """
        Publish change events to the target system.

        Args:
            changes: List of change_events records with metadata

        Example:
            connector.publish_change_log([
                {
                    "change_id": "uuid",
                    "entity_key": "loc:123",
                    "change_type": "updated",
                    "changed_fields": ["label", "description"],
                    "occurred_at": "2026-01-04T10:00:00Z",
                    "summary": "Label updated",
                    ...
                }
            ])
        """
        pass

    def get_target_url(self) -> str | None:
        """
        Get the URL to view published data in the target system.

        Returns:
            URL string if target system has a web interface, None otherwise

        Example:
            >>> url = connector.get_target_url()
            >>> print(url)  # "https://docs.google.com/spreadsheets/d/abc123"
        """
        return None

    def supports_deletes(self) -> bool:
        """
        Whether this connector supports delete operations.

        Override this method to return True if your connector can handle
        entity deletions (removing rows, marking as deleted, archiving, etc.).

        Returns:
            True if publish_deletes() is implemented, False otherwise
        """
        return False

    SUPPORTED_DELETE_STRATEGIES = ("remove", "mark", "archive")

    def publish_deletes(
        self,
        deleted_entities: list[dict[str, Any]],
        strategy: str = "remove",
    ) -> dict[str, int]:
        """
        Publish delete operations to the target system.

        Called when entities have been soft-deleted in the canonical store
        and the pipeline destination is configured to publish deletes.

        This base implementation dispatches to strategy-specific methods:
        - ``_publish_deletes_remove()`` — delete the record entirely
        - ``_publish_deletes_mark()``   — set a deleted flag/status field
        - ``_publish_deletes_archive()``— move to an archive location

        Subclasses can either override this method entirely (as the Google
        Sheets connector does) or override individual strategy methods.

        Args:
            deleted_entities: List of dicts with entity info:
                - entity_key: The entity's unique key
                - entity_type: Type of entity (object, work, etc.)
                - deleted_at: ISO timestamp when deleted
                - Any additional payload fields needed for identification
            strategy: How to handle deletes in target:
                - "remove": Delete the record entirely
                - "mark": Set a deleted flag/status field
                - "archive": Move to archive location/sheet

        Returns:
            Dict with counts: {"deleted": N, "failed": N, "skipped": N}

        Raises:
            NotImplementedError: If connector doesn't support deletes
            ValueError: If strategy is not one of the supported values

        Example:
            >>> result = connector.publish_deletes([
            ...     {"entity_key": "loc:123", "deleted_at": "2026-01-19T10:00:00Z"},
            ...     {"entity_key": "loc:456", "deleted_at": "2026-01-19T10:00:00Z"},
            ... ], strategy="remove")
            >>> print(result)  # {"deleted": 2, "failed": 0, "skipped": 0}
        """
        if strategy not in self.SUPPORTED_DELETE_STRATEGIES:
            raise ValueError(
                f"Unknown delete strategy '{strategy}'. "
                f"Supported strategies: {self.SUPPORTED_DELETE_STRATEGIES}"
            )

        if strategy == "remove":
            return self._publish_deletes_remove(deleted_entities)
        elif strategy == "mark":
            return self._publish_deletes_mark(deleted_entities)
        elif strategy == "archive":
            return self._publish_deletes_archive(deleted_entities)

        # Unreachable, but satisfies type checker
        return {"deleted": 0, "failed": 0, "skipped": 0}

    def _publish_deletes_remove(
        self, deleted_entities: list[dict[str, Any]]
    ) -> dict[str, int]:
        """
        Delete records entirely from the target system.

        Override this in your connector to implement the "remove" strategy.

        Args:
            deleted_entities: List of entity dicts to delete

        Returns:
            Dict with counts: {"deleted": N, "failed": N, "skipped": N}
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support the 'remove' delete strategy. "
            "Override _publish_deletes_remove() to enable."
        )

    def _publish_deletes_mark(
        self, deleted_entities: list[dict[str, Any]]
    ) -> dict[str, int]:
        """
        Mark records as deleted in the target system by setting a status field.

        Override this in your connector to implement the "mark" strategy.
        Typical implementation: find each entity's row/record and set a
        ``sync_status`` or ``deleted`` column to indicate deletion.

        Args:
            deleted_entities: List of entity dicts to mark

        Returns:
            Dict with counts: {"deleted": N, "failed": N, "skipped": N}
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support the 'mark' delete strategy. "
            "Override _publish_deletes_mark() to enable."
        )

    def _publish_deletes_archive(
        self, deleted_entities: list[dict[str, Any]]
    ) -> dict[str, int]:
        """
        Move records to an archive location in the target system.

        Override this in your connector to implement the "archive" strategy.
        Typical implementation: copy each entity's row/record to an archive
        table/sheet/location, then remove from the primary location.

        Args:
            deleted_entities: List of entity dicts to archive

        Returns:
            Dict with counts: {"deleted": N, "failed": N, "skipped": N}
        """
        raise NotImplementedError(
            f"{self.__class__.__name__} does not support the 'archive' delete strategy. "
            "Override _publish_deletes_archive() to enable."
        )


class BidirectionalConnector(BaseSourceConnector, BaseTargetConnector):
    """
    Base class for bidirectional connectors that both extract and publish.

    Future use case: DAM systems or collection management systems that both
    provide data and accept updates from Madrona.
    """

    direction: Literal["both"] = "both"

    # Inherits both extract/normalize and publish_records/publish_change_log
    pass
