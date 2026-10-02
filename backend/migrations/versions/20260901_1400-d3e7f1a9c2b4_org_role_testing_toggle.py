"""org_role_testing_toggle

Revision ID: d3e7f1a9c2b4
Revises: c8d5e2f4b3a1
Create Date: 2026-09-01 14:00:00.000000

Adds organizations.role_testing_enabled.

Role testing ("Test Role") lets a platform admin view the app as another
role via the X-Role-Override header, which swaps the permission set for
the session. Useful for verifying role configuration; also a
permission-swapping affordance some organizations will not want available
in production. This makes it an org setting.

Defaults true so existing behavior is unchanged on upgrade.

# MADRONA_MIGRATION_STRATEGY: owner
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd3e7f1a9c2b4'
down_revision: Union[str, Sequence[str], None] = 'c8d5e2f4b3a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Guard against the column already existing. The initial consolidated
    # migration (33d81a377dc7) builds the schema with
    # `Base.metadata.create_all`, so on a fresh database every column present
    # in today's models — including this one — exists before this migration
    # runs. Without the guard, `alembic upgrade head` fails on any new install
    # with DuplicateColumn, while incrementally-migrated databases succeed.
    bind = op.get_bind()
    if sa.inspect(bind).has_table("organizations"):
        columns = {c["name"] for c in sa.inspect(bind).get_columns("organizations")}
        if "role_testing_enabled" in columns:
            return

    op.add_column(
        "organizations",
        sa.Column(
            "role_testing_enabled",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("true"),
        ),
    )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in sa.inspect(bind).get_columns("organizations")}
    if "role_testing_enabled" in columns:
        op.drop_column("organizations", "role_testing_enabled")
