"""drop_contracts_vendor

Revision ID: c8d5e2f4b3a1
Revises: b7c4d9e1a2f3
Create Date: 2026-08-31 16:00:00.000000

Drops the vendor contract tables.

`contracts` / `contract_history` tracked Madrona's own commercial
agreements with customer museums — term dates, renewal, and a
stripe_subscription_id. App entitlement does not depend on them: the
per-org enablement dates live on `organization_applications`
(contract_start_date / contract_end_date), which is untouched.

# MADRONA_MIGRATION_STRATEGY: owner
"""
from typing import Sequence, Union

from alembic import op


revision: str = 'c8d5e2f4b3a1'
down_revision: Union[str, Sequence[str], None] = 'b7c4d9e1a2f3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS contract_history CASCADE")
    op.execute("DROP TABLE IF EXISTS contracts CASCADE")


def downgrade() -> None:
    # Deliberately not restored: vendor billing was removed on purpose.
    pass
