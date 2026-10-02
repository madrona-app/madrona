"""
Permission matrix tests.

Verifies that each role's effective permission set (including inheritance)
matches the expected museum role assignments exactly. Also includes negative
tests to catch permission leaks and old-key rejection tests.

Run with:
    pytest tests/test_permission_matrix.py -v
"""

import pytest
from app.permissions import get_role_inheritance_chain


# ---------------------------------------------------------------------------
# Expected permission sets per role (complete, including inherited)
# Source of truth: seed_roles_and_permissions.py ROLE_PERMISSIONS dict
# ---------------------------------------------------------------------------

EXPECTED_VIEWER = {
    # View access to all entities
    "acquisitions.view", "audits.view", "authorities.view",
    "barcodes.view", "branding.view",
    "cataloging_history.view", "citations.view",
    "collections.view", "condition_reports.view", "conservation.view",
    "constituents.view", "contacts.view", "critical_responses.view",
    "deaccession.view", "documentation_plans.view",
    "download_requests.create", "download_requests.view",
    "emergency_plans.view", "entries.view", "events.view",
    "exhibit.content.view", "exhibit.view", "exits.view",
    "incidents.view", "indemnity.view", "insurance.view",
    "labels.view", "loans.view", "locations.view", "lookups.view",
    "media.download_derivatives", "media.view",
    "media_workspaces.view",
    "movements.view", "nagpra.view",
    "object_contexts.view", "object_relationships.view",
    "place_authorities.view",
    "reports.view", "reproduction_requests.view", "reviews.view",
    "rights.view", "runs.view",
    "style_period_authorities.view", "subject_authorities.view",
    "tasks.create", "tasks.delete", "tasks.edit", "tasks.view",
    "touring.view",
    "use_requests.view",
    "valuations.view", "venues.view",
    "workspaces.view",
}

EXPECTED_PUBLISHER = EXPECTED_VIEWER | {
    "collections.create", "collections.edit", "data.export", "data.query",
    "data.view", "discover.publish", "documents.generate", "documents.templates.view",
    "lookups.view", "media.download_original", "media.edit", "media.publish",
    "media.view_unpublished", "media_workspaces.create", "media_workspaces.delete",
    "media_workspaces.edit", "media_workspaces.execute", "media_workspaces.share",
    "media_workspaces.view", "reproduction_requests.view", "rights.view",
    "use_requests.view",
}

EXPECTED_CURATOR = EXPECTED_PUBLISHER | {
    "acquisitions.view", "authorities.create", "authorities.edit", "authorities.view",
    "barcodes.view", "branding.view", "cataloging_history.create", "cataloging_history.view",
    "citations.edit", "citations.view", "condition_reports.create", "condition_reports.edit",
    "condition_reports.view", "conservation.view", "constituents.create", "constituents.edit",
    "constituents.view", "contacts.view", "critical_responses.create", "critical_responses.edit",
    "critical_responses.view", "documentation_plans.create", "documentation_plans.edit",
    "documentation_plans.view", "emergency_plans.view", "entries.view", "events.view",
    "exhibit.content.view", "exhibit.view", "exits.view", "incidents.view", "loans.view",
    "movements.view", "object_contexts.create", "object_contexts.edit", "object_contexts.view",
    "object_relationships.edit", "object_relationships.view", "place_authorities.create",
    "place_authorities.edit", "place_authorities.view", "style_period_authorities.create",
    "style_period_authorities.edit", "style_period_authorities.view",
    "subject_authorities.create", "subject_authorities.edit", "subject_authorities.view",
    "touring.view", "valuations.view", "workspaces.create", "workspaces.edit",
    "workspaces.execute", "workspaces.view",
    "media.approve_rights", "media.approve_review",
}

