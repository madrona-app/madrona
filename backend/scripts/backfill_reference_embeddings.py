"""
Backfill reference_chunks embeddings using the configured embedding provider.

Re-embeds reference_chunks.content via app.services.embedding_service (Voyage in
deployed envs, Ollama for local dev) and updates BOTH embedding_vec (pgvector)
and embedding (JSON copy). Use after the guide_voyage_embeddings_1024 migration,
which clears the old nomic vectors.

Voyage requests are batched; Ollama falls back to sequential single calls inside
the service. Resume-safe: --only-missing skips rows that already have a vector.

Requires SEMANTIC_SEARCH_ENABLED=true and, for Voyage, VOYAGE_API_KEY.

Usage:
    cd backend
    ./venv/bin/python -m scripts.backfill_reference_embeddings              # full
    ./venv/bin/python -m scripts.backfill_reference_embeddings --limit 20   # dry-run
    ./venv/bin/python -m scripts.backfill_reference_embeddings --only-missing
"""

from __future__ import annotations

import argparse
import logging
import sys
import time

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_session_factory
from app.models.reference import ReferenceChunk
from app.services.embedding_service import get_embeddings_batch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def _fetch_batch(
    session: Session, only_missing: bool, after_id, batch_size: int
) -> list[ReferenceChunk]:
    """Keyset-paginated batch of chunks ordered by chunk_id."""
    stmt = select(ReferenceChunk).order_by(ReferenceChunk.chunk_id)
    if only_missing:
        stmt = stmt.where(ReferenceChunk.embedding_vec.is_(None))
    if after_id is not None:
        stmt = stmt.where(ReferenceChunk.chunk_id > after_id)
    stmt = stmt.limit(batch_size)
    return list(session.execute(stmt).scalars().all())


def backfill(
    limit: int | None = None,
    only_missing: bool = False,
    batch_size: int = 128,
) -> int:
    settings = get_settings()
    if not settings.semantic_search_enabled:
        logger.error("SEMANTIC_SEARCH_ENABLED is false — nothing to do. Enable it first.")
        return 0
    if settings.embedding_provider == "voyage" and not settings.voyage_api_key:
        logger.error("EMBEDDING_PROVIDER=voyage but VOYAGE_API_KEY is empty.")
        return 0

    logger.info(
        "Provider: %s, model: %s, dims: %d",
        settings.embedding_provider,
        settings.voyage_model if settings.embedding_provider == "voyage" else settings.semantic_search_model,
        settings.semantic_search_dimensions,
    )

    Session = get_session_factory()
    with Session() as session:
        total_stmt = select(func.count()).select_from(ReferenceChunk)
        if only_missing:
            total_stmt = total_stmt.where(ReferenceChunk.embedding_vec.is_(None))
        total = session.execute(total_stmt).scalar_one()
        if limit is not None:
            total = min(total, limit)
        logger.info("Target rows: %d (only_missing=%s)", total, only_missing)

        done = 0
        failed = 0
        after_id = None
        started = time.time()

        while True:
            if limit is not None and done + failed >= limit:
                break
            remaining = None if limit is None else max(0, limit - (done + failed))
            this_batch = batch_size if remaining is None else min(batch_size, remaining)
            if this_batch == 0:
                break

            chunks = _fetch_batch(session, only_missing, after_id, this_batch)
            if not chunks:
                break
            after_id = chunks[-1].chunk_id

            vectors = get_embeddings_batch(
                [c.content for c in chunks], task="search_document"
            )

            for chunk, vec in zip(chunks, vectors):
                if vec is None:
                    failed += 1
                    continue
                session.execute(
                    update(ReferenceChunk)
                    .where(ReferenceChunk.chunk_id == chunk.chunk_id)
                    .values(embedding_vec=vec, embedding=vec)
                )
                done += 1

            session.commit()

            elapsed = time.time() - started
            rate = done / elapsed if elapsed else 0
            eta = (total - done) / rate if rate else 0
            logger.info(
                "  %d/%d (rate %.1f/s, eta %.0fm, %d failed)",
                done, total, rate, eta / 60, failed,
            )

        logger.info(
            "Done: %d updated, %d failed, %.1fs total",
            done, failed, time.time() - started,
        )
        return done


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None, help="Stop after N rows")
    parser.add_argument("--only-missing", action="store_true",
                        help="Only embed rows with NULL embedding_vec")
    parser.add_argument("--batch-size", type=int, default=128,
                        help="Texts per provider request (Voyage batches; Ollama is sequential)")
    args = parser.parse_args()

    count = backfill(
        limit=args.limit,
        only_missing=args.only_missing,
        batch_size=args.batch_size,
    )
    return 0 if count > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
