"""Directed approvals — assign an approval request to a specific user.

Approvals are addressed to a permission (the rule's approver_permission). This
adds an optional `assigned_to_user_id`: when set, the request is *directed* to
that person (who must still hold the permission), enabling "send this to Jane"
and an "awaiting you" inbox. Nullable, so permission-based routing stays the
default.

Revision ID: approval_assignee
Revises: agent_drafts_v1
Create Date: 2026-05-23 14:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "approval_assignee"
down_revision: Union[str, Sequence[str], None] = "agent_drafts_v1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE approval_requests "
        "ADD COLUMN IF NOT EXISTS assigned_to_user_id UUID "
        "REFERENCES users(user_id) ON DELETE SET NULL"
    )
    # Drives the "approvals assigned to me and still pending" query.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_approval_requests_assignee "
        "ON approval_requests (organization_id, assigned_to_user_id, status)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_approval_requests_assignee")
    op.execute("ALTER TABLE approval_requests DROP COLUMN IF EXISTS assigned_to_user_id")
