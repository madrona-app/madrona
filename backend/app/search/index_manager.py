"""
OpenSearch index management for Madrona.

Handles index lifecycle including creation, aliasing, and zero-downtime reindexing.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from opensearchpy import OpenSearch

logger = logging.getLogger(__name__)


class IndexManager:
    """Manages OpenSearch indices for Madrona entity search."""

    INDEX_PREFIX = "madrona-entities"
    READ_ALIAS = "madrona-entities-read"
    WRITE_ALIAS = "madrona-entities-write"

    def __init__(self, client: OpenSearch):
        self.client = client
        self.template_path = Path(__file__).parent / "index_template.json"

    def setup(self) -> str:
        """
        Initialize index template and create initial index.

        Returns the name of the created or existing index.
        """
        self._create_template()

        if not self._alias_exists(self.READ_ALIAS):
            index_name = self._create_index()
            self._create_aliases(index_name)
            logger.info(f"Created initial index: {index_name}")
            return index_name
        else:
            # Return existing index name
            indices = list(self.client.indices.get_alias(name=self.READ_ALIAS).keys())
            logger.info(f"Index already exists: {indices[0]}")
            return indices[0]

    def _create_template(self) -> None:
        """Create or update the index template."""
        with open(self.template_path) as f:
            template = json.load(f)

        self.client.indices.put_index_template(
            name="madrona-entities-template",
            body=template
        )
        logger.info("Index template created/updated: madrona-entities-template")

    def _create_index(self) -> str:
        """Create a new timestamped index."""
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        index_name = f"{self.INDEX_PREFIX}-{timestamp}"

        self.client.indices.create(index=index_name)
        logger.info(f"Created index: {index_name}")
        return index_name

    def _create_aliases(self, index_name: str) -> None:
        """Create read and write aliases pointing to the index."""
        self.client.indices.update_aliases(body={
            "actions": [
                {"add": {"index": index_name, "alias": self.READ_ALIAS}},
                {"add": {"index": index_name, "alias": self.WRITE_ALIAS}}
            ]
        })
        logger.info(f"Created aliases pointing to {index_name}")

    def _alias_exists(self, alias: str) -> bool:
        """Check if an alias exists."""
        return self.client.indices.exists_alias(name=alias)

    def reindex(self, wait_for_completion: bool = False) -> str:
        """
        Zero-downtime reindex operation.

        Process:
        1. Create new index
        2. Point write alias to new index
        3. Reindex from old to new
        4. Point read alias to new index
        5. Delete old index

        Args:
            wait_for_completion: If True, wait for reindex to finish

        Returns:
            Name of the new index
        """
        # Get current index
        old_indices = list(
            self.client.indices.get_alias(name=self.READ_ALIAS).keys()
        )
        if not old_indices:
            raise ValueError("No existing index found to reindex from")

        old_index = old_indices[0]
        logger.info(f"Reindexing from {old_index}")

        # Create new index
        new_index = self._create_index()

        # Point write alias to new index (new writes go to new index)
        self.client.indices.update_aliases(body={
            "actions": [
                {"remove": {"index": old_index, "alias": self.WRITE_ALIAS}},
                {"add": {"index": new_index, "alias": self.WRITE_ALIAS}}
            ]
        })
        logger.info(f"Write alias now points to {new_index}")

        # Reindex data
        logger.info(f"Starting reindex from {old_index} to {new_index}")
        self.client.reindex(
            body={
                "source": {"index": old_index},
                "dest": {"index": new_index}
            },
            wait_for_completion=wait_for_completion
        )

        # Swap read alias
        self.client.indices.update_aliases(body={
            "actions": [
                {"remove": {"index": old_index, "alias": self.READ_ALIAS}},
                {"add": {"index": new_index, "alias": self.READ_ALIAS}}
            ]
        })
        logger.info(f"Read alias now points to {new_index}")

        # Delete old index
        self.client.indices.delete(index=old_index)
        logger.info(f"Deleted old index: {old_index}")

        return new_index

    def get_stats(self) -> dict:
        """Get index statistics."""
        try:
            stats = self.client.indices.stats(index=self.READ_ALIAS)
            return stats
        except Exception as e:
            logger.error(f"Failed to get index stats: {e}")
            return {}

    def refresh(self) -> None:
        """Force refresh the index (make recent changes searchable)."""
        self.client.indices.refresh(index=self.WRITE_ALIAS)

    def get_document_count(self) -> int:
        """Get total document count in the index."""
        try:
            stats = self.client.indices.stats(index=self.READ_ALIAS)
            indices = stats.get("indices", {})
            if indices:
                index_stats = list(indices.values())[0]
                return index_stats.get("primaries", {}).get("docs", {}).get("count", 0)
            return 0
        except Exception as e:
            logger.debug(f"Failed to get document count for {self.READ_ALIAS}: {e}")
            return 0

    def delete_by_organization(self, organization_id: str) -> int:
        """
        Delete all documents for an organization.

        Returns the number of deleted documents.
        """
        result = self.client.delete_by_query(
            index=self.WRITE_ALIAS,
            body={
                "query": {
                    "term": {"organization_id": organization_id}
                }
            },
            routing=organization_id
        )
        deleted = result.get("deleted", 0)
        logger.info(f"Deleted {deleted} documents for organization {organization_id}")
        return deleted
