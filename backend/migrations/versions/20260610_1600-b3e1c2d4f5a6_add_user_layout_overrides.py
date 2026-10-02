"""add user_layout_overrides (per-user workspace layout variants)

Per-user, saveable layout overrides for record-detail workspace surfaces. A
user keeps multiple named variants per (surface_key, object_type); at most one
may be active, enforced by a partial unique index. The `delta` JSONB stores
only the user's overrides relative to the code-defined base layout — never a
full snapshot — so newly-added (incl. newly-required) base sections surface
automatically.

Tenant isolation is enforced in the app layer (queries always filter on
organization_id + user_id). Org-isolation RLS for this table should be added to
the boot-time RLS seed as a follow-up (same pattern noted in the
organization_collection_profiles migration). Pre-existing reports/* model<->DB
drift surfaced by autogenerate is intentionally NOT included here — this
migration only creates the new table.

Revision ID: b3e1c2d4f5a6
Revises: a7d3f9c1b2e4
Create Date: 2026-06-10 16:00

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = "b3e1c2d4f5a6"
down_revision: Union[str, Sequence[str], None] = "a7d3f9c1b2e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent on a fresh `alembic upgrade head`: the consolidated baseline
    # (33d81a377dc7) delegates to Base.metadata.create_all, which already builds
    # this table (+ its indexes) from the current model. Skip if present;
    # incremental DBs (predating the model) still create it here.
    if sa.inspect(op.get_bind()).has_table("user_layout_overrides"):
        return
    op.create_table(
        "user_layout_overrides",
        sa.Column(
            "id",
            sa.UUID(),
            server_default=sa.text("gen_random_uuid()"),
            nullable=False,
        ),
        sa.Column("organization_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("surface_key", sa.String(length=64), nullable=False),
        sa.Column("object_type", sa.String(length=64), nullable=True),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column(
            "delta", postgresql.JSONB(astext_type=sa.Text()), nullable=False
        ),
        sa.Column("base_version", sa.String(length=32), nullable=True),
        sa.Column(
            "is_active",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.organization_id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"], ["users.user_id"], ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_user_layout_overrides_owner",
        "user_layout_overrides",
        ["user_id", "surface_key"],
    )
    op.create_index(
        "ix_user_layout_overrides_org",
        "user_layout_overrides",
        ["organization_id"],
    )
    # At most one active variant per (user, surface, object_type). COALESCE so a
    # NULL object_type participates as a single wildcard slot.
    op.execute(
        """
        CREATE UNIQUE INDEX uq_user_layout_active
        ON user_layout_overrides (user_id, surface_key, COALESCE(object_type, ''))
        WHERE is_active
        """
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_user_layout_active")
    op.drop_index(
        "ix_user_layout_overrides_org", table_name="user_layout_overrides"
    )
    op.drop_index(
        "ix_user_layout_overrides_owner", table_name="user_layout_overrides"
    )
    op.drop_table("user_layout_overrides")
