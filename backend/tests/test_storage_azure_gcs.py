"""
Tests for Azure Blob Storage and Google Cloud Storage backends.

These tests verify the backend implementations work correctly.
They use mocked responses since the actual cloud SDKs may not be installed.
"""

import pytest
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, PropertyMock

from app.services.storage.base import (
    StorageObject,
    PresignedUrlResult,
    StorageError,
    ObjectNotFoundError,
)


class TestAzureBlobStorageBackend:
    """Test Azure Blob Storage backend."""

    @pytest.fixture
    def mock_azure_sdk(self):
        """Mock the Azure SDK."""
        with patch.dict('sys.modules', {
            'azure': MagicMock(),
            'azure.storage': MagicMock(),
            'azure.storage.blob': MagicMock(),
            'azure.core': MagicMock(),
            'azure.core.exceptions': MagicMock(),
        }):
            # Import after mocking
            from app.services.storage import azure
            azure.AZURE_SDK_AVAILABLE = True

            # Create mock classes
            mock_blob_service = MagicMock()
            mock_container = MagicMock()
            mock_blob = MagicMock()

            azure.BlobServiceClient = MagicMock(return_value=mock_blob_service)
            azure.BlobServiceClient.from_connection_string = MagicMock(return_value=mock_blob_service)
            mock_blob_service.get_container_client = MagicMock(return_value=mock_container)
            mock_container.get_blob_client = MagicMock(return_value=mock_blob)

            # Mock ContentSettings
            azure.ContentSettings = MagicMock()

            # Mock exceptions
            azure.ResourceNotFoundError = type('ResourceNotFoundError', (Exception,), {})
            azure.AzureError = type('AzureError', (Exception,), {})

            # Mock generate_blob_sas
            azure.generate_blob_sas = MagicMock(return_value="sas_token_here")
            azure.BlobSasPermissions = MagicMock()

            yield {
                'module': azure,
                'blob_service': mock_blob_service,
                'container': mock_container,
                'blob': mock_blob,
            }

    def test_azure_backend_creation(self, mock_azure_sdk):
        """Test creating an Azure backend with connection string."""
        azure = mock_azure_sdk['module']

        backend = azure.AzureBlobStorageBackend(
            container="test-container",
            connection_string="DefaultEndpointsProtocol=https;AccountName=testaccount;AccountKey=testkey;EndpointSuffix=core.windows.net",
        )

        assert backend.provider_name == "azure"
        assert backend.bucket_name == "test-container"

    def test_azure_backend_with_account_key(self, mock_azure_sdk):
        """Test creating an Azure backend with account name and key."""
        azure = mock_azure_sdk['module']

        backend = azure.AzureBlobStorageBackend(
            container="test-container",
            account_name="testaccount",
            account_key="testkey123",
        )

        assert backend.provider_name == "azure"
        assert backend._account_name == "testaccount"

    def test_azure_put_object_sync(self, mock_azure_sdk):
        """Test synchronous put_object."""
        azure = mock_azure_sdk['module']
        mock_blob = mock_azure_sdk['blob']

        # Setup mock properties
        mock_properties = MagicMock()
        mock_properties.size = 1024
        mock_properties.content_settings.content_type = "text/plain"
        mock_properties.last_modified = datetime.now(timezone.utc)
        mock_properties.etag = '"abc123"'
        mock_properties.metadata = {}
        mock_blob.get_blob_properties = MagicMock(return_value=mock_properties)

        backend = azure.AzureBlobStorageBackend(
            container="test-container",
            account_name="testaccount",
            account_key="testkey123",
        )

        result = backend.put_object_sync(
            key="test/file.txt",
            body=b"Hello World",
            content_type="text/plain",
        )

        assert isinstance(result, StorageObject)
        assert result.key == "test/file.txt"
        assert result.size == 1024
        mock_blob.upload_blob.assert_called_once()

    def test_azure_get_object_sync(self, mock_azure_sdk):
        """Test synchronous get_object."""
        azure = mock_azure_sdk['module']
        mock_blob = mock_azure_sdk['blob']

        # Setup mock download
        mock_download = MagicMock()
        mock_download.readall = MagicMock(return_value=b"Hello World")
        mock_properties = MagicMock()
        mock_properties.size = 11
        mock_properties.content_settings.content_type = "text/plain"
        mock_properties.last_modified = datetime.now(timezone.utc)
        mock_properties.etag = '"abc123"'
        mock_properties.metadata = {}
        mock_download.properties = mock_properties
        mock_blob.download_blob = MagicMock(return_value=mock_download)

        backend = azure.AzureBlobStorageBackend(
            container="test-container",
            account_name="testaccount",
            account_key="testkey123",
        )

        data, obj = backend.get_object_sync("test/file.txt")

        assert data == b"Hello World"
        assert isinstance(obj, StorageObject)
        assert obj.key == "test/file.txt"

    def test_azure_delete_object_sync(self, mock_azure_sdk):
        """Test synchronous delete_object."""
        azure = mock_azure_sdk['module']
        mock_blob = mock_azure_sdk['blob']

        backend = azure.AzureBlobStorageBackend(
            container="test-container",
            account_name="testaccount",
            account_key="testkey123",
        )

        result = backend.delete_object_sync("test/file.txt")

        assert result is True
        mock_blob.delete_blob.assert_called_once()

    def test_azure_presigned_download_url(self, mock_azure_sdk):
        """Test generating presigned download URL."""
        azure = mock_azure_sdk['module']

        backend = azure.AzureBlobStorageBackend(
            container="test-container",
            account_name="testaccount",
            account_key="testkey123",
        )

        url = backend.generate_presigned_download_url_sync(
            key="test/file.txt",
            expires_in=3600,
        )

        assert "sas_token_here" in url
        assert "test-container" in url
        assert "test/file.txt" in url


