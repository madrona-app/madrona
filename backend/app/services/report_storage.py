"""Report Storage Service.

Handles S3 storage for report exports, including upload, download URL generation,
and cleanup of old exports.

S3 Key Pattern:
    orgs/{org_id}/reports/{report_id}/runs/{run_id}/{timestamp}.{extension}
"""
import logging
import os
from datetime import datetime, timezone
from uuid import UUID

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)

# Configuration
MEDIA_BUCKET_PREFIX = os.environ.get('S3_MEDIA_BUCKET_PREFIX', 'madrona-media')
DEFAULT_REGION = os.environ.get('AWS_REGION', 'us-west-2')

# Export link expiry (24 hours for emailed links)
DEFAULT_DOWNLOAD_EXPIRY = 24 * 60 * 60  # 24 hours in seconds

# Export file expiry (7 days for S3 storage)
EXPORT_FILE_EXPIRY_DAYS = 7


def get_media_bucket(region: str = DEFAULT_REGION) -> str:
    """Get the media bucket name for a given region."""
    return os.environ.get("S3_MEDIA_BUCKET") or f"{MEDIA_BUCKET_PREFIX}-{region}"


def get_s3_client(region: str = DEFAULT_REGION, *, for_presigning: bool = False):
    """Get boto3 S3 client for a specific region (honors S3_ENDPOINT_URL).

    for_presigning is forwarded: dropping it signed report download URLs
    against the internal endpoint, so every one redirected the browser to
    http://seaweedfs:8333/... — a hostname that only resolves inside the container
    network. The signature covers the Host header, so the URL cannot be
    rewritten afterwards; it has to be signed against the public origin.
    """
    from app.services.uploads import get_s3_client as _shared
    return _shared(region, for_presigning=for_presigning)


def upload_report_export(
    organization_id: str | UUID,
    report_id: str | UUID,
    run_id: str | UUID,
    content: bytes,
    export_format: str,
    report_name: str | None = None,
    region: str = DEFAULT_REGION,
) -> str:
    """
    Upload an exported report to S3.

    Args:
        organization_id: Organization UUID
        report_id: Report UUID
        run_id: Report run UUID
        content: Export file content (bytes)
        export_format: File format ('pdf', 'excel', 'csv')
        report_name: Optional report name for filename
        region: AWS region

    Returns:
        S3 key where the file was stored

    Raises:
        ClientError: If S3 upload fails
    """
    org_id = str(organization_id)
    rpt_id = str(report_id)
    rn_id = str(run_id)

    # Determine extension and content type
    format_info = {
        'pdf': ('pdf', 'application/pdf'),
        'excel': ('xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'),
        'csv': ('csv', 'text/csv'),
    }
    extension, content_type = format_info.get(export_format, ('pdf', 'application/pdf'))

    # Generate timestamp for unique filename
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')

    # Build filename
    if report_name:
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in report_name)
        filename = f"{safe_name}_{timestamp}.{extension}"
    else:
        filename = f"report_{timestamp}.{extension}"

    # Build S3 key
    s3_key = f"orgs/{org_id}/reports/{rpt_id}/runs/{rn_id}/{filename}"

    # Upload to S3
    bucket = get_media_bucket(region)
    s3_client = get_s3_client(region)

    try:
        # Record creation timestamp for metadata
        created_at_str = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')

        s3_client.put_object(
            Bucket=bucket,
            Key=s3_key,
            Body=content,
            ContentType=content_type,
            ContentDisposition=f'attachment; filename="{filename}"',
            # Tag for lifecycle management - exports expire after 7 days
            Tagging='ExportType=report&AutoExpire=true',
            Metadata={
                'report-id': rpt_id,
                'run-id': rn_id,
                'created-at': created_at_str,
            },
        )
        logger.info("Uploaded report export: %s/%s (%d bytes)", bucket, s3_key, len(content))
        return s3_key
    except ClientError as e:
        logger.error("Failed to upload report export: %s", e)
        raise


def generate_download_url(
    s3_key: str,
    expires_in: int = DEFAULT_DOWNLOAD_EXPIRY,
    region: str = DEFAULT_REGION,
) -> str | None:
    """
    Generate a time-limited signed URL for downloading a report export.

    Args:
        s3_key: S3 key of the export file
        expires_in: URL expiry time in seconds (default 24 hours)
        region: AWS region

    Returns:
        Presigned URL for download, or None if generation fails
    """
    if not s3_key:
        return None

    bucket = get_media_bucket(region)
    # for_presigning: this URL is handed to a browser, not used in-cluster.
    s3_client = get_s3_client(region, for_presigning=True)

    try:
        url = s3_client.generate_presigned_url(
            'get_object',
            Params={
                'Bucket': bucket,
                'Key': s3_key,
            },
            ExpiresIn=expires_in,
        )
        return url
    except ClientError as e:
        logger.error("Failed to generate presigned URL for %s: %s", s3_key, e)
        return None


