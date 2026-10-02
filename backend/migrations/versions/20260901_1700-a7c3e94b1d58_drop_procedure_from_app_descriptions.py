"""drop_procedure_from_app_descriptions

Revision ID: a7c3e94b1d58
Revises: f1b8d3a5c724
Create Date: 2026-09-01 17:00:00.000000

Removes the procedure standard naming from the application descriptions.

The seed no longer emits it, but seeds only insert — an organization that
already provisioned keeps the old copy, and these descriptions render in
the Applications settings list and the app switcher. So the rows have to be
rewritten as well.

Matched on the current text rather than blanket-replacing the description,
so an organization that has customised its own copy is left alone.

# MADRONA_MIGRATION_STRATEGY: owner
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e94b1d58'
down_revision: Union[str, None] = 'f1b8d3a5c724'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, None] = None


_OLD_COLLECTIONS = (
    "procedure standard-compliant collection management with object cataloging, "
    "locations, and movements"
)
_NEW_COLLECTIONS = (
    "Collection management with object cataloging, locations, and movements"
)


def upgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            "UPDATE applications SET description = :new "
            "WHERE key = 'collections' AND description = :old"
        ),
        {"old": _OLD_COLLECTIONS, "new": _NEW_COLLECTIONS},
    )

    # The Guide copy is long and has been edited before, so patch the phrase
    # rather than requiring the whole string to match.
    conn.execute(sa.text("""
        UPDATE applications
        SET description = replace(
            description,
            'Automate planning and procedures with Guide',
            'Automate planning and collections procedures with Guide'
        )
        WHERE description LIKE '%procedure standard%'
    """))


def downgrade() -> None:
    conn = op.get_bind()

    conn.execute(
        sa.text(
            "UPDATE applications SET description = :old "
            "WHERE key = 'collections' AND description = :new"
        ),
        {"old": _OLD_COLLECTIONS, "new": _NEW_COLLECTIONS},
    )
    conn.execute(sa.text("""
        UPDATE applications
        SET description = replace(
            description,
            'Automate planning and collections procedures with Guide',
            'Automate planning and procedures with Guide'
        )
    """))
