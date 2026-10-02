"""
Example stub connector implementations for testing and reference.

These demonstrate the connector interface but don't connect to real systems.
"""

import logging
from typing import Any, Iterable

from .base import BaseSourceConnector, BaseTargetConnector

logger = logging.getLogger(__name__)


class StubSourceConnector(BaseSourceConnector):
    """
    Stub source connector for testing.
    
    Returns fake data without connecting to external systems.
    """

    def validate_config(self) -> None:
        """Validate that api_key is present."""
        if "api_key" not in self.config:
            raise ValueError("api_key is required in config")

    def extract(
        self, cursor: dict[str, Any] | None = None, limit: int | None = None
    ) -> Iterable[dict[str, Any]]:
        """
        Yield fake records.
        
        Example:
            >>> connector = StubSourceConnector({"api_key": "test"}, "tenant-123")
            >>> records = list(connector.extract(limit=2))
            >>> len(records)
            2
        """
        count = 0
        max_records = limit or 10

        for i in range(1, max_records + 1):
            if cursor and "since_id" in cursor:
                if i <= cursor["since_id"]:
                    continue

            yield {
                "id": i,
                "title": f"Test Object {i}",
                "description": f"Description for object {i}",
                "modified_date": "2026-01-04T10:00:00Z",
                "image_url": f"https://example.com/image{i}.jpg",
            }

            count += 1
            if count >= max_records:
                break

    def normalize(self, record: dict[str, Any]) -> dict[str, Any]:
        """
        Normalize stub record into canonical format.
        
        Example:
            >>> connector = StubSourceConnector({"api_key": "test"}, "tenant-123")
            >>> raw = {"id": 1, "title": "Test", "modified_date": "2026-01-04"}
            >>> normalized = connector.normalize(raw)
            >>> normalized["entity_key"]
            'stub:1'
        """
        return {
            "entity_key": f"stub:{record['id']}",
            "source_system": "stub",
            "source_id": str(record["id"]),
            "canonical_url": f"https://example.com/records/{record['id']}",
            "title": record.get("title"),
            "object_number": f"STUB-{record['id']}",
            "modified_at": record.get("modified_date"),
            "thumbnail_url": record.get("image_url"),
            "payload": record,  # Store full raw record
        }


class StubTargetConnector(BaseTargetConnector):
    """
    Stub target connector for testing.
    
    Logs published data without sending to real systems.
    """

    def validate_config(self) -> None:
        """Validate that output_path is present."""
        if "output_path" not in self.config:
            raise ValueError("output_path is required in config")

    def publish_records(self, entities: list[dict[str, Any]]) -> None:
        """
        Log published records.
        
        Example:
            >>> connector = StubTargetConnector({"output_path": "/tmp/out"}, "tenant-123")
            >>> connector.publish_records([{"entity_key": "stub:1", "title": "Test"}])
        """
        output = self.config.get("output_path", "/tmp/records.json")
        logger.info("[StubTargetConnector] Would publish %d records to %s", len(entities), output)
        for entity in entities[:3]:  # Log first 3
            logger.info("  - %s: %s", entity.get('entity_key'), entity.get('title'))

    def publish_change_log(self, changes: list[dict[str, Any]]) -> None:
        """
        Log published changes.
        
        Example:
            >>> connector = StubTargetConnector({"output_path": "/tmp/out"}, "tenant-123")
            >>> connector.publish_change_log([{"change_type": "updated", "entity_key": "stub:1"}])
        """
        output = self.config.get("output_path", "/tmp/changes.json")
        logger.info("[StubTargetConnector] Would publish %d changes to %s", len(changes), output)
        for change in changes[:3]:  # Log first 3
            logger.info(
                "  - %s: %s (fields: %s)",
                change.get('change_type'), change.get('entity_key'), change.get('changed_fields'),
            )
    
    def get_target_url(self) -> str | None:
        """Return a fake URL for testing."""
        return "https://example.com/stub-output"
