"""
Integration tests for the Dashboard Attention API.

Routes under /api/organizations/<org_id>/dashboard/attention.
"""

from datetime import date, timedelta
from uuid import uuid4


def _create_loan_out(db_session, org_id, **overrides):
    from app.models.procedures import LoanOut

    defaults = dict(
        organization_id=org_id,
        loan_number=f"LN-{uuid4().hex[:6]}",
        borrower_name="Test Borrower",
        loan_purpose="exhibition",
    )
    defaults.update(overrides)
    loan = LoanOut(**defaults)
    db_session.add(loan)
    db_session.flush()
    return loan


def _create_loan_monitoring(db_session, org_id, loan_id, **overrides):
    from app.models.procedures import LoanMonitoringEvent

    defaults = dict(
        organization_id=org_id,
        loan_id=loan_id,
        loan_type="loan_out",
        event_type="condition_check",
        due_date=date.today() - timedelta(days=2),
        status="pending",
    )
    defaults.update(overrides)
    ev = LoanMonitoringEvent(**defaults)
    db_session.add(ev)
    db_session.flush()
    return ev


def _create_compliance_action(db_session, org_id, **overrides):
    from app.models.compliance import ComplianceAction

    defaults = dict(
        organization_id=org_id,
        entity_type="audit_result",
        entity_id=uuid4(),
        action_type="follow_up",
        title="Resolve damaged label",
        due_date=date.today() - timedelta(days=5),
        status="open",
    )
    defaults.update(overrides)
    action = ComplianceAction(**defaults)
    db_session.add(action)
    db_session.flush()
    return action


class TestDashboardAttention:
    def test_returns_zero_counts_when_empty(self, auth_setup):
        auth_client, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/dashboard/attention"
        resp = auth_client.get(url)
        assert resp.status_code == 200
        data = resp.get_json()
        assert data["loans"] == {"total": 0, "samples": []}
        assert data["rights"] == {"total": 0, "samples": []}
        assert data["audits"] == {"total": 0, "samples": []}

    def test_includes_overdue_loan_monitoring(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        loan = _create_loan_out(db_session, org.organization_id)
        _create_loan_monitoring(
            db_session,
            org.organization_id,
            loan.loan_out_id,
            event_type="dispatch",
        )
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/dashboard/attention"
        data = auth_client.get(url).get_json()

        assert data["loans"]["total"] == 1
        sample = data["loans"]["samples"][0]
        assert loan.loan_number in sample["label"]
        assert sample["due_date"] is not None
        assert sample["href"] == f"/collections/loans-out/{loan.loan_out_id}"

    def test_excludes_completed_monitoring_events(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        loan = _create_loan_out(db_session, org.organization_id)
        _create_loan_monitoring(
            db_session,
            org.organization_id,
            loan.loan_out_id,
            status="completed",
        )
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/dashboard/attention"
        data = auth_client.get(url).get_json()
        assert data["loans"]["total"] == 0

    def test_excludes_future_due_monitoring_events(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        loan = _create_loan_out(db_session, org.organization_id)
        _create_loan_monitoring(
            db_session,
            org.organization_id,
            loan.loan_out_id,
            due_date=date.today() + timedelta(days=10),
        )
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/dashboard/attention"
        data = auth_client.get(url).get_json()
        assert data["loans"]["total"] == 0

    def test_includes_overdue_compliance_actions(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _create_compliance_action(db_session, org.organization_id)
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/dashboard/attention"
        data = auth_client.get(url).get_json()

        assert data["audits"]["total"] == 1
        sample = data["audits"]["samples"][0]
        assert sample["label"] == "Resolve damaged label"

    def test_excludes_completed_compliance_actions(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        _create_compliance_action(
            db_session, org.organization_id, status="completed"
        )
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/dashboard/attention"
        data = auth_client.get(url).get_json()
        assert data["audits"]["total"] == 0

    def test_caps_samples_per_category(self, auth_setup, db_session):
        auth_client, org, _ = auth_setup
        loan = _create_loan_out(db_session, org.organization_id)
        for i in range(8):
            _create_loan_monitoring(
                db_session,
                org.organization_id,
                loan.loan_out_id,
                event_type=f"check_{i}",
                due_date=date.today() - timedelta(days=i + 1),
            )
        db_session.commit()

        url = f"/api/organizations/{org.organization_id}/dashboard/attention"
        data = auth_client.get(url).get_json()
        assert data["loans"]["total"] == 8
        assert len(data["loans"]["samples"]) == 5

    def test_requires_authentication(self, client, auth_setup):
        _, org, _ = auth_setup
        url = f"/api/organizations/{org.organization_id}/dashboard/attention"
        resp = client.get(url)
        assert resp.status_code == 401
