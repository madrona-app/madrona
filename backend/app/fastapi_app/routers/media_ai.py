"""
Media AI Tagging, CLIP Visual Search, Whisper Transcription, and Alternatives API (FastAPI).

Phase 9g — 23 routes:
  - Configuration (2 routes): get/update AI config
  - Tag Mappings CRUD (4 routes): list, create, update, delete
  - Per-Media AI Tags (4 routes): list, reprocess, update status, delete
  - Bulk Operations (4 routes): suggestions, bulk-reprocess, reapply-mappings, stats
  - CLIP Visual Search (4 routes): similar, visual search, duplicates, bulk-generate
  - Whisper Transcription (3 routes): transcribe, get transcript, bulk-transcribe
  - Alternatives (2 routes): list alternatives, download alternative

Migrated from app/api/media_ai.py.
"""

import logging
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    Media,
    MediaAIConfig,
    MediaAITag,
    MediaAITagMapping,
    MediaAlternative,
    MediaEmbedding,
    MediaTagDefinition,
)
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.media_ai import (
    AIConfigResponse,
    AITaggingStatsResponse,
    AITagMappingCreatedResponse,
    AITagMappingListResponse,
    AITagMappingUpdatedResponse,
    AITagSuggestionsResponse,
    AITaskQueuedResponse,
    AITagUpdatedResponse,
    AlternativeDownloadResponse,
    BulkReprocessResponse,
    DuplicatesResponse,
    MediaAITagsResponse,
    MediaAlternativesResponse,
    SimilarMediaResponse,
    TranscriptResponse,
    VisualSearchResponse,
)
from app.permissions import Permission

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-ai"])


# ============================================================================
# SERIALIZERS
# ============================================================================


def _serialize_config(config: MediaAIConfig) -> dict:
    return {
        "config_id": str(config.config_id),
        "organization_id": str(config.organization_id),
        "auto_tag_on_upload": config.auto_tag_on_upload,
        "detect_labels": config.detect_labels,
        "detect_text": config.detect_text,
        "detect_faces": config.detect_faces,
        "detect_celebrities": config.detect_celebrities,
        "detect_moderation": config.detect_moderation,
        "extract_pdf_text": config.extract_pdf_text,
        "min_label_confidence": str(config.min_label_confidence),
        "min_text_confidence": str(config.min_text_confidence),
        "max_labels_per_image": config.max_labels_per_image,
        "monthly_budget_usd": str(config.monthly_budget_usd) if config.monthly_budget_usd else None,
        "current_month_usage": str(config.current_month_usage),
        "usage_reset_date": config.usage_reset_date.isoformat() if config.usage_reset_date else None,
        "created_at": config.created_at.isoformat() if config.created_at else None,
        "updated_at": config.updated_at.isoformat() if config.updated_at else None,
    }


def _serialize_mapping(mapping: MediaAITagMapping) -> dict:
    return {
        "mapping_id": str(mapping.mapping_id),
        "organization_id": str(mapping.organization_id),
        "ai_tag_type": mapping.ai_tag_type,
        "ai_tag_value": mapping.ai_tag_value,
        "definition_id": str(mapping.definition_id),
        "definition": {
            "definition_id": str(mapping.definition.definition_id),
            "tag_key": mapping.definition.tag_key,
            "display_name": mapping.definition.display_name,
        } if mapping.definition else None,
        "mapped_value": mapping.mapped_value,
        "auto_apply": mapping.auto_apply,
        "min_confidence": str(mapping.min_confidence),
        "created_at": mapping.created_at.isoformat() if mapping.created_at else None,
    }


def _serialize_ai_tag(tag: MediaAITag) -> dict:
    return {
        "ai_tag_id": str(tag.ai_tag_id),
        "media_id": str(tag.media_id),
        "tag_type": tag.tag_type,
        "tag_value": tag.tag_value,
        "confidence": str(tag.confidence),
        "metadata": tag.tag_metadata,
        "bbox": {
            "left": str(tag.bbox_left),
            "top": str(tag.bbox_top),
            "width": str(tag.bbox_width),
            "height": str(tag.bbox_height),
        } if tag.bbox_left is not None else None,
        "provider": tag.provider,
        "model_version": tag.model_version,
        "processed_at": tag.processed_at.isoformat() if tag.processed_at else None,
        "mapped_to_definition_id": str(tag.mapped_to_definition_id) if tag.mapped_to_definition_id else None,
        "mapping_status": tag.mapping_status,
    }


