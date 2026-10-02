"""
Custom Celery base task classes with automatic RLS setup.

OrgTask: For org-scoped tasks — creates a standalone DB session and sets RLS context.
SystemTask: For cross-org/system tasks — creates a standalone DB session without RLS.
"""

import inspect
import logging

import celery

from app.database import get_session

logger = logging.getLogger(__name__)


class _TaskLifecycleMixin:
    """Shared lifecycle hooks for structured logging on task failure/retry."""

    def on_failure(self, exc, task_id, args, kwargs, einfo):
        logger.error(
            "task_failed",
            extra={
                "task_name": self.name,
                "task_id": task_id,
                "exception_type": type(exc).__name__,
                "exception_message": str(exc),
                "max_retries": getattr(self, "max_retries", None),
            },
        )
        super().on_failure(exc, task_id, args, kwargs, einfo)

    def on_retry(self, exc, task_id, args, kwargs, einfo):
        retries = self.request.retries if self.request else 0
        logger.warning(
            "task_retrying",
            extra={
                "task_name": self.name,
                "task_id": task_id,
                "retry_number": retries,
                "max_retries": getattr(self, "max_retries", None),
                "exception_type": type(exc).__name__,
                "exception_message": str(exc),
            },
        )
        super().on_retry(exc, task_id, args, kwargs, einfo)


class OrgTask(_TaskLifecycleMixin, celery.Task):
    """
    Base class for org-scoped Celery tasks.

    Wraps task execution in a standalone DB session and sets RLS context
    using the `organization_id` argument.
    """

    def __call__(self, *args, **kwargs):
        with get_session() as session:
            org_id = self._extract_org_id(args, kwargs)
            if org_id is None:
                raise ValueError(
                    f"OrgTask {self.name}: could not extract organization_id "
                    f"from args={args!r}, kwargs keys={list(kwargs.keys())}. "
                    f"All OrgTask functions must accept an organization_id parameter."
                )
            from app.tasks.rls_helpers import set_task_rls_context
            set_task_rls_context(session, org_id)
            return self.run(*args, **kwargs)

    def _extract_org_id(self, args, kwargs):
        if "organization_id" in kwargs:
            return kwargs["organization_id"]
        try:
            sig = inspect.signature(self.run)
            params = list(sig.parameters.keys())
            if "organization_id" in params:
                idx = params.index("organization_id")
                if idx < len(args):
                    return args[idx]
        except (ValueError, TypeError):
            pass
        return None


class SystemTask(_TaskLifecycleMixin, celery.Task):
    """
    Base class for system/cross-org Celery tasks.

    Wraps task execution in a standalone DB session without RLS context.
    System tasks should use admin_db_session() when they need cross-org access.
    """

    def __call__(self, *args, **kwargs):
        with get_session():
            return self.run(*args, **kwargs)
