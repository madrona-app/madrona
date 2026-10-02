"""
Background tasks for scheduled Discover publishing.

Periodically checks for publish schedules that are due and executes them.
"""

import logging
from datetime import datetime, timezone
from typing import Any
from uuid import UUID

from app.celery_app import celery_app
from app.database import current_session
from app.tasks.base import SystemTask

logger = logging.getLogger(__name__)


@celery_app.task(
    base=SystemTask,
    name='app.tasks.discover.check_due_publish_schedules',
    soft_time_limit=60,
    time_limit=120,
)
def check_due_publish_schedules_task() -> dict[str, Any]:
    """
    Check for publish schedules that are due and execute them.

    Runs periodically (every minute via Celery Beat) to:
    1. Find all pending schedules where scheduled_for <= now
    2. Execute the publish/unpublish action for each
    3. Update schedule status to executed/failed
    """
    from app.models import CollectionObject, PublishSchedule
    from app.tasks.rls_helpers import admin_db_session, set_task_rls_context

    try:
        now = datetime.now(timezone.utc)

        # System task: finding which schedules are due spans every org, so it
        # needs BYPASSRLS. Only the IDs come out of that session.
        #
        # This used to select the ORM objects and then use them after the `with`
        # block had closed the session. Two things followed. Every attribute
        # that was not already loaded raised DetachedInstanceError, which the
        # outer handler swallowed into `success: False`. Worse, the status
        # writes below (`schedule.status = "executed"`) were applied to objects
        # attached to no session at all, so they were silently discarded — the
        # objects were published, the schedule stayed `pending`, and the whole
        # thing ran again on the next beat, forever.
        #
        # admin_db_session() does not set the current_session contextvar, so the
        # session used in the loop is a different one (the app role, set up by
        # SystemTask) — which is why the mismatch was not obvious from reading.
        with admin_db_session() as admin_session:
            # (id, org) pairs, not just ids: the org is needed to set RLS
            # context BEFORE the row can be re-read on the app-role session.
            due_schedules = [
                (row[0], row[1])
                for row in admin_session.query(
                    PublishSchedule.schedule_id, PublishSchedule.organization_id
                ).filter(
                    PublishSchedule.status == "pending",
                    PublishSchedule.scheduled_for <= now,
                ).all()
            ]

        if not due_schedules:
            return {
                "success": True,
                "checked_at": now.isoformat(),
                "due_count": 0,
                "executed_count": 0,
                "failed_count": 0,
            }

        executed_count = 0
        failed_count = 0

        for schedule_id, org_id in due_schedules:
            try:
                # RLS context first, then re-read. The order matters: the app
                # role cannot see publish_schedules rows until their org is in
                # scope, so querying before this would find nothing and skip
                # every schedule — silently, since a missing row is a legitimate
                # outcome (deleted between the scan and now).
                set_task_rls_context(current_session(), str(org_id))

                # Re-read on the working session so every write below lands on a
                # live instance rather than a detached one.
                schedule = current_session().query(PublishSchedule).filter(
                    PublishSchedule.schedule_id == schedule_id
                ).one_or_none()
                if schedule is None:
                    logger.warning(
                        "Publish schedule %s was due but is not visible on the "
                        "working session; skipping", schedule_id,
                    )
                    continue

                is_discoverable = schedule.action == "publish"
                updated_count = 0
                skipped_restricted = 0

                if schedule.object_ids:
                    # Object IDs mode
                    obj_uuids = [UUID(oid) for oid in schedule.object_ids]
                    objects = current_session().query(CollectionObject).filter(
                        CollectionObject.object_id.in_(obj_uuids),
                        CollectionObject.organization_id == org_id,
                    ).all()
                elif schedule.criteria:
                    # Criteria mode - build query from criteria
                    objects = _query_by_criteria(org_id, schedule.criteria)
                else:
                    schedule.status = "failed"
                    schedule.error_message = "No criteria or object_ids specified"
                    schedule.executed_at = now
                    failed_count += 1
                    continue

                # NAGPRA display gate: scheduled publishes must not flip
                # objects without granted display consent public.
                if is_discoverable and objects:
                    from app.services.nagpra_restrictions import display_restricted_ids
                    restricted_ids = display_restricted_ids(
                        current_session(), org_id, [o.object_id for o in objects],
                    )
                    if restricted_ids:
                        skipped_restricted = len(restricted_ids)
                        objects = [o for o in objects if o.object_id not in restricted_ids]
                        logger.info(
                            "Publish schedule %s: skipped %d NAGPRA display-restricted objects",
                            schedule.schedule_id, skipped_restricted,
                        )

                for obj in objects:
                    if obj.is_discoverable == is_discoverable:
                        continue
                    obj.is_discoverable = is_discoverable
                    if is_discoverable:
                        obj.discoverable_at = now
                        obj.discoverable_by = schedule.created_by
                    else:
                        obj.discoverable_at = None
                        obj.discoverable_by = None
                    obj.updated_by = schedule.created_by
                    updated_count += 1

                schedule.status = "executed"
                schedule.result_count = updated_count
                schedule.executed_at = now
                executed_count += 1

                logger.info(
                    "Executed publish schedule: schedule=%s, action=%s, updated=%d",
                    schedule.schedule_id, schedule.action, updated_count,
                )

                # Re-index affected objects
                try:
                    from app.fastapi_app.serializers.collections_helpers import _index_collection_object
                    for obj in objects:
                        _index_collection_object(obj)
                except Exception as e:
                    logger.warning(
                        "Failed to re-index objects for schedule %s: %s",
                        schedule.schedule_id, str(e),
                    )

            except Exception as e:
                logger.error(
                    "Failed to execute schedule %s: %s",
                    schedule.schedule_id, str(e),
                )
                schedule.status = "failed"
                schedule.error_message = str(e)[:500]
                schedule.executed_at = now
                failed_count += 1

        current_session().commit()

        if executed_count > 0 or failed_count > 0:
            logger.info(
                "Publish schedule check complete: executed=%d, failed=%d",
                executed_count, failed_count,
            )

        return {
            "success": True,
            "checked_at": now.isoformat(),
            "due_count": len(due_schedules),
            "executed_count": executed_count,
            "failed_count": failed_count,
        }

    except Exception as e:
        logger.error("Failed to check due publish schedules: %s", str(e), exc_info=True)
        return {
            "success": False,
            "error": str(e),
        }


