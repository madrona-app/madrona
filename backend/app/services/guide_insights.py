"""
Org-scoped Guide usage insights (read-only aggregation over guide_metrics).

Counterpart to the cross-tenant platform-admin analytics: scoped to ONE org and
stripped of operator-only data (cost, tokens, provider, latency, cross-org).
The headline is `corpus_gaps` — questions where a tool/RAG lookup returned
empty (`empty_tool_results > 0`), i.e. what the assistant couldn't answer.

Extracted as a plain function so it can be probed/unit-tested without the
FastAPI dependency stack.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import Date, cast, desc, func
from sqlalchemy.orm import Session

from app.services.agent_monitoring import GuideMetric


def org_guide_insights(
    db: Session,
    organization_id: UUID,
    days: int = 30,
    personas: tuple[str, ...] | None = None,
) -> dict:
    """Aggregate one org's Guide usage over the trailing `days` window.

    `personas` restricts the aggregation to specific Guide personas. The
    default (None) means every persona EXCEPT the public visitor — staff,
    guide, and the specialist personas staff conversations get routed to
    (registrar, conservator, ...) all count as staff-side usage. Visitor
    traffic is surfaced separately via visitor_insights.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # guide_metrics has no RLS policy (same as the guide_documents sibling), so
    # every query is explicitly scoped to organization_id (and to `personas`).
    def scoped():
        q = db.query(GuideMetric).filter(
            GuideMetric.organization_id == organization_id,
            GuideMetric.request_started_at >= cutoff,
        )
        if personas is not None:
            return q.filter(GuideMetric.persona.in_(personas))
        return q.filter(GuideMetric.persona != "visitor")

    total_requests = scoped().count()
    gap_count = scoped().filter(GuideMetric.empty_tool_results > 0).count()
    answered_rate = round(1 - gap_count / total_requests, 4) if total_requests else None

    sat_rows = (
        scoped()
        .filter(GuideMetric.satisfaction.isnot(None))
        .with_entities(GuideMetric.satisfaction, func.count().label("count"))
        .group_by(GuideMetric.satisfaction)
        .all()
    )
    satisfaction = {r.satisfaction: r.count for r in sat_rows}

    # Corpus gaps — empty-result questions, grouped so a recurring gap ranks.
    gap_rows = (
        scoped()
        .filter(
            GuideMetric.empty_tool_results > 0,
            GuideMetric.user_question.isnot(None),
        )
        .with_entities(
            GuideMetric.user_question,
            func.count().label("count"),
            func.max(GuideMetric.request_started_at).label("last_seen"),
            func.max(GuideMetric.page_route).label("sample_route"),
            func.max(GuideMetric.page_entity_type).label("sample_entity_type"),
        )
        .group_by(GuideMetric.user_question)
        .order_by(desc("count"), desc("last_seen"))
        .limit(25)
        .all()
    )
    corpus_gaps = [
        {
            "question": r.user_question,
            "count": r.count,
            "last_seen": r.last_seen.isoformat() if r.last_seen else None,
            "sample_route": r.sample_route,
            "sample_entity_type": r.sample_entity_type,
        }
        for r in gap_rows
    ]

    tq_rows = (
        scoped()
        .filter(GuideMetric.user_question.isnot(None))
        .with_entities(GuideMetric.user_question, func.count().label("count"))
        .group_by(GuideMetric.user_question)
        .order_by(desc("count"))
        .limit(15)
        .all()
    )
    top_questions = [{"question": r.user_question, "count": r.count} for r in tq_rows]

    tp_rows = (
        scoped()
        .filter(GuideMetric.page_route.isnot(None))
        .with_entities(GuideMetric.page_route, func.count().label("count"))
        .group_by(GuideMetric.page_route)
        .order_by(desc("count"))
        .limit(10)
        .all()
    )
    top_pages = [{"route": r.page_route, "count": r.count} for r in tp_rows]

    daily_rows = (
        scoped()
        .with_entities(
            cast(GuideMetric.request_started_at, Date).label("day"),
            func.count().label("requests"),
        )
        .group_by("day")
        .order_by("day")
        .all()
    )
    daily = [{"date": r.day.isoformat(), "requests": r.requests} for r in daily_rows]

    return {
        "period_days": days,
        "summary": {
            "total_requests": total_requests,
            "answered_rate": answered_rate,
            "gap_count": gap_count,
            "satisfaction_positive": satisfaction.get("positive", 0),
            "satisfaction_negative": satisfaction.get("negative", 0),
        },
        "corpus_gaps": corpus_gaps,
        "top_questions": top_questions,
        "top_pages": top_pages,
        "daily": daily,
    }
