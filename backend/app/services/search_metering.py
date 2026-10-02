"""
OpenSearch storage metering per organization.

Estimates per-org search index storage by counting org docs vs total docs
and apportioning the index size proportionally.
"""

import logging

from opensearchpy import OpenSearch

from app.search.client import get_opensearch_client, is_opensearch_available

logger = logging.getLogger(__name__)

# OpenSearch index read aliases used by Madrona
OPENSEARCH_INDICES = [
    "madrona-collections-read",
    "madrona-entities-read",
    "madrona-media-read",
]


def measure_org_opensearch_bytes(organization_id: str) -> int:
    """
    Estimate OpenSearch storage used by a single organization.

    For each index:
    1. Count org docs via term query on organization_id
    2. Get total doc count and index size from indices.stats()
    3. Proportional: org_bytes = (org_docs / total_docs) * index_size_bytes
    """
    if not is_opensearch_available():
        return 0

    client = get_opensearch_client()
    if client is None:
        return 0

    total_org_bytes = 0

    for index in OPENSEARCH_INDICES:
        try:
            # Count docs for this org
            org_count = client.count(
                index=index,
                body={"query": {"term": {"organization_id": organization_id}}},
            )["count"]

            if org_count == 0:
                continue

            # Get index stats
            stats = client.indices.stats(index=index)
            index_stats = stats.get("_all", {}).get("primaries", {})
            total_docs = index_stats.get("docs", {}).get("count", 0)
            total_size_bytes = index_stats.get("store", {}).get("size_in_bytes", 0)

            if total_docs == 0 or total_size_bytes == 0:
                continue

            org_bytes = int((org_count / total_docs) * total_size_bytes)
            total_org_bytes += org_bytes

        except Exception:
            logger.warning(
                "search_metering_index_error",
                extra={"index": index, "organization_id": organization_id},
                exc_info=True,
            )
            continue

    return total_org_bytes


def measure_all_orgs_opensearch_bytes(org_ids: list[str]) -> dict[str, int]:
    """
    Batch-measure OpenSearch storage for all orgs efficiently.

    For each index, fetches total stats once then counts per-org docs.
    """
    results = {org_id: 0 for org_id in org_ids}

    if not is_opensearch_available():
        return results

    client = get_opensearch_client()
    if client is None:
        return results

    for index in OPENSEARCH_INDICES:
        try:
            # Get index-level stats (once per index)
            stats = client.indices.stats(index=index)
            index_stats = stats.get("_all", {}).get("primaries", {})
            total_docs = index_stats.get("docs", {}).get("count", 0)
            total_size_bytes = index_stats.get("store", {}).get("size_in_bytes", 0)

            if total_docs == 0 or total_size_bytes == 0:
                continue

            # Count docs per org
            for org_id in org_ids:
                try:
                    org_count = client.count(
                        index=index,
                        body={"query": {"term": {"organization_id": org_id}}},
                    )["count"]

                    if org_count > 0:
                        results[org_id] += int(
                            (org_count / total_docs) * total_size_bytes
                        )
                except Exception:
                    logger.warning(
                        "search_metering_org_error",
                        extra={"index": index, "organization_id": org_id},
                        exc_info=True,
                    )
                    continue

        except Exception:
            logger.warning(
                "search_metering_index_error",
                extra={"index": index},
                exc_info=True,
            )
            continue

    return results
