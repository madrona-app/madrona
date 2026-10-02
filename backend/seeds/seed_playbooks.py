"""
Seed the Madrona workflow playbooks (reference_chunks) for Guide RAG retrieval.

Idempotent + incremental: ingests only the sources that have no chunks yet, so
a fresh environment self-populates on first run without re-embedding on every
deploy.

Not part of the boot sequence — entrypoint.sh classifies this as an optional
seed because embedding costs money and the Guide answers without it. Run it by
hand when you want `lookup_playbook` to work:

    cd backend && ./venv/bin/python -m seeds.seed_playbooks

Requires SEMANTIC_SEARCH_ENABLED (+ VOYAGE_API_KEY for the Voyage provider) —
no-ops with a clear log otherwise, since chunks without embeddings can't be
retrieved. Must run as the owner role (BYPASSRLS); playbook rows are global
(organization_id IS NULL), which the tenant-scoped RLS policy forbids writing.

This previously also ingested a corpus of third-party standards publications
(procedures, Getty, NPS, CCI, AIC and others). That was removed: Madrona is
Apache-2.0, which grants every recipient commercial redistribution rights that
those publishers have not granted. Institutions that want grounded answers
from their own holdings upload documents through the Guide, which lands them
in the same table, scoped to their organization.
"""

import logging
import os

from sqlalchemy import create_engine, text

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def seed_playbooks() -> None:
    from app.config import get_settings

    settings = get_settings()
    if not settings.semantic_search_enabled:
        logger.info("SEMANTIC_SEARCH_ENABLED is false — skipping playbook seed.")
        return
    if settings.embedding_provider == "voyage" and not settings.voyage_api_key:
        logger.warning("EMBEDDING_PROVIDER=voyage but VOYAGE_API_KEY is empty — skipping playbook seed.")
        return

    db_url = os.environ.get("DATABASE_URL")
    if not db_url:
        logger.error("DATABASE_URL not set — cannot seed playbooks.")
        return

    from scripts.ingest_references import INGEST_SOURCES, _resolve_source_dir, ingest

    engine = create_engine(db_url)
    try:
        with engine.connect() as conn:
            present = {
                row[0]
                for row in conn.execute(text("SELECT DISTINCT source FROM reference_chunks"))
            }
    finally:
        engine.dispose()

    def _has_files(name: str) -> bool:
        d = _resolve_source_dir(name)
        return d is not None and d.is_dir()

    missing = [s for s in INGEST_SOURCES if s not in present and _has_files(s)]
    no_files = [s for s in INGEST_SOURCES if s not in present and not _has_files(s)]

    if no_files:
        logger.info("Sources with no files on disk (skipped): %s", no_files)
    if not missing:
        logger.info(
            "Playbooks already ingested (%d source(s) present) — nothing to do.",
            len(present),
        )
        return

    logger.info("Seeding %d missing source(s): %s", len(missing), missing)
    # ingest() chunks (with cleaning), embeds via the configured provider, and
    # inserts global (organization_id IS NULL) rows. Idempotent per source.
    ingest(db_url, missing)


if __name__ == "__main__":
    seed_playbooks()
