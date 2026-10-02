"""Complete the field_access_policies minimum_role -> minimum_permission rename.

Revision ID: 4b1c9d2ea77f
Revises: 9389aa1e97c3
Create Date: 2026-09-08 10:30:00.000000

field_access_service reads `policy.minimum_permission`, but the column was
never on the model, so `Base.metadata.create_all` (the consolidated schema,
33d81a377dc7) kept emitting the old `minimum_role`. Reading the missing
attribute raised AttributeError inside can_view_field, which surfaced as a
500 on GET /collections/objects/{id} for any org with seeded policies —
i.e. every install.

The rename itself lived only in the pre-consolidation chain (20260403_0800
and 20260403_1200), which the consolidation dropped and which is no longer
in this repo. This puts it back on the chain and fixes the model alongside.

Written to be correct from either starting point: a database created before
this change has minimum_role, and a fresh one created from the corrected
model already has minimum_permission and no minimum_role.

The role -> permission mapping is the one from 20260403_0800.
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "4b1c9d2ea77f"
down_revision: Union[str, Sequence[str], None] = "9389aa1e97c3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# MADRONA_MIGRATION_STRATEGY: owner
# field_access_policies is a global (organization_id-less) definition table,
# so the UPDATE below is not org-scoped and sets no organization_id.

ROLE_TO_PERMISSION = {
    "admin": "org.manage_settings",
    "registrar": "entries.edit",
    "curator": "collections.edit",
    "publisher": "collections.create",
    "viewer": "collections.view",
}


def _has_column(conn, name: str) -> bool:
    return conn.execute(
        text(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name = 'field_access_policies' AND column_name = :name"
        ),
        {"name": name},
    ).scalar() is not None


def upgrade() -> None:
    conn = op.get_bind()

    if not _has_column(conn, "minimum_permission"):
        op.add_column(
            "field_access_policies",
            sa.Column("minimum_permission", sa.String(100), nullable=True),
        )

    if _has_column(conn, "minimum_role"):
        case_arms = " ".join(
            f"WHEN minimum_role = '{role}' THEN '{perm}'"
            for role, perm in ROLE_TO_PERMISSION.items()
        )
        conn.execute(
            text(
                f"UPDATE field_access_policies SET minimum_permission = CASE {case_arms} END "
                "WHERE minimum_role IS NOT NULL AND minimum_permission IS NULL"
            )
        )
        # The CHECK constraint enumerates the old role names and would block
        # nothing now, but it blocks dropping the column cleanly on some
        # Postgres versions if it is still attached.
        conn.execute(
            text(
                "ALTER TABLE field_access_policies "
                "DROP CONSTRAINT IF EXISTS check_minimum_role"
            )
        )
        op.drop_column("field_access_policies", "minimum_role")


def downgrade() -> None:
    conn = op.get_bind()

    if not _has_column(conn, "minimum_role"):
        op.add_column(
            "field_access_policies",
            sa.Column("minimum_role", sa.String(100), nullable=True),
        )

    case_arms = " ".join(
        f"WHEN minimum_permission = '{perm}' THEN '{role}'"
        for role, perm in ROLE_TO_PERMISSION.items()
    )
    conn.execute(
        text(
            f"UPDATE field_access_policies SET minimum_role = CASE {case_arms} END "
            "WHERE minimum_permission IS NOT NULL"
        )
    )

    if _has_column(conn, "minimum_permission"):
        op.drop_column("field_access_policies", "minimum_permission")
