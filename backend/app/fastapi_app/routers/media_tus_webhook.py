"""
TUS upload webhook handlers (FastAPI).

  - POST /hooks/tus/pre-create — quota check, BEFORE tusd accepts any bytes
  - POST /hooks/tus/complete   — registers the finished upload

The pre-create hook exists because the storage quota was unreachable on this
path. tusd was wired with `-hooks-enabled-events post-finish` only, so it
accepted and wrote the whole file before the application heard about it, and
`check_storage_limit()` — which every other upload route calls — had nowhere
to run. The frontend sends every file over 10 MB through TUS
(uploadStore.ts), so the quota held for small files and lapsed for exactly
the large ones it exists to catch.

Rejecting at pre-create is tusd's designed mechanism for this: a non-2xx
response refuses the upload before a byte is stored, and tusd passes the
status and body back to the client.

One limit worth knowing: the size at pre-create is the client's declared
upload length, not a measurement. It stops an honest client from overrunning
the quota; it does not stop a dishonest one, which wants tusd's own
`-max-size` and a reconciliation after post-finish.
"""

import hmac
import logging
import mimetypes
import os
import uuid as uuid_mod
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.fastapi_app.schemas.media_tus_webhook import TusUploadCompleteResponse

logger = logging.getLogger(__name__)

router = APIRouter(tags=["media-tus"])


def _authenticate_hook(request: Request) -> None:
    """Shared gate for both hooks: TUS enabled, and the secret matches.

    Fails closed. If TUS is on but no secret is configured the request is
    refused rather than trusting attacker-controlled upload metadata.
    """
    settings = get_settings()
    if not settings.tus_enabled:
        raise HTTPException(status_code=404, detail="TUS uploads are not enabled")

    if not settings.tus_webhook_secret:
        logger.error("TUS webhook rejected: tus_webhook_secret is not configured")
        raise HTTPException(
            status_code=503,
            detail="TUS webhook is not configured (missing shared secret)",
        )
    hook_secret = request.headers.get("x-hook-secret", "")
    if not hmac.compare_digest(hook_secret, settings.tus_webhook_secret):
        logger.warning("TUS webhook rejected: invalid or missing X-Hook-Secret")
        raise HTTPException(status_code=403, detail="Unauthorized")


def _upload_payload(data: dict) -> dict:
    """The Upload object, whichever shape tusd sent.

    tusd v1 posts {"Upload": {...}}; v2 wraps it as
    {"Type": "...", "Event": {"Upload": {...}}}. Accepting both means the
    hook does not silently pass everything through after a tusd upgrade —
    a quota check that reads no size would allow every upload.
    """
    if "Event" in data and isinstance(data["Event"], dict):
        return data["Event"].get("Upload", {}) or {}
    return data.get("Upload", {}) or {}


def _hook_type(request: Request, data: dict) -> str:
    """Which hook tusd is calling.

    tusd posts every enabled event to the SAME configured URL — it does not
    append the event name — so the endpoint has to dispatch on the type.
    v2 puts it in the body as `Type`; v1 sends a `Hook-Name` header.
    """
    return (data.get("Type") or request.headers.get("hook-name") or "").strip()


@router.post("/hooks/tus", summary="Tus hook dispatcher")
async def tus_hook(
    request: Request,
    db: Session = Depends(get_db),
):
    """Single endpoint for every tusd hook, dispatched by type.

    This is what `-hooks-http` should point at. The per-event routes below
    remain: deployments configured against the older `/hooks/tus/complete`
    URL keep working, and they are the honest thing to exercise in tests.
    """
    _authenticate_hook(request)
    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail="Missing request body")

    kind = _hook_type(request, data)
    if kind == "pre-create":
        return await _pre_create(data, db)
    if kind in ("post-finish", ""):
        # Empty type keeps a v1 tusd that sends no discriminator working the
        # way it did before this hook existed.
        return await _complete(data, db)

    logger.debug("ignoring tus hook %r", kind)
    return JSONResponse(status_code=200, content={})


@router.post("/hooks/tus/pre-create", summary="Tus pre-create quota check")
async def tus_pre_create(
    request: Request,
    db: Session = Depends(get_db),
):
    """Refuse an upload that would exceed the organization's storage quota.

    Returning non-2xx tells tusd to reject before storing anything.
    """
    _authenticate_hook(request)

    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail="Missing request body")

    return await _pre_create(data, db)


