"""
Storage backend factory for multi-organization support.

This module provides the get_storage_backend() function that returns the
appropriate storage backend for an organization, supporting:
- Managed storage (Madrona's S3 buckets)
- BYOB S3 (customer's own AWS S3 bucket)
- BYOB S3-compatible (SeaweedFS, Cloudflare R2, DigitalOcean Spaces, etc.)
- BYOB Azure Blob Storage
- BYOB Google Cloud Storage
"""

import json
import logging
import os
from functools import lru_cache
from typing import Optional

from cryptography.fernet import Fernet

from app.services.storage.base import StorageBackend, StorageError
from app.services.storage.s3 import S3StorageBackend

logger = logging.getLogger(__name__)

# Bucket naming for managed storage
MEDIA_BUCKET_PREFIX = os.environ.get("S3_MEDIA_BUCKET_PREFIX", "madrona-media")
PLATFORM_BUCKET_PREFIX = os.environ.get("S3_PLATFORM_BUCKET_PREFIX", "madrona-platform")
DEFAULT_REGION = os.environ.get("AWS_REGION", "us-west-2")

# Self-hosted / S3-compatible managed storage (the bundled SeaweedFS etc.):
# - S3_ENDPOINT_URL points the managed backend at any S3-compatible server
#   (path-style addressing is used automatically when it is set)
# - S3_MEDIA_BUCKET / S3_PLATFORM_BUCKET override the prefix-region naming
#   with explicit bucket names
# Credentials come from the standard AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
# env vars (boto3 default chain), which the S3-compatible service accepts as its
# credentials.
MANAGED_ENDPOINT_URL = os.environ.get("S3_ENDPOINT_URL", "")
MEDIA_BUCKET_OVERRIDE = os.environ.get("S3_MEDIA_BUCKET", "")
PLATFORM_BUCKET_OVERRIDE = os.environ.get("S3_PLATFORM_BUCKET", "")

# Encryption key for BYOB credentials (from AWS Secrets Manager or env)
# In production, this should be fetched from AWS Secrets Manager
STORAGE_CREDENTIALS_KEY = os.environ.get("STORAGE_CREDENTIALS_ENCRYPTION_KEY", "")


def get_media_bucket(region: str) -> str:
    """Get the media bucket name for a given region."""
    return MEDIA_BUCKET_OVERRIDE or f"{MEDIA_BUCKET_PREFIX}-{region}"


def get_platform_bucket(region: str = DEFAULT_REGION) -> str:
    """Get the platform bucket name (for avatars, etc.)."""
    return PLATFORM_BUCKET_OVERRIDE or f"{PLATFORM_BUCKET_PREFIX}-{region}"


def _get_encryption_key() -> bytes:
    """Get the Fernet encryption key for BYOB credentials."""
    if not STORAGE_CREDENTIALS_KEY:
        raise StorageError(
            "STORAGE_CREDENTIALS_ENCRYPTION_KEY not configured. "
            "Required for BYOB storage configurations."
        )
    return STORAGE_CREDENTIALS_KEY.encode()


def encrypt_storage_config(config: dict) -> bytes:
    """Encrypt storage configuration for database storage."""
    key = _get_encryption_key()
    f = Fernet(key)
    return f.encrypt(json.dumps(config).encode())


def decrypt_storage_config(encrypted: bytes) -> dict:
    """Decrypt storage configuration from database."""
    key = _get_encryption_key()
    f = Fernet(key)
    return json.loads(f.decrypt(encrypted).decode())


def get_storage_backend(
    organization_id: str,
    db_session,
    bucket_type: str = "media",
) -> StorageBackend:
    """
    Get the appropriate storage backend for an organization.

    This is the main entry point for storage operations. It checks if the
    organization has a custom storage configuration (BYOB) and returns
    the appropriate backend.

    Args:
        organization_id: The organization's UUID
        db_session: SQLAlchemy session
        bucket_type: Type of bucket ('media' or 'platform')

    Returns:
        StorageBackend instance configured for the organization

    Raises:
        StorageError: If configuration is invalid or credentials are missing
    """
    from app.models import Organization

    # Get organization
    org = db_session.query(Organization).filter(
        Organization.organization_id == organization_id
    ).first()

    if not org:
        logger.warning("Organization not found: %s, using default managed storage", organization_id)
        return get_managed_storage_backend(DEFAULT_REGION, bucket_type)

    # Check for custom storage configuration
    storage_config = _get_org_storage_config(organization_id, db_session)

    if storage_config is None or storage_config.provider == "managed":
        # Use Madrona's managed S3 storage
        region = org.storage_region or DEFAULT_REGION
        return get_managed_storage_backend(region, bucket_type)

    # BYOB storage
    if storage_config.provider == "s3":
        return _create_s3_backend(storage_config)
    elif storage_config.provider == "s3_compatible":
        return _create_s3_compatible_backend(storage_config)
    elif storage_config.provider == "azure":
        return _create_azure_backend(storage_config)
    elif storage_config.provider == "gcs":
        return _create_gcs_backend(storage_config)
    else:
        raise StorageError(f"Unknown storage provider: {storage_config.provider}")


