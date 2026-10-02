#!/usr/bin/env python
"""
OpenSearch administrative commands.

Usage:
    python scripts/search_admin.py setup          # Initial setup (create index, template)
    python scripts/search_admin.py reindex        # Zero-downtime reindex
    python scripts/search_admin.py backfill       # Backfill all entities to search index via Celery
    python scripts/search_admin.py stats          # Show index statistics
    python scripts/search_admin.py health         # Show cluster health
"""

import os
import sys

# Add the backend directory to the path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from app.config import get_settings


def setup():
    """Initialize OpenSearch index and template."""
    from app.search.client import get_opensearch_client
    from app.search.index_manager import IndexManager

    client = get_opensearch_client()
    if not client:
        print("Error: OpenSearch client not available")
        sys.exit(1)

    manager = IndexManager(client)
    index_name = manager.setup()
    print(f"OpenSearch index setup complete: {index_name}")


def reindex():
    """Perform zero-downtime reindex."""
    from app.search.client import get_opensearch_client
    from app.search.index_manager import IndexManager

    client = get_opensearch_client()
    if not client:
        print("Error: OpenSearch client not available")
        sys.exit(1)

    manager = IndexManager(client)

    print("Starting reindex operation...")
    new_index = manager.reindex(wait_for_completion=True)
    print(f"Reindex complete. New index: {new_index}")


def backfill(batch_size: int = 100, session=None):
    """Backfill all entities to search index via Celery tasks."""
    from sqlalchemy import func

    from app.models import EntityCurrent
    from app.tasks.search import index_entity_task

    # Count total entities
    total = session.query(func.count()).select_from(EntityCurrent).filter(
        EntityCurrent.is_deleted == False
    ).scalar()
    print(f"Backfilling {total} entities to search index via Celery...")

    # Process in batches
    offset = 0
    queued = 0

    while offset < total:
        entities = (
            session.query(EntityCurrent)
            .filter(EntityCurrent.is_deleted == False)
            .order_by(EntityCurrent.entity_key)
            .offset(offset)
            .limit(batch_size)
            .all()
        )

        for entity in entities:
            payload = {
                'organization_id': str(entity.organization_id),
                'entity_key': entity.entity_key,
                'entity_type': entity.entity_type,
                'source_system': entity.source_system,
                'source_id': entity.source_id,
                'dataset_id': str(entity.dataset_id) if entity.dataset_id else None,
                'payload': entity.payload,
                'last_seen_at': entity.last_seen_at.isoformat() if entity.last_seen_at else None,
                'updated_at': entity.updated_at.isoformat() if entity.updated_at else None,
            }
            index_entity_task.delay(
                entity_key=entity.entity_key,
                organization_id=str(entity.organization_id),
                payload=payload,
            )
            queued += 1

        offset += batch_size
        print(f"  Queued {min(queued, total)}/{total} entities")

    print(f"Backfill complete. {queued} tasks queued to Celery.")


def stats():
    """Show index statistics."""
    from app.search.client import get_opensearch_client

    client = get_opensearch_client()
    if not client:
        print("Error: OpenSearch client not available")
        sys.exit(1)

    # Index stats
    try:
        stats = client.indices.stats(index='madrona-entities-read')
        index_stats = list(stats['indices'].values())[0]

        print("Index Statistics:")
        print(f"  Documents: {index_stats['primaries']['docs']['count']:,}")
        print(f"  Size: {index_stats['primaries']['store']['size_in_bytes'] / 1024 / 1024:.1f} MB")
        print(f"  Segments: {index_stats['primaries']['segments']['count']}")
    except Exception as e:
        print(f"  Error getting index stats: {e}")


def health():
    """Show cluster health."""
    from app.search.client import get_opensearch_client

    client = get_opensearch_client()
    if not client:
        print("Error: OpenSearch client not available")
        sys.exit(1)

    health = client.cluster.health()

    # ANSI color codes
    colors = {
        'green': '\033[92m',
        'yellow': '\033[93m',
        'red': '\033[91m'
    }
    reset = '\033[0m'

    status = health['status']
    status_colored = f"{colors.get(status, '')}{status}{reset}"

    print(f"Cluster: {health['cluster_name']}")
    print(f"Status: {status_colored}")
    print(f"Nodes: {health['number_of_nodes']}")
    print(f"Shards: {health['active_shards']} active, {health['unassigned_shards']} unassigned")


def main():
    """Main entry point."""
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)

    command = sys.argv[1]

    if command in ('setup', 'reindex', 'stats', 'health'):
        # These commands don't need a DB session
        if command == 'setup':
            setup()
        elif command == 'reindex':
            reindex()
        elif command == 'stats':
            stats()
        elif command == 'health':
            health()
    elif command == 'backfill':
        from app.database import get_session
        batch_size = int(sys.argv[2]) if len(sys.argv) > 2 else 100
        with get_session() as session:
            backfill(batch_size, session=session)
    else:
        print(f"Unknown command: {command}")
        print(__doc__)
        sys.exit(1)


if __name__ == '__main__':
    main()