def delete_report_export(
    s3_key: str,
    region: str = DEFAULT_REGION,
) -> bool:
    """
    Delete a report export from S3.

    Args:
        s3_key: S3 key of the export file
        region: AWS region

    Returns:
        True if deleted successfully, False otherwise
    """
    if not s3_key:
        return False

    bucket = get_media_bucket(region)
    s3_client = get_s3_client(region)

    try:
        s3_client.delete_object(Bucket=bucket, Key=s3_key)
        logger.info("Deleted report export: %s/%s", bucket, s3_key)
        return True
    except ClientError as e:
        logger.error("Failed to delete report export %s: %s", s3_key, e)
        return False


def cleanup_expired_exports(
    region: str = DEFAULT_REGION,
    max_age_days: int = EXPORT_FILE_EXPIRY_DAYS,
) -> int:
    """
    Clean up expired report exports from S3.

    This function should be called periodically (e.g., daily via Celery beat)
    to delete exports older than max_age_days.

    Args:
        region: AWS region
        max_age_days: Maximum age in days before deletion

    Returns:
        Number of exports deleted
    """
    from datetime import timedelta

    bucket = get_media_bucket(region)
    s3_client = get_s3_client(region)

    # Calculate cutoff date
    cutoff = datetime.now(timezone.utc) - timedelta(days=max_age_days)

    try:
        # List all report exports (they're in orgs/*/reports/*/runs/*/)
        paginator = s3_client.get_paginator('list_objects_v2')
        deleted_count = 0

        to_delete = []

        for page in paginator.paginate(Bucket=bucket, Prefix='orgs/'):
            for obj in page.get('Contents', []):
                key = obj['Key']
                # Only process report exports
                if '/reports/' not in key or '/runs/' not in key:
                    continue

                # Check if object is older than cutoff
                if obj['LastModified'] < cutoff:
                    to_delete.append({'Key': key})
                    if len(to_delete) >= 1000:
                        s3_client.delete_objects(
                            Bucket=bucket,
                            Delete={'Objects': to_delete},
                        )
                        deleted_count += len(to_delete)
                        to_delete = []

        if to_delete:
            s3_client.delete_objects(
                Bucket=bucket,
                Delete={'Objects': to_delete},
            )
            deleted_count += len(to_delete)

        logger.info("Cleaned up %d expired report exports older than %d days", deleted_count, max_age_days)
        return deleted_count

    except ClientError as e:
        logger.error("Failed to cleanup expired exports: %s", e)
        return 0


def cleanup_old_exports(
    organization_id: str | UUID,
    report_id: str | UUID,
    keep_count: int = 10,
    region: str = DEFAULT_REGION,
) -> int:
    """
    Clean up old report exports, keeping only the most recent ones.

    Args:
        organization_id: Organization UUID
        report_id: Report UUID
        keep_count: Number of recent exports to keep
        region: AWS region

    Returns:
        Number of exports deleted
    """
    org_id = str(organization_id)
    rpt_id = str(report_id)

    bucket = get_media_bucket(region)
    s3_client = get_s3_client(region)

    prefix = f"orgs/{org_id}/reports/{rpt_id}/runs/"

    try:
        # Paginate to collect all exports (list_objects_v2 returns max 1000)
        paginator = s3_client.get_paginator('list_objects_v2')
        all_objects = []
        for page in paginator.paginate(Bucket=bucket, Prefix=prefix):
            all_objects.extend(page.get('Contents', []))

        if len(all_objects) <= keep_count:
            return 0

        # Sort by last modified (newest first)
        all_objects.sort(key=lambda x: x['LastModified'], reverse=True)

        # Batch delete old objects
        to_delete_objs = all_objects[keep_count:]
        deleted = 0

        for i in range(0, len(to_delete_objs), 1000):
            batch = [{'Key': obj['Key']} for obj in to_delete_objs[i:i + 1000]]
            try:
                s3_client.delete_objects(Bucket=bucket, Delete={'Objects': batch})
                deleted += len(batch)
            except ClientError as e:
                logger.error("Failed to batch delete old exports: %s", e)

        logger.info("Cleaned up %d old exports for report %s", deleted, rpt_id)
        return deleted

    except ClientError as e:
        logger.error("Failed to list exports for cleanup: %s", e)
        return 0
