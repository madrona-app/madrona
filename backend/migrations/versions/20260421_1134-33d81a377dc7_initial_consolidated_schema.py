"""initial_consolidated_schema

Revision ID: 33d81a377dc7
Revises:
Create Date: 2026-04-21 11:34:00.000000

Consolidates 339 prior migrations into a single starting point.

The pre-consolidation chain had structural issues — CREATE migrations
for several schemas (collections, media, content, dam, exhibit, reporting,
reports) were never generated because migrations/env.py's include_object
filter only saw `public` and `flow`. The deploy workflow compensated with
a Base.metadata.create_all fallback that stamped head without running
migrations, silently skipping every data migration in the chain.

This migration drops that history and takes Base.metadata as the source
of truth. It delegates to `Base.metadata.create_all`, which:
  - emits every table SQLAlchemy knows about (all 9 schemas)
  - respects cross-schema foreign-key dependencies when ordering DDL
  - is idempotent via checkfirst=True so partial-state DBs recover

Schemas themselves (public is always present; collections/media/etc.) are
created by docker/postgres/init-db.sh on local postgres and by whatever
equivalent step the managed-DB provider uses. If a schema is missing when
this migration runs, create_all will error and point at the missing schema
by name — that's the correct failure mode for this layer.

Functions, triggers, RLS policies, and role grants are not part of this
migration; they remain in seeds (seed_rls_policies, seed_app_role_grants,
etc.) which run immediately after alembic as the owner role.

The 339 pre-consolidation migrations were never on the alembic chain and
are not in this repository; they are preserved in the project's history
archive.
"""
from typing import Sequence, Union

from alembic import op

from app.models import Base

# revision identifiers, used by Alembic.
revision: str = "33d81a377dc7"
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# MADRONA_MIGRATION_STRATEGY: owner

# Schemas every table in Base.metadata lives in — and only those. This list
# also carried dam, exhibit and reporting, none of which ever received a table;
# they are no longer created. Databases migrated before this change keep them,
# empty and harmless, and this migration is not the place to drop a schema
# someone may have put something in. docker/postgres/init-db.sh
# creates these on local postgres; RDS bootstrap creates them on managed
# DBs; CI's migration-smoke test uses a plain postgres that won't have
# them. Creating them here makes the migration self-contained regardless
# of which postgres the runner gave us.
_MADRONA_SCHEMAS = (
    "collections",
    "content",
    "flow",
    "media",
    "reports",
)


def upgrade() -> None:
    bind = op.get_bind()
    # Extensions the models assume exist (PostGIS geometry, pgvector, and
    # pg_trgm for the GIN trigram search indexes). Local and staging get these
    # from docker/postgres/init-db.sh; CI's plain postgres image does not, so
    # install here with IF NOT EXISTS. This runs create_all from the current
    # models, so every extension a model index needs must be listed here.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    for schema in _MADRONA_SCHEMAS:
        op.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind(), checkfirst=True)
    # Schemas are left in place — they may be owned by the provisioning
    # step (init-db.sh / RDS bootstrap), and a downgrade shouldn't remove
    # organization-level resources that other tooling depends on.
