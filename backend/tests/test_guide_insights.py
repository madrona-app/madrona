"""Unit tests for the org-scoped Guide insights aggregation.

Verifies tenant scoping, the corpus-gap filter (empty_tool_results > 0),
question grouping, and the answered-rate summary — over the real query path
against the test DB (db_session rolls back).
"""

from datetime import datetime, timezone
from uuid import uuid4

import pytest

from app.models import Organization
from app.services.agent_monitoring import GuideMetric
from app.services.guide_insights import org_guide_insights


@pytest.fixture
def org(db_session):
    o = Organization(name="Insights Museum", slug=f"ins-{uuid4().hex[:8]}")
    db_session.add(o)
    db_session.commit()
    return o


def _metric(org_id, **kw):
    base = dict(
        organization_id=org_id,
        persona="staff",
        request_started_at=datetime.now(timezone.utc),
        response_latency_ms=100,
        model_provider="claude",
    )
    base.update(kw)
    return GuideMetric(**base)


def test_empty_org_returns_zeroed_summary(db_session, org):
    res = org_guide_insights(db_session, org.organization_id, days=30)
    assert res["summary"]["total_requests"] == 0
    assert res["summary"]["answered_rate"] is None  # no divide-by-zero
    assert res["corpus_gaps"] == []


def test_corpus_gaps_group_and_rank(db_session, org):
    db_session.add_all([
        _metric(org.organization_id, user_question="log a loan return?", empty_tool_results=1, page_route="/loans"),
        _metric(org.organization_id, user_question="log a loan return?", empty_tool_results=2, page_route="/loans"),
        _metric(org.organization_id, user_question="deaccession policy?", empty_tool_results=1),
        _metric(org.organization_id, user_question="hello", empty_tool_results=0),  # answered — not a gap
    ])
    db_session.commit()

    res = org_guide_insights(db_session, org.organization_id, days=1)
    assert res["summary"]["total_requests"] == 4
    assert res["summary"]["gap_count"] == 3
    assert res["summary"]["answered_rate"] == 0.25

    gaps = res["corpus_gaps"]
    assert [g["question"] for g in gaps] == ["log a loan return?", "deaccession policy?"]
    assert gaps[0]["count"] == 2  # the repeated gap ranks first
    assert gaps[0]["sample_route"] == "/loans"


def test_scoped_to_caller_org(db_session, org):
    """Another org's metrics must never leak into this org's insights."""
    other = Organization(name="Other Museum", slug=f"oth-{uuid4().hex[:8]}")
    db_session.add(other)
    db_session.commit()
    db_session.add_all([
        _metric(org.organization_id, user_question="mine", empty_tool_results=1),
        _metric(other.organization_id, user_question="theirs", empty_tool_results=1),
    ])
    db_session.commit()

    res = org_guide_insights(db_session, org.organization_id, days=1)
    assert res["summary"]["total_requests"] == 1
    assert [g["question"] for g in res["corpus_gaps"]] == ["mine"]


# ---------------------------------------------------------------------------
# Admin gate — corpus/insights management is org-admin-only (org.manage_settings)
# ---------------------------------------------------------------------------


def _enable_guide(db_session, org_id):
    """Enable the Guide app for an org so the gate turns on the permission check
    (not the app-enabled check)."""
    from sqlalchemy import select
    from app.models.core import Application, OrganizationApplication

    app = db_session.execute(
        select(Application).where(Application.key == "guide")
    ).scalar_one_or_none()
    if not app:
        app = Application(key="guide", display_name="Guide")
        db_session.add(app)
        db_session.flush()
    db_session.add(OrganizationApplication(
        organization_id=org_id,
        application_id=app.application_id,
        enabled=True,
        config={},
    ))
    db_session.commit()


class TestGuideInsightsAdminGate:
    def test_admin_can_read_insights(self, auth_setup, db_session):
        client, org, _user = auth_setup
        _enable_guide(db_session, org.organization_id)
        resp = client.get("/api/guide/insights")
        assert resp.status_code == 200, resp.text

    def test_viewer_is_forbidden(self, viewer_auth_setup, db_session):
        """A non-admin Guide user cannot read insights / manage the corpus."""
        client, org, _user = viewer_auth_setup
        _enable_guide(db_session, org.organization_id)
        resp = client.get("/api/guide/insights")
        assert resp.status_code == 403, resp.text
