"""
Server Management admin router.

Provides server status overview and maintenance actions for platform admins.
"""

import logging
from uuid import UUID

import httpx
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.config import get_settings
from app.database import get_db
from app.fastapi_app.dependencies.auth import require_platform_admin
from app.fastapi_app.schemas.server_management import (
    FeatureFlags,
    ServerActionRequest,
    ServerActionResponse,
    ServerStatusResponse,
    ServiceStatus,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/admin",
    tags=["server-management"],
    dependencies=[Depends(require_platform_admin)],
)


def _check_database(db: Session) -> ServiceStatus:
    try:
        db.execute(text("SELECT 1"))
        bind = db.get_bind()
        pool = bind.pool
        return ServiceStatus(
            status="healthy",
            details={
                "pool_size": pool.size(),
                "checked_in": pool.checkedin(),
                "checked_out": pool.checkedout(),
                "overflow": pool.overflow(),
            },
        )
    except Exception as e:
        logger.warning("Server status: database check failed: %s", e)
        return ServiceStatus(status="unavailable")


def _check_redis() -> ServiceStatus:
    try:
        from app.services.redis_client import get_redis_client

        redis = get_redis_client()
        if redis.is_available():
            return ServiceStatus(
                status="healthy",
                details={"pool_size": redis._pool_size},
            )
        return ServiceStatus(status="unavailable")
    except Exception as e:
        logger.warning("Server status: redis check failed: %s", e)
        return ServiceStatus(status="unavailable")


def _check_opensearch() -> ServiceStatus:
    settings = get_settings()
    if not settings.opensearch_enabled:
        return ServiceStatus(status="disabled")

    try:
        from app.search.client import get_opensearch_client, is_opensearch_available

        if not is_opensearch_available():
            return ServiceStatus(status="unavailable")

        client = get_opensearch_client()
        h = client.cluster.health(request_timeout=3)
        cluster_status = h.get("status", "unknown")
        num_nodes = h.get("number_of_nodes", 1)

        # Map OpenSearch cluster status to service status
        if cluster_status == "green":
            status = "healthy"
        elif cluster_status == "yellow" and num_nodes == 1:
            # Yellow on single-node is expected (no replica target), treat as healthy
            status = "healthy"
        elif cluster_status == "yellow":
            # Yellow on multi-node means replicas are unassigned — a real issue
            status = "yellow"
        elif cluster_status == "red":
            status = "degraded"
        else:
            status = "unknown"

        return ServiceStatus(
            status=status,
            details={
                "cluster_name": h.get("cluster_name"),
                "cluster_status": cluster_status,
                "number_of_nodes": num_nodes,
                "active_shards": h.get("active_shards"),
                "unassigned_shards": h.get("unassigned_shards"),
            },
        )
    except Exception as e:
        logger.warning("Server status: opensearch check failed: %s", e)
        return ServiceStatus(status="unavailable")


def _check_celery() -> ServiceStatus:
    try:
        from app.celery_app import celery_app

        inspect = celery_app.control.inspect(timeout=3.0)
        active = inspect.active() or {}
        reserved = inspect.reserved() or {}

        worker_count = len(active)
        queue_stats = {}
        for worker, tasks in active.items():
            queue_stats[worker] = {
                "active": len(tasks),
                "reserved": len(reserved.get(worker, [])),
            }

        return ServiceStatus(
            status="healthy" if worker_count > 0 else "no_workers",
            details={
                "worker_count": worker_count,
                "queues": queue_stats,
            },
        )
    except Exception as e:
        logger.warning("Server status: celery check failed: %s", e)
        return ServiceStatus(status="unavailable")


def _check_ollama() -> ServiceStatus:
    settings = get_settings()
    if not settings.agent_enabled and not settings.semantic_search_enabled:
        return ServiceStatus(status="disabled")

    try:
        resp = httpx.get(f"{settings.ollama_base_url}/api/tags", timeout=2.0)
        if resp.status_code == 200:
            data = resp.json()
            models = [m.get("name", "unknown") for m in data.get("models", [])]
            return ServiceStatus(
                status="healthy",
                details={"loaded_models": models},
            )
        return ServiceStatus(status="unavailable")
    except Exception as e:
        logger.warning("Server status: ollama check failed: %s", e)
        return ServiceStatus(status="unavailable")


def _get_storage_status() -> ServiceStatus:
    settings = get_settings()
    return ServiceStatus(
        status="configured",
        details={
            "provider": "s3",
            "region": settings.aws_region,
        },
    )


@router.get("/server-status", response_model=ServerStatusResponse, summary="Get server status")
def get_server_status(db: Session = Depends(get_db)):
    """Aggregated server status for platform admins."""
    settings = get_settings()

    environment = {
        "app_env": settings.app_env,
        "version": "1.0.0",
        "canonical_validation_mode": settings.canonical_validation_mode,
    }

    feature_flags = FeatureFlags(
        opensearch=settings.opensearch_enabled,
        clip=settings.clip_enabled,
        whisper=settings.whisper_enabled,
        ocr=settings.ocr_enabled,
        semantic_search=settings.semantic_search_enabled,
        tus=settings.tus_enabled,
        unoserver=settings.unoserver_enabled,
        agent=settings.agent_enabled,
    )

    services = {
        "database": _check_database(db),
        "redis": _check_redis(),
        "opensearch": _check_opensearch(),
        "celery": _check_celery(),
        "ollama": _check_ollama(),
        "storage": _get_storage_status(),
    }

    return ServerStatusResponse(
        environment=environment,
        feature_flags=feature_flags,
        services=services,
    )


@router.post("/server-actions", response_model=ServerActionResponse, summary="Run server action")
def run_server_action(
    body: ServerActionRequest,
    db: Session = Depends(get_db),
):
    """Run a maintenance action."""
    settings = get_settings()
    action = body.action

    if action == "reindex_collections":
        if not body.organization_id:
            raise HTTPException(status_code=400, detail="organization_id is required")
        try:
            from app.search.collections.service import get_collections_search_service

            service = get_collections_search_service()
            stats = service.reindex_organization(db, UUID(body.organization_id))
            return ServerActionResponse(
                success=True,
                action=action,
                message="Collections reindex completed",
                details=stats,
            )
        except Exception as e:
            logger.error("Reindex collections failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

    elif action == "reindex_media":
        if not body.organization_id:
            raise HTTPException(status_code=400, detail="organization_id is required")
        try:
            from app.search.media.service import get_media_search_service

            service = get_media_search_service()
            stats = service.reindex_organization(db, UUID(body.organization_id))
            return ServerActionResponse(
                success=True,
                action=action,
                message="Media reindex completed",
                details=stats,
            )
        except Exception as e:
            logger.error("Reindex media failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

    elif action == "clear_redis_cache":
        if settings.app_env == "production" and not body.confirm:
            raise HTTPException(
                status_code=400,
                detail="confirm=true is required for cache clear in production",
            )
        try:
            from app.services.redis_client import get_redis_client

            redis = get_redis_client()
            if not redis.is_available():
                raise HTTPException(status_code=503, detail="Redis is unavailable")
            redis.client.flushdb()
            return ServerActionResponse(
                success=True,
                action=action,
                message="Redis cache cleared",
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Clear redis cache failed: %s", e)
            raise HTTPException(status_code=500, detail=str(e))

    else:
        raise HTTPException(status_code=400, detail=f"Unknown action: {action}")
