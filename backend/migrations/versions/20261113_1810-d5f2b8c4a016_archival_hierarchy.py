"""Archival hierarchy: parent/child object records and archival levels

- collection_objects.parent_object_id (self reference, ON DELETE RESTRICT)
- collection_objects.sibling_order
- catalog_level gains subcollection, subseries, file, box, folder (NFB's
  levels: collection, series, box, folder, item).

Existing part_of / component_of relationships are left as relationships.

Revision ID: d5f2b8c4a016
Revises: d4e1a7b3c905
"""
from alembic import op

revision = "d5f2b8c4a016"
down_revision = "d4e1a7b3c905"
branch_labels = None
depends_on = None

_NEW = "('collection', 'subcollection', 'series', 'subseries', 'file', 'box', 'folder', 'item', 'group', 'component', 'volume')"
_OLD = "('item', 'group', 'collection', 'series', 'component', 'volume')"


def upgrade() -> None:
    op.execute("ALTER TABLE collections.collection_objects ADD COLUMN IF NOT EXISTS parent_object_id uuid")
    op.execute("ALTER TABLE collections.collection_objects ADD COLUMN IF NOT EXISTS sibling_order integer")
    op.execute("""
    DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'collection_objects_parent_object_id_fkey') THEN
            ALTER TABLE collections.collection_objects
                ADD CONSTRAINT collection_objects_parent_object_id_fkey FOREIGN KEY (parent_object_id)
                REFERENCES collections.collection_objects(object_id) ON DELETE RESTRICT;
        END IF;
    END $$""")
    op.execute("CREATE INDEX IF NOT EXISTS ix_objects_parent_order ON collections.collection_objects "
               "(organization_id, parent_object_id, sibling_order)")
    op.execute("ALTER TABLE collections.collection_objects DROP CONSTRAINT IF EXISTS check_catalog_level")
    op.execute(f"ALTER TABLE collections.collection_objects ADD CONSTRAINT check_catalog_level "
               f"CHECK (catalog_level IS NULL OR catalog_level IN {_NEW})")


def downgrade() -> None:
    op.execute("ALTER TABLE collections.collection_objects DROP CONSTRAINT IF EXISTS check_catalog_level")
    op.execute(f"UPDATE collections.collection_objects SET catalog_level = 'component' WHERE catalog_level NOT IN {_OLD}")
    op.execute(f"ALTER TABLE collections.collection_objects ADD CONSTRAINT check_catalog_level "
               f"CHECK (catalog_level IS NULL OR catalog_level IN {_OLD})")
    op.execute("DROP INDEX IF EXISTS collections.ix_objects_parent_order")
    op.execute("ALTER TABLE collections.collection_objects DROP CONSTRAINT IF EXISTS collection_objects_parent_object_id_fkey")
    op.execute("ALTER TABLE collections.collection_objects DROP COLUMN IF EXISTS sibling_order")
    op.execute("ALTER TABLE collections.collection_objects DROP COLUMN IF EXISTS parent_object_id")
