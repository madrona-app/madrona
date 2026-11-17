"""Record flags, completeness rules, publication gate and the intern review workflow.

These follow NFB's description of what they need: administrator-defined flags
(on view, access restricted, heavy); records that meet the organization's
completeness rules are flagged automatically; publication restricted by role;
and when an intern sets a record to review, the assigned reviewer is notified
and the review is documented.
"""
import json
import uuid
from unittest.mock import patch

import pytest

from app.models import Notification
from app.models.core_org import ApprovalRequest
from tests.conftest import AuthenticatedClient, _create_permission, _create_role_permission

_INDEX = "app.fastapi_app.routers.collections_objects._index_collection_object"
_DISCOVER_INDEX = "app.fastapi_app.routers.collections_discover._index_collection_object"


def _j(resp):
    return resp.get_json()


def _post(c, url, body):
    return c.post(url, data=json.dumps(body), content_type="application/json")


def _put(c, url, body):
    return c.put(url, data=json.dumps(body), content_type="application/json")


def _member(client, db_session, org_id, perms, email):
    """A non-admin member of ``org_id`` holding exactly ``perms``."""
    from app.models import OrganizationMembership, Role, User
    from app.services.auth_utils import generate_access_token

    role = Role(role_key=f"t_{uuid.uuid4().hex[:10]}", display_name=email, description="test", is_system=False)
    db_session.add(role)
    db_session.flush()
    for key in perms:
        _create_role_permission(db_session, role, _create_permission(db_session, key))
    user = User(email=email, password_hash="x", status="active", display_name=email.split("@")[0].title())
    db_session.add(user)
    db_session.flush()
    db_session.add(OrganizationMembership(organization_id=org_id, user_id=user.user_id, role="member",
                                          role_id=role.role_id, status="active"))
    uid = user.user_id
    db_session.commit()
    token = generate_access_token(user_id=str(uid), email=email, active_organization_id=str(org_id), expires_minutes=60)
    return AuthenticatedClient(client, token), uid


@pytest.fixture
def team(client, db_session, auth_setup):
    admin, org, admin_user = auth_setup
    edit = ["collections.view", "collections.create", "collections.edit", "notifications.view"]
    intern, intern_id = _member(client, db_session, org.organization_id, edit, "intern@example.com")
    reviewer, reviewer_id = _member(client, db_session, org.organization_id, edit, "archivist@example.com")
    return {"admin": admin, "org": org, "intern": intern, "intern_id": intern_id,
            "reviewer": reviewer, "reviewer_id": reviewer_id}


def _base(org):
    return f"/api/organizations/{org.organization_id}/collections"


def _make_object(c, org, number, **fields):
    with patch(_INDEX):
        resp = _post(c, f"{_base(org)}/objects", {"object_number": number, "object_name": "Banner", **fields})
    assert resp.status_code == 201, _j(resp)
    return _j(resp)["object_id"]


# ─── Flags ──────────────────────────────────────────────────────────────────

class TestFlags:
    def test_admin_defines_flags_and_staff_set_them(self, team):
        admin, org, intern = team["admin"], team["org"], team["intern"]
        ids = {}
        for label in ("On view", "Access restricted", "Heavy"):
            resp = _post(admin, f"{_base(org)}/settings/record-flags", {"label": label, "description": f"{label} records"})
            assert resp.status_code == 201, _j(resp)
            ids[label] = _j(resp)["flag_id"]
        assert [f["key"] for f in _j(admin.get(f"{_base(org)}/settings/record-flags"))["items"]] == [
            "on_view", "access_restricted", "heavy"]

        oid = _make_object(intern, org, "FLAG.1")
        resp = _put(intern, f"{_base(org)}/objects/{oid}/flags", {"flag_ids": [ids["Heavy"], ids["On view"]]})
        assert resp.status_code == 200, _j(resp)
        assert {f["label"] for f in _j(resp)["items"]} == {"Heavy", "On view"}

        resp = _put(intern, f"{_base(org)}/objects/{oid}/flags", {"flag_ids": [ids["Heavy"]]})
        assert [f["label"] for f in _j(resp)["items"]] == ["Heavy"]

    def test_non_admin_cannot_define_flags(self, team):
        resp = _post(team["intern"], f"{_base(team['org'])}/settings/record-flags", {"label": "Mine"})
        assert resp.status_code == 403

    def test_duplicate_flag_rejected(self, team):
        admin, org = team["admin"], team["org"]
        assert _post(admin, f"{_base(org)}/settings/record-flags", {"label": "Heavy"}).status_code == 201
        assert _post(admin, f"{_base(org)}/settings/record-flags", {"label": "heavy"}).status_code == 409

    def test_unknown_flag_rejected(self, team):
        org = team["org"]
        oid = _make_object(team["intern"], org, "FLAG.2")
        resp = _put(team["intern"], f"{_base(org)}/objects/{oid}/flags", {"flag_ids": [str(uuid.uuid4())]})
        assert resp.status_code == 422


