"""
Storage abstraction layer for multi-cloud support (BYOB - Bring Your Own Bucket).

This module provides:
- StorageBackend: Abstract base class for storage implementations
- S3StorageBackend: AWS S3 and S3-compatible implementation
- AzureBlobStorageBackend: Azure Blob Storage implementation
- GCSStorageBackend: Google Cloud Storage implementation
- get_storage_backend(): Factory function to get the appropriate backend for an org
- StorageMigrationService: Service for migrating data between storage backends

Usage:
    from app.services.storage import get_storage_backend

    storage = get_storage_backend(organization_id, db_session)
    await storage.put_object(key, body, content_type="image/jpeg")
    url = await storage.generate_presigned_download_url(key)

Migration:
    from app.services.storage import migrate_organization_storage

    result = await migrate_organization_storage(
        organization_id=org_id,
        dest_provider="s3",
        dest_config={"bucket": "my-bucket", ...},
        db_session=session,
    )
"""

from app.services.storage.base import (
    StorageBackend,
    StorageObject,
    PresignedUrlResult,
    StorageError,
    ObjectNotFoundError,
)
from app.services.storage.s3 import S3StorageBackend
from app.services.storage.factory import (
    get_storage_backend,
    get_managed_storage_backend,
)
from app.services.storage.migration import (
    StorageMigrationService,
    MigrationProgress,
    MigrationResult,
    MigrationStatus,
    VerificationResult,
    migrate_organization_storage,
)

# Lazy imports for optional backends (require additional packages)
def get_azure_backend_class():
    """Get AzureBlobStorageBackend class (requires azure-storage-blob)."""
    from app.services.storage.azure import AzureBlobStorageBackend
    return AzureBlobStorageBackend


def get_gcs_backend_class():
    """Get GCSStorageBackend class (requires google-cloud-storage)."""
    from app.services.storage.gcs import GCSStorageBackend
    return GCSStorageBackend


__all__ = [
    # Base classes
    "StorageBackend",
    "StorageObject",
    "PresignedUrlResult",
    "StorageError",
    "ObjectNotFoundError",
    # Implementations
    "S3StorageBackend",
    "get_azure_backend_class",
    "get_gcs_backend_class",
    # Factory
    "get_storage_backend",
    "get_managed_storage_backend",
    # Migration
    "StorageMigrationService",
    "MigrationProgress",
    "MigrationResult",
    "MigrationStatus",
    "VerificationResult",
    "migrate_organization_storage",
]
