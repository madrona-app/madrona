"""API tests for the drafts inbox (Guide Studio v1 §1.4)."""

from uuid import uuid4

from app.models import CollectionObject, Organization
from app.services.agent_tools import AgentContext
from app.services.drafts.draft_service import create_draft


def _drafts_url(org):
    return f"/api/organizations/{org.organization_id}/drafts"


def _draft_url(org, draft_id):
    return f"/api/organizations/{org.organization_id}/drafts/{draft_id}"


def _make_draft(db_session, org, user, **payload_over):
    obj = CollectionObject(
        organization_id=org.organization_id, object_number=f"2026.{uuid4().hex[:4]}"
    )
    db_session.add(obj)
    db_session.flush()
    ctx = AgentContext(
        organization_id=org.organization_id,
        user_id=user.user_id,
        persona="conservator",
        db_session=db_session,
    )
    payload = {
        "object_id": str(obj.object_id),
        "report_type": "conservation",
        "report_date": "2026-05-23",
        **payload_over,
    }
    draft = create_draft(
        ctx,
        entity_type="condition_report",
        intended_action="create",
        payload=payload,
        rationale="proposed during exam",
    )
    db_session.commit()
    return draft, obj


class TestDraftsApi:
    def test_list_returns_draft(self, auth_setup, db_session):
        client, org, user = auth_setup
        draft, _ = _make_draft(db_session, org, user)
        resp = client.get(_drafts_url(org))
        assert resp.status_code == 200, resp.text
        ids = [d["draft_id"] for d in resp.get_json()["drafts"]]
        assert str(draft.draft_id) in ids

    def test_get_draft(self, auth_setup, db_session):
        client, org, user = auth_setup
        draft, _ = _make_draft(db_session, org, user)
        body = client.get(_draft_url(org, draft.draft_id)).get_json()
        assert body["entity_type"] == "condition_report"
        assert body["status"] == "pending"
        assert body["model_id"]  # provenance surfaced

    def test_form_schema_endpoint(self, auth_setup, db_session):
        # Drives the editable draft form instead of raw JSON.
        client, org, _ = auth_setup
        base = f"/api/organizations/{org.organization_id}/drafts/form-schema"
        body = client.get(f"{base}?entity_type=acquisition").get_json()
        assert body["entity_label"] == "Acquisition"
        f = {x["name"]: x for x in body["fields"]}
        assert f["acquisition_method"]["type"] == "enum"
        assert "purchase" in f["acquisition_method"]["enum_values"]
        # Unknown entity → 404.
        resp = client.get(f"{base}?entity_type=nonsense")
        assert resp.status_code == 404

    def test_resolve_refs_returns_labels(self, auth_setup, db_session):
        # Reference ids resolve to names, so the draft form shows entities not UUIDs.
        from app.models import Constituent
        client, org, _ = auth_setup
        c = Constituent(
            organization_id=org.organization_id,
            constituent_type="organization", name="Grand Hall Museum",
        )
        db_session.add(c)
        db_session.commit()
        url = f"/api/organizations/{org.organization_id}/drafts/resolve-refs"
        body = client.post(url, json={"refs": [
            {"kind": "constituent", "id": str(c.constituent_id)},
        ]}).get_json()
        assert body["labels"][str(c.constituent_id)] == "Grand Hall Museum"

    def test_draft_carries_procedure_preapproval(self, auth_setup, db_session):
        # The pre-approval ribbon's backing data: the procedure the
        # draft follows + its proposal-stage validation (§7 trust).
        client, org, user = auth_setup
        draft, _ = _make_draft(db_session, org, user)
        body = client.get(_draft_url(org, draft.draft_id)).get_json()
        assert "plan_step_id" in body  # exposed for plan provenance
        procedure = body["procedure"]
        assert procedure is not None
        assert procedure["procedure_type"] == "condition_report"
        assert "passed" in procedure and "blocking_total" in procedure
        assert isinstance(procedure["missing"], list)

    def test_patch_edits_payload(self, auth_setup, db_session):
        client, org, user = auth_setup
        draft, obj = _make_draft(db_session, org, user)
        new_payload = {
            "object_id": str(obj.object_id),
            "report_type": "periodic",
            "report_date": "2026-05-23",
            "overall_condition": "good",
        }
        resp = client.patch(_draft_url(org, draft.draft_id), json={"payload": new_payload})
        assert resp.status_code == 200, resp.text
        assert resp.get_json()["payload"]["report_type"] == "periodic"

    def test_patch_invalid_payload_422(self, auth_setup, db_session):
        client, org, user = auth_setup
        draft, obj = _make_draft(db_session, org, user)
        resp = client.patch(
            _draft_url(org, draft.draft_id),
            json={"payload": {"object_id": str(obj.object_id), "report_type": "bogus", "report_date": "2026-05-23"}},
        )
        assert resp.status_code == 422

    def test_approve_applies_to_live(self, auth_setup, db_session):
        client, org, user = auth_setup
        draft, _ = _make_draft(db_session, org, user)
        resp = client.post(_draft_url(org, draft.draft_id) + "/approve")
        assert resp.status_code == 200, resp.text
        body = resp.get_json()
        assert body["status"] == "approved"
        assert body["applied_entity_id"] is not None

    def test_reject(self, auth_setup, db_session):
        client, org, user = auth_setup
        draft, _ = _make_draft(db_session, org, user)
        resp = client.post(_draft_url(org, draft.draft_id) + "/reject", json={"note": "not needed"})
        assert resp.status_code == 200, resp.text
        assert resp.get_json()["status"] == "rejected"

    def test_approve_rule_bound_is_409(self, auth_setup, db_session):
        from app.models.core_org import ApprovalRule

        client, org, user = auth_setup
        db_session.add(ApprovalRule(
            organization_id=org.organization_id,
            entity_type="condition_report",
            trigger_action="create",
            approver_permission="conservation.approve",
        ))
        db_session.flush()
        draft, _ = _make_draft(db_session, org, user)
        assert draft.approval_request_id is not None
        resp = client.post(_draft_url(org, draft.draft_id) + "/approve")
        assert resp.status_code == 409
        assert "needs_approval_review" in resp.text

    def test_get_cross_org_is_404(self, auth_setup, db_session):
        client, org, user = auth_setup
        other = Organization(name="Other", slug=f"other-{uuid4().hex[:8]}")
        db_session.add(other)
        db_session.flush()
        draft, _ = _make_draft(db_session, other, user)
        resp = client.get(_draft_url(org, draft.draft_id))
        assert resp.status_code == 404

    def test_count_pending(self, auth_setup, db_session):
        from app.services.drafts.draft_service import reject_draft

        client, org, user = auth_setup
        _make_draft(db_session, org, user)
        _make_draft(db_session, org, user)
        d3, _ = _make_draft(db_session, org, user)
        reject_draft(db_session, d3.draft_id, user.user_id)
        db_session.commit()

        resp = client.get(_drafts_url(org) + "/count")
        assert resp.status_code == 200, resp.text
        assert resp.get_json()["count"] == 2
