"""
Redis caching for public-facing API endpoints (Discover + Content CMS).

Provides simple get/set/invalidate functions with graceful degradation
when Redis is unavailable. All cache keys are prefixed with `madrona:pub:`
and scoped by organization slug.

Usage:
    from app.services.public_cache import pub_cache_get, pub_cache_set, invalidate_org_cache

    # In a public endpoint:
    cache_key = f"{org_slug}:info"
    cached = pub_cache_get(cache_key)
    if cached is not None:
        return cached
    # ... compute result ...
    pub_cache_set(cache_key, result, ttl=300)

    # In an admin endpoint after save:
    invalidate_org_cache(org_slug)
"""

import json
import logging
from hashlib import md5

from app.services.redis_client import get_redis_client

logger = logging.getLogger(__name__)

CACHE_PREFIX = "madrona:pub:"
DEFAULT_TTL = 300  # 5 minutes


def _key(cache_key: str) -> str:
    """Build the full Redis key."""
    return f"{CACHE_PREFIX}{cache_key}"


def pub_cache_get(cache_key: str) -> dict | list | None:
    """
    Get a cached value. Returns None on miss or Redis unavailable.
    """
    redis = get_redis_client()
    if not redis.is_available():
        return None
    try:
        raw = redis.client.get(_key(cache_key))
        if raw is None:
            return None
        return json.loads(raw)
    except Exception:
        return None


def pub_cache_set(cache_key: str, data: dict | list, ttl: int = DEFAULT_TTL) -> None:
    """
    Cache a value. Silently fails if Redis is unavailable.
    """
    redis = get_redis_client()
    if not redis.is_available():
        return
    try:
        redis.client.setex(_key(cache_key), ttl, json.dumps(data, default=str))
    except Exception as e:
        logger.debug("Failed to set cache key %s: %s", cache_key, e)


def pub_cache_key_with_params(org_slug: str, endpoint: str, **params) -> str:
    """
    Build a cache key that includes query parameters.

    Deterministic: same params always produce the same key regardless of order.
    """
    if params:
        # Sort params for deterministic key, skip None values
        filtered = {k: v for k, v in sorted(params.items()) if v is not None}
        if filtered:
            param_hash = md5(json.dumps(filtered, sort_keys=True).encode()).hexdigest()[:12]
            return f"{org_slug}:{endpoint}:{param_hash}"
    return f"{org_slug}:{endpoint}"


def invalidate_org_cache(org_slug: str, section: str | None = None) -> int:
    """
    Invalidate all cached public data for an organization.

    If section is provided (e.g. 'info', 'venues', 'exhibitions'),
    only keys matching that section are invalidated. Otherwise all
    keys for the org are cleared.

    Returns the number of keys deleted.
    """
    redis = get_redis_client()
    if not redis.is_available():
        return 0

    if section:
        pattern = f"{CACHE_PREFIX}{org_slug}:{section}*"
    else:
        pattern = f"{CACHE_PREFIX}{org_slug}:*"

    try:
        deleted = 0
        cursor = 0
        while True:
            cursor, keys = redis.client.scan(cursor, match=pattern, count=100)
            if keys:
                redis.client.delete(*keys)
                deleted += len(keys)
            if cursor == 0:
                break
        if deleted > 0:
            logger.info("Invalidated %d cache keys for pattern %s", deleted, pattern)
        return deleted
    except Exception as e:
        logger.debug("Failed to invalidate cache for %s: %s", pattern, e)
        return 0


def invalidate_org_cache_by_id(org_id, section: str | None = None) -> int:
    """
    Convenience wrapper: look up the org slug from the org_id, then invalidate
    both Redis cache and CDN cache.

    Safe to call even if the org_id is invalid or org not found (returns 0).

    The slug lookup runs on the BYPASSRLS owner session, NOT the request
    session: callers invoke this right after db.commit(), which clears the
    SET LOCAL RLS context — under the app role the organizations row is then
    invisible and the lookup silently returns None, so the cache was never
    invalidated and the public site served stale data for the full TTL.
    A slug-by-id lookup leaks nothing, so the owner session is safe here.
    """
    try:
        from app.models import Organization
        from app.tasks.rls_helpers import admin_db_session

        with admin_db_session() as session:
            org = session.query(Organization.slug).filter(
                Organization.organization_id == org_id,
            ).first()
        if org:
            deleted = invalidate_org_cache(org.slug, section=section)
            # Fire CDN purge asynchronously (best-effort)
            try:
                from app.services.cdn_purge import purge_cdn_for_org
                purge_cdn_for_org(org_id)
            except Exception as e:
                logger.debug("CDN purge skipped: %s", e)
            return deleted
    except Exception as e:
        logger.debug("Failed to resolve org slug for cache invalidation: %s", e)
    return 0