EXPECTED_REGISTRAR = EXPECTED_CURATOR | {
    "acquisitions.approve", "acquisitions.create", "acquisitions.edit", "acquisitions.rollback",
    "audits.create", "audits.edit", "audits.view", "authorities.delete", "authorities.merge",
    "barcodes.manage", "barcodes.scan", "collections.delete", "condition_reports.delete",
    "condition_reports.review", "connectors.edit", "connectors.view", "conservation.approve",
    "conservation.create", "conservation.edit", "constituents.merge", "contacts.edit",
    "data.manage", "deaccession.create", "deaccession.edit", "deaccession.review",
    "deaccession.view", "documentation_plans.approve", "download_requests.fulfill",
    "download_requests.review", "emergency_plans.approve", "emergency_plans.create",
    "emergency_plans.edit", "entries.create", "entries.edit", "events.edit",
    "exhibit.content.edit", "exhibit.create", "exhibit.edit", "exits.create", "exits.edit",
    "exits.rollback", "incidents.create", "incidents.edit", "incidents.investigate",
    "incidents.resolve", "indemnity.create", "indemnity.edit", "indemnity.view",
    "insurance.claims.create", "insurance.claims.manage", "insurance.create", "insurance.edit",
    "insurance.view", "labels.edit", "labels.view", "loans.approve", "loans.create",
    "loans.edit", "loans.rollback", "mappings.edit", "mappings.view", "movements.create",
    "nagpra.create", "nagpra.edit", "nagpra.view", "pipelines.edit", "pipelines.view",
    "place_authorities.delete", "reports.create", "reports.delete", "reports.edit",
    "reports.execute", "reports.export", "reports.schedule", "reports.view",
    "reproduction_requests.approve", "reproduction_requests.create",
    "reproduction_requests.delete", "reproduction_requests.edit", "reviews.create",
    "reviews.edit", "reviews.view", "rights.create", "rights.edit", "runs.execute",
    "runs.force_full", "runs.rollback", "runs.view_logs", "schedules.manage",
    "style_period_authorities.delete", "subject_authorities.delete", "touring.edit",
    "use_requests.approve", "use_requests.create", "use_requests.edit",
    "valuations.create", "valuations.edit", "venues.edit", "venues.view",
}

EXPECTED_ADMIN = EXPECTED_REGISTRAR | {
    "audits.approve", "branding.edit", "collections.view_all_departments", "content.delete",
    "content.edit", "content.publish", "content.view", "critical_responses.delete",
    "deaccession.approve", "deaccession.complete", "deaccession.rollback",
    "departments.create", "departments.delete", "departments.edit",
    "departments.manage_members", "departments.view", "documents.templates.edit",
    "exhibit.content.publish", "exhibit.delete", "exhibit.publish", "indemnity.submit",
    "insurance.approve", "insurance.delete", "labels.approve", "lookups.manage",
    "media.admin", "media.delete", "media_workspaces.delete", "media_workspaces.share",
    "object_contexts.delete", "org.manage_api_keys", "org.manage_members",
    "org.manage_roles", "org.manage_settings", "org.users.create", "org.users.deactivate",
    "org.users.update", "org.view_audit_logs", "reviews.approve", "runs.delete",
    "valuations.delete", "workspaces.delete", "workspaces.share",
}

EXPECTED_PLATFORM_ADMIN = EXPECTED_ADMIN | {
    "platform.admin",
}

EXPECTED_BY_ROLE = {
    "viewer": EXPECTED_VIEWER,
    "publisher": EXPECTED_PUBLISHER,
    "curator": EXPECTED_CURATOR,
    "registrar": EXPECTED_REGISTRAR,
    "admin": EXPECTED_ADMIN,
    "platform_admin": EXPECTED_PLATFORM_ADMIN,
}


# ---------------------------------------------------------------------------
# Positive tests: each role has exactly the expected permissions
# ---------------------------------------------------------------------------


def _get_seed_permissions_for_role(role_key: str) -> set[str]:
    """Get the effective permission set for a role from the seed data, including inheritance."""
    from seeds.seed_roles_and_permissions import ROLE_PERMISSIONS

    chain = get_role_inheritance_chain(role_key)
    effective = set()
    for r in chain:
        effective.update(ROLE_PERMISSIONS.get(r, []))
    return effective


@pytest.mark.parametrize("role_key", ["viewer", "publisher", "curator", "registrar", "admin", "platform_admin"])
def test_role_has_expected_permissions(role_key):
    """Each role's effective permissions match the expected set exactly."""
    actual = _get_seed_permissions_for_role(role_key)
    expected = EXPECTED_BY_ROLE[role_key]

    missing = expected - actual
    extra = actual - expected

    assert not missing, f"{role_key} missing permissions: {sorted(missing)}"
    assert not extra, f"{role_key} has unexpected extra permissions: {sorted(extra)}"


# ---------------------------------------------------------------------------
# Negative tests: specific permissions must NOT be on certain roles
# ---------------------------------------------------------------------------


def test_viewer_does_not_have_media_admin():
    assert "media.admin" not in _get_seed_permissions_for_role("viewer")


def test_viewer_does_not_have_entries_edit():
    assert "entries.edit" not in _get_seed_permissions_for_role("viewer")


