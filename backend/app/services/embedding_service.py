"""
Semantic embedding service for collection search and Guide RAG.

Two providers, selected by ``EMBEDDING_PROVIDER``:

- ``voyage`` — Voyage AI hosted API (remote). Use in staging/prod. Models such
  as ``voyage-3.5`` are multilingual and emit configurable Matryoshka
  dimensions (256/512/1024/2048).
- ``ollama`` — local Ollama nomic-embed-text-v2-moe (768-dim). Dev only;
  unreachable in deployed environments.

Both providers use the task-prefix / input-type convention:
``search_document`` for indexing, ``search_query`` for queries.

Gracefully degrades — returns ``None`` on any failure so callers (BM25 search,
RAG tools) can continue without semantic results.
"""

import logging
import time
from typing import Optional

import requests

from app.config import get_settings

logger = logging.getLogger(__name__)

VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings"

# Cache the availability check briefly to avoid hammering the provider
_available: Optional[bool] = None
_available_checked_at: float = 0

# Map our task names to Voyage input_type values
_VOYAGE_INPUT_TYPE = {
    "search_document": "document",
    "search_query": "query",
}


def get_embedding(text: str, task: str = "search_document") -> Optional[list[float]]:
    """
    Generate a single text embedding.

    Args:
        text: The text to embed (truncated to provider limits).
        task: "search_document" (indexing) or "search_query" (queries).

    Returns:
        A float list of length ``semantic_search_dimensions``, or ``None`` on
        any failure / when semantic search is disabled.
    """
    settings = get_settings()
    if not settings.semantic_search_enabled:
        return None
    if not text or not text.strip():
        return None

    if settings.embedding_provider == "voyage":
        results = _embed_voyage([text], task, settings)
        return results[0] if results else None
    return _embed_ollama(text, task, settings)


def get_embeddings_batch(
    texts: list[str], task: str = "search_document"
) -> list[Optional[list[float]]]:
    """
    Embed many texts at once. Returns a list aligned with ``texts`` (``None``
    for any that fail / when disabled).

    Voyage embeds the whole batch in one request. Ollama has no batch endpoint,
    so it falls back to sequential single calls.
    """
    settings = get_settings()
    if not settings.semantic_search_enabled or not texts:
        return [None] * len(texts)

    if settings.embedding_provider == "voyage":
        vectors = _embed_voyage(texts, task, settings)
        if vectors is None:
            return [None] * len(texts)
        return list(vectors)
    return [_embed_ollama(t, task, settings) for t in texts]


# ---- Voyage -----------------------------------------------------------------


def _embed_voyage(
    texts: list[str], task: str, settings
) -> Optional[list[list[float]]]:
    """Embed a batch via the Voyage REST API. Returns vectors or None."""
    if not settings.voyage_api_key:
        logger.warning("EMBEDDING_PROVIDER=voyage but VOYAGE_API_KEY is empty")
        return None

    input_type = _VOYAGE_INPUT_TYPE.get(task, "document")
    # voyage-3.x accepts ~32k tokens/input; cap chars generously as a guard.
    cleaned = [t[:32000] for t in texts]

    try:
        response = requests.post(
            VOYAGE_API_URL,
            headers={
                "Authorization": f"Bearer {settings.voyage_api_key}",
                "Content-Type": "application/json",
            },
            json={
                "input": cleaned,
                "model": settings.voyage_model,
                "input_type": input_type,
                "output_dimension": settings.semantic_search_dimensions,
            },
            timeout=30,
        )
        response.raise_for_status()
        data = response.json()
        # Voyage returns {"data": [{"embedding": [...], "index": i}, ...]}
        rows = sorted(data.get("data", []), key=lambda r: r.get("index", 0))
        vectors = [r.get("embedding") for r in rows]
        if len(vectors) != len(cleaned):
            logger.warning(
                "Voyage returned %d embeddings for %d inputs",
                len(vectors),
                len(cleaned),
            )
            return None
        expected = settings.semantic_search_dimensions
        for vec in vectors:
            if not vec or len(vec) != expected:
                logger.warning(
                    "Voyage embedding dimension mismatch: got %d, expected %d",
                    len(vec) if vec else 0,
                    expected,
                )
                return None
        return vectors
    except Exception as e:
        logger.warning("Voyage embedding failed: %s", e)
        return None


# ---- Ollama (local dev) -----------------------------------------------------


def _embed_ollama(text: str, task: str, settings) -> Optional[list[float]]:
    """Embed a single text via local Ollama. Returns a vector or None."""
    # Nomic v2 MoE caps at 512 tokens. Fallback truncation (1200 → 800 → 500)
    # handles dense tabular content and CJK-heavy text that tokenizes beyond
    # the limit at larger sizes.
    for char_limit in (1200, 800, 500):
        try:
            response = requests.post(
                f"{settings.ollama_base_url}/api/embeddings",
                json={
                    "model": settings.semantic_search_model,
                    "prompt": f"{task}: {text[:char_limit]}",
                },
                timeout=30,
            )
            if response.status_code == 500 and "exceeds the context length" in response.text:
                continue  # try shorter truncation
            response.raise_for_status()
            data = response.json()
            embedding = data.get("embedding")
            if embedding and len(embedding) == settings.semantic_search_dimensions:
                return embedding
            logger.warning(
                "Unexpected embedding dimensions: got %d, expected %d",
                len(embedding) if embedding else 0,
                settings.semantic_search_dimensions,
            )
            return None
        except Exception as e:
            logger.warning("Embedding generation failed: %s", e)
            return None
    return None


def is_embedding_service_available() -> bool:
    """
    Check whether the configured embedding provider is usable.

    Caches the result for 30 seconds.
    """
    global _available, _available_checked_at

    now = time.time()
    if _available is not None and (now - _available_checked_at) < 30:
        return _available

    settings = get_settings()
    if not settings.semantic_search_enabled:
        _available = False
        _available_checked_at = now
        return False

    if settings.embedding_provider == "voyage":
        # A key is the practical gate; avoid a billable ping on every check.
        _available = bool(settings.voyage_api_key)
        _available_checked_at = now
        if not _available:
            logger.debug("Voyage selected but VOYAGE_API_KEY is empty")
        return _available

    # Ollama: confirm the model is loaded.
    try:
        response = requests.get(f"{settings.ollama_base_url}/api/tags", timeout=5)
        response.raise_for_status()
        models = response.json().get("models", [])
        model_names = [m.get("name", "").split(":")[0] for m in models]
        _available = settings.semantic_search_model in model_names
        _available_checked_at = now
        if not _available:
            logger.debug(
                "Semantic search model '%s' not found in Ollama (available: %s)",
                settings.semantic_search_model,
                model_names,
            )
        return _available
    except Exception as e:
        logger.debug("Ollama not reachable for semantic search: %s", e)
        _available = False
        _available_checked_at = now
        return False
