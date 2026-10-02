"""
Chunk and embed Madrona's workflow playbooks into pgvector for RAG retrieval.

Reads markdown files from backend/playbooks/, splits them into chunks by
heading structure, embeds each chunk via Ollama nomic-embed-text, and stores
them in the reference_chunks table.

Idempotent per source — re-running for a source replaces its chunks.

Usage:
    cd backend
    ./venv/bin/python scripts/ingest_references.py

    # Limit to specific sources
    ./venv/bin/python scripts/ingest_references.py --source playbook

    # Custom database URL
    ./venv/bin/python scripts/ingest_references.py --db-url postgresql://user:pass@host/db
"""

import argparse
import json
import logging
import re
import time
import uuid
from pathlib import Path

import requests
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

BACKEND_ROOT = Path(__file__).parent.parent

# Madrona's own workflow playbooks, hand-authored and committed alongside the
# app code. This used to also ingest a corpus of third-party standards
# publications; that was removed because Madrona is Apache-2.0 and cannot
# grant the redistribution rights those publishers withhold. Institutions
# that want grounded answers from their own holdings upload documents through
# the Guide, which lands them in the same table, org-scoped.
SOURCE_DIRS: dict[str, Path] = {
    "playbook": BACKEND_ROOT / "playbooks",
}


def _resolve_source_dir(name: str) -> Path | None:
    """Directory for a source name, or None if the name is not a known source."""
    return SOURCE_DIRS.get(name)


OLLAMA_URL = "http://localhost:11434"
EMBED_MODEL = "nomic-embed-text-v2-moe"
CHUNK_MAX_CHARS = 1500   # stays under Nomic v2 MoE's 512-token hard cap
CHUNK_OVERLAP_CHARS = 200
EMBED_INPUT_MAX_CHARS = 1200  # truncation applied before sending to embedder


# ── Chunking ──────────────────────────────────────────────────────────────


MIN_CHUNK_CHARS = 50  # below this, chunks are noise (headings, page numbers)


# Bare page numbers and running-header boilerplate. Retained for documents
# converted from PDF; hand-authored playbooks rarely trip it.
_FOOTER_RE = re.compile(
    r"^\s*(?:page\s*\d+|\d{1,4})\s*$",
    re.IGNORECASE,
)


def _clean_text(text_content: str) -> str:
    """Strip PDF-extraction artifacts before chunking.

    - removes control characters (except tab/newline)
    - drops page-footer boilerplate and bare page numbers
    - collapses repeated short lines (extracted flowchart fragments such as
      'Go to and' / 'return from' repeated down a column)
    - fixes a couple of common doubled-letter conversion artifacts
    """
    text_content = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", "", text_content)

    out_lines: list[str] = []
    recent: list[str] = []  # sliding window of recently kept short lines
    for line in text_content.split("\n"):
        s = line.strip()
        if _FOOTER_RE.match(s):
            continue
        # A short line that already appears in the recent window is repetition
        # noise (flattened flowchart fragments) — keep only the first.
        if s and len(s) < 40 and s in recent:
            continue
        out_lines.append(line)
        recent.append(s)
        if len(recent) > 8:
            recent.pop(0)

    out = "\n".join(out_lines)
    out = out.replace("PROCEDUREE", "PROCEDURE")
    out = re.sub(r"\n{3,}", "\n\n", out)
    return out.strip()


def _is_noise_chunk(content: str) -> bool:
    """True for chunks that are mostly repetition (survived line-collapse) and
    carry little unique signal — keeps them out of the retrieval index."""
    words = content.split()
    if len(words) >= 25 and len(set(w.lower() for w in words)) < 8:
        return True
    return False


def _split_long_paragraph(paragraph: str) -> list[str]:
    """Hard-split a single paragraph that exceeds CHUNK_MAX_CHARS.

    Prefers sentence boundaries; falls back to char boundary if needed.
    Result pieces are between MIN_CHUNK_CHARS and CHUNK_MAX_CHARS.
    """
    if len(paragraph) <= CHUNK_MAX_CHARS:
        return [paragraph]

    # Sentence-boundary split (handles ".", "!", "?" + whitespace)
    sentences = re.split(r"(?<=[.!?])\s+", paragraph)

    pieces: list[str] = []
    current = ""

    def _flush():
        nonlocal current
        if len(current.strip()) >= MIN_CHUNK_CHARS:
            pieces.append(current.strip())
        current = ""

    for sent in sentences:
        sent = sent.strip()
        if not sent:
            continue

        # Sentence itself too long — hard char-boundary split with small overlap
        if len(sent) > CHUNK_MAX_CHARS:
            _flush()
            stride = CHUNK_MAX_CHARS - 100  # 100-char overlap between hard-split pieces
            for i in range(0, len(sent), stride):
                piece = sent[i:i + CHUNK_MAX_CHARS]
                if len(piece) >= MIN_CHUNK_CHARS:
                    pieces.append(piece)
            continue

        # Normal sentence: append if it fits, otherwise flush and start new
        if len(current) + len(sent) + 1 > CHUNK_MAX_CHARS and current:
            _flush()
        current = (current + " " + sent).strip() if current else sent

    _flush()
    return pieces


