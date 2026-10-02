"""
Media destination connector.

Reads media metadata from canonical entities (populated by source
connectors like TMS), locates the corresponding files on a configured
source path, uploads them into Madrona's DAM (S3 + Media table), and
links them to their CollectionObject via CollectionObjectMedia.

Configuration:
    media_source_path: Root directory where source media files are located.
        The connector resolves TMS-style paths (T:\\Images\\file.jpg) relative
        to this root. Required.
    folder_name: Optional DAM folder name to organize imported media into.

File matching:
    Each canonical entity has properties.media[] with entries like:
        {"file_name": "photo.jpg", "file_path": "T:/Images/photo.jpg", ...}
    The connector strips the drive/root prefix and looks for the file under
    media_source_path. E.g., with media_source_path="/data/tms-images" and
    file_path="T:/Images/photo.jpg", it looks for "/data/tms-images/photo.jpg".
"""

import logging
import mimetypes
import os
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from app.connectors.base import BaseTargetConnector

logger = logging.getLogger(__name__)

# Common image extensions → MIME types
MIME_MAP = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".pdf": "application/pdf",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
}


def _resolve_file_path(source_root: str, tms_path: str, file_name: str) -> str | None:
    """
    Resolve a TMS file path to a local file path.

    Tries several strategies:
    1. Direct: source_root / file_name
    2. Relative: source_root / subpath from TMS path
    3. Recursive search by filename in source_root
    """
    root = Path(source_root)

    # 1. Direct filename match
    direct = root / file_name
    if direct.exists():
        return str(direct)

    # 2. Try stripping drive letter and normalizing
    if tms_path:
        # Convert "T:/Images/subdir/file.jpg" or "T:\Images\subdir\file.jpg"
        normalized = tms_path.replace("\\", "/")
        # Strip drive letter if present (e.g., "T:/")
        if len(normalized) > 2 and normalized[1] == ":":
            normalized = normalized[2:]
        # Strip leading slashes
        normalized = normalized.lstrip("/")
        # Try the full relative path
        relative = root / normalized
        if relative.exists():
            return str(relative)
        # Try just the last two segments (subdir/file.jpg)
        parts = normalized.split("/")
        if len(parts) >= 2:
            short = root / parts[-2] / parts[-1]
            if short.exists():
                return str(short)

    return None