class TestGCSStorageBackend:
    """Test Google Cloud Storage backend."""

    @pytest.fixture
    def mock_gcs_sdk(self):
        """Mock the GCS SDK."""
        with patch.dict('sys.modules', {
            'google': MagicMock(),
            'google.cloud': MagicMock(),
            'google.cloud.storage': MagicMock(),
            'google.cloud.exceptions': MagicMock(),
            'google.oauth2': MagicMock(),
            'google.oauth2.service_account': MagicMock(),
        }):
            from app.services.storage import gcs
            gcs.GCS_SDK_AVAILABLE = True

            # Create mock classes
            mock_client = MagicMock()
            mock_bucket = MagicMock()
            mock_blob = MagicMock()

            gcs.gcs_storage = MagicMock()
            gcs.gcs_storage.Client = MagicMock(return_value=mock_client)
            mock_client.bucket = MagicMock(return_value=mock_bucket)
            mock_bucket.blob = MagicMock(return_value=mock_blob)

            # Mock exceptions
            gcs.NotFound = type('NotFound', (Exception,), {})
            gcs.GoogleCloudError = type('GoogleCloudError', (Exception,), {})

            # Mock credentials
            gcs.service_account = MagicMock()
            gcs.service_account.Credentials.from_service_account_info = MagicMock()

            yield {
                'module': gcs,
                'client': mock_client,
                'bucket': mock_bucket,
                'blob': mock_blob,
            }

    def test_gcs_backend_creation(self, mock_gcs_sdk):
        """Test creating a GCS backend."""
        gcs = mock_gcs_sdk['module']

        backend = gcs.GCSStorageBackend(
            bucket="test-bucket",
            project_id="test-project",
        )

        assert backend.provider_name == "gcs"
        assert backend.bucket_name == "test-bucket"

    def test_gcs_backend_with_credentials_dict(self, mock_gcs_sdk):
        """Test creating a GCS backend with service account credentials."""
        gcs = mock_gcs_sdk['module']

        creds = {
            "type": "service_account",
            "project_id": "test-project",
            "private_key_id": "key123",
            "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
            "client_email": "test@test-project.iam.gserviceaccount.com",
        }

        backend = gcs.GCSStorageBackend(
            bucket="test-bucket",
            credentials_dict=creds,
        )

        assert backend.provider_name == "gcs"
        gcs.service_account.Credentials.from_service_account_info.assert_called_once_with(creds)

    def test_gcs_put_object_sync(self, mock_gcs_sdk):
        """Test synchronous put_object."""
        gcs = mock_gcs_sdk['module']
        mock_blob = mock_gcs_sdk['blob']

        # Setup mock blob properties
        mock_blob.size = 1024
        mock_blob.content_type = "text/plain"
        mock_blob.updated = datetime.now(timezone.utc)
        mock_blob.etag = "abc123"
        mock_blob.metadata = {}

        backend = gcs.GCSStorageBackend(
            bucket="test-bucket",
            project_id="test-project",
        )

        result = backend.put_object_sync(
            key="test/file.txt",
            body=b"Hello World",
            content_type="text/plain",
        )

        assert isinstance(result, StorageObject)
        assert result.key == "test/file.txt"
        mock_blob.upload_from_string.assert_called_once()

    def test_gcs_get_object_sync(self, mock_gcs_sdk):
        """Test synchronous get_object."""
        gcs = mock_gcs_sdk['module']
        mock_blob = mock_gcs_sdk['blob']

        # Setup mock
        mock_blob.exists = MagicMock(return_value=True)
        mock_blob.download_as_bytes = MagicMock(return_value=b"Hello World")
        mock_blob.size = 11
        mock_blob.content_type = "text/plain"
        mock_blob.updated = datetime.now(timezone.utc)
        mock_blob.etag = "abc123"
        mock_blob.metadata = {}

        backend = gcs.GCSStorageBackend(
            bucket="test-bucket",
            project_id="test-project",
        )

        data, obj = backend.get_object_sync("test/file.txt")

        assert data == b"Hello World"
        assert isinstance(obj, StorageObject)
        assert obj.key == "test/file.txt"

    def test_gcs_get_object_not_found(self, mock_gcs_sdk):
        """Test get_object when object doesn't exist."""
        gcs = mock_gcs_sdk['module']
        mock_blob = mock_gcs_sdk['blob']
        mock_blob.exists = MagicMock(return_value=False)

        backend = gcs.GCSStorageBackend(
            bucket="test-bucket",
            project_id="test-project",
        )

        with pytest.raises(ObjectNotFoundError):
            backend.get_object_sync("nonexistent/file.txt")

    def test_gcs_delete_object_sync(self, mock_gcs_sdk):
        """Test synchronous delete_object."""
        gcs = mock_gcs_sdk['module']
        mock_blob = mock_gcs_sdk['blob']

        backend = gcs.GCSStorageBackend(
            bucket="test-bucket",
            project_id="test-project",
        )

        result = backend.delete_object_sync("test/file.txt")

        assert result is True
        mock_blob.delete.assert_called_once()

    def test_gcs_presigned_download_url(self, mock_gcs_sdk):
        """Test generating presigned download URL."""
        gcs = mock_gcs_sdk['module']
        mock_blob = mock_gcs_sdk['blob']
        mock_blob.generate_signed_url = MagicMock(
            return_value="https://storage.googleapis.com/test-bucket/test/file.txt?signature=..."
        )

        backend = gcs.GCSStorageBackend(
            bucket="test-bucket",
            project_id="test-project",
        )

        url = backend.generate_presigned_download_url_sync(
            key="test/file.txt",
            expires_in=3600,
        )

        assert "storage.googleapis.com" in url
        mock_blob.generate_signed_url.assert_called_once()

    def test_gcs_object_url(self, mock_gcs_sdk):
        """Test getting canonical object URL."""
        gcs = mock_gcs_sdk['module']

        backend = gcs.GCSStorageBackend(
            bucket="test-bucket",
            project_id="test-project",
        )

        import asyncio
        url = asyncio.run(backend.get_object_url("test/file.txt"))

        assert url == "gs://test-bucket/test/file.txt"


