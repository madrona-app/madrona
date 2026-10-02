"""
Preservation policy evaluation and reporting.

Evaluates active PreservationPolicy rules against matching media and creates
PreservationActionPlan entries for media that need attention.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import UUID

from sqlalchemy import func
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)


def evaluate_policies(org_id: UUID, session: Session) -> dict[str, Any]:
    """
    For each active policy in the organization, find matching media and create
    PreservationActionPlan entries where none exist.
    """
    from app.models import Media
    from app.models.preservation import (
        PreservationActionPlan,
        PreservationPolicy,
    )

    policies = (
        session.query(PreservationPolicy)
        .filter(
            PreservationPolicy.organization_id == org_id,
            PreservationPolicy.is_active.is_(True),
        )
        .order_by(PreservationPolicy.priority.desc())
        .all()
    )

    actions_created = 0

    for policy in policies:
        scope = policy.scope or {}
        rules = policy.rules or {}

        # Build media query based on scope
        query = session.query(Media).filter(
            Media.organization_id == org_id,
            Media.processing_status == "completed",
        )

        target = scope.get("target", "all")
        if target == "media_type":
            query = query.filter(Media.media_type == scope.get("value"))
        elif target == "pronom_puid":
            query = query.filter(Media.pronom_puid == scope.get("value"))

        # Exclude media that already have an action plan for this policy
        existing_plans = (
            session.query(PreservationActionPlan.media_id)
            .filter(
                PreservationActionPlan.policy_id == policy.policy_id,
                PreservationActionPlan.status.notin_(["completed", "cancelled"]),
            )
            .subquery()
        )
        query = query.filter(
            ~Media.media_id.in_(session.query(existing_plans.c.media_id))
        )

        media_items = query.limit(1000).all()

        for media in media_items:
            action_type, detail, scheduled_for = _derive_action(
                policy.policy_type, rules, media
            )
            if action_type is None:
                continue

            plan = PreservationActionPlan(
                organization_id=org_id,
                policy_id=policy.policy_id,
                media_id=media.media_id,
                action_type=action_type,
                detail=detail,
                status="pending",
                scheduled_for=scheduled_for,
            )
            session.add(plan)
            actions_created += 1

    return {
        "policies_evaluated": len(policies),
        "actions_created": actions_created,
    }


def _derive_action(
    policy_type: str, rules: dict, media: Any
) -> tuple[str | None, dict | None, datetime | None]:
    """
    Derive the action type, detail, and scheduled_for from a policy and media.
    Returns (None, None, None) if no action is needed.
    """
    now = datetime.now(timezone.utc)

    if policy_type == "retention":
        retain_years = rules.get("retain_years")
        if not retain_years:
            return None, None, None
        action = rules.get("action", "review")
        notify_days = rules.get("notify_days_before", 90)
        # Check if media is approaching retention limit
        if media.created_at:
            expiry = media.created_at + timedelta(days=retain_years * 365)
            review_date = expiry - timedelta(days=notify_days)
            if now >= review_date:
                return (
                    "review_retention",
                    {
                        "retain_years": retain_years,
                        "expiry_date": expiry.isoformat(),
                        "action": action,
                    },
                    expiry,
                )
        return None, None, None

    elif policy_type == "format_migration":
        source_puid = rules.get("source_puid")
        target_puid = rules.get("target_puid")
        if source_puid and media.pronom_puid == source_puid:
            return (
                "migrate_format",
                {
                    "source_puid": source_puid,
                    "target_puid": target_puid,
                    "auto_migrate": rules.get("auto_migrate", False),
                },
                None,
            )
        return None, None, None

    elif policy_type == "normalization":
        target_puid = rules.get("target_puid")
        if rules.get("on_ingest") and media.pronom_puid != target_puid:
            return (
                "migrate_format",
                {
                    "source_puid": media.pronom_puid,
                    "target_puid": target_puid,
                    "preserve_original": rules.get("preserve_original", True),
                    "normalization": True,
                },
                None,
            )
        return None, None, None

    return None, None, None


def evaluate_policies_all_orgs(session: Session) -> dict[str, Any]:
    """
    Evaluate active policies across all organizations.
    Called by the daily Celery task.
    """
    from app.models.preservation import PreservationPolicy

    org_ids = (
        session.query(PreservationPolicy.organization_id)
        .filter(PreservationPolicy.is_active.is_(True))
        .distinct()
        .all()
    )

    total_policies = 0
    total_actions = 0

    for (org_id,) in org_ids:
        result = evaluate_policies(org_id, session)
        total_policies += result["policies_evaluated"]
        total_actions += result["actions_created"]

    return {
        "organizations_processed": len(org_ids),
        "policies_evaluated": total_policies,
        "actions_created": total_actions,
    }


def get_retention_report(org_id: UUID, session: Session) -> dict[str, Any]:
    """Media grouped by retention status."""
    from app.models import Media
    from app.models.preservation import PreservationActionPlan

    pending = (
        session.query(func.count(PreservationActionPlan.action_id))
        .filter(
            PreservationActionPlan.organization_id == org_id,
            PreservationActionPlan.action_type == "review_retention",
            PreservationActionPlan.status == "pending",
        )
        .scalar()
    )

    total_media = (
        session.query(func.count(Media.media_id))
        .filter(Media.organization_id == org_id)
        .scalar()
    )

    return {
        "total_media": total_media,
        "pending_retention_reviews": pending,
    }


def get_migration_plan_summary(org_id: UUID, session: Session) -> list[dict]:
    """Pending format migrations grouped by source/target format."""
    from app.models.preservation import PreservationActionPlan

    plans = (
        session.query(PreservationActionPlan)
        .filter(
            PreservationActionPlan.organization_id == org_id,
            PreservationActionPlan.action_type == "migrate_format",
            PreservationActionPlan.status.in_(["pending", "approved"]),
        )
        .all()
    )

    summary: dict[str, dict] = {}
    for plan in plans:
        detail = plan.detail or {}
        key = f"{detail.get('source_puid', '?')}->{detail.get('target_puid', '?')}"
        if key not in summary:
            summary[key] = {
                "source_puid": detail.get("source_puid"),
                "target_puid": detail.get("target_puid"),
                "count": 0,
                "statuses": {},
            }
        summary[key]["count"] += 1
        status = plan.status
        summary[key]["statuses"][status] = summary[key]["statuses"].get(status, 0) + 1

    return list(summary.values())
