"""Bulk actions, agent drafts and the agent form registry use the org's lookups.

The single-record forms already offer and accept an organization's lookup
values (tests/test_lookup_backed_columns.py). The workspace bulk dialog, the
agent's draft payload schemas and the agent form registry hard-coded the old
CHECK lists instead, so an org-added value could not be chosen there and some
hard-coded values (bulk "structural" concern) were never lookup values.
"""

from __future__ import annotations

import json
import re
import typing
import uuid

import pytest
from sqlalchemy import text

from app.models import ConditionReport, ConservationTreatment, IncidentReport, Workspace, WorkspaceItem
from app.services.lookup_fields import DRAFT_LOOKUP_TABLES, FIXED, LOOKUP_COLUMNS, OPEN

OPEN_COLS = {(e.table, e.column): e.category for e in LOOKUP_COLUMNS if e.mode == OPEN}
FIXED_COLS = {(e.table, e.column): e.category for e in LOOKUP_COLUMNS if e.mode == FIXED}


def _add_org_value(db_session, org_id, category, key):
    from app.models import LookupCategory, LookupValue

    cat = db_session.query(LookupCategory).filter(LookupCategory.category_key == category).one()
    db_session.add(LookupValue(category_id=cat.category_id, organization_id=org_id, value_key=key, label=key.title()))
    db_session.commit()


def _check_values(db_session, table: str, column: str) -> set[str]:
    schema, name = table.split(".")
    defs = db_session.execute(
        text(
            "SELECT pg_get_constraintdef(con.oid) FROM pg_constraint con "
            "JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace "
            "JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (con.conkey) "
            "WHERE con.contype = 'c' AND n.nspname = :s AND c.relname = :t AND a.attname = :c"
        ),
        {"s": schema, "t": name, "c": column},
    ).scalars()
    return set(re.findall(r"'([^']*)'", " ".join(defs)))


# ---------------------------------------------------------------------------
# Bulk actions
# ---------------------------------------------------------------------------

# Bulk parameter -> the registered column it fills.
BULK_LOOKUP_PARAMS = {
    ("create_condition_report", "report_type"): ("collections.condition_reports", "report_type"),
    ("create_condition_report", "overall_condition"): ("collections.condition_reports", "overall_condition"),
    ("report_incident", "incident_type"): ("collections.incident_reports", "incident_type"),
    ("flag_for_conservation", "treatment_type"): ("collections.conservation_treatments", "treatment_type"),
}


def test_bulk_lookup_params_are_registered_columns():
    from app.fastapi_app.routers.workspaces import SUPPORTED_BULK_ACTIONS

    registered = {(e.table, e.column) for e in LOOKUP_COLUMNS}
    for (action, param), column in BULK_LOOKUP_PARAMS.items():
        cfg = SUPPORTED_BULK_ACTIONS[action]
        assert param in cfg["required_params"] + cfg.get("optional_params", []), (action, param)
        assert column in registered, column


@pytest.fixture
def bulk(auth_setup, db_session):
    from app.models import CollectionObject

    client, org, user = auth_setup
    # auth_setup's role has no incidents.create; the bulk route checks it.
    from app.models import OrganizationMembership, Role
    from tests.conftest import _create_permission, _create_role_permission

    membership = db_session.query(OrganizationMembership).filter_by(
        organization_id=org.organization_id, user_id=user.user_id).one()
    role = db_session.get(Role, membership.role_id)
    _create_role_permission(db_session, role, _create_permission(db_session, "incidents.create"))
    db_session.commit()
    ws = Workspace(organization_id=org.organization_id, owner_user_id=user.user_id,
                   workspace_type="collections", name="Bulk lookups")
    db_session.add(ws)
    db_session.commit()
    objs = []
    for i in range(2):
        obj = CollectionObject(organization_id=org.organization_id, object_number=f"BLK-{i}-{uuid.uuid4().hex[:4]}")
        db_session.add(obj)
        db_session.commit()
        db_session.add(WorkspaceItem(workspace_id=ws.workspace_id, object_id=obj.object_id))
        objs.append(obj)
    db_session.commit()

    def run(action, params, op="execute"):
        return client.post(
            f"/api/organizations/{org.organization_id}/workspaces/{ws.workspace_id}/actions/{action}/{op}",
            data=json.dumps({"action_params": params}),
            content_type="application/json",
        )

    return org, objs, run


