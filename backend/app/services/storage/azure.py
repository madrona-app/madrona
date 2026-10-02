"""
Azure Blob Storage backend implementation.

This implementation supports:
- Azure Blob Storage with connection strings
- Azure Blob Storage with account key
- Azure Blob Storage with SAS tokens
- Azure Blob Storage with managed identity (DefaultAzureCredential)
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

# Thread pool for running sync Azure operations
_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="azure-storage")


def _run_sync(func, *args, **kwargs):
    """Run a sync function in the thread pool."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_executor, partial(func, *args, **kwargs))


# Check if Azure SDK is available
try:
    from azure.storage.blob import (
        BlobServiceClient,
        ContainerClient,
        BlobClient,
        BlobSasPermissions,
        generate_blob_sas,
        ContentSettings,
    )
    from azure.core.exceptions import ResourceNotFoundError, AzureError
    AZURE_SDK_AVAILABLE = True
except ImportError:
    AZURE_SDK_AVAILABLE = False
    logger.warning("Azure Blob Storage SDK not available - install azure-storage-blob")


class AzureBlobStorageBackend(StorageBackend):
    """
    Azure Blob Storage backend.

    Supports multiple authentication methods:
    - Connection string (simplest, includes account key)
    - Account name + account key
    - Account name + SAS token
    - Managed identity (DefaultAzureCredential)

    Example usage:
        # With connection string
        storage = AzureBlobStorageBackend(
            container="media",
            connection_string="DefaultEndpointsProtocol=https;AccountName=...",
        )

        # With account key
        storage = AzureBlobStorageBackend(
            container="media",
            account_name="mystorageaccount",
            account_key="...",
        )

        # With SAS token
        storage = AzureBlobStorageBackend(
            container="media",
            account_name="mystorageaccount",
            sas_token="sv=2021-06-08&ss=b&srt=sco...",
        )
    """

    def __init__(
        self,
        container: str,
        account_name: Optional[str] = None,
        account_key: Optional[str] = None,
        connection_string: Optional[str] = None,
        sas_token: Optional[str] = None,
        account_url: Optional[str] = None,
        region: str = "global",  # Azure doesn't use regions the same way
    ):
        """
        Initialize Azure Blob Storage backend.

        Args:
            container: Blob container name
            account_name: Azure storage account name
            account_key: Azure storage account key
            connection_string: Full connection string (alternative to account_name/key)
            sas_token: SAS token for authentication
            account_url: Custom account URL (defaults to https://{account_name}.blob.core.windows.net)
            region: Region identifier (for compatibility, Azure uses account location)
        """
        if not AZURE_SDK_AVAILABLE:
            raise ImportError(
                "Azure Blob Storage SDK not available. "
                "Install with: pip install azure-storage-blob"
            )

        self._container_name = container
        self._account_name = account_name
        self._account_key = account_key
        self._region = region

        # Build account URL if not provided
        if account_url:
            self._account_url = account_url
        elif account_name:
            self._account_url = f"https://{account_name}.blob.core.windows.net"
        else:
            self._account_url = None

        # Initialize the client based on authentication method
        if connection_string:
            self._service_client = BlobServiceClient.from_connection_string(
                connection_string
            )
            # Extract account name from connection string
            for part in connection_string.split(";"):
                if part.startswith("AccountName="):
                    self._account_name = part.split("=", 1)[1]
                    break
            if not self._account_url and self._account_name:
                self._account_url = f"https://{self._account_name}.blob.core.windows.net"

        elif account_name and account_key:
            self._service_client = BlobServiceClient(
                account_url=self._account_url,
                credential=account_key,
            )

        elif account_name and sas_token:
            # SAS token should include the leading '?'
            if not sas_token.startswith("?"):
                sas_token = f"?{sas_token}"
            self._service_client = BlobServiceClient(
                account_url=f"{self._account_url}{sas_token}"
            )

        elif account_name:
            # Use DefaultAzureCredential (managed identity, environment, etc.)
            try:
                from azure.identity import DefaultAzureCredential
                credential = DefaultAzureCredential()
                self._service_client = BlobServiceClient(
                    account_url=self._account_url,
                    credential=credential,
                )
            except ImportError:
                raise ImportError(
                    "azure-identity package required for managed identity auth. "
                    "Install with: pip install azure-identity"
                )
        else:
            raise ValueError(
                "Must provide either connection_string, or account_name with "
                "account_key/sas_token/managed identity"
            )

        # Get container client
        self._container_client = self._service_client.get_container_client(container)

        logger.info(
            "Initialized AzureBlobStorageBackend: container=%s, account=%s",
            container,
            self._account_name,
        )

    @property
    def provider_name(self) -> str:
        return "azure"

    @property
    def bucket_name(self) -> str:
        """Return container name (Azure equivalent of bucket)."""
        return self._container_name

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
            tags=tags,
        )

    async def get_object(self, key: str) -> tuple[bytes, StorageObject]:
        return await _run_sync(self.get_object_sync, key)

    async def get_object_stream(self, key: str) -> tuple[AsyncIterator[bytes], StorageObject]:
        # For simplicity, download fully and yield chunks
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
        """Get the canonical Azure Blob URL."""
        return f"{self._account_url}/{self._container_name}/{key}"

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
        tags: Optional[dict[str, str]] = None,
    ) -> StorageObject:
        """Synchronous version of put_object."""
        try:
            blob_client = self._container_client.get_blob_client(key)

            # Prepare content settings
            content_settings = ContentSettings(
                content_type=content_type,
                cache_control=cache_control,
            )

            # Handle bytes vs file-like object
            if isinstance(body, bytes):
                data = body
            else:
                data = body.read()

            # Upload the blob
            blob_client.upload_blob(
                data,
                overwrite=True,
                content_settings=content_settings,
                metadata=metadata,
                tags=tags,
            )

            # Get blob properties
            properties = blob_client.get_blob_properties()

            return StorageObject(
                key=key,
                size=properties.size,
                content_type=properties.content_settings.content_type,
                last_modified=properties.last_modified,
                etag=properties.etag.strip('"') if properties.etag else None,
                metadata=dict(properties.metadata) if properties.metadata else {},
            )

        except AzureError as e:
            logger.error("Failed to upload blob %s: %s", key, e)
            raise StorageError(f"Failed to upload blob: {e}", key=key, cause=e)

    def get_object_sync(self, key: str) -> tuple[bytes, StorageObject]:
        """Synchronous version of get_object."""
        try:
            blob_client = self._container_client.get_blob_client(key)

            # Download blob
            download_stream = blob_client.download_blob()
            data = download_stream.readall()

            properties = download_stream.properties

            obj = StorageObject(
                key=key,
                size=properties.size,
                content_type=properties.content_settings.content_type,
                last_modified=properties.last_modified,
                etag=properties.etag.strip('"') if properties.etag else None,
                metadata=dict(properties.metadata) if properties.metadata else {},
            )

            return data, obj

        except ResourceNotFoundError:
            raise ObjectNotFoundError(f"Blob not found: {key}", key=key)
        except AzureError as e:
            logger.error("Failed to download blob %s: %s", key, e)
            raise StorageError(f"Failed to download blob: {e}", key=key, cause=e)

    def delete_object_sync(self, key: str) -> bool:
        """Synchronous version of delete_object."""
        try:
            blob_client = self._container_client.get_blob_client(key)
            blob_client.delete_blob()
            return True
        except ResourceNotFoundError:
            return False
        except AzureError as e:
            logger.error("Failed to delete blob %s: %s", key, e)
            raise StorageError(f"Failed to delete blob: {e}", key=key, cause=e)

    def delete_objects_sync(self, keys: list[str]) -> list[str]:
        """Synchronous version of delete_objects."""
        if not keys:
            return []

        failed_keys = []
        for key in keys:
            try:
                self.delete_object_sync(key)
            except (StorageError, Exception) as e:
                logger.warning("Failed to delete blob %s: %s", key, e)
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
            # Azure uses name_starts_with for prefix filtering
            blobs = self._container_client.list_blobs(
                name_starts_with=prefix,
                results_per_page=max_keys,
            )

            # If we have a continuation token, skip to that page
            if continuation_token:
                blobs = blobs.by_page(continuation_token=continuation_token)
            else:
                blobs = blobs.by_page()

            # Get the first page
            page = next(blobs, None)
            if page is None:
                return [], None

            objects = []
            for blob in page:
                objects.append(StorageObject(
                    key=blob.name,
                    size=blob.size,
                    content_type=blob.content_settings.content_type if blob.content_settings else None,
                    last_modified=blob.last_modified,
                    etag=blob.etag.strip('"') if blob.etag else None,
                ))

            # Get continuation token for next page
            next_token = blobs.continuation_token

            return objects, next_token

        except AzureError as e:
            logger.error("Failed to list blobs with prefix %s: %s", prefix, e)
            raise StorageError(f"Failed to list blobs: {e}", cause=e)

    def head_object_sync(self, key: str) -> Optional[StorageObject]:
        """Synchronous version of head_object."""
        try:
            blob_client = self._container_client.get_blob_client(key)
            properties = blob_client.get_blob_properties()

            return StorageObject(
                key=key,
                size=properties.size,
                content_type=properties.content_settings.content_type,
                last_modified=properties.last_modified,
                etag=properties.etag.strip('"') if properties.etag else None,
                metadata=dict(properties.metadata) if properties.metadata else {},
            )

        except ResourceNotFoundError:
            return None
        except AzureError as e:
            logger.error("Failed to get blob properties %s: %s", key, e)
            raise StorageError(f"Failed to get blob properties: {e}", key=key, cause=e)

    def object_exists_sync(self, key: str) -> bool:
        """Synchronous version of object_exists."""
        try:
            blob_client = self._container_client.get_blob_client(key)
            return blob_client.exists()
        except AzureError as e:
            logger.error("Failed to check blob existence %s: %s", key, e)
            raise StorageError(f"Failed to check blob existence: {e}", key=key, cause=e)

    def generate_presigned_upload_url_sync(
        self,
        key: str,
        content_type: str,
        expires_in: int = 3600,
    ) -> PresignedUrlResult:
        """Generate a SAS URL for direct upload."""
        if not self._account_key:
            raise StorageError(
                "Account key required for generating SAS tokens. "
                "Use connection string or provide account_key.",
                key=key,
            )

        try:
            expiry_time = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

            sas_token = generate_blob_sas(
                account_name=self._account_name,
                container_name=self._container_name,
                blob_name=key,
                account_key=self._account_key,
                permission=BlobSasPermissions(write=True, create=True),
                expiry=expiry_time,
                content_type=content_type,
            )

            url = f"{self._account_url}/{self._container_name}/{key}?{sas_token}"

            return PresignedUrlResult(
                url=url,
                expires_at=expiry_time,
                headers={"x-ms-blob-type": "BlockBlob", "Content-Type": content_type},
                method="PUT",
            )

        except Exception as e:
            logger.error("Failed to generate upload SAS URL for %s: %s", key, e)
            raise StorageError(f"Failed to generate upload URL: {e}", key=key, cause=e)

    def generate_presigned_download_url_sync(
        self,
        key: str,
        expires_in: int = 3600,
        filename: Optional[str] = None,
    ) -> str:
        """Generate a SAS URL for download."""
        if not self._account_key:
            raise StorageError(
                "Account key required for generating SAS tokens. "
                "Use connection string or provide account_key.",
                key=key,
            )

        try:
            expiry_time = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

            # Set content disposition if filename provided
            content_disposition = None
            if filename:
                content_disposition = f'attachment; filename="{filename}"'

            sas_token = generate_blob_sas(
                account_name=self._account_name,
                container_name=self._container_name,
                blob_name=key,
                account_key=self._account_key,
                permission=BlobSasPermissions(read=True),
                expiry=expiry_time,
                content_disposition=content_disposition,
            )

            return f"{self._account_url}/{self._container_name}/{key}?{sas_token}"

        except Exception as e:
            logger.error("Failed to generate download SAS URL for %s: %s", key, e)
            raise StorageError(f"Failed to generate download URL: {e}", key=key, cause=e)

    def copy_object_sync(
        self,
        source_key: str,
        dest_key: str,
        metadata: Optional[dict[str, str]] = None,
    ) -> StorageObject:
        """Synchronous version of copy_object."""
        try:
            source_blob = self._container_client.get_blob_client(source_key)
            dest_blob = self._container_client.get_blob_client(dest_key)

            # Check source exists
            if not source_blob.exists():
                raise ObjectNotFoundError(f"Source blob not found: {source_key}", key=source_key)

            # Start copy operation
            source_url = source_blob.url
            copy_result = dest_blob.start_copy_from_url(source_url)

            # Wait for copy to complete (Azure copies are async)
            # For small files this is usually instant
            properties = dest_blob.get_blob_properties()

            # Update metadata if provided
            if metadata:
                dest_blob.set_blob_metadata(metadata)
                properties = dest_blob.get_blob_properties()

            return StorageObject(
                key=dest_key,
                size=properties.size,
                content_type=properties.content_settings.content_type,
                last_modified=properties.last_modified,
                etag=properties.etag.strip('"') if properties.etag else None,
                metadata=dict(properties.metadata) if properties.metadata else {},
            )

        except ResourceNotFoundError:
            raise ObjectNotFoundError(f"Source blob not found: {source_key}", key=source_key)
        except AzureError as e:
            logger.error("Failed to copy blob from %s to %s: %s", source_key, dest_key, e)
            raise StorageError(f"Failed to copy blob: {e}", key=dest_key, cause=e)
