"""Organization settings are on the audit trail.

Organization fields, branding, collection profile, storage, enabled
applications, media AI and derivative settings, field inheritance,
vocabulary mappings, service-level policies, approval rules, document
templates and help pages each record created / updated / deleted events
(with the actor), are readable through the history API with the permission
that edits them, and are listed on the admin Settings changes log
(entity-audit-events?category=settings). Stored credentials are masked;
metered usage counters are left out.
"""
import json
import uuid

import pytest

from app import context as ctx
from app.models import EntityAuditEvent, EntityAuditFieldDiff
from app.models.core_org import (
    Application,
    ApprovalRule,
    DocumentTemplate,
    Organization,
    OrganizationApplication,
    OrganizationBranding,
    OrganizationCollectionProfile,
    OrganizationStorageConfig,
    OrgScopedDoc,
)
from app.models.media import (
    DerivativeSizeConfig,
    MediaAIConfig,
    MediaAITagMapping,
    MediaFieldInheritanceConfig,
    MediaTagDefinition,
)
from app.models.sla import SLAPolicy
from app.models.vocabulary import VocabularyMapping
from app.services import entity_audit as ea


def _events(db, org_id, entity_type, entity_id, change_type=None):
    db.expire_all()
    q = db.query(EntityAuditEvent).filter(
        EntityAuditEvent.organization_id == org_id,
        EntityAuditEvent.entity_type == entity_type,
        EntityAuditEvent.entity_id == entity_id,
    )
    if change_type:
        q = q.filter(EntityAuditEvent.change_type == change_type)
    return q.order_by(EntityAuditEvent.changed_at).all()


def _diffs(event):
    return {d.field_name: (d.old_value, d.new_value) for d in event.field_diffs}


@pytest.fixture()
def acting_user(auth_setup):
    _, org, user = auth_setup
    token = ctx.request_user_id.set(str(user.user_id))
    try:
        yield org, user
    finally:
        ctx.request_user_id.reset(token)


def _tag_definition(db, org_id):
    d = MediaTagDefinition(organization_id=org_id, tag_key=f"k{uuid.uuid4().hex[:6]}", display_name="Subject")
    db.add(d)
    db.flush()
    return d


# (factory(db, org_id) -> row, field to change, new value, expected entity_type)
SETTINGS_CASES = [
    ("OrganizationBranding", lambda db, o: OrganizationBranding(organization_id=o, letterhead_name="Example Museum"),
     "primary_color", "#224466", "organization_branding"),
    ("OrganizationCollectionProfile", lambda db, o: OrganizationCollectionProfile(organization_id=o, scope_note="Textiles"),
     "known_gaps", "Pre-1900 prints", "organization_collection_profile"),
    ("MediaAIConfig", lambda db, o: MediaAIConfig(organization_id=o), "detect_faces", True, "media_ai_config"),
    ("MediaAITagMapping", lambda db, o: MediaAITagMapping(
        organization_id=o, ai_tag_type="label", ai_tag_value="Chair",
        definition_id=_tag_definition(db, o).definition_id, mapped_value="Furniture"),
     "mapped_value", "Seating", "media_ai_tag_mapping"),
    ("DerivativeSizeConfig", lambda db, o: DerivativeSizeConfig(organization_id=o, name="web", label="Web", max_width=1200),
     "max_width", 1600, "derivative_size_config"),
    ("MediaFieldInheritanceConfig", lambda db, o: MediaFieldInheritanceConfig(
        organization_id=o, source_field="object_number", display_label="Object number"),
     "display_label", "Accession number", "media_field_inheritance_config"),
    ("VocabularyMapping", lambda db, o: VocabularyMapping(organization_id=o, source_term="oil on canvas", source_field="medium"),
     "mapped_value", "Oil paint", "vocabulary_mapping"),
    ("SLAPolicy", lambda db, o: SLAPolicy(organization_id=o, workflow_type="loan_in", name="Incoming loans",
                                        warning_days=5, deadline_days=10, critical_days=15),
     "deadline_days", 12, "sla_policy"),
    ("ApprovalRule", lambda db, o: ApprovalRule(organization_id=o, entity_type="deaccession", trigger_action="approve",
                                              approver_permission="deaccession.approve", description="Board sign-off"),
     "is_active", False, "approval_rule"),
    ("DocumentTemplate", lambda db, o: DocumentTemplate(organization_id=o, template_type="loan_agreement_out", name="Loan agreement"),
     "terms_and_conditions", "Objects travel by fine-art shipper.", "document_template"),
    ("OrgScopedDoc", lambda db, o: OrgScopedDoc(organization_id=o, page_key="loans", title="Loans help", body_markdown="Start here"),
     "body_markdown", "Start with the loan agreement", "org_scoped_doc"),
]


