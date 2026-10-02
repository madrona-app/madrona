"""normalize_treatment_type_report_type_to_canonical_enums

Revision ID: 5efd597cebd4
Revises: b3e1c2d4f5a6
Create Date: 2026-06-13 08:46:54.776180

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '5efd597cebd4'
down_revision: Union[str, Sequence[str], None] = 'b3e1c2d4f5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Runs as the DB owner/migrator role (BYPASSRLS) via ALEMBIC_DATABASE_URL, so
# the UPDATEs below normalize rows across every organization. This is a pure
# value normalization (no schema change, no per-row organization_id needed).
# MADRONA_MIGRATION_STRATEGY: owner


def upgrade() -> None:
    """Normalize legacy/sandbox enum values to the canonical sets the API and
    frontend Zod schemas validate against.

    The sandbox seeders previously wrote granular intervention vocabularies
    (cleaning/stabilization/repair/rehousing/pest_treatment/documentation for
    treatment_type, and pre_treatment/post_treatment/loan_return for
    report_type) that are NOT in the canonical enums. The frontend rejects
    them on read ("Invalid input"), so any org seeded with demo data shows
    "Error loading ..." on conservation and condition-report pages.

    Fields normalized (canonical sets in parentheses):
      - conservation_treatments.treatment_type
        (preventive|remedial|restoration|analysis|other)
      - condition_reports.report_type
        (intake|loan_out|loan_in|periodic|conservation|incident)
      - acquisitions.source_type (individual|institution|estate|dealer|other)
      - loans_in.loan_purpose (exhibition|research|conservation|long_term|other)
      - locations.location_type (building|floor|room|case|shelf|drawer|other)

    The seeders now emit canonical values (see sandbox_seeder/*.py); this
    migration repairs rows already written. Runs as the owner role
    (BYPASSRLS), so it normalizes every org.
    """
    op.execute(
        """
        UPDATE collections.conservation_treatments
           SET treatment_type = 'remedial'
         WHERE treatment_type IN
               ('cleaning', 'stabilization', 'repair', 'rehousing', 'pest_treatment')
        """
    )
    op.execute(
        """
        UPDATE collections.conservation_treatments
           SET treatment_type = 'analysis'
         WHERE treatment_type = 'documentation'
        """
    )
    op.execute(
        """
        UPDATE collections.condition_reports
           SET report_type = 'conservation'
         WHERE report_type IN ('pre_treatment', 'post_treatment')
        """
    )
    op.execute(
        """
        UPDATE collections.condition_reports
           SET report_type = 'loan_out'
         WHERE report_type = 'loan_return'
        """
    )

    # acquisition source_type is a different enum from constituent_type; the
    # seeder used to copy the constituent value straight in. Canonical
    # source_type: individual|institution|estate|dealer|other.
    op.execute(
        """
        UPDATE collections.acquisitions
           SET source_type = 'individual'
         WHERE source_type = 'person'
        """
    )
    op.execute(
        """
        UPDATE collections.acquisitions
           SET source_type = 'institution'
         WHERE source_type IN ('organization', 'department')
        """
    )
    op.execute(
        """
        UPDATE collections.acquisitions
           SET source_type = 'dealer'
         WHERE source_type = 'auction_house'
        """
    )

    # loan-in purpose enum: exhibition|research|conservation|long_term|other.
    # "study" drifted in; map to research.
    op.execute(
        """
        UPDATE collections.loans_in
           SET loan_purpose = 'research'
         WHERE loan_purpose = 'study'
        """
    )

    # location_type: the DB CHECK constraint allows wing/area but the frontend
    # Zod enum (building|floor|room|case|shelf|drawer|other) does not. Map the
    # two drifted values to Zod-valid equivalents.
    op.execute(
        """
        UPDATE collections.locations
           SET location_type = 'floor'
         WHERE location_type = 'wing'
        """
    )
    op.execute(
        """
        UPDATE collections.locations
           SET location_type = 'room'
         WHERE location_type = 'area'
        """
    )


def downgrade() -> None:
    """Not reversible.

    The mapping is many-to-one (e.g. cleaning/stabilization/repair all collapse
    to 'remedial'), so the original granular values cannot be recovered. This
    is a forward-only data normalization.
    """
    pass