def _query_by_criteria(org_id, criteria: dict) -> list:
    """Build a query from criteria dict and return matching objects."""
    from sqlalchemy import text
    from app.models import CollectionObject, CollectionObjectMedia, Media
    from app.services.api_security import escape_ilike

    query = current_session().query(CollectionObject).filter(
        CollectionObject.organization_id == org_id,
    )

    if "object_type" in criteria:
        val = criteria["object_type"]
        if isinstance(val, list):
            query = query.filter(CollectionObject.object_type.in_(val))
        else:
            query = query.filter(CollectionObject.object_type == val)

    if "classification" in criteria:
        val = criteria["classification"]
        search_term = f"%{escape_ilike(val)}%"
        cls_search = text(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(classifications) AS c "
            "WHERE c->>'term' ILIKE :cls_search)"
        ).bindparams(cls_search=search_term)
        query = query.filter(cls_search)

    if "object_status" in criteria:
        query = query.filter(CollectionObject.object_status == criteria["object_status"])

    if "has_image" in criteria:
        has_img = bool(criteria["has_image"])
        img_subquery = current_session().query(CollectionObjectMedia.object_id).join(
            Media, CollectionObjectMedia.media_id == Media.media_id
        ).filter(
            Media.is_published == True,
        ).subquery()
        if has_img:
            query = query.filter(CollectionObject.object_id.in_(
                current_session().query(img_subquery.c.object_id)
            ))
        else:
            query = query.filter(~CollectionObject.object_id.in_(
                current_session().query(img_subquery.c.object_id)
            ))

    if "creator" in criteria:
        val = criteria["creator"]
        search_term = f"%{escape_ilike(val)}%"
        creator_search = text(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(creators) AS c "
            "WHERE c->>'name' ILIKE :creator_search)"
        ).bindparams(creator_search=search_term)
        query = query.filter(creator_search)

    if "material" in criteria:
        val = criteria["material"]
        search_term = f"%{escape_ilike(val)}%"
        mat_search = text(
            "EXISTS (SELECT 1 FROM jsonb_array_elements(materials) AS m "
            "WHERE m->>'material' ILIKE :mat_search)"
        ).bindparams(mat_search=search_term)
        query = query.filter(mat_search)

    if "creation_date_from" in criteria:
        query = query.filter(
            CollectionObject.creation_date_earliest >= criteria["creation_date_from"]
        )

    if "creation_date_to" in criteria:
        query = query.filter(
            CollectionObject.creation_date_latest <= criteria["creation_date_to"]
        )

    if "current_location_id" in criteria:
        from uuid import UUID as UUIDType
        query = query.filter(
            CollectionObject.current_location_id == UUIDType(criteria["current_location_id"])
        )

    return query.all()
