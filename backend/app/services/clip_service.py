"""
CLIP visual search and similarity service.

Provides:
- Image embedding generation via CLIP ViT-B/32
- Text embedding for natural language search
- Cosine similarity queries via pgvector
- Duplicate detection
- Hybrid search (CLIP + OpenSearch) via reciprocal rank fusion
"""

import logging
from typing import Any
from uuid import UUID

import numpy as np

from app.config import get_settings
from app.database import current_session

logger = logging.getLogger(__name__)

# Module-level model cache (loaded once per worker)
_clip_model = None
_clip_preprocess = None
_clip_device = None


def _load_clip_model():
    """Load CLIP model once per worker process."""
    global _clip_model, _clip_preprocess, _clip_device

    if _clip_model is not None:
        return

    settings = get_settings()
    if not settings.clip_enabled:
        raise RuntimeError("CLIP is not enabled. Set CLIP_ENABLED=true.")

    import torch
    import clip

    device = settings.clip_device
    if device == "cuda" and not torch.cuda.is_available():
        logger.warning("CUDA requested but not available, falling back to CPU")
        device = "cpu"

    _clip_device = device
    _clip_model, _clip_preprocess = clip.load(settings.clip_model_name, device=device)
    logger.info("CLIP model %s loaded on %s", settings.clip_model_name, device)


def encode_image(image_bytes: bytes) -> np.ndarray:
    """
    Generate a CLIP embedding for an image.

    Args:
        image_bytes: Raw image file bytes

    Returns:
        Normalized 512-dim float32 numpy array
    """
    import io
    import torch
    from PIL import Image

    _load_clip_model()

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    image_input = _clip_preprocess(image).unsqueeze(0).to(_clip_device)

    with torch.no_grad():
        embedding = _clip_model.encode_image(image_input)

    # Normalize to unit vector for cosine similarity
    embedding = embedding.cpu().numpy().flatten()
    embedding = embedding / np.linalg.norm(embedding)
    return embedding.astype(np.float32)


def encode_text(text: str) -> np.ndarray:
    """
    Generate a CLIP embedding for a text query.

    Args:
        text: Natural language description

    Returns:
        Normalized 512-dim float32 numpy array
    """
    import torch
    import clip

    _load_clip_model()

    text_input = clip.tokenize([text]).to(_clip_device)

    with torch.no_grad():
        embedding = _clip_model.encode_text(text_input)

    embedding = embedding.cpu().numpy().flatten()
    embedding = embedding / np.linalg.norm(embedding)
    return embedding.astype(np.float32)


def store_embedding(
    media_id: UUID,
    organization_id: UUID,
    embedding: np.ndarray,
    embedding_type: str = "clip_image",
    model_name: str | None = None,
    source_derivative: str | None = None,
) -> None:
    """
    Store a vector embedding for a media item.

    Uses upsert semantics (replace if exists for same media_id + embedding_type).
    """
    from app.models import MediaEmbedding

    settings = get_settings()
    if model_name is None:
        model_name = settings.clip_model_name

    # Check for existing embedding
    existing = current_session().query(MediaEmbedding).filter_by(
        media_id=media_id,
        embedding_type=embedding_type,
    ).first()

    embedding_list = embedding.tolist()

    if existing:
        existing.embedding_data = embedding_list
        existing.embedding_vector = embedding_list
        existing.model_name = model_name
        existing.source_derivative = source_derivative
    else:
        record = MediaEmbedding(
            media_id=media_id,
            organization_id=organization_id,
            embedding_type=embedding_type,
            model_name=model_name,
            embedding_data=embedding_list,
            embedding_vector=embedding_list,
            source_derivative=source_derivative,
        )
        current_session().add(record)

    current_session().commit()


def find_similar(
    organization_id: UUID,
    embedding: np.ndarray,
    top_k: int = 10,
    threshold: float = 0.7,
    exclude_media_id: UUID | None = None,
    embedding_type: str = "clip_image",
    db: Any = None,
) -> list[dict[str, Any]]:
    """
    Find media items with similar embeddings using pgvector cosine distance.

    Uses the IVFFlat index on embedding_vector for approximate nearest neighbor
    search. Falls back to in-memory scan if embedding_vector is not populated.

    Args:
        organization_id: Org scope
        embedding: Query embedding vector (normalized)
        top_k: Max results
        threshold: Minimum cosine similarity (0-1)
        exclude_media_id: Media ID to exclude (e.g. the query image itself)
        embedding_type: Type of embeddings to search

    Returns:
        List of {media_id, similarity} dicts sorted by descending similarity
    """
    from sqlalchemy import text
    from app.models import MediaEmbedding

    session = db or current_session()
    query_vec_str = str(embedding.flatten().tolist())

    # Try pgvector native search first (cosine distance: 1 - similarity)
    # Use CAST() instead of ::vector to avoid SQLAlchemy param syntax conflicts
    exclude_clause = "AND media_id != :exclude_id" if exclude_media_id else ""
    sql = text(f"""
        SELECT media_id, 1 - (embedding_vector <=> CAST(:query_vec AS vector)) AS similarity
        FROM media.media_embeddings
        WHERE organization_id = :org_id
          AND embedding_type = :embedding_type
          AND embedding_vector IS NOT NULL
          AND (1 - (embedding_vector <=> CAST(:query_vec AS vector))) >= :threshold
          {exclude_clause}
        ORDER BY embedding_vector <=> CAST(:query_vec AS vector)
        LIMIT :top_k
    """)

    params: dict[str, Any] = {
        "org_id": str(organization_id),
        "embedding_type": embedding_type,
        "query_vec": query_vec_str,
        "threshold": threshold,
        "top_k": top_k,
    }
    if exclude_media_id:
        params["exclude_id"] = str(exclude_media_id)

    rows = session.execute(sql, params).fetchall()

    if rows:
        return [
            {"media_id": str(row[0]), "similarity": round(float(row[1]), 4)}
            for row in rows
        ]

    # Fallback: in-memory scan using legacy JSONB column
    logger.warning("pgvector column empty, falling back to in-memory similarity scan")
    query = session.query(MediaEmbedding).filter(
        MediaEmbedding.organization_id == organization_id,
        MediaEmbedding.embedding_type == embedding_type,
        MediaEmbedding.embedding_data.isnot(None),
    )
    if exclude_media_id:
        query = query.filter(MediaEmbedding.media_id != exclude_media_id)

    records = query.all()
    if not records:
        return []

    query_arr = embedding.flatten()
    results = []
    for record in records:
        if not record.embedding_data:
            continue
        stored_vec = np.array(record.embedding_data, dtype=np.float32)
        similarity = float(np.dot(query_arr, stored_vec))
        if similarity >= threshold:
            results.append({
                "media_id": str(record.media_id),
                "similarity": round(similarity, 4),
            })

    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results[:top_k]


