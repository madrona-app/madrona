"""
Media Search Index Manager.

Manages OpenSearch index lifecycle for media library.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from opensearchpy import OpenSearch
from opensearchpy.exceptions import NotFoundError

logger = logging.getLogger(__name__)

INDEX_PREFIX = "madrona-media"
READ_ALIAS = f"{INDEX_PREFIX}-read"
WRITE_ALIAS = f"{INDEX_PREFIX}-write"


class MediaIndexManager:
    """
    Manages the OpenSearch index for media search.

    Uses timestamped indexes with aliases for zero-downtime reindexing.
    """

    def __init__(self, client: OpenSearch):
        self.client = client

    def setup(self) -> str:
        """
        Initialize the media search index.

        If the aliases already exist (index was previously created),
        reuses the existing index. Otherwise creates a new timestamped
        index with proper mappings and points aliases to it.

        Returns:
            Name of the active index
        """
        # Check if index already exists via alias
        if self.client.indices.exists_alias(name=READ_ALIAS):
            indices = list(self.client.indices.get_alias(name=READ_ALIAS).keys())
            logger.info(f"Media search index already exists: {indices[0]}")
            return indices[0]

        # A concrete index sitting on an alias name blocks the alias from
        # ever being created, and OpenSearch will happily create one for
        # you: index_document() writes to index=WRITE_ALIAS, and a write to
        # a name that does not exist auto-creates it. The result is a real
        # index called "madrona-media-write", holding dynamic mappings, that
        # reads never touch — search asks for the read alias and 404s. Say
        # so plainly rather than failing later on "invalid alias name".
        for alias in (READ_ALIAS, WRITE_ALIAS):
            if self.client.indices.exists(index=alias) and not self.client.indices.exists_alias(
                name=alias
            ):
                raise RuntimeError(
                    f"'{alias}' exists as a concrete index, not an alias, so the "
                    f"media aliases cannot be created. It was almost certainly "
                    f"auto-created by an indexing write that ran before setup(). "
                    f"Delete it (its contents are rebuildable from the database) "
                    f"and run setup again: DELETE /{alias}"
                )

        # Generate timestamped index name
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        index_name = f"{INDEX_PREFIX}-{timestamp}"

        # Load index template
        template_path = Path(__file__).parent / "index_template.json"
        with open(template_path) as f:
            template = json.load(f)

        # Create the index
        self.client.indices.create(
            index=index_name,
            body=template,
        )
        logger.info(f"Created media search index: {index_name}")

        # Update aliases
        self._update_aliases(index_name)

        return index_name

    def _update_aliases(self, new_index: str) -> None:
        """Update aliases to point to the new index."""
        actions = []

        # Remove existing aliases
        try:
            existing = self.client.indices.get_alias(name=READ_ALIAS)
            for old_index in existing.keys():
                if old_index != new_index:
                    actions.append({"remove": {"index": old_index, "alias": READ_ALIAS}})
                    actions.append({"remove": {"index": old_index, "alias": WRITE_ALIAS}})
        except Exception as e:
            # Aliases don't exist yet, which is fine for new indexes
            logger.debug(f"No existing aliases found for {READ_ALIAS}: {e}")

        # Add new aliases
        actions.append({"add": {"index": new_index, "alias": READ_ALIAS}})
        actions.append({"add": {"index": new_index, "alias": WRITE_ALIAS}})

        if actions:
            self.client.indices.update_aliases(body={"actions": actions})
            logger.info(f"Updated media search aliases to point to {new_index}")

    def index_document(
        self,
        doc: dict[str, Any],
        media_id: str,
    ) -> None:
        """
        Index a single media document.

        Args:
            doc: Document to index
            media_id: Media ID (used as document ID)
        """
        self.client.index(
            index=WRITE_ALIAS,
            id=media_id,
            body=doc,
            refresh="false",  # Don't wait for refresh
        )

    def bulk_index(
        self,
        documents: list[tuple[str, dict[str, Any]]],
    ) -> dict[str, int]:
        """
        Bulk index multiple media documents.

        Args:
            documents: List of (media_id, document) tuples

        Returns:
            Dict with indexed and failed counts
        """
        if not documents:
            return {"indexed": 0, "failed": 0}

        actions = []
        for media_id, doc in documents:
            actions.append({"index": {"_index": WRITE_ALIAS, "_id": media_id}})
            actions.append(doc)

        response = self.client.bulk(body=actions, refresh="false")

        indexed = 0
        failed = 0
        for item in response.get("items", []):
            if item.get("index", {}).get("error"):
                failed += 1
                logger.error(f"Failed to index media: {item['index']['error']}")
            else:
                indexed += 1

        return {"indexed": indexed, "failed": failed}

    def delete_document(
        self,
        media_id: str,
        organization_id: str,
    ) -> bool:
        """
        Delete a media document from the index.

        Args:
            media_id: Media ID
            organization_id: Organization ID (for verification)

        Returns:
            True if deleted
        """
        try:
            self.client.delete(
                index=WRITE_ALIAS,
                id=media_id,
                refresh="false",
            )
            return True
        except Exception as e:
            logger.warning(f"Failed to delete media {media_id} from index: {e}")
            return False

    def search(
        self,
        query: dict[str, Any],
        organization_id: str,
    ) -> dict[str, Any]:
        """
        Execute a search query.

        Args:
            query: OpenSearch query body
            organization_id: Organization ID (for logging)

        Returns:
            OpenSearch response
        """
        try:
            response = self.client.search(
                index=READ_ALIAS,
                body=query,
            )
            return response
        except NotFoundError:
            # The read alias is missing — the index was never set up, or a
            # reindex left it unpointed. That is NOT "this org has no
            # media", and returning empty hits here says exactly that: the
            # library looks empty, the picker offers nothing, and the only
            # evidence is a log line nobody is reading. Let it out so the
            # caller can fall back to the database.
            logger.error(
                f"Media search index '{READ_ALIAS}' does not exist "
                f"(org {organization_id}) — falling back to the database. "
                f"Run the media reindex to rebuild it."
            )
            raise
        except Exception as e:
            logger.error(f"Media search failed for org {organization_id}: {e}")
            return {"hits": {"hits": [], "total": {"value": 0}}}

    def refresh(self) -> None:
        """Force refresh the index for immediate searchability."""
        self.client.indices.refresh(index=WRITE_ALIAS)

    def get_stats(self) -> dict[str, Any]:
        """Get index statistics."""
        try:
            stats = self.client.indices.stats(index=READ_ALIAS)
            return {
                "document_count": stats["_all"]["primaries"]["docs"]["count"],
                "size_bytes": stats["_all"]["primaries"]["store"]["size_in_bytes"],
            }
        except Exception as e:
            logger.warning(f"Failed to get media index stats: {e}")
            return {}
