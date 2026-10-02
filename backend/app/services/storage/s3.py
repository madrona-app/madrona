"""
AWS S3 and S3-compatible storage backend implementation.

This implementation supports:
- AWS S3 (using IAM roles or access keys)
- Self-hosted S3-compatible storage (e.g. SeaweedFS)
- Other S3-compatible services (DigitalOcean Spaces, Wasabi, etc.)
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from functools import partial
from io import BytesIO
from typing import AsyncIterator, BinaryIO, Optional
from urllib.parse import quote

import os
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

from app.services.storage.base import (
    ObjectNotFoundError,
    PresignedUrlResult,
    StorageBackend,
    StorageError,
    StorageObject,
)

logger = logging.getLogger(__name__)

# Thread pool for running sync boto3 operations
_executor = ThreadPoolExecutor(max_workers=10, thread_name_prefix="s3-storage")


def _run_sync(func, *args, **kwargs):
    """Run a sync function in the thread pool."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_executor, partial(func, *args, **kwargs))


class S3StorageBackend(StorageBackend):
    """
    AWS S3 / S3-compatible storage backend.

    Supports:
    - AWS S3 with IAM instance roles (default for managed storage)
    - AWS S3 with explicit access keys (for BYOB customers)
    - S3-compatible services (via endpoint_url)

    Example usage:
        # Managed S3 (uses instance role)
        storage = S3StorageBackend(
            bucket="madrona-media-us-west-2",
            region="us-west-2",
        )

        # BYOB with explicit credentials
        storage = S3StorageBackend(
            bucket="customer-bucket",
            region="eu-west-1",
            access_key_id="AKIA...",
            secret_access_key="...",
        )

        # S3-compatible (self-hosted)
        storage = S3StorageBackend(
            bucket="media",
            region="us-east-1",
            endpoint_url="https://s3.example.com",
            access_key_id="s3-admin",
            secret_access_key="...",
        )
    """

    def __init__(
        self,
        bucket: str,
        region: str,
        access_key_id: Optional[str] = None,
        secret_access_key: Optional[str] = None,
        session_token: Optional[str] = None,
        endpoint_url: Optional[str] = None,
        use_path_style: bool = False,
        signature_version: str = "s3v4",
    ):
        """
        Initialize S3 storage backend.

        Args:
            bucket: S3 bucket name
            region: AWS region (e.g., 'us-west-2')
            access_key_id: AWS access key ID (optional, uses instance role if not provided)
            secret_access_key: AWS secret access key (required if access_key_id is provided)
            session_token: AWS session token (for temporary credentials)
            endpoint_url: Custom endpoint URL (for SeaweedFS, DigitalOcean Spaces, etc.)
            use_path_style: Use path-style URLs (required by most self-hosted S3-compatible services)
            signature_version: Signature version (default 's3v4')
        """
        self._bucket = bucket
        self._region = region
        self._endpoint_url = endpoint_url
        self._use_path_style = use_path_style

        # Determine if this is a custom/BYOB setup
        self._is_custom = access_key_id is not None or endpoint_url is not None

        # Configure boto3 client
        config = Config(
            region_name=region,
            signature_version=signature_version,
            s3={"addressing_style": "path" if use_path_style else "auto"},
            retries={"max_attempts": 3, "mode": "adaptive"},
        )

        client_kwargs = {
            "config": config,
            "region_name": region,
        }

        if access_key_id and secret_access_key:
            client_kwargs["aws_access_key_id"] = access_key_id
            client_kwargs["aws_secret_access_key"] = secret_access_key
            if session_token:
                client_kwargs["aws_session_token"] = session_token

        if endpoint_url:
            client_kwargs["endpoint_url"] = endpoint_url

        self._client = boto3.client("s3", **client_kwargs)

        # Presigned URLs are handed to browsers outside the container
        # network, so they must be signed against a publicly reachable host
        # (S3_PUBLIC_ENDPOINT_URL). Signing is local — this client never
        # calls the endpoint. Falls back to the main client on AWS, where
        # the internal and public endpoints are identical.
        public_endpoint = os.environ.get("S3_PUBLIC_ENDPOINT_URL", "")
        if public_endpoint and public_endpoint != endpoint_url:
            presign_kwargs = dict(client_kwargs)
            presign_kwargs["endpoint_url"] = public_endpoint
            self._presign_client = boto3.client("s3", **presign_kwargs)
        else:
            self._presign_client = self._client

        logger.info(
            "Initialized S3StorageBackend: bucket=%s, region=%s, endpoint=%s, custom=%s",
            bucket,
            region,
            endpoint_url or "AWS",
            self._is_custom,
        )

    @property
    def provider_name(self) -> str:
        if self._endpoint_url:
            return "s3_compatible"
        return "s3"

    @property
    def bucket_name(self) -> str:
        return self._bucket

    @property
    def region(self) -> str:
        return self._region

    async def put_object(
        self,
        key: str,
        body: bytes | BinaryIO,
        content_type: Optional[str] = None,
        metadata: Optional[dict[str, str]] = None,
        cache_control: Optional[str] = None,
        tags: Optional[dict[str, str]] = None,
    ) -> StorageObject:
        """Upload an object to S3."""
        # Convert file-like to bytes if needed
        if hasattr(body, "read"):
            content = body.read()
        else:
            content = body

        put_params = {
            "Bucket": self._bucket,
            "Key": key,
            "Body": content,
        }

        if content_type:
            put_params["ContentType"] = content_type
        if metadata:
            put_params["Metadata"] = metadata
        if cache_control:
            put_params["CacheControl"] = cache_control
        if tags:
            # S3 tags are URL-encoded key=value pairs separated by &
            tag_string = "&".join(f"{quote(k)}={quote(v)}" for k, v in tags.items())
            put_params["Tagging"] = tag_string

        try:
            response = await _run_sync(self._client.put_object, **put_params)

            return StorageObject(
                key=key,
                size=len(content),
                content_type=content_type,
                last_modified=datetime.now(timezone.utc),
                etag=response.get("ETag", "").strip('"'),
                metadata=metadata or {},
            )
        except ClientError as e:
            logger.error("Failed to upload object %s to %s: %s", key, self._bucket, e)
            raise StorageError(f"Failed to upload object: {e}", key=key, cause=e)

    async def get_object(self, key: str) -> tuple[bytes, StorageObject]:
        """Download an object from S3."""
        try:
            response = await _run_sync(
                self._client.get_object,
                Bucket=self._bucket,
                Key=key,
            )

            body = response["Body"].read()
            obj = StorageObject(
                key=key,
                size=response["ContentLength"],
                content_type=response.get("ContentType"),
                last_modified=response.get("LastModified"),
                etag=response.get("ETag", "").strip('"'),
                metadata=response.get("Metadata", {}),
            )

            return body, obj
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                raise ObjectNotFoundError(f"Object not found: {key}", key=key, cause=e)
            logger.error("Failed to download object %s from %s: %s", key, self._bucket, e)
            raise StorageError(f"Failed to download object: {e}", key=key, cause=e)

    async def get_object_stream(self, key: str) -> tuple[AsyncIterator[bytes], StorageObject]:
        """Stream an object from S3."""
        try:
            response = await _run_sync(
                self._client.get_object,
                Bucket=self._bucket,
                Key=key,
            )

            obj = StorageObject(
                key=key,
                size=response["ContentLength"],
                content_type=response.get("ContentType"),
                last_modified=response.get("LastModified"),
                etag=response.get("ETag", "").strip('"'),
                metadata=response.get("Metadata", {}),
            )

            async def stream_chunks():
                body = response["Body"]
                chunk_size = 1024 * 1024  # 1MB chunks
                while True:
                    chunk = await _run_sync(body.read, chunk_size)
                    if not chunk:
                        break
                    yield chunk

            return stream_chunks(), obj
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                raise ObjectNotFoundError(f"Object not found: {key}", key=key, cause=e)
            logger.error("Failed to stream object %s from %s: %s", key, self._bucket, e)
            raise StorageError(f"Failed to stream object: {e}", key=key, cause=e)

    async def delete_object(self, key: str) -> bool:
        """Delete an object from S3."""
        try:
            await _run_sync(
                self._client.delete_object,
                Bucket=self._bucket,
                Key=key,
            )
            logger.info("Deleted object: %s/%s", self._bucket, key)
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                return False
            logger.error("Failed to delete object %s from %s: %s", key, self._bucket, e)
            raise StorageError(f"Failed to delete object: {e}", key=key, cause=e)

    async def delete_objects(self, keys: list[str]) -> list[str]:
        """Delete multiple objects from S3."""
        if not keys:
            return []

        # S3 delete_objects has a limit of 1000 keys per request
        failed_keys = []
        for i in range(0, len(keys), 1000):
            batch = keys[i : i + 1000]
            delete_request = {
                "Objects": [{"Key": key} for key in batch],
                "Quiet": False,
            }

            try:
                response = await _run_sync(
                    self._client.delete_objects,
                    Bucket=self._bucket,
                    Delete=delete_request,
                )

                # Collect any errors
                for error in response.get("Errors", []):
                    failed_keys.append(error["Key"])
                    logger.warning(
                        "Failed to delete %s: %s", error["Key"], error.get("Message")
                    )

            except ClientError as e:
                logger.error("Failed to delete objects from %s: %s", self._bucket, e)
                # If the batch request fails entirely, all keys in batch failed
                failed_keys.extend(batch)

        return failed_keys

    async def list_objects(
        self,
        prefix: str,
        max_keys: int = 1000,
        continuation_token: Optional[str] = None,
    ) -> tuple[list[StorageObject], Optional[str]]:
        """List objects with a given prefix."""
        list_params = {
            "Bucket": self._bucket,
            "Prefix": prefix,
            "MaxKeys": max_keys,
        }

        if continuation_token:
            list_params["ContinuationToken"] = continuation_token

        try:
            response = await _run_sync(self._client.list_objects_v2, **list_params)

            objects = [
                StorageObject(
                    key=obj["Key"],
                    size=obj["Size"],
                    last_modified=obj.get("LastModified"),
                    etag=obj.get("ETag", "").strip('"'),
                )
                for obj in response.get("Contents", [])
            ]

            next_token = response.get("NextContinuationToken")
            return objects, next_token

        except ClientError as e:
            logger.error("Failed to list objects in %s with prefix %s: %s", self._bucket, prefix, e)
            raise StorageError(f"Failed to list objects: {e}", cause=e)

    async def head_object(self, key: str) -> Optional[StorageObject]:
        """Get object metadata without downloading."""
        try:
            response = await _run_sync(
                self._client.head_object,
                Bucket=self._bucket,
                Key=key,
            )

            return StorageObject(
                key=key,
                size=response["ContentLength"],
                content_type=response.get("ContentType"),
                last_modified=response.get("LastModified"),
                etag=response.get("ETag", "").strip('"'),
                metadata=response.get("Metadata", {}),
            )
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
                return None
            logger.error("Failed to head object %s from %s: %s", key, self._bucket, e)
            raise StorageError(f"Failed to head object: {e}", key=key, cause=e)

    async def object_exists(self, key: str) -> bool:
        """Check if an object exists."""
        obj = await self.head_object(key)
        return obj is not None

    async def generate_presigned_upload_url(
        self,
        key: str,
        content_type: str,
        expires_in: int = 3600,
        content_length_range: Optional[tuple[int, int]] = None,
    ) -> PresignedUrlResult:
        """Generate a presigned URL for direct client upload."""
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        try:
            # Use presigned POST for more flexibility
            conditions = [{"Content-Type": content_type}]
            if content_length_range:
                conditions.append(
                    ["content-length-range", content_length_range[0], content_length_range[1]]
                )

            response = await _run_sync(
                self._client.generate_presigned_post,
                Bucket=self._bucket,
                Key=key,
                Fields={"Content-Type": content_type},
                Conditions=conditions,
                ExpiresIn=expires_in,
            )

            return PresignedUrlResult(
                url=response["url"],
                expires_at=expires_at,
                fields=response["fields"],
                method="POST",
            )
        except ClientError as e:
            logger.error("Failed to generate presigned upload URL for %s: %s", key, e)
            raise StorageError(f"Failed to generate presigned upload URL: {e}", key=key, cause=e)

    async def generate_presigned_download_url(
        self,
        key: str,
        expires_in: int = 3600,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> str:
        """Generate a presigned URL for download."""
        params = {
            "Bucket": self._bucket,
            "Key": key,
        }

        # Add response headers if specified
        if filename:
            params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
        if content_type:
            params["ResponseContentType"] = content_type

        try:
            url = await _run_sync(
                self._presign_client.generate_presigned_url,
                "get_object",
                Params=params,
                ExpiresIn=expires_in,
            )
            return url
        except ClientError as e:
            logger.error("Failed to generate presigned download URL for %s: %s", key, e)
            raise StorageError(f"Failed to generate presigned download URL: {e}", key=key, cause=e)

    async def copy_object(
        self,
        source_key: str,
        dest_key: str,
        metadata: Optional[dict[str, str]] = None,
    ) -> StorageObject:
        """Copy an object within the same bucket."""
        copy_source = {"Bucket": self._bucket, "Key": source_key}

        copy_params = {
            "Bucket": self._bucket,
            "Key": dest_key,
            "CopySource": copy_source,
        }

        if metadata is not None:
            copy_params["Metadata"] = metadata
            copy_params["MetadataDirective"] = "REPLACE"
        else:
            copy_params["MetadataDirective"] = "COPY"

        try:
            response = await _run_sync(self._client.copy_object, **copy_params)

            # Get the new object metadata
            new_obj = await self.head_object(dest_key)
            if new_obj is None:
                raise StorageError(f"Copy succeeded but object not found: {dest_key}", key=dest_key)

            return new_obj
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                raise ObjectNotFoundError(f"Source object not found: {source_key}", key=source_key, cause=e)
            logger.error("Failed to copy object %s to %s: %s", source_key, dest_key, e)
            raise StorageError(f"Failed to copy object: {e}", key=source_key, cause=e)

    async def get_object_url(self, key: str) -> str:
        """Get the canonical URL for an object."""
        if self._endpoint_url:
            # Custom endpoint (S3-compatible service)
            if self._use_path_style:
                return f"{self._endpoint_url}/{self._bucket}/{key}"
            else:
                # Virtual-hosted style
                return f"{self._endpoint_url.replace('://', f'://{self._bucket}.')}/{key}"
        else:
            # Standard AWS S3
            return f"https://{self._bucket}.s3.{self._region}.amazonaws.com/{key}"

    # Sync convenience methods for backward compatibility
    def put_object_sync(
        self,
        key: str,
        body: bytes | BinaryIO,
        content_type: Optional[str] = None,
        metadata: Optional[dict[str, str]] = None,
        cache_control: Optional[str] = None,
        tags: Optional[dict[str, str]] = None,
    ) -> StorageObject:
        """Synchronous version of put_object for use in non-async contexts."""
        # Convert file-like to bytes if needed
        if hasattr(body, "read"):
            content = body.read()
        else:
            content = body

        put_params = {
            "Bucket": self._bucket,
            "Key": key,
            "Body": content,
        }

        if content_type:
            put_params["ContentType"] = content_type
        if metadata:
            put_params["Metadata"] = metadata
        if cache_control:
            put_params["CacheControl"] = cache_control
        if tags:
            tag_string = "&".join(f"{quote(k)}={quote(v)}" for k, v in tags.items())
            put_params["Tagging"] = tag_string

        try:
            response = self._client.put_object(**put_params)

            return StorageObject(
                key=key,
                size=len(content),
                content_type=content_type,
                last_modified=datetime.now(timezone.utc),
                etag=response.get("ETag", "").strip('"'),
                metadata=metadata or {},
            )
        except ClientError as e:
            logger.error("Failed to upload object %s to %s: %s", key, self._bucket, e)
            raise StorageError(f"Failed to upload object: {e}", key=key, cause=e)

    def get_object_sync(self, key: str) -> tuple[bytes, StorageObject]:
        """Synchronous version of get_object."""
        try:
            response = self._client.get_object(Bucket=self._bucket, Key=key)

            body = response["Body"].read()
            obj = StorageObject(
                key=key,
                size=response["ContentLength"],
                content_type=response.get("ContentType"),
                last_modified=response.get("LastModified"),
                etag=response.get("ETag", "").strip('"'),
                metadata=response.get("Metadata", {}),
            )

            return body, obj
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                raise ObjectNotFoundError(f"Object not found: {key}", key=key, cause=e)
            logger.error("Failed to download object %s from %s: %s", key, self._bucket, e)
            raise StorageError(f"Failed to download object: {e}", key=key, cause=e)

    def delete_object_sync(self, key: str) -> bool:
        """Synchronous version of delete_object."""
        try:
            self._client.delete_object(Bucket=self._bucket, Key=key)
            logger.info("Deleted object: %s/%s", self._bucket, key)
            return True
        except ClientError as e:
            if e.response["Error"]["Code"] == "NoSuchKey":
                return False
            logger.error("Failed to delete object %s from %s: %s", key, self._bucket, e)
            raise StorageError(f"Failed to delete object: {e}", key=key, cause=e)

    def delete_objects_sync(self, keys: list[str]) -> list[str]:
        """Synchronous version of delete_objects."""
        if not keys:
            return []

        failed_keys = []
        for i in range(0, len(keys), 1000):
            batch = keys[i : i + 1000]
            delete_request = {
                "Objects": [{"Key": key} for key in batch],
                "Quiet": False,
            }

            try:
                response = self._client.delete_objects(
                    Bucket=self._bucket,
                    Delete=delete_request,
                )

                for error in response.get("Errors", []):
                    failed_keys.append(error["Key"])
                    logger.warning(
                        "Failed to delete %s: %s", error["Key"], error.get("Message")
                    )

            except ClientError as e:
                logger.error("Failed to delete objects from %s: %s", self._bucket, e)
                failed_keys.extend(batch)

        return failed_keys

    def head_object_sync(self, key: str) -> Optional[StorageObject]:
        """Synchronous version of head_object."""
        try:
            response = self._client.head_object(Bucket=self._bucket, Key=key)

            return StorageObject(
                key=key,
                size=response["ContentLength"],
                content_type=response.get("ContentType"),
                last_modified=response.get("LastModified"),
                etag=response.get("ETag", "").strip('"'),
                metadata=response.get("Metadata", {}),
            )
        except ClientError as e:
            if e.response["Error"]["Code"] in ("404", "NoSuchKey"):
                return None
            logger.error("Failed to head object %s from %s: %s", key, self._bucket, e)
            raise StorageError(f"Failed to head object: {e}", key=key, cause=e)

    def generate_presigned_download_url_sync(
        self,
        key: str,
        expires_in: int = 3600,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> str:
        """Synchronous version of generate_presigned_download_url."""
        params = {
            "Bucket": self._bucket,
            "Key": key,
        }

        if filename:
            params["ResponseContentDisposition"] = f'attachment; filename="{filename}"'
        if content_type:
            params["ResponseContentType"] = content_type

        try:
            url = self._presign_client.generate_presigned_url(
                "get_object",
                Params=params,
                ExpiresIn=expires_in,
            )
            return url
        except ClientError as e:
            logger.error("Failed to generate presigned download URL for %s: %s", key, e)
            raise StorageError(f"Failed to generate presigned download URL: {e}", key=key, cause=e)

    def generate_presigned_upload_url_sync(
        self,
        key: str,
        content_type: str,
        expires_in: int = 3600,
        content_length_range: Optional[tuple[int, int]] = None,
    ) -> PresignedUrlResult:
        """Synchronous version of generate_presigned_upload_url."""
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=expires_in)

        try:
            conditions = [{"Content-Type": content_type}]
            if content_length_range:
                conditions.append(
                    ["content-length-range", content_length_range[0], content_length_range[1]]
                )

            response = self._client.generate_presigned_post(
                Bucket=self._bucket,
                Key=key,
                Fields={"Content-Type": content_type},
                Conditions=conditions,
                ExpiresIn=expires_in,
            )

            return PresignedUrlResult(
                url=response["url"],
                expires_at=expires_at,
                fields=response["fields"],
                method="POST",
            )
        except ClientError as e:
            logger.error("Failed to generate presigned upload URL for %s: %s", key, e)
            raise StorageError(f"Failed to generate presigned upload URL: {e}", key=key, cause=e)

    def list_objects_sync(
        self,
        prefix: str,
        max_keys: int = 1000,
        continuation_token: Optional[str] = None,
    ) -> tuple[list[StorageObject], Optional[str]]:
        """Synchronous version of list_objects."""
        list_params = {
            "Bucket": self._bucket,
            "Prefix": prefix,
            "MaxKeys": max_keys,
        }

        if continuation_token:
            list_params["ContinuationToken"] = continuation_token

        try:
            response = self._client.list_objects_v2(**list_params)

            objects = [
                StorageObject(
                    key=obj["Key"],
                    size=obj["Size"],
                    last_modified=obj.get("LastModified"),
                    etag=obj.get("ETag", "").strip('"'),
                )
                for obj in response.get("Contents", [])
            ]

            next_token = response.get("NextContinuationToken")
            return objects, next_token

        except ClientError as e:
            logger.error("Failed to list objects in %s with prefix %s: %s", self._bucket, prefix, e)
            raise StorageError(f"Failed to list objects: {e}", cause=e)
