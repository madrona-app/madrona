"""Repoint condition_reports.examiner_id from users → constituents.

Examiner was the odd one out: the FK pointed at users, but the workspace picker
writes a constituent (and conservator/valuator/etc. all reference constituents).
This aligns examiner with the rest. Existing examiner_id values are user ids
(the old FK enforced it), so we first ensure each referenced user has a staff
constituent (the new user↔constituent link), remap the values, then swap the FK.

Revision ID: examiner_to_constituent
Revises: constituent_user_link
Create Date: 2026-06-09 11:00:00
"""

from typing import Sequence, Union

from alembic import op

# MADRONA_MIGRATION_STRATEGY: owner
# Runs as the DB owner (BYPASSRLS) to remap examiner_id across every org in one
# pass. The INSERT sets organization_id explicitly (from the source
# condition_report); the UPDATEs are org-scoped via the constituents join.

revision: str = "examiner_to_constituent"
down_revision: Union[str, Sequence[str], None] = "constituent_user_link"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_FK = "condition_reports_examiner_id_fkey"


def upgrade() -> None:
    # 1. Ensure a staff constituent exists for every user referenced as examiner.
    op.execute("""
        INSERT INTO collections.constituents
            (constituent_id, organization_id, user_id, constituent_type, name, email,
             is_active, status, is_verified)
        SELECT gen_random_uuid(), cr.organization_id, cr.examiner_id, 'person',
               COALESCE(u.display_name, u.email, 'Staff member'), u.email,
               -- NOT NULL with model-level (Python) defaults only, so create_all
               -- builds them without a DB default — a raw INSERT must set them.
               true, 'active', false
        FROM (SELECT DISTINCT organization_id, examiner_id
                FROM collections.condition_reports
               WHERE examiner_id IS NOT NULL) cr
        JOIN users u ON u.user_id = cr.examiner_id
        LEFT JOIN collections.constituents c
               ON c.organization_id = cr.organization_id AND c.user_id = cr.examiner_id
        WHERE c.constituent_id IS NULL
    """)
    # 2. Drop the old (users) FK BEFORE remapping — the new constituent ids
    #    aren't valid user ids, so the remap must run with no FK in force.
    op.drop_constraint(_FK, "condition_reports", schema="collections", type_="foreignkey")
    # 3. Remap examiner_id: user id → that user's staff constituent id.
    op.execute("""
        UPDATE collections.condition_reports cr
           SET examiner_id = c.constituent_id
          FROM collections.constituents c
         WHERE c.organization_id = cr.organization_id
           AND c.user_id = cr.examiner_id
           AND cr.examiner_id IS NOT NULL
    """)
    # 4. Add the new FK → constituents.
    op.create_foreign_key(
        _FK, "condition_reports", "constituents",
        ["examiner_id"], ["constituent_id"],
        source_schema="collections", referent_schema="collections",
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(_FK, "condition_reports", schema="collections", type_="foreignkey")
    # Reverse remap: constituent id → its linked user id (NULL for non-staff).
    op.execute("""
        UPDATE collections.condition_reports cr
           SET examiner_id = c.user_id
          FROM collections.constituents c
         WHERE c.constituent_id = cr.examiner_id
           AND cr.examiner_id IS NOT NULL
    """)
    op.create_foreign_key(
        _FK, "condition_reports", "users",
        ["examiner_id"], ["user_id"],
        source_schema="collections",
        ondelete="SET NULL",
    )