# ============================================================================
# HELPERS
# ============================================================================


def _get_media_or_404(db: Session, org_id: UUID, media_id: UUID) -> Media:
    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")
    return media


# ============================================================================
# CONFIGURATION ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/ai-config", response_model=AIConfigResponse, summary="Get ai config")
def get_ai_config(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get ai config (read-only — any media viewer can fetch thresholds)."""
    config = db.query(MediaAIConfig).filter_by(
        organization_id=org_id
    ).first()

    from app.models import Organization
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    org_ai = (org.media_ai_config or {}) if org else {}

    if not config:
        return {
            "config": {
                "config_id": None,
                "organization_id": str(org_id),
                "auto_tag_on_upload": True,
                "detect_labels": True,
                "detect_text": True,
                "detect_faces": False,
                "detect_celebrities": False,
                "detect_moderation": False,
                "extract_pdf_text": True,
                "min_label_confidence": "0.70",
                "min_text_confidence": "0.80",
                "max_labels_per_image": 50,
                "monthly_budget_usd": None,
                "current_month_usage": "0.0000",
                "usage_reset_date": None,
                "visual_search_threshold": org_ai.get("visual_search_threshold", 0.20),
                "created_at": None,
                "updated_at": None,
            }
        }

    result = _serialize_config(config)
    result["visual_search_threshold"] = org_ai.get("visual_search_threshold", 0.20)
    return {"config": result}


@router.put("/api/organizations/{org_id}/media/ai-config", response_model=AIConfigResponse, summary="Update ai config")
def update_ai_config(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Update ai config."""
    config = db.query(MediaAIConfig).filter_by(
        organization_id=org_id
    ).first()

    if not config:
        config = MediaAIConfig(organization_id=org_id)
        db.add(config)

    if "auto_tag_on_upload" in body:
        config.auto_tag_on_upload = body["auto_tag_on_upload"]
    if "detect_labels" in body:
        config.detect_labels = body["detect_labels"]
    if "detect_text" in body:
        config.detect_text = body["detect_text"]
    if "detect_faces" in body:
        config.detect_faces = body["detect_faces"]
    if "detect_celebrities" in body:
        config.detect_celebrities = body["detect_celebrities"]
    if "detect_moderation" in body:
        config.detect_moderation = body["detect_moderation"]
    if "extract_pdf_text" in body:
        config.extract_pdf_text = body["extract_pdf_text"]
    if "min_label_confidence" in body:
        config.min_label_confidence = Decimal(str(body["min_label_confidence"]))
    if "min_text_confidence" in body:
        config.min_text_confidence = Decimal(str(body["min_text_confidence"]))
    if "max_labels_per_image" in body:
        config.max_labels_per_image = body["max_labels_per_image"]
    if "monthly_budget_usd" in body:
        config.monthly_budget_usd = (
            Decimal(str(body["monthly_budget_usd"]))
            if body["monthly_budget_usd"] is not None
            else None
        )

    config.updated_by = auth.user_id

    # visual_search_threshold lives on the org's media_ai_config JSONB
    from app.models import Organization
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    if "visual_search_threshold" in body and org:
        ai_config = dict(org.media_ai_config or {})
        ai_config["visual_search_threshold"] = max(0.0, min(1.0, float(body["visual_search_threshold"])))
        org.media_ai_config = ai_config

    db.commit()

    org_ai = (org.media_ai_config or {}) if org else {}
    result = _serialize_config(config)
    result["visual_search_threshold"] = org_ai.get("visual_search_threshold", 0.20)
    return {"config": result}


# ============================================================================
# TAG MAPPING ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/ai-mappings", response_model=AITagMappingListResponse, summary="List ai mappings")
def list_ai_mappings(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """List ai mappings."""
    query = (
        select(MediaAITagMapping)
        .options(joinedload(MediaAITagMapping.definition))
        .where(MediaAITagMapping.organization_id == org_id)
        .order_by(MediaAITagMapping.ai_tag_type, MediaAITagMapping.ai_tag_value)
    )

    results = db.execute(query).scalars().all()

    return {"mappings": [_serialize_mapping(m) for m in results]}


@router.post("/api/organizations/{org_id}/media/ai-mappings", response_model=AITagMappingCreatedResponse, status_code=201, summary="Create ai mapping")
def create_ai_mapping(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Create ai mapping."""
    required = ["ai_tag_type", "ai_tag_value", "definition_id", "mapped_value"]
    for field in required:
        if field not in body:
            raise HTTPException(status_code=400, detail=f"Missing required field: {field}")

    valid_types = ['label', 'text', 'face', 'color', 'celebrity', 'moderation']
    if body["ai_tag_type"] not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid tag type. Must be one of: {valid_types}")

    definition = db.query(MediaTagDefinition).filter_by(
        definition_id=UUID(body["definition_id"]),
        organization_id=org_id,
    ).first()

    if not definition:
        raise HTTPException(status_code=404, detail="Tag definition not found")

    existing = db.query(MediaAITagMapping).filter_by(
        organization_id=org_id,
        ai_tag_type=body["ai_tag_type"],
        ai_tag_value=body["ai_tag_value"],
    ).first()

    if existing:
        raise HTTPException(status_code=409, detail="Mapping already exists for this AI tag")

    mapping = MediaAITagMapping(
        organization_id=org_id,
        ai_tag_type=body["ai_tag_type"],
        ai_tag_value=body["ai_tag_value"],
        definition_id=UUID(body["definition_id"]),
        mapped_value=body["mapped_value"],
        auto_apply=body.get("auto_apply", True),
        min_confidence=Decimal(str(body.get("min_confidence", "0.80"))),
        created_by=auth.user_id,
    )

    db.add(mapping)
    db.commit()
    db.refresh(mapping)

    return {"mapping": _serialize_mapping(mapping)}


@router.put("/api/organizations/{org_id}/media/ai-mappings/{mapping_id}", response_model=AITagMappingUpdatedResponse, summary="Update ai mapping")
def update_ai_mapping(
    org_id: UUID,
    mapping_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Update ai mapping."""
    mapping = db.query(MediaAITagMapping).filter_by(
        mapping_id=mapping_id,
        organization_id=org_id,
    ).first()

    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")

    if "mapped_value" in body:
        mapping.mapped_value = body["mapped_value"]
    if "auto_apply" in body:
        mapping.auto_apply = body["auto_apply"]
    if "min_confidence" in body:
        mapping.min_confidence = Decimal(str(body["min_confidence"]))

    db.commit()

    return {"mapping": _serialize_mapping(mapping)}


@router.delete("/api/organizations/{org_id}/media/ai-mappings/{mapping_id}", response_model=SuccessResponse, summary="Delete ai mapping")
def delete_ai_mapping(
    org_id: UUID,
    mapping_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Delete ai mapping."""
    mapping = db.query(MediaAITagMapping).filter_by(
        mapping_id=mapping_id,
        organization_id=org_id,
    ).first()

    if not mapping:
        raise HTTPException(status_code=404, detail="Mapping not found")

    db.delete(mapping)
    db.commit()

    return {"success": True}


# ============================================================================
# PER-MEDIA AI TAGS ENDPOINTS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/ai-tags", response_model=MediaAITagsResponse, summary="Get media ai tags")
def get_media_ai_tags(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get media ai tags."""
    media = _get_media_or_404(db, org_id, media_id)

    query = (
        select(MediaAITag)
        .where(MediaAITag.media_id == media_id)
        .order_by(MediaAITag.confidence.desc())
    )

    tags = db.execute(query).scalars().all()

    return {
        "media_id": str(media_id),
        "ai_processing_status": media.ai_processing_status,
        "ai_processed_at": media.ai_processed_at.isoformat() if media.ai_processed_at else None,
        "ai_tags": [_serialize_ai_tag(t) for t in tags],
    }


@router.post("/api/organizations/{org_id}/media/{media_id}/ai-tags/reprocess", response_model=AITaskQueuedResponse, summary="Reprocess ai tags")
def reprocess_ai_tags(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Reprocess ai tags."""
    from app.tasks.ai_tagging import process_media_ai_tags

    media = _get_media_or_404(db, org_id, media_id)

    task = process_media_ai_tags.delay(str(media_id), str(org_id), force=True)

    return {
        "success": True,
        "task_id": task.id,
        "message": "AI tagging queued for reprocessing",
    }


@router.patch("/api/organizations/{org_id}/media/{media_id}/ai-tags/{ai_tag_id}", response_model=AITagUpdatedResponse, summary="Update ai tag status")
def update_ai_tag_status(
    org_id: UUID,
    media_id: UUID,
    ai_tag_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update ai tag status."""
    ai_tag = db.query(MediaAITag).filter_by(
        ai_tag_id=ai_tag_id,
        media_id=media_id,
        organization_id=org_id,
    ).first()

    if not ai_tag:
        raise HTTPException(status_code=404, detail="AI tag not found")

    if "mapping_status" in body:
        valid_statuses = ['pending', 'mapped', 'rejected', 'ignored']
        if body["mapping_status"] not in valid_statuses:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid status. Must be one of: {valid_statuses}",
            )
        ai_tag.mapping_status = body["mapping_status"]

    db.commit()

    return {"ai_tag": _serialize_ai_tag(ai_tag)}


@router.delete("/api/organizations/{org_id}/media/{media_id}/ai-tags/{ai_tag_id}", response_model=SuccessResponse, summary="Delete ai tag")
def delete_ai_tag(
    org_id: UUID,
    media_id: UUID,
    ai_tag_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Delete ai tag."""
    ai_tag = db.query(MediaAITag).filter_by(
        ai_tag_id=ai_tag_id,
        media_id=media_id,
        organization_id=org_id,
    ).first()

    if not ai_tag:
        raise HTTPException(status_code=404, detail="AI tag not found")

    db.delete(ai_tag)
    db.commit()

    try:
        media = db.query(Media).filter_by(media_id=media_id).first()
        if media:
            from app.search.media.service import MediaSearchService
            search_service = MediaSearchService()
            if search_service.is_available():
                search_service.index_media(media)
    except Exception:
        pass

    return {"success": True}


# ============================================================================
# BULK OPERATIONS
# ============================================================================


@router.get("/api/organizations/{org_id}/media/ai-tags/suggestions", response_model=AITagSuggestionsResponse, summary="Get unmapped suggestions")
def get_unmapped_suggestions(
    org_id: UUID,
    tag_type: str | None = Query(None),
    min_occurrences: int = Query(2),
    limit: int = Query(50),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Get unmapped suggestions."""
    capped_limit = min(limit, 100)

    query = (
        select(
            MediaAITag.tag_type,
            MediaAITag.tag_value,
            func.count(MediaAITag.ai_tag_id).label('occurrence_count'),
            func.avg(MediaAITag.confidence).label('avg_confidence'),
            func.array_agg(MediaAITag.media_id.distinct()).label('sample_media_ids'),
        )
        .where(MediaAITag.organization_id == org_id)
        .where(MediaAITag.mapping_status == 'pending')
    )

    if tag_type:
        query = query.where(MediaAITag.tag_type == tag_type)

    query = (
        query.group_by(MediaAITag.tag_type, MediaAITag.tag_value)
        .having(func.count(MediaAITag.ai_tag_id) >= min_occurrences)
        .order_by(func.count(MediaAITag.ai_tag_id).desc())
        .limit(capped_limit)
    )

    results = db.execute(query).all()

    suggestions = []
    for row in results:
        sample_ids = row.sample_media_ids or []
        suggestions.append({
            "ai_tag_type": row.tag_type,
            "ai_tag_value": row.tag_value,
            "occurrence_count": row.occurrence_count,
            "avg_confidence": float(row.avg_confidence) if row.avg_confidence else 0.0,
            "sample_media_ids": [str(mid) for mid in sample_ids[:5]],
        })

    return {"suggestions": suggestions, "total": len(suggestions)}


@router.post("/api/organizations/{org_id}/media/ai-tags/bulk-reprocess", response_model=BulkReprocessResponse, summary="Bulk reprocess")
def bulk_reprocess(
    org_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Bulk reprocess."""
    from app.tasks.ai_tagging import bulk_process_ai_tags

    data = body or {}

    status_filter = data.get("status_filter")
    limit = data.get("limit")

    query = db.query(func.count(Media.media_id)).filter(
        Media.organization_id == org_id
    )

    if status_filter:
        query = query.filter(Media.ai_processing_status == status_filter)
    else:
        query = query.filter(
            (Media.ai_processing_status.is_(None)) |
            (Media.ai_processing_status == 'pending') |
            (Media.ai_processing_status == 'failed')
        )

    total_count = query.scalar() or 0
    queued_count = min(total_count, limit) if limit else total_count

    task = bulk_process_ai_tags.delay(
        organization_id=str(org_id),
        media_ids=data.get("media_ids"),
        media_type=data.get("media_type"),
        status_filter=status_filter,
        force=data.get("force", False),
        limit=limit,
    )

    return {
        "success": True,
        "task_id": task.id,
        "queued_count": queued_count,
        "message": f"Queued {queued_count} items for AI tagging",
    }


@router.post("/api/organizations/{org_id}/media/ai-tags/reapply-mappings", response_model=AITaskQueuedResponse, summary="Reapply mappings")
def reapply_mappings(
    org_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Reapply mappings."""
    from app.tasks.ai_tagging import reapply_ai_tag_mappings

    data = body or {}

    task = reapply_ai_tag_mappings.delay(
        organization_id=str(org_id),
        mapping_id=data.get("mapping_id"),
    )

    return {
        "success": True,
        "task_id": task.id,
        "message": "Mapping reapplication queued",
    }


@router.get("/api/organizations/{org_id}/media/ai-tags/stats", response_model=AITaggingStatsResponse, summary="Get ai tagging stats")
def get_ai_tagging_stats(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get ai tagging stats."""
    status_counts = db.query(
        Media.ai_processing_status,
        func.count(Media.media_id),
    ).filter(
        Media.organization_id == org_id,
    ).group_by(Media.ai_processing_status).all()

    status_dict = {(status or "unprocessed"): count for status, count in status_counts}
    total_media = sum(status_dict.values())

    tag_type_counts = db.query(
        MediaAITag.tag_type,
        func.count(MediaAITag.ai_tag_id),
    ).filter(
        MediaAITag.organization_id == org_id,
    ).group_by(MediaAITag.tag_type).all()

    tags_by_type = {tag_type: count for tag_type, count in tag_type_counts}
    total_ai_tags = sum(tags_by_type.values())

    unmapped_count = db.query(func.count(MediaAITag.ai_tag_id)).filter(
        MediaAITag.organization_id == org_id,
        MediaAITag.mapping_status == 'pending',
    ).scalar() or 0

    config = db.query(MediaAIConfig).filter_by(
        organization_id=org_id
    ).first()

    return {
        "total_media": total_media,
        "pending_count": status_dict.get("pending", 0),
        "processing_count": status_dict.get("processing", 0),
        "completed_count": status_dict.get("completed", 0),
        "failed_count": status_dict.get("failed", 0),
        "skipped_count": status_dict.get("skipped", 0),
        "total_ai_tags": total_ai_tags,
        "tags_by_type": tags_by_type,
        "unmapped_tags_count": unmapped_count,
        "monthly_usage_usd": str(config.current_month_usage) if config else "0.0000",
        "monthly_budget_usd": str(config.monthly_budget_usd) if config and config.monthly_budget_usd else None,
    }


# ============================================================================
# CLIP VISUAL SEARCH & SIMILARITY
# ============================================================================


@router.get("/api/organizations/{org_id}/media/similar/{media_id}", response_model=SimilarMediaResponse, summary="Get similar media")
def get_similar_media(
    org_id: UUID,
    media_id: UUID,
    top_k: int = Query(10),
    threshold: float = Query(0.7),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get similar media."""
    embedding_record = db.query(MediaEmbedding).filter_by(
        media_id=media_id,
        embedding_type="clip_image",
    ).first()

    if not embedding_record or not embedding_record.embedding_data:
        return {"media_id": str(media_id), "similar": [], "total": 0}

    import numpy as np
    from app.services.clip_service import find_similar

    query_embedding = np.array(embedding_record.embedding_data, dtype=np.float32)
    results = find_similar(
        organization_id=org_id,
        embedding=query_embedding,
        top_k=top_k,
        threshold=threshold,
        exclude_media_id=media_id,
        db=db,
    )

    if results:
        from app.services.uploads import get_org_media_url
        result_ids = [UUID(r["media_id"]) for r in results]
        media_records = db.query(Media).filter(
            Media.media_id.in_(result_ids)
        ).all()
        media_map = {str(m.media_id): m for m in media_records}

        # Find preview-quality derivatives (small/medium) for sharper grid images
        from app.models.media import MediaDerivative
        derivatives = db.query(MediaDerivative).filter(
            MediaDerivative.media_id.in_(result_ids),
            MediaDerivative.derivative_type.in_(['small', 'medium', 'square_thumb']),
        ).all()
        # Prefer square_thumb > small > medium for grid display
        deriv_map: dict[str, MediaDerivative] = {}
        priority = {'square_thumb': 0, 'small': 1, 'medium': 2}
        for d in derivatives:
            mid = str(d.media_id)
            existing = deriv_map.get(mid)
            if not existing or priority.get(d.derivative_type, 9) < priority.get(existing.derivative_type, 9):
                deriv_map[mid] = d

        for r in results:
            m = media_map.get(r["media_id"])
            if m:
                r["title"] = m.title or m.filename
                # Use derivative for preview, fall back to thumbnail
                deriv = deriv_map.get(r["media_id"])
                if deriv:
                    r["preview_url"] = get_org_media_url(
                        deriv.s3_key,
                        organization_id=str(org_id),
                        db_session=db,
                        expiry_seconds=3600
                    )
                r["thumbnail_url"] = get_org_media_url(
                    m.thumbnail_s3_key,
                    organization_id=str(org_id),
                    db_session=db,
                    expiry_seconds=3600
                ) if m.thumbnail_s3_key else None

    return {"media_id": str(media_id), "similar": results, "total": len(results)}


@router.post("/api/organizations/{org_id}/media/search/visual", response_model=VisualSearchResponse, summary="Visual search")
def visual_search(
    org_id: UUID,
    body: dict,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Visual search."""
    text_query = body.get("text", "").strip()

    if not text_query:
        raise HTTPException(status_code=400, detail="Text query is required")

    from app.services.clip_service import encode_text, find_similar
    from app.config import get_settings
    from app.models import Organization

    # Threshold priority: request body > org config > env var
    org = db.query(Organization).filter_by(organization_id=org_id).first()
    org_threshold = (org.media_ai_config or {}).get("visual_search_threshold") if org else None
    env_threshold = get_settings().clip_visual_search_threshold
    default_threshold = org_threshold if org_threshold is not None else env_threshold

    text_embedding = encode_text(text_query)
    results = find_similar(
        organization_id=org_id,
        embedding=text_embedding,
        top_k=int(body.get("top_k", 20)),
        threshold=float(body.get("threshold", default_threshold)),
        embedding_type="clip_image",
        db=db,
    )

    # Enrich results with thumbnail URLs and titles
    if results:
        from app.services.uploads import get_org_media_url
        from app.models.media import MediaDerivative

        result_ids = [UUID(r["media_id"]) for r in results]
        media_records = db.query(Media).filter(Media.media_id.in_(result_ids)).all()
        media_map = {str(m.media_id): m for m in media_records}

        derivatives = db.query(MediaDerivative).filter(
            MediaDerivative.media_id.in_(result_ids),
            MediaDerivative.derivative_type.in_(['small', 'medium', 'square_thumb']),
        ).all()
        deriv_map: dict[str, MediaDerivative] = {}
        priority = {'square_thumb': 0, 'small': 1, 'medium': 2}
        for d in derivatives:
            mid = str(d.media_id)
            existing = deriv_map.get(mid)
            if not existing or priority.get(d.derivative_type, 9) < priority.get(existing.derivative_type, 9):
                deriv_map[mid] = d

        for r in results:
            m = media_map.get(r["media_id"])
            if m:
                r["title"] = m.title or m.filename
                deriv = deriv_map.get(r["media_id"])
                if deriv:
                    r["preview_url"] = get_org_media_url(
                        deriv.s3_key,
                        organization_id=str(org_id),
                        db_session=db,
                        expiry_seconds=3600,
                    )
                r["thumbnail_url"] = get_org_media_url(
                    m.thumbnail_s3_key,
                    organization_id=str(org_id),
                    db_session=db,
                    expiry_seconds=3600,
                ) if m.thumbnail_s3_key else None

    return {"query": text_query, "results": results, "total": len(results)}


@router.post("/api/organizations/{org_id}/media/duplicates", response_model=DuplicatesResponse, summary="Find duplicates")
def find_duplicates(
    org_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Find duplicates."""
    data = body or {}
    threshold = float(data.get("threshold", 0.95))

    from app.services.clip_service import find_duplicates as clip_find_duplicates

    duplicates = clip_find_duplicates(
        organization_id=org_id,
        threshold=threshold,
        session=db,
    )

    # Enrich with thumbnails and titles
    if duplicates:
        from app.services.uploads import get_org_media_url

        all_ids = set()
        for d in duplicates:
            all_ids.add(UUID(d["media_id_a"]))
            all_ids.add(UUID(d["media_id_b"]))

        media_records = db.query(Media).filter(Media.media_id.in_(list(all_ids))).all()
        media_map = {str(m.media_id): m for m in media_records}

        for d in duplicates:
            for key in ("media_id_a", "media_id_b"):
                m = media_map.get(d[key])
                if m:
                    d[f"{key}_title"] = m.title or m.filename
                    d[f"{key}_thumbnail_url"] = get_org_media_url(
                        m.thumbnail_s3_key,
                        organization_id=str(org_id),
                        db_session=db,
                        expiry_seconds=3600,
                    ) if m.thumbnail_s3_key else None

    return {"duplicates": duplicates, "total": len(duplicates)}


@router.post("/api/organizations/{org_id}/media/clip/bulk-generate", response_model=AITaskQueuedResponse, summary="Bulk generate clip")
def bulk_generate_clip(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Bulk generate clip."""
    from app.tasks.clip import bulk_generate_embeddings

    task = bulk_generate_embeddings.delay(organization_id=str(org_id))

    return {
        "success": True,
        "task_id": task.id,
        "message": "Bulk CLIP embedding generation queued",
    }


# ============================================================================
# WHISPER TRANSCRIPTION
# ============================================================================


@router.post("/api/organizations/{org_id}/media/{media_id}/transcribe", response_model=AITaskQueuedResponse, summary="Transcribe media")
def transcribe_media(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Transcribe media."""
    from app.tasks.whisper import transcribe_media_task

    media = _get_media_or_404(db, org_id, media_id)

    if media.media_type not in ("video", "audio"):
        raise HTTPException(status_code=400, detail="Only video and audio can be transcribed")

    task = transcribe_media_task.delay(
        media_id=str(media_id),
        organization_id=str(org_id),
    )

    return {
        "success": True,
        "task_id": task.id,
        "message": "Transcription queued",
    }


@router.get("/api/organizations/{org_id}/media/{media_id}/transcript", response_model=TranscriptResponse, summary="Get transcript")
def get_transcript(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get transcript."""
    media = _get_media_or_404(db, org_id, media_id)

    return {
        "media_id": str(media_id),
        "transcript": media.transcript,
        "language": media.transcript_language,
        "status": media.transcription_status,
        "model": media.transcription_model,
    }


@router.post("/api/organizations/{org_id}/media/bulk-transcribe", response_model=AITaskQueuedResponse, summary="Bulk transcribe media")
def bulk_transcribe_media(
    org_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Bulk transcribe media."""
    from app.tasks.whisper import bulk_transcribe

    task = bulk_transcribe.delay(organization_id=str(org_id))

    return {
        "success": True,
        "task_id": task.id,
        "message": "Bulk transcription queued",
    }


# ============================================================================
# MEDIA ALTERNATIVES (transcripts, subtitles, conversions)
# ============================================================================


@router.get("/api/organizations/{org_id}/media/{media_id}/alternatives", response_model=MediaAlternativesResponse, summary="Get media alternatives")
def get_media_alternatives(
    org_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get media alternatives."""
    alternatives = db.query(MediaAlternative).filter_by(
        media_id=media_id,
        organization_id=org_id,
    ).order_by(MediaAlternative.sort_order).all()

    return {
        "media_id": str(media_id),
        "alternatives": [
            {
                "alternative_id": str(alt.alternative_id),
                "alternative_type": alt.alternative_type,
                "label": alt.label,
                "description": alt.description,
                "filename": alt.filename,
                "file_size": alt.file_size,
                "mime_type": alt.mime_type,
                "generated_by": alt.generated_by,
                "generation_params": alt.generation_params,
                "sort_order": alt.sort_order,
                "created_at": alt.created_at.isoformat() if alt.created_at else None,
            }
            for alt in alternatives
        ],
    }


@router.get("/api/organizations/{org_id}/media/{media_id}/alternatives/{alt_id}/download", response_model=AlternativeDownloadResponse, summary="Download alternative")
def download_alternative(
    org_id: UUID,
    media_id: UUID,
    alt_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Download an alternative file.

    Alternatives are full uploaded files (print-resolution masters and the
    like), not generated derivatives, so downloading one needs
    media.download_original — the same bar as the primary download. This
    endpoint previously required only media.view, which let a viewer pull
    originals through the alternatives route.
    """
    from app.services.rbac_service import check_permission, is_platform_admin

    if not is_platform_admin(auth.user_id, session=db) and not check_permission(
        str(auth.user_id), str(org_id), Permission.MEDIA_DOWNLOAD_ORIGINAL, session=db
    ):
        raise HTTPException(status_code=403, detail={
            "code": "forbidden",
            "message": "Permission denied to download the original file",
        })

    alt = db.query(MediaAlternative).filter_by(
        alternative_id=alt_id,
        media_id=media_id,
        organization_id=org_id,
    ).first()

    if not alt:
        raise HTTPException(status_code=404, detail="Alternative not found")

    from app.services.uploads import get_s3_client, get_media_bucket, DEFAULT_REGION
    from app.config import get_settings

    s3_client = get_s3_client(for_presigning=True)
    bucket = get_media_bucket(DEFAULT_REGION)
    settings = get_settings()

    url = s3_client.generate_presigned_url(
        "get_object",
        Params={
            "Bucket": bucket,
            "Key": alt.s3_key,
            "ResponseContentDisposition": f'attachment; filename="{alt.filename}"',
        },
        ExpiresIn=settings.s3_url_expiry_seconds,
    )

    return {"download_url": url, "filename": alt.filename}


# ============================================================================
# Three-tier AI descriptions (Cooper Hewitt pattern)
# ============================================================================


@router.post(
    "/api/organizations/{org_id}/media/{media_id}/generate-descriptions",
    summary="Generate three-tier AI descriptions (alt text, long description, emoji)",
)
def generate_media_descriptions(
    org_id: UUID,
    media_id: UUID,
    body: dict | None = None,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """
    Generate three tiers of description for a media asset via Claude vision:

        - short alt text (~15 words)
        - long description (~100-300 words)
        - emoji summary

    Stores results on the media row (``ai_alt_text`` / ``ai_description_long``
    / ``ai_description_emoji``) without touching curator-authored
    ``alt_text`` / ``description``. Staff can promote the AI values to the
    canonical fields through the normal update endpoint.

    Body (optional): ``{"model": "claude-sonnet-4-6"}``
    """
    import datetime as _dt
    from app.services.ai_enrichment import AIEnrichmentService
    from app.services.uploads import get_org_media_url

    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()
    if not media:
        raise HTTPException(status_code=404, detail="Media not found")

    if media.media_type != "image":
        raise HTTPException(
            status_code=400,
            detail="Tiered descriptions are only supported for image assets",
        )
    if not media.s3_key:
        raise HTTPException(status_code=400, detail="Media has no underlying file")

    # Short-lived signed URL for Claude to fetch the bytes.
    image_url = get_org_media_url(
        media.s3_key,
        organization_id=str(org_id),
        db_session=db,
        expiry_seconds=600,
    )
    if not image_url:
        raise HTTPException(status_code=500, detail="Could not resolve image URL")

    # Build grounding context from whatever we already know.
    context = {
        k: v for k, v in {
            "title": media.title,
            "existing_alt_text": media.alt_text,
            "existing_description": media.description,
            "creator": media.creator,
            "credit": media.credit,
            "source": media.source,
            "date_created": media.date_created.isoformat() if media.date_created else None,
            "rights_statement": media.rights_statement,
        }.items() if v
    }

    service = AIEnrichmentService()
    model = (body or {}).get("model") or "claude-sonnet-4-6"
    result = service.generate_tiered_descriptions(
        image_url=image_url,
        context=context,
        model=model,
    )
    if result is None:
        raise HTTPException(
            status_code=502,
            detail="AI description generation failed. See server logs for details.",
        )

    media.ai_alt_text = result["alt_text"]
    media.ai_description_long = result["description_long"]
    media.ai_description_emoji = result["emoji"]
    media.ai_descriptions_generated_at = _dt.datetime.now(_dt.timezone.utc)
    media.ai_descriptions_model = result["model"]
    db.commit()
    db.refresh(media)

    return {
        "media_id": str(media.media_id),
        "ai_alt_text": media.ai_alt_text,
        "ai_description_long": media.ai_description_long,
        "ai_description_emoji": media.ai_description_emoji,
        "ai_descriptions_generated_at": (
            media.ai_descriptions_generated_at.isoformat()
            if media.ai_descriptions_generated_at else None
        ),
        "ai_descriptions_model": media.ai_descriptions_model,
        "sensitivity_flag": result.get("sensitivity_flag", False),
    }

