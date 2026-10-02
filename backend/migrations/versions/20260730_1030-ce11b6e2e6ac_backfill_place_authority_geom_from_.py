"""backfill_place_authority_geom_from_latlng

Revision ID: ce11b6e2e6ac
Revises: c6766bb3bd78
Create Date: 2026-07-30 10:30:17.485136

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ce11b6e2e6ac'
down_revision: Union[str, Sequence[str], None] = 'c6766bb3bd78'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Migration runs as the DB owner/migrator role (BYPASSRLS).
# Connection URL comes from ALEMBIC_DATABASE_URL (not DATABASE_URL).
#
# IMPORTANT - Data migrations that INSERT/UPDATE/DELETE rows in org-scoped
# tables must set organization_id explicitly on every row.  Do NOT rely on
# SET LOCAL row_security = off (legacy pattern, do not copy).
#
# If your migration touches org-scoped data, add this marker comment so the
# lint check (make lint-migrations) passes:
#   # MADRONA_MIGRATION_STRATEGY: owner
# ---------------------------------------------------------------------------


# MADRONA_MIGRATION_STRATEGY: owner
# Scope: no rows are inserted; existing rows are updated in place and
# organization_id is untouched, so no per-row org stamping is needed.


def upgrade() -> None:
    """Backfill place_authorities.geom from the decimal lat/lng columns.

    The API historically wrote only coordinates_lat/coordinates_lng; every
    map feature reads the PostGIS geom column, so those places never
    plotted. The API now keeps the two in sync on create/update; this
    catches every row written before that fix.
    """
    op.execute(
        """
        UPDATE collections.place_authorities
        SET geom = ST_SetSRID(
            ST_MakePoint(coordinates_lng::float, coordinates_lat::float), 4326
        )
        WHERE geom IS NULL
          AND coordinates_lat IS NOT NULL
          AND coordinates_lng IS NOT NULL
        """
    )


def downgrade() -> None:
    """No-op: derived data; nothing to restore."""
    pass
