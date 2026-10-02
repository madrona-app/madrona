"""Link a constituent to a user account (Constituent.user_id).

Users (login accounts) and constituents (people/orgs in the collection sense)
were two disconnected tables — a staff member existed as a user but had no
constituent record, so people-references (examiner, conservator, …) couldn't
cleanly point at "this staff member". This adds the bridge: a nullable
constituents.user_id FK → users, unique per org (one staff constituent per user
per org), so a user can be represented as a constituent and people-references
resolve consistently.

Revision ID: constituent_user_link
Revises: agent_plan_step_tool_required
Create Date: 2026-06-09 10:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "constituent_user_link"
down_revision: Union[str, Sequence[str], None] = "agent_plan_step_tool_required"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent: the consolidated baseline (33d81a377dc7) delegates to
    # Base.metadata.create_all, which on a fresh `alembic upgrade head` already
    # materializes user_id + its FK/indexes from the current Constituent model.
    # Guard every op so a clean build doesn't collide; incremental DBs (where
    # create_all predated this column) still have it added here.
    op.execute(
        "ALTER TABLE collections.constituents ADD COLUMN IF NOT EXISTS user_id uuid"
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'constituents_user_id_fkey'
                  AND conrelid = 'collections.constituents'::regclass
            ) THEN
                ALTER TABLE collections.constituents
                    ADD CONSTRAINT constituents_user_id_fkey
                    FOREIGN KEY (user_id) REFERENCES public.users (user_id)
                    ON DELETE SET NULL;
            END IF;
        END $$;
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_constituents_user_id "
        "ON collections.constituents (user_id)"
    )
    # One staff constituent per user per org.
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_constituents_org_user "
        "ON collections.constituents (organization_id, user_id) "
        "WHERE user_id IS NOT NULL"
    )


def downgrade() -> None:
    op.drop_index("uq_constituents_org_user", table_name="constituents", schema="collections")
    op.drop_index("ix_constituents_user_id", table_name="constituents", schema="collections")
    op.drop_constraint("constituents_user_id_fkey", "constituents", schema="collections", type_="foreignkey")
    op.drop_column("constituents", "user_id", schema="collections")
