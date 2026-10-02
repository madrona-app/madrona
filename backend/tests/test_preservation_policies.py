"""
Tests for Phase 2: Preservation Policies & Planning.
"""

import uuid
from datetime import datetime, timedelta, timezone

import pytest

from app.models.media import Media
from app.models.preservation import (
    PreservationActionPlan,
    PreservationPolicy,
)


class TestPreservationPolicyCRUD:
    def test_create_policy(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        policy = PreservationPolicy(
            organization_id=org_id,
            name="10-Year Retention",
            policy_type="retention",
            scope={"target": "all"},
            rules={"retain_years": 10, "action": "review"},
            is_active=True,
        )
        db_session.add(policy)
        db_session.commit()

        fetched = db_session.query(PreservationPolicy).filter_by(
            policy_id=policy.policy_id
        ).first()
        assert fetched is not None
        assert fetched.name == "10-Year Retention"
        assert fetched.policy_type == "retention"
        assert fetched.rules["retain_years"] == 10

    def test_create_format_migration_policy(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id
        policy = PreservationPolicy(
            organization_id=org_id,
            name="Migrate AVI to MP4",
            policy_type="format_migration",
            scope={"target": "pronom_puid", "value": "fmt/5"},
            rules={"source_puid": "fmt/5", "target_puid": "fmt/199", "auto_migrate": False},
        )
        db_session.add(policy)
        db_session.commit()

        assert policy.policy_id is not None
        assert policy.scope["target"] == "pronom_puid"


class TestEvaluatePolicies:
    def test_format_migration_creates_action_plan(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id

        policy = PreservationPolicy(
            organization_id=org_id,
            name="Migrate AVI",
            policy_type="format_migration",
            scope={"target": "pronom_puid", "value": "fmt/5"},
            rules={"source_puid": "fmt/5", "target_puid": "fmt/199"},
            is_active=True,
        )
        db_session.add(policy)

        media = Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/old.avi",
            filename="old.avi",
            file_size=10000,
            mime_type="video/x-msvideo",
            media_type="video",
            processing_status="completed",
            pronom_puid="fmt/5",
        )
        db_session.add(media)
        db_session.commit()

        from app.services.preservation_policy import evaluate_policies

        result = evaluate_policies(org_id, db_session)
        db_session.commit()

        assert result["policies_evaluated"] == 1
        assert result["actions_created"] == 1

        plan = db_session.query(PreservationActionPlan).first()
        assert plan is not None
        assert plan.action_type == "migrate_format"
        assert plan.status == "pending"
        assert plan.detail["source_puid"] == "fmt/5"
        assert plan.detail["target_puid"] == "fmt/199"

    def test_no_duplicate_action_plans(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id

        policy = PreservationPolicy(
            organization_id=org_id,
            name="Migrate AVI",
            policy_type="format_migration",
            scope={"target": "pronom_puid", "value": "fmt/5"},
            rules={"source_puid": "fmt/5", "target_puid": "fmt/199"},
            is_active=True,
        )
        db_session.add(policy)

        media = Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/old.avi",
            filename="old.avi",
            file_size=10000,
            mime_type="video/x-msvideo",
            media_type="video",
            processing_status="completed",
            pronom_puid="fmt/5",
        )
        db_session.add(media)
        db_session.commit()

        from app.services.preservation_policy import evaluate_policies

        evaluate_policies(org_id, db_session)
        db_session.commit()
        evaluate_policies(org_id, db_session)
        db_session.commit()

        plans = db_session.query(PreservationActionPlan).all()
        assert len(plans) == 1


class TestActionPlanStatus:
    def test_approve_pending_plan(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id

        policy = PreservationPolicy(
            organization_id=org_id,
            name="Test",
            policy_type="retention",
            is_active=True,
        )
        db_session.add(policy)
        db_session.flush()

        media = Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/test.jpg",
            filename="test.jpg",
            file_size=1024,
            mime_type="image/jpeg",
            media_type="image",
            processing_status="completed",
        )
        db_session.add(media)
        db_session.flush()

        plan = PreservationActionPlan(
            organization_id=org_id,
            policy_id=policy.policy_id,
            media_id=media.media_id,
            action_type="review_retention",
            status="pending",
        )
        db_session.add(plan)
        db_session.commit()

        plan.status = "approved"
        db_session.commit()

        refreshed = db_session.query(PreservationActionPlan).first()
        assert refreshed.status == "approved"

    def test_cancel_plan(self, db_session, demo_tenant):
        org_id = demo_tenant.organization_id

        policy = PreservationPolicy(
            organization_id=org_id,
            name="Test",
            policy_type="retention",
            is_active=True,
        )
        db_session.add(policy)
        db_session.flush()

        media = Media(
            organization_id=org_id,
            s3_key=f"orgs/{org_id}/test2.jpg",
            filename="test2.jpg",
            file_size=1024,
            mime_type="image/jpeg",
            media_type="image",
            processing_status="completed",
        )
        db_session.add(media)
        db_session.flush()

        plan = PreservationActionPlan(
            organization_id=org_id,
            policy_id=policy.policy_id,
            media_id=media.media_id,
            action_type="review_retention",
            status="pending",
        )
        db_session.add(plan)
        db_session.commit()

        plan.status = "cancelled"
        db_session.commit()

        refreshed = db_session.query(PreservationActionPlan).first()
        assert refreshed.status == "cancelled"
