"""
OpenSearch index management for Collections.

Handles index lifecycle including creation, aliasing, and zero-downtime reindexing.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from opensearchpy import OpenSearch

logger = logging.getLogger(__name__)


class CollectionsIndexManager:
    """Manages OpenSearch indices for Collections search."""

    INDEX_PREFIX = "madrona-collections"
    READ_ALIAS = "madrona-collections-read"
    WRITE_ALIAS = "madrona-collections-write"

    def __init__(self, client: OpenSearch):
        self.client = client
        self.template_path = Path(__file__).parent / "index_template.json"

    def setup(self) -> str:
        """
        Initialize index template and create initial index.

        Returns the name of the created or existing index.
        """
        self._create_template()

        # A concrete index sitting on an alias name means a write landed before
        # this ever ran (see reindex_all). Alias creation will fail with a
        # confusing 400, and the caller — the collections search endpoint —
        # swallows setup failures as a warning, so the symptom that reaches
        # anyone is an unexplained 500 from search. Say what is actually wrong.
        for alias in (self.READ_ALIAS, self.WRITE_ALIAS):
            if self.client.indices.exists(index=alias) and not self._alias_exists(alias):
                raise RuntimeError(
                    f"'{alias}' exists as a concrete index, not an alias. A document "
                    f"was written before the index was provisioned, and OpenSearch "
                    f"auto-created an index under the alias name. Collections search "
                    f"cannot work until it is removed: reindex its contents if they "
                    f"matter, DELETE the '{alias}' index, then reindex the organization."
                )

        if not self._alias_exists(self.READ_ALIAS):
            index_name = self._create_index()
            self._create_aliases(index_name)
            logger.info(f"Created initial Collections index: {index_name}")
            return index_name
        else:
            indices = list(self.client.indices.get_alias(name=self.READ_ALIAS).keys())
            logger.info(f"Collections index already exists: {indices[0]}")
            return indices[0]

    def _create_template(self) -> None:
        """Create or update the index template."""
        with open(self.template_path) as f:
            template = json.load(f)

        # The knn_vector dimension MUST match the embedding provider's output
        # (Voyage 3.5: 1024; legacy local nomic: 768). Settings are the source
        # of truth — a drifted template silently strands every embedding write
        # with a mapper_parsing_exception, degrading search to keyword-AND.
        from app.config import get_settings
        dims = get_settings().semantic_search_dimensions
        template["template"]["mappings"]["properties"]["semantic_embedding"]["dimension"] = dims

        self.client.indices.put_index_template(
            name="madrona-collections-template",
            body=template
        )
        logger.info("Index template created/updated: madrona-collections-template")

    def _create_index(self) -> str:
        """Create a new timestamped index."""
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
        index_name = f"{self.INDEX_PREFIX}-{timestamp}"

        self.client.indices.create(index=index_name)
        logger.info(f"Created Collections index: {index_name}")
        return index_name

    def _create_aliases(self, index_name: str) -> None:
        """Create read and write aliases pointing to the index."""
        self.client.indices.update_aliases(body={
            "actions": [
                {"add": {"index": index_name, "alias": self.READ_ALIAS}},
                {"add": {"index": index_name, "alias": self.WRITE_ALIAS}}
            ]
        })
        logger.info(f"Created Collections aliases pointing to {index_name}")

    def _alias_exists(self, alias: str) -> bool:
        """Check if an alias exists."""
        return self.client.indices.exists_alias(name=alias)

    def index_document(self, doc: dict) -> None:
        """Index a single document."""
        self.client.index(
            index=self.WRITE_ALIAS,
            id=doc["object_id"],
            body=doc,
            routing=doc["organization_id"],
        )

    def bulk_index(self, docs: list[dict]) -> dict:
        """Bulk index multiple documents."""
        if not docs:
            return {"indexed": 0, "errors": []}

        actions = []
        for doc in docs:
            actions.append({
                "index": {
                    "_index": self.WRITE_ALIAS,
                    "_id": doc["object_id"],
                    "routing": doc["organization_id"],
                }
            })
            actions.append(doc)

        response = self.client.bulk(body=actions, refresh=True)

        errors = []
        if response.get("errors"):
            for item in response.get("items", []):
                if "error" in item.get("index", {}):
                    errors.append(item["index"]["error"])

        return {
            "indexed": len(docs) - len(errors),
            "errors": errors,
        }

    def delete_document(self, object_id: str, organization_id: str) -> None:
        """Delete a document from the index."""
        try:
            self.client.delete(
                index=self.WRITE_ALIAS,
                id=object_id,
                routing=organization_id,
            )
        except Exception as e:
            # Document may not exist
            logger.debug(f"Delete failed for {object_id}: {e}")

    def search(self, query: dict, organization_id: str) -> dict:
        """Execute a search query."""
        return self.client.search(
            index=self.READ_ALIAS,
            body=query,
            routing=organization_id,
        )

    def update_mapping_for_semantic_search(self) -> None:
        """
        Add the knn_vector field to an existing index.

        Closes the index, enables knn setting, adds the field mapping,
        then reopens. This avoids requiring a full reindex.
        """
        from app.config import get_settings
        settings = get_settings()

        # Find the concrete index behind the write alias
        indices = list(self.client.indices.get_alias(name=self.WRITE_ALIAS).keys())
        if not indices:
            raise RuntimeError("No index found behind write alias")
        index_name = indices[0]

        # Check if mapping already has the field
        mapping = self.client.indices.get_mapping(index=index_name)
        properties = mapping[index_name]["mappings"].get("properties", {})
        if "semantic_embedding" in properties:
            logger.info("semantic_embedding field already exists in %s", index_name)
            return

        logger.info("Adding semantic_embedding field to %s", index_name)

        # Close index to change static settings
        self.client.indices.close(index=index_name)

        try:
            # Enable KNN
            self.client.indices.put_settings(
                index=index_name,
                body={"index.knn": True},
            )

            # Add the vector field mapping
            self.client.indices.put_mapping(
                index=index_name,
                body={
                    "properties": {
                        "semantic_embedding": {
                            "type": "knn_vector",
                            "dimension": settings.semantic_search_dimensions,
                            "method": {
                                "name": "hnsw",
                                "space_type": "cosinesimil",
                                "engine": "lucene",
                                "parameters": {
                                    "ef_construction": 256,
                                    "m": 16,
                                },
                            },
                        }
                    }
                },
            )
        finally:
            # Always reopen the index
            self.client.indices.open(index=index_name)

        logger.info("semantic_embedding field added to %s", index_name)

        # Update the template for future indices
        self._create_template()

    def update_document_partial(self, object_id: str, organization_id: str, fields: dict) -> None:
        """Partial update of a document (e.g. adding an embedding after indexing)."""
        self.client.update(
            index=self.WRITE_ALIAS,
            id=object_id,
            body={"doc": fields},
            routing=organization_id,
        )

    def reindex_all(self, session, organization_id: str) -> dict:
        """
        Reindex all collection objects for an organization.

        Args:
            session: SQLAlchemy session
            organization_id: Organization to reindex

        Returns:
            Stats about the reindex operation
        """
        from app.models import CollectionObject
        from .transformer import CollectionObjectTransformer

        # Bootstrap before writing a single document. bulk_index() targets the
        # WRITE alias, and OpenSearch's action.auto_create_index is on by
        # default — so writing before the alias exists silently creates a
        # CONCRETE INDEX named "madrona-collections-write". That is not a
        # recoverable state: from then on setup() cannot create the alias
        # ("Invalid alias name [madrona-collections-write], an index exists
        # with the same name as the alias"), the read alias is never created
        # either, and every search 500s on index_not_found_exception. A fresh
        # deployment that seeds before it provisions poisons its own search
        # namespace on the first write.
        self.setup()

        transformer = CollectionObjectTransformer()
        batch_size = 500
        indexed = 0
        errors = []

        # Query all objects for this org with relationships needed for indexing
        from uuid import UUID as PyUUID
        from sqlalchemy.orm import joinedload, selectinload
        from app.models import ConstituentXref
        org_uuid = PyUUID(organization_id) if isinstance(organization_id, str) else organization_id

        # Load constituent xrefs and nested constituent for people count and creator data
        query = session.query(CollectionObject).options(
            joinedload(CollectionObject.constituent_xrefs)
            .joinedload(ConstituentXref.constituent),
            selectinload(CollectionObject.condition_reports),
        ).filter(
            CollectionObject.organization_id == org_uuid
        )

        total = query.count()
        logger.info(f"Reindexing {total} objects for org {organization_id}")

        # Process in batches
        offset = 0
        while True:
            batch = query.offset(offset).limit(batch_size).all()
            if not batch:
                break

            docs = [transformer.transform(obj) for obj in batch]
            result = self.bulk_index(docs)

            indexed += result["indexed"]
            errors.extend(result["errors"])

            offset += batch_size
            logger.info(f"Indexed {indexed}/{total} collection objects")

        return {
            "total": total,
            "indexed": indexed,
            "errors": errors,
        }
