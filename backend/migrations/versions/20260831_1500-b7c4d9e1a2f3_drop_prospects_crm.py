"""drop_prospects_crm

Revision ID: b7c4d9e1a2f3
Revises: a1f2c3d4e5b6
Create Date: 2026-08-31 15:00:00.000000

Drops the vendor-internal sales-CRM tables.

`prospects` / `prospect_activities` held Madrona's own sales pipeline for
selling to museums — lead scoring, tier/segment, revenue estimates, a
competitor-customer flag, and sales-team status. None of it is museum-facing
functionality, and it has no business shipping in a product museums run
themselves. No other table references these, so the drop is self-contained.

# MADRONA_MIGRATION_STRATEGY: owner
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = 'b7c4d9e1a2f3'
down_revision: Union[str, Sequence[str], None] = 'a1f2c3d4e5b6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # prospect_activities has the FK to prospects — drop it first.
    op.execute("DROP TABLE IF EXISTS prospect_activities CASCADE")
    op.execute("DROP TABLE IF EXISTS prospects CASCADE")


def downgrade() -> None:
    # Deliberately not restored: the sales CRM was removed on purpose.
    pass
