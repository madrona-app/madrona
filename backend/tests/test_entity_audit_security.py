"""Security configuration is on the audit trail.

Custom roles, their permissions, field-access grants and role labels, per-app
role overrides, SSO settings and API keys are recorded on entity history
(created / updated / deleted, field by field, with the actor), are readable
through the history API with the audit-log permission, and are listed on the
admin Security changes log (entity-audit-events?category=security).

Secrets never reach the audit tables: SSO client secrets and IdP
certificates are recorded as "(hidden)", API key hashes and prefixes not at
all.
"""
import json
import uuid
from unittest.mock import patch

import pytest
from sqlalchemy import text

from app import context as ctx
from app.models import (
    APIKey,
    Application,
    CollectionObject,
    EntityAuditEvent,
    EntityAuditFieldDiff,
    FieldAccessPolicy,
    Permission as PermissionModel,
    Role,
    SSOConfiguration,
)
from app.services import entity_audit as ea
from tests.conftest import _create_permission


def _put(c, url, body):
    return c.put(url, data=json.dumps(body), content_type="application/json")


def _post(c, url, body):
    return c.post(url, data=json.dumps(body), content_type="application/json")


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


def _all_audit_text(db) -> str:
    """Every value in the audit tables, as one string, for secret scans."""
    db.expire_all()
    parts = []
    for e in db.query(EntityAuditEvent).all():
        parts += [str(e.summary), str(e.entity_display_key), str(e.child_display_key), json.dumps(e.changed_fields)]
    for d in db.query(EntityAuditFieldDiff).all():
        parts += [json.dumps(d.old_value), json.dumps(d.new_value)]
    return "\n".join(parts)


@pytest.fixture()
def acting_user(auth_setup):
    _, org, user = auth_setup
    token = ctx.request_user_id.set(str(user.user_id))
    try:
        yield org, user
    finally:
        ctx.request_user_id.reset(token)


def _perm(db, key):
    return db.query(PermissionModel).filter(PermissionModel.permission_key == key).one()


# ---------------------------------------------------------------------------
# Custom roles and their permission sets
# ---------------------------------------------------------------------------


def test_custom_role_lifecycle_and_permission_changes(auth_setup, db_session):
    client, org, user = auth_setup
    base = f"/api/organizations/{org.organization_id}/custom-roles"
    resp = _post(client, base, {"display_name": "Volunteer cataloguer", "description": "Data entry"})
    assert resp.status_code == 201, resp.get_json()
    role_id = uuid.UUID(resp.get_json()["role_id"])

    resp = _put(client, f"{base}/{role_id}", {"description": "Data entry, no deletes"})
    assert resp.status_code == 200, resp.get_json()

    view, edit, delete = (_perm(db_session, k) for k in ("collections.view", "collections.edit", "collections.delete"))
    resp = _put(client, f"{base}/{role_id}/permissions",
                {"permission_ids": [str(view.permission_id), str(edit.permission_id)]})
    assert resp.status_code == 200, resp.get_json()
    resp = _put(client, f"{base}/{role_id}/permissions",
                {"permission_ids": [str(edit.permission_id), str(delete.permission_id)]})
    assert resp.status_code == 200, resp.get_json()

    events = _events(db_session, org.organization_id, "role", role_id)
    assert [e.change_type for e in events if e.child_entity_type is None][:2] == ["created", "updated"]
    upd = next(e for e in events if e.change_type == "updated")
    assert _diffs(upd)["description"] == ("Data entry", "Data entry, no deletes")
    assert upd.changed_by == user.user_id

    perm_events = sorted((e.change_type, e.child_display_key) for e in events if e.child_entity_type == "role_permission")
    assert perm_events == [
        ("link_added", "collections.delete"),
        ("link_added", "collections.edit"),
        ("link_added", "collections.view"),
        ("link_removed", "collections.view"),
    ]

    # Saving the same set again records nothing.
    before = len(_events(db_session, org.organization_id, "role", role_id))
    resp = _put(client, f"{base}/{role_id}/permissions",
                {"permission_ids": [str(delete.permission_id), str(edit.permission_id)]})
    assert resp.status_code == 200
    assert len(_events(db_session, org.organization_id, "role", role_id)) == before

    # Deleting a custom role deactivates it; that is an update on its history.
    assert client.delete(f"{base}/{role_id}").status_code == 200
    last = _events(db_session, org.organization_id, "role", role_id, "updated")[-1]
    assert _diffs(last)["is_active"] == (True, False)


