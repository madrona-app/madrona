"""
Storage analytics service for S3 bucket visibility.

Provides organization-level storage statistics broken down by:
- File category (originals vs derivatives)
- Storage tier (Standard, Glacier IR, Intelligent-Tiering)
- Estimated costs based on current AWS pricing

Also provides lifecycle policy status for transparency about
automatic storage transitions.
"""
import logging
from dataclasses import dataclass
from typing import Any

import boto3
from botocore.exceptions import ClientError

from app.services.uploads import (
    get_media_bucket,
    get_s3_client,
    get_org_storage_region,
    DEFAULT_REGION,
)

logger = logging.getLogger(__name__)

# Approximate AWS S3 pricing per GB/month (us-west-2, as of 2024)
# These are estimates and should be updated periodically
STORAGE_PRICING_PER_GB = {
    'STANDARD': 0.023,
    'INTELLIGENT_TIERING': 0.023,  # Frequent access tier
    'GLACIER_IR': 0.004,  # Glacier Instant Retrieval
    'GLACIER': 0.0036,
    'DEEP_ARCHIVE': 0.00099,
}


@dataclass
class StorageTierBreakdown:
    """Storage breakdown for a single tier."""
    storage_class: str
    object_count: int
    total_bytes: int
    estimated_monthly_cost: float


@dataclass
class StorageCategoryBreakdown:
    """Storage breakdown for a category (originals or derivatives)."""
    category: str
    object_count: int
    total_bytes: int
    tiers: list[StorageTierBreakdown]


@dataclass
class StorageAnalytics:
    """Complete storage analytics for an organization."""
    organization_id: str
    total_bytes: int
    total_gb: float
    object_count: int
    estimated_monthly_cost: float
    categories: list[StorageCategoryBreakdown]
    lifecycle_rules: list[dict[str, Any]]


