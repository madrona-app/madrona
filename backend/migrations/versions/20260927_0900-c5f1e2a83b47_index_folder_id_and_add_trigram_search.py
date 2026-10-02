"""Index media.folder_id, and add trigram indexes for ILIKE search

Two separate index problems, both invisible until a catalogue gets large.

1. `ix_media_org_folder` covered (organization_id, folder) — the DEPRECATED
   virtual-folder string. The real foreign key, folder_id, had no index, and it
   is what twelve query sites filter on (two still use the legacy string, so
   that index stays).

2. Every "search the collection" path builds a `%term%` ILIKE predicate. A
   leading wildcard cannot use a btree index, so those searches were sequential
   scans over the whole organization. pg_trgm + GIN fixes that.

   The cost is slower writes and larger indexes. For a catalogue that is read
   far more often than written, that is the right trade — but it is a trade, and
   an operator who ingests in huge batches may want to drop these during a bulk
   load and recreate them after.

pg_trgm follows the precedent set by the initial migration, which creates
`vector` and `postgis` — both heavier requirements than this one — so no
deployment that works today loses the ability to migrate.

Revision ID: c5f1e2a83b47
Revises: b4e7c1a9d3f2
"""
from alembic import op

revision = "c5f1e2a83b47"
down_revision = "b4e7c1a9d3f2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    # IF NOT EXISTS, like the three below. The test harness builds its schema
    # with Base.metadata.create_all(), which already creates every index the
    # models declare — so `alembic upgrade head` then runs against a database
    # where this index exists, and op.create_index() raises DuplicateTable.
    # test_migration_smoke.py does exactly that.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_media_org_folder_id "
        "ON media.media (organization_id, folder_id)"
    )

    # CONCURRENTLY is deliberately NOT used: Alembic runs inside a transaction
    # and CREATE INDEX CONCURRENTLY cannot. An operator upgrading a large live
    # database who cannot afford the write lock should create these by hand,
    # concurrently, before running the migration — it is then a no-op here.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_objects_name_trgm "
        "ON collections.collection_objects USING gin (object_name gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_objects_number_trgm "
        "ON collections.collection_objects USING gin (object_number gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_constituents_display_name_trgm "
        "ON collections.constituents USING gin (display_name gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS collections.ix_constituents_display_name_trgm")
    op.execute("DROP INDEX IF EXISTS collections.ix_objects_number_trgm")
    op.execute("DROP INDEX IF EXISTS collections.ix_objects_name_trgm")
    op.execute("DROP INDEX IF EXISTS media.ix_media_org_folder_id")
    # pg_trgm is left installed: something else may have come to depend on it,
    # and an unused extension costs nothing.