# ─── Completeness rules ─────────────────────────────────────────────────────

class TestCompleteness:
    def _rule(self, admin, org, **extra):
        body = {
            "name": "Ready to publish",
            "requirements": [
                {"field": "title", "check": "present"},
                {"field": "brief_description", "check": "present"},
                {"field": "object_type", "check": "one_of", "value": ["Banner", "Book"]},
            ],
            **extra,
        }
        resp = _post(admin, f"{_base(org)}/settings/completeness-rules", body)
        assert resp.status_code == 201, _j(resp)
        return _j(resp)

    def test_records_meeting_rule_are_flagged_automatically(self, team, db_session):
        admin, org, intern = team["admin"], team["org"], team["intern"]
        rule = self._rule(admin, org)
        assert rule["flag_label"] == "Ready to publish"

        oid = _make_object(intern, org, "CMP.1", titles=[{"title": "NFB convention banner", "is_preferred": True}],
                           object_type="Banner")
        flags = _j(intern.get(f"{_base(org)}/objects/{oid}/flags"))["items"]
        assert flags == []
        result = _j(intern.get(f"{_base(org)}/objects/{oid}/completeness"))["items"][0]
        assert result["met"] is False
        assert result["missing"] == ["Brief description is missing"]

        with patch(_INDEX):
            assert _put(intern, f"{_base(org)}/objects/{oid}", {"brief_description": "Silk, 1950s"}).status_code == 200
        flags = _j(intern.get(f"{_base(org)}/objects/{oid}/flags"))["items"]
        assert [(f["label"], f["source"]) for f in flags] == [("Ready to publish", "rule")]

        # Falls out of compliance -> flag removed.
        with patch(_INDEX):
            assert _put(intern, f"{_base(org)}/objects/{oid}", {"object_type": "Painting"}).status_code == 200
        assert _j(intern.get(f"{_base(org)}/objects/{oid}/flags"))["items"] == []

    def test_rule_flag_cannot_be_set_by_hand(self, team):
        admin, org, intern = team["admin"], team["org"], team["intern"]
        rule = self._rule(admin, org)
        oid = _make_object(intern, org, "CMP.2")
        resp = _put(intern, f"{_base(org)}/objects/{oid}/flags", {"flag_ids": [rule["flag_id"]]})
        assert resp.status_code == 422
        assert "automatically" in json.dumps(_j(resp))

    def test_recompute_applies_new_rule_to_existing_records(self, team):
        admin, org, intern = team["admin"], team["org"], team["intern"]
        oid = _make_object(intern, org, "CMP.3", brief_description="d",
                           titles=[{"title": "t", "is_preferred": True}], object_type="Book")
        self._rule(admin, org)
        assert _j(intern.get(f"{_base(org)}/objects/{oid}/flags"))["items"] == []
        resp = admin.post(f"{_base(org)}/settings/completeness-rules/recompute")
        assert resp.status_code == 200 and _j(resp)["records_checked"] >= 1
        assert [f["label"] for f in _j(intern.get(f"{_base(org)}/objects/{oid}/flags"))["items"]] == ["Ready to publish"]

    def test_invalid_requirement_rejected(self, team):
        resp = _post(team["admin"], f"{_base(team['org'])}/settings/completeness-rules",
                     {"name": "Bad", "requirements": [{"field": "no_such_field", "check": "present"}]})
        assert resp.status_code == 422

    def test_rule_management_requires_settings_permission(self, team):
        resp = _post(team["intern"], f"{_base(team['org'])}/settings/completeness-rules",
                     {"name": "X", "requirements": [{"field": "title", "check": "present"}]})
        assert resp.status_code == 403

    def test_required_rule_blocks_publication(self, team):
        admin, org = team["admin"], team["org"]
        self._rule(admin, org, required_for_publication=True)
        oid = _make_object(admin, org, "CMP.4")
        with patch(_DISCOVER_INDEX):
            resp = admin.patch(f"{_base(org)}/objects/{oid}/discoverable", data=json.dumps({"is_discoverable": True}),
                               content_type="application/json")
        assert resp.status_code == 409
        assert "Brief description is missing" in json.dumps(_j(resp))

        with patch(_DISCOVER_INDEX):
            resp = _post(admin, f"{_base(org)}/objects/bulk-discoverable", {"object_ids": [oid], "is_discoverable": True})
        assert resp.status_code == 200
        assert _j(resp)["updated"] == 0
        assert _j(resp)["skipped"] == [{"object_id": oid, "reason": "incomplete_for_publication"}]

        with patch(_INDEX):
            _put(admin, f"{_base(org)}/objects/{oid}", {"brief_description": "d", "object_type": "Book",
                                                         "titles": [{"title": "t", "is_preferred": True}]})
        with patch(_DISCOVER_INDEX):
            resp = admin.patch(f"{_base(org)}/objects/{oid}/discoverable", data=json.dumps({"is_discoverable": True}),
                               content_type="application/json")
        assert resp.status_code == 200, _j(resp)


