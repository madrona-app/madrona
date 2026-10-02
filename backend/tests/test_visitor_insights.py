"""Unit tests for the org-scoped visitor curiosity insights aggregation.

Verifies persona scoping (visitor rows only), the object questions↔views join,
qr_scan_share, unanswered grouping, and language breakdown — over the real query
path against the test DB (db_session rolls back). Also regression-guards that the
staff-facing org_guide_insights now EXCLUDES visitor traffic.
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models import CollectionObject, ObjectTitle, Organization, Visit, VisitInteraction, Visitor
from app.services.agent_monitoring import GuideMetric
from app.services.guide_insights import org_guide_insights
from app.services.visitor_insights import org_visitor_insights


@pytest.fixture
def org(db_session):
    o = Organization(name="Visitor Museum", slug=f"vis-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


def _metric(org_id, **kw):
    base = dict(
        organization_id=org_id,
        persona="visitor",
        request_started_at=datetime.now(timezone.utc),
        response_latency_ms=100,
        model_provider="claude",
    )
    base.update(kw)
    return GuideMetric(**base)


def _visitor(org_id, locale="en", token=None):
    return Visitor(
        organization_id=org_id,
        session_token=token or uuid4().hex,
        locale=locale,
    )


def test_empty_org_returns_zeroed_summary(db_session, org):
    res = org_visitor_insights(db_session, org.organization_id, days=30)
    s = res["summary"]
    assert s["total_questions"] == 0
    assert s["answered_rate"] is None  # no divide-by-zero
    assert s["visitors"] == 0
    assert s["visits"] == 0
    assert s["qr_scan_share"] is None
    assert res["top_objects"] == []
    assert res["languages"] == []


def test_only_visitor_persona_counts(db_session, org):
    db_session.add_all([
        _metric(org.organization_id, persona="visitor", user_question="who painted this?"),
        _metric(org.organization_id, persona="staff", user_question="log a loan?"),
        _metric(org.organization_id, persona="guide", user_question="deaccession policy?"),
    ])
    db_session.commit()

    res = org_visitor_insights(db_session, org.organization_id, days=1)
    assert res["summary"]["total_questions"] == 1
    assert [q["question"] for q in res["top_questions"]] == ["who painted this?"]


def test_scoped_to_caller_org(db_session, org):
    other = Organization(name="Other Museum", slug=f"oth-{uuid4().hex[:8]}")
    db_session.add(other)
    db_session.commit()
    db_session.add_all([
        _metric(org.organization_id, user_question="mine"),
        _metric(other.organization_id, user_question="theirs"),
    ])
    db_session.commit()

    res = org_visitor_insights(db_session, org.organization_id, days=1)
    assert res["summary"]["total_questions"] == 1
    assert [q["question"] for q in res["top_questions"]] == ["mine"]


def test_answered_rate_and_satisfaction(db_session, org):
    db_session.add_all([
        _metric(org.organization_id, empty_tool_results=0, satisfaction="positive"),
        _metric(org.organization_id, empty_tool_results=0, satisfaction="positive"),
        _metric(org.organization_id, empty_tool_results=0, satisfaction="negative"),
        _metric(org.organization_id, empty_tool_results=1),  # unanswered
    ])
    db_session.commit()

    s = org_visitor_insights(db_session, org.organization_id, days=1)["summary"]
    assert s["total_questions"] == 4
    assert s["answered_rate"] == 0.75  # 3 of 4 had empty_tool_results == 0
    assert s["satisfaction"] == {"positive": 2, "negative": 1}


def test_qr_scan_share(db_session, org):
    visitor = _visitor(org.organization_id)
    db_session.add(visitor)
    db_session.commit()
    db_session.add_all([
        Visit(organization_id=org.organization_id, visitor_id=visitor.visitor_id, source="qr_scan"),
        Visit(organization_id=org.organization_id, visitor_id=visitor.visitor_id, source="qr_scan"),
        Visit(organization_id=org.organization_id, visitor_id=visitor.visitor_id, source="website"),
        Visit(organization_id=org.organization_id, visitor_id=visitor.visitor_id, source=None),
    ])
    db_session.commit()

    s = org_visitor_insights(db_session, org.organization_id, days=1)["summary"]
    assert s["visits"] == 4
    assert s["qr_scan_share"] == 0.5  # 2 of 4
    assert s["visitors"] == 1


def test_unanswered_groups_and_ranks(db_session, org):
    db_session.add_all([
        _metric(org.organization_id, user_question="is there a cafe?", empty_tool_results=1),
        _metric(org.organization_id, user_question="is there a cafe?", empty_tool_results=2),
        _metric(org.organization_id, user_question="wifi password?", empty_tool_results=1),
        _metric(org.organization_id, user_question="who made this?", empty_tool_results=0),  # answered
    ])
    db_session.commit()

    unanswered = org_visitor_insights(db_session, org.organization_id, days=1)["unanswered"]
    assert [u["question"] for u in unanswered] == ["is there a cafe?", "wifi password?"]
    assert unanswered[0]["count"] == 2  # the repeated miss ranks first


def test_languages_grouped_by_locale(db_session, org):
    db_session.add_all([
        _visitor(org.organization_id, locale="en"),
        _visitor(org.organization_id, locale="en"),
        _visitor(org.organization_id, locale="fr"),
    ])
    db_session.commit()

    langs = org_visitor_insights(db_session, org.organization_id, days=1)["languages"]
    by_locale = {l["locale"]: l["visitors"] for l in langs}
    assert by_locale == {"en": 2, "fr": 1}


def test_top_objects_joins_questions_views_and_title(db_session, org):
    obj = CollectionObject(organization_id=org.organization_id, object_number="2024.1")
    db_session.add(obj)
    db_session.commit()
    db_session.add(ObjectTitle(
        organization_id=org.organization_id,
        object_id=obj.object_id,
        title="Starry Field",
        is_preferred=True,
    ))
    # An object with no preferred title falls back to object_number.
    obj2 = CollectionObject(organization_id=org.organization_id, object_number="2024.2")
    db_session.add(obj2)
    db_session.commit()

    visitor = _visitor(org.organization_id)
    db_session.add(visitor)
    db_session.commit()
    visit = Visit(organization_id=org.organization_id, visitor_id=visitor.visitor_id, source="qr_scan")
    db_session.add(visit)
    db_session.commit()

    db_session.add_all([
        # 2 questions + 1 view for the titled object
        _metric(org.organization_id, page_entity_type="collection_object", page_entity_id=str(obj.object_id)),
        _metric(org.organization_id, page_entity_type="collection_object", page_entity_id=str(obj.object_id)),
        VisitInteraction(
            organization_id=org.organization_id,
            visit_id=visit.visit_id,
            interaction_type="object_view",
            entity_type="collection_object",
            entity_id=obj.object_id,
        ),
        # 1 question, no views for the untitled object
        _metric(org.organization_id, page_entity_type="collection_object", page_entity_id=str(obj2.object_id)),
        # a view-only interaction that isn't object_view must be ignored
        VisitInteraction(
            organization_id=org.organization_id,
            visit_id=visit.visit_id,
            interaction_type="qr_scan",
            entity_type="collection_object",
            entity_id=obj2.object_id,
        ),
    ])
    db_session.commit()

    top = org_visitor_insights(db_session, org.organization_id, days=1)["top_objects"]
    assert len(top) == 2
    # Ranked by questions desc: the titled object leads with 2 questions.
    assert top[0]["entity_id"] == str(obj.object_id)
    assert top[0]["title"] == "Starry Field"
    assert top[0]["questions"] == 2
    assert top[0]["views"] == 1
    assert top[1]["entity_id"] == str(obj2.object_id)
    assert top[1]["title"] == "2024.2"  # object_number fallback
    assert top[1]["questions"] == 1
    assert top[1]["views"] == 0


def test_daily_questions_bucketed(db_session, org):
    db_session.add_all([
        _metric(org.organization_id, user_question="a"),
        _metric(org.organization_id, user_question="b"),
    ])
    db_session.commit()

    daily = org_visitor_insights(db_session, org.organization_id, days=1)["daily"]
    assert sum(d["questions"] for d in daily) == 2


# ---------------------------------------------------------------------------
# Regression: staff insights must now EXCLUDE visitor traffic
# ---------------------------------------------------------------------------


def test_staff_insights_exclude_visitor_rows(db_session, org):
    db_session.add_all([
        _metric(org.organization_id, persona="staff", user_question="staff q", empty_tool_results=0),
        _metric(org.organization_id, persona="guide", user_question="guide q", empty_tool_results=0),
        _metric(org.organization_id, persona="visitor", user_question="visitor q", empty_tool_results=1),
    ])
    db_session.commit()

    staff = org_guide_insights(db_session, org.organization_id, days=1)
    assert staff["summary"]["total_requests"] == 2  # visitor row excluded
    questions = {q["question"] for q in staff["top_questions"]}
    assert "visitor q" not in questions
    assert questions == {"staff q", "guide q"}

    # Explicitly asking for the visitor persona still works.
    only_visitor = org_guide_insights(
        db_session, org.organization_id, days=1, personas=("visitor",)
    )
    assert only_visitor["summary"]["total_requests"] == 1


def test_staff_insights_include_specialist_personas(db_session, org):
    """Staff conversations routed to specialists record the specialist
    persona in guide_metrics — those are staff-side usage and must count."""
    db_session.add_all([
        _metric(org.organization_id, persona="staff", user_question="staff q"),
        _metric(org.organization_id, persona="registrar", user_question="specialist q"),
        _metric(org.organization_id, persona="visitor", user_question="visitor q"),
    ])
    db_session.commit()

    staff = org_guide_insights(db_session, org.organization_id, days=1)
    assert staff["summary"]["total_requests"] == 2  # staff + specialist, not visitor
