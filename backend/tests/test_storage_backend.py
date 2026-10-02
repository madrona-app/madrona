"""
Tests for the storage abstraction layer.

Tests cover:
- S3StorageBackend operations (upload, download, delete, list)
- Factory function for getting storage backends
- BYOB configuration encryption/decryption
"""

import pytest
from datetime import datetime, timezone, timedelta
from unittest.mock import Mock, patch, MagicMock
from io import BytesIO

from app.services.storage.base import (
    StorageBackend,
    StorageObject,
    PresignedUrlResult,
    StorageError,
    ObjectNotFoundError,
)
from app.services.storage.s3 import S3StorageBackend
from app.services.storage.factory import (
    encrypt_storage_config,
    decrypt_storage_config,
    get_managed_storage_backend,
    get_media_bucket,
    get_platform_bucket,
)


class TestStorageObject:
    """Tests for StorageObject dataclass."""

    def test_storage_object_creation(self):
        obj = StorageObject(
            key="test/file.jpg",
            size=1024,
            content_type="image/jpeg",
            last_modified=datetime.now(timezone.utc),
            etag="abc123",
        )
        assert obj.key == "test/file.jpg"
        assert obj.size == 1024
        assert obj.content_type == "image/jpeg"

    def test_storage_object_default_metadata(self):
        obj = StorageObject(key="test.txt", size=100)
        assert obj.metadata == {}
        assert obj.content_type is None


class TestPresignedUrlResult:
    """Tests for PresignedUrlResult dataclass."""

    def test_presigned_url_result(self):
        result = PresignedUrlResult(
            url="https://bucket.s3.amazonaws.com/key?signature=xxx",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            method="PUT",
        )
        assert result.method == "PUT"
        assert "signature" in result.url

    def test_presigned_post_result(self):
        result = PresignedUrlResult(
            url="https://bucket.s3.amazonaws.com",
            expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
            fields={"key": "test.jpg", "Content-Type": "image/jpeg"},
            method="POST",
        )
        assert result.method == "POST"
        assert "key" in result.fields


class TestS3StorageBackend:
    """Tests for S3StorageBackend."""

    @pytest.fixture
    def mock_s3_client(self):
        """Create a mock S3 client."""
        client = Mock()
        return client

    @pytest.fixture
    def storage_backend(self, mock_s3_client):
        """Create an S3StorageBackend with mocked client."""
        with patch("boto3.client", return_value=mock_s3_client):
            backend = S3StorageBackend(
                bucket="test-bucket",
                region="us-west-2",
            )
            backend._client = mock_s3_client
            return backend

    def test_provider_name(self, storage_backend):
        assert storage_backend.provider_name == "s3"

    def test_bucket_name(self, storage_backend):
        assert storage_backend.bucket_name == "test-bucket"

    def test_region(self, storage_backend):
        assert storage_backend.region == "us-west-2"

    def test_put_object_sync(self, storage_backend, mock_s3_client):
        mock_s3_client.put_object.return_value = {"ETag": '"abc123"'}

        result = storage_backend.put_object_sync(
            key="test/file.txt",
            body=b"Hello, World!",
            content_type="text/plain",
        )

        assert result.key == "test/file.txt"
        assert result.size == 13
        assert result.content_type == "text/plain"
        mock_s3_client.put_object.assert_called_once()

    def test_get_object_sync(self, storage_backend, mock_s3_client):
        mock_body = Mock()
        mock_body.read.return_value = b"Hello, World!"
        mock_s3_client.get_object.return_value = {
            "Body": mock_body,
            "ContentLength": 13,
            "ContentType": "text/plain",
            "ETag": '"abc123"',
        }

        body, obj = storage_backend.get_object_sync("test/file.txt")

        assert body == b"Hello, World!"
        assert obj.size == 13
        assert obj.content_type == "text/plain"

    def test_get_object_not_found(self, storage_backend, mock_s3_client):
        from botocore.exceptions import ClientError

        error_response = {"Error": {"Code": "NoSuchKey"}}
        mock_s3_client.get_object.side_effect = ClientError(
            error_response, "GetObject"
        )

        with pytest.raises(ObjectNotFoundError):
            storage_backend.get_object_sync("nonexistent.txt")

    def test_delete_object_sync(self, storage_backend, mock_s3_client):
        mock_s3_client.delete_object.return_value = {}

        result = storage_backend.delete_object_sync("test/file.txt")

        assert result is True
        mock_s3_client.delete_object.assert_called_once()

    def test_head_object_sync(self, storage_backend, mock_s3_client):
        mock_s3_client.head_object.return_value = {
            "ContentLength": 1024,
            "ContentType": "image/jpeg",
            "ETag": '"abc123"',
        }

        obj = storage_backend.head_object_sync("test/image.jpg")

        assert obj.size == 1024
        assert obj.content_type == "image/jpeg"

    def test_head_object_not_found(self, storage_backend, mock_s3_client):
        from botocore.exceptions import ClientError

        error_response = {"Error": {"Code": "404"}}
        mock_s3_client.head_object.side_effect = ClientError(
            error_response, "HeadObject"
        )

        obj = storage_backend.head_object_sync("nonexistent.txt")
        assert obj is None

    def test_generate_presigned_download_url_sync(self, storage_backend, mock_s3_client):
        expected_url = "https://bucket.s3.amazonaws.com/test.jpg?signature=xxx"
        mock_s3_client.generate_presigned_url.return_value = expected_url

        url = storage_backend.generate_presigned_download_url_sync(
            key="test.jpg",
            expires_in=3600,
        )

        assert url == expected_url

    def test_list_objects_sync(self, storage_backend, mock_s3_client):
        mock_s3_client.list_objects_v2.return_value = {
            "Contents": [
                {"Key": "test/file1.txt", "Size": 100, "ETag": '"abc"'},
                {"Key": "test/file2.txt", "Size": 200, "ETag": '"def"'},
            ],
            "NextContinuationToken": None,
        }

        objects, next_token = storage_backend.list_objects_sync("test/")

        assert len(objects) == 2
        assert objects[0].key == "test/file1.txt"
        assert next_token is None


