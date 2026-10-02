"""
Health/infra router — 6 routes migrated from Flask.

Sources:
- app/main.py (lines 733-886): health, metrics, security.txt, root
"""

import logging
import time
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.utils.version import get_app_version
from app.fastapi_app.schemas.health import (
    RootResponse,
    HealthResponse,
    SearchHealthResponse,
    DeepHealthResponse,
)

logger = logging.getLogger(__name__)

router = APIRouter(tags=["health"])


@router.get("/", response_model=RootResponse, summary="Root")
def root():
    """Root — API name, version, docs link."""
    return {
        "name": "Madrona API",
        "version": get_app_version(),
        "api_base": "/api",
        "docs": "/api/_docs",
    }


@router.get("/health", response_model=HealthResponse, summary="Health")
def health():
    """Basic health check — minimal payload for ALB target-group probes."""
    return {"status": "healthy"}


@router.get("/health/search", response_model=SearchHealthResponse, summary="Search health")
def search_health():
    """Check OpenSearch cluster health."""
    from app.search.client import get_opensearch_client, is_opensearch_available

    settings = get_settings()

    if not settings.opensearch_enabled:
        return {"status": "disabled", "message": "OpenSearch is disabled in configuration"}

    if not is_opensearch_available():
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "message": "OpenSearch is not responding"},
        )

    try:
        client = get_opensearch_client()
        h = client.cluster.health()
        return {
            "status": h["status"],
            "cluster_name": h["cluster_name"],
            "number_of_nodes": h["number_of_nodes"],
            "active_shards": h["active_shards"],
            "relocating_shards": h["relocating_shards"],
            "initializing_shards": h["initializing_shards"],
            "unassigned_shards": h["unassigned_shards"],
        }
    except Exception as e:
        logger.warning("OpenSearch health check failed: %s", e)
        return JSONResponse(
            status_code=503,
            content={"status": "error", "message": "OpenSearch health check failed"},
        )


@router.get("/health/deep", summary="Health deep")
def health_deep(db: Session = Depends(get_db)):
    """
    Deep health check — DB, Redis, OpenSearch.

    Returns 200 if all critical services are reachable, 503 if any critical
    service is down.
    """
    settings = get_settings()
    checks = {}
    all_healthy = True
    start = time.monotonic()

    # 1. Database check
    try:
        db.execute(text("SELECT 1"))
        bind = db.get_bind()
        pool = bind.pool
        checks["database"] = {
            "status": "healthy",
            "pool_size": pool.size(),
            "checked_in": pool.checkedin(),
            "checked_out": pool.checkedout(),
            "overflow": pool.overflow(),
        }
    except Exception as e:
        logger.warning("Health check: database unreachable: %s", e)
        checks["database"] = {"status": "unhealthy"}
        all_healthy = False

    # 2. Redis check
    try:
        from app.services.redis_client import get_redis_client

        redis = get_redis_client()
        if redis.is_available():
            checks["redis"] = {"status": "healthy"}
        else:
            checks["redis"] = {"status": "unhealthy"}
            all_healthy = False
    except Exception as e:
        logger.warning("Health check: redis unreachable: %s", e)
        checks["redis"] = {"status": "unhealthy"}
        all_healthy = False

    # 3. OpenSearch check (non-critical — degraded, not unhealthy)
    if settings.opensearch_enabled:
        try:
            from app.search.client import get_opensearch_client

            client = get_opensearch_client()
            # Match /health/search call style exactly — bare
            # client.cluster.health() returns green on the same
            # cluster where passing any timeout kwarg ("3s", 3,
            # request_timeout=3) silently fails and trips the broad
            # except below. Whatever the underlying mismatch is in
            # opensearch-py v3.1.0's transport layer, the no-arg
            # form is what works in production and is sufficient
            # for a liveness probe.
            h = client.cluster.health()
            checks["opensearch"] = {"status": h.get("status", "unknown")}
        except Exception as e:
            logger.warning("Health check: opensearch unreachable: %s", e)
            checks["opensearch"] = {"status": "unavailable"}
    else:
        checks["opensearch"] = {"status": "disabled"}

    elapsed_ms = round((time.monotonic() - start) * 1000)
    status_code = 200 if all_healthy else 503

    return JSONResponse(
        status_code=status_code,
        content={
            "status": "healthy" if all_healthy else "unhealthy",
            "checks": checks,
            "response_time_ms": elapsed_ms,
        },
    )


@router.get("/metrics", summary="Metrics")
def metrics():
    """Prometheus metrics endpoint."""
    from prometheus_client import CONTENT_TYPE_LATEST, REGISTRY, generate_latest

    return Response(content=generate_latest(REGISTRY), media_type=CONTENT_TYPE_LATEST)


@router.get("/.well-known/security.txt", summary="Security txt")
def security_txt():
    """RFC 9116 security contact."""
    settings = get_settings()
    contact = settings.security_contact or f"mailto:security@{settings.app_base_url.split('//')[1].split(':')[0]}"
    # RFC 9116 requires Expires and says a consumer should ignore the file
    # once it has passed. A literal date does that on a schedule nobody is
    # watching — this one was 2027-02-07 — so it is computed a year out from
    # the request instead, and can never silently lapse.
    expires = (datetime.now(timezone.utc) + timedelta(days=365)).strftime(
        "%Y-%m-%dT%H:%M:%S.000Z"
    )
    body = (
        f"Contact: {contact}\n"
        f"Expires: {expires}\n"
        "Preferred-Languages: en\n"
    )
    return PlainTextResponse(body)