class TestBulkActions:
    def test_flag_for_conservation_saves_an_org_treatment_type(self, bulk, db_session):
        org, objs, run = bulk
        _add_org_value(db_session, org.organization_id, "treatment_type", "wet_cleaning")
        resp = run("flag_for_conservation", {"urgency": "urgent", "treatment_type": "wet_cleaning",
                                             "concern_description": "Bloom on varnish"})
        assert resp.status_code == 200, resp.get_json()
        assert resp.get_json()["success_count"] == 2
        rows = db_session.query(ConservationTreatment).filter(
            ConservationTreatment.organization_id == org.organization_id).all()
        assert len(rows) == 2
        assert {r.treatment_type for r in rows} == {"wet_cleaning"}
        assert all(r.proposal_summary == "Bloom on varnish" for r in rows)
        assert all("Urgent" in r.treatment_note for r in rows)
        assert len({r.treatment_number for r in rows}) == 2

    def test_flag_accepts_the_old_concern_type_name(self, bulk, db_session):
        _org, _objs, run = bulk
        resp = run("flag_for_conservation", {"urgency": "low", "concern_type": "cleaning"})
        assert resp.status_code == 200, resp.get_json()

    @pytest.mark.parametrize("op", ["validate", "execute"])
    def test_flag_refuses_values_that_are_not_lookups(self, bulk, op):
        _org, _objs, run = bulk
        resp = run("flag_for_conservation", {"urgency": "urgent", "treatment_type": "structural"}, op)
        assert resp.status_code == 400, resp.get_json()
        assert resp.get_json()["error"]["field"] == "treatment_type"
        resp = run("flag_for_conservation", {"urgency": "whenever", "treatment_type": "cleaning"}, op)
        assert resp.status_code == 400
        assert resp.get_json()["error"]["field"] == "urgency"

    def test_report_incident_with_org_type(self, bulk, db_session):
        org, _objs, run = bulk
        _add_org_value(db_session, org.organization_id, "incident_type", "mould")
        resp = run("report_incident", {"incident_type": "mould", "incident_description": "Spores"})
        assert resp.status_code == 200, resp.get_json()
        assert db_session.query(IncidentReport).filter(
            IncidentReport.organization_id == org.organization_id).one().incident_type == "mould"
        resp = run("report_incident", {"incident_type": "meteor", "incident_description": "x"})
        assert resp.status_code == 400
        assert resp.get_json()["error"]["field"] == "incident_type"

    def test_condition_reports_with_org_type_and_fixed_condition(self, bulk, db_session):
        org, _objs, run = bulk
        _add_org_value(db_session, org.organization_id, "report_type", "tactile_check")
        resp = run("create_condition_report", {"report_type": "tactile_check", "overall_condition": "good"})
        assert resp.status_code == 200, resp.get_json()
        assert {r.report_type for r in db_session.query(ConditionReport).filter(
            ConditionReport.organization_id == org.organization_id)} == {"tactile_check"}
        resp = run("create_condition_report", {"report_type": "nope"})
        assert resp.status_code == 400
        resp = run("create_condition_report", {"report_type": "periodic", "overall_condition": "critical"})
        assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Agent drafts and the agent form registry
# ---------------------------------------------------------------------------


def _literal_values(annotation):
    inner = annotation
    if typing.get_origin(inner) in (typing.Union, getattr(__import__("types"), "UnionType", None)):
        args = [a for a in typing.get_args(inner) if a is not type(None)]
        inner = args[0] if len(args) == 1 else inner
    if typing.get_origin(inner) is typing.Literal:
        return set(typing.get_args(inner))
    return None