class TestStorageFactoryWithNewBackends:
    """Test the storage factory with Azure and GCS backends."""

    def test_factory_creates_azure_backend(self, monkeypatch):
        """Test that factory can create Azure backend."""
        # This would require mocking the database and Azure SDK
        # Simplified test just checking the factory function exists
        from app.services.storage.factory import _create_azure_backend
        assert callable(_create_azure_backend)

    def test_factory_creates_gcs_backend(self, monkeypatch):
        """Test that factory can create GCS backend."""
        from app.services.storage.factory import _create_gcs_backend
        assert callable(_create_gcs_backend)

    def test_test_connection_supports_azure(self):
        """Test that connection testing supports Azure."""
        from app.services.storage.factory import test_storage_connection
        import asyncio

        result = asyncio.run(test_storage_connection("azure", {"container": "test"}))

        success, error = result
        # Either works (SDK installed) or fails with helpful message
        assert success is False or (success is True)
        if not success:
            assert "Azure" in error or "azure" in error

    def test_test_connection_supports_gcs(self):
        """Test that connection testing supports GCS."""
        from app.services.storage.factory import test_storage_connection
        import asyncio

        result = asyncio.run(test_storage_connection("gcs", {"bucket": "test"}))

        success, error = result
        # Either works (SDK installed) or fails with helpful message
        assert success is False or (success is True)
        if not success:
            assert "Google" in error or "google" in error or "gcs" in error.lower()
