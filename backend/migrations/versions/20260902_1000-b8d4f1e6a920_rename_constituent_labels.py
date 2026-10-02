"""rename_constituent_labels

Revision ID: b8d4f1e6a920
Revises: a7c3e94b1d58
Create Date: 2026-09-02 10:00:00.000000

Renames the user-visible "Constituent" wording to People and Organizations.

Only display text moves. The constituent_* category keys, table names,
columns and API routes stay as they are — renaming those is a separate,
much wider change with API-compatibility consequences.

Lookup category display names render on the Lookup Values admin page, so
the rows have to be rewritten as well as the seed: seeds only insert, and
an organization that already provisioned keeps the old labels.

"<Entity> Constituent Role" becomes "<Entity> Role", matching the sibling
"Contact Role" and "Authority Role" categories it sits beside in that list.
The generic one becomes "Person or Organization Role", since it has no
entity name to carry the meaning.

Each update matches on the current text, so an organization that renamed a
category itself is left alone.

# MADRONA_MIGRATION_STRATEGY: owner
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d4f1e6a920'
down_revision: Union[str, None] = 'a7c3e94b1d58'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, None] = None


# category_key -> (old display_name, new display_name)
_CATEGORIES = {
    "constituent_role_object": ("Object Constituent Role", "Object Role"),
    "constituent_role_acquisition": ("Acquisition Constituent Role", "Acquisition Role"),
    "constituent_role_exhibition": ("Exhibition Constituent Role", "Exhibition Role"),
    "constituent_role_event": ("Event Constituent Role", "Event Role"),
    "constituent_role_shipment": ("Shipment Constituent Role", "Shipment Role"),
    "constituent_role_conservation": ("Conservation Constituent Role", "Conservation Role"),
    "constituent_role_loan_in": ("Incoming Loan Constituent Role", "Incoming Loan Role"),
    "constituent_role_loan_out": ("Outgoing Loan Constituent Role", "Outgoing Loan Role"),
    "constituent_role_right": ("Rights Constituent Role", "Rights Role"),
    "constituent_role_generic": ("Constituent Role", "Person or Organization Role"),
}


def _apply(conn, forward: bool) -> None:
    for key, (old, new) in _CATEGORIES.items():
        frm, to = (old, new) if forward else (new, old)
        conn.execute(
            sa.text(
                "UPDATE collections.lookup_categories SET display_name = :to "
                "WHERE category_key = :key AND display_name = :frm"
            ),
            {"key": key, "frm": frm, "to": to},
        )


def upgrade() -> None:
    conn = op.get_bind()
    _apply(conn, forward=True)

    # Descriptions sit under the name on the same admin page.
    conn.execute(sa.text("""
        UPDATE collections.lookup_categories
        SET description = replace(
            replace(description, 'Constituent roles', 'Roles'),
            'constituent roles', 'roles'
        )
        WHERE description ILIKE '%constituent role%'
    """))


def downgrade() -> None:
    conn = op.get_bind()
    _apply(conn, forward=False)
