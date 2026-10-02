"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
${imports if imports else ""}

# revision identifiers, used by Alembic.
revision: str = ${repr(up_revision)}
down_revision: Union[str, Sequence[str], None] = ${repr(down_revision)}
branch_labels: Union[str, Sequence[str], None] = ${repr(branch_labels)}
depends_on: Union[str, Sequence[str], None] = ${repr(depends_on)}

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
    """Upgrade schema."""
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    """Downgrade schema."""
    ${downgrades if downgrades else "pass"}