def get_managed_storage_backend(
    region: str = DEFAULT_REGION,
    bucket_type: str = "media",
) -> S3StorageBackend:
    """
    Get Madrona's managed S3 backend.

    Uses IAM instance roles for authentication (no explicit credentials).

    Args:
        region: AWS region for the bucket
        bucket_type: Type of bucket ('media' or 'platform')

    Returns:
        S3StorageBackend configured for managed storage
    """
    if bucket_type == "platform":
        bucket = get_platform_bucket(region)
    else:
        bucket = get_media_bucket(region)

    return S3StorageBackend(
        bucket=bucket,
        region=region,
        # No explicit credentials: boto3 default chain (instance role on
        # AWS; AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY env for an S3-compatible service).
        endpoint_url=MANAGED_ENDPOINT_URL or None,
        use_path_style=bool(MANAGED_ENDPOINT_URL),
    )


def _get_org_storage_config(organization_id: str, db_session):
    """Get the storage configuration for an organization."""
    from app.models import OrganizationStorageConfig

    return db_session.query(OrganizationStorageConfig).filter(
        OrganizationStorageConfig.organization_id == organization_id
    ).first()


def _create_s3_backend(config) -> S3StorageBackend:
    """Create an S3 backend from a storage configuration."""
    try:
        credentials = decrypt_storage_config(config.config_encrypted)
    except Exception as e:
        raise StorageError(f"Failed to decrypt storage credentials: {e}")

    return S3StorageBackend(
        bucket=credentials["bucket"],
        region=credentials["region"],
        access_key_id=credentials.get("access_key_id"),
        secret_access_key=credentials.get("secret_access_key"),
        session_token=credentials.get("session_token"),
    )


def _create_s3_compatible_backend(config) -> S3StorageBackend:
    """Create an S3-compatible backend (custom endpoint) from a storage configuration."""
    try:
        credentials = decrypt_storage_config(config.config_encrypted)
    except Exception as e:
        raise StorageError(f"Failed to decrypt storage credentials: {e}")

    return S3StorageBackend(
        bucket=credentials["bucket"],
        region=credentials.get("region", "us-east-1"),
        access_key_id=credentials["access_key_id"],
        secret_access_key=credentials["secret_access_key"],
        endpoint_url=credentials["endpoint_url"],
        use_path_style=credentials.get("use_path_style", True),
    )


def _create_azure_backend(config):
    """Create an Azure Blob Storage backend from a storage configuration."""
    try:
        from app.services.storage.azure import AzureBlobStorageBackend
    except ImportError:
        raise StorageError(
            "Azure Blob Storage SDK not available. "
            "Install with: pip install azure-storage-blob"
        )

    try:
        credentials = decrypt_storage_config(config.config_encrypted)
    except Exception as e:
        raise StorageError(f"Failed to decrypt storage credentials: {e}")

    return AzureBlobStorageBackend(
        container=credentials["container"],
        account_name=credentials.get("account_name"),
        account_key=credentials.get("account_key"),
        connection_string=credentials.get("connection_string"),
        sas_token=credentials.get("sas_token"),
        account_url=credentials.get("account_url"),
        region=credentials.get("region", "global"),
    )


def _create_gcs_backend(config):
    """Create a Google Cloud Storage backend from a storage configuration."""
    try:
        from app.services.storage.gcs import GCSStorageBackend
    except ImportError:
        raise StorageError(
            "Google Cloud Storage SDK not available. "
            "Install with: pip install google-cloud-storage"
        )

    try:
        credentials = decrypt_storage_config(config.config_encrypted)
    except Exception as e:
        raise StorageError(f"Failed to decrypt storage credentials: {e}")

    return GCSStorageBackend(
        bucket=credentials["bucket"],
        project_id=credentials.get("project_id"),
        credentials_dict=credentials.get("credentials"),  # Service account JSON
        region=credentials.get("region", "us"),
    )


# ============================================================================
# Sync versions for backward compatibility with existing code
# ============================================================================

def get_storage_backend_sync(
    organization_id: str,
    db_session,
    bucket_type: str = "media",
) -> S3StorageBackend:
    """
    Synchronous version of get_storage_backend.

    Returns a backend with sync methods available.
    """
    return get_storage_backend(organization_id, db_session, bucket_type)


# ============================================================================
# Helper functions for URL generation (with CDN support)
# ============================================================================

# CloudFront CDN URL (optional)
MEDIA_CDN_URL = os.environ.get("MEDIA_CDN_URL", "")