def find_duplicates(
    organization_id: UUID,
    threshold: float = 0.95,
    session=None,
) -> list[dict[str, Any]]:
    """
    Find potential duplicate media items based on high embedding similarity.

    Args:
        organization_id: Org scope
        threshold: Minimum similarity to consider a duplicate (default 0.95)

    Returns:
        List of {media_id_a, media_id_b, similarity} dicts
    """
    from app.models import MediaEmbedding

    # Explicit session: the implicit context one is bound by Celery's
    # get_session(), not on a request path, so calling this from a router
    # raised RuntimeError on every request.
    session = session or current_session()
    records = session.query(MediaEmbedding).filter(
        MediaEmbedding.organization_id == organization_id,
        MediaEmbedding.embedding_type == "clip_image",
        MediaEmbedding.embedding_data.isnot(None),
    ).all()

    if len(records) < 2:
        return []

    # Build matrix and compute pairwise similarities
    vectors = []
    media_ids = []
    for r in records:
        if r.embedding_data:
            vectors.append(np.array(r.embedding_data, dtype=np.float32))
            media_ids.append(str(r.media_id))

    if len(vectors) < 2:
        return []

    matrix = np.stack(vectors)
    # Cosine similarity matrix (vectors are already normalized)
    sim_matrix = matrix @ matrix.T

    duplicates = []
    seen = set()
    for i in range(len(media_ids)):
        for j in range(i + 1, len(media_ids)):
            sim = float(sim_matrix[i, j])
            if sim >= threshold:
                pair_key = tuple(sorted([media_ids[i], media_ids[j]]))
                if pair_key not in seen:
                    seen.add(pair_key)
                    duplicates.append({
                        "media_id_a": media_ids[i],
                        "media_id_b": media_ids[j],
                        "similarity": round(sim, 4),
                    })

    duplicates.sort(key=lambda x: x["similarity"], reverse=True)
    return duplicates


def hybrid_search(
    organization_id: UUID,
    text_query: str,
    opensearch_results: list[dict[str, Any]],
    top_k: int = 20,
    clip_weight: float = 0.4,
    text_weight: float = 0.6,
) -> list[dict[str, Any]]:
    """
    Merge CLIP vector results with OpenSearch text results via Reciprocal Rank Fusion.

    Args:
        organization_id: Org scope
        text_query: The natural language query
        opensearch_results: Results from OpenSearch (list of {media_id, score})
        top_k: Max results to return
        clip_weight: Weight for CLIP ranking (0-1)
        text_weight: Weight for text ranking (0-1)

    Returns:
        Merged and re-ranked list of {media_id, rrf_score}
    """
    k = 60  # RRF constant

    # Get CLIP text embedding and find similar
    try:
        text_embedding = encode_text(text_query)
        clip_results = find_similar(
            organization_id=organization_id,
            embedding=text_embedding,
            top_k=top_k * 2,
            threshold=0.15,  # Low threshold for RRF merging
            embedding_type="clip_image",
        )
    except Exception as e:
        logger.warning("CLIP search failed, falling back to text-only: %s", e)
        clip_results = []

    # Build RRF scores
    rrf_scores: dict[str, float] = {}

    # CLIP results
    for rank, result in enumerate(clip_results):
        mid = result["media_id"]
        rrf_scores[mid] = rrf_scores.get(mid, 0) + clip_weight / (k + rank + 1)

    # OpenSearch results
    for rank, result in enumerate(opensearch_results):
        mid = result.get("media_id", "")
        rrf_scores[mid] = rrf_scores.get(mid, 0) + text_weight / (k + rank + 1)

    # Sort by RRF score
    merged = [
        {"media_id": mid, "rrf_score": round(score, 6)}
        for mid, score in rrf_scores.items()
    ]
    merged.sort(key=lambda x: x["rrf_score"], reverse=True)
    return merged[:top_k]
