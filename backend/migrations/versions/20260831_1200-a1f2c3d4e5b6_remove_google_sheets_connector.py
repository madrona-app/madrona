"""remove_google_sheets_connector

Revision ID: a1f2c3d4e5b6
Revises: ce11b6e2e6ac
Create Date: 2026-08-31 12:00:00.000000

Data-only migration removing the Google Sheets target connector.

The Google Sheets integration (an early Bridge demo) is removed from the
codebase; this deletes its connector definition so orgs can't select a
target with no implementation behind it. Instances referencing the
definition are deleted first (FK is ON DELETE RESTRICT). Pipelines that
pointed at such an instance were demo-only; their destination rows are
removed with the instance.

# MADRONA_MIGRATION_STRATEGY: owner
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a1f2c3d4e5b6'
down_revision: Union[str, Sequence[str], None] = 'ce11b6e2e6ac'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KEY = 'google-sheets-target'


def upgrade() -> None:
    conn = op.get_bind()
    def_ids = [r[0] for r in conn.execute(sa.text(
        "SELECT connector_definition_id FROM flow.connector_definitions WHERE key = :k"
    ), {"k": _KEY})]
    if not def_ids:
        return
    for table, col in (
        ("flow.pipeline_destinations", "connector_instance_id"),
    ):
        conn.execute(sa.text(f"""
            DELETE FROM {table} WHERE {col} IN (
                SELECT connector_instance_id FROM flow.connector_instances
                WHERE connector_definition_id = ANY(:ids)
            )
        """), {"ids": def_ids})
    conn.execute(sa.text(
        "DELETE FROM flow.connector_instances WHERE connector_definition_id = ANY(:ids)"
    ), {"ids": def_ids})
    conn.execute(sa.text(
        "DELETE FROM flow.connector_definitions WHERE connector_definition_id = ANY(:ids)"
    ), {"ids": def_ids})


def downgrade() -> None:
    # Definition rows were seeded by seeds.google_sheets_connector_definition
    # (now deleted); nothing to restore.
    pass
