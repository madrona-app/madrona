"""
OpenSearch client configuration with graceful fallback.

Provides a sync client with connection pooling and health check
caching to minimize connection overhead.
"""

import logging
from functools import lru_cache
from typing import Optional
import time

from opensearchpy import OpenSearch

from app.config import get_settings

logger = logging.getLogger(__name__)

# Cache health check result for 30 seconds
_health_check_cache: dict = {"available": None, "checked_at": 0}
HEALTH_CHECK_TTL = 30.0


def _parse_hosts(hosts_str: str) -> list:
    """Parse comma-separated hosts string into OpenSearch hosts format."""
    hosts = [h.strip() for h in hosts_str.split(",")]
    parsed = []
    for host in hosts:
        if "://" in host:
            parsed.append(host)
        else:
            parts = host.split(":")
            if len(parts) == 2:
                parsed.append({"host": parts[0], "port": int(parts[1])})
            else:
                parsed.append({"host": host, "port": 9200})
    return parsed


@lru_cache()
def get_opensearch_client() -> Optional[OpenSearch]:
    """
    Get a configured synchronous OpenSearch client.

    Returns None if OpenSearch is disabled in configuration.
    Uses connection pooling for efficiency.
    """
    settings = get_settings()

    if not settings.opensearch_enabled:
        logger.info("OpenSearch is disabled via configuration")
        return None

    hosts = _parse_hosts(settings.opensearch_hosts)

    client_kwargs = {
        "hosts": hosts,
        "use_ssl": settings.opensearch_use_ssl,
        "verify_certs": settings.opensearch_verify_certs,
        "ssl_show_warn": False,
        "timeout": 30,
        "max_retries": 3,
        "retry_on_timeout": True,
    }

    # Add authentication if configured
    if settings.opensearch_user and settings.opensearch_password:
        client_kwargs["http_auth"] = (settings.opensearch_user, settings.opensearch_password)

    return OpenSearch(**client_kwargs)


def is_opensearch_available() -> bool:
    """
    Check if OpenSearch is available and responding.

    Results are cached for 30 seconds to avoid excessive health checks.
    Returns False if OpenSearch is disabled or unreachable.
    """
    global _health_check_cache

    settings = get_settings()
    if not settings.opensearch_enabled:
        return False

    now = time.time()
    if _health_check_cache["available"] is not None:
        if now - _health_check_cache["checked_at"] < HEALTH_CHECK_TTL:
            return _health_check_cache["available"]

    try:
        client = get_opensearch_client()
        if client is None:
            _health_check_cache = {"available": False, "checked_at": now}
            return False

        health = client.cluster.health()
        available = health.get("status") in ("green", "yellow")
        _health_check_cache = {"available": available, "checked_at": now}
        return available
    except Exception as e:
        logger.warning(f"OpenSearch health check failed: {e}")
        _health_check_cache = {"available": False, "checked_at": now}
        return False


def clear_health_cache() -> None:
    """Clear the health check cache (useful for testing)."""
    global _health_check_cache
    _health_check_cache = {"available": None, "checked_at": 0}
