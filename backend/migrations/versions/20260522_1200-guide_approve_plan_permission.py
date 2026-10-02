"""Register the guide.approve_plan permission and grant it to approver roles.

Backs the multi-agent plan executor's human-in-the-loop approval gate: when a
plan hits an approval_request await, it creates an ApprovalRequest reviewed
through the normal Approvals UI. Reviewing requires this permission. Granted
to the same roles that hold loans.approve (registrar, admin, platform_admin).

Revision ID: guide_approve_plan_perm
Revises: b7c8d9e0f1a2
Create Date: 2026-05-22 12:00:00
"""

from typing import Sequence, Union

from alembic import op
from sqlalchemy import text

# revision identifiers, used by Alembic.
revision: str = "guide_approve_plan_perm"
down_revision: Union[str, Sequence[str], None] = "b7c8d9e0f1a2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

PERMISSION = (
    "guide.approve_plan",
    "guide",
    "approve_plan",
    "Approve Guide Plans",
    "Approve a Guide agent plan step before the executor proceeds",
)

# Mirror loans.approve's grant target.
GRANT_ROLES = ["registrar", "admin", "platform_admin"]


def upgrade() -> None:
    conn = op.get_bind()
    perm_key, scope, action, display_name, description = PERMISSION

    conn.execute(
        text(
            """
            INSERT INTO permissions (permission_key, scope, action, display_name, description)
            VALUES (:perm_key, :scope, :action, :display_name, :description)
            ON CONFLICT (permission_key) DO NOTHING
            """
        ),
        {
            "perm_key": perm_key,
            "scope": scope,
            "action": action,
            "display_name": display_name,
            "description": description,
        },
    )

    perm_id = conn.execute(
        text("SELECT permission_id FROM permissions WHERE permission_key = :k"),
        {"k": perm_key},
    ).scalar()
    if perm_id is None:
        return

    for role_key in GRANT_ROLES:
        role_id = conn.execute(
            text("SELECT role_id FROM roles WHERE role_key = :rk AND is_system = true"),
            {"rk": role_key},
        ).scalar()
        if role_id is None:
            continue
        conn.execute(
            text(
                """
                INSERT INTO role_permissions (role_id, permission_id, created_at)
                VALUES (:role_id, :permission_id, NOW())
                ON CONFLICT (role_id, permission_id) DO NOTHING
                """
            ),
            {"role_id": role_id, "permission_id": perm_id},
        )


def downgrade() -> None:
    conn = op.get_bind()
    perm_key = PERMISSION[0]
    conn.execute(
        text(
            """
            DELETE FROM role_permissions rp
            USING permissions p
            WHERE rp.permission_id = p.permission_id
              AND p.permission_key = :k
            """
        ),
        {"k": perm_key},
    )
    conn.execute(
        text("DELETE FROM permissions WHERE permission_key = :k"),
        {"k": perm_key},
    )
