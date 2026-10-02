"""add media_rights_enforcement flag to organizations

Revision ID: 03ad46fdde10
Revises: f1a2b3c4d5e6
Create Date: 2026-05-14 09:51:16.021218

Adds the `media_rights_enforcement` boolean to `organizations`. Default
false preserves the pre-2026-05 download behavior; orgs opt in once
their MediaRights data is populated.

The autogen run that produced the initial draft of this file also
detected ~600 lines of unrelated TIMESTAMP/index drift across many
tables — that drift represents a model/DB schema divergence that
predates this change and should be addressed in a dedicated migration,
not bundled with a single-column feature flag. Those changes have been
trimmed from this revision.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '03ad46fdde10'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Idempotent ADD — matches the repo convention (see f1a2b3c4d5e6) so a
    # re-run, a partially-applied state, or a DB whose schema was built by
    # Base.metadata.create_all (the test bootstrap) doesn't hard-fail with
    # DuplicateColumn. Postgres supports ADD COLUMN IF NOT EXISTS.
    op.execute(
        "ALTER TABLE organizations ADD COLUMN IF NOT EXISTS "
        "media_rights_enforcement BOOLEAN NOT NULL DEFAULT false"
    )
    op.execute(
        "COMMENT ON COLUMN organizations.media_rights_enforcement IS "
        "'If true, /media/{id}/download enforces rights-based + unpublished + derivative permission checks.'"
    )


def downgrade() -> None:
    op.execute(
        "ALTER TABLE organizations DROP COLUMN IF EXISTS media_rights_enforcement"
    )
