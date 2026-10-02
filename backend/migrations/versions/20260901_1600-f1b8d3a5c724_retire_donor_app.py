"""retire_donor_app

Revision ID: f1b8d3a5c724
Revises: e4a1c7b9d206
Create Date: 2026-09-01 16:00:00.000000

Removes 'donor' as a registered application.

Donor never shipped: no routes, no pages, no navigation, no models — only
an applications row marked "coming_soon". Its only effect was to occupy a
line in the Applications settings list advertising something an
organization cannot turn on, which is worse than absent now that list is
org-facing rather than a platform-admin console.

Nothing here touches the donor *domain* concepts, which are unrelated and
in active use: the donor constituent and contact roles, acquisition
donor_restrictions, deaccession donor_notified, and donor_development
events all stay exactly as they are.

# MADRONA_MIGRATION_STRATEGY: owner
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1b8d3a5c724'
down_revision: Union[str, None] = 'e4a1c7b9d206'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, None] = None


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(sa.text(
        "DELETE FROM app_role_assignments WHERE app_key = 'donor'"
    ))
    conn.execute(sa.text("""
        DELETE FROM organization_applications
        WHERE application_id IN (
            SELECT application_id FROM applications WHERE key = 'donor'
        )
    """))
    conn.execute(sa.text("DELETE FROM applications WHERE key = 'donor'"))


def downgrade() -> None:
    conn = op.get_bind()
    conn.execute(sa.text("""
        INSERT INTO applications (
            application_id, key, display_name, description, icon,
            default_enabled, requires_contract, sort_order, status
        )
        VALUES (
            '1f67c380-286d-44df-b66f-3cc27d99d69a', 'donor', 'Donor',
            'Donor and membership management with gift tracking',
            'Heart', false, true, 5, 'coming_soon'
        )
        ON CONFLICT (key) DO NOTHING
    """))