class TestStorageFactory:
    """Tests for storage factory functions."""

    def test_get_media_bucket(self):
        bucket = get_media_bucket("us-west-2")
        assert bucket == "madrona-media-us-west-2"

    def test_get_platform_bucket(self):
        bucket = get_platform_bucket("us-east-1")
        assert bucket == "madrona-platform-us-east-1"

    def test_get_managed_storage_backend(self):
        with patch("boto3.client"):
            backend = get_managed_storage_backend("us-west-2", "media")
            assert isinstance(backend, S3StorageBackend)
            assert backend.bucket_name == "madrona-media-us-west-2"


class TestConfigEncryption:
    """Tests for configuration encryption/decryption."""

    @pytest.fixture
    def encryption_key(self):
        """Generate a valid Fernet key for testing."""
        from cryptography.fernet import Fernet
        return Fernet.generate_key().decode()

    def test_encrypt_decrypt_config(self, encryption_key):
        """Test encryption and decryption of storage configuration."""
        import app.services.storage.factory as factory

        # Temporarily set the key at module level
        original_key = factory.STORAGE_CREDENTIALS_KEY
        factory.STORAGE_CREDENTIALS_KEY = encryption_key

        try:
            original_config = {
                "bucket": "my-bucket",
                "region": "eu-west-1",
                "access_key_id": "AKIA...",
                "secret_access_key": "secret123",
            }

            encrypted = encrypt_storage_config(original_config)
            assert encrypted != original_config
            assert isinstance(encrypted, bytes)

            decrypted = decrypt_storage_config(encrypted)
            assert decrypted == original_config
        finally:
            factory.STORAGE_CREDENTIALS_KEY = original_key

    def test_encryption_without_key_fails(self):
        """Test that encryption fails without a key configured."""
        import app.services.storage.factory as factory

        # Temporarily unset the key
        original_key = factory.STORAGE_CREDENTIALS_KEY
        factory.STORAGE_CREDENTIALS_KEY = ""

        try:
            with pytest.raises(StorageError):
                encrypt_storage_config({"bucket": "test"})
        finally:
            factory.STORAGE_CREDENTIALS_KEY = original_key


class TestS3CompatibleBackend:
    """Tests for S3-compatible storage with a custom endpoint."""

    def test_s3_compatible_backend_creation(self):
        with patch("boto3.client") as mock_client:
            backend = S3StorageBackend(
                bucket="media",
                region="us-east-1",
                endpoint_url="https://s3.example.com",
                access_key_id="s3-admin",
                secret_access_key="s3-secret",
                use_path_style=True,
            )

            assert backend.provider_name == "s3_compatible"
            assert backend.bucket_name == "media"

    def test_s3_compatible_object_url(self):
        with patch("boto3.client"):
            backend = S3StorageBackend(
                bucket="media",
                region="us-east-1",
                endpoint_url="https://s3.example.com",
                use_path_style=True,
            )

            # For sync call - we need to use run_until_complete or make this sync
            import asyncio
            loop = asyncio.new_event_loop()
            try:
                url = loop.run_until_complete(backend.get_object_url("test/file.jpg"))
                assert "s3.example.com" in url
                assert "media" in url
                assert "test/file.jpg" in url
            finally:
                loop.close()
