"""widget_enabled_gate_backfill

Revision ID: c6766bb3bd78
Revises: 666ad4c46c89
Create Date: 2026-07-10 11:24:02.823543

Data-only migration for the Visitor Guide widget gate.

The public visitor widget becomes opt-in per org via the Guide
OrganizationApplication.config["widget_enabled"] flag (absent = off).
Grandfather orgs with evidence of live use — a visitor-persona conversation
in the last 90 days — so an org actively using the widget doesn't go dark
on deploy. Everyone else stays off until enabled through the new widget
settings endpoint or platform admin.

# MADRONA_MIGRATION_STRATEGY: owner
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c6766bb3bd78'
down_revision: Union[str, Sequence[str], None] = '666ad4c46c89'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# ---------------------------------------------------------------------------
# Migration runs as the DB owner/migrator role (BYPASSRLS).
# Connection URL comes from ALEMBIC_DATABASE_URL (not DATABASE_URL).
#
# IMPORTANT - Data migrations that INSERT/UPDATE/DELETE rows in org-scoped
# tables must set organization_id explicitly on every row.  Do NOT rely on
# SET LOCAL row_security = off (legacy pattern, do not copy).
#
# If your migration touches org-scoped data, add this marker comment so the
# lint check (make lint-migrations) passes:
#   # MADRONA_MIGRATION_STRATEGY: owner
# ---------------------------------------------------------------------------


def upgrade() -> None:
    """Grandfather widget_enabled=true for orgs with recent visitor traffic."""
    op.execute(sa.text(
        """
        UPDATE organization_applications oa
        SET config = COALESCE(oa.config, '{}'::jsonb)
                     || '{"widget_enabled": true}'::jsonb
        FROM applications a
        WHERE a.application_id = oa.application_id
          AND a.key = 'guide'
          AND oa.enabled
          AND EXISTS (
              SELECT 1 FROM conversations c
              WHERE c.organization_id = oa.organization_id
                AND c.persona = 'visitor'
                AND c.created_at > now() - interval '90 days'
          )
        """
    ))


def downgrade() -> None:
    """Remove the widget_enabled key everywhere (widget reverts to implicit-on code)."""
    op.execute(sa.text(
        """
        UPDATE organization_applications oa
        SET config = oa.config - 'widget_enabled'
        FROM applications a
        WHERE a.application_id = oa.application_id
          AND a.key = 'guide'
          AND oa.config ? 'widget_enabled'
        """
    ))