def _chunk_by_headings(text_content: str, source: str, document: str) -> list[dict]:
    """Split markdown by headings, then by paragraph if sections are too long.

    Long single paragraphs are hard-split at sentence boundaries to ensure
    every chunk fits the embedder's context window.
    """
    sections = re.split(r'\n(?=#{1,4}\s)', text_content)

    chunks = []
    current_heading = None

    def _emit(content: str):
        if len(content) >= MIN_CHUNK_CHARS and not _is_noise_chunk(content):
            chunks.append({
                "source": source,
                "document": document,
                "section": current_heading,
                "content": content,
            })

    for section in sections:
        section = section.strip()
        if not section:
            continue

        lines = section.split('\n')
        if lines and lines[0].startswith('#'):
            current_heading = lines[0].lstrip('#').strip()

        if len(section) <= CHUNK_MAX_CHARS:
            _emit(section)
            continue

        # Section too big — split by paragraphs, hard-splitting any single
        # paragraph that itself exceeds the limit.
        paragraphs = section.split('\n\n')
        buffer: list[str] = []
        buffer_len = 0

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue

            # Hard-split mega-paragraphs into pieces, each ≤ CHUNK_MAX_CHARS.
            for piece in _split_long_paragraph(para):
                piece_len = len(piece)
                # Flush if adding this piece would exceed the limit
                if buffer_len + piece_len + 2 > CHUNK_MAX_CHARS and buffer:
                    _emit('\n\n'.join(buffer))
                    # Use trailing CHUNK_OVERLAP_CHARS of last buffer item for
                    # overlap, not the whole paragraph (which can be max-sized).
                    last = buffer[-1]
                    if len(last) > CHUNK_OVERLAP_CHARS:
                        overlap = last[-CHUNK_OVERLAP_CHARS:]
                    elif len(last) >= MIN_CHUNK_CHARS:
                        overlap = last
                    else:
                        overlap = ""
                    if overlap and len(overlap) + piece_len + 2 <= CHUNK_MAX_CHARS:
                        buffer = [overlap]
                        buffer_len = len(overlap)
                    else:
                        buffer = []
                        buffer_len = 0
                buffer.append(piece)
                buffer_len += piece_len + 2  # account for joiner

        if buffer:
            _emit('\n\n'.join(buffer))

    return chunks


# ── Embedding ─────────────────────────────────────────────────────────────


def _embed(text_content: str, retries: int = 2) -> list[float] | None:
    """Delegate to the shared embedding service so the script picks the
    configured provider (Voyage in deployed envs, Ollama for local dev) and
    matches whatever dimension the backend is configured for. Previously this
    hardcoded a direct Ollama call + 768-dim check, which broke against the
    Voyage 1024-dim staging DB column.
    """
    from app.services.embedding_service import get_embedding

    return get_embedding(text_content, task="search_document")


def _check_ollama() -> bool:
    """Verify Ollama is running and the embedding model is loaded."""
    try:
        resp = requests.get(f"{OLLAMA_URL}/api/tags", timeout=5)
        resp.raise_for_status()
        models = resp.json().get("models", [])
        model_names = [m.get("name", "").split(":")[0] for m in models]
        if EMBED_MODEL not in model_names:
            logger.error(
                "Embedding model '%s' not found in Ollama. Available: %s\n"
                "Run: ollama pull %s",
                EMBED_MODEL, model_names, EMBED_MODEL,
            )
            return False
        return True
    except requests.RequestException as e:
        logger.error("Ollama not reachable at %s: %s", OLLAMA_URL, e)
        return False


# ── Source discovery ──────────────────────────────────────────────────────

# Sources that should be ingested for RAG retrieval
INGEST_SOURCES = list(SOURCE_DIRS)


# ── Main ingestion ────────────────────────────────────────────────────────