class TestPublishRestrictedByRole:
    def test_editor_without_publish_permission_cannot_publish(self, team):
        org, intern = team["org"], team["intern"]
        oid = _make_object(intern, org, "PUBR.1")
        with patch(_DISCOVER_INDEX):
            resp = intern.patch(f"{_base(org)}/objects/{oid}/discoverable",
                                data=json.dumps({"is_discoverable": True}), content_type="application/json")
        assert resp.status_code == 403
        with patch(_INDEX):
            resp = _put(intern, f"{_base(org)}/objects/{oid}", {"is_discoverable": True})
        assert resp.status_code == 403


# ─── Review workflow ────────────────────────────────────────────────────────

class TestReview:
    def test_intern_submits_reviewer_notified_and_decision_documented(self, team, db_session):
        org, intern, reviewer = team["org"], team["intern"], team["reviewer"]
        oid = _make_object(intern, org, "REV.1", titles=[{"title": "Braille slate", "is_preferred": True}])

        reviewers = _j(intern.get(f"{_base(org)}/reviewers"))["items"]
        assert str(team["reviewer_id"]) in [r["user_id"] for r in reviewers]
        assert str(team["intern_id"]) not in [r["user_id"] for r in reviewers]

        resp = _post(intern, f"{_base(org)}/objects/{oid}/reviews",
                     {"reviewer_id": str(team["reviewer_id"]), "note": "First cataloguing pass"})
        assert resp.status_code == 201, _j(resp)
        review = _j(resp)
        assert review["status"] == "pending" and review["reviewer_name"] == "Archivist"

        detail = _j(intern.get(f"{_base(org)}/objects/{oid}"))
        assert detail["cataloging_status"] == "pending_review"

        notes = db_session.query(Notification).filter(Notification.user_id == team["reviewer_id"]).all()
        assert len(notes) == 1
        assert notes[0].notification_type == "approval_assigned"
        assert "REV.1: Braille slate" in notes[0].title
        assert notes[0].message == "First cataloguing pass"
        assert notes[0].entity_id == uuid.UUID(oid)

        # It is an approval request directed to the reviewer: it is in their
        # existing Approvals queue ("awaiting you").
        queue = _j(reviewer.get(f"/api/organizations/{org.organization_id}/approvals?mine=true"))
        items = queue.get("items") or queue.get("approvals") or queue.get("requests") or []
        assert [i["entity_id"] for i in items] == [oid]
        req = db_session.query(ApprovalRequest).filter(ApprovalRequest.entity_id == uuid.UUID(oid)).one()
        assert req.assigned_to_user_id == team["reviewer_id"] and req.status == "pending"

        # The intern cannot approve their own submission.
        resp = _post(intern, f"{_base(org)}/record-reviews/{review['review_id']}/decision", {"decision": "approved"})
        assert resp.status_code == 403

        resp = _post(reviewer, f"{_base(org)}/record-reviews/{review['review_id']}/decision",
                     {"decision": "changes_requested", "note": "Add the maker"})
        assert resp.status_code == 200, _j(resp)
        assert _j(intern.get(f"{_base(org)}/objects/{oid}"))["cataloging_status"] == "in_progress"
        back = db_session.query(Notification).filter(Notification.user_id == team["intern_id"]).all()
        assert [n.notification_type for n in back] == ["review_changes_requested"]
        assert back[0].message == "Add the maker"

        # Resubmit and approve; both reviews are kept as documentation.
        review2 = _j(_post(intern, f"{_base(org)}/objects/{oid}/reviews", {"reviewer_id": str(team["reviewer_id"])}))
        resp = _post(reviewer, f"{_base(org)}/record-reviews/{review2['review_id']}/decision", {"decision": "approved", "note": "Good"})
        assert resp.status_code == 200
        history = _j(intern.get(f"{_base(org)}/objects/{oid}/reviews"))
        assert history["cataloging_status"] == "cataloged"
        assert [h["status"] for h in history["items"]] == ["approved", "changes_requested"]
        assert history["items"][1]["decision_note"] == "Add the maker"
        assert history["items"][0]["decided_by_name"] == "Archivist"

    def test_review_status_cannot_be_set_by_editing_the_field(self, team):
        org, intern = team["org"], team["intern"]
        oid = _make_object(intern, org, "REV.2")
        with patch(_INDEX):
            resp = _put(intern, f"{_base(org)}/objects/{oid}", {"cataloging_status": "pending_review"})
        assert resp.status_code == 422
        with patch(_INDEX):
            assert _put(intern, f"{_base(org)}/objects/{oid}", {"cataloging_status": "in_progress"}).status_code == 200

        _post(intern, f"{_base(org)}/objects/{oid}/reviews", {"reviewer_id": str(team["reviewer_id"])})
        with patch(_INDEX):
            resp = _put(intern, f"{_base(org)}/objects/{oid}", {"cataloging_status": "cataloged"})
        assert resp.status_code == 422

    def test_changes_requested_needs_a_note_and_double_submit_conflicts(self, team):
        org, intern, reviewer = team["org"], team["intern"], team["reviewer"]
        oid = _make_object(intern, org, "REV.3")
        review = _j(_post(intern, f"{_base(org)}/objects/{oid}/reviews", {"reviewer_id": str(team["reviewer_id"])}))
        assert _post(intern, f"{_base(org)}/objects/{oid}/reviews",
                     {"reviewer_id": str(team["reviewer_id"])}).status_code == 409
        assert _post(reviewer, f"{_base(org)}/record-reviews/{review['review_id']}/decision",
                     {"decision": "changes_requested"}).status_code == 422

    def test_cannot_assign_self_or_cancel_others(self, team):
        org, intern = team["org"], team["intern"]
        oid = _make_object(intern, org, "REV.4")
        assert _post(intern, f"{_base(org)}/objects/{oid}/reviews",
                     {"reviewer_id": str(team["intern_id"])}).status_code == 422
        review = _j(_post(intern, f"{_base(org)}/objects/{oid}/reviews", {"reviewer_id": str(team["reviewer_id"])}))
        resp = intern.post(f"{_base(org)}/record-reviews/{review['review_id']}/cancel")
        assert resp.status_code == 200
        assert _j(intern.get(f"{_base(org)}/objects/{oid}"))["cataloging_status"] == "in_progress"


