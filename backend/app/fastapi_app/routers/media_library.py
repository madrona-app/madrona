"""
Media Library API endpoints (FastAPI).

Phase 9e — 19 routes:
  - Upload media (POST)
  - List media (GET)
  - Get media (GET)
  - Update media (PUT)
  - Delete media (DELETE)
  - Download URL (GET)
  - Processing jobs list/retry
  - Derivatives: get, regenerate, reprocess, processing status
  - Batch operations
  - Search media
  - Reindex media
  - Versioning: list, upload, restore
  - Video transcoding

Migrated from app/api/media.py.
"""

import json
import logging
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from sqlalchemy import func, or_
from sqlalchemy.orm import joinedload, selectinload
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.database import get_db
from app.fastapi_app.dependencies.auth import AuthContext, require_permission
from app.models import (
    Media,
    MediaDerivative,
    MediaProcessingJob,
    MediaVersion,
)
from app.permissions import Permission
from app.services.uploads import (
    MediaType,
    MediaUrlType,
    StorageLimitExceeded,
    upload_org_media,
    delete_org_media,
    get_org_media_url,
    detect_media_type,
)
from app.services.api_security import escape_ilike, sanitize_error_message
from app.fastapi_app.schemas.common import SuccessResponse
from app.fastapi_app.schemas.media_library import (
    BatchOperationResponse,
    MediaDerivativesResponse,
    MediaListResponse,
    MediaOut,
    MediaProcessingStatusResponse,
    MediaSearchResponse,
    MediaVersionListResponse,
    ProcessingJobListResponse,
    RegenerateResponse,
    ReindexResponse,
    ReprocessResponse,
    RestoreVersionResponse,
    RetryJobResponse,
    TranscodeResponse,
    UploadVersionResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-library"])


# ============================================================================
# HELPERS
# ============================================================================


def _get_media_or_404(db: Session, org_id: UUID, media_id: UUID) -> Media:
    media = db.query(Media).filter(
        Media.media_id == media_id,
        Media.organization_id == org_id,
    ).first()
    if not media:
        raise HTTPException(status_code=404, detail={
            "code": "not_found", "message": "Media not found",
        })
    return media


# Per-asset serializer used throughout this router. Delegates to the shared
# implementation with the detail-view extras (preview_url, lock status,
# rights-derived download_access) turned on. Other callers — collection
# nesting, procedure attachments — use the shared serializer with the flags
# off and get the leaner payload.
from app.serializers.media import (
    _serialize_media as _serialize_media_shared,
    _serialize_derivative as _serialize_derivative_shared,
)


def _serialize_media(
    media: Media,
    db: Session,
    include_url: bool = True,
    include_derivatives: bool = False,
    user_id: str | None = None,
) -> dict:
    return _serialize_media_shared(
        media,
        include_url=include_url,
        include_derivatives=include_derivatives,
        user_id=user_id,
        session=db,
        include_preview_url=True,
        include_lock=True,
        include_download_access=True,
    )


def _serialize_derivative(
    derivative: MediaDerivative,
    db: Session,
    include_url: bool = True,
    user_id: str | None = None,
    is_published: bool | None = None,
) -> dict:
    return _serialize_derivative_shared(
        derivative,
        include_url=include_url,
        user_id=user_id,
        is_published=is_published,
        session=db,
    )


# ============================================================================
# Route 1: Upload media
# ============================================================================


@router.post("/api/organizations/{organization_id}/media", status_code=201, response_model=MediaOut, summary="Upload media")
def upload_media(
    organization_id: UUID,
    file: UploadFile = File(...),
    title: str | None = Form(None),
    description: str | None = Form(None),
    alt_text: str | None = Form(None),
    credit: str | None = Form(None),
    creator: str | None = Form(None),
    source: str | None = Form(None),
    copyright_status: str | None = Form(None),
    rights_statement: str | None = Form(None),
    license: str | None = Form(None),
    folder: str | None = Form(None),
    folder_id: str | None = Form(None),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Upload a new media file with optional metadata."""
    if not file.filename:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No filename provided"})

    content_type = file.content_type or 'application/octet-stream'
    media_type = detect_media_type(content_type)
    if not media_type:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": f"Unsupported file type: {content_type}"})

    if media_type == "video":
        from app.services.video_transcoding import is_video_transcoding_available
        if not is_video_transcoding_available():
            raise HTTPException(status_code=503, detail={"code": "service_unavailable", "message": "Video uploads are not available"})

    try:
        s3_key, file_size = upload_org_media(
            organization_id=str(organization_id),
            file_data=file.file,
            content_type=content_type,
            media_type=media_type,
            filename=file.filename,
            db_session=db,
        )
    except StorageLimitExceeded as e:
        raise HTTPException(status_code=413, detail={
            "code": "STORAGE_LIMIT_EXCEEDED",
            "message": sanitize_error_message(e),
            "details": {"used_bytes": e.used_bytes, "limit_bytes": e.limit_bytes, "file_size": e.file_size},
        })
    except ValueError as e:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": sanitize_error_message(e)})

    # Parse folder_id
    parsed_folder_id = None
    if folder_id:
        try:
            parsed_folder_id = UUID(folder_id)
        except ValueError:
            pass

    media = Media(
        organization_id=organization_id,
        s3_key=s3_key,
        filename=file.filename,
        file_size=file_size,
        mime_type=content_type,
        media_type=media_type.value,
        title=title,
        description=description,
        alt_text=alt_text,
        credit=credit,
        creator=creator,
        source=source,
        copyright_status=copyright_status,
        rights_statement=rights_statement,
        license=license,
        folder=folder,
        folder_id=parsed_folder_id,
        processing_status='pending',
        created_by=auth.user_id,
    )

    db.add(media)
    db.commit()

    processable_types = {MediaType.IMAGE, MediaType.VIDEO, MediaType.DOCUMENT, MediaType.AUDIO}
    if media_type in processable_types:
        try:
            from app.tasks.media import process_upload_task
            process_upload_task.delay(str(media.media_id), str(organization_id), generate_webp=False)
        except Exception as e:
            logger.warning(f"Failed to queue processing task: {e}")
            media.processing_status = 'completed'
            db.commit()
            try:
                from app.search.media import MediaSearchService, get_media_search_service
                if MediaSearchService.is_available():
                    service = get_media_search_service()
                    service.index_media(media)
            except Exception:
                pass
    else:
        media.processing_status = 'completed'
        db.commit()
        try:
            from app.search.media import MediaSearchService, get_media_search_service
            if MediaSearchService.is_available():
                service = get_media_search_service()
                service.index_media(media)
        except Exception:
            pass

    return _serialize_media(media, db, user_id=str(auth.user_id))


# ============================================================================
# Route 2: List media
# ============================================================================


@router.get("/api/organizations/{organization_id}/media", response_model=MediaListResponse, summary="List media")
def list_media(
    organization_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List media with filtering, search, and pagination."""
    query = db.query(Media).filter(Media.organization_id == organization_id)

    params = request.query_params
    if params.get('media_type'):
        query = query.filter(Media.media_type == params['media_type'])
    if params.get('folder'):
        query = query.filter(Media.folder == params['folder'])

    folder_id = params.get('folder_id')
    if folder_id:
        if folder_id.lower() == 'unfiled':
            query = query.filter(Media.folder_id.is_(None))
        else:
            try:
                query = query.filter(Media.folder_id == UUID(folder_id))
            except ValueError:
                pass

    search = params.get('search')
    if search:
        pattern = f"%{escape_ilike(search)}%"
        query = query.filter(or_(
            Media.title.ilike(pattern, escape="\\"),
            Media.filename.ilike(pattern, escape="\\"),
            Media.description.ilike(pattern, escape="\\"),
        ))

    if params.get('processing_status'):
        query = query.filter(Media.processing_status == params['processing_status'])

    is_published = params.get('is_published')
    if is_published is not None and is_published != '':
        query = query.filter(Media.is_published == (is_published.lower() == 'true'))

    if params.get('ai_processing_status'):
        query = query.filter(Media.ai_processing_status == params['ai_processing_status'])

    page = max(1, int(params.get('page', 1)))
    page_size = min(100, max(1, int(params.get('page_size', 50))))

    total = query.count()
    items = (
        query
        .options(selectinload(Media.derivatives))
        .order_by(Media.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )

    return {
        "items": [_serialize_media(m, db, user_id=str(auth.user_id)) for m in items],
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size,
    }


# ============================================================================
# Route 3: List processing jobs
# ============================================================================


@router.get("/api/organizations/{organization_id}/media/processing-jobs", response_model=ProcessingJobListResponse, summary="List processing jobs")
def list_processing_jobs(
    organization_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List media processing jobs with status filtering."""
    params = request.query_params
    status = params.get("status")
    job_type = params.get("job_type")
    limit = min(int(params.get("limit", 50)), 100)
    offset = int(params.get("offset", 0))

    query = db.query(MediaProcessingJob).filter(MediaProcessingJob.organization_id == organization_id)
    if status:
        query = query.filter(MediaProcessingJob.status == status)
    if job_type:
        query = query.filter(MediaProcessingJob.job_type == job_type)

    total = query.count()
    jobs = (
        query
        .options(joinedload(MediaProcessingJob.media))
        .order_by(MediaProcessingJob.created_at.desc())
        .offset(offset).limit(limit).all()
    )

    stats_query = db.query(
        MediaProcessingJob.status, func.count(MediaProcessingJob.job_id)
    ).filter(
        MediaProcessingJob.organization_id == organization_id
    ).group_by(MediaProcessingJob.status)
    stats = {row[0]: row[1] for row in stats_query.all()}

    jobs_list = []
    for job in jobs:
        media = job.media
        jobs_list.append({
            "job_id": str(job.job_id),
            "media_id": str(job.media_id),
            "filename": media.filename if media else None,
            "media_type": media.media_type if media else None,
            "job_type": job.job_type,
            "status": job.status,
            "parameters": job.parameters,
            "result": job.result,
            "error_message": job.error_message,
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "created_at": job.created_at.isoformat() if job.created_at else None,
        })

    return {
        "jobs": jobs_list,
        "total": total,
        "stats": {
            "pending": stats.get("pending", 0),
            "processing": stats.get("processing", 0),
            "completed": stats.get("completed", 0),
            "failed": stats.get("failed", 0),
        },
    }


# ============================================================================
# Route 4: Retry processing job
# ============================================================================


@router.post("/api/organizations/{organization_id}/media/processing-jobs/{job_id}/retry", response_model=RetryJobResponse, summary="Retry processing job")
def retry_processing_job(
    organization_id: UUID,
    job_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Retry a failed media processing job."""
    job = db.query(MediaProcessingJob).filter(
        MediaProcessingJob.job_id == job_id,
        MediaProcessingJob.organization_id == organization_id,
    ).first()
    if not job:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Processing job not found"})

    if job.status != "failed":
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Only failed jobs can be retried"})

    job.status = "pending"
    job.error_message = None
    job.started_at = None
    job.completed_at = None

    media = db.query(Media).filter(Media.media_id == job.media_id).first()
    if media and media.processing_status == "failed":
        media.processing_status = "pending"

    db.commit()

    try:
        from app.tasks.media import process_upload_task
        process_upload_task.delay(str(job.media_id), str(organization_id))
    except ImportError:
        pass

    return {"success": True, "job_id": str(job.job_id)}


# ============================================================================
# Route 5: Search media
# ============================================================================


@router.get("/api/organizations/{organization_id}/media/search", response_model=MediaSearchResponse, summary="Search media")
def search_media(
    organization_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Full-text search across media with faceted filtering."""
    from app.search.media import MediaSearchService, MediaSearchRequest
    from app.search.media.schemas import TagFilter

    params = request.query_params

    if not MediaSearchService.is_available():
        return _database_media_search(db, organization_id, params, str(auth.user_id))

    tag_filters = None
    tag_filter_params = params.getlist('tag_filter')
    if tag_filter_params:
        tag_filters = []
        for tf in tag_filter_params:
            if ':' in tf:
                key, value = tf.split(':', 1)
                tag_filters.append(TagFilter(key=key, value=value))

    def _parse_bool(val):
        if val is None or val == '':
            return None
        return val.lower() == 'true'

    search_request = MediaSearchRequest(
        query=params.get('q', ''),
        media_type=params.get('media_type'),
        folder=params.get('folder'),
        copyright_status=params.get('copyright_status'),
        creator=params.get('creator'),
        license_type=params.get('license'),
        is_published=_parse_bool(params.get('is_published')),
        processing_status=params.get('processing_status'),
        ai_processing_status=params.get('ai_processing_status'),
        date_from=params.get('date_from'),
        date_to=params.get('date_to'),
        has_exif=_parse_bool(params.get('has_exif')),
        has_iptc=_parse_bool(params.get('has_iptc')),
        tag_filters=tag_filters,
        offset=max(0, int(params.get('offset', 0))),
        limit=min(100, max(1, int(params.get('limit', 50)))),
        sort_by=params.get('sort_by', 'relevance'),
        sort_order=params.get('sort_order', 'desc'),
        include_facets=params.get('facets', '').lower() == 'true',
        color_key=params.get('color_key'),
    )

    from app.search.media import get_media_search_service
    from opensearchpy.exceptions import NotFoundError

    service = get_media_search_service()
    try:
        response = service.search(search_request, organization_id)
    except NotFoundError:
        # OpenSearch is reachable — is_available() only proves the server
        # answers — but the media index isn't there. Serve from the
        # database rather than reporting an empty library; the index
        # manager has already logged what needs rebuilding.
        return _database_media_search(db, organization_id, params, str(auth.user_id))

    media_ids = [UUID(hit.media_id) for hit in response.hits]
    media_records = {}
    if media_ids:
        records = db.query(Media).filter(
            Media.media_id.in_(media_ids),
            Media.organization_id == organization_id,
        ).all()
        media_records = {str(m.media_id): m for m in records}

    hits_with_urls = []
    for hit in response.hits:
        structured_tags = None
        if hit.structured_tags:
            structured_tags = [{"key": t.key, "value": t.value} for t in hit.structured_tags]

        hit_dict = {
            "media_id": hit.media_id,
            "filename": hit.filename,
            "title": hit.title,
            "description": hit.description,
            "media_type": hit.media_type,
            "mime_type": hit.mime_type,
            "file_size": hit.file_size,
            "width": hit.width,
            "height": hit.height,
            "creator": hit.creator,
            "copyright_status": hit.copyright_status,
            "folder": hit.folder,
            "structured_tags": structured_tags,
            "processing_status": hit.processing_status,
            "is_published": hit.is_published,
            "created_at": hit.created_at,
            "score": hit.score,
            "highlights": hit.highlights,
        }

        media = media_records.get(hit.media_id)
        if media:
            # Search results mint their own URLs rather than going through
            # the serializer, so the same rule has to be applied here: an
            # image displays from a rendition, never the master.
            from app.serializers.media import _display_key_for_image

            display_key = media.s3_key
            if getattr(media, "media_type", None) == "image":
                display_key = (
                    _display_key_for_image(media, db) or media.thumbnail_s3_key
                )

            hit_dict["url"] = get_org_media_url(
                display_key, organization_id=str(organization_id),
                db_session=db, expiry_seconds=3600,
            ) if display_key else None
            if media.thumbnail_s3_key:
                hit_dict["thumbnail_url"] = get_org_media_url(
                    media.thumbnail_s3_key, organization_id=str(organization_id),
                    db_session=db, expiry_seconds=3600,
                )

        hits_with_urls.append(hit_dict)

    result = {
        "hits": hits_with_urls,
        "total": response.total,
        "took_ms": response.took_ms,
    }

    if response.next_offset is not None:
        result["next_offset"] = response.next_offset

    if response.facets:
        result["facets"] = [
            {"field": f.field, "buckets": [{"key": b.key, "count": b.doc_count} for b in f.buckets]}
            for f in response.facets
        ]

    return result


def _database_media_search(db: Session, org_id: UUID, params, user_id: str):
    query = db.query(Media).filter(Media.organization_id == org_id)

    search_query = params.get('q', '')
    if search_query:
        pattern = f"%{escape_ilike(search_query)}%"
        query = query.filter(or_(
            Media.title.ilike(pattern, escape="\\"),
            Media.filename.ilike(pattern, escape="\\"),
            Media.description.ilike(pattern, escape="\\"),
            Media.creator.ilike(pattern, escape="\\"),
        ))

    if params.get('media_type'):
        query = query.filter(Media.media_type == params['media_type'])
    if params.get('folder'):
        query = query.filter(Media.folder == params['folder'])

    folder_id = params.get('folder_id')
    if folder_id:
        if folder_id.lower() == 'unfiled':
            query = query.filter(Media.folder_id.is_(None))
        else:
            try:
                query = query.filter(Media.folder_id == UUID(folder_id))
            except ValueError:
                pass

    if params.get('copyright_status'):
        query = query.filter(Media.copyright_status == params['copyright_status'])
    if params.get('processing_status'):
        query = query.filter(Media.processing_status == params['processing_status'])

    limit = min(100, max(1, int(params.get('limit', 50))))
    offset = max(0, int(params.get('offset', 0)))

    total = query.count()
    items = query.order_by(Media.created_at.desc()).offset(offset).limit(limit).all()

    return {
        "hits": [_serialize_media(m, db, user_id=user_id) for m in items],
        "total": total,
        "took_ms": 0,
        "next_offset": offset + limit if offset + limit < total else None,
    }


# ============================================================================
# Route 6: Reindex all media
# ============================================================================


@router.post("/api/organizations/{organization_id}/media/reindex", response_model=ReindexResponse, summary="Reindex all media")
def reindex_all_media(
    organization_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_ADMIN)),
    db: Session = Depends(get_db),
):
    """Reindex all media in OpenSearch for an organization."""
    from app.search.media import MediaSearchService, get_media_search_service

    if not MediaSearchService.is_available():
        raise HTTPException(status_code=503, detail={"code": "service_unavailable", "message": "OpenSearch is not available"})

    batch_size = min(500, max(1, int(request.query_params.get('batch_size', 100))))

    total = db.query(Media).filter(Media.organization_id == organization_id).count()
    if total == 0:
        return {"success": True, "indexed": 0, "total": 0, "message": "No media to index"}

    service = get_media_search_service()

    # Make sure the index and its aliases exist before writing a single
    # document. Without this, reindexing an org whose aliases were never
    # set up writes every document to a concrete index auto-created under
    # the write-alias name, with dynamic mappings, that searches never
    # read — so the reindex reports success and the library stays empty.
    # setup() is a no-op when the aliases are already in place.
    try:
        service.setup_index()
    except Exception as e:
        logger.error(f"Media reindex could not prepare the index: {e}")
        raise HTTPException(
            status_code=503,
            detail={"code": "index_unavailable", "message": str(e)},
        ) from e

    indexed = 0
    offset = 0

    while offset < total:
        media_batch = db.query(Media).filter(
            Media.organization_id == organization_id,
        ).order_by(Media.created_at.desc()).offset(offset).limit(batch_size).all()

        for media in media_batch:
            try:
                service.index_media(media)
                indexed += 1
            except Exception as e:
                logger.warning(f"Failed to index media {media.media_id}: {e}")

        offset += batch_size

    return {"success": True, "indexed": indexed, "total": total, "message": f"Indexed {indexed} of {total} media items"}


# ============================================================================
# Route 7: Get single media
# ============================================================================


@router.get("/api/organizations/{organization_id}/media/{media_id}", response_model=MediaOut, summary="Get media")
def get_media(
    organization_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get media."""
    media = _get_media_or_404(db, organization_id, media_id)
    return _serialize_media(media, db, user_id=str(auth.user_id))


# ============================================================================
# Route 8: Update media
# ============================================================================


@router.put("/api/organizations/{organization_id}/media/{media_id}", response_model=MediaOut, summary="Update media")
async def update_media(
    organization_id: UUID,
    media_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Update media."""
    media = _get_media_or_404(db, organization_id, media_id)
    data = await request.json()

    allowed_fields = [
        'title', 'description', 'alt_text', 'credit', 'creator', 'source',
        'date_created', 'copyright_status', 'rights_statement', 'license',
        'folder',
    ]
    for field in allowed_fields:
        if field in data:
            setattr(media, field, data[field])

    iptc_fields = {k: data[k] for k in ('caption', 'copyright_notice') if k in data}
    if iptc_fields:
        iptc = dict(media.iptc_metadata or {})
        iptc.update(iptc_fields)
        media.iptc_metadata = iptc

    if 'dublin_core' in data:
        dc_updates = data['dublin_core']
        if isinstance(dc_updates, dict):
            existing_dc = dict(media.dublin_core or {})
            for k, v in dc_updates.items():
                if v is None:
                    existing_dc.pop(k, None)
                else:
                    existing_dc[k] = v
            media.dublin_core = existing_dc

            DC_TO_COLUMN = {
                'dc_title': 'title', 'dc_creator': 'creator',
                'dc_description': 'description', 'dc_source': 'source',
                'dc_rights': 'rights_statement',
            }
            for dc_key, column in DC_TO_COLUMN.items():
                if dc_key in dc_updates and dc_updates[dc_key] is not None:
                    setattr(media, column, dc_updates[dc_key])

    if 'iptc_metadata' in data:
        iptc_updates = data['iptc_metadata']
        if isinstance(iptc_updates, dict):
            EDITABLE_IPTC = {'headline', 'caption', 'keywords', 'copyright_notice',
                             'credit', 'source', 'city', 'state', 'country', 'category'}
            existing_iptc = dict(media.iptc_metadata or {})
            for k, v in iptc_updates.items():
                if k in EDITABLE_IPTC:
                    if v is None:
                        existing_iptc.pop(k, None)
                    else:
                        existing_iptc[k] = v
            media.iptc_metadata = existing_iptc

    if 'metadata' in data:
        import json as _json
        meta_str = _json.dumps(data['metadata'], default=str)
        if len(meta_str) > 65536:  # 64KB safety limit
            raise HTTPException(status_code=422, detail={
                "code": "validation_error",
                "message": "Metadata payload exceeds 64KB size limit",
            })
        media.extra_metadata = data['metadata']

    media.updated_by = auth.user_id
    db.commit()

    try:
        from app.search.media import MediaSearchService, get_media_search_service
        if MediaSearchService.is_available():
            db.refresh(media)
            service = get_media_search_service()
            service.index_media(media)
    except Exception as e:
        logger.warning(f"Failed to reindex media {media_id}: {e}")

    return _serialize_media(media, db, user_id=str(auth.user_id))


# ============================================================================
# Route 9: Delete media
# ============================================================================


@router.delete("/api/organizations/{organization_id}/media/{media_id}", response_model=SuccessResponse, summary="Delete media")
def delete_media(
    organization_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_DELETE)),
    db: Session = Depends(get_db),
):
    """Delete media."""
    media = _get_media_or_404(db, organization_id, media_id)

    s3_key = media.s3_key
    thumbnail_key = media.thumbnail_s3_key

    # Remove from search index (fast, keeps query results consistent)
    try:
        from app.search.media import MediaSearchService, get_media_search_service
        if MediaSearchService.is_available():
            service = get_media_search_service()
            service.delete_media(media_id, organization_id)
    except Exception as e:
        logger.warning(f"Failed to delete media {media_id} from OpenSearch: {e}")

    # Delete DB record — this is what the UI waits for
    db.delete(media)
    db.commit()

    # S3 cleanup async via Celery (derivatives, original, thumbnail)
    try:
        from app.tasks.media import cleanup_deleted_media
        cleanup_deleted_media.delay(str(organization_id), str(media_id), s3_key, thumbnail_key)
    except Exception as e:
        logger.warning(f"Async S3 cleanup failed, falling back to sync: {e}")
        try:
            from app.services.media_processing import delete_derivatives
            delete_derivatives(str(organization_id), str(media_id), db)
        except Exception:
            pass
        delete_org_media(s3_key)
        if thumbnail_key:
            delete_org_media(thumbnail_key)

    return {"success": True}


# ============================================================================
# Route 10 (deleted): Download URL
# ============================================================================
# The shadowed handler `get_media_download_url` previously defined here was
# never reachable — `media_dam.py:download_with_conversion` is registered
# first in asgi.py and won its path collision. The rights/perm checks that
# only existed in this shadowed copy have been folded into the live handler,
# gated behind Organization.media_rights_enforcement (default off). Cleanup
# audit, 2026-05-14.


# ============================================================================
# Route 11: Get derivatives
# ============================================================================


@router.get("/api/organizations/{organization_id}/media/{media_id}/derivatives", response_model=MediaDerivativesResponse, summary="Get media derivatives")
def get_media_derivatives(
    organization_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get media derivatives."""
    media = _get_media_or_404(db, organization_id, media_id)

    derivatives = db.query(MediaDerivative).filter(
        MediaDerivative.media_id == media_id,
    ).order_by(MediaDerivative.derivative_type).all()

    is_published = getattr(media, 'is_published', False)

    return {
        "media_id": str(media_id),
        "processing_status": media.processing_status,
        "derivatives": [
            _serialize_derivative(d, db, user_id=str(auth.user_id), is_published=is_published)
            for d in derivatives
        ],
    }


# ============================================================================
# Route 12: Regenerate derivatives
# ============================================================================


@router.post("/api/organizations/{organization_id}/media/{media_id}/regenerate", response_model=RegenerateResponse, summary="Regenerate media derivatives")
async def regenerate_media_derivatives(
    organization_id: UUID,
    media_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Regenerate media derivatives."""
    media = _get_media_or_404(db, organization_id, media_id)

    if media.media_type != 'image':
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Only images can have derivatives regenerated"})

    try:
        data = await request.json()
    except Exception:
        data = {}
    generate_webp = data.get('generate_webp', False)

    try:
        from app.tasks.media import regenerate_derivatives_task
        regenerate_derivatives_task.delay(str(media_id), str(organization_id), generate_webp=generate_webp)
        return {"success": True, "message": "Derivative regeneration queued", "media_id": str(media_id)}
    except Exception as e:
        logger.error(f"Failed to queue regeneration task: {e}")
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to queue regeneration task"})


# ============================================================================
# Route 13: Reprocess media
# ============================================================================


@router.post("/api/organizations/{organization_id}/media/{media_id}/reprocess", response_model=ReprocessResponse, summary="Reprocess media")
def reprocess_media(
    organization_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Reprocess media."""
    media = _get_media_or_404(db, organization_id, media_id)

    if media.processing_status in ("processing", "transcoding"):
        raise HTTPException(status_code=400, detail={
            "code": "bad_request", "message": "Media is currently being processed. Please wait or retry after failure.",
        })

    media.processing_status = "pending"
    db.commit()

    try:
        from app.tasks.media import process_upload_task
        from app.config import get_settings

        process_upload_task.delay(str(media_id), str(organization_id), generate_webp=True)

        settings = get_settings()
        features = {
            "clip": settings.clip_enabled and media.media_type == "image",
            "ocr": settings.ocr_enabled and media.media_type in ("image",),
            "ai_tagging": settings.ai_tagging_enabled,
        }

        return {
            "success": True,
            "message": f"Reprocessing queued for {media.media_type}",
            "media_id": str(media_id),
            "media_type": media.media_type,
            "features": features,
        }
    except Exception as e:
        logger.error(f"Failed to queue reprocessing task: {e}")
        raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to queue reprocessing task"})


# ============================================================================
# Route 14: Processing status
# ============================================================================


@router.get("/api/organizations/{organization_id}/media/{media_id}/processing-status", response_model=MediaProcessingStatusResponse, summary="Get media processing status")
def get_media_processing_status(
    organization_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """Get media processing status."""
    media = _get_media_or_404(db, organization_id, media_id)

    jobs = db.query(MediaProcessingJob).filter(
        MediaProcessingJob.media_id == media_id,
    ).order_by(MediaProcessingJob.created_at.desc()).limit(10).all()

    return {
        "media_id": str(media_id),
        "processing_status": media.processing_status,
        "jobs": [
            {
                "job_id": str(j.job_id),
                "job_type": j.job_type,
                "status": j.status,
                "error_message": j.error_message,
                "retry_count": j.retry_count,
                "started_at": j.started_at.isoformat() if j.started_at else None,
                "completed_at": j.completed_at.isoformat() if j.completed_at else None,
                "created_at": j.created_at.isoformat() if j.created_at else None,
                "result": j.result,
            }
            for j in jobs
        ],
    }


# ============================================================================
# Route 15: Batch operations
# ============================================================================


@router.post("/api/organizations/{organization_id}/media/batch", response_model=BatchOperationResponse, summary="Batch media operation")
async def batch_media_operation(
    organization_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Batch media operation."""
    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Request body required"})

    operation = data.get('operation')
    media_ids = data.get('media_ids', [])
    params = data.get('params', {})

    if not operation:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "Operation is required"})
    if not media_ids:
        raise HTTPException(status_code=422, detail={"code": "validation_error", "message": "At least one media_id is required"})
    if operation not in ['regenerate', 'extract_metadata', 'delete']:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": f"Invalid operation: {operation}"})

    media_items = db.query(Media).filter(
        Media.media_id.in_([UUID(mid) for mid in media_ids]),
        Media.organization_id == organization_id,
    ).all()

    if len(media_items) != len(media_ids):
        found_ids = {str(m.media_id) for m in media_items}
        missing = [mid for mid in media_ids if mid not in found_ids]
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": f"Some media items not found: {missing}"})

    if operation == 'delete':
        deleted = 0
        for media in media_items:
            s3_key = media.s3_key
            thumbnail_key = media.thumbnail_s3_key
            db.delete(media)
            delete_org_media(s3_key)
            if thumbnail_key:
                delete_org_media(thumbnail_key)
            deleted += 1
        db.commit()
        return {"success": True, "operation": operation, "processed": deleted}
    else:
        try:
            from app.tasks.media import process_batch_task
            operation_map = {'regenerate': 'regenerate', 'extract_metadata': 'metadata_extract'}
            process_batch_task.delay(
                media_ids=media_ids,
                organization_id=str(organization_id),
                operation=operation_map.get(operation, operation),
                generate_webp=params.get('generate_webp', False),
            )
            return {"success": True, "operation": operation, "queued": len(media_ids)}
        except Exception as e:
            logger.error(f"Failed to queue batch task: {e}")
            raise HTTPException(status_code=500, detail={"code": "internal_error", "message": "Failed to queue batch operation"})


# ============================================================================
# Route 16: List versions
# ============================================================================


@router.get("/api/organizations/{organization_id}/media/{media_id}/versions", response_model=MediaVersionListResponse, summary="List media versions")
def list_media_versions(
    organization_id: UUID,
    media_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_VIEW)),
    db: Session = Depends(get_db),
):
    """List media versions."""
    media = _get_media_or_404(db, organization_id, media_id)

    versions = db.query(MediaVersion).filter(
        MediaVersion.media_id == media_id,
    ).order_by(MediaVersion.version_number.desc()).all()

    return {
        "media_id": str(media_id),
        "current_version": media.current_version,
        "versions": [
            {
                "version_id": str(v.version_id),
                "version_number": v.version_number,
                "file_size": v.file_size,
                "checksum_sha256": v.checksum_sha256,
                "change_note": v.change_note,
                "created_by": str(v.created_by) if v.created_by else None,
                "created_at": v.created_at.isoformat() if v.created_at else None,
            }
            for v in versions
        ],
    }


# ============================================================================
# Route 17: Upload new version
# ============================================================================


@router.post("/api/organizations/{organization_id}/media/{media_id}/versions", status_code=201, response_model=UploadVersionResponse, summary="Upload media version")
def upload_media_version(
    organization_id: UUID,
    media_id: UUID,
    file: UploadFile = File(...),
    change_note: str = Form(''),
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Upload media version."""
    media = _get_media_or_404(db, organization_id, media_id)

    if not file.filename:
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "No filename provided"})

    content_type = file.content_type or media.mime_type

    version = MediaVersion(
        media_id=media_id,
        organization_id=organization_id,
        version_number=media.current_version,
        s3_key=media.s3_key,
        filename=media.filename,
        file_size=media.file_size,
        mime_type=media.mime_type,
        checksum_sha256=media.checksum_sha256,
        width=media.width,
        height=media.height,
        duration_seconds=media.duration_seconds,
        change_note=change_note,
        created_by=auth.user_id,
    )
    db.add(version)

    try:
        s3_key, file_size = upload_org_media(
            organization_id=str(organization_id),
            file_data=file.file,
            content_type=content_type,
            media_type=MediaType(media.media_type),
            filename=file.filename,
            db_session=db,
        )
    except StorageLimitExceeded as e:
        raise HTTPException(status_code=413, detail={"code": "STORAGE_LIMIT_EXCEEDED", "message": sanitize_error_message(e)})

    media.s3_key = s3_key
    media.file_size = file_size
    media.filename = file.filename
    media.mime_type = content_type
    media.current_version += 1
    media.updated_at = datetime.now(timezone.utc)
    media.checksum_sha256 = None
    media.processing_status = 'pending'

    db.commit()

    if media.media_type == 'image':
        try:
            from app.tasks.media import process_upload_task
            process_upload_task.delay(str(media_id), str(organization_id))
        except Exception as e:
            logger.warning(f"Failed to queue processing for new version: {e}")

    return {
        "success": True,
        "media_id": str(media_id),
        "version": media.current_version,
        "previous_version_id": str(version.version_id),
    }


# ============================================================================
# Route 18: Restore version
# ============================================================================


@router.post("/api/organizations/{organization_id}/media/{media_id}/versions/{version_id}/restore", response_model=RestoreVersionResponse, summary="Restore media version")
def restore_media_version(
    organization_id: UUID,
    media_id: UUID,
    version_id: UUID,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Restore media version."""
    media = _get_media_or_404(db, organization_id, media_id)

    version = db.query(MediaVersion).filter(
        MediaVersion.version_id == version_id,
        MediaVersion.media_id == media_id,
    ).first()
    if not version:
        raise HTTPException(status_code=404, detail={"code": "not_found", "message": "Version not found"})

    current_version = MediaVersion(
        media_id=media_id,
        organization_id=organization_id,
        version_number=media.current_version,
        s3_key=media.s3_key,
        filename=media.filename,
        file_size=media.file_size,
        mime_type=media.mime_type,
        checksum_sha256=media.checksum_sha256,
        width=media.width,
        height=media.height,
        duration_seconds=media.duration_seconds,
        change_note=f"Replaced by restore of version {version.version_number}",
        created_by=auth.user_id,
    )
    db.add(current_version)

    media.s3_key = version.s3_key
    media.file_size = version.file_size
    media.checksum_sha256 = version.checksum_sha256
    media.current_version += 1
    media.updated_at = datetime.now(timezone.utc)
    media.processing_status = 'pending'

    db.commit()

    if media.media_type == 'image':
        try:
            from app.tasks.media import regenerate_derivatives_task
            regenerate_derivatives_task.delay(str(media_id), str(organization_id))
        except Exception as e:
            logger.warning(f"Failed to queue derivative regeneration: {e}")

    return {
        "success": True,
        "media_id": str(media_id),
        "restored_from_version": version.version_number,
        "new_version": media.current_version,
    }


# ============================================================================
# Route 19: Transcode video
# ============================================================================


@router.post("/api/organizations/{organization_id}/media/{media_id}/transcode", response_model=TranscodeResponse, summary="Transcode video")
async def transcode_video(
    organization_id: UUID,
    media_id: UUID,
    request: Request,
    auth: AuthContext = Depends(require_permission(Permission.MEDIA_EDIT)),
    db: Session = Depends(get_db),
):
    """Transcode video."""
    media = _get_media_or_404(db, organization_id, media_id)

    if media.media_type != 'video':
        raise HTTPException(status_code=400, detail={"code": "bad_request", "message": "Only videos can be transcoded"})

    try:
        data = await request.json()
    except Exception:
        data = {}
    derivatives = data.get('derivatives')
    extract_poster = data.get('extract_poster', True)

    from app.services.video_transcoding import is_video_transcoding_available
    if not is_video_transcoding_available():
        raise HTTPException(status_code=503, detail={"code": "service_unavailable", "message": "Video transcoding is not configured"})

    from app.tasks.media import transcode_video_task
    task = transcode_video_task.delay(
        str(media_id), str(organization_id),
        derivatives=derivatives, extract_poster=extract_poster,
    )

    media.processing_status = 'processing'
    db.commit()

    return {
        "success": True,
        "media_id": str(media_id),
        "task_id": task.id,
        "message": "Video transcoding started",
    }