def test_role_hard_delete_is_recorded(acting_user, db_session):
    org, _ = acting_user
    role = Role(role_key="temp-role", display_name="Temporary", organization_id=org.organization_id, is_system=False)
    db_session.add(role)
    db_session.commit()
    rid = role.role_id
    db_session.delete(role)
    db_session.commit()
    deleted = _events(db_session, org.organization_id, "role", rid, "deleted")
    assert len(deleted) == 1 and deleted[0].entity_display_key == "Temporary"


# ---------------------------------------------------------------------------
# Field-access grants, role labels, per-app role overrides
# ---------------------------------------------------------------------------


@pytest.fixture()
def field_policy(db_session):
    app = db_session.query(Application).filter(Application.key == "collections").first()
    if app is None:
        app = Application(key="collections", display_name="Collections")
        db_session.add(app)
        db_session.flush()
    policy = FieldAccessPolicy(
        application_id=app.application_id, entity_type="collection_object",
        field_path="insurance_value", policy_type="restricted", display_name="Insurance value",
    )
    db_session.add(policy)
    db_session.commit()
    return policy


def test_field_access_grants_recorded_on_the_role(auth_setup, db_session, field_policy):
    client, org, user = auth_setup
    role = Role(role_key="viewer-x", display_name="Viewer X", organization_id=org.organization_id, is_system=False)
    db_session.add(role)
    db_session.commit()
    url = f"/api/organizations/{org.organization_id}/field-access/grants/{role.role_id}"
    grant = {"policy_id": str(field_policy.policy_id), "can_view": True, "can_edit": False}
    assert _put(client, url, {"grants": [grant]}).status_code == 200
    assert _put(client, url, {"grants": [grant]}).status_code == 200  # unchanged
    assert _put(client, url, {"grants": [{**grant, "can_edit": True}]}).status_code == 200
    resp = client.delete(f"{url}/{field_policy.policy_id}")
    assert resp.status_code == 204

    rows = [e for e in _events(db_session, org.organization_id, "role", role.role_id)
            if e.child_entity_type == "role_field_access"]
    assert [e.change_type for e in rows] == ["link_added", "link_updated", "link_removed"]
    assert all(e.child_display_key == "insurance_value" for e in rows)
    assert _diffs(rows[1]) == {"can_edit": (False, True)}
    assert rows[1].changed_by == user.user_id


def test_role_labels_recorded(auth_setup, db_session):
    client, org, _ = auth_setup
    role = db_session.query(Role).filter(Role.role_key == "admin").first()
    url = f"/api/organizations/{org.organization_id}/role-labels/admin"
    resp = _put(client, url, {"label": "Head of collections"})
    assert resp.status_code == 200, resp.get_json()
    resp = _put(client, url, {"label": "Collections lead"})
    assert resp.status_code == 200, resp.get_json()
    assert client.delete(url).status_code == 200

    rows = [e for e in _events(db_session, org.organization_id, "role", role.role_id)
            if e.child_entity_type == "org_role_label"]
    assert [e.change_type for e in rows] == ["link_added", "link_updated", "link_removed"]
    assert _diffs(rows[1])["label"] == ("Head of collections", "Collections lead")


def test_app_role_overrides_recorded(acting_user, db_session):
    from app.services.rbac_service import remove_user_app_role, set_user_app_role

    org, user = acting_user
    curator = Role(role_key="curator-x", display_name="Curator X", organization_id=org.organization_id, is_system=False)
    viewer = Role(role_key="viewer-y", display_name="Viewer Y", organization_id=org.organization_id, is_system=False)
    db_session.add_all([curator, viewer])
    db_session.commit()

    a = set_user_app_role(user.user_id, org.organization_id, "collections", curator.role_id, session=db_session)
    db_session.commit()
    set_user_app_role(user.user_id, org.organization_id, "collections", viewer.role_id, session=db_session)
    db_session.commit()
    aid = a.assignment_id
    assert remove_user_app_role(user.user_id, org.organization_id, "collections", session=db_session)
    db_session.commit()

    rows = _events(db_session, org.organization_id, "app_role_assignment", aid)
    assert [e.change_type for e in rows] == ["created", "updated", "deleted"]
    assert rows[0].entity_display_key == f"{user.email} (collections)"
    assert _diffs(rows[1])["role_id"] == ("Curator X", "Viewer Y")


