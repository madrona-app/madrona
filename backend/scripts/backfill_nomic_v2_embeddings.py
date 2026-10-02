"""
Backfill reference_chunks embeddings with Nomic v2 MoE.

Iterates all rows in reference_chunks, re-embeds content with the currently
configured SEMANTIC_SEARCH_MODEL (expected: nomic-embed-text-v2-moe), and
updates embedding_vec. Resume-safe: if you pass --only-missing, rows that
already have a vector are skipped (useful for retries after a partial run).

By default, ALL rows are re-embedded — because the old vectors came from v1
and mixing v1/v2 vectors in the same index destroys retrieval quality.

Usage:
    cd backend
    ./venv/bin/python -m scripts.backfill_nomic_v2_embeddings              # full backfill
    ./venv/bin/python -m scripts.backfill_nomic_v2_embeddings --limit 20   # dry-run
    ./venv/bin/python -m scripts.backfill_nomic_v2_embeddings --only-missing
"""

from __future__ import annotations

import argparse
import logging
import sys
import time
from typing import Iterator

import requests
from sqlalchemy import select, update, func
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_session_factory
from app.models.reference import ReferenceChunk

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)


def _embed(text: str, settings) -> list[float] | None:
    """Embed one string via Ollama with fallback truncation for dense content."""
    if not text or not text.strip():
        return None
    # Nomic v2 MoE caps at 512 tokens. Fallback truncation handles dense
    # tabular data and PDF-extraction garbage that exceed the limit at 1200.
    for char_limit in (1200, 800, 500):
        try:
            resp = requests.post(
                f"{settings.ollama_base_url}/api/embeddings",
                json={"model": settings.semantic_search_model,
                      "prompt": f"search_document: {text[:char_limit]}"},
                timeout=60,
            )
            if resp.status_code == 500 and "exceeds the context length" in resp.text:
                continue  # try shorter truncation
            resp.raise_for_status()
            vec = resp.json().get("embedding")
            if not vec or len(vec) != settings.semantic_search_dimensions:
                logger.warning("Unexpected embedding dims: got %d expected %d",
                               len(vec) if vec else 0, settings.semantic_search_dimensions)
                return None
            return vec
        except Exception as e:
            logger.warning("Embedding call failed: %s", e)
            return None
    return None


def _iter_chunks(session: Session, only_missing: bool, limit: int | None,
                 batch_size: int = 200) -> Iterator[ReferenceChunk]:
    """Yield chunks in deterministic order, in batches."""
    offset = 0
    yielded = 0
    while True:
        stmt = select(ReferenceChunk).order_by(ReferenceChunk.chunk_id)
        if only_missing:
            stmt = stmt.where(ReferenceChunk.embedding_vec.is_(None))
        stmt = stmt.offset(offset).limit(batch_size)
        rows = session.execute(stmt).scalars().all()
        if not rows:
            return
        for row in rows:
            yield row
            yielded += 1
            if limit is not None and yielded >= limit:
                return
        offset += batch_size


def backfill(limit: int | None = None, only_missing: bool = False,
             commit_every: int = 50) -> int:
    settings = get_settings()
    logger.info("Using model: %s (%d dims)",
                settings.semantic_search_model, settings.semantic_search_dimensions)

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
        started = time.time()
        since_commit = 0

        for chunk in _iter_chunks(session, only_missing, limit):
            vec = _embed(chunk.content, settings)
            if vec is None:
                failed += 1
                continue

            session.execute(
                update(ReferenceChunk)
                .where(ReferenceChunk.chunk_id == chunk.chunk_id)
                .values(embedding_vec=vec)
            )
            done += 1
            since_commit += 1

            if since_commit >= commit_every:
                session.commit()
                since_commit = 0

            if done % 100 == 0:
                elapsed = time.time() - started
                rate = done / elapsed if elapsed else 0
                eta = (total - done) / rate if rate else 0
                logger.info("  %d/%d (rate %.1f/s, eta %.0fm, %d failed)",
                            done, total, rate, eta / 60, failed)

        session.commit()
        elapsed = time.time() - started
        logger.info("Done: %d updated, %d failed, %.1fs total",
                    done, failed, elapsed)
        return done


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=None,
                        help="Stop after N rows (for dry-run)")
    parser.add_argument("--only-missing", action="store_true",
                        help="Only re-embed rows with NULL embedding_vec")
    args = parser.parse_args()

    count = backfill(limit=args.limit, only_missing=args.only_missing)
    return 0 if count > 0 else 1


if __name__ == "__main__":
    sys.exit(main())
