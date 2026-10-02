"""Resize reference_chunks.embedding_vec 768 -> 1024 for Voyage embeddings.

Guide RAG and collection semantic search move off local Ollama
(nomic-embed-text-v2-moe, 768-dim) to the Voyage hosted API (voyage-3.5,
1024-dim). Mixing vectors from two models in one column is meaningless, and
pgvector cannot cast between dimensions, so the cleanest path is to drop and
re-add the column at the new width. This clears every existing (nomic) vector;
the corpus must be re-embedded afterwards:

    ./venv/bin/python -m scripts.backfill_reference_embeddings

Pure DDL — no DML on the (RLS-scoped) reference_chunks table. The sibling
`embedding` JSON column is left as-is; the re-embed overwrites it per row.

Revision ID: guide_voyage_embeddings_1024
Revises: approval_assignee
Create Date: 2026-05-25 10:00:00
"""

from typing import Sequence, Union

from alembic import op

revision: str = "guide_voyage_embeddings_1024"
down_revision: Union[str, Sequence[str], None] = "approval_assignee"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # No ANN index exists on this column, so a plain drop/re-add is safe.
    op.execute("ALTER TABLE reference_chunks DROP COLUMN IF EXISTS embedding_vec")
    op.execute("ALTER TABLE reference_chunks ADD COLUMN embedding_vec vector(1024)")


def downgrade() -> None:
    op.execute("ALTER TABLE reference_chunks DROP COLUMN IF EXISTS embedding_vec")
    op.execute("ALTER TABLE reference_chunks ADD COLUMN embedding_vec vector(768)")
