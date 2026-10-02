"""
Org-scoped visitor curiosity insights (read-only aggregation).

The visitor-facing counterpart to `guide_insights.org_guide_insights`. Where the
staff view answers "what can't the assistant answer for our team", this view
answers "what are our visitors curious about" — the questions, objects, and
languages that show up in the public Guide widget.

Two data sources are stitched together, both explicitly scoped to one org:
  * `guide_metrics` (persona='visitor') — the questions visitors asked. This
    table has no RLS policy, so every query filters on organization_id by hand
    (same discipline as guide_insights.py).
  * the visitor engagement tables (`visitors` / `visits` / `visit_interactions`)
    — reach and behavior: how many people, how they arrived, what they looked
    at, and in which language.

Operator-only signal (tokens, cost, provider, latency) is deliberately omitted.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import Date, String, cast, desc, func
from sqlalchemy.orm import Session

from app.models import CollectionObject, ObjectTitle, Visit, VisitInteraction, Visitor
from app.services.agent_monitoring import GuideMetric

VISITOR_PERSONA = "visitor"


def org_visitor_insights(db: Session, organization_id: UUID, days: int = 30) -> dict:
    """Aggregate one org's visitor curiosity signal over the trailing `days`."""
    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    # guide_metrics has no RLS policy — scope every query to organization_id and
    # the visitor persona by hand (mirrors guide_insights.py).
    def visitor_metrics():
        return db.query(GuideMetric).filter(
            GuideMetric.organization_id == organization_id,
            GuideMetric.persona == VISITOR_PERSONA,
            GuideMetric.request_started_at >= cutoff,
        )

    total_questions = visitor_metrics().count()
    answered = visitor_metrics().filter(GuideMetric.empty_tool_results == 0).count()
    answered_rate = round(answered / total_questions, 4) if total_questions else None

    sat_rows = (
        visitor_metrics()
        .filter(GuideMetric.satisfaction.isnot(None))
        .with_entities(GuideMetric.satisfaction, func.count().label("count"))
        .group_by(GuideMetric.satisfaction)
        .all()
    )
    satisfaction = {r.satisfaction: r.count for r in sat_rows}

    # Reach — visitors seen and visits started in the window.
    visitors_count = (
        db.query(func.count(Visitor.visitor_id))
        .filter(
            Visitor.organization_id == organization_id,
            Visitor.last_seen_at >= cutoff,
        )
        .scalar()
        or 0
    )

    visits_q = db.query(Visit).filter(
        Visit.organization_id == organization_id,
        Visit.started_at >= cutoff,
    )
    visits_count = visits_q.count()
    qr_visits = visits_q.filter(Visit.source == "qr_scan").count()
    qr_scan_share = round(qr_visits / visits_count, 4) if visits_count else None

    daily_rows = (
        visitor_metrics()
        .with_entities(
            cast(GuideMetric.request_started_at, Date).label("day"),
            func.count().label("questions"),
        )
        .group_by("day")
        .order_by("day")
        .all()
    )
    daily = [{"date": r.day.isoformat(), "questions": r.questions} for r in daily_rows]

    top_objects = _top_objects(db, organization_id, cutoff, visitor_metrics)

    tq_rows = (
        visitor_metrics()
        .filter(GuideMetric.user_question.isnot(None))
        .with_entities(GuideMetric.user_question, func.count().label("count"))
        .group_by(GuideMetric.user_question)
        .order_by(desc("count"))
        .limit(10)
        .all()
    )
    top_questions = [{"question": r.user_question, "count": r.count} for r in tq_rows]

    unanswered_rows = (
        visitor_metrics()
        .filter(
            GuideMetric.empty_tool_results > 0,
            GuideMetric.user_question.isnot(None),
        )
        .with_entities(GuideMetric.user_question, func.count().label("count"))
        .group_by(GuideMetric.user_question)
        .order_by(desc("count"))
        .limit(10)
        .all()
    )
    unanswered = [{"question": r.user_question, "count": r.count} for r in unanswered_rows]

    lang_rows = (
        db.query(Visitor.locale, func.count(Visitor.visitor_id).label("visitors"))
        .filter(
            Visitor.organization_id == organization_id,
            Visitor.last_seen_at >= cutoff,
        )
        .group_by(Visitor.locale)
        .order_by(desc("visitors"))
        .all()
    )
    languages = [{"locale": r.locale, "visitors": r.visitors} for r in lang_rows]

    return {
        "period_days": days,
        "summary": {
            "total_questions": total_questions,
            "satisfaction": {
                "positive": satisfaction.get("positive", 0),
                "negative": satisfaction.get("negative", 0),
            },
            "answered_rate": answered_rate,
            "visitors": visitors_count,
            "visits": visits_count,
            "qr_scan_share": qr_scan_share,
        },
        "daily": daily,
        "top_objects": top_objects,
        "top_questions": top_questions,
        "unanswered": unanswered,
        "languages": languages,
    }


