"""
S3 Folder Watch service (StaticSync equivalent).

Handles S3 Event Notifications via SQS to auto-create
Media records for new files in watched prefixes.
"""

import json
import logging
import mimetypes
from typing import Any
from uuid import UUID

from app.database import current_session

logger = logging.getLogger(__name__)


def handle_s3_event(event: dict[str, Any]) -> dict[str, Any]:
    """
    Handle an S3 event notification (typically from SQS).

    Creates Media records for new objects in watched prefixes.

    Args:
        event: S3 event notification dict

    Returns:
        Dict with processing results
    """
    from app.models import Media
    from app.tasks.media import process_upload_task

    records_processed = 0
    errors = []

    for record in event.get("Records", []):
        try:
            event_name = record.get("eventName", "")
            if not event_name.startswith("ObjectCreated"):
                continue

            s3_info = record.get("s3", {})
            bucket = s3_info.get("bucket", {}).get("name", "")
            key = s3_info.get("object", {}).get("key", "")
            file_size = s3_info.get("object", {}).get("size", 0)

            if not key:
                continue

            # Extract organization_id from S3 key pattern: orgs/{org_id}/media/...
            parts = key.split("/")
            if len(parts) < 3 or parts[0] != "orgs":
                logger.debug("Skipping non-org S3 key: %s", key)
                continue

            org_id_str = parts[1]
            try:
                org_id = UUID(org_id_str)
            except ValueError:
                logger.debug("Invalid org_id in S3 key: %s", key)
                continue

            # Check if media already exists for this key
            existing = current_session().query(Media).filter_by(s3_key=key).first()
            if existing:
                continue

            # Detect MIME and media type
            filename = parts[-1]
            mime_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"

            from app.services.uploads import detect_media_type
            media_type = detect_media_type(mime_type)

            # Create Media record
            media = Media(
                organization_id=org_id,
                s3_key=key,
                filename=filename,
                file_size=file_size,
                mime_type=mime_type,
                media_type=media_type,
                processing_status="pending",
            )
            current_session().add(media)
            current_session().commit()

            # Trigger processing
            process_upload_task.delay(
                media_id=str(media.media_id),
                organization_id=org_id_str,
            )

            records_processed += 1
            logger.info("Auto-created media %s from S3 event: %s", media.media_id, key)

        except Exception as e:
            logger.error("Failed to process S3 event record: %s", e)
            errors.append(str(e))
            current_session().rollback()

    return {
        "processed": records_processed,
        "errors": errors,
    }
