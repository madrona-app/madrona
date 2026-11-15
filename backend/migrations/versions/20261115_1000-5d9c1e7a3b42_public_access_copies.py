"""Public access copies: allow PDF derivatives and the access_copy job.

Discover plays and opens an access copy instead of the original unless a
file's public download level is 'originals' (services/public_access_copy.py).
A PDF's access copy is a page-image PDF stored as a media_derivatives row with
format 'pdf', and the work runs as a media_processing_jobs row of type
'access_copy'. Both CHECK constraints are widened. The audio web proxy is
AAC in MP4, which format 'mp4' already allows.

Revision ID: 5d9c1e7a3b42
Revises: c7e2a94d1b36
Create Date: 2026-11-15 10:00:00
"""
from alembic import op

revision = "5d9c1e7a3b42"
down_revision = "c7e2a94d1b36"
branch_labels = None
depends_on = None

_JOB_TYPES = (
    "'derivatives', 'transcode', 'metadata_extract', 'watermark', "
    "'regenerate', 'model_3d_process', 'metadata_embed'"
)


def upgrade() -> None:
    op.execute("ALTER TABLE media.media_derivatives DROP CONSTRAINT IF EXISTS check_derivative_format")
    op.execute(
        "ALTER TABLE media.media_derivatives ADD CONSTRAINT check_derivative_format "
        "CHECK (format IN ('jpeg', 'webp', 'png', 'avif', 'mp4', 'webm', 'pdf'))"
    )
    op.execute("ALTER TABLE media.media_processing_jobs DROP CONSTRAINT IF EXISTS check_job_type")
    op.execute(
        "ALTER TABLE media.media_processing_jobs ADD CONSTRAINT check_job_type "
        f"CHECK (job_type IN ({_JOB_TYPES}, 'access_copy'))"
    )


def downgrade() -> None:
    op.execute("DELETE FROM media.media_processing_jobs WHERE job_type = 'access_copy'")
    op.execute("ALTER TABLE media.media_processing_jobs DROP CONSTRAINT IF EXISTS check_job_type")
    op.execute(
        "ALTER TABLE media.media_processing_jobs ADD CONSTRAINT check_job_type "
        f"CHECK (job_type IN ({_JOB_TYPES}))"
    )
    op.execute("DELETE FROM media.media_derivatives WHERE format = 'pdf'")
    op.execute("ALTER TABLE media.media_derivatives DROP CONSTRAINT IF EXISTS check_derivative_format")
    op.execute(
        "ALTER TABLE media.media_derivatives ADD CONSTRAINT check_derivative_format "
        "CHECK (format IN ('jpeg', 'webp', 'png', 'avif', 'mp4', 'webm'))"
    )