def _top_objects(db: Session, organization_id: UUID, cutoff, visitor_metrics) -> list[dict]:
    """Objects visitors were most curious about — questions + views + a title.

    Questions come from guide_metrics (persona='visitor', object pages), views
    from visit_interactions ('object_view'). One aggregate query per source, then
    a single title lookup for the top N (preferred title, else object_number).
    """
    # Questions per object, keyed by the string page_entity_id.
    q_rows = (
        visitor_metrics()
        .filter(
            GuideMetric.page_entity_type == "collection_object",
            GuideMetric.page_entity_id.isnot(None),
        )
        .with_entities(GuideMetric.page_entity_id, func.count().label("questions"))
        .group_by(GuideMetric.page_entity_id)
        .all()
    )
    questions_by_id: dict[str, int] = {r.page_entity_id: r.questions for r in q_rows}

    # Views per object from the engagement stream, keyed by the same string form.
    v_rows = (
        db.query(
            cast(VisitInteraction.entity_id, String).label("entity_id"),
            func.count().label("views"),
        )
        .filter(
            VisitInteraction.organization_id == organization_id,
            VisitInteraction.interaction_type == "object_view",
            VisitInteraction.entity_id.isnot(None),
            VisitInteraction.created_at >= cutoff,
        )
        .group_by("entity_id")
        .all()
    )
    views_by_id: dict[str, int] = {r.entity_id: r.views for r in v_rows}

    # Rank by questions (the curiosity signal); views break ties.
    all_ids = set(questions_by_id) | set(views_by_id)
    ranked = sorted(
        all_ids,
        key=lambda eid: (questions_by_id.get(eid, 0), views_by_id.get(eid, 0)),
        reverse=True,
    )[:10]

    titles = _object_titles(db, organization_id, ranked)

    return [
        {
            "entity_id": eid,
            "title": titles.get(eid),
            "questions": questions_by_id.get(eid, 0),
            "views": views_by_id.get(eid, 0),
        }
        for eid in ranked
    ]


def _object_titles(db: Session, organization_id: UUID, entity_ids: list[str]) -> dict[str, str]:
    """Map object-id strings to a display title (preferred title, else number)."""
    if not entity_ids:
        return {}

    # page_entity_id / entity_id arrive as strings; coerce to UUID for the join,
    # skipping anything that isn't a valid id rather than erroring the whole page.
    valid: dict[UUID, str] = {}
    for eid in entity_ids:
        try:
            valid[UUID(eid)] = eid
        except (ValueError, TypeError, AttributeError):
            continue
    if not valid:
        return {}

    rows = (
        db.query(CollectionObject.object_id, CollectionObject.object_number)
        .filter(
            CollectionObject.organization_id == organization_id,
            CollectionObject.object_id.in_(valid.keys()),
        )
        .all()
    )
    number_by_id = {row.object_id: row.object_number for row in rows}

    pref_rows = (
        db.query(ObjectTitle.object_id, ObjectTitle.title)
        .filter(
            ObjectTitle.organization_id == organization_id,
            ObjectTitle.object_id.in_(valid.keys()),
            ObjectTitle.is_preferred.is_(True),
        )
        .all()
    )
    preferred_by_id = {row.object_id: row.title for row in pref_rows}

    titles: dict[str, str] = {}
    for oid, eid in valid.items():
        title = preferred_by_id.get(oid) or number_by_id.get(oid)
        if title is not None:
            titles[eid] = title
    return titles