async def _pre_create(data: dict, db: Session):
    upload = _upload_payload(data)
    metadata = upload.get("MetaData", {}) or {}
    organization_id = metadata.get("organization_id")

    if not organization_id:
        raise HTTPException(
            status_code=400, detail="Missing organization_id in upload metadata"
        )

    declared_size = upload.get("Size") or 0
    if upload.get("SizeIsDeferred"):
        # No length up front, so there is nothing to check against. Allowing it
        # is the honest outcome — refusing every deferred upload would break
        # streaming clients to enforce a limit we cannot evaluate — but it is a
        # hole, and tusd's -max-size is what closes it.
        logger.warning(
            "TUS pre-create for org %s has a deferred size; quota not checked",
            organization_id,
        )
        return JSONResponse(status_code=200, content={})

    from app.services.uploads import StorageLimitExceeded, check_storage_limit

    try:
        check_storage_limit(organization_id, int(declared_size), db)
    except StorageLimitExceeded as exc:
        logger.info(
            "TUS upload refused for org %s: %s", organization_id, exc
        )
        # 413 matches what the non-TUS upload routes return for the same
        # condition, so a client sees one behaviour regardless of which path
        # its file took.
        return JSONResponse(
            status_code=413,
            content={
                "code": "STORAGE_LIMIT_EXCEEDED",
                "message": str(exc),
            },
        )
    except ValueError as exc:
        # Unknown organization — check_storage_limit raises this.
        raise HTTPException(status_code=404, detail=str(exc))

    return JSONResponse(status_code=200, content={})


@router.post("/hooks/tus/complete", response_model=TusUploadCompleteResponse, summary="Tus upload complete")
async def tus_upload_complete(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Handle TUS upload completion webhook from tusd.

    Authenticates via X-Hook-Secret header (HMAC shared secret).
    No JWT auth required.
    """
    _authenticate_hook(request)

    data = await request.json()
    if not data:
        raise HTTPException(status_code=400, detail="Missing request body")

    return await _complete(data, db)


async def _complete(data: dict, db: Session):
    upload = _upload_payload(data)
    metadata = upload.get("MetaData", {}) or {}

    organization_id = metadata.get("organization_id")
    filename = metadata.get("filename", "unknown")
    folder_id = metadata.get("folder_id")
    title = metadata.get("title")
    created_by = metadata.get("created_by")

    if not organization_id:
        logger.error("TUS webhook missing organization_id")
        raise HTTPException(
            status_code=400, detail="Missing organization_id in upload metadata"
        )

    storage_path = upload.get("Storage", {}).get("Path", "")
    file_size = upload.get("Size", 0)

    if not storage_path or not os.path.exists(storage_path):
        logger.error("TUS file not found at %s", storage_path)
        raise HTTPException(status_code=404, detail="Upload file not found")

    try:
        from app.models import Media
        from app.services.uploads import (
            detect_media_type,
            get_media_bucket,
            get_s3_client,
                    DEFAULT_REGION,
        )

        mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        media_type = detect_media_type(mime_type)

        org_uuid = UUID(organization_id)
        # get_s3_client and get_media_bucket both take an AWS REGION, not an
        # organization id. Passing the org UUID made boto3 raise
        # "expected string or bytes-like object, got 'UUID'", and made the
        # bucket lookup log an "unsupported region" warning on every call.
        s3_client = get_s3_client()
        bucket = get_media_bucket(DEFAULT_REGION)

        # Generate S3 key: orgs/{org_id}/media/{type}s/{date}_{unique}.{ext}
        ext = os.path.splitext(filename)[1].lstrip(".") or "bin"
        unique_id = uuid_mod.uuid4().hex[:12]
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        media_folder = f"{media_type}s" if isinstance(media_type, str) else f"{media_type.value}s"
        s3_key = f"orgs/{organization_id}/media/{media_folder}/{timestamp}_{unique_id}.{ext}"

        with open(storage_path, "rb") as f:
            s3_client.upload_fileobj(f, bucket, s3_key)

        media = Media(
            organization_id=org_uuid,
            s3_key=s3_key,
            filename=filename,
            file_size=file_size,
            mime_type=mime_type,
            media_type=media_type,
            title=title,
            folder_id=UUID(folder_id) if folder_id else None,
            processing_status="pending",
            created_by=UUID(created_by) if created_by else None,
        )
        db.add(media)
        db.commit()

        # Clean up tusd file
        try:
            os.remove(storage_path)
            info_path = storage_path + ".info"
            if os.path.exists(info_path):
                os.remove(info_path)
        except OSError:
            pass

        # Trigger processing
        from app.tasks.media import process_upload_task

        process_upload_task.delay(
            media_id=str(media.media_id),
            organization_id=organization_id,
        )

        logger.info("TUS upload completed: %s -> media %s", filename, media.media_id)

        return {
            "success": True,
            "media_id": str(media.media_id),
            "status": "processing",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("TUS webhook processing failed")
        db.rollback()
        return JSONResponse(
            status_code=500,
            content={"error": str(e)},
        )
