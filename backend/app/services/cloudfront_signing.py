"""
CloudFront URL signing service.

Generates signed URLs for secure media access via CloudFront CDN.
Uses RSA-SHA1 signatures with configurable expiry times.

Environment Variables:
    CLOUDFRONT_KEY_PAIR_ID: CloudFront key pair ID (e.g., K2XXXXXXXXXX)
    CLOUDFRONT_PRIVATE_KEY: PEM-encoded RSA private key
    CLOUDFRONT_URL_EXPIRY_SECONDS: Default URL expiry time (default: 3600)
    MEDIA_CDN_URL: CloudFront distribution URL (e.g., https://d123.cloudfront.net)

Usage:
    from app.services.cloudfront_signing import get_signed_url, is_cloudfront_configured

    if is_cloudfront_configured():
        url = get_signed_url(s3_key, expiry_seconds=3600)
    else:
        # Fall back to unsigned CDN URL or S3 presigned URL
        url = f"{MEDIA_CDN_URL}/{s3_key}"
"""
import os
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

logger = logging.getLogger(__name__)

# CloudFront signing configuration
CLOUDFRONT_KEY_PAIR_ID = os.environ.get('CLOUDFRONT_KEY_PAIR_ID', '')
CLOUDFRONT_PRIVATE_KEY = os.environ.get('CLOUDFRONT_PRIVATE_KEY', '')
CLOUDFRONT_URL_EXPIRY_SECONDS = int(os.environ.get('CLOUDFRONT_URL_EXPIRY_SECONDS', '3600'))
MEDIA_CDN_URL = os.environ.get('MEDIA_CDN_URL', '')

# Lazy-loaded signer instance
_cloudfront_signer = None
_signer_initialized = False


def _load_private_key():
    """Load and parse the RSA private key."""
    if not CLOUDFRONT_PRIVATE_KEY:
        return None

    try:
        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.backends import default_backend

        # Handle key that might be escaped in env var
        key_data = CLOUDFRONT_PRIVATE_KEY
        if '\\n' in key_data:
            key_data = key_data.replace('\\n', '\n')

        private_key = serialization.load_pem_private_key(
            key_data.encode('utf-8'),
            password=None,
            backend=default_backend()
        )
        return private_key
    except Exception as e:
        logger.error(f"Failed to load CloudFront private key: {e}")
        return None


def _rsa_signer(message: bytes) -> bytes:
    """Sign a message using RSA-SHA1 (required by CloudFront)."""
    try:
        from cryptography.hazmat.primitives import hashes
        from cryptography.hazmat.primitives.asymmetric import padding

        private_key = _load_private_key()
        if not private_key:
            raise ValueError("Private key not loaded")

        return private_key.sign(
            message,
            padding.PKCS1v15(),
            hashes.SHA1()
        )
    except Exception as e:
        logger.error(f"RSA signing failed: {e}")
        raise


def _get_signer():
    """Get or create the CloudFront signer instance."""
    global _cloudfront_signer, _signer_initialized

    if _signer_initialized:
        return _cloudfront_signer

    _signer_initialized = True

    if not is_cloudfront_configured():
        logger.info("CloudFront signing not configured - will use unsigned URLs")
        return None

    try:
        from botocore.signers import CloudFrontSigner

        _cloudfront_signer = CloudFrontSigner(
            CLOUDFRONT_KEY_PAIR_ID,
            _rsa_signer
        )
        logger.info(f"CloudFront signer initialized with key pair {CLOUDFRONT_KEY_PAIR_ID}")
        return _cloudfront_signer
    except Exception as e:
        logger.error(f"Failed to initialize CloudFront signer: {e}")
        return None


def is_cloudfront_configured() -> bool:
    """Check if CloudFront signing is properly configured."""
    return bool(
        CLOUDFRONT_KEY_PAIR_ID and
        CLOUDFRONT_PRIVATE_KEY and
        MEDIA_CDN_URL
    )


def get_signed_url(
    s3_key: str,
    expiry_seconds: Optional[int] = None,
    cdn_url: Optional[str] = None,
) -> Optional[str]:
    """
    Generate a CloudFront signed URL for the given S3 key.

    Args:
        s3_key: The S3 object key (path within the bucket)
        expiry_seconds: URL expiry time in seconds (default from env)
        cdn_url: Override CDN base URL (default from env)

    Returns:
        Signed URL string, or None if signing fails or is not configured
    """
    if not s3_key:
        return None

    signer = _get_signer()
    if not signer:
        return None

    # Use provided or default values
    base_url = cdn_url or MEDIA_CDN_URL
    if not base_url:
        logger.warning("No CDN URL configured for CloudFront signing")
        return None

    expiry = expiry_seconds or CLOUDFRONT_URL_EXPIRY_SECONDS

    # Build the full URL
    url = f"{base_url.rstrip('/')}/{s3_key.lstrip('/')}"

    # Calculate expiry time
    expire_date = datetime.now(timezone.utc) + timedelta(seconds=expiry)

    try:
        signed_url = signer.generate_presigned_url(
            url,
            date_less_than=expire_date
        )
        return signed_url
    except Exception as e:
        logger.error(f"Failed to generate CloudFront signed URL for {s3_key}: {e}")
        return None


def get_signed_url_or_unsigned(
    s3_key: str,
    expiry_seconds: Optional[int] = None,
    cdn_url: Optional[str] = None,
) -> Optional[str]:
    """
    Generate a CloudFront URL - signed if configured, unsigned otherwise.

    This is the preferred method for most use cases as it gracefully
    falls back to unsigned CDN URLs when signing is not configured.

    Args:
        s3_key: The S3 object key
        expiry_seconds: URL expiry time (only used if signing is configured)
        cdn_url: Override CDN base URL

    Returns:
        URL string (signed or unsigned), or None if CDN is not configured
    """
    if not s3_key:
        return None

    base_url = cdn_url or MEDIA_CDN_URL
    if not base_url:
        return None

    # Try signed URL first
    if is_cloudfront_configured():
        signed = get_signed_url(s3_key, expiry_seconds, cdn_url)
        if signed:
            return signed

    # Fall back to unsigned URL
    return f"{base_url.rstrip('/')}/{s3_key.lstrip('/')}"
