"""
CDN cache purge service.

Supports Cloudflare zone purge and CloudFront invalidation.
Called after admin saves alongside Redis cache invalidation.

Configuration is stored in DiscoverConfig.cdn_config as JSONB:
    Cloudflare: { "provider": "cloudflare", "zone_id": "abc", "api_token": "xyz" }
    CloudFront: { "provider": "cloudfront", "distribution_id": "E1ABC" }
        (uses instance IAM role or AWS env vars for auth)
"""

import logging
from typing import Any

import requests

logger = logging.getLogger(__name__)


def purge_cdn_cache(cdn_config: dict[str, Any] | None, org_slug: str) -> bool:
    """
    Purge CDN cache for an organization's public site.

    Returns True if purge succeeded (or no CDN configured), False on error.
    """
    if not cdn_config:
        return True

    provider = cdn_config.get("provider")
    if provider == "cloudflare":
        return _purge_cloudflare(cdn_config, org_slug)
    elif provider == "cloudfront":
        return _purge_cloudfront(cdn_config, org_slug)
    else:
        logger.warning("Unknown CDN provider: %s", provider)
        return False


def _purge_cloudflare(config: dict, org_slug: str) -> bool:
    """Purge Cloudflare cache using zone purge API."""
    zone_id = config.get("zone_id")
    api_token = config.get("api_token")

    if not zone_id or not api_token:
        logger.warning("Cloudflare CDN config missing zone_id or api_token")
        return False

    try:
        # Purge by prefix — all URLs under /c/{org_slug}/ and /api/discover/{org_slug}/
        # and /api/content/{org_slug}/
        response = requests.post(
            f"https://api.cloudflare.com/client/v4/zones/{zone_id}/purge_cache",
            headers={
                "Authorization": f"Bearer {api_token}",
                "Content-Type": "application/json",
            },
            json={
                "prefixes": [
                    f"/c/{org_slug}/",
                    f"/api/discover/{org_slug}/",
                    f"/api/content/{org_slug}/",
                ],
            },
            timeout=10,
        )

        if response.ok:
            data = response.json()
            if data.get("success"):
                logger.info("Cloudflare cache purged for %s", org_slug)
                return True
            else:
                errors = data.get("errors", [])
                logger.warning("Cloudflare purge failed: %s", errors)
                return False
        else:
            logger.warning("Cloudflare purge HTTP %d: %s", response.status_code, response.text[:200])
            return False

    except Exception as e:
        logger.warning("Cloudflare purge error for %s: %s", org_slug, e)
        return False


def _purge_cloudfront(config: dict, org_slug: str) -> bool:
    """Create CloudFront invalidation using boto3."""
    distribution_id = config.get("distribution_id")
    if not distribution_id:
        logger.warning("CloudFront CDN config missing distribution_id")
        return False

    try:
        import boto3
        from datetime import datetime, timezone

        client = boto3.client("cloudfront")
        caller_ref = f"madrona-{org_slug}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}"

        client.create_invalidation(
            DistributionId=distribution_id,
            InvalidationBatch={
                "Paths": {
                    "Quantity": 3,
                    "Items": [
                        f"/c/{org_slug}/*",
                        f"/api/discover/{org_slug}/*",
                        f"/api/content/{org_slug}/*",
                    ],
                },
                "CallerReference": caller_ref,
            },
        )

        logger.info("CloudFront invalidation created for %s (dist: %s)", org_slug, distribution_id)
        return True

    except ImportError:
        logger.warning("boto3 not available for CloudFront purge")
        return False
    except Exception as e:
        logger.warning("CloudFront invalidation error for %s: %s", org_slug, e)
        return False


def purge_cdn_for_org(org_id) -> bool:
    """
    Convenience: look up org's CDN config and purge.

    Safe to call even if org has no CDN config (returns True).
    """
    try:
        from app.database import current_session
        from app.models import Organization
        from app.models import DiscoverConfig

        result = (
            current_session().query(Organization.slug, DiscoverConfig.cdn_config)
            .outerjoin(DiscoverConfig, DiscoverConfig.organization_id == Organization.organization_id)
            .filter(Organization.organization_id == org_id)
            .first()
        )

        if not result:
            return True

        org_slug, cdn_config = result
        return purge_cdn_cache(cdn_config, org_slug)

    except Exception as e:
        logger.warning("Failed to purge CDN for org %s: %s", org_id, e)
        return False
