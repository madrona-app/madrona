"""add organization_collection_profiles (issue #77)

Per-organization collection scope profile (scope/coverage/completeness/known
gaps/digitization status). Rendered into a compact "Collection Scope" block
injected into the Guide's system prompt so it discloses coverage and known
gaps instead of presenting partial holdings as comprehensive.

NOTE: autogenerate surfaced a large amount of pre-existing model<->DB drift
(reports/report_runs/report_schedules type + index changes). That drift is
intentionally NOT included here — this migration only creates the new table.
RLS for the table is provided by the boot-time seed_rls_policies (the table is
registered there); the standard org-isolation policy applies.

Revision ID: 498996a46506
Revises: 38596b1980af
Create Date: 2026-06-10 08:33

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = '498996a46506'
down_revision: Union[str, Sequence[str], None] = '38596b1980af'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent on a fresh `alembic upgrade head`: the consolidated baseline
    # (33d81a377dc7) delegates to Base.metadata.create_all, which already builds
    # this table (+ its indexes/constraints) from the current model. Skip if
    # present; incremental DBs (predating the model) still create it here.
    if sa.inspect(op.get_bind()).has_table("organization_collection_profiles"):
        return
    op.create_table(
        'organization_collection_profiles',
        sa.Column('profile_id', sa.UUID(), server_default=sa.text('gen_random_uuid()'), nullable=False),
        sa.Column('organization_id', sa.UUID(), nullable=False),
        sa.Column('scope_note', sa.Text(), nullable=True, comment='Narrative description of what the collection covers'),
        sa.Column('coverage', postgresql.JSONB(astext_type=sa.Text()), nullable=True, comment='Structured coverage: {date_range, record_types, geography, languages}'),
        sa.Column('completeness', sa.String(length=20), nullable=True, comment='comprehensive | representative | partial | unknown'),
        sa.Column('extent_note', sa.Text(), nullable=True, comment='Free-text note on extent/size and what completeness means here'),
        sa.Column('known_gaps', sa.Text(), nullable=True, comment='Known gaps / excluded content and the reason (e.g. not digitized, legal, curatorial)'),
        sa.Column('digitization_status', sa.String(length=20), nullable=True, comment='full | partial | minimal | none | unknown'),
        sa.Column('updated_by', sa.UUID(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
        sa.CheckConstraint("completeness IS NULL OR completeness IN ('comprehensive', 'representative', 'partial', 'unknown')", name='ck_collection_profile_completeness'),
        sa.CheckConstraint("digitization_status IS NULL OR digitization_status IN ('full', 'partial', 'minimal', 'none', 'unknown')", name='ck_collection_profile_digitization'),
        sa.ForeignKeyConstraint(['organization_id'], ['organizations.organization_id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by'], ['users.user_id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('profile_id'),
        sa.UniqueConstraint('organization_id'),
    )
    op.create_index('ix_org_collection_profile_organization_id', 'organization_collection_profiles', ['organization_id'], unique=True)


def downgrade() -> None:
    op.drop_index('ix_org_collection_profile_organization_id', table_name='organization_collection_profiles')
    op.drop_table('organization_collection_profiles')