class MediaTargetConnector(BaseTargetConnector):
    """
    Target connector that imports media files into Madrona's DAM and links
    them to CollectionObjects.

    Reads media metadata from canonical entities, locates files on disk,
    uploads to S3, creates Media records, and links via CollectionObjectMedia.

    Configuration:
        media_source_path: Directory containing the source media files (required)
        folder_name: DAM folder name for imported media (default: "TMS Import")
        skip_existing: Skip files already imported (match by filename) (default: true)
    """

    direction = "target"

    def validate_config(self) -> None:
        source_path = self.config.get("media_source_path")
        if not source_path:
            raise ValueError("media_source_path is required")
        if not os.path.isdir(source_path):
            logger.warning("media_source_path '%s' does not exist yet", source_path)

    def publish_records(self, entities: list[dict[str, Any]]) -> None:
        """Import media files for each entity that has media metadata."""
        from app.database import get_session
        from app.models.media import Media, CollectionObjectMedia
        from app.models.objects import CollectionObject
        from app.services.uploads import upload_org_media

        source_path = self.config["media_source_path"]
        folder_name = self.config.get("folder_name", "TMS Import")
        skip_existing = self.config.get("skip_existing", True)
        org_id = UUID(str(self.organization_id))

        # get_session(), not next(get_db()): get_db is an async generator now —
        # it has to be, so the context session actually reaches the endpoint —
        # and next() cannot drive one. get_session() is the sync equivalent, and
        # it commits, rolls back and closes, so the rollback and close that were
        # here by hand are gone.
        with get_session() as db:
            try:
                stats = {"uploaded": 0, "linked": 0, "skipped": 0, "not_found": 0, "errors": 0}

                for entity in entities:
                    payload = entity.get("payload", {})
                    properties = payload.get("properties", {})
                    media_list = properties.get("media", [])
                    object_number = properties.get("object_number")

                    if not media_list or not object_number:
                        continue

                    # Find the CollectionObject
                    obj = db.query(CollectionObject).filter(
                        CollectionObject.organization_id == org_id,
                        CollectionObject.object_number == object_number,
                    ).first()

                    if not obj:
                        # Object hasn't been imported yet — skip media
                        continue

                    for media_entry in media_list:
                        file_name = media_entry.get("file_name")
                        if not file_name:
                            continue

                        # Check if already imported (by filename)
                        if skip_existing:
                            existing = db.query(Media).filter(
                                Media.organization_id == org_id,
                                Media.filename == file_name,
                            ).first()
                            if existing:
                                # Ensure link exists
                                link = db.query(CollectionObjectMedia).filter(
                                    CollectionObjectMedia.object_id == obj.object_id,
                                    CollectionObjectMedia.media_id == existing.media_id,
                                ).first()
                                if not link:
                                    db.add(CollectionObjectMedia(
                                        object_id=obj.object_id,
                                        media_id=existing.media_id,
                                        is_primary=bool(media_entry.get("primary_display")),
                                        sort_order=media_entry.get("rank", 0) or 0,
                                    ))
                                    stats["linked"] += 1
                                stats["skipped"] += 1
                                continue

                        # Resolve file path
                        tms_path = media_entry.get("file_path", "")
                        local_path = _resolve_file_path(source_path, tms_path, file_name)

                        if not local_path:
                            stats["not_found"] += 1
                            logger.debug(
                                "Media file not found: %s (source_path=%s, tms_path=%s)",
                                file_name, source_path, tms_path,
                            )
                            continue

                        # Determine MIME type
                        ext = os.path.splitext(file_name)[1].lower()
                        mime_type = MIME_MAP.get(ext)
                        if not mime_type:
                            mime_type, _ = mimetypes.guess_type(file_name)
                        if not mime_type:
                            stats["errors"] += 1
                            logger.warning("Cannot determine MIME type for: %s", file_name)
                            continue

                        # Upload to S3
                        try:
                            file_size = os.path.getsize(local_path)
                            with open(local_path, "rb") as f:
                                s3_key, uploaded_size = upload_org_media(
                                    organization_id=str(org_id),
                                    file_data=f,
                                    content_type=mime_type,
                                    filename=file_name,
                                    db_session=db,
                                    check_limits=False,  # Migration — don't enforce limits
                                )
                        except Exception as e:
                            stats["errors"] += 1
                            logger.warning("Failed to upload %s: %s", file_name, e)
                            continue

                        # Create Media record
                        media = Media(
                            organization_id=org_id,
                            s3_key=s3_key,
                            filename=file_name,
                            file_size=uploaded_size,
                            mime_type=mime_type,
                            media_type=self._media_type_from_mime(mime_type),
                            title=media_entry.get("description"),
                            copyright_status=media_entry.get("copyright") or None,
                            width=media_entry.get("pixel_w"),
                            height=media_entry.get("pixel_h"),
                            folder=folder_name,
                            processing_status="pending",
                            source="TMS Import",
                        )
                        db.add(media)
                        db.flush()

                        # Link to CollectionObject
                        db.add(CollectionObjectMedia(
                            object_id=obj.object_id,
                            media_id=media.media_id,
                            is_primary=bool(media_entry.get("primary_display")),
                            sort_order=media_entry.get("rank", 0) or 0,
                        ))

                        stats["uploaded"] += 1
                        stats["linked"] += 1

                db.commit()

                logger.info(
                    "Media import: uploaded=%d linked=%d skipped=%d not_found=%d errors=%d",
                    stats["uploaded"], stats["linked"], stats["skipped"],
                    stats["not_found"], stats["errors"],
                )
            except Exception:
                logger.exception("Media import failed")
                raise

    def publish_change_log(self, changes: list[dict[str, Any]]) -> None:
        """No-op — media changes don't need a separate change log."""
        pass

    @staticmethod
    def _media_type_from_mime(mime_type: str) -> str:
        """Map MIME type to Madrona media_type value."""
        if mime_type.startswith("image/"):
            return "image"
        elif mime_type.startswith("video/"):
            return "video"
        elif mime_type.startswith("audio/"):
            return "audio"
        elif mime_type in ("application/pdf",):
            return "document"
        return "document"