def ingest(db_url: str, sources: list[str] | None = None) -> None:
    """Chunk, embed, and store reference documents."""
    from app.config import get_settings
    # Only Ollama needs a local daemon; Voyage (deployed envs) is a remote API.
    if get_settings().embedding_provider == "ollama" and not _check_ollama():
        return

    engine = create_engine(db_url)

    source_names = sources or INGEST_SOURCES
    source_dirs = []
    for name in source_names:
        d = _resolve_source_dir(name)
        if d is None:
            logger.warning(
                "Unknown source %r — known sources: %s", name, ", ".join(SOURCE_DIRS)
            )
        elif d.is_dir():
            source_dirs.append((name, d))
        else:
            logger.warning("Source directory not found: %s", d)

    if not source_dirs:
        logger.error(
            "No source directories found (looked in: %s)",
            ", ".join(str(d) for d in SOURCE_DIRS.values()),
        )
        return

    total_chunks = 0
    total_embedded = 0
    start_time = time.time()

    # Build the cast with whatever vector dim the embedding service is
    # configured for — was hardcoded to 768 (nomic) before Voyage migration.
    from app.config import get_settings
    _dim = get_settings().semantic_search_dimensions
    INSERT_SQL = text(f"""
        INSERT INTO reference_chunks
            (chunk_id, source, document, section, content, embedding, embedding_vec)
        VALUES
            (:id, :source, :document, :section, :content, :embedding,
             cast(:embedding_vec as vector({_dim})))
    """)

    with Session(engine) as session:
        for source_name, source_dir in source_dirs:
            logger.info("--- %s ---", source_name)

            # Clear existing chunks for this source (idempotent re-runs)
            deleted = session.execute(
                text("DELETE FROM reference_chunks WHERE source = :s"),
                {"s": source_name},
            )
            if deleted.rowcount:
                logger.info("  Cleared %d existing chunks", deleted.rowcount)

            # Find all markdown/text files
            files = sorted(
                list(source_dir.rglob("*.md")) + list(source_dir.rglob("*.txt"))
            )
            # Skip manifest/progress files
            files = [f for f in files if f.name not in ("_progress.json", "_source.json", "manifest.json")]

            source_chunks = 0
            source_embedded = 0

            for filepath in files:
                content = filepath.read_text(encoding="utf-8", errors="replace")
                # Strip NUL bytes (binary files saved as .md)
                content = content.replace("\x00", "")
                # Skip files that look like binary (PDF, etc.)
                if "%PDF-" in content[:100] or len(content) > 500_000:
                    logger.info("  %s: skipped (binary/oversized)", filepath.name)
                    continue
                # Strip HTML comments
                content = re.sub(r"<!--.*?-->", "", content, flags=re.DOTALL)
                # Strip PDF-extraction artifacts (control chars, page footers,
                # repeated flowchart fragments) before chunking.
                content = _clean_text(content)

                rel_path = str(filepath.relative_to(source_dir))
                chunks = _chunk_by_headings(content, source_name, rel_path)

                for chunk in chunks:
                    embedding = _embed(chunk["content"])

                    embedding_json = json.dumps(embedding) if embedding else None
                    session.execute(INSERT_SQL, {
                        "id": str(uuid.uuid4()),
                        "source": chunk["source"],
                        "document": chunk["document"],
                        "section": chunk["section"],
                        "content": chunk["content"],
                        "embedding": embedding_json,
                        "embedding_vec": (
                            "[" + ",".join(map(str, embedding)) + "]"
                            if embedding else None
                        ),
                    })
                    source_chunks += 1
                    if embedding:
                        source_embedded += 1

                if chunks:
                    logger.info("  %s: %d chunks", rel_path, len(chunks))

            session.commit()
            total_chunks += source_chunks
            total_embedded += source_embedded
            logger.info("  Total: %d chunks (%d embedded)", source_chunks, source_embedded)

    elapsed = time.time() - start_time
    logger.info(
        "\nDone: %d chunks (%d embedded) across %d sources in %.1fs",
        total_chunks, total_embedded, len(source_dirs), elapsed,
    )
    if total_embedded < total_chunks:
        logger.warning(
            "%d chunks failed embedding — they will not appear in search results",
            total_chunks - total_embedded,
        )


def main():
    parser = argparse.ArgumentParser(
        description="Chunk and embed the Madrona playbooks for RAG retrieval.",
    )
    parser.add_argument(
        "--source", nargs="*",
        help="Limit to specific sources (e.g. --source playbook)",
    )
    parser.add_argument(
        "--db-url",
        default="postgresql+psycopg://madrona:madrona@localhost:5432/madrona",
        help="Database URL (default: postgresql+psycopg://madrona:madrona@localhost:5432/madrona)",
    )
    args = parser.parse_args()
    ingest(args.db_url, args.source)


if __name__ == "__main__":
    main()
