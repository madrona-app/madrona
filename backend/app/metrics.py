"""
Prometheus metrics for Madrona backend observability.

This module provides metrics collection for:
- API request counts and latencies
- Database query performance
- Background task metrics
- Application health indicators

Usage:
    from app.metrics import (
        track_request_duration,
        track_db_query,
        increment_request_count,
    )

    # Track a request
    with track_request_duration(method="GET", endpoint="/api/objects"):
        # ... handle request

    # Track a database query
    with track_db_query(operation="select", table="collection_objects"):
        # ... execute query
"""

import time
from contextlib import contextmanager
from functools import wraps
from typing import Any, Callable, Generator, TypeVar

from prometheus_client import (
    Counter,
    Gauge,
    Histogram,
)

from app.logging import get_logger

logger = get_logger(__name__)

# Type variable for generic function decoration
F = TypeVar('F', bound=Callable[..., Any])

# =============================================================================
# API Request Metrics
# =============================================================================

# Total API requests counter
api_requests_total = Counter(
    'madrona_api_requests_total',
    'Total number of API requests',
    ['method', 'endpoint', 'status_code']
)

# API request duration histogram
api_request_duration_seconds = Histogram(
    'madrona_api_request_duration_seconds',
    'API request duration in seconds',
    ['method', 'endpoint'],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0)
)

# Active requests gauge
api_active_requests = Gauge(
    'madrona_api_active_requests',
    'Number of active API requests',
    ['method']
)

# =============================================================================
# Database Metrics
# =============================================================================

# Database query duration histogram
db_query_duration_seconds = Histogram(
    'madrona_db_query_duration_seconds',
    'Database query duration in seconds',
    ['operation', 'table'],
    buckets=(0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5)
)

# Database query counter
db_queries_total = Counter(
    'madrona_db_queries_total',
    'Total number of database queries',
    ['operation', 'table', 'status']
)

# Database connection pool gauge
db_pool_size = Gauge(
    'madrona_db_pool_size',
    'Database connection pool size',
    ['pool_type']
)

# =============================================================================
# Background Task Metrics
# =============================================================================

# Celery task counter
celery_tasks_total = Counter(
    'madrona_celery_tasks_total',
    'Total number of Celery tasks',
    ['task_name', 'status']
)

# Celery task duration histogram
celery_task_duration_seconds = Histogram(
    'madrona_celery_task_duration_seconds',
    'Celery task duration in seconds',
    ['task_name'],
    buckets=(0.1, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0)
)

# =============================================================================
# Context Managers for Tracking
# =============================================================================

@contextmanager
def track_request_duration(method: str, endpoint: str) -> Generator[None, None, None]:
    """
    Context manager for tracking API request duration.

    Args:
        method: HTTP method (GET, POST, etc.)
        endpoint: API endpoint path

    Example:
        with track_request_duration("GET", "/api/objects"):
            # ... handle request
    """
    api_active_requests.labels(method=method).inc()
    start_time = time.perf_counter()
    try:
        yield
    finally:
        duration = time.perf_counter() - start_time
        api_request_duration_seconds.labels(method=method, endpoint=endpoint).observe(duration)
        api_active_requests.labels(method=method).dec()


@contextmanager
def track_db_query(operation: str, table: str) -> Generator[None, None, None]:
    """
    Context manager for tracking database query duration.

    Args:
        operation: Query operation type (select, insert, update, delete)
        table: Table being queried

    Example:
        with track_db_query("select", "collection_objects"):
            # ... execute query
    """
    start_time = time.perf_counter()
    status = "success"
    try:
        yield
    except Exception:
        status = "error"
        raise
    finally:
        duration = time.perf_counter() - start_time
        db_query_duration_seconds.labels(operation=operation, table=table).observe(duration)
        db_queries_total.labels(operation=operation, table=table, status=status).inc()


# =============================================================================
# Helper Functions
# =============================================================================

def increment_request_count(method: str, endpoint: str, status_code: int) -> None:
    """Increment the API request counter."""
    api_requests_total.labels(
        method=method,
        endpoint=endpoint,
        status_code=str(status_code)
    ).inc()


def track_celery_task(task_name: str, status: str, duration: float) -> None:
    """Track a completed Celery task."""
    celery_tasks_total.labels(task_name=task_name, status=status).inc()
    celery_task_duration_seconds.labels(task_name=task_name).observe(duration)


def normalize_endpoint(path: str) -> str:
    """
    Normalize endpoint path by replacing dynamic segments with placeholders.

    This prevents high cardinality in metrics labels.

    Examples:
        /api/orgs/123/objects/456 -> /api/orgs/{id}/objects/{id}
    """
    import re
    # Replace UUIDs
    path = re.sub(
        r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',
        '{id}',
        path,
        flags=re.IGNORECASE
    )
    # Replace numeric IDs
    path = re.sub(r'/\d+(?=/|$)', '/{id}', path)
    return path


# =============================================================================
# Decorator for tracking function execution
# =============================================================================

def track_duration(metric_name: str, labels: dict[str, str] | None = None) -> Callable[[F], F]:
    """
    Decorator for tracking function execution duration.

    Args:
        metric_name: Base name for the metric
        labels: Additional labels to add

    Example:
        @track_duration("process_media", {"media_type": "image"})
        def process_image(data):
            ...
    """
    def decorator(func: F) -> F:
        histogram = Histogram(
            f'madrona_{metric_name}_duration_seconds',
            f'Duration of {metric_name} in seconds',
            list(labels.keys()) if labels else []
        )

        @wraps(func)
        def wrapper(*args: Any, **kwargs: Any) -> Any:
            start_time = time.perf_counter()
            try:
                return func(*args, **kwargs)
            finally:
                duration = time.perf_counter() - start_time
                if labels:
                    histogram.labels(**labels).observe(duration)
                else:
                    histogram.observe(duration)

        return wrapper  # type: ignore

    return decorator