def test_draft_schemas_do_not_fix_open_vocabularies(db_session):
    from app.services.drafts.factory.registry import build_payload_schemas

    schemas = build_payload_schemas()
    for entity_type, (table, aliases) in DRAFT_LOOKUP_TABLES.items():
        model = schemas[entity_type]
        reverse = {v: k for k, v in aliases.items()}
        seen_open = False
        for name, info in model.model_fields.items():
            column = reverse.get(name, name)
            values = _literal_values(info.annotation)
            if (table, column) in OPEN_COLS:
                seen_open = True
                assert values is None, f"{entity_type}.{name} hard-codes an org-extendable list"
            elif (table, column) in FIXED_COLS and values is not None:
                assert values <= _check_values(db_session, table, column), (entity_type, name)
        assert seen_open, f"{entity_type} is mapped but has no lookup-backed field"


# Draft entities whose tables have no lookup-backed (OPEN) column. A new draft
# entity must be added here or to DRAFT_LOOKUP_TABLES, so its vocabularies are
# classified rather than silently hard-coded.
NO_LOOKUP_DRAFTS = {
    "collection_object",  # its enums (object_status, catalog_level, ...) are FIXED CHECKs
    "constituent", "location", "movement",  # own CHECK-defined vocabularies, not lookups
    "media_consent", "media_metadata", "media_publish", "media_review", "media_rights",
}


def test_every_draft_entity_is_classified():
    from app.services.drafts.factory.registry import build_payload_schemas

    entities = set(build_payload_schemas())
    assert entities == set(DRAFT_LOOKUP_TABLES) | NO_LOOKUP_DRAFTS
    assert not set(DRAFT_LOOKUP_TABLES) & NO_LOOKUP_DRAFTS


def test_form_registry_offers_lookups_for_open_columns_and_checks_for_fixed(db_session):
    from app.services.agent_tools.form_registry import FORM_REGISTRY, get_entity_model_map

    models = get_entity_model_map()
    for entity_type, form in FORM_REGISTRY.items():
        table = models[entity_type][0].__table__.fullname
        for f in form.fields:
            if (table, f.name) in OPEN_COLS:
                assert f.enum_values is None, f"{entity_type}.{f.name} hard-codes an org-extendable list"
                assert f.lookup_values == OPEN_COLS[(table, f.name)], (entity_type, f.name)
                assert f.field_type == "enum"
            elif (table, f.name) in FIXED_COLS and f.enum_values:
                assert set(f.enum_values) <= _check_values(db_session, table, f.name), (entity_type, f.name)


@pytest.fixture
def agent(db_session):
    from app.models import Organization, User
    from app.services.agent_tools import AgentContext

    org = Organization(name="Draft Lookups", slug=f"dl-{uuid.uuid4().hex[:8]}")
    user = User(email=f"c-{uuid.uuid4().hex[:8]}@example.com", display_name="Conservator")
    db_session.add_all([org, user])
    db_session.commit()
    from app.models import CollectionObject

    obj = CollectionObject(organization_id=org.organization_id, object_number=f"DL-{uuid.uuid4().hex[:4]}")
    db_session.add(obj)
    db_session.commit()
    ctx = AgentContext(organization_id=org.organization_id, user_id=user.user_id,
                       persona="conservator", db_session=db_session)
    return ctx, org, obj