def get_organization_storage_analytics(
    organization_id: str,
    region: str | None = None,
    db_session=None,
) -> dict[str, Any]:
    """
    Get storage statistics by tier for an organization.

    This function lists objects in the organization's S3 prefix and
    aggregates them by storage class and category (originals vs derivatives).

    Args:
        organization_id: The organization's ID
        region: Storage region (auto-detected from org if not provided)
        db_session: SQLAlchemy session for region lookup

    Returns:
        Dict with storage breakdown:
        {
            "organization_id": "...",
            "total_bytes": 123456789,
            "total_gb": 0.115,
            "object_count": 1234,
            "estimated_monthly_cost": 0.003,
            "categories": [
                {
                    "category": "originals",
                    "object_count": 100,
                    "total_bytes": 100000000,
                    "tiers": [
                        {"storage_class": "STANDARD", "object_count": 50, ...},
                        {"storage_class": "GLACIER_IR", "object_count": 50, ...},
                    ]
                },
                {
                    "category": "derivatives",
                    ...
                }
            ],
            "lifecycle_rules": [...]
        }
    """
    # Check if org uses BYOB storage
    if db_session:
        from app.models import OrganizationStorageConfig
        storage_config = db_session.query(OrganizationStorageConfig).filter_by(
            organization_id=organization_id
        ).first()

        if storage_config and storage_config.provider != 'managed':
            # BYOB organizations manage their own storage - return indicator
            return {
                'organization_id': organization_id,
                'storage_type': 'byob',
                'provider': storage_config.provider,
                'message': 'Storage is managed by the organization. Statistics are available in your storage provider console.',
                'total_bytes': None,
                'total_gb': None,
                'object_count': None,
                'estimated_monthly_cost': None,
                'categories': [],
                'lifecycle_rules': [],
            }

    # Get region for managed storage
    if region is None and db_session:
        region = get_org_storage_region(organization_id, db_session)
    elif region is None:
        region = DEFAULT_REGION

    bucket = get_media_bucket(region)
    s3_client = get_s3_client(region)

    # Initialize counters
    # Structure: category -> storage_class -> {count, bytes}
    stats: dict[str, dict[str, dict[str, int]]] = {
        'originals': {},
        'derivatives': {},
    }

    org_prefix = f"orgs/{organization_id}/media/"

    try:
        # Use list_objects_v2 with pagination
        paginator = s3_client.get_paginator('list_objects_v2')

        for page in paginator.paginate(Bucket=bucket, Prefix=org_prefix):
            for obj in page.get('Contents', []):
                key = obj['Key']
                size = obj['Size']
                storage_class = obj.get('StorageClass', 'STANDARD')

                # Determine category based on path
                if '/derivatives/' in key:
                    category = 'derivatives'
                else:
                    category = 'originals'

                # Initialize storage class counter if needed
                if storage_class not in stats[category]:
                    stats[category][storage_class] = {'count': 0, 'bytes': 0}

                stats[category][storage_class]['count'] += 1
                stats[category][storage_class]['bytes'] += size

    except ClientError as e:
        logger.error(f"Error listing objects for org {organization_id}: {e}")
        # Return empty stats on error
        return {
            'organization_id': organization_id,
            'total_bytes': 0,
            'total_gb': 0.0,
            'object_count': 0,
            'estimated_monthly_cost': 0.0,
            'categories': [],
            'lifecycle_rules': [],
            'error': str(e),
        }

    # Build response
    total_bytes = 0
    total_count = 0
    total_cost = 0.0
    categories = []

    for category_name in ['originals', 'derivatives']:
        category_stats = stats[category_name]
        category_bytes = 0
        category_count = 0
        tiers = []

        for storage_class, data in category_stats.items():
            tier_bytes = data['bytes']
            tier_count = data['count']
            tier_gb = tier_bytes / (1024 ** 3)
            tier_cost = tier_gb * STORAGE_PRICING_PER_GB.get(storage_class, 0.023)

            tiers.append({
                'storage_class': storage_class,
                'object_count': tier_count,
                'total_bytes': tier_bytes,
                'total_gb': round(tier_gb, 3),
                'estimated_monthly_cost': round(tier_cost, 4),
            })

            category_bytes += tier_bytes
            category_count += tier_count
            total_cost += tier_cost

        category_gb = category_bytes / (1024 ** 3)
        categories.append({
            'category': category_name,
            'object_count': category_count,
            'total_bytes': category_bytes,
            'total_gb': round(category_gb, 3),
            'tiers': tiers,
        })

        total_bytes += category_bytes
        total_count += category_count

    # Get lifecycle rules
    lifecycle_rules = get_lifecycle_policy_status(region)

    # Include DB and search storage breakdown if available
    db_used_bytes = 0
    search_used_bytes = 0
    storage_metered_at = None
    if db_session:
        from app.models import Organization
        org = db_session.query(Organization).filter_by(
            organization_id=organization_id
        ).first()
        if org:
            db_used_bytes = org.db_used_bytes or 0
            search_used_bytes = org.search_used_bytes or 0
            storage_metered_at = org.storage_metered_at

    return {
        'organization_id': organization_id,
        'total_bytes': total_bytes,
        'total_gb': round(total_bytes / (1024 ** 3), 3),
        'object_count': total_count,
        'estimated_monthly_cost': round(total_cost, 4),
        'categories': categories,
        'lifecycle_rules': lifecycle_rules,
        'db_used_bytes': db_used_bytes,
        'search_used_bytes': search_used_bytes,
        'storage_metered_at': storage_metered_at.isoformat() if storage_metered_at else None,
    }