class TestReviewViaApprovalsPage:
    def test_deciding_on_the_approvals_page_updates_the_record(self, team, db_session):
        org, intern, reviewer = team["org"], team["intern"], team["reviewer"]
        oid = _make_object(intern, org, "REV.5")
        review = _j(_post(intern, f"{_base(org)}/objects/{oid}/reviews", {"reviewer_id": str(team["reviewer_id"])}))
        resp = _post(reviewer, f"/api/organizations/{org.organization_id}/approvals/{review['review_id']}/review",
                     {"decision": "approved", "note": "Looks right"})
        assert resp.status_code == 200, _j(resp)
        assert _j(intern.get(f"{_base(org)}/objects/{oid}"))["cataloging_status"] == "cataloged"
        assert [n.notification_type for n in db_session.query(Notification).filter(
            Notification.user_id == team["intern_id"])] == ["review_approved"]

    def test_submitter_cannot_approve_own_record_on_approvals_page(self, team):
        org, intern = team["org"], team["intern"]
        oid = _make_object(intern, org, "REV.6")
        review = _j(_post(intern, f"{_base(org)}/objects/{oid}/reviews", {"reviewer_id": str(team["reviewer_id"])}))
        resp = _post(intern, f"/api/organizations/{org.organization_id}/approvals/{review['review_id']}/review",
                     {"decision": "approved"})
        assert resp.status_code in (400, 403)
        assert _j(intern.get(f"{_base(org)}/objects/{oid}"))["cataloging_status"] == "pending_review"
