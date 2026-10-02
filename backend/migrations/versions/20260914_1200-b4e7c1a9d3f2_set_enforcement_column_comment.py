"""Set the comment on organizations.procedure_enforcement.

Revision ID: b4e7c1a9d3f2
Revises: 4b1c9d2ea77f
Create Date: 2026-09-14 12:00:00.000000

Writes the column comment so that it describes what the column holds. Types,
nullability and default are untouched — jsonb, nullable, default '{}' — so
there is no data transformation and no backfill.

This revision used to rename a pre-release column to `procedure_enforcement`,
and its downgrade renamed it back. Neither could do anything useful for a
database built from this repository: the consolidated baseline (33d81a377dc7)
creates the column under its current name, so the rename never matched, and
the downgrade would have left a column under a name no earlier revision here
expects. Both branches were removed. The revision id stays, because
c5f1e2a83b47 revises it and existing databases record it in their history.
"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


def _sql_literal(value: str) -> str:
    """COMMENT ON does not accept bind parameters in PostgreSQL.

    These are module constants, not user input, but the escape is here so
    that stays true if someone edits them.
    """
    escaped = value.replace("'", "''")
    return f"'{escaped}'"

# revision identifiers, used by Alembic.
revision: str = "b4e7c1a9d3f2"
down_revision: Union[str, Sequence[str], None] = "4b1c9d2ea77f"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# MADRONA_MIGRATION_STRATEGY: owner
# organizations is the tenancy root; this is DDL touching no rows, so there is
# nothing to scope by organization_id.

_COMMENT = (
    "Per-procedure enforcement toggles. "
    "Key = procedure_type, value = boolean."
)


def _has_column(conn, name: str) -> bool:
    return conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = 'organizations' "
            "AND column_name = :name"
        ),
        {"name": name},
    ).scalar() is not None


def upgrade() -> None:
    conn = op.get_bind()
    if _has_column(conn, "procedure_enforcement"):
        conn.execute(
            text(
                "COMMENT ON COLUMN public.organizations.procedure_enforcement "
                f"IS {_sql_literal(_COMMENT)}"
            )
        )


def downgrade() -> None:
    # The comment is accurate at every revision, so there is nothing to undo.
    pass
