"""
Face search service using InsightFace.

Detects faces in images, generates ArcFace embeddings,
and stores them in MediaEmbedding table for search.
"""

import io
import logging
from typing import Any
from uuid import UUID

import numpy as np

from app.database import current_session

logger = logging.getLogger(__name__)

# Module-level model cache
_face_app = None


def _load_face_model():
    """Load InsightFace model once per worker."""
    global _face_app

    if _face_app is not None:
        return

    from insightface.app import FaceAnalysis

    _face_app = FaceAnalysis(
        name="buffalo_l",
        providers=["CPUExecutionProvider"],
    )
    _face_app.prepare(ctx_id=0, det_size=(640, 640))
    logger.info("InsightFace model loaded")


def detect_and_embed(image_bytes: bytes) -> list[dict[str, Any]]:
    """
    Detect faces in an image and generate embeddings.

    Args:
        image_bytes: Raw image file bytes

    Returns:
        List of dicts with face bbox and embedding
    """
    from PIL import Image

    _load_face_model()

    image = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img_array = np.array(image)

    faces = _face_app.get(img_array)

    results = []
    for face in faces:
        embedding = face.embedding
        # Normalize
        embedding = embedding / np.linalg.norm(embedding)

        results.append({
            "bbox": face.bbox.tolist(),
            "embedding": embedding.astype(np.float32),
            "det_score": float(face.det_score),
        })

    return results


def store_face_embeddings(
    media_id: UUID,
    organization_id: UUID,
    faces: list[dict],
) -> int:
    """
    Store face embeddings for a media item.

    For simplicity, stores the first detected face as the
    primary face embedding. Multiple faces per image can be
    stored as separate records with unique identifiers.

    Returns:
        Number of faces stored
    """
    from app.models import MediaEmbedding

    stored = 0
    for i, face in enumerate(faces):
        embedding_type = "face" if i == 0 else f"face_{i}"

        existing = current_session().query(MediaEmbedding).filter_by(
            media_id=media_id,
            embedding_type=embedding_type,
        ).first()

        embedding_list = face["embedding"].tolist()

        if existing:
            existing.embedding_data = embedding_list
            existing.model_name = "insightface-arcface"
        else:
            record = MediaEmbedding(
                media_id=media_id,
                organization_id=organization_id,
                embedding_type=embedding_type,
                model_name="insightface-arcface",
                embedding_data=embedding_list,
            )
            current_session().add(record)

        stored += 1

    current_session().commit()
    return stored


def search_by_face(
    organization_id: UUID,
    face_embedding: np.ndarray,
    top_k: int = 20,
    threshold: float = 0.5,
) -> list[dict[str, Any]]:
    """
    Search for media containing a specific face.

    Args:
        organization_id: Org scope
        face_embedding: Query face embedding
        top_k: Max results
        threshold: Minimum cosine similarity

    Returns:
        List of {media_id, similarity} dicts
    """
    from app.models import MediaEmbedding

    records = current_session().query(MediaEmbedding).filter(
        MediaEmbedding.organization_id == organization_id,
        MediaEmbedding.embedding_type.like("face%"),
        MediaEmbedding.embedding_data.isnot(None),
    ).all()

    query_vec = face_embedding.flatten()
    results = []

    for record in records:
        if not record.embedding_data:
            continue
        stored_vec = np.array(record.embedding_data, dtype=np.float32)
        similarity = float(np.dot(query_vec, stored_vec))
        if similarity >= threshold:
            results.append({
                "media_id": str(record.media_id),
                "similarity": round(similarity, 4),
            })

    results.sort(key=lambda x: x["similarity"], reverse=True)
    return results[:top_k]
