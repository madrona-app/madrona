"""Pydantic schemas for Media Library API endpoints."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel

from app.fastapi_app.schemas.common import SuccessResponse


# ---- Media serialization ----

class MediaOut(BaseModel):
    """Serialized media item."""
    media_id: str
    organization_id: str
    s3_key: str | None = None
    filename: str | None = None
    file_size: int | None = None
    mime_type: str | None = None
    media_type: str | None = None
    width: int | None = None
    height: int | None = None
    duration_seconds: float | None = None
    title: str | None = None
    description: str | None = None
    alt_text: str | None = None
    caption: str | None = None
    copyright_notice: str | None = None
    credit: str | None = None
    creator: str | None = None
    source: str | None = None
    date_created: str | None = None
    copyright_status: str | None = None
    rights_statement: str | None = None
    license: str | None = None
    tags: Any | None = None
    folder: str | None = None
    metadata: Any | None = None
    processing_status: str | None = None
    thumbnail_s3_key: str | None = None
    created_at: str | None = None
    created_by: str | None = None
    updated_at: str | None = None
    current_version: int | None = None
    checksum_sha256: str | None = None
    is_published: bool = False
    published_at: str | None = None
    published_url: str | None = None
    published_by: str | None = None
    metadata_reviewed: bool = False
    metadata_reviewed_at: str | None = None
    metadata_reviewed_by: str | None = None
    metadata_review_notes: str | None = None
    technical_metadata: Any | None = None
    iptc_metadata: Any | None = None
    xmp_metadata: Any | None = None
    dublin_core: Any | None = None
    url: str | None = None
    thumbnail_url: str | None = None
    derivatives: list[Any] | None = None

    model_config = {"extra": "allow"}


class MediaListResponse(BaseModel):
    """Paginated media list."""
    items: list[MediaOut]
    total: int
    page: int
    page_size: int
    total_pages: int


# ---- Processing Jobs ----

class ProcessingJobOut(BaseModel):
    """Serialized processing job."""
    job_id: str
    media_id: str
    filename: str | None = None
    media_type: str | None = None
    job_type: str | None = None
    status: str | None = None
    parameters: Any | None = None
    result: Any | None = None
    error_message: str | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None


class ProcessingJobStatsOut(BaseModel):
    """Processing job status counts."""
    pending: int = 0
    processing: int = 0
    completed: int = 0
    failed: int = 0


class ProcessingJobListResponse(BaseModel):
    """Processing jobs list with stats."""
    jobs: list[ProcessingJobOut]
    total: int
    stats: ProcessingJobStatsOut


class RetryJobResponse(SuccessResponse):
    """Retry processing job response."""
    job_id: str


# ---- Search ----

class MediaSearchHitOut(BaseModel):
    """Media search hit."""
    media_id: str
    filename: str | None = None
    title: str | None = None
    description: str | None = None
    media_type: str | None = None
    mime_type: str | None = None
    file_size: int | None = None
    width: int | None = None
    height: int | None = None
    creator: str | None = None
    copyright_status: str | None = None
    folder: str | None = None
    tags: Any | None = None
    structured_tags: list[dict[str, str]] | None = None
    processing_status: str | None = None
    is_published: bool | None = None
    created_at: str | None = None
    score: float | None = None
    highlights: Any | None = None
    url: str | None = None
    thumbnail_url: str | None = None

    model_config = {"extra": "allow"}


class FacetBucketOut(BaseModel):
    """Facet bucket."""
    key: str
    count: int


class FacetOut(BaseModel):
    """Facet with buckets."""
    field: str
    buckets: list[FacetBucketOut]


class MediaSearchResponse(BaseModel):
    """Media search results."""
    hits: list[MediaSearchHitOut]
    total: int
    took_ms: int = 0
    next_offset: int | None = None
    facets: list[FacetOut] | None = None


# ---- Reindex ----

class ReindexResponse(SuccessResponse):
    """Reindex response."""
    indexed: int
    total: int
    message: str


# ---- Derivatives ----

class DerivativeOut(BaseModel):
    """Serialized derivative."""
    derivative_id: str
    media_id: str
    derivative_type: str | None = None
    format: str | None = None
    s3_key: str | None = None
    width: int | None = None
    height: int | None = None
    file_size: int | None = None
    quality: int | None = None
    created_at: str | None = None
    url: str | None = None


class MediaDerivativesResponse(BaseModel):
    """Derivatives for a media item."""
    media_id: str
    processing_status: str | None = None
    derivatives: list[DerivativeOut]


class RegenerateResponse(SuccessResponse):
    """Regenerate derivatives response."""
    message: str
    media_id: str


# ---- Reprocess ----

class ReprocessResponse(SuccessResponse):
    """Reprocess media response."""
    message: str
    media_id: str
    media_type: str | None = None
    features: dict[str, bool] | None = None


# ---- Processing Status ----

class ProcessingStatusJobOut(BaseModel):
    """Processing status job entry."""
    job_id: str
    job_type: str | None = None
    status: str | None = None
    error_message: str | None = None
    retry_count: int | None = None
    started_at: str | None = None
    completed_at: str | None = None
    created_at: str | None = None
    result: Any | None = None


class MediaProcessingStatusResponse(BaseModel):
    """Media processing status."""
    media_id: str
    processing_status: str | None = None
    jobs: list[ProcessingStatusJobOut]


# ---- Batch ----

class BatchOperationResponse(SuccessResponse):
    """Batch operation response."""
    operation: str
    processed: int | None = None
    queued: int | None = None


# ---- Versions ----

class MediaVersionOut(BaseModel):
    """Serialized media version."""
    version_id: str
    version_number: int
    file_size: int | None = None
    checksum_sha256: str | None = None
    change_note: str | None = None
    created_by: str | None = None
    created_at: str | None = None


class MediaVersionListResponse(BaseModel):
    """Media versions list."""
    media_id: str
    current_version: int
    versions: list[MediaVersionOut]


class UploadVersionResponse(SuccessResponse):
    """Upload new version response."""
    media_id: str
    version: int
    previous_version_id: str


class RestoreVersionResponse(SuccessResponse):
    """Restore version response."""
    media_id: str
    restored_from_version: int
    new_version: int


# ---- Transcode ----

class TranscodeResponse(SuccessResponse):
    """Transcode video response."""
    media_id: str
    task_id: str
    message: str
