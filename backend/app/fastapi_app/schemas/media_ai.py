"""Pydantic response schemas for media_ai router."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel


# ============================================================================
# AI CONFIG
# ============================================================================


class AIConfigOut(BaseModel):
    config_id: str | None = None
    organization_id: str
    auto_tag_on_upload: bool | None = None
    detect_labels: bool | None = None
    detect_text: bool | None = None
    detect_faces: bool | None = None
    detect_celebrities: bool | None = None
    detect_moderation: bool | None = None
    extract_pdf_text: bool | None = None
    min_label_confidence: str | None = None
    min_text_confidence: str | None = None
    max_labels_per_image: int | None = None
    monthly_budget_usd: str | None = None
    current_month_usage: str | None = None
    usage_reset_date: str | None = None
    visual_search_threshold: float | None = None
    created_at: str | None = None
    updated_at: str | None = None


class AIConfigResponse(BaseModel):
    config: AIConfigOut


# ============================================================================
# AI TAG MAPPINGS
# ============================================================================


class TagDefinitionBrief(BaseModel):
    definition_id: str
    tag_key: str | None = None
    display_name: str | None = None


class AITagMappingOut(BaseModel):
    mapping_id: str
    organization_id: str
    ai_tag_type: str | None = None
    ai_tag_value: str | None = None
    definition_id: str | None = None
    definition: TagDefinitionBrief | None = None
    mapped_value: str | None = None
    auto_apply: bool | None = None
    min_confidence: str | None = None
    created_at: str | None = None


class AITagMappingListResponse(BaseModel):
    mappings: list[AITagMappingOut]


class AITagMappingCreatedResponse(BaseModel):
    mapping: AITagMappingOut


class AITagMappingUpdatedResponse(BaseModel):
    mapping: AITagMappingOut


# ============================================================================
# AI TAGS
# ============================================================================


class BBoxOut(BaseModel):
    left: str | None = None
    top: str | None = None
    width: str | None = None
    height: str | None = None


class AITagOut(BaseModel):
    ai_tag_id: str
    media_id: str
    tag_type: str | None = None
    tag_value: str | None = None
    confidence: str | None = None
    metadata: Any | None = None
    bbox: BBoxOut | None = None
    provider: str | None = None
    model_version: str | None = None
    processed_at: str | None = None
    mapped_to_definition_id: str | None = None
    mapping_status: str | None = None


class MediaAITagsResponse(BaseModel):
    media_id: str
    ai_processing_status: str | None = None
    ai_processed_at: str | None = None
    ai_tags: list[AITagOut]


class AITagUpdatedResponse(BaseModel):
    ai_tag: AITagOut


# ============================================================================
# BULK / TASK RESPONSES
# ============================================================================


class AITaskQueuedResponse(BaseModel):
    success: bool
    task_id: str
    message: str


class BulkReprocessResponse(BaseModel):
    success: bool
    task_id: str
    queued_count: int
    message: str


# ============================================================================
# SUGGESTIONS / STATS
# ============================================================================


class AITagSuggestionOut(BaseModel):
    ai_tag_type: str
    ai_tag_value: str
    occurrence_count: int
    avg_confidence: float
    sample_media_ids: list[str]


class AITagSuggestionsResponse(BaseModel):
    suggestions: list[AITagSuggestionOut]
    total: int


class AITaggingStatsResponse(BaseModel):
    total_media: int
    pending_count: int
    processing_count: int
    completed_count: int
    failed_count: int
    skipped_count: int
    total_ai_tags: int
    tags_by_type: dict[str, int]
    unmapped_tags_count: int
    monthly_usage_usd: str | None = None
    monthly_budget_usd: str | None = None


# ============================================================================
# CLIP VISUAL SEARCH
# ============================================================================


class SimilarMediaResponse(BaseModel):
    media_id: str
    similar: list[Any]
    total: int


class VisualSearchResponse(BaseModel):
    query: str
    results: list[Any]
    total: int


class DuplicatesResponse(BaseModel):
    duplicates: list[Any]
    total: int


# ============================================================================
# WHISPER TRANSCRIPTION
# ============================================================================


class TranscriptResponse(BaseModel):
    media_id: str
    transcript: str | None = None
    language: str | None = None
    status: str | None = None
    model: str | None = None


# ============================================================================
# ALTERNATIVES
# ============================================================================


class AlternativeOut(BaseModel):
    alternative_id: str
    alternative_type: str | None = None
    label: str | None = None
    description: str | None = None
    filename: str | None = None
    file_size: int | None = None
    mime_type: str | None = None
    generated_by: str | None = None
    generation_params: Any | None = None
    sort_order: int | None = None
    created_at: str | None = None


class MediaAlternativesResponse(BaseModel):
    media_id: str
    alternatives: list[AlternativeOut]


class AlternativeDownloadResponse(BaseModel):
    download_url: str
    filename: str | None = None
