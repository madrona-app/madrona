"""
Abstract base class for storage backends.

This module defines the StorageBackend protocol that all storage implementations
must follow, enabling seamless switching between AWS S3, Azure Blob Storage,
Google Cloud Storage, and S3-compatible services.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from datetime import datetime
from typing import AsyncIterator, BinaryIO, Optional
import logging

logger = logging.getLogger(__name__)


class StorageError(Exception):
    """Base exception for storage operations."""

    def __init__(self, message: str, key: str | None = None, cause: Exception | None = None):
        super().__init__(message)
        self.key = key
        self.cause = cause


class ObjectNotFoundError(StorageError):
    """Raised when an object is not found in storage."""

    pass


@dataclass
class StorageObject:
    """Metadata about a stored object."""

    key: str
    size: int
    content_type: Optional[str] = None
    last_modified: Optional[datetime] = None
    etag: Optional[str] = None
    metadata: dict[str, str] = field(default_factory=dict)

    def __repr__(self) -> str:
        return f"StorageObject(key={self.key!r}, size={self.size}, content_type={self.content_type!r})"


@dataclass
class PresignedUrlResult:
    """Result of generating a presigned URL for upload."""

    url: str
    expires_at: datetime
    headers: dict[str, str] = field(default_factory=dict)
    # For POST-based uploads (S3 presigned POST)
    fields: dict[str, str] = field(default_factory=dict)
    # HTTP method to use
    method: str = "PUT"

    def __repr__(self) -> str:
        return f"PresignedUrlResult(url={self.url[:50]}..., method={self.method})"


class StorageBackend(ABC):
    """
    Abstract base class for storage backends.

    All storage implementations (S3, S3-compatible, Azure, GCS) must implement these methods.
    Methods are async to support high-performance I/O operations.

    Example usage:
        storage = get_storage_backend(org_id, db_session)

        # Upload
        obj = await storage.put_object(
            key="orgs/123/media/images/photo.jpg",
            body=file_data,
            content_type="image/jpeg",
        )

        # Download
        body, obj = await storage.get_object("orgs/123/media/images/photo.jpg")

        # Generate presigned URL
        url = await storage.generate_presigned_download_url(
            key="orgs/123/media/images/photo.jpg",
            expires_in=3600,
        )
    """

    @abstractmethod
    async def put_object(
        self,
        key: str,
        body: bytes | BinaryIO,
        content_type: Optional[str] = None,
        metadata: Optional[dict[str, str]] = None,
        cache_control: Optional[str] = None,
        tags: Optional[dict[str, str]] = None,
    ) -> StorageObject:
        """
        Upload an object to storage.

        Args:
            key: Object key (path within the bucket/container)
            body: File content as bytes or file-like object
            content_type: MIME type of the content
            metadata: Custom metadata key-value pairs
            cache_control: Cache-Control header value
            tags: Object tags (for lifecycle policies, etc.)

        Returns:
            StorageObject with metadata about the uploaded object

        Raises:
            StorageError: If upload fails
        """
        pass

    @abstractmethod
    async def get_object(self, key: str) -> tuple[bytes, StorageObject]:
        """
        Download an object from storage.

        Args:
            key: Object key

        Returns:
            Tuple of (content bytes, StorageObject metadata)

        Raises:
            ObjectNotFoundError: If object doesn't exist
            StorageError: If download fails
        """
        pass

    @abstractmethod
    async def get_object_stream(self, key: str) -> tuple[AsyncIterator[bytes], StorageObject]:
        """
        Stream an object from storage (for large files).

        Args:
            key: Object key

        Returns:
            Tuple of (async iterator of bytes, StorageObject metadata)

        Raises:
            ObjectNotFoundError: If object doesn't exist
            StorageError: If download fails
        """
        pass

    @abstractmethod
    async def delete_object(self, key: str) -> bool:
        """
        Delete an object from storage.

        Args:
            key: Object key

        Returns:
            True if deleted successfully, False if object didn't exist

        Raises:
            StorageError: If delete fails for reasons other than object not existing
        """
        pass

    # ---- Synchronous variants -------------------------------------------
    #
    # Most of this codebase is synchronous: Celery tasks, and FastAPI handlers
    # declared `def` rather than `async def`. Every backend already provided
    # these, and the interface declared none of them — which made the async
    # methods above a trap. `storage.delete_object(key)` in a sync function
    # builds a coroutine, never runs it, and raises nothing: the operation
    # silently does not happen, a surrounding try/except sees success, and the
    # caller proceeds to delete the row that recorded the key. That shipped,
    # and every "deleted" guide document is still in its bucket.
    #
    # Declaring them here makes the sync surface a contract instead of a
    # coincidence, and gives sync callers something obvious to reach for.
    # Only the methods all backends implement are declared; copy_object_sync
    # and object_exists_sync exist on GCS and Azure but not S3.
    #
    # tests/test_lint_unawaited_storage.py fails the build if a sync caller
    # reaches for an async method again.

    @abstractmethod
    def delete_object_sync(self, key: str) -> bool:
        """Delete an object. True if deleted, False if it did not exist."""
        pass

    @abstractmethod
    def delete_objects_sync(self, keys: list[str]) -> list[str]:
        """Delete many objects. Returns the keys that were deleted."""
        pass

    @abstractmethod
    def get_object_sync(self, key: str) -> tuple[bytes, "StorageObject"]:
        """Fetch an object's bytes and metadata.

        Raises ObjectNotFoundError if the key does not exist — callers that
        mean "check for existence" want head_object_sync instead.
        """
        pass

    @abstractmethod
    def put_object_sync(
        self,
        key: str,
        body: bytes,
        content_type: str | None = None,
        metadata: dict | None = None,
    ) -> "StorageObject":
        """Store an object."""
        pass

    @abstractmethod
    def head_object_sync(self, key: str) -> Optional["StorageObject"]:
        """Object metadata, or None if it does not exist. Does not raise."""
        pass

    @abstractmethod
    def list_objects_sync(
        self,
        prefix: str = "",
        max_keys: int = 1000,
    ) -> list["StorageObject"]:
        """List objects under a prefix."""
        pass

    @abstractmethod
    def generate_presigned_download_url_sync(
        self,
        key: str,
        expires_in: int = 3600,
    ) -> "PresignedUrlResult":
        """A time-limited download URL."""
        pass

    @abstractmethod
    def generate_presigned_upload_url_sync(
        self,
        key: str,
        expires_in: int = 3600,
        content_type: str | None = None,
    ) -> "PresignedUrlResult":
        """A time-limited upload URL."""
        pass

    @abstractmethod
    async def delete_objects(self, keys: list[str]) -> list[str]:
        """
        Delete multiple objects from storage.

        Args:
            keys: List of object keys to delete

        Returns:
            List of keys that failed to delete (empty if all succeeded)

        Raises:
            StorageError: If the bulk delete operation fails entirely
        """
        pass

    @abstractmethod
    async def list_objects(
        self,
        prefix: str,
        max_keys: int = 1000,
        continuation_token: Optional[str] = None,
    ) -> tuple[list[StorageObject], Optional[str]]:
        """
        List objects with a given prefix.

        Args:
            prefix: Key prefix to filter objects
            max_keys: Maximum number of objects to return
            continuation_token: Token for pagination

        Returns:
            Tuple of (list of StorageObjects, next continuation token or None)

        Raises:
            StorageError: If listing fails
        """
        pass

    async def list_objects_iter(
        self,
        prefix: str,
        max_keys: int = 1000,
    ) -> AsyncIterator[StorageObject]:
        """
        Iterate over all objects with a given prefix (handles pagination).

        Args:
            prefix: Key prefix to filter objects
            max_keys: Maximum number of objects per page

        Yields:
            StorageObject for each object found
        """
        continuation_token = None
        while True:
            objects, next_token = await self.list_objects(
                prefix=prefix,
                max_keys=max_keys,
                continuation_token=continuation_token,
            )
            for obj in objects:
                yield obj
            if next_token is None:
                break
            continuation_token = next_token

    @abstractmethod
    async def head_object(self, key: str) -> Optional[StorageObject]:
        """
        Get object metadata without downloading the content.

        Args:
            key: Object key

        Returns:
            StorageObject with metadata, or None if object doesn't exist

        Raises:
            StorageError: If the operation fails for reasons other than object not existing
        """
        pass

    @abstractmethod
    async def object_exists(self, key: str) -> bool:
        """
        Check if an object exists.

        Args:
            key: Object key

        Returns:
            True if object exists, False otherwise
        """
        pass

    @abstractmethod
    async def generate_presigned_upload_url(
        self,
        key: str,
        content_type: str,
        expires_in: int = 3600,
        content_length_range: Optional[tuple[int, int]] = None,
    ) -> PresignedUrlResult:
        """
        Generate a presigned URL for direct client upload.

        Args:
            key: Object key where the file will be uploaded
            content_type: Expected MIME type of the upload
            expires_in: URL expiry time in seconds (default 1 hour)
            content_length_range: Optional (min, max) content length in bytes

        Returns:
            PresignedUrlResult with URL and required headers/fields

        Raises:
            StorageError: If URL generation fails
        """
        pass

    @abstractmethod
    async def generate_presigned_download_url(
        self,
        key: str,
        expires_in: int = 3600,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> str:
        """
        Generate a presigned URL for download.

        Args:
            key: Object key
            expires_in: URL expiry time in seconds (default 1 hour)
            filename: Optional filename for Content-Disposition header
            content_type: Optional Content-Type override

        Returns:
            Presigned URL string

        Raises:
            StorageError: If URL generation fails
        """
        pass

    @abstractmethod
    async def copy_object(
        self,
        source_key: str,
        dest_key: str,
        metadata: Optional[dict[str, str]] = None,
    ) -> StorageObject:
        """
        Copy an object within the same backend.

        Args:
            source_key: Source object key
            dest_key: Destination object key
            metadata: Optional new metadata (if None, copies source metadata)

        Returns:
            StorageObject for the new copy

        Raises:
            ObjectNotFoundError: If source object doesn't exist
            StorageError: If copy fails
        """
        pass

    @abstractmethod
    async def get_object_url(self, key: str) -> str:
        """
        Get the canonical URL for an object (may require authentication).

        Args:
            key: Object key

        Returns:
            URL string (e.g., s3://bucket/key or https://bucket.s3.amazonaws.com/key)
        """
        pass

    # Provider information
    @property
    @abstractmethod
    def provider_name(self) -> str:
        """Return the storage provider name (e.g., 's3', 'azure', 'gcs', 's3_compatible')."""
        pass

    @property
    @abstractmethod
    def bucket_name(self) -> str:
        """Return the bucket/container name."""
        pass

    @property
    @abstractmethod
    def region(self) -> str:
        """Return the storage region."""
        pass