@pytest.mark.parametrize("name,factory,field,value,entity_type", SETTINGS_CASES, ids=[c[0] for c in SETTINGS_CASES])
def test_settings_record_create_update_delete(acting_user, db_session, name, factory, field, value, entity_type):
    org, user = acting_user
    row = factory(db_session, org.organization_id)
    db_session.add(row)
    db_session.commit()
    rid = ea._get_entity_pk(row)
    old = getattr(row, field)
    setattr(row, field, value)
    db_session.commit()
    db_session.delete(row)
    db_session.commit()

    rows = _events(db_session, org.organization_id, entity_type, rid)
    assert [e.change_type for e in rows] == ["created", "updated", "deleted"], name
    assert _diffs(rows[1]) == {field: (ea._serialize_value(old), value)}
    assert all(e.changed_by == user.user_id for e in rows)
    assert rows[0].entity_display_key  # every settings row has a readable name
    assert entity_type in ea.SETTINGS_ENTITY_TYPES


def test_organization_settings_fields(auth_setup, db_session):
    client, org, user = auth_setup
    resp = client.patch(f"/api/organizations/{org.organization_id}", data=json.dumps({"timezone": "America/Toronto"}),
                        content_type="application/json")
    assert resp.status_code == 200, resp.get_json()
    upd = _events(db_session, org.organization_id, "organization", org.organization_id, "updated")
    assert len(upd) == 1 and _diffs(upd[0])["timezone"][1] == "America/Toronto"
    assert upd[0].changed_by == user.user_id

    # Metering is not a settings change.
    o = db_session.get(Organization, org.organization_id)
    o.storage_used_bytes = 123456
    o.db_used_bytes = 42
    db_session.commit()
    assert len(_events(db_session, org.organization_id, "organization", org.organization_id, "updated")) == 1


def test_enabled_applications_are_child_rows_of_the_organization(acting_user, db_session):
    org, _ = acting_user
    app = Application(key=f"app{uuid.uuid4().hex[:6]}", display_name="Exhibitions")
    db_session.add(app)
    db_session.flush()
    link = OrganizationApplication(organization_id=org.organization_id, application_id=app.application_id, enabled=True)
    db_session.add(link)
    db_session.commit()
    link.enabled = False
    db_session.commit()
    rows = [e for e in _events(db_session, org.organization_id, "organization", org.organization_id)
            if e.child_entity_type == "organization_application"]
    assert [e.change_type for e in rows] == ["link_added", "link_updated"]
    assert rows[0].child_display_key == "Exhibitions"
    assert _diffs(rows[1]) == {"enabled": (True, False)}


def test_storage_credentials_are_masked(acting_user, db_session):
    org, _ = acting_user
    cfg = OrganizationStorageConfig(organization_id=org.organization_id, provider="s3",
                                    config_encrypted=b"aws-secret-access-key-XYZ",
                                    cdn_signing_key_encrypted=b"cdn-private-key-ABC")
    db_session.add(cfg)
    db_session.commit()
    cfg.config_encrypted = b"aws-secret-access-key-ROTATED"
    cfg.cdn_domain = "cdn.example.org"
    db_session.commit()

    rows = _events(db_session, org.organization_id, "organization_storage_config", cfg.id)
    assert [e.change_type for e in rows] == ["created", "updated"]
    assert _diffs(rows[0])["config_encrypted"] == (None, ea.MASKED_VALUE)
    assert _diffs(rows[1]) == {
        "config_encrypted": (ea.MASKED_VALUE, ea.MASKED_VALUE),
        "cdn_domain": (None, "cdn.example.org"),
    }
    db_session.expire_all()
    dump = json.dumps([[d.old_value, d.new_value] for d in db_session.query(EntityAuditFieldDiff).all()])
    assert "aws-secret" not in dump and "cdn-private" not in dump


def test_settings_change_log_and_history_api(auth_setup, db_session):
    client, org, _ = auth_setup
    sla = SLAPolicy(organization_id=org.organization_id, workflow_type="loan_out", name="Outgoing loans",
                    warning_days=3, deadline_days=7, critical_days=14)
    token = ctx.request_user_id.set(None)
    try:
        db_session.add(sla)
        db_session.commit()
    finally:
        ctx.request_user_id.reset(token)

    resp = client.get(f"/api/organizations/{org.organization_id}/entity-audit-events?category=settings")
    assert resp.status_code == 200, resp.get_json()
    items = resp.get_json()["items"]
    assert any(i["entity_id"] == str(sla.policy_id) for i in items)
    assert {i["entity_type"] for i in items} <= ea.SETTINGS_ENTITY_TYPES

    resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/sla_policy/{sla.policy_id}")
    assert resp.status_code == 200 and resp.get_json()["items"][0]["change_type"] == "created"


def test_events_outside_the_rls_org_are_skipped_not_fatal(acting_user, db_session):
    """A write for another organization (a platform admin creating an org
    from their own) must not fail on the audit row RLS would reject."""
    org, _ = acting_user
    db_session.info["rls_config"] = {"app.current_org_id": str(uuid.uuid4())}
    try:
        other = Organization(name="New museum", slug=f"new-{uuid.uuid4().hex[:6]}", status="active", is_demo=False)
        db_session.add(other)
        db_session.commit()
        assert _events(db_session, other.organization_id, "organization", other.organization_id) == []
    finally:
        db_session.info.pop("rls_config", None)