class TestDrafts:
    def _propose(self, ctx, obj, **fields):
        from app.services.drafts.draft_service import create_draft

        return create_draft(ctx, entity_type="condition_report",
                            payload={"object_id": str(obj.object_id), "report_type": "periodic",
                                     "report_date": "2026-11-15", **fields})

    def test_agent_can_propose_an_org_added_value(self, agent, db_session):
        ctx, org, obj = agent
        _add_org_value(db_session, org.organization_id, "report_type", "tactile_check")
        draft = self._propose(ctx, obj, report_type="tactile_check")
        assert draft.payload["report_type"] == "tactile_check"

    def test_unknown_value_is_refused_with_the_allowed_list(self, agent):
        from app.services.drafts.draft_service import DraftValidationError

        ctx, _org, obj = agent
        with pytest.raises(DraftValidationError) as info:
            self._propose(ctx, obj, report_type="vibes")
        assert "report_type 'vibes'" in str(info.value)
        assert "periodic" in str(info.value)

    def test_another_orgs_value_is_refused(self, agent, db_session):
        from app.models import Organization
        from app.services.drafts.draft_service import DraftValidationError

        ctx, _org, obj = agent
        other = Organization(name="Other", slug=f"o-{uuid.uuid4().hex[:6]}")
        db_session.add(other)
        db_session.commit()
        _add_org_value(db_session, other.organization_id, "report_type", "tactile_check")
        with pytest.raises(DraftValidationError):
            self._propose(ctx, obj, report_type="tactile_check")

    def test_fixed_vocabulary_stays_a_schema_enum(self, agent):
        from app.services.drafts.draft_service import DraftValidationError

        ctx, _org, obj = agent
        with pytest.raises(DraftValidationError):
            self._propose(ctx, obj, overall_condition="critical")

    def test_editing_a_draft_rechecks_lookups(self, agent, db_session):
        from app.services.drafts.draft_service import DraftValidationError, update_draft

        ctx, _org, obj = agent
        draft = self._propose(ctx, obj)
        with pytest.raises(DraftValidationError):
            update_draft(db_session, draft.draft_id,
                         {"object_id": str(obj.object_id), "report_type": "vibes", "report_date": "2026-11-15"})

    def test_draft_form_offers_the_orgs_values(self, agent, db_session):
        from app.services.drafts.form_projection import draft_form_schema

        ctx, org, _obj = agent
        _add_org_value(db_session, org.organization_id, "report_type", "tactile_check")
        fields = {f["name"]: f for f in draft_form_schema("condition_report", db_session, org.organization_id)["fields"]}
        assert fields["report_type"]["type"] == "enum"
        assert "tactile_check" in fields["report_type"]["enum_values"]
        assert "periodic" in fields["report_type"]["enum_values"]
        assert fields["overall_condition"]["enum_values"] == ["excellent", "good", "fair", "poor", "unacceptable"]

    def test_agent_form_lookup_lists_the_orgs_values(self, agent, db_session):
        from app.services.agent_tools.staff_tools import lookup_madrona_field

        ctx, org, _obj = agent
        _add_org_value(db_session, org.organization_id, "treatment_type", "wet_cleaning")
        result = lookup_madrona_field({"entity_type": "conservation"}, ctx)
        fields = {f["name"]: f for s in result["sections"] for f in s["fields"]}
        assert "wet_cleaning" in fields["treatment_type"]["enum_values"]


class TestDraftApprovalRechecksLookups:
    """A value deactivated while the draft waited is refused at approval."""

    def test_deactivated_value_is_not_applied(self, agent, db_session):
        from app.models import LookupValue
        from app.services.drafts.draft_service import approve_draft, create_draft

        ctx, org, obj = agent
        _add_org_value(db_session, org.organization_id, "report_type", "tactile_check")
        draft = create_draft(ctx, entity_type="condition_report",
                             payload={"object_id": str(obj.object_id), "report_type": "tactile_check",
                                      "report_date": "2026-11-15"})
        value = db_session.query(LookupValue).filter(
            LookupValue.organization_id == org.organization_id, LookupValue.value_key == "tactile_check",
        ).one()
        value.is_active = False
        db_session.commit()

        before = db_session.query(ConditionReport).filter(ConditionReport.organization_id == org.organization_id).count()
        result = approve_draft(db_session, draft.draft_id, ctx.user_id)
        assert result.applied_at is None
        assert "report_type 'tactile_check'" in (result.apply_error or "")
        assert result.status == "approved"  # can be edited and retried
        after = db_session.query(ConditionReport).filter(ConditionReport.organization_id == org.organization_id).count()
        assert after == before

    def test_active_value_is_applied(self, agent, db_session):
        from app.services.drafts.draft_service import approve_draft, create_draft

        ctx, org, obj = agent
        _add_org_value(db_session, org.organization_id, "report_type", "tactile_check")
        draft = create_draft(ctx, entity_type="condition_report",
                             payload={"object_id": str(obj.object_id), "report_type": "tactile_check",
                                      "report_date": "2026-11-15"})
        result = approve_draft(db_session, draft.draft_id, ctx.user_id)
        assert result.apply_error is None, result.apply_error
        assert result.applied_at is not None
        report = db_session.get(ConditionReport, result.applied_entity_id)
        assert report.report_type == "tactile_check"
