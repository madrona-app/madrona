"""acquisition source_type + legal_status CHECK constraints

Revision ID: bdf1c9cfaf27
Revises: fdf056024552
Create Date: 2026-06-15 12:22:46.104097

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bdf1c9cfaf27'
down_revision: Union[str, Sequence[str], None] = 'fdf056024552'
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

_SOURCE_TYPES = ("individual", "institution", "estate", "dealer", "other")
_LEGAL_STATUSES = ("clear", "pending_provenance", "disputed", "restricted")


def _in_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{v}'" for v in values)


def upgrade() -> None:
    """Add CHECK constraints to acquisition source_type + legal_status.

    Both columns previously had no CHECK, so live edits could persist arbitrary
    strings (e.g. 'Auction House') that the UI then rejected with "Invalid
    input". Normalize any existing out-of-set value to NULL first (both columns
    are nullable) so the constraint can be added without failing on legacy rows.
    """
    op.execute(
        f"""
        UPDATE collections.acquisitions
        SET source_type = NULL
        WHERE source_type IS NOT NULL
          AND source_type NOT IN ({_in_list(_SOURCE_TYPES)})
        """
    )
    op.execute(
        f"""
        UPDATE collections.acquisitions
        SET legal_status = NULL
        WHERE legal_status IS NOT NULL
          AND legal_status NOT IN ({_in_list(_LEGAL_STATUSES)})
        """
    )

    # Idempotent ADD: a fresh DB already has these constraints because the
    # consolidated-schema migration (33d81a377dc7) builds tables via
    # Base.metadata.create_all from the live models, which now declare them.
    # Drop-if-exists first so this migration is correct on both a fresh DB
    # (drops what create_all made, re-adds identically) and an existing one
    # (no-op drop, then adds).
    op.execute(
        "ALTER TABLE collections.acquisitions "
        "DROP CONSTRAINT IF EXISTS check_acquisition_source_type"
    )
    op.create_check_constraint(
        "check_acquisition_source_type",
        "acquisitions",
        f"source_type IS NULL OR source_type IN ({_in_list(_SOURCE_TYPES)})",
        schema="collections",
    )
    op.execute(
        "ALTER TABLE collections.acquisitions "
        "DROP CONSTRAINT IF EXISTS check_acquisition_legal_status"
    )
    op.create_check_constraint(
        "check_acquisition_legal_status",
        "acquisitions",
        f"legal_status IS NULL OR legal_status IN ({_in_list(_LEGAL_STATUSES)})",
        schema="collections",
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint(
        "check_acquisition_legal_status", "acquisitions", schema="collections", type_="check"
    )
    op.drop_constraint(
        "check_acquisition_source_type", "acquisitions", schema="collections", type_="check"
    )
