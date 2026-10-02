"""
Google Cloud Storage backend implementation.

This implementation supports:
- GCS with service account credentials (JSON key file)
- GCS with application default credentials
- GCS with explicit credentials dict
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from functools import partial
from io import BytesIO
from typing import AsyncIterator, BinaryIO, Optional

from app.services.storage.base import (
    ObjectNotFoundError,
    PresignedUrlResult,
    StorageBackend,
    StorageError,
    StorageObject,
)

logger = logging.getLogger(__name__)

# Thread pool for running sync GCS operations
_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="gcs-storage")


def _run_sync(func, *args, **kwargs):
    """Run a sync function in the thread pool."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_executor, partial(func, *args, **kwargs))


# Check if GCS SDK is available
try:
    from google.cloud import storage as gcs_storage
    from google.cloud.exceptions import NotFound, GoogleCloudError
    from google.oauth2 import service_account
    GCS_SDK_AVAILABLE = True
except ImportError:
    GCS_SDK_AVAILABLE = False
    logger.warning("Google Cloud Storage SDK not available - install google-cloud-storage")


class GCSStorageBackend(StorageBackend):
    """
    Google Cloud Storage backend.

    Supports multiple authentication methods:
    - Service account JSON key file
    - Service account credentials dict
    - Application default credentials (gcloud auth, GCE metadata, etc.)

    Example usage:
        # With service account key file
        storage = GCSStorageBackend(
            bucket="my-media-bucket",
            project_id="my-project",
            credentials_file="/path/to/service-account.json",
        )

        # With credentials dict (from encrypted config)
        storage = GCSStorageBackend(
            bucket="my-media-bucket",
            project_id="my-project",
            credentials_dict={
                "type": "service_account_key",
                "project_id": "your-project",
                "private_key_id": "key-id",
                ...
            },
        )

        # With application default credentials
        storage = GCSStorageBackend(
            bucket="my-media-bucket",
            project_id="my-project",
        )
    """

    def __init__(
        self,
        bucket: str,
        project_id: Optional[str] = None,
        credentials_file: Optional[str] = None,
        credentials_dict: Optional[dict] = None,
        region: str = "us",  # GCS uses multi-region or regional buckets
    ):
        """
        Initialize GCS storage backend.

        Args:
            bucket: GCS bucket name
            project_id: Google Cloud project ID
            credentials_file: Path to service account JSON key file
            credentials_dict: Service account credentials as dict
            region: Region identifier (for compatibility)
        """
        if not GCS_SDK_AVAILABLE:
            raise ImportError(
                "Google Cloud Storage SDK not available. "
                "Install with: pip install google-cloud-storage"
            )

        self._bucket_name = bucket
        self._project_id = project_id
        self._region = region

        # Initialize client based on authentication method
        if credentials_file:
            credentials = service_account.Credentials.from_service_account_file(
                credentials_file
            )
            self._client = gcs_storage.Client(
                project=project_id,
                credentials=credentials,
            )

        elif credentials_dict:
            credentials = service_account.Credentials.from_service_account_info(
                credentials_dict
            )
            self._client = gcs_storage.Client(
                project=project_id or credentials_dict.get("project_id"),
                credentials=credentials,
            )
            if not self._project_id:
                self._project_id = credentials_dict.get("project_id")

        else:
            # Use application default credentials
            self._client = gcs_storage.Client(project=project_id)

        # Get bucket reference
        self._bucket = self._client.bucket(bucket)

        logger.info(
            "Initialized GCSStorageBackend: bucket=%s, project=%s",
            bucket,
            self._project_id,
        )

    @property
    def provider_name(self) -> str:
        return "gcs"

    @property
    def bucket_name(self) -> str:
        return self._bucket_name

    @property
    def region(self) -> str:
        return self._region

    # -------------------------------------------------------------------------
    # Async methods (run sync operations in thread pool)
    # -------------------------------------------------------------------------

    async def put_object(
        self,
        key: str,
        body: bytes | BinaryIO,
        content_type: Optional[str] = None,
        metadata: Optional[dict[str, str]] = None,
        cache_control: Optional[str] = None,
        tags: Optional[dict[str, str]] = None,
    ) -> StorageObject:
        return await _run_sync(
            self.put_object_sync,
            key=key,
            body=body,
            content_type=content_type,
            metadata=metadata,
            cache_control=cache_control,
        )

    async def get_object(self, key: str) -> tuple[bytes, StorageObject]:
        return await _run_sync(self.get_object_sync, key)

    async def get_object_stream(self, key: str) -> tuple[AsyncIterator[bytes], StorageObject]:
        # Download fully and yield chunks
        data, obj = await self.get_object(key)

        async def chunk_generator():
            chunk_size = 1024 * 1024  # 1MB chunks
            for i in range(0, len(data), chunk_size):
                yield data[i:i + chunk_size]

        return chunk_generator(), obj

    async def delete_object(self, key: str) -> bool:
        return await _run_sync(self.delete_object_sync, key)

    async def delete_objects(self, keys: list[str]) -> list[str]:
        return await _run_sync(self.delete_objects_sync, keys)

    async def list_objects(
        self,
        prefix: str,
        max_keys: int = 1000,
        continuation_token: Optional[str] = None,
    ) -> tuple[list[StorageObject], Optional[str]]:
        return await _run_sync(
            self.list_objects_sync,
            prefix=prefix,
            max_keys=max_keys,
            continuation_token=continuation_token,
        )

    async def head_object(self, key: str) -> Optional[StorageObject]:
        return await _run_sync(self.head_object_sync, key)

    async def object_exists(self, key: str) -> bool:
        return await _run_sync(self.object_exists_sync, key)

    async def generate_presigned_upload_url(
        self,
        key: str,
        content_type: str,
        expires_in: int = 3600,
        content_length_range: Optional[tuple[int, int]] = None,
    ) -> PresignedUrlResult:
        return await _run_sync(
            self.generate_presigned_upload_url_sync,
            key=key,
            content_type=content_type,
            expires_in=expires_in,
        )

    async def generate_presigned_download_url(
        self,
        key: str,
        expires_in: int = 3600,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> str:
        return await _run_sync(
            self.generate_presigned_download_url_sync,
            key=key,
            expires_in=expires_in,
            filename=filename,
        )

    async def copy_object(
        self,
        source_key: str,
        dest_key: str,
        metadata: Optional[dict[str, str]] = None,
    ) -> StorageObject:
        return await _run_sync(
            self.copy_object_sync,
            source_key=source_key,
            dest_key=dest_key,
            metadata=metadata,
        )

    async def get_object_url(self, key: str) -> str:
        """Get the canonical GCS URL."""
        return f"gs://{self._bucket_name}/{key}"

    # -------------------------------------------------------------------------
    # Sync methods (actual implementations)
    # -------------------------------------------------------------------------

    def put_object_sync(
        self,
        key: str,
        body: bytes | BinaryIO,
        content_type: Optional[str] = None,
        metadata: Optional[dict[str, str]] = None,
        cache_control: Optional[str] = None,
    ) -> StorageObject:
        """Synchronous version of put_object."""
        try:
            blob = self._bucket.blob(key)

            # Set metadata
            if content_type:
                blob.content_type = content_type
            if cache_control:
                blob.cache_control = cache_control
            if metadata:
                blob.metadata = metadata

            # Handle bytes vs file-like object
            if isinstance(body, bytes):
                blob.upload_from_string(body, content_type=content_type)
            else:
                blob.upload_from_file(body, content_type=content_type)

            # Reload to get updated properties
            blob.reload()

            return StorageObject(
                key=key,
                size=blob.size,
                content_type=blob.content_type,
                last_modified=blob.updated,
                etag=blob.etag,
                metadata=dict(blob.metadata) if blob.metadata else {},
            )

        except GoogleCloudError as e:
            logger.error("Failed to upload object %s: %s", key, e)
            raise StorageError(f"Failed to upload object: {e}", key=key, cause=e)

    def get_object_sync(self, key: str) -> tuple[bytes, StorageObject]:
        """Synchronous version of get_object."""
        try:
            blob = self._bucket.blob(key)

            # Check if blob exists
            if not blob.exists():
                raise ObjectNotFoundError(f"Object not found: {key}", key=key)

            # Download content
            data = blob.download_as_bytes()

            obj = StorageObject(
                key=key,
                size=blob.size,
                content_type=blob.content_type,
                last_modified=blob.updated,
                etag=blob.etag,
                metadata=dict(blob.metadata) if blob.metadata else {},
            )

            return data, obj

        except NotFound:
            raise ObjectNotFoundError(f"Object not found: {key}", key=key)
        except GoogleCloudError as e:
            logger.error("Failed to download object %s: %s", key, e)
            raise StorageError(f"Failed to download object: {e}", key=key, cause=e)

    def delete_object_sync(self, key: str) -> bool:
        """Synchronous version of delete_object."""
        try:
            blob = self._bucket.blob(key)
            blob.delete()
            return True
        except NotFound:
            return False
        except GoogleCloudError as e:
            logger.error("Failed to delete object %s: %s", key, e)
            raise StorageError(f"Failed to delete object: {e}", key=key, cause=e)

    def delete_objects_sync(self, keys: list[str]) -> list[str]:
        """Synchronous version of delete_objects."""
        if not keys:
            return []

        failed_keys = []

        # GCS supports batch delete, but we'll do individual deletes for simplicity
        # and better error handling per key
        for key in keys:
            try:
                self.delete_object_sync(key)
            except (StorageError, Exception) as e:
                logger.warning("Failed to delete object %s: %s", key, e)
                failed_keys.append(key)

        return failed_keys

    def list_objects_sync(
        self,
        prefix: str,
        max_keys: int = 1000,
        continuation_token: Optional[str] = None,
    ) -> tuple[list[StorageObject], Optional[str]]:
        """Synchronous version of list_objects."""
        try:
            # List blobs with prefix
            blobs = self._client.list_blobs(
                self._bucket_name,
                prefix=prefix,
                max_results=max_keys,
                page_token=continuation_token,
            )

            objects = []
            for blob in blobs:
                objects.append(StorageObject(
                    key=blob.name,
                    size=blob.size,
                    content_type=blob.content_type,
                    last_modified=blob.updated,
                    etag=blob.etag,
                ))
                if len(objects) >= max_keys:
                    break

            # Get next page token
            next_token = blobs.next_page_token

            return objects, next_token

        except GoogleCloudError as e:
            logger.error("Failed to list objects with prefix %s: %s", prefix, e)
            raise StorageError(f"Failed to list objects: {e}", cause=e)

    def head_object_sync(self, key: str) -> Optional[StorageObject]:
        """Synchronous version of head_object."""
        try:
            blob = self._bucket.blob(key)

            if not blob.exists():
                return None

            # Reload to ensure we have current metadata
            blob.reload()

            return StorageObject(
                key=key,
                size=blob.size,
                content_type=blob.content_type,
                last_modified=blob.updated,
                etag=blob.etag,
                metadata=dict(blob.metadata) if blob.metadata else {},
            )

        except NotFound:
            return None
        except GoogleCloudError as e:
            logger.error("Failed to get object properties %s: %s", key, e)
            raise StorageError(f"Failed to get object properties: {e}", key=key, cause=e)

    def object_exists_sync(self, key: str) -> bool:
        """Synchronous version of object_exists."""
        try:
            blob = self._bucket.blob(key)
            return blob.exists()
        except GoogleCloudError as e:
            logger.error("Failed to check object existence %s: %s", key, e)
            raise StorageError(f"Failed to check object existence: {e}", key=key, cause=e)

    def generate_presigned_upload_url_sync(
        self,
        key: str,
        content_type: str,
        expires_in: int = 3600,
    ) -> PresignedUrlResult:
        """Generate a signed URL for direct upload."""
        try:
            blob = self._bucket.blob(key)

            expiry_time = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

            url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(seconds=expires_in),
                method="PUT",
                content_type=content_type,
            )

            return PresignedUrlResult(
                url=url,
                expires_at=expiry_time,
                headers={"Content-Type": content_type},
                method="PUT",
            )

        except Exception as e:
            logger.error("Failed to generate upload signed URL for %s: %s", key, e)
            raise StorageError(f"Failed to generate upload URL: {e}", key=key, cause=e)

    def generate_presigned_download_url_sync(
        self,
        key: str,
        expires_in: int = 3600,
        filename: Optional[str] = None,
    ) -> str:
        """Generate a signed URL for download."""
        try:
            blob = self._bucket.blob(key)

            # Build response disposition if filename provided
            response_disposition = None
            if filename:
                response_disposition = f'attachment; filename="{filename}"'

            url = blob.generate_signed_url(
                version="v4",
                expiration=timedelta(seconds=expires_in),
                method="GET",
                response_disposition=response_disposition,
            )

            return url

        except Exception as e:
            logger.error("Failed to generate download signed URL for %s: %s", key, e)
            raise StorageError(f"Failed to generate download URL: {e}", key=key, cause=e)

    def copy_object_sync(
        self,
        source_key: str,
        dest_key: str,
        metadata: Optional[dict[str, str]] = None,
    ) -> StorageObject:
        """Synchronous version of copy_object."""
        try:
            source_blob = self._bucket.blob(source_key)
            dest_blob = self._bucket.blob(dest_key)

            # Check source exists
            if not source_blob.exists():
                raise ObjectNotFoundError(f"Source object not found: {source_key}", key=source_key)

            # Copy the blob
            self._bucket.copy_blob(source_blob, self._bucket, dest_key)

            # Reload to get properties
            dest_blob.reload()

            # Update metadata if provided
            if metadata:
                dest_blob.metadata = metadata
                dest_blob.patch()
                dest_blob.reload()

            return StorageObject(
                key=dest_key,
                size=dest_blob.size,
                content_type=dest_blob.content_type,
                last_modified=dest_blob.updated,
                etag=dest_blob.etag,
                metadata=dict(dest_blob.metadata) if dest_blob.metadata else {},
            )

        except NotFound:
            raise ObjectNotFoundError(f"Source object not found: {source_key}", key=source_key)
        except GoogleCloudError as e:
            logger.error("Failed to copy object from %s to %s: %s", source_key, dest_key, e)
            raise StorageError(f"Failed to copy object: {e}", key=dest_key, cause=e)