# ---------------------------------------------------------------------------
# SSO and API keys: secrets never recorded
# ---------------------------------------------------------------------------

CERT = "MIIC-THIS-IS-A-TEST-CERTIFICATE-BODY-1234567890"
SECRET = "oidc-client-secret-do-not-log-8f2c"


def test_sso_configuration_history_masks_secrets(acting_user, db_session):
    org, _ = acting_user
    sso = SSOConfiguration(organization_id=org.organization_id, provider="oidc", enabled=False,
                           client_id="madrona-test", idp_certificate=CERT,
                           client_secret_encrypted=SECRET.encode())
    db_session.add(sso)
    db_session.commit()
    sso.enabled = True
    sso.client_secret_encrypted = (SECRET + "-rotated").encode()
    sso.idp_certificate = CERT + "-rotated"
    db_session.commit()
    sid = sso.id
    db_session.delete(sso)
    db_session.commit()

    rows = _events(db_session, org.organization_id, "sso_configuration", sid)
    assert [e.change_type for e in rows] == ["created", "updated", "deleted"]
    created = _diffs(rows[0])
    assert created["client_id"] == (None, "madrona-test")
    assert created["idp_certificate"] == (None, ea.MASKED_VALUE)
    assert created["client_secret_encrypted"] == (None, ea.MASKED_VALUE)
    updated = _diffs(rows[1])
    assert updated["enabled"] == (False, True)
    assert updated["client_secret_encrypted"] == (ea.MASKED_VALUE, ea.MASKED_VALUE)
    assert updated["idp_certificate"] == (ea.MASKED_VALUE, ea.MASKED_VALUE)

    dump = _all_audit_text(db_session)
    assert CERT not in dump and SECRET not in dump


_FULL_KEY = "mkey_fake1234567890abcdef1234567890abcdef12"


def test_api_key_history_never_records_key_material(auth_setup, db_session):
    client, org, user = auth_setup
    url = f"/api/organizations/{org.organization_id}/api-keys"
    with patch("app.services.auth_utils.generate_api_key", return_value=_FULL_KEY), \
            patch("app.services.auth_utils.hash_api_key", return_value="hashed_value_for_testing"), \
            patch("app.services.auth_utils.get_api_key_prefix", return_value="mkey_fak"):
        resp = _post(client, url, {"name": "Catalogue sync", "scopes": ["read:datasets"]})
    assert resp.status_code == 201, resp.get_json()
    key = db_session.query(APIKey).filter(APIKey.name == "Catalogue sync").one()
    key.scopes = ["read:datasets", "read:entities"]
    db_session.commit()
    resp = client.delete(f"/api/api-keys/{key.api_key_id}?organization_id={org.organization_id}")
    assert resp.status_code == 200, resp.get_json()

    rows = _events(db_session, org.organization_id, "api_key", key.api_key_id)
    assert rows[0].change_type == "created" and rows[0].entity_display_key == "Catalogue sync"
    assert rows[0].changed_by == user.user_id
    assert any(_diffs(e).get("status") == ("active", "revoked") for e in rows)
    for e in rows:
        assert not {"key_hash", "key_prefix", "last_used_at"} & set(_diffs(e))

    dump = _all_audit_text(db_session)
    assert _FULL_KEY not in dump and "hashed_value_for_testing" not in dump and "mkey_fak" not in dump


def test_api_key_use_is_not_a_change(acting_user, db_session):
    """last_used_at is touched on every authenticated call; it is left out."""
    from datetime import datetime, timezone

    org, user = acting_user
    key = APIKey(organization_id=org.organization_id, name="Reader", key_prefix="mkey_abc",
                 key_hash="h" * 64, scopes=["read:datasets"], status="active", created_by_user_id=user.user_id)
    db_session.add(key)
    db_session.commit()
    key.last_used_at = datetime.now(timezone.utc)
    db_session.commit()
    assert _events(db_session, org.organization_id, "api_key", key.api_key_id, "updated") == []


# ---------------------------------------------------------------------------
# Reading the history: per record, and the admin Security changes log
# ---------------------------------------------------------------------------


