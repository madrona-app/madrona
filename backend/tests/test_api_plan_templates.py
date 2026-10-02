"""API tests for the deterministic 'Start procedure' entry point:
GET .../agent/plan-templates  and  POST .../agent/plans (create from template).

This is the forced (non-conversational) path: a template is instantiated directly,
enforcing required params instead of falling back to the planner LLM.
"""

import pytest


@pytest.fixture(autouse=True)
def _agent_enabled(monkeypatch):
    from app.config import get_settings
    monkeypatch.setattr(get_settings(), "agent_enabled", True)


def _templates_url(org, nav=None):
    base = f"/api/organizations/{org.organization_id}/agent/plan-templates"
    return f"{base}?nav_item={nav}" if nav else base


def _plans_url(org):
    return f"/api/organizations/{org.organization_id}/agent/plans"


class TestListTemplates:
    def test_lists_all_templates(self, auth_setup):
        client, org, _ = auth_setup
        body = client.get(_templates_url(org)).get_json()
        ids = {t["template_id"] for t in body["templates"]}
        assert {"acquisition_accession", "loan_in_reception", "media_publish_clearance"} <= ids

    def test_filters_by_nav_item(self, auth_setup):
        client, org, _ = auth_setup
        body = client.get(_templates_url(org, "acquisitions")).get_json()
        assert [t["template_id"] for t in body["templates"]] == ["acquisition_accession"]

    def test_requires_context_returns_only_object_scoped(self, auth_setup):
        """The object-detail surface: only templates taking object_id as page
        context (so each runs with the id in hand), and nothing else."""
        client, org, _ = auth_setup
        base = f"/api/organizations/{org.organization_id}/agent/plan-templates"
        body = client.get(f"{base}?requires_context=object_id").get_json()
        ids = {t["template_id"] for t in body["templates"]}
        # Object-scoped journeys are present...
        assert {"loan_in_reception", "loan_out_dispatch", "deaccession_disposal",
                "conservation_treatment"} <= ids
        # ...and templates that DON'T take object context are excluded.
        assert "acquisition_accession" not in ids  # creates the object, no context
        assert "media_publish_clearance" not in ids  # media_id, not object_id
        assert "use_reproduction" not in ids  # no page context at all

    def test_no_context_returns_only_self_contained(self, auth_setup):
        """The central surface: only templates runnable from a bare form (no
        page context), so nothing offered there is a guaranteed missing-param."""
        client, org, _ = auth_setup
        base = f"/api/organizations/{org.organization_id}/agent/plan-templates"
        body = client.get(f"{base}?no_context=true").get_json()
        ids = {t["template_id"] for t in body["templates"]}
        assert {"acquisition_accession", "use_reproduction"} <= ids
        # Anything needing an object/media id is filtered out.
        assert "loan_in_reception" not in ids
        assert "deaccession_disposal" not in ids
        assert "media_publish_clearance" not in ids

    def test_params_carry_typed_metadata(self, auth_setup):
        client, org, _ = auth_setup
        body = client.get(_templates_url(org, "acquisitions")).get_json()
        params = {p["key"]: p for p in body["templates"][0]["params"]}
        assert params["acquisition_method"]["type"] == "enum"
        assert "gift" in params["acquisition_method"]["enum_options"]
        assert params["acquisition_method"]["required"] is True
        assert params["object_number"]["required"] is True


class TestCreateFromTemplate:
    def test_creates_a_valid_plan(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(_plans_url(org), json={
            "template_id": "acquisition_accession",
            "params": {"acquisition_method": "gift", "object_number": "2026.T.1", "source_name": "A Donor"},
        })
        assert resp.status_code == 201, resp.text
        plan = resp.get_json()
        assert plan["status"] == "pending"
        assert plan["step_count"] >= 1
        # Every tool_call/delegate step has a tool — the template is runnable.
        for s in plan["steps"]:
            if s["kind"] in ("tool_call", "delegate"):
                assert s.get("tool")

    def test_missing_required_param_is_422(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(_plans_url(org), json={
            "template_id": "acquisition_accession",
            "params": {"acquisition_method": "gift"},  # object_number missing
        })
        assert resp.status_code == 422
        body = resp.get_json()
        assert body["error"]["code"] == "missing_params"
        assert "object_number" in body["error"]["missing"]

    def test_unknown_template_is_404(self, auth_setup):
        client, org, _ = auth_setup
        resp = client.post(_plans_url(org), json={"template_id": "nope", "params": {}})
        assert resp.status_code == 404

    def test_context_id_satisfies_context_param(self, auth_setup):
        """A from-context required param (object_id) can be supplied via
        context_entity_id rather than the params dict."""
        client, org, _ = auth_setup
        resp = client.post(_plans_url(org), json={
            "template_id": "loan_in_reception",
            "params": {"lender_name": "Tate"},
            "context_entity_type": "collection_object",
            "context_entity_id": "00000000-0000-0000-0000-000000000123",
        })
        assert resp.status_code == 201, resp.text