def get_lifecycle_policy_status(region: str = DEFAULT_REGION) -> list[dict[str, Any]]:
    """
    Get active lifecycle rules for the media bucket.

    Returns a human-readable summary of lifecycle policies.

    Args:
        region: AWS region for the bucket

    Returns:
        List of lifecycle rule summaries
    """
    bucket = get_media_bucket(region)
    s3_client = get_s3_client(region)

    try:
        response = s3_client.get_bucket_lifecycle_configuration(Bucket=bucket)
        rules = response.get('Rules', [])

        summaries = []
        for rule in rules:
            rule_id = rule.get('ID', 'unnamed')
            status = rule.get('Status', 'Unknown')

            # Parse filter
            filter_info = rule.get('Filter', {})
            filter_desc = _describe_filter(filter_info)

            # Parse transitions
            transitions = []
            for t in rule.get('Transitions', []):
                transitions.append({
                    'days': t.get('Days'),
                    'storage_class': t.get('StorageClass'),
                })

            # Parse noncurrent version expiration
            noncurrent_exp = rule.get('NoncurrentVersionExpiration', {})
            noncurrent_days = noncurrent_exp.get('NoncurrentDays')

            # Parse abort incomplete multipart
            abort_multipart = rule.get('AbortIncompleteMultipartUpload', {})
            abort_days = abort_multipart.get('DaysAfterInitiation')

            summaries.append({
                'rule_id': rule_id,
                'status': status,
                'filter': filter_desc,
                'transitions': transitions,
                'noncurrent_version_expiration_days': noncurrent_days,
                'abort_incomplete_multipart_days': abort_days,
            })

        return summaries

    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', '')
        if error_code == 'NoSuchLifecycleConfiguration':
            return []
        logger.error(f"Error getting lifecycle configuration: {e}")
        return []


def _describe_filter(filter_info: dict) -> str:
    """Create human-readable description of a lifecycle filter."""
    if not filter_info:
        return "All objects"

    # Check for prefix
    prefix = filter_info.get('Prefix')
    if prefix:
        return f"Prefix: {prefix}"

    # Check for tag
    tag = filter_info.get('Tag', {})
    if tag:
        return f"Tag: {tag.get('Key')}={tag.get('Value')}"

    # Check for And condition
    and_filter = filter_info.get('And', {})
    if and_filter:
        parts = []
        if and_filter.get('Prefix'):
            parts.append(f"Prefix: {and_filter['Prefix']}")
        for tag in and_filter.get('Tags', []):
            parts.append(f"Tag: {tag.get('Key')}={tag.get('Value')}")
        return ' AND '.join(parts)

    return "All objects"


def estimate_monthly_savings(
    current_stats: dict[str, Any],
    days_until_transition: int = 30,
) -> dict[str, Any]:
    """
    Estimate monthly savings from lifecycle policies.

    Compares current storage costs to projected costs after
    lifecycle transitions complete.

    Args:
        current_stats: Output from get_organization_storage_analytics
        days_until_transition: Days until transition rules apply

    Returns:
        Dict with savings estimates
    """
    current_cost = current_stats.get('estimated_monthly_cost', 0)

    # Calculate projected cost after transitions
    projected_cost = 0.0

    for category in current_stats.get('categories', []):
        category_name = category.get('category')

        for tier in category.get('tiers', []):
            tier_gb = tier.get('total_gb', 0)

            # Apply projected storage class based on category
            if category_name == 'originals':
                # Originals move to Glacier IR
                projected_class = 'GLACIER_IR'
            else:
                # Derivatives move to Intelligent-Tiering
                projected_class = 'INTELLIGENT_TIERING'

            projected_cost += tier_gb * STORAGE_PRICING_PER_GB.get(projected_class, 0.023)

    savings = current_cost - projected_cost
    savings_percent = (savings / current_cost * 100) if current_cost > 0 else 0

    return {
        'current_monthly_cost': round(current_cost, 4),
        'projected_monthly_cost': round(projected_cost, 4),
        'estimated_monthly_savings': round(savings, 4),
        'savings_percent': round(savings_percent, 1),
        'note': f'Savings apply after {days_until_transition} days when lifecycle transitions complete',
    }