def test_viewer_does_not_have_collections_edit():
    assert "collections.edit" not in _get_seed_permissions_for_role("viewer")


def test_publisher_does_not_have_entries_edit():
    assert "entries.edit" not in _get_seed_permissions_for_role("publisher")


def test_publisher_does_not_have_acquisitions_edit():
    assert "acquisitions.edit" not in _get_seed_permissions_for_role("publisher")


def test_curator_does_not_have_acquisitions_edit():
    assert "acquisitions.edit" not in _get_seed_permissions_for_role("curator")


def test_curator_does_not_have_org_manage_settings():
    assert "org.manage_settings" not in _get_seed_permissions_for_role("curator")


def test_curator_does_not_have_deaccession_edit():
    assert "deaccession.edit" not in _get_seed_permissions_for_role("curator")


def test_registrar_does_not_have_org_manage_settings():
    assert "org.manage_settings" not in _get_seed_permissions_for_role("registrar")


def test_registrar_does_not_have_media_admin():
    assert "media.admin" not in _get_seed_permissions_for_role("registrar")


def test_registrar_does_not_have_media_delete():
    assert "media.delete" not in _get_seed_permissions_for_role("registrar")


# ---------------------------------------------------------------------------
# Inheritance chain tests
# ---------------------------------------------------------------------------


def test_inheritance_chain_viewer():
    assert get_role_inheritance_chain("viewer") == ["viewer"]


def test_inheritance_chain_publisher():
    assert get_role_inheritance_chain("publisher") == ["publisher", "viewer"]


def test_inheritance_chain_curator():
    assert get_role_inheritance_chain("curator") == ["curator", "publisher", "viewer"]


def test_inheritance_chain_registrar():
    assert get_role_inheritance_chain("registrar") == ["registrar", "curator", "publisher", "viewer"]


def test_inheritance_chain_admin():
    assert get_role_inheritance_chain("admin") == ["admin", "registrar", "curator", "publisher", "viewer"]


def test_inheritance_chain_platform_admin():
    assert get_role_inheritance_chain("platform_admin") == ["platform_admin", "admin", "registrar", "curator", "publisher", "viewer"]


# ---------------------------------------------------------------------------
# Old key rejection tests
# ---------------------------------------------------------------------------


def test_old_keys_not_in_seed():
    """Old role keys must not appear in the seed ROLE_PERMISSIONS."""
    from seeds.seed_roles_and_permissions import ROLE_PERMISSIONS

    old_keys = {"org_admin", "data_engineer", "data_analyst", "data_publisher"}
    actual_keys = set(ROLE_PERMISSIONS.keys())
    overlap = old_keys & actual_keys
    assert not overlap, f"Old role keys still in seed: {overlap}"


def test_old_keys_not_in_inheritance_map():
    """Old role keys must not appear in ROLE_INHERITANCE_MAP."""
    from app.permissions import ROLE_INHERITANCE_MAP

    old_keys = {"org_admin", "data_engineer", "data_analyst", "data_publisher"}
    map_keys = set(ROLE_INHERITANCE_MAP.keys())
    map_values = {v for v in ROLE_INHERITANCE_MAP.values() if v is not None}
    overlap = old_keys & (map_keys | map_values)
    assert not overlap, f"Old role keys still in inheritance map: {overlap}"


# ---------------------------------------------------------------------------
# Permission count sanity checks
# ---------------------------------------------------------------------------


def test_role_permission_counts():
    """Verify approximate permission counts to catch accidental mass additions/deletions."""
    counts = {role: len(perms) for role, perms in EXPECTED_BY_ROLE.items()}
    assert 50 <= counts["viewer"] <= 60
    assert 65 <= counts["publisher"] <= 80
    assert 90 <= counts["curator"] <= 105
    assert 175 <= counts["registrar"] <= 195
    assert 215 <= counts["admin"] <= 235
    assert counts["platform_admin"] == counts["admin"] + 1


def test_each_higher_role_is_superset():
    """Each role in the hierarchy is a strict superset of the role below it."""
    chain = [
        ("publisher", "viewer"),
        ("curator", "publisher"),
        ("registrar", "curator"),
        ("admin", "registrar"),
        ("platform_admin", "admin"),
    ]
    for higher, lower in chain:
        higher_perms = EXPECTED_BY_ROLE[higher]
        lower_perms = EXPECTED_BY_ROLE[lower]
        assert lower_perms < higher_perms, (
            f"{higher} is not a strict superset of {lower}. "
            f"Missing: {sorted(lower_perms - higher_perms)}"
        )