def get_media_url(
    key: str,
    organization_id: str,
    db_session,
    expiry_seconds: int = 3600,
    use_cdn: bool = True,
    filename: Optional[str] = None,
) -> Optional[str]:
    """
    Get a URL for accessing media, with CDN support.

    This function:
    1. Checks for organization-specific CDN configuration
    2. Falls back to managed CDN if configured
    3. Falls back to presigned S3 URL

    Args:
        key: Object key
        organization_id: Organization ID
        db_session: SQLAlchemy session
        expiry_seconds: URL expiry time
        use_cdn: Whether to prefer CDN URLs
        filename: Optional filename for Content-Disposition

    Returns:
        URL string or None if generation fails
    """
    if not key:
        return None

    # Get org's storage configuration
    storage_config = _get_org_storage_config(organization_id, db_session)

    # Check for org-specific CDN
    if storage_config and storage_config.cdn_domain and use_cdn:
        cdn_url = _generate_cdn_url(key, storage_config, expiry_seconds)
        if cdn_url:
            return cdn_url

    # Try managed CloudFront CDN
    if use_cdn and MEDIA_CDN_URL:
        from app.services.cloudfront_signing import is_cloudfront_configured, get_signed_url

        if is_cloudfront_configured():
            signed_url = get_signed_url(key, expiry_seconds)
            if signed_url:
                return signed_url

        # Unsigned CDN URL
        return f"{MEDIA_CDN_URL.rstrip('/')}/{key}"

    # Fall back to presigned S3 URL
    try:
        storage = get_storage_backend(organization_id, db_session)
        return storage.generate_presigned_download_url_sync(
            key, expires_in=expiry_seconds, filename=filename
        )
    except Exception as e:
        logger.error("Failed to generate media URL for %s: %s", key, e)
        return None


def _generate_cdn_url(key: str, config, expiry_seconds: int) -> Optional[str]:
    """Generate a CDN URL for BYOB customers with custom CDN."""
    if not config.cdn_domain:
        return None

    # If CDN signing is configured
    if config.cdn_signing_key_encrypted and config.cdn_signing_key_id:
        # Future: implement signed CDN URLs for customer CDNs
        # For now, return unsigned URL
        pass

    # Unsigned CDN URL
    return f"https://{config.cdn_domain.rstrip('/')}/{key}"


# ============================================================================
# Validation utilities
# ============================================================================

async def test_storage_connection(
    provider: str,
    config: dict,
) -> tuple[bool, Optional[str]]:
    """
    Test a storage configuration before saving.

    Args:
        provider: Storage provider type ('s3', 's3_compatible', 'azure', 'gcs')
        config: Configuration dictionary (unencrypted)

    Returns:
        Tuple of (success, error_message)
    """
    try:
        backend = None

        if provider in ("s3", "s3_compatible"):
            backend = S3StorageBackend(
                bucket=config["bucket"],
                region=config.get("region", "us-east-1"),
                access_key_id=config.get("access_key_id"),
                secret_access_key=config.get("secret_access_key"),
                endpoint_url=config.get("endpoint_url"),
                use_path_style=config.get("use_path_style", provider == "s3_compatible"),
            )

        elif provider == "azure":
            try:
                from app.services.storage.azure import AzureBlobStorageBackend
            except ImportError:
                return False, "Azure Blob Storage SDK not installed. Install with: pip install azure-storage-blob"

            backend = AzureBlobStorageBackend(
                container=config["container"],
                account_name=config.get("account_name"),
                account_key=config.get("account_key"),
                connection_string=config.get("connection_string"),
                sas_token=config.get("sas_token"),
            )

        elif provider == "gcs":
            try:
                from app.services.storage.gcs import GCSStorageBackend
            except ImportError:
                return False, "Google Cloud Storage SDK not installed. Install with: pip install google-cloud-storage"

            backend = GCSStorageBackend(
                bucket=config["bucket"],
                project_id=config.get("project_id"),
                credentials_dict=config.get("credentials"),
            )

        else:
            return False, f"Provider '{provider}' not supported"

        # Test: list objects (verifies read access)
        objects, _ = await backend.list_objects(prefix="", max_keys=1)
        logger.info("Storage connection test passed: found %d objects", len(objects))

        # Test: write a test object (verifies write access)
        test_key = ".madrona-connection-test"
        await backend.put_object(
            key=test_key,
            body=b"connection-test",
            content_type="text/plain",
        )

        # Clean up test object
        await backend.delete_object(test_key)

        return True, None

    except Exception as e:
        logger.warning("Storage connection test failed: %s", e)
        return False, str(e)


def validate_storage_permissions(
    provider: str,
    config: dict,
) -> tuple[bool, list[str]]:
    """
    Validate that the storage configuration has required permissions.

    Args:
        provider: Storage provider type
        config: Configuration dictionary

    Returns:
        Tuple of (all_permissions_ok, list_of_missing_permissions)
    """
    # Required permissions for full functionality
    required = [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:ListBucket",
    ]

    # Future: actually test each permission
    # For now, we rely on the connection test

    return True, []