def test_security_change_log_lists_only_security_records(auth_setup, db_session):
    client, org, _ = auth_setup
    resp = _post(client, f"/api/organizations/{org.organization_id}/custom-roles", {"display_name": "Registrar assistant"})
    role_id = resp.get_json()["role_id"]
    db_session.add(CollectionObject(organization_id=org.organization_id, object_number="SEC.1"))
    db_session.commit()

    resp = client.get(f"/api/organizations/{org.organization_id}/entity-audit-events?category=security")
    assert resp.status_code == 200, resp.get_json()
    items = resp.get_json()["items"]
    assert items and {i["entity_type"] for i in items} <= ea.SECURITY_ENTITY_TYPES
    assert any(i["entity_id"] == role_id and i["change_type"] == "created" for i in items)

    resp = client.get(f"/api/organizations/{org.organization_id}/entity-audit-events?category=bogus")
    assert resp.status_code == 422

    resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/role/{role_id}")
    assert resp.status_code == 200 and resp.get_json()["items"][0]["change_type"] == "created"


def test_security_history_needs_the_audit_log_permission(auth_setup, db_session):
    from app.models import RolePermission

    client, org, _ = auth_setup
    admin = db_session.query(Role).filter(Role.role_key == "admin").first()
    perm = _create_permission(db_session, "org.view_audit_logs")
    db_session.query(RolePermission).filter_by(role_id=admin.role_id, permission_id=perm.permission_id).delete()
    db_session.commit()
    for et in ("role", "app_role_assignment", "sso_configuration", "api_key"):
        resp = client.get(f"/api/organizations/{org.organization_id}/entity-history/{et}/{uuid.uuid4()}")
        assert resp.status_code == 403, et


# ---------------------------------------------------------------------------
# Under enforced RLS: another organization cannot see these rows
# ---------------------------------------------------------------------------


class TestSecurityAuditUnderRls:
    @pytest.fixture
    def tenants(self, rls_db_session):
        from tests.conftest import _RLS_TEST_ROLE, _create_role_permission
        from tests.test_research_visits_rls import _seed

        connection = rls_db_session.connection()
        connection.execute(text("RESET ROLE"))
        try:
            out = []
            for name in ("Alpha", "Beta"):
                slug = f"{name.lower()}-{uuid.uuid4().hex[:8]}"
                out.append(_seed(rls_db_session, name=name, slug=slug))
                role = rls_db_session.query(Role).filter(Role.role_key == f"rv-{slug}").one()
                for key in ("data.view", "org.manage_roles", "org.view_audit_logs"):
                    _create_role_permission(rls_db_session, role, _create_permission(rls_db_session, key))
            rls_db_session.commit()
        finally:
            connection.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
        return out

    def test_role_events_written_and_isolated(self, rls_client, rls_db_session, tenants):
        from tests.conftest import _RLS_TEST_ROLE, AuthenticatedClient

        alpha, beta = tenants
        as_alpha = AuthenticatedClient(rls_client, alpha.token)
        as_beta = AuthenticatedClient(rls_client, beta.token)
        r = as_alpha.post(f"/api/organizations/{alpha.org_id}/custom-roles", json={"display_name": "Alpha docent"})
        assert r.status_code == 201, r.text[:300]
        role_id = r.get_json()["role_id"]

        hist = as_alpha.get(f"/api/organizations/{alpha.org_id}/entity-history/role/{role_id}")
        assert hist.status_code == 200, hist.text[:300]
        assert [e["change_type"] for e in hist.get_json()["items"]] == ["created"]
        log = as_alpha.get(f"/api/organizations/{alpha.org_id}/entity-audit-events?category=security")
        assert any(i["entity_id"] == role_id for i in log.get_json()["items"])

        r = as_beta.get(f"/api/organizations/{beta.org_id}/entity-history/role/{role_id}")
        assert r.status_code == 200 and r.get_json()["items"] == []
        r = as_beta.get(f"/api/organizations/{beta.org_id}/entity-audit-events?category=security")
        assert all(i["entity_id"] != role_id for i in r.get_json()["items"])

        rls_db_session.execute(text("SELECT set_config('app.current_org_id', :o, true)"), {"o": str(beta.org_id)})
        assert rls_db_session.execute(
            text("SELECT count(*) FROM entity_audit_events WHERE entity_id = :id"), {"id": role_id}
        ).scalar() == 0
        rls_db_session.execute(text("RESET ROLE"))
        try:
            assert rls_db_session.execute(
                text("SELECT count(*) FROM entity_audit_events WHERE entity_id = :id AND organization_id = :o"),
                {"id": role_id, "o": str(alpha.org_id)},
            ).scalar() == 1
        finally:
            rls_db_session.execute(text(f"SET ROLE {_RLS_TEST_ROLE}"))
