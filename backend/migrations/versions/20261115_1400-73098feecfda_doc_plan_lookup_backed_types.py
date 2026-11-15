"""Documentation plan type and review frequency are lookup-backed.

The CHECK constraints listed a vocabulary ('collection_wide', ...; 'biannual',
'annual') different from the lookup values the form offers
('documentation_policy', 'cataloging_plan', ...; 'biannually', 'annually'), so
no plan could be saved through the form. The API now checks both fields
against the organization's lookup values, as for other lookup-backed fields.

Revision ID: 73098feecfda
Revises: c7e2a94d1b36
"""

from alembic import op

revision = "73098feecfda"
down_revision = "c7e2a94d1b36"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        "ALTER TABLE collections.documentation_plans "
        "DROP CONSTRAINT IF EXISTS check_doc_plan_type"
    )
    op.execute(
        "ALTER TABLE collections.documentation_plans "
        "DROP CONSTRAINT IF EXISTS check_doc_plan_review_freq"
    )


def downgrade() -> None:
    # NOT VALID: rows saved since the upgrade may hold lookup values outside
    # the old lists; the constraints then apply to new writes only.
    op.execute(
        "ALTER TABLE collections.documentation_plans ADD CONSTRAINT check_doc_plan_type "
        "CHECK (plan_type IN ('collection_wide', 'project', 'thematic', 'emergency', 'accreditation')) NOT VALID"
    )
    op.execute(
        "ALTER TABLE collections.documentation_plans ADD CONSTRAINT check_doc_plan_review_freq "
        "CHECK (review_frequency IS NULL OR review_frequency IN ('monthly', 'quarterly', 'biannual', 'annual')) NOT VALID"
    )
